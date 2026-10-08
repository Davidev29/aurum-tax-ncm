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
  /** Redução de alíquota da origem (ex.: 0.6 = 60%) — auditoria; o cálculo usa a referência. */
  reducao: number | null
  aliquotaIBS: number | null
  aliquotaCBS: number | null
  descricao: string
  /** DFes relacionados da origem (ex.: `NFE, NFSE`) — chips de documento. */
  documentos: string
}

/**
 * Linha CNAE × Anexo do Simples Nacional (Phase 7, arquivo vivo
 * `CNAE X ANEXO.json`). ATENÇÃO: `anexos` aqui são os Anexos I–V do
 * **Simples Nacional** (com Fator R), NÃO os anexos da LC 214/2025.
 * A UI deve rotular sempre "Anexo Simples".
 */
export interface CnaeAnexo {
  /** CNAE 7 dígitos (`0111301`); keyPath da store `cnae`. */
  codigo7: string
  /** Formato oficial `XXXX-X/XX` (ex.: `0111-3/01`). */
  codigoFormatado: string
  descricao: string
  /** `Permitido` | `Permitido com ressalvas` | `Depende da atividade`. */
  situacao: 'Permitido' | 'Permitido com ressalvas' | 'Depende da atividade'
  /** Anexos do Simples (`['III','V']` para `"III / V"`). */
  anexos: string[]
  /** Fator R aplicável (Anexo III vs V). */
  fatorR: boolean
}

/** Cache de consulta por CNPJ (Phase 7, BrasilAPI + TTL 30 dias). */
export interface ConsultaCnpj {
  /** CNPJ 14 dígitos; keyPath da store `consultasCnpj`. */
  cnpj: string
  razaoSocial: string
  fantasia: string
  porte: string | null
  situacao: string | null
  opcaoSimples: boolean | null
  cnaePrincipal: string | null
  cnaesSecundarios: string[]
  quando: string
}

/* ---------------------------------------------------------------------------
   Phase 9 (09-01) — ponte CNAE → NBS (fonte não-oficial qualclasstrib).
   Os links são CANDIDATOS: alíquota/benefício só do resolvedor oficial
   (`resolverClassificacoesNbs` + `calcularTributos`). Sem lastro no
   resolvedor → `sem-lastro-reforma`, nunca redução inventada.
   --------------------------------------------------------------------------- */

/** Origem de um link CNAE → NBS dentro do arquivo ponte. */
export type FonteLinkCnaeNbs = 'por_codigo' | 'triangulacao'

/**
 * Link CNAE → NBS (Phase 9, arquivo ponte `CNAE X NBS.qualclasstrib.json`).
 * Dedupe por `cnae7|nbs`. CNAEs com código divergente do oficial (55 códigos
 * legados da ponte) entram aqui mesmo assim — a divergência é marcada no
 * template consolidado, não no link.
 */
export interface CnaeNbsLink {
  /** Chave `++id` (auto-incremento, Dexie). */
  id?: number
  /** CNAE 7 dígitos (`0161001`); índice de busca. */
  cnae7: string
  /** Formato oficial `XXXX-X/XX` (ex.: `0161-0/01`). */
  cnae: string
  /** NBS 9 dígitos (`118032100`). */
  nbs: string
  /** De onde veio o par (sempre `por_codigo`; triangulação só valida). */
  fonte: FonteLinkCnaeNbs
}

/**
 * Relação LC 116 → NBS (Phase 9, `fallback-relations.json` da ponte).
 * Triangulação fina LC × NBS × cClassTrib + descrições (`nbsd`/`cctd`/`lcd`).
 * Fidelidade à origem: 6 linhas vêm sem NBS e 12 sem cct (guardadas com
 * `''` — nunca participam de join, só de auditoria/descrição).
 */
export interface LcNbsRelation {
  /** Chave `++id` (auto-incremento, Dexie). */
  id?: number
  /** LC 116 (`01.01`); índice de busca. */
  lc: string
  /** NBS 9 dígitos (`''` quando a origem não informa). */
  nbs: string
  /** cClassTrib 6 dígitos (`''` quando a origem não informa). */
  cct: string
  descricaoLc: string
  descricaoNbs: string
  descricaoCct: string
  /** Colunas operacionais da origem (variantes `indop` por local da prestação). */
  onerosa: string
  exterior: string
  indop: string
  local: string
}

/** De onde saiu a descrição consolidada (precedência: oficial > qualclasstrib > auxiliar). */
export type FonteDescricaoCnaeNbs = 'oficial' | 'qualclasstrib' | 'auxiliar'

/** Uma NBS vinculada dentro do template consolidado. */
export interface NbsVinculadaTemplate {
  /** NBS 9 dígitos. */
  nbs: string
  /** Descrição conferida (precedência oficial > qualclasstrib > auxiliar). */
  descricao: string | null
  /** Qual fonte venceu a precedência (`null` quando sem descrição). */
  fonteDescricao: FonteDescricaoCnaeNbs | null
  /** `true` quando nenhuma fonte tem descrição (fallback honesto). */
  semDescricao: boolean
}

/** Divergência entre fontes — com ela, NÃO se consolida (só se marca). */
export interface DivergenciaCnae {
  /** Código ausente da base oficial (55 legados) ou texto divergente (41). */
  tipo: 'codigo-ausente-oficial' | 'descricao-divergente'
  detalhe: string
}

/**
 * Template consolidado por CNAE (Phase 9, store `classificacoesConsolidadas`,
 * keyPath `cnae7`). Reutilizável em menu + CNPJ + chat (09-03..09-05).
 * `beneficiosReforma` nasce vazio na build e é preenchido em runtime pelo
 * resolvedor oficial com `anoReferencia` (09-02) — nunca inventado na base.
 */
export interface ClassificacaoConsolidada {
  /** CNAE 7 dígitos; keyPath da store. */
  cnae7: string
  codigoFormatado: string
  /** Descrição vencedora da precedência oficial > qualclasstrib > auxiliar. */
  descricao: string
  fonteDescricao: FonteDescricaoCnaeNbs
  /** Anexos I–V do SIMPLES NACIONAL (não da LC 214/2025). */
  anexoSimples: string[]
  /** `Permitido` | `Permitido com ressalvas` | `Depende da atividade`. */
  situacao: 'Permitido' | 'Permitido com ressalvas' | 'Depende da atividade'
  fatorR: boolean
  /** Texto de vedação derivado da Situação (sempre presente — invariante A). */
  vedacoes: string[]
  /** NBS vinculadas (vazio fora dos 508 / bens). */
  nbsVinculadas: NbsVinculadaTemplate[]
  /** Preenchido em runtime pelo resolvedor (09-02); vazio na base. */
  beneficiosReforma: unknown[]
  /** Divergência de código → marcada, NÃO consolidada. */
  divergencia: DivergenciaCnae | null
  /** `mapeado` (508) | `sem-mapeamento` (fora-508) | `divergencia` (55). */
  estadoNbs: 'mapeado' | 'sem-mapeamento' | 'divergencia'
}

/**
 * Linha da tabela de Classificação de Produtos de um DFe (CFF
 * `ConsultaClassificacaoProduto?sistema=NFCom|NFAg|NF3e|NFGas`).
 *
 * É o "permitido × negado" por sistema: indica se um `cClassTrib` pode ser
 * usado naquele documento fiscal e em qual vigência. `permitido === null`
 * = a fonte não informa o flag (só a presença na tabela).
 *
 * Formato legado (suposto): usado pelo sync quando o endpoint devolve linhas
 * chaveadas por cClassTrib. Os arquivos reais da API vêm chaveados por
 * `codClassProd` (ver `ProdutoDfe`) — esses vão para a store `produtosDfe`.
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

/**
 * Linha da tabela de Anexos da LC 214 (CFF `anexos` — formato real da API).
 *
 * Liga um NCM (8 dígitos) ou NBS (9 dígitos) a um anexo com permissão explícita.
 * Linhas com `codNcmNbs: "Sem código"` viram item de catálogo do anexo
 * (`codigo: null`): valem como documentação do anexo, sem vínculo com NCM/NBS.
 */
export interface AnexoNcm {
  /** Chave `${codigo ?? 'sem-codigo'}|${nroAnexo}|${indice}` (keyPath da store `anexos`). */
  id: string
  /** Dígitos do código, ou `null` quando a fonte informa "Sem código". */
  codigo: string | null
  /** NCM | NBS | null (quando sem código). */
  tipo: 'NCM' | 'NBS' | null
  /** Permitido × Não Permitido × sem informação (NBS nunca informa). */
  permissao: 'permitido' | 'negado' | null
  nroAnexo: number
  nroItemAnexoLei: number | null
  descrAnexo: string
  descrItemAnexo: string | null
  descrCondicao: string | null
  descrExcecao: string | null
  observacao: string | null
  inicioVigencia: string | null
  fimVigencia: string | null
}

/**
 * Linha do catálogo de produtos de um DFe (CFF
 * `ConsultaClassificacaoProduto?sistema=*` — formato real da API).
 *
 * Eixo **produto** (`codClassProd` de 7 dígitos), não cClassTrib: o mesmo código
 * pode existir em sistemas diferentes com descrições diferentes, por isso o
 * sistema de origem é parte da chave e precisa ser informado na importação
 * (o arquivo não declara o próprio sistema).
 */
export interface ProdutoDfe {
  /** Chave `sistema|codClassProd` (keyPath da store `produtosDfe`). */
  id: string
  /** NFCom | NFAg | NF3e | NFGas (informado na importação). */
  sistema: string
  codClassProd: string
  codGrupo: string | null
  descrGrupo: string | null
  descricao: string
  tipoPrestacao: string | null
  /** Demais flags da linha (regras de validação do MOC). */
  flags: Record<string, boolean>
  /** Quando a linha foi importada. */
  sincronizadoEm: string
}

/**
 * Regra de crédito presumido IBS/CBS (CFF `credPresumido` — formato real).
 * Exibida como informação adicional quando a classificação do NCM indica
 * crédito presumido (`referencia.creditoPresumido`).
 */
export interface CreditoPresumido {
  cod: number
  descricao: string
  indIbs: boolean
  indCbs: boolean
  apropriaDfe: boolean
  apropriaEvento: boolean
  condSuspensiva: boolean
  deduz: boolean
  iniVigIbs: string | null
  fimVigIbs: string | null
  iniVigCbs: string | null
  fimVigCbs: string | null
}

/**
 * Local da operação/fornecimento (CFF `indOper` — formato real).
 * Tabela de referência exibida nas tabelas oficiais (sem chave com o NCM).
 */
export interface LocalOperacao {
  cod: string
  nome: string
  dispLegal: string | null
  localOperacao: string | null
  localFornec: string | null
  caractFornec: string | null
  publicacao: string | null
  iniVig: string | null
  fimVig: string | null
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
 * Herança por família: quando não há vínculo exato de 8 dígitos, o motor
 * pode herdar o enquadramento dos irmãos (mesma subposição/posição/capítulo)
 * — ver `regras-hierarquicas.ts`. `null` = classificação exata ou regra geral.
 */
export interface HerancaFamilia {
  /** Nível que originou a herança. */
  nivel: 'subposicao' | 'posicao' | 'capitulo'
  /** Prefixo de origem (`071333`, `0713`, `07`). */
  prefixo: string
  /** Irmãos vinculados unânimes que lastreiam a herança. */
  irmaosVinculados: number
  /** NCMs vigentes no prefixo (denominador da cobertura). */
  vigentesNoPrefixo: number
  /** Origem legível (trilha/auditoria). */
  origem: 'familia-SH6' | 'familia-SH4' | 'familia-capitulo' | 'capitulo-curado'
  /** Confiança da herança (`alta` = cobertura total; `media` = parcial). */
  confianca: 'alta' | 'media'
  /** `true` quando exige confirmação do usuário antes de operar. */
  aConfirmar: boolean
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
  vinculo: VinculoNcm | VinculoNbs | null
  cstDetalhes: TabelaCst | null
  cstClassTribDetalhes: TabelaCstClassTrib | null
  referencia: ReferenciaTributaria | null
  resumo: ResumoClassificacao
  regraGeral: boolean
  /**
   * Legenda do serviço (NBS 9 dígitos) lida da ponte LC 116 → NBS
   * (`lcNbs`: `descricaoNbs` + item LC + `descricaoLc`). Preenchida tanto no
   * vínculo oficial quanto na regra geral — é o "o que é este serviço",
   * separado do significado tributário (`resumo.descricaoCClassTrib`).
   * `null` = NBS sem legenda na base (ex.: código inexistente).
   */
  detalheNbs?: { lc: string; descricaoNbs: string; descricaoLc: string } | null
  manual?: ReclassificacaoManual | null
  /**
   * Herança por família (NCM sem vínculo exato, enquadramento herdado dos
   * irmãos da mesma subposição/posição/capítulo). Ausente = exata/manual/
   * regra geral pura.
   */
  heranca?: HerancaFamilia | null
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
