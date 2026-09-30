import type { Classificacao, NomenclaturaNcm, Observacao } from '@/domain/entities'

/** Direção da nota em relação à empresa ativa (decidida pelo CNPJ). */
export type DirecaoNota = 'entrada' | 'saida' | 'quarentena'

/** Item de NF-e/NFC-e extraído do XML (`det/prod` + `det/imposto`). */
export interface ItemNotaXml {
  chave: string
  numItem: string
  codProd: string
  descricao: string
  ncm: string
  /** CEST (7 dígitos, `prod/CEST`) — informativo, não altera a Reforma. */
  cest?: string
  cfop: string
  /** CST (regime normal) ou CSOSN (Simples) do ICMS — `CST`/`CSOSN` do grupo do item. */
  cstIcms: string
  qtd: number
  unid: string
  vlUnit: number
  vlTotal: number
  vlDesc: number
  /** Base de cálculo do ICMS (`vBC` do grupo do item), se destacada. */
  vBcIcms?: number
  /** Alíquota do ICMS em % (`pICMS`), quando o XML a informa. */
  pIcms?: number
  /** Valor do ICMS destacado no item (`vICMS`). */
  vlIcms: number
  cstPis: string
  cstCofins: string
  /** Valor de PIS destacado no item — tag `vPIS` do grupo PIS. */
  vPis?: number
  /** Valor de COFINS destacado no item — tag `vCOFINS` do grupo COFINS. */
  vCofins?: number
  /**
   * Reforma — grupo `imposto/IBSCBS` do item (NT 2025.002, opcional em 2025 e
   * com valor jurídico a partir de 01/01/2026). Vazio/zero quando a nota não
   * destaca IBS/CBS (XML antigo ou emitente sem preenchimento).
   * Opcionais para compatibilidade com notas gravadas antes da Reforma.
   */
  cstIbsCbs?: string
  cClassTribIbsCbs?: string
  /** Base de cálculo comum do IBS/CBS (`gIBSCBS/vBC`), se informada. */
  vBcIbsCbs?: number
  /** IBS destacado = `gIBSUF/vIBSUF + gIBSMun/vIBSMun` (ou `gIBS/vIBS`). */
  vIbsItem?: number
  /** CBS destacada = `gCBS/vCBS`. */
  vCbsItem?: number
}

/** Nota fiscal parseada — sem vínculo de empresa/direção (decididos no caso de uso). */
export interface NotaXmlBruta {
  chave: string
  numero: string
  serie: string
  modelo: string
  natOp: string
  /** Data de emissão em ISO `aaaa-mm-dd` (pronta para índice e filtro). */
  dataEmissao: string
  emitCnpj: string
  emitNome: string
  /**
   * CRT do emitente (`emit/CRT`): `1` Simples, `2` Simples excesso sublimite,
   * `3` Regime Normal, `4` MEI. Vazio quando o XML não traz (NFC-e antigas,
   * XMLs resumidos) — aí o regime é inferido pelos CSOSN dos itens.
   */
  emitCrt: string
  /** IE/IM do emitente — usados para completar o cadastro da empresa. */
  emitIe: string
  emitIm: string
  emitEndereco: string
  emitCidade: string
  emitUf: string
  destDoc: string
  destNome: string
  /** IE do destinatário — completa o cadastro quando ele é a empresa ativa. */
  destIe: string
  valorProdutos: number
  valorTotal: number
  /**
   * Totais de IBS/CBS **destacados no XML** (soma dos itens / grupo
   * `IBSCBSTot` quando presente). Diferem da estimativa da Reforma
   * (`totalIBS/totalCBS`) — o confronto é exibido no detalhe da nota.
   * Opcionais para compatibilidade com notas gravadas antes da Reforma.
   */
  totalIbsXml?: number
  totalCbsXml?: number
  totalCreditoIbsCbsXml?: number
  itens: ItemNotaXml[]
}

/** Nota persistida: bruta + empresa + direção + análise da Reforma. */
export interface NotaXml extends NotaXmlBruta {
  id?: number
  empresaId: number
  direcao: DirecaoNota
  /** Caminho relativo do XML em disco (`<cnpj>/<chave>.xml`) ou `null` no modo web. */
  arquivo: string | null
  /** Conteúdo integral — somente modo web (sem Electron); no app vai ao disco. */
  xmlConteudo: string | null
  refIBS: number
  refCBS: number
  totalIBS: number
  totalCBS: number
  totalTributos: number
  importadoEm: string
  itensAnalisados: ResultadoItemNfe[]
}

/** Item analisado: original + classificação + impostos estimados. */
export interface ResultadoItemNfe extends ItemNotaXml {
  classificacao: Classificacao
  regraGeral: boolean
  /** `true` quando a classificação veio de reclassificação manual do usuário. */
  manual?: boolean
  /** `true` quando o NCM do XML tinha >8 dígitos e foi truncado (NBS/EX). Exige conferência. */
  ncmTruncado?: boolean
  /** NCM como veio no XML, antes da normalização (auditoria). */
  ncmOriginal?: string
  /** `true` quando o NCM é inválido (<>8 dígitos após normalização). */
  ncmInvalido?: boolean
  /** Quantas classificações oficiais existem para este NCM (1 = unívoco, >1 = ambíguo). */
  opcoesClassificacao?: number
  redIBS: number
  redCBS: number
  ibs: number
  cbs: number
  totalTributos: number
  carga: number
  anexo: string
  observacoes: Observacao[]
  /** Nomenclatura vigente — `dataFim` preenchida = NCM extinto. */
  nomenclatura?: NomenclaturaNcm | null
}

/** Filtros da tela de notas (todos opcionais). */
export interface FiltrosNfe {
  texto: string
  fornecedor: string
  direcao: 'todas' | DirecaoNota
  cfop: string
  /** CST/CSOSN do ICMS do item — exato, sem caixa (ex.: `00`, `102`). */
  cstIcms: string
  inicio: string
  fim: string
  /** Filtros da Reforma (reativos, avaliados por item). */
  /**
   * cClassTrib contém (só dígitos, ex.: `000001`) — casa com o destacado no
   * XML (`imposto/IBSCBS`) **ou** com o da classificação do sistema.
   */
  cClassTrib: string
  /**
   * CST da Reforma exato, sem caixa (ex.: `000`) — casa com o destacado no
   * XML **ou** com o da classificação do sistema (a tabela exibe o do XML
   * primeiro, por isso o filtro precisa olhar os dois).
   */
  cstReforma: string
  /** Anexo/benefício: '' todas, `isento` crédito integral, `0`, `60`, `30`. */
  reducao: string
}

export const FILTROS_NFE_VAZIOS: FiltrosNfe = {
  texto: '',
  fornecedor: '',
  direcao: 'todas',
  cfop: '',
  cstIcms: '',
  inicio: '',
  fim: '',
  cClassTrib: '',
  cstReforma: '',
  reducao: '',
}

/** Data local em ISO `aaaa-mm-dd` (sem o deslocamento UTC do `toISOString`). */
function isoLocal(d: Date): string {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${a}-${m}-${dia}`
}

/**
 * Período padrão da tela — **últimos 30 dias** (hoje − 29 dias até hoje).
 * Usado na abertura do módulo e no "Limpar", para a lista nunca abrir vazia
 * ou com o histórico inteiro sem recorte.
 */
export function periodoUltimos30Dias(ref = new Date()): { inicio: string; fim: string } {
  const fim = isoLocal(ref)
  const ini = new Date(ref)
  ini.setDate(ini.getDate() - 29)
  return { inicio: isoLocal(ini), fim }
}

/** Filtros iniciais da tela: vazios + período dos últimos 30 dias. */
export function filtrosIniciaisNfe(ref = new Date()): FiltrosNfe {
  return { ...FILTROS_NFE_VAZIOS, ...periodoUltimos30Dias(ref) }
}

/** Linha do ranking de fornecedores por crédito (sobre as entradas). */
export interface CreditoFornecedor {
  cnpj: string
  nome: string
  qtdNotas: number
  totalEntradas: number
  creditoIBS: number
  creditoCBS: number
  creditoTotal: number
  /**
   * Fornecedor Simples/MEI (CRT ou CSOSN das notas): os valores são mera
   * estimativa — **não há transferência de crédito de IBS/CBS**.
   */
  simples: boolean
}

/** Resultado de uma importação em lote. */
export interface ResumoImportacaoXml {
  novas: number
  duplicadas: number
  quarentena: number
  erros: { arquivo: string; motivo: string }[]
}
