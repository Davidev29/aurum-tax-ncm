import type { Documento } from '../constants'

/* ---------------------------------------------------------------------------
   Registros persistidos (shape espelha a base normalizada de `public/base`)
   --------------------------------------------------------------------------- */

/** Referência oficial CST × cClassTrib (arquivo `classificacao-tributaria.json`). */
export interface ReferenciaCClassTrib {
  /** Chave composta `cst|cClassTrib` (keyPath da store `referencia`). */
  id: string
  cst: string
  cstDescricao: string
  cClassTrib: string
  descricao: string
  pRedIBS: number
  pRedCBS: number
  tipoAliquota: string | null
  anexo: string | null
  urlLegislacao: string | null
  exigeTributacao: boolean
  reducaoBC: boolean
  reducaoAliquota: boolean
  transferenciaCredito: boolean
  diferimento: boolean
  monofasica: boolean
  creditoPresumidoZFM: boolean
  ajusteCompetencia: boolean
  tributacaoRegular: boolean
  creditoPresumido: boolean
  estornoCredito: boolean
  monoNormal: boolean
  monoRetencao: boolean
  monoRetida: boolean
  monoDiferimentoCombustivel: boolean
  simplesReceitaBruta: string | null
  regimeContribuicaoSocial: string | null
  impostoBensServicos: string | null
  docs: DocumentosHabilitados
}

export type DocumentosHabilitados = Record<Documento, boolean>

/** Linha da tabela auxiliar CST IBS/CBS. */
export interface TabelaCst {
  codigo: string
  descricao: string
  indIBSCBS: boolean
  indIBSCBSMono: boolean
  indReducao: boolean
  indDiferimento: boolean
  indTransferenciaCredito: boolean
  docs: DocumentosHabilitados
}

/** Linha da tabela auxiliar cClassTrib (chave composta `cst|cClassTrib`). */
export interface TabelaCstClassTrib {
  id: string
  cst: string
  cClassTrib: string
  nome: string
  descricao: string
  lcRedacao: string | null
  lcRef: string | null
  tipoAliquota: string | null
  pRedIBS: number | null
  pRedCBS: number | null
  indRedutorBC: number | null
  indTribRegular: number | null
  indCredPres: number | null
  indMono: number | null
  indMonoReten: number | null
  indMonoRet: number | null
  indMonoDif: number | null
  creditoPara: string | null
  inicioVigencia: string | null
  fimVigencia: string | null
  atualizadoEm: string | null
}

/** Vínculo NCM × CST × cClassTrib da Reforma. */
export interface VinculoNcm {
  id: string
  codigo: string
  codigoFormatado: string
  cst: string
  cClassTrib: string
  baseLegal: string
  reducao: number | null
  aliquotaIBS: number | null
  aliquotaCBS: number | null
  descricao: string
  documentos: string
}

/** Vínculo NBS (9 dígitos) — mantido na base para consultas futuras. */
export interface VinculoNbs {
  id: string
  codigo: string
  cst: string
  cClassTrib: string
  baseLegal: string
  aliquotaIBS: number | null
  aliquotaCBS: number | null
  descricao: string
}

/**
 * Linha da tabela de Classificação de Produtos de um DFe (CFF
 * `ConsultaClassificacaoProduto?sistema=NFCom|NFAg|NF3e|NFGas`).
 *
 * É o "permitido × negado" por sistema: indica se um `cClassTrib` pode ser
 * usado naquele documento fiscal e em qual vigência. `permitido === null`
 * = a fonte não informa o flag (só a presença na tabela).
 */
export interface ClassificacaoProdutoSistema {
  /** Chave `sistema|cClassTrib` (keyPath da store `classificacaoProduto`). */
  id: string
  /** NFCom | NFAg | NF3e | NFGas */
  sistema: string
  cClassTrib: string
  descricao: string | null
  permitido: boolean | null
  /** `explicita` (flag Sim/Não no JSON) ou `presenca` (linha existe na tabela). */
  confianca: 'explicita' | 'presenca'
  /** Demais flags Sim/Não da linha (regras de validação do MOC). */
  flags: Record<string, boolean>
  inicioVigencia: string | null
  fimVigencia: string | null
  /** Quando a linha foi sincronizada/importada. */
  sincronizadoEm: string
}

/** Entrada da tabela NCM/SH vigente (nomenclatura). */
export interface NomenclaturaNcm {
  codigo: string
  codigoOriginal: string
  descricao: string
  dataInicio: string | null
  dataFim: string | null
  ato: string | null
  /** Ato que extinguiu o NCM (Tipo_Ato_Fim + Numero/Ano). Null/ausente = vigente. */
  atoFim?: string | null
}

/* ---------------------------------------------------------------------------
   Tabelas auxiliares do usuário
   --------------------------------------------------------------------------- */

export interface Empresa {
  id?: number
  razaoSocial: string
  cnpj: string
  fantasia: string
  criadoEm: string
  /** Inscrição estadual — vem do XML (emit/IE) ou edição manual. */
  ie?: string
  /** Inscrição municipal — vem do XML (emit/IM) ou edição manual. */
  im?: string
  /**
   * Regime tributário — detectado via CRT/CSOSN dos XMLs. `undefined`
   * = ainda desconhecido (a UI não afirma nada nesse caso).
   */
  regimeTributario?: 'simples' | 'mei' | 'normal'
  endereco?: string
  cidade?: string
  uf?: string
  cep?: string
  telefone?: string
  email?: string
}

export interface Emitente {
  razaoSocial: string
  cnpj: string
  ie: string
  endereco: string
  cidade: string
  cep: string
  telefone: string
  email: string
  site: string
  cor: string
  rodape: string
  logo: string | null
}

export const EMITENTE_PADRAO: Emitente = {
  razaoSocial: '',
  cnpj: '',
  ie: '',
  endereco: '',
  cidade: '',
  cep: '',
  telefone: '',
  email: '',
  site: '',
  cor: '#0f215c',
  rodape: '',
  logo: null,
}

export interface TabelaAuxiliarSimples {
  codigo: string
  descricao: string
  tipo?: 'Entrada' | 'Saída' | 'Outros'
}

/** Snapshot congelado da classificação no produto (D07). */
export interface ClassificacaoSnapshot {
  codigo: string
  codigoFormatado: string
  cst: string
  cClassTrib: string
  descricao: string
  baseLegal: string
  pRedIBS: number | null
  pRedCBS: number | null
  anexo: string | null
  classificacao: string
  /** Reclassificação manual do usuário (quando houver) — congela fonte/justificativa. */
  manual?: ReclassificacaoManual | null
}

/** Reclassificação manual feita pelo usuário para um NCM sem vínculo oficial. */
export interface ReclassificacaoManual {
  /** NCM de 8 dígitos (keyPath da store). */
  ncm: string
  cst: string
  cClassTrib: string
  /** Descrição/justificativa livre do usuário. */
  descricao: string
  /** De onde tirou a informação (ex.: "art. X da LC 214/2025"). */
  fonteDescricao: string
  /** Link da lei / fonte. Abre em nova aba. */
  fonteUrl: string
  criadoEm: string
  atualizadoEm: string
}

/** Entrada append-only do log imutável. Nunca atualizada nem deletada pela UI. */
export interface AuditLog {
  id?: number
  quando: string
  tabela: string
  chave: string
  operacao: 'criar' | 'atualizar' | 'excluir'
  autor: string
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
}

/** CEST (7 dígitos) — informativo, não altera a Reforma. */
export interface TabelaCest {
  codigo: string
  descricao: string
  ncm?: string
}

export interface Produto {
  id?: number
  empresaId: number | null
  codigo: string
  nome: string
  ncm: string
  cfop: string
  cstIcms: string
  pis: string
  cofins: string
  quantidade: number
  valorUnitario: number
  cstReforma: string
  cClassTrib: string
  regraGeral: boolean
  /** `true` quando a classificação vigente veio de reclassificação manual. */
  classificacaoManual?: boolean
  classificacaoSnapshot: ClassificacaoSnapshot
  baseLegal?: string
  criadoEm: string
  atualizadoEm: string
}

/* ---------------------------------------------------------------------------
   Classificação resolvida (saída do motor)
   --------------------------------------------------------------------------- */

/** Espelha o sub-objeto `resumo` do JSON original (SPEC R2.10–R2.13). */
export interface ResumoClassificacao {
  descricaoCClassTrib: string
  percentualReducaoIBS: number
  percentualReducaoCBS: number
  anexo: string | null
  urlLegislacao: string | null
  documentosHabilitados: Partial<DocumentosHabilitados> | null
}

/** Referência legal lida pelos cartões de classificação. */
export interface ReferenciaTributaria {
  lcRef: string
  reducaoAliquota: boolean | string | null
  reducaoBcCst: boolean | string | null
  monofasica: boolean | string | null
  creditoPresumido: boolean | string | null
  /**
   * Flag oficial `Diferimento` da base `classificacao-tributaria.json`
   * (tabela de referência CST × cClassTrib). É a fonte primária para
   * decidir diferimento, junto com CST 510/515 e `cstDetalhes.indDiferimento`.
   * `null` = base sem informação (pseudo-objetos de snapshot).
   */
  diferimento: boolean | null
  anexo: string | null
  urlLegislacao: string | null
  documentos: Partial<DocumentosHabilitados>
}

/**
 * Classificação resolvida — unifica o vínculo importado e a regra geral.
 * `regraGeral === true` apenas quando produzida pelo fallback (SPEC R2.6).
 * `manual !== null` indica reclassificação feita pelo usuário (isenção do sistema).
 */
export interface Classificacao {
  id: string
  codigo: string
  codigoFormatado: string
  cst: string
  cClassTrib: string
  baseLegal: string
  descricao: string
  vinculo: VinculoNcm | null
  cstDetalhes: TabelaCst | null
  cstClassTribDetalhes: TabelaCstClassTrib | null
  referencia: ReferenciaTributaria | null
  resumo: ResumoClassificacao
  regraGeral: boolean
  manual?: ReclassificacaoManual | null
  /**
   * Revogação que rebaixou este item para regra geral (anexo/cct revogado).
   * Reduções do vínculo original NÃO valem — ver `revogacao.ts`.
   */
  revogado?: import('../services/revogacao').Revogacao | null
}

/** Resultado de cálculo tributário de uma base (LC 214/2025).
 *
 * Mecânica da Reforma: a redução incide sobre a **alíquota** —
 * `aliq = ref × (1 − red/100)` e `tributo = base × aliq/100`.
 * `base`/`valorOperacao` = valor cheio da operação (qtd × valor unitário).
 * `bcIBS`/`bcCBS` = base cheia (iguais a `base`; sem redução de base).
 * `aliqIBS`/`aliqCBS` = alíquotas efetivas já reduzidas;
 * `refIBS`/`refCBS` = referências cheias.
 */
export interface ResultadoCalculo {
  base: number
  valorOperacao: number
  bcIBS: number
  bcCBS: number
  redIBS: number
  redCBS: number
  refIBS: number
  refCBS: number
  aliqIBS: number
  aliqCBS: number
  vIBS: number
  vCBS: number
  total: number
  carga: number
}

/** Observação legal exibida nos cartões. */
export interface Observacao {
  titulo: string
  texto: string
  cor: 'emerald' | 'amber' | 'slate' | 'violet' | 'red'
  link?: string
  /** Segundo parágrafo opcional (ex.: o "Verifique…" do aviso in natura). */
  adendo?: string
  /** Rótulo do link — quando ausente, usa `titulo`. */
  rotuloLink?: string
}
