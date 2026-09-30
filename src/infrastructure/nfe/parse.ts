import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { norm } from '@/domain/services/format'
import { spedToNumber } from '../sped/leitura'
import type { DirecaoNota, ItemNotaXml, NotaXmlBruta } from './tipos'

/** Modelos aceitos nesta seção (NF-e e NFC-e). */
const MODELOS_ACEITOS = new Set(['55', '65'])

/**
 * Parser sem dependência de DOM: funciona no Electron, no navegador e nos
 * testes (node). Valores sempre como string (preserva zeros à esquerda de
 * CNPJ/chave e o ponto decimal do layout da NF-e).
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

type No = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const no = (v: unknown): No => (v && typeof v === 'object' ? (v as No) : {})
const lista = (v: unknown): No[] => (Array.isArray(v) ? v.map(no) : v ? [no(v)] : [])

/**
 * Localiza a raiz `NFe` — aceita `nfeProc` (distribuição SEFAZ) e `NFe` avulsa.
 * Rejeita CT-e/MDF-e e outros XMLs com erro dedicado.
 */
function raizNFe(doc: No, rotulo: string): No {
  const chaves = Object.keys(doc)
  const nome = chaves[0] ?? ''
  if (/^(cteProc|CTe|CTE)$/.test(nome)) {
    throw new Error(`"${rotulo}": é um CT-e (transporte). Esta seção importa apenas NF-e (mod. 55) e NFC-e (mod. 65).`)
  }
  if (/^(mdfeProc|MDFe|MDFE)$/.test(nome)) {
    throw new Error(`"${rotulo}": é um MDF-e. Esta seção importa apenas NF-e (mod. 55) e NFC-e (mod. 65).`)
  }
  const embrulho = no(doc['nfeProc'])
  const nfe = no(embrulho['NFe'] ?? doc['NFe'])
  if (!nfe || Object.keys(nfe).length === 0) {
    throw new Error(`"${rotulo}": XML sem raiz NFe — não é uma NF-e/NFC-e válida.`)
  }
  return nfe
}

/**
 * Leitura completa do grupo `imposto/ICMS`: CST (regime normal) ou CSOSN
 * (Simples), base de cálculo, alíquota e valor destacados no item.
 *
 * Por que um leitor único: antes CST e valor vinham de varreduras separadas,
 * que podiam pinar grupos diferentes (ex.: CST de ICMS60 sem destaque e
 * vICMS de ICMS00). Aqui escolhemos **um** grupo e derivamos todos os
 * campos dele — o preferido é o primeiro com `vICMS > 0`; havendo isenção
 * (vICMS = 0), fica o primeiro grupo que tenha CST/CSOSN.
 */
function lerIcmsDoImposto(imposto: No): {
  cstIcms: string
  vBcIcms: number
  pIcms: number
  vlIcms: number
} {
  const vazio = { cstIcms: '', vBcIcms: 0, pIcms: 0, vlIcms: 0 }
  const icms = no(imposto['ICMS'])
  let escolhido: typeof vazio | null = null
  for (const k of Object.keys(icms)) {
    const grupo = no(icms[k])
    const cst = str(grupo['CST']) || str(grupo['CSOSN'])
    const candidato = {
      cstIcms: cst,
      vBcIcms: spedToNumber(str(grupo['vBC'])),
      pIcms: spedToNumber(str(grupo['pICMS'])),
      vlIcms: spedToNumber(str(grupo['vICMS'])),
    }
    if (candidato.vlIcms > 0) return candidato
    if (!escolhido && cst) escolhido = candidato
  }
  return escolhido ?? vazio
}

/**
 * Totais numéricos profundos: soma **todos** os valores de tags cujo nome
 * (sem namespace) casa com o padrão — tolerante às variações da NT 2025.002
 * (`vIBSUF`, `vIBSMun`, `vIBS`, `vCBS`, …). Varre recursivamente o nó.
 */
function somarTags(noAlvo: unknown, re: RegExp): number {
  let total = 0
  const visitar = (v: unknown): void => {
    if (v == null) return
    if (typeof v === 'string') return
    if (typeof v === 'number') return
    if (Array.isArray(v)) {
      for (const item of v) visitar(item)
      return
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const nome = k.replace(/^@_/, '').split(':').pop() ?? k
        if (re.test(nome) && (typeof val === 'string' || typeof val === 'number')) {
          total += spedToNumber(str(val))
        } else {
          visitar(val)
        }
      }
    }
  }
  visitar(noAlvo)
  return Math.round(total * 100) / 100
}

/**
 * IBS de um bloco: prefere o agregado `vIBS` quando presente (layout com
 * totalizador); senão soma `vIBSUF + vIBSMun`. Evita dupla contagem quando o
 * XML traz os três (componentes + agregado).
 */
function somarIbs(noAlvo: unknown): number {
  const agregado = somarTags(noAlvo, /^vIBS$/i)
  if (agregado > 0) return agregado
  return somarTags(noAlvo, /^vIBS(UF|Mun)$/i)
}

/**
 * Leitura do grupo `imposto/IBSCBS` (NT 2025.002 — Reforma).
 * Estrutura esperada:
 * ```
 * <IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>
 *   <gIBSCBS><vBC>200.00</vBC>
 *     <gIBSUF><vIBSUF>…</vIBSUF></gIBSUF>
 *     <gIBSMun><vIBSMun>…</vIBSMun></gIBSMun>
 *     <gCBS><vCBS>…</vCBS></gCBS>
 *   </gIBSCBS></IBSCBS>
 * ```
 * Variações (`vIBS` agregado, namespaces, maiúsculas) são aceitas pela soma
 * tolerante por padrão de tag. Retorna zeros quando o grupo está ausente
 * (XML anterior à Reforma).
 */
function lerIbsCbsDoImposto(imposto: No): {
  cstIbsCbs: string
  cClassTribIbsCbs: string
  vBcIbsCbs: number
  vIbsItem: number
  vCbsItem: number
} {
  const vazio = { cstIbsCbs: '', cClassTribIbsCbs: '', vBcIbsCbs: 0, vIbsItem: 0, vCbsItem: 0 }
  // O parser remove prefixos de namespace (`removeNSPrefix`), mas aceita
  // também a grafia em minúsculas (`ibscbs`) por robustez.
  const bloco = no(imposto['IBSCBS'] ?? imposto['ibscbs'] ?? imposto['IbsCbs'])
  if (!bloco || Object.keys(bloco).length === 0) return vazio
  const cstIbsCbs = str(bloco['CST'] ?? bloco['cst'])
  const cClassTribIbsCbs = str(bloco['cClassTrib'] ?? bloco['CClassTrib'] ?? bloco['CCLASS TRIB'])
  const interno = no(bloco['gIBSCBS'] ?? bloco)
  const vBcIbsCbs = spedToNumber(
    str(interno['vBC'] ?? interno['vBc'] ?? interno['VBC'] ?? no(bloco['gIBSCBS'])['vBC']),
  )
  const vIbsItem = somarIbs(bloco)
  const vCbsItem = somarTags(bloco, /^vCBS$/i)
  return { cstIbsCbs, cClassTribIbsCbs, vBcIbsCbs, vIbsItem, vCbsItem }
}

/**
 * Lê CST e valor de um bloco de PIS ou COFINS. Cobre os grupos por alíquota,
 * por qtde, NT e Simples Nacional — retornando sempre o **primeiro** grupo
 * que tenha valor, para não misturar CST de um grupo com valor de outro.
 */
function lerPisCofins(
  imposto: No,
  tag: 'PIS' | 'COFINS',
): { cst: string; valor: number } {
  const bloco = no(imposto[tag])
  let cst = ''
  for (const k of Object.keys(bloco)) {
    const grupo = no(bloco[k])
    const grupoCst = str(grupo['CST'])
    const valor =
      spedToNumber(str(grupo['vPIS'])) || spedToNumber(str(grupo['vCOFINS']))
    if (valor > 0) return { cst: grupoCst, valor }
    if (!cst && grupoCst) cst = grupoCst
  }
  return { cst, valor: 0 }
}

function lerItem(det: No, chave: string): ItemNotaXml | null {
  const prod = no(det['prod'])
  const codProd = str(prod['cProd'])
  if (!codProd) return null
  const imposto = no(det['imposto'])
  const digitos = str(prod['NCM']).replace(/\D/g, '')
  const qtd = spedToNumber(str(prod['qCom']))
  const vlUnit = spedToNumber(str(prod['vUnCom']))
  const vlTotal = spedToNumber(str(prod['vProd']))
  const ibsCbs = lerIbsCbsDoImposto(imposto)
  const icms = lerIcmsDoImposto(imposto)
  const pis = lerPisCofins(imposto, 'PIS')
  const cofins = lerPisCofins(imposto, 'COFINS')
  return {
    chave,
    numItem: str(det['@_nItem']),
    codProd,
    descricao: str(prod['xProd']) || codProd,
    ncm: digitos.length > 8 ? digitos.slice(0, 8) : digitos,
    cest: str(prod['CEST']).replace(/\D/g, '').slice(0, 7) || '',
    cfop: str(prod['CFOP']),
    ...icms,
    qtd,
    unid: str(prod['uCom']) || 'UN',
    vlUnit,
    vlTotal,
    vlDesc: spedToNumber(str(prod['vDesc'])),
    cstPis: pis.cst,
    vPis: pis.valor,
    cstCofins: cofins.cst,
    vCofins: cofins.valor,
    ...ibsCbs,
  }
}

/**
 * Converte o XML de NF-e/NFC-e em `NotaXmlBruta`.
 * Lança `Error` com motivo legível para XML inválido, modelo não suportado
 * ou ausência de itens — o caso de uso transforma em linha de erro do resumo.
 */
export function parseXmlNfe(conteudo: string, nomeArquivo: string): NotaXmlBruta {
  const rotulo = nomeArquivo || 'arquivo'
  // Arquivos reais podem trazer BOM ou quebras antes do `<?xml` — o validador
  // exige a declaração no início, então normaliza as bordas antes de validar.
  const texto = String(conteudo ?? '').trim().replace(/^﻿/, '')
  if (!texto) throw new Error(`"${rotulo}": arquivo vazio.`)
  const valido = XMLValidator.validate(texto)
  if (valido !== true) {
    throw new Error(`"${rotulo}": XML malformado ou com encoding inválido.`)
  }
  let doc: No
  try {
    doc = parser.parse(texto) as No
  } catch {
    throw new Error(`"${rotulo}": não foi possível interpretar o XML.`)
  }

  const nfe = raizNFe(doc, rotulo)
  const infNFe = no(nfe['infNFe'])
  const chave = str(infNFe['@_Id']).replace(/^NFe/i, '').trim()
  if (chave.length !== 44 || !/^\d+$/.test(chave)) {
    throw new Error(`"${rotulo}": chave de acesso ausente ou inválida (esperados 44 dígitos).`)
  }

  const ide = no(infNFe['ide'])
  const modelo = str(ide['mod'])
  if (!MODELOS_ACEITOS.has(modelo)) {
    throw new Error(`"${rotulo}": modelo ${modelo || 'desconhecido'} não suportado (aceitos: 55 e 65).`)
  }

  const dhEmi = str(ide['dhEmi']) || str(ide['dEmi'])
  const dataEmissao = /^\d{4}-\d{2}-\d{2}/.test(dhEmi) ? dhEmi.slice(0, 10) : ''
  if (!dataEmissao) {
    throw new Error(`"${rotulo}": data de emissão (dhEmi/dEmi) ausente ou inválida.`)
  }

  const emit = no(infNFe['emit'])
  const dest = no(infNFe['dest'])
  const emitCnpj = str(emit['CNPJ']) || str(emit['CPF'])
  if (!emitCnpj) throw new Error(`"${rotulo}": CNPJ do emitente ausente.`)

  // Dados cadastrais do emitente — usados para completar a empresa vinculada
  // (IE/IM/endereço). Ausência não aborta: o enriquecimento é best-effort.
  const enderEmit = no(emit['enderEmit'])
  const enderecoEmit = [str(enderEmit['xLgr']), str(enderEmit['nro']), str(enderEmit['xCpl']), str(enderEmit['xBairro'])]
    .filter(Boolean)
    .join(', ')

  const dets = lista(infNFe['det'])
  if (!dets.length) throw new Error(`"${rotulo}": nota sem itens (det).`)
  const itens: ItemNotaXml[] = []
  for (const det of dets) {
    const item = lerItem(det, chave)
    // Sem cProd o item não é vinculável ao cadastro — ignorado sem abortar
    // a nota inteira.
    if (item) itens.push(item)
  }
  if (!itens.length) throw new Error(`"${rotulo}": nenhum item com código de produto (cProd).`)

  const tot = no(no(infNFe['total'])['ICMSTot'])
  // Totais IBS/CBS destacados: prefere o grupo `IBSCBSTot` (NT 2025.002);
  // quando ausente, soma os itens (cobre XMLs que só destacam por item).
  // Também aceita `vIBS`/`vCBS` dentro de `ICMSTot` (variação de emissor).
  const totIbsCbs = no(no(infNFe['total'])['IBSCBSTot'] ?? no(infNFe['total'])['IBSCBS'] ?? {})
  let totalIbsXml = somarIbs(totIbsCbs)
  let totalCbsXml = somarTags(totIbsCbs, /^vCBS$/i)
  if (!totalIbsXml && !totalCbsXml) {
    totalIbsXml = somarIbs(tot)
    totalCbsXml = somarTags(tot, /^vCBS$/i)
  }
  if (!totalIbsXml && !totalCbsXml) {
    for (const it of itens) {
      totalIbsXml += Number(it.vIbsItem) || 0
      totalCbsXml += Number(it.vCbsItem) || 0
    }
    totalIbsXml = Math.round(totalIbsXml * 100) / 100
    totalCbsXml = Math.round(totalCbsXml * 100) / 100
  }
  const totalCreditoIbsCbsXml = Math.round((totalIbsXml + totalCbsXml) * 100) / 100
  return {
    chave,
    numero: str(ide['nNF']),
    serie: str(ide['serie']),
    modelo,
    natOp: str(ide['natOp']),
    dataEmissao,
    emitCnpj: norm(emitCnpj),
    emitNome: str(emit['xNome']),
    emitCrt: str(emit['CRT']),
    emitIe: str(emit['IE']),
    emitIm: str(emit['IM']),
    emitEndereco: enderecoEmit,
    emitCidade: str(enderEmit['xMun']),
    emitUf: str(enderEmit['UF']).toUpperCase().slice(0, 2),
    destDoc: norm(str(dest['CNPJ']) || str(dest['CPF'])),
    destNome: str(dest['xNome']),
    destIe: str(dest['IE']),
    valorProdutos: spedToNumber(str(tot['vProd'])),
    valorTotal: spedToNumber(str(tot['vNF'])),
    totalIbsXml,
    totalCbsXml,
    totalCreditoIbsCbsXml,
    itens,
  }
}

/**
 * Direção da nota frente ao CNPJ da empresa ativa (só dígitos).
 * Sem CNPJ cadastrado — ou sem coincidência — a nota vai para quarentena,
 * nunca é descartada silenciosamente.
 */
export function classificarDirecao(
  emitCnpj: string,
  destDoc: string,
  empresaCnpj: string | null | undefined,
): DirecaoNota {
  const empresa = norm(empresaCnpj)
  if (!empresa) return 'quarentena'
  if (norm(emitCnpj) === empresa) return 'saida'
  if (destDoc && norm(destDoc) === empresa) return 'entrada'
  return 'quarentena'
}
