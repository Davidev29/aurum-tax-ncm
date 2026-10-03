/**
 * Leitura de planilhas (CSV/XLSX/TXT) para classificação em lote e importação
 * de empresas.
 *
 * ## Paridade com a v1
 * - `mapearColunas` usa exatamente as mesmas expressões regulares de cabeçalho;
 * - NCM é interpretado pelo intérprete único (`interpretarEntradaNcm`) e só
 *   8 dígitos exatos entram no motor (política do Lote, como na v1);
 * - NCM válido sem vínculo cai na regra geral, com `regraGeral = true` — e o
 *   cartão de regra geral aparece em `classificacoes`, como na Consulta;
 * - NCM inválido mantém `classificacoes = []` e `escolhida = null`.
 * - o veredito (lista, regraGeral, manual) vem do resolvedor único
 *   (`resolverClassificacoes`): o Lote nunca decide sozinho.
 *
 * ## Melhorias
 * - cabeçalhos de empresa e de produto ganharam sinônimos reais de planilhas
 *   brasileiras (`referencia`, `código de barras`, `descrição`, `cod.produto`…);
 * - a leitura é feita **primeiro pelo XLSX** e, se o arquivo não for suportado,
 *   cai para um parser CSV próprio que entende `;` e `,` como separador;
 * - os erros saem em `pt-BR` com a linha exata, em vez de "undefined";
 * - o resultado já traz os totais que a tela precisa (classificadas, regra
 *   geral, ambíguas, inválidas), evitando reprocessar na camada de UI.
 * - a **Aurum AI assistida** (`analisarItemLoteIA`) ordena as opções oficiais
 *   por aderência do **nome** (nome + NCM = tributação provável) e explica,
 *   com dados da base, por que há N tributações + qual é a mais provável.
 */
import * as XLSX from 'xlsx'
import { fmtCnpj, norm, normalizeHeader } from '../../domain/services/format'
import { interpretarEntradaNcm } from '../../domain/services/classificacao'
import { analisarItemLoteIA, type AnaliseLoteIA } from '../../domain/services/analise-lote-ia'
import type { Classificacao, Empresa, NomenclaturaNcm } from '../../domain/entities'
import { resolverClassificacoes } from '../base/classificacao-repo'

/* ------------------------------------------------------------ planilhas -- */

export type TipoPlanilha = 'csv' | 'excel' | 'texto'

/** Lê a primeira aba de um arquivo CSV/XLSX/TXT em matriz de células. */
export async function lerPlanilha(file: File): Promise<unknown[][]> {
  const nome = file.name.toLowerCase()
  const tipo: TipoPlanilha = /\.(xlsx|xls|xlsm)$/.test(nome)
    ? 'excel'
    : /\.(csv|txt)$/.test(nome)
      ? 'csv'
      : 'texto'

  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) throw new Error('Primeira aba não encontrada.')
    // `raw: false` devolve o valor *formatado* (datas e CNPJ legíveis), em vez
    // do serial numérico — melhoria sobre a v1, sem alterar o mapeamento.
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
    if (rows.length) return rows as unknown[][]
    // Planilha vazia: tenta o parser textual abaixo.
    if (tipo !== 'excel') return separarLinhas(new TextDecoder('utf-8').decode(buf))
    throw new Error('Planilha vazia.')
  } catch (erro) {
    if (tipo === 'excel') throw erro
    // Fallback textual: CSV/TXT malformado para o XLSX.
    const texto = await file.text()
    const linhas = separarLinhas(texto)
    if (linhas.length) return linhas
    throw erro
  }
}

/** Parser CSV textual de emergência: detecta `;` ou `,` e respeita aspas. */
function separarLinhas(texto: string): unknown[][] {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!limpo.trim()) return []
  const primeira = limpo.slice(0, limpo.indexOf('\n') === -1 ? limpo.length : limpo.indexOf('\n'))
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ','

  const out: unknown[][] = []
  let atual: string[] = []
  let campo = ''
  let entreAspas = false

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i]
    if (entreAspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') {
          campo += '"'
          i++
        } else entreAspas = false
      } else campo += c
    } else if (c === '"') entreAspas = true
    else if (c === sep) {
      atual.push(campo)
      campo = ''
    } else if (c === '\n') {
      atual.push(campo)
      campo = ''
      out.push(atual)
      atual = []
    } else campo += c
  }
  atual.push(campo)
  if (atual.length > 1 || atual[0] !== '') out.push(atual)
  return out
}

/* ------------------------------------------------------------ mapeamento -- */

export interface MapaColunas {
  codigo?: number
  nome?: number
  ncm?: number
  cfop?: number
  cstIcms?: number
  pis?: number
  cofins?: number
  cest?: number
}

/**
 * Sinônimos adicionais sobre os da v1 — a expressão original continua sendo a
 * primeira opção de cada campo, então qualquer arquivo que a v1 aceitava também
 * é aceito aqui (o que a v1 rejeitava, agora é reconhecido).
 */
const ALIASES: Record<Exclude<keyof MapaColunas, 'ncm'>, RegExp> = {
  // `codsku` é o cabeçalho exato do modelo que o próprio app baixa
  // ("COD/SKU"): a v1 não o reconhecia e o SKU vinha vazio.
  codigo: /^(cod|sku|codigo|codigosku|codsku|codigoproduto|codproduto|code|codigointerno|referencia|ref|codigodebarras|codbarra|codigoprod|produtocodigo)$/,
  nome: /^(nome|nomedoproduto|produto|descricao|nomedescricao|descricaoproduto|desc|produtodescricao|nomedoprod)$/,
  cfop: /^(cfop|codigocfop|cfopoperacao|cfopvenda|cfopitem)$/,
  cstIcms: /^(cst|csticms|csticmsnf|cstsituacao|situacaotributaria|situacaofiscal)$/,
  pis: /^(pis|cstpis|piscst|cstpiscofins)$/,
  cofins: /^(cofins|cstcofins|cofinscst|cstpiscofins2)$/,
  cest: /^(cest|codigocest|cestcodigo|cestitem)$/,
}

/** Mapeia cabeçalhos → índices de coluna (paridade + sinônimos). */
export function mapearColunas(headers: unknown[]): MapaColunas {
  const map: MapaColunas = {}
  headers.forEach((h, i) => {
    const n = normalizeHeader(h)
    if (/^(cod|sku|codigo|codigosku|codigoproduto|code|codigointerno)$/.test(n)) map.codigo ??= i
    else if (/^(nome|nomedoproduto|produto|descricao|nomedescricao|descricaoproduto)$/.test(n)) map.nome ??= i
    else if (/^(ncm|codigoncm|ncmsh)$/.test(n)) map.ncm ??= i
    else if (/^(cfop|codigocfop)$/.test(n)) map.cfop ??= i
    else if (/^(cst|csticms)$/.test(n)) map.cstIcms ??= i
    else if (/^(pis|cstpis|piscst)$/.test(n)) map.pis ??= i
    else if (/^(cofins|cstcofins|cofinscst)$/.test(n)) map.cofins ??= i
    else if (/^(cest|codigocest|cestcodigo)$/.test(n)) map.cest ??= i
    else {
      // Sinônimos não cobertos pela v1.
      for (const [campo, re] of Object.entries(ALIASES) as [keyof MapaColunas, RegExp][]) {
        if (re.test(n)) {
          if (map[campo] === undefined) map[campo] = i
          break
        }
      }
    }
  })
  return map
}

const cel = (row: unknown[], idx: number | undefined): string =>
  idx === undefined ? '' : String(row[idx] ?? '').trim()

/* ------------------------------------------------------------- resultado -- */

export interface ItemLote {
  /** Linha da planilha (1 = cabeçalho), para rastreabilidade. */
  indice: number
  codigo: string
  nome: string
  ncm: string
  /** CEST — informativo, não altera a Reforma. */
  cest: string
  cfop: string
  cstIcms: string
  pis: string
  cofins: string
  classificacoes: Classificacao[]
  escolhida: Classificacao | null
  regraGeral: boolean
  /** `true` quando a escolhida veio de reclassificação manual do usuário. */
  manual?: boolean
  /** Nomenclatura vigente — quando `dataFim` preenchida, o NCM está extinto. */
  nomenclatura?: NomenclaturaNcm | null
  /**
   * Análise assistida da Aurum AI (nome + NCM = tributação provável).
   * Sempre presente após `processarArquivoLote` — inclusive para NCM
   * inválido (situação `invalida`, sem opções). A `escolhida` inicial já é
   * a `maisProvavel` desta análise (escolha assistida pré-selecionada).
   */
  analiseIA?: AnaliseLoteIA | null
}

export interface ResumoLote {
  itens: ItemLote[]
  nomeArquivo: string
  comClassificacao: number
  regraGeral: number
  manuais: number
  semNcm: number
  ambiguos: number
  /** Linhas com sugestão forte da IA (múltiplas + nome desempatou). */
  assistidas?: number
  /** Mantido por compatibilidade — sempre 0 (alerta nome × NCM removido). */
  divergentes?: number
  /** Linhas com tributação única confirmada. */
  unicas?: number
}

/**
 * Lê o arquivo e resolve a classificação de cada linha.
 *
 * A resolução replica o laço da v1 (cache por NCM para não bater na base 2.345
 * vezes) e aproveita `resolverClassificacoes`, que já devolve nomenclatura e o
 * indicador de regra geral.
 */
export async function processarArquivoLote(
  file: File,
  onProgress?: (feito: number, total: number) => void,
): Promise<ResumoLote> {
  const rows = await lerPlanilha(file)
  if (rows.length < 2) throw new Error('Arquivo vazio ou sem dados.')

  const headers = rows[0]
  const map = mapearColunas(headers)
  if (map.ncm == null) {
    throw new Error(
      `Coluna NCM não encontrada no cabeçalho. Cabeçalhos lidos: ${headers
        .map((h) => String(h ?? '').trim())
        .filter(Boolean)
        .join(', ') || '(nenhum)'}.`,
    )
  }

  const dados = rows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  // Veredito do motor único por NCM (lista, regraGeral, manual, nomenclatura).
  type Veredito = Awaited<ReturnType<typeof resolverClassificacoes>>
  const cache = new Map<string, Veredito>()

  const itens: ItemLote[] = []

  for (let d = 0; d < dados.length; d++) {
    const row = dados[d]
    const entrada = interpretarEntradaNcm(row[map.ncm])
    const cod = norm(row[map.ncm])
    const item: ItemLote = {
      indice: d + 2, // +1 cabeçalho, +1 base 1
      codigo: cel(row, map.codigo),
      nome: cel(row, map.nome),
      ncm: cod,
      cfop: cel(row, map.cfop),
      cstIcms: cel(row, map.cstIcms),
      pis: cel(row, map.pis),
      cofins: cel(row, map.cofins),
      cest: cel(row, map.cest).replace(/\D/g, '').slice(0, 7),
      classificacoes: [],
      escolhida: null,
      regraGeral: false,
    }

    // Política do Lote: só 8 dígitos exatos entram no motor (o resto é
    // `semNcm`, como na v1). O NCM classificado vem do intérprete único.
    if (entrada.kind === 'ok') {
      const chave = entrada.codigo
      let veredito = cache.get(chave)
      if (!veredito) {
        veredito = await resolverClassificacoes(chave)
        cache.set(chave, veredito)
      }
      item.classificacoes = veredito.lista
      item.regraGeral = veredito.regraGeral
      item.manual = veredito.manual || veredito.lista.some((c) => c.manual != null)
      item.nomenclatura = veredito.nomenclatura
      // Aurum AI assistida: nome + NCM = tributação provável. O nome só
      // ordena as opções oficiais (nunca cria tributação); a sugestão já
      // nasce pré-selecionada (escolha assistida — o usuário confirma/troca).
      const analise = analisarItemLoteIA({
        nome: item.nome,
        ncm: chave,
        classificacoes: veredito.lista,
        regraGeral: veredito.regraGeral,
        manual: item.manual ?? false,
        extinto: veredito.extinto,
        nomenclaturaDescricao: veredito.nomenclatura?.descricao ?? null,
      })
      item.analiseIA = analise
      const sugerida = veredito.lista[analise.maisProvavelIndice] ?? veredito.lista[0] ?? null
      item.escolhida = sugerida
    } else {
      // Sem veredito do motor (NCM inválido): a IA ainda explica o que
      // fazer — sem inventar tributação (lista vazia, situação `invalida`).
      item.analiseIA = analisarItemLoteIA({
        nome: item.nome,
        ncm: item.ncm,
        classificacoes: [],
        regraGeral: false,
        manual: false,
        extinto: false,
        nomenclaturaDescricao: null,
      })
    }

    itens.push(item)
    if (onProgress && (d % 25 === 0 || d === dados.length - 1)) onProgress(d + 1, dados.length)
  }

  const comAnalise = (s: string) => itens.filter((i) => i.analiseIA?.situacao === s).length
  return {
    itens,
    nomeArquivo: file.name,
    comClassificacao: itens.filter((i) => i.escolhida).length,
    regraGeral: itens.filter((i) => i.regraGeral).length,
    manuais: itens.filter((i) => i.manual).length,
    semNcm: itens.filter((i) => i.ncm.length !== 8).length,
    ambiguos: itens.filter((i) => i.classificacoes.length > 1).length,
    assistidas: itens.filter((i) => i.analiseIA?.situacao === 'multipla' && (i.analiseIA?.confianca ?? 0) >= 0.6).length,
    divergentes: 0,
    unicas: comAnalise('unica'),
  }
}

/* ------------------------------------------------------------- empresas --- */

const RE_RAZAO = /^(razaosocial|razao|nome|nomeempresa|empresa|clientes|razaosocialempresa)$/
const RE_CNPJ = /^(cnpj|numerocnpj|cnpjempresa|cgc)$/
const RE_FANTASIA = /^(nomefantasia|fantasia|apelido|nomecomercial|fantasiaempresa)$/

/**
 * Importa empresas em lote (paridade com `importarEmpresasLote` da v1).
 * Lança erro em pt-BR; o chamador decide o `confirm`.
 */
export async function importarEmpresasDoArquivo(file: File): Promise<Empresa[]> {
  const rows = await lerPlanilha(file)
  if (rows.length < 2) throw new Error('Arquivo vazio ou sem dados.')

  const headers = rows[0].map(normalizeHeader)
  const idxRazao = headers.findIndex((h) => RE_RAZAO.test(h))
  const idxCnpj = headers.findIndex((h) => RE_CNPJ.test(h))
  const idxFant = headers.findIndex((h) => RE_FANTASIA.test(h))

  if (idxRazao < 0) {
    throw new Error(
      `Coluna "Razão Social" não encontrada. Cabeçalhos lidos: ${
        rows[0].map((h) => String(h ?? '').trim()).filter(Boolean).join(', ') || '(nenhum)'
      }.`,
    )
  }

  const agora = new Date().toISOString()
  const lote: Empresa[] = []
  for (const row of rows.slice(1)) {
    const razao = String(row[idxRazao] ?? '').trim()
    if (!razao) continue
    lote.push({
      razaoSocial: razao,
      cnpj: idxCnpj >= 0 ? fmtCnpj(row[idxCnpj]) : '',
      fantasia: idxFant >= 0 ? String(row[idxFant] ?? '').trim() : '',
      criadoEm: agora,
    })
  }

  if (!lote.length) throw new Error('Nenhuma empresa válida encontrada.')
  return lote
}
