import type { Classificacao, Observacao } from '@/domain/entities'

/** Tipo de arquivo SPED detectado. */
export interface SpedTipo {
  tipo: 'reinf' | 'esocial' | 'ecd' | 'ecf' | 'contribuicoes' | 'icmsipi' | 'desconhecido'
  nome: string
  compativel: boolean
  motivo?: string
  codVer?: string
}

export interface SpedStats {
  linhasTotais: number
  registros0200: number
  registrosA100: number
  registrosA170: number
  registrosC100: number
  registrosC170: number
  registrosD100: number
  registrosD170: number
  registrosC190: number
  notasSaida: number
  notasEntrada: number
  notasCanceladas: number
  itensSaida: number
  itensEntrada: number
  itensCancelados: number
  itensOrfaos: number
  itensSemCadastro0200: number
  resumosSaida: number
  resumosEntrada: number
}

export type SpedModo = 'itens' | 'resumo'

export interface ItemSped {
  numDoc: string
  chave: string
  data: string
  numItem: string
  codItem: string
  descricaoProduto: string
  ncm: string
  qtd: number
  unid: string
  vlItem: number
  vlDesc: number
  cstIcms: string
  cfop: string
  vlBcIcms: number
  aliqIcms: number
  vlIcms: number
  cstPis?: string
  vlBcPis?: number
  vlPis?: number
  cstCofins?: string
  vlBcCofins?: number
  vlCofins?: number
  indOper: string
  tipoDoc: string
}

export interface NotaSped {
  tipo: string
  indOper: string
  codPart: string
  numDoc: string
  chave: string
  data: string
  valorTotal: number
}

export interface ResumoC190 {
  numDoc: string
  chave: string
  data: string
  cstIcms: string
  cfop: string
  aliqIcms: number
  vlOpr: number
  vlBcIcms: number
  vlIcms: number
  vlBcIcmsSt: number
  vlIcmsSt: number
  vlRedBc: number
}

export interface SpedParseado {
  tipo: 'icmsipi' | 'contribuicoes'
  produtos: { codigo: string; descricao: string; ncm: string }[]
  notas: NotaSped[]
  notasEntrada: NotaSped[]
  itens: ItemSped[]
  resumoC190: ResumoC190[]
  stats: SpedStats
}

/** Item analisado: original + classificação + impostos estimados. */
export interface ResultadoItem extends ItemSped {
  classificacao: Classificacao
  regraGeral: boolean
  /** `true` quando a classificação veio de reclassificação manual do usuário. */
  manual?: boolean
  redIBS: number
  redCBS: number
  ibs: number
  cbs: number
  totalTributos: number
  carga: number
  anexo: string
  observacoes: Observacao[]
}

/** Grupo do modo resumo (agrupamento CST ICMS × CFOP). */
export interface ResultadoResumo {
  cstIcms: string
  cfop: string
  qtdNotas: number
  totalOperacao: number
  totalBcIcms: number
  totalIcms: number
  descricaoProduto: string
  classificacao: Classificacao
  regraGeral: boolean
  /** `true` quando a classificação veio de reclassificação manual do usuário. */
  manual?: boolean
  redIBS: number
  redCBS: number
  ibs: number
  cbs: number
  totalTributos: number
  carga: number
  anexo: string
  observacoes: Observacao[]
  _isResumo: true
}

export type ResultadoSped = ResultadoItem[] | ResultadoResumo[]

export const ehResumo = (r: ResultadoSped): r is ResultadoResumo[] =>
  r.length > 0 && '_isResumo' in r[0]
