import { spedToNumber } from './leitura'
import type { ItemSped, NotaSped, ResumoC190, SpedParseado, SpedStats } from './tipos'

/* -------------------------------------------------------------------------- */
/* Estatísticas                                                                */
/* -------------------------------------------------------------------------- */

const statsVazio = (): SpedStats => ({
  linhasTotais: 0,
  registros0200: 0,
  registrosA100: 0,
  registrosA170: 0,
  registrosC100: 0,
  registrosC170: 0,
  registrosD100: 0,
  registrosD170: 0,
  registrosC190: 0,
  notasSaida: 0,
  notasEntrada: 0,
  notasCanceladas: 0,
  itensSaida: 0,
  itensEntrada: 0,
  itensCancelados: 0,
  itensOrfaos: 0,
  itensSemCadastro0200: 0,
  resumosSaida: 0,
  resumosEntrada: 0,
})

const particionar = (conteudo: string): string[] =>
  String(conteudo).split(/\r\n|\r|\n/)

const guardaComum = (campos: string[], min: number): boolean =>
  Boolean(campos) && campos.length >= min

/** Fallback do cabeçalho quando não há data reconhecível (paridade com a v1). */
const cabecalhoPorIndice = (
  campos: string[],
  iNum: number,
  iChave: number,
  iData: number,
  iValor: number,
): { numDoc: string; chave: string; data: string; valor: number } => ({
  numDoc: String(campos[iNum] ?? '').trim(),
  chave: String(campos[iChave] ?? '').trim(),
  data: String(campos[iData] ?? '').trim(),
  valor: spedToNumber(campos[iValor]),
})

/**
 * Lê o cabeçalho da nota localizando a **data** do documento.
 *
 * Melhoria sobre a v1: os índices de `NUM_DOC`/`CHV`/`VL_DOC` variam entre
 * blocos (o `D100` da v1 apontava para o campo `SER`), mas o padrão
 * `NUM_DOC · CHV · DT_DOC · DT_E_S · VL_DOC` é estável — ancorar na primeira
 * data `dd/mm/aaaa` resolve qualquer variação de layout.
 */
const cabecalhoPorData = (
  campos: string[],
  iNum: number,
  iChave: number,
  iData: number,
  iValor: number,
): { numDoc: string; chave: string; data: string; valor: number } => {
  const idx = campos.findIndex((f) => /^\d{2}\/\d{2}\/\d{4}$/.test(String(f).trim()))
  if (idx < 2 || idx + 2 >= campos.length) {
    return cabecalhoPorIndice(campos, iNum, iChave, iData, iValor)
  }
  const valor = campos[idx + 2]
  if (valor === undefined || valor === '') {
    return cabecalhoPorIndice(campos, iNum, iChave, iData, iValor)
  }
  return {
    numDoc: String(campos[idx - 2] ?? '').trim(),
    chave: String(campos[idx - 1] ?? '').trim(),
    data: String(campos[idx] ?? '').trim(),
    valor: spedToNumber(valor),
  }
}

/**
 * Layout dos itens de serviço/transporte (A170/D170).
 *
 * A v1 assumia `VL_ITEM = campos[5]`, o que só é verdadeiro quando o layout não
 * traz `QTD/UNID`. Detectamos: se `campos[6]` não é numérico, ele é a unidade e
 * os campos estão deslocados em +2.
 */
const layoutItem = (
  campos: string[],
): { qtd: number; unid: string; vlItem: number; vlDesc: number } => {
  const u = String(campos[6] ?? '').trim()
  const q = String(campos[5] ?? '').trim()
  const completo = u !== '' && !/^-?\d+([.,]\d+)?$/.test(u) && q !== ''
  if (completo) {
    return {
      qtd: spedToNumber(campos[5]),
      unid: u,
      vlItem: spedToNumber(campos[7]),
      vlDesc: spedToNumber(campos[8]),
    }
  }
  // Layout curto (paridade com a v1): sem QTD/UNID explícitos.
  return { qtd: 1, unid: 'UN', vlItem: spedToNumber(campos[5]), vlDesc: spedToNumber(campos[6]) }
}

const camposPisA170 = (campos: string[]) => ({
  cstPis: String(campos[9] ?? '').trim(),
  vlBcPis: spedToNumber(campos[10]),
  vlPis: spedToNumber(campos[12]),
  cstCofins: String(campos[13] ?? '').trim(),
  vlBcCofins: spedToNumber(campos[14]),
  vlCofins: spedToNumber(campos[16]),
})

/* -------------------------------------------------------------------------- */
/* Passo 1 — cadastro 0200 (comum aos dois layouts)                             */
/* -------------------------------------------------------------------------- */

type Produtos0200 = Map<string, { codigo: string; descricao: string; ncm: string; cest?: string }>

const lerCadastro0200 = (
  linhas: string[],
  stats: SpedStats,
): Produtos0200 => {
  const produtos: Produtos0200 = new Map()
  for (const linha of linhas) {
    if (!linha || linha.length < 3) continue
    const campos = linha.split('|')
    if (!guardaComum(campos, 4) || campos[1] !== '0200') continue
    const codItem = String(campos[2] ?? '').trim()
    if (!codItem) continue
    if (produtos.has(codItem)) continue // primeira ocorrência vence
    stats.registros0200++
    // O 0200 pode trazer NCM com máscara ("0201.10.00"), sufixo EX ou NBS de
    // 9 dígitos — normaliza para os 8 dígitos do NCM, sem pular o produto.
    const digitos = String(campos[8] ?? '').trim().replace(/\D/g, '')
    produtos.set(codItem, {
      codigo: codItem,
      descricao: String(campos[3] ?? '').trim(),
      ncm: digitos.length > 8 ? digitos.slice(0, 8) : digitos,
      cest: String(campos[13] ?? '').trim().replace(/\D/g, '').slice(0, 7) || '',
    })
  }
  return produtos
}

/**
 * Situação do documento (COD_SIT do C100/A100/D100): `02` cancelada, `03`
 * cancelada extemporânea, `04` denegada, `05` inutilizada/numeração
 * inutilizada. Itens desses documentos não representam saída real e são
 * descartados em contador próprio — nunca misturados às entradas.
 */
const SITUACOES_SEM_VALOR = new Set(['02', '03', '04', '05'])

const notaCancelada = (campos: string[]): boolean =>
  SITUACOES_SEM_VALOR.has(String(campos[6] ?? '').trim())

/**
 * Direção da operação: somente `0` explícito é entrada. Qualquer outro valor
 * (incluindo vazio/malformado) é tratado como saída para **não pular**
 * sequência de itens por causa de um C100 complementar sem IND_OPER.
 */
const ehSaida = (indOper: string): boolean => String(indOper ?? '').trim() !== '0'

/* -------------------------------------------------------------------------- */
/* Estabelecimento (0000/0005) — enriquece o cadastro da empresa                */
/* -------------------------------------------------------------------------- */

/** Dados cadastrais do estabelecimento no cabeçalho do SPED. */
export interface EstabelecimentoSped {
  nome: string
  cnpj: string
  ie: string
  im: string
  uf: string
  codMun: string
  fantasia: string
}

/**
 * Extrai o estabelecimento dos registros `0000` (matriz) e `0005`
 * (fantasia). Layout EFD ICMS/IPI e Contribuições:
 * `0000`: REG|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA…
 * `0005`: REG|FANTASIA|CEP|END|NUM|CPL|BAIRRO|FONE|FAX|EMAIL…
 *
 * Leve: varre linha a linha e para no primeiro par encontrado — nunca guarda
 * o arquivo inteiro. Ausência não é erro (best-effort).
 */
export function extrairEstabelecimentoSped(conteudo: string): EstabelecimentoSped | null {
  let nome = ''
  let cnpj = ''
  let ie = ''
  let im = ''
  let uf = ''
  let codMun = ''
  let fantasia = ''
  const texto = String(conteudo ?? '')
  if (!texto) return null
  // Amostra inicial: o cabeçalho mora nas primeiras linhas — evita varrer
  // arquivos de centenas de MB quando o 0000/0005 já apareceu.
  const linhas = texto.split(/\r\n|\r|\n/).slice(0, 5000)
  for (const linha of linhas) {
    if (!linha || linha.length < 6) continue
    if (linha[1] !== '0') continue
    const campos = linha.split('|')
    if (campos[1] === '0000' && !cnpj) {
      nome = String(campos[6] ?? '').trim()
      cnpj = String(campos[7] ?? '').trim().replace(/\D/g, '')
      uf = String(campos[9] ?? '').trim().toUpperCase().slice(0, 2)
      ie = String(campos[10] ?? '').trim()
      codMun = String(campos[11] ?? '').trim()
      im = String(campos[12] ?? '').trim()
    } else if (campos[1] === '0005' && !fantasia) {
      fantasia = String(campos[2] ?? '').trim()
    }
    if (cnpj && fantasia) break
  }
  if (!cnpj) return null
  return { nome, cnpj, ie, im, uf, codMun, fantasia }
}

/* -------------------------------------------------------------------------- */
/* EFD ICMS/IPI                                                                */
/* -------------------------------------------------------------------------- */

export function parseIcmsIpi(conteudo: string): SpedParseado {
  const linhas = particionar(conteudo)
  const stats = statsVazio()
  stats.linhasTotais = linhas.length
  const produtos = lerCadastro0200(linhas, stats)

  const notasSaida = new Map<string, NotaSped>()
  const notasEntrada: NotaSped[] = []
  const itens: ItemSped[] = []
  const resumoC190: ResumoC190[] = []

  let notaAtual: NotaSped | null = null
  let notaAtualEhSaida = false
  let notaAtualCancelada = false

  for (const linha of linhas) {
    if (!linha || linha.length < 3) continue
    const campos = linha.split('|')
    if (!guardaComum(campos, 3)) continue

    switch (campos[1]) {
      case 'C100': {
        stats.registrosC100++
        const indOper = String(campos[2] ?? '').trim()
        const cab = cabecalhoPorData(campos, 8, 9, 10, 12)
        const cancelada = notaCancelada(campos)
        notaAtual = {
          tipo: 'C',
          indOper,
          codPart: String(campos[4] ?? '').trim(),
          numDoc: cab.numDoc,
          chave: cab.chave,
          data: cab.data,
          valorTotal: cab.valor,
        }
        notaAtualCancelada = cancelada
        if (cancelada) {
          stats.notasCanceladas++
          notaAtualEhSaida = false
        } else if (ehSaida(indOper)) {
          stats.notasSaida++
          notaAtualEhSaida = true
          if (notaAtual.numDoc) notasSaida.set(`${notaAtual.numDoc}|${notaAtual.data}`, notaAtual)
        } else {
          stats.notasEntrada++
          notaAtualEhSaida = false
          notasEntrada.push(notaAtual)
        }
        break
      }

      case 'C170': {
        stats.registrosC170++
        if (!notaAtual) {
          stats.itensOrfaos++
          break
        }
        if (notaAtualCancelada) {
          stats.itensCancelados++
          break
        }
        if (!notaAtualEhSaida) {
          stats.itensEntrada++
          break
        }
        const numItem = String(campos[2] ?? '').trim()
        const codItem = String(campos[3] ?? '').trim()
        if (!codItem) {
          stats.itensOrfaos++
          break
        }
        const prod = produtos.get(codItem)
        if (!prod) stats.itensSemCadastro0200++
        itens.push({
          numDoc: notaAtual.numDoc,
          chave: notaAtual.chave,
          data: notaAtual.data,
          numItem,
          codItem,
          descricaoProduto: prod ? prod.descricao : String(campos[4] ?? '').trim() || codItem,
          ncm: prod ? prod.ncm : '',
          cest: prod?.cest ?? '',
          qtd: spedToNumber(campos[5]),
          unid: String(campos[6] ?? '').trim(),
          vlItem: spedToNumber(campos[7]),
          vlDesc: spedToNumber(campos[8]),
          cstIcms: String(campos[10] ?? '').trim(),
          cfop: String(campos[11] ?? '').trim(),
          vlBcIcms: spedToNumber(campos[13]),
          aliqIcms: spedToNumber(campos[14]),
          vlIcms: spedToNumber(campos[15]),
          indOper: '1',
          tipoDoc: 'C',
        })
        stats.itensSaida++
        break
      }

      case 'C190': {
        stats.registrosC190++
        if (!notaAtual || notaAtualCancelada) break
        if (!notaAtualEhSaida) {
          stats.resumosEntrada++
          break
        }
        resumoC190.push({
          numDoc: notaAtual.numDoc,
          chave: notaAtual.chave,
          data: notaAtual.data,
          cstIcms: String(campos[2] ?? '').trim(),
          cfop: String(campos[3] ?? '').trim(),
          aliqIcms: spedToNumber(campos[4]),
          vlOpr: spedToNumber(campos[5]),
          vlBcIcms: spedToNumber(campos[6]),
          vlIcms: spedToNumber(campos[7]),
          vlBcIcmsSt: spedToNumber(campos[8]),
          vlIcmsSt: spedToNumber(campos[9]),
          vlRedBc: spedToNumber(campos[10]),
        })
        stats.resumosSaida++
        break
      }

      default:
        break
    }
  }

  return {
    tipo: 'icmsipi',
    produtos: [...produtos.values()],
    notas: [...notasSaida.values()],
    notasEntrada,
    itens,
    resumoC190,
    stats,
  }
}

/* -------------------------------------------------------------------------- */
/* EFD Contribuições (PIS/COFINS)                                              */
/* -------------------------------------------------------------------------- */

export function parseContribuicoes(conteudo: string): SpedParseado {
  const linhas = particionar(conteudo)
  const stats = statsVazio()
  stats.linhasTotais = linhas.length
  const produtos = lerCadastro0200(linhas, stats)

  const notasSaida = new Map<string, NotaSped>()
  const notasEntrada: NotaSped[] = []
  const itens: ItemSped[] = []

  let notaAtual: NotaSped | null = null
  let notaAtualEhSaida = false
  let notaAtualCancelada = false

  for (const linha of linhas) {
    if (!linha || linha.length < 3) continue
    const campos = linha.split('|')
    if (!guardaComum(campos, 3)) continue

    const reg = campos[1]

    if (reg === 'A100' || reg === 'C100' || reg === 'D100') {
      if (reg === 'A100') stats.registrosA100++
      if (reg === 'C100') stats.registrosC100++
      if (reg === 'D100') stats.registrosD100++

      const tipo = reg[0] as 'A' | 'C' | 'D'
      const indOper = String(campos[2] ?? '').trim()
      const iNum = tipo === 'D' ? 7 : 8
      const cab = cabecalhoPorData(campos, iNum, 9, 10, 12)
      const cancelada = notaCancelada(campos)

      notaAtual = {
        tipo,
        indOper,
        codPart: String(campos[4] ?? '').trim(),
        numDoc: cab.numDoc,
        chave: cab.chave,
        data: cab.data,
        valorTotal: cab.valor,
      }
      notaAtualCancelada = cancelada

      if (cancelada) {
        stats.notasCanceladas++
        notaAtualEhSaida = false
      } else if (ehSaida(indOper)) {
        stats.notasSaida++
        notaAtualEhSaida = true
        // Prefixo do tipo evita colisão entre os blocos A/C/D.
        if (notaAtual.numDoc) {
          notasSaida.set(`${notaAtual.tipo}${notaAtual.numDoc}|${notaAtual.data}`, notaAtual)
        }
      } else {
        stats.notasEntrada++
        notaAtualEhSaida = false
        notasEntrada.push(notaAtual)
      }
      continue
    }

    if (reg === 'A170' || reg === 'C170' || reg === 'D170') {
      if (reg === 'A170') stats.registrosA170++
      if (reg === 'C170') stats.registrosC170++
      if (reg === 'D170') stats.registrosD170++

      if (!notaAtual) {
        stats.itensOrfaos++
        continue
      }
      if (notaAtualCancelada) {
        stats.itensCancelados++
        continue
      }
      if (!notaAtualEhSaida) {
        stats.itensEntrada++
        continue
      }

      const numItem = String(campos[2] ?? '').trim()
      const codItem = String(campos[3] ?? '').trim()
      const descCompl = String(campos[4] ?? '').trim()
      if (!codItem) {
        stats.itensOrfaos++
        continue
      }
      const prod = produtos.get(codItem)
      if (!prod) stats.itensSemCadastro0200++

      const ehC = reg === 'C170'
      const item = ehC
        ? {
            qtd: spedToNumber(campos[5]),
            unid: String(campos[6] ?? '').trim(),
            vlItem: spedToNumber(campos[7]),
            vlDesc: spedToNumber(campos[8]),
            cfop: String(campos[11] ?? '').trim(),
            cstIcms: String(campos[10] ?? '').trim(),
            cstPis: String(campos[25] ?? '').trim(),
            vlBcPis: spedToNumber(campos[26]),
            vlPis: spedToNumber(campos[30]),
            cstCofins: String(campos[31] ?? '').trim(),
            vlBcCofins: spedToNumber(campos[32]),
            vlCofins: spedToNumber(campos[36]),
            baseIcms: spedToNumber(campos[26]),
          }
        : {
            ...layoutItem(campos),
            cfop: '',
            cstIcms: '',
            ...camposPisA170(campos),
            baseIcms: spedToNumber(campos[10]),
          }

      itens.push({
        numDoc: notaAtual.numDoc,
        chave: notaAtual.chave,
        data: notaAtual.data,
        numItem,
        codItem,
        descricaoProduto: prod ? prod.descricao : descCompl || codItem,
        ncm: prod ? prod.ncm : '',
        cest: prod?.cest ?? '',
        qtd: item.qtd,
        unid: item.unid,
        vlItem: item.vlItem,
        vlDesc: item.vlDesc,
        cstIcms: item.cstIcms || item.cstPis || item.cstCofins || '',
        cfop: item.cfop,
        vlBcIcms: item.baseIcms || 0,
        aliqIcms: 0,
        vlIcms: 0,
        cstPis: item.cstPis,
        vlBcPis: item.vlBcPis,
        vlPis: item.vlPis,
        cstCofins: item.cstCofins,
        vlBcCofins: item.vlBcCofins,
        vlCofins: item.vlCofins,
        indOper: '1',
        tipoDoc: notaAtual.tipo,
      })
      stats.itensSaida++
      continue
    }
  }

  return {
    tipo: 'contribuicoes',
    produtos: [...produtos.values()],
    notas: [...notasSaida.values()],
    notasEntrada,
    itens,
    resumoC190: [],
    stats,
  }
}
