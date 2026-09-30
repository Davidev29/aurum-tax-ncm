/**
 * Classificador por descrição livre — etapa 1 (pura, sem IndexedDB).
 *
 * Papel: transformar "boi vivo Nelore para reprodução" em sinais fiscais
 * auditáveis (palavras-chave, capítulo prioritário, consultas expandidas,
 * RGI aplicável, perguntas complementares). A etapa 2
 * (`src/application/classificacao-inteligente.ts`) ancora cada candidato no
 * NCM vigente + vínculo oficial da Reforma — **nunca inventa NCM nem
 * benefício**: a base oficial (`public/base/`, nível Deus) é a única fonte
 * de NCMs, CST/cClassTrib, anexos e base legal.
 *
 * Todas as comparações usam `normalizarBusca` (sem acento/caixa/pontuação).
 */
import { normalizarBusca, pareceCodigoNcm, tokenizarBusca } from './busca-texto'

/** Entrada do classificador: descrição livre + contexto opcional. */
export interface EntradaDescricao {
  descricao: string
  destinacao?: string
  composicao?: string
  uso?: string
}

export type Confianca = 'alta' | 'media' | 'baixa'

/** Sinais fiscais extraídos do texto (ids estáveis, usados em testes). */
export type SinalFiscal =
  | 'VIVO'
  | 'REPRODUTOR'
  | 'ABATE'
  | 'SEMENTE_PLANTIO'
  | 'RACAO_ANIMAL'
  | 'SAL_ADICIONADO'
  | 'HORTICOLA'
  | 'CARNE'
  | 'CEREAL'
  | 'DISPOSITIVO_MEDICO'
  | 'MEDICAMENTO'
  | 'COZIDO'
  | 'IN_NATURA'

export interface AnaliseDescricao {
  /** Texto combinado (descrição + contexto), normalizado. */
  textoNormalizado: string
  /** Tokens úteis (sem stopwords). */
  tokens: string[]
  /** Sinais fiscais detectados. */
  sinais: SinalFiscal[]
  /** Ambiguidades / condições de risco que pedem atenção. */
  ambiguidades: string[]
  /** Capítulos NCM prioritários para desempate (ex.: ['01']). */
  capitulosPrioritarios: string[]
  /** Variações de consulta para a busca textual oficial. */
  consultasExpandidas: string[]
  /** RGIs citadas na justificativa. */
  rgiAplicaveis: string[]
  /** `true` quando o texto é insuficiente para classificar. */
  insuficiente: boolean
}

/** Palavras sem valor fiscal, descartadas dos tokens úteis. */
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na',
  'nos', 'nas', 'e', 'ou', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as',
  'tipo', 'produto', 'mercadoria', 'item', 'coisa', 'et', 'se', 'que', 'por',
])

/**
 * Sinônimos/inferências: termo do dia a dia → vocabulário da nomenclatura.
 * Chave e valor já normalizados (sem acento). A inferência só EXPANDE a
 * consulta — a prova continua sendo o match na descrição oficial.
 *
 * ATENÇÃO (armadilha do AND): a busca exige TODOS os termos no caminho do
 * NCM, então cada expansão deve ser termo ÚNICO presente literalmente no
 * texto oficial — de preferência o radical comum às flexões
 * (`bovin` casa com bovino/bovina/bovinos; `suin` com suíno/suína/suínos).
 * Multi-termo só quando os termos coocorrem no oficial (ex.: `cães` + `gatos`
 * em 2309.10.00). Termo sem correspondente oficial (ex.: `hibrido`, `pet`)
 * fica sem entrada e cai no fallback de tolerância a ruído.
 */
const SINONIMOS: Record<string, string> = {
  boi: 'bovin',
  vaca: 'bovin',
  novilho: 'bovin',
  novilha: 'bovin',
  bezerro: 'bovin',
  gado: 'bovin',
  nelore: 'bovin',
  zebu: 'bovin',
  bufalo: 'bufalo',
  porco: 'suin',
  porca: 'suin',
  leitao: 'suin',
  suino: 'suin',
  frango: 'ave',
  galinha: 'galinha',
  galo: 'ave',
  franga: 'galinha',
  pintinho: 'ave',
  ave: 'ave',
  carcaca: 'carcaca',
  milho: 'milho',
  semente: 'semente',
  sementes: 'semente',
  plantio: 'semeadura',
  plantar: 'semeadura',
  semeadura: 'semeadura',
  sementeira: 'semente',
  grao: 'grao',
  graos: 'grao',
  racao: 'alimentacao',
  cao: 'caes',
  caes: 'caes',
  cachorro: 'caes',
  gato: 'gatos',
  gatos: 'gatos',
  sal: 'sal',
  arroz: 'arroz',
  feijao: 'feijao',
  trigo: 'trigo',
  soja: 'soja',
  cafe: 'cafe',
  acucar: 'acucar',
  queijo: 'queijo',
  leite: 'leite',
  remedio: 'medicamento',
  antibiotico: 'medicamento',
  seringa: 'seringa',
  protese: 'protese',
}

/** Cada sinal: gatilhos (tokens normalizados) e capítulos prioritários. */
const REGRAS_SINAL: { sinal: SinalFiscal; gatilhos: string[]; capitulos: string[] }[] = [
  { sinal: 'VIVO', gatilhos: ['vivo', 'vivos', 'viva', 'vivas'], capitulos: ['01'] },
  {
    sinal: 'REPRODUTOR',
    gatilhos: ['reprodutor', 'reprodutores', 'reproducao', 'matriz', 'matrizes', 'raca', 'pura', 'prenhe', 'prenhes', 'cria', 'reprodutora'],
    capitulos: ['01'],
  },
  { sinal: 'ABATE', gatilhos: ['abate', 'frigorifico', 'frigorifico', 'corte', 'carcaca', 'carne'], capitulos: ['01', '02'] },
  {
    sinal: 'SEMENTE_PLANTIO',
    gatilhos: ['semeadura', 'semente', 'sementes', 'sementeira', 'plantio', 'plantar', 'cultivo', 'lavoura'],
    capitulos: ['10', '12'],
  },
  {
    sinal: 'RACAO_ANIMAL',
    gatilhos: ['racao', 'alimentacao', 'forragem', 'pastagem', 'suplemento', 'caes', 'gatos', 'pet', 'nutricao'],
    capitulos: ['23'],
  },
  { sinal: 'SAL_ADICIONADO', gatilhos: ['sal', 'salgado', 'sodio', 'cloreto'], capitulos: [] },
  {
    sinal: 'HORTICOLA',
    gatilhos: ['horticola', 'verdura', 'legume', 'fruta', 'ovo', 'ovos', 'hortalica', 'tomate', 'alface', 'batata'],
    capitulos: ['07', '08'],
  },
  { sinal: 'CARNE', gatilhos: ['carne', 'carcaca', 'miudeza', 'bovina', 'suina', 'frango'], capitulos: ['02'] },
  {
    sinal: 'CEREAL',
    gatilhos: ['cereal', 'cereais', 'milho', 'trigo', 'arroz', 'cevada', 'aveia', 'sorgo', 'grao'],
    capitulos: ['10'],
  },
  { sinal: 'DISPOSITIVO_MEDICO', gatilhos: ['dispositivo', 'protese', 'seringa', 'cateter', 'medico', 'hospitalar'], capitulos: ['90'] },
  { sinal: 'MEDICAMENTO', gatilhos: ['medicamento', 'remedio', 'farmaco', 'antibiotico', 'comprimido'], capitulos: ['30'] },
  { sinal: 'COZIDO', gatilhos: ['cozido', 'cozida', 'cozidos', 'cozimento', 'precozido'], capitulos: [] },
  { sinal: 'IN_NATURA', gatilhos: ['natura', 'fresco', 'fresca', 'cru', 'crua', 'resfriado', 'congelado'], capitulos: [] },
]

/** Expande um token para o vocabulário da nomenclatura (ou `null`). */
export function expandirSinonimo(token: string): string | null {
  return SINONIMOS[token] ?? null
}

/** Extrai os sinais fiscais presentes nos tokens. */
export function extrairSinais(tokens: string[]): SinalFiscal[] {
  const tem = new Set(tokens)
  const out: SinalFiscal[] = []
  for (const regra of REGRAS_SINAL) {
    if (regra.gatilhos.some((g) => tem.has(g))) out.push(regra.sinal)
  }
  // "reprodutor/matriz/para plantio/para ração" implicam o estado do produto
  // mesmo sem a palavra literal ("vivo", "semente"): infere a partir do uso.
  if (out.includes('REPRODUTOR') && !out.includes('VIVO')) out.push('VIVO')
  if (out.includes('SEMENTE_PLANTIO') && !out.includes('CEREAL')) out.push('CEREAL')
  return out
}

/** Monta as variações de consulta (original + expansões com sinônimos). */
export function expandirConsultas(tokensUteis: string[]): string[] {
  const base = tokensUteis.join(' ')
  if (!base) return []
  const consultas = [base]
  const expandidos = tokensUteis.map((t) => expandirSinonimo(t) ?? t)
  const expandida = [...new Set(expandidos.join(' ').split(' '))].join(' ')
  if (expandida && expandida !== base) consultas.push(expandida)
  // Terceira variação: só os termos de maior peso (sinônimos aplicados),
  // para descrições longas com ruído ("ração para cães com adição de sal"
  // → "alimentacao animal caes sal").
  if (tokensUteis.length >= 3 && expandida !== base) consultas.push(expandida)
  return [...new Set(consultas)].slice(0, 3)
}

/** Tokens de condição de risco: saem da consulta-núcleo (o match é no
 *  produto-base), mas os sinais continuam valendo para risco/perguntas. */
const TOKENS_CONDICAO_RISCO = new Set([
  'sal', 'salgado', 'salgada', 'sodio', 'cloreto', 'adicao', 'adicionado',
  'adicionada', 'acrescido', 'acrescida', 'cozido', 'cozida', 'cozidos',
  'cozimento', 'precozido',
])

/**
 * Consultas efetivas: expandidas + variação-núcleo sem tokens de condição
 * de risco. Sem isso, "ração para cães com adição de sal" nunca matcha
 * (a nomenclatura não cita o sal) — o risco continua sinalizado pela análise.
 */
export function consultasEfetivas(analise: AnaliseDescricao): string[] {
  const base = analise.consultasExpandidas
  const nucleo = analise.tokens.filter((t) => !TOKENS_CONDICAO_RISCO.has(t))
  const semRisco = expandirConsultas(nucleo)
  return [...new Set([...base, ...semRisco])].slice(0, 5)
}

/**
 * Tolerância a ruído: descrições reais trazem termos sem correspondente
 * oficial (`raça`, `Nelore` já coberto por sinônimo, `híbrido`). Quando a
 * rodada principal não matcha nada, tenta cada consulta sem 1 token por vez.
 * Retorna as consultas extras e os termos ignorados (para a trilha auditar).
 */
export function consultasTolerantes(consultas: string[]): { consultas: string[]; ignorados: string[] } {
  const extras: string[] = []
  const ignorados: string[] = []
  for (const base of consultas) {
    const termos = base.split(' ').filter(Boolean)
    if (termos.length < 3) continue
    for (const t of termos) {
      const sem = termos.filter((x) => x !== t).join(' ')
      if (sem && !consultas.includes(sem) && !extras.includes(sem)) {
        extras.push(sem)
        if (!ignorados.includes(t)) ignorados.push(t)
      }
    }
    if (extras.length >= 12) break
  }
  return { consultas: extras.slice(0, 12), ignorados }
}

/**
 * Análise completa da descrição + contexto (etapas 1–2 do chain-of-thought
 * do prompt: análise da descrição e aplicação das RGIs).
 */
export function analisarDescricao(entrada: EntradaDescricao): AnaliseDescricao {
  const combinado = [entrada.descricao, entrada.destinacao ?? '', entrada.composicao ?? '', entrada.uso ?? '']
    .join(' ')
    .trim()
  const textoNormalizado = normalizarBusca(combinado)
  const tokensBrutos = tokenizarBusca(combinado)
  const tokens = tokensBrutos.filter((t) => !STOPWORDS.has(t))
  const sinais = extrairSinais(tokens)

  const ambiguidades: string[] = []
  if (sinais.includes('RACAO_ANIMAL') && sinais.includes('SAL_ADICIONADO')) {
    ambiguidades.push(
      'Adição de sal em preparação para alimentação animal pode descaracterizar o enquadramento no benefício — confirmar composição/percentual.',
    )
  }
  if (sinais.includes('HORTICOLA') && sinais.includes('COZIDO')) {
    ambiguidades.push(
      'Produto hortícola cozido pode perder o benefício do Anexo XV (que exige produto não cozido) — confirmar preparo.',
    )
  }
  if (sinais.includes('VIVO') && !sinais.includes('REPRODUTOR') && !sinais.includes('ABATE')) {
    ambiguidades.push('Animal vivo sem destinação clara (reprodução x abate) — a subposição depende do uso.')
  }

  const capitulosPrioritarios = [
    ...new Set(
      REGRAS_SINAL.filter((r) => sinais.includes(r.sinal)).flatMap((r) => r.capitulos),
    ),
  ]

  const rgiAplicaveis = ['RGI 1 (texto das posições)', 'RGI 6 (texto das subposições)']
  if (entrada.destinacao?.trim() || entrada.uso?.trim()) {
    rgiAplicaveis.push('Notas de Seção/Capítulo (uso e destinação)')
  }

  const insuficiente = tokens.length < 2 && !pareceCodigoNcm(combinado)
  return {
    textoNormalizado,
    tokens,
    sinais,
    ambiguidades,
    capitulosPrioritarios,
    consultasExpandidas: expandirConsultas(tokens),
    rgiAplicaveis,
    insuficiente,
  }
}

/**
 * Perguntas para refinar a classificação quando a descrição é insuficiente
 * ou há condição de risco (etapa 4 do chain-of-thought: validação de contexto).
 */
export function perguntasComplementares(analise: AnaliseDescricao): string[] {
  const perguntas: string[] = []
  if (analise.insuficiente) {
    perguntas.push('Informe a composição ou destinação do produto para melhor precisão (ex.: vivo ou abatido? para plantio, consumo ou ração?).')
    return perguntas
  }
  if (analise.sinais.includes('VIVO') && !analise.sinais.includes('REPRODUTOR') && !analise.sinais.includes('ABATE')) {
    perguntas.push('O animal está vivo? Qual a destinação — reprodução (raça pura?), abate/frigorífico ou outro uso?')
  }
  if (analise.sinais.includes('RACAO_ANIMAL') && analise.sinais.includes('SAL_ADICIONADO')) {
    perguntas.push('Qual o teor de sal/aditivos e a composição da ração? É preparação completa ou suplemento à base de sal?')
  }
  if (analise.sinais.includes('HORTICOLA')) {
    perguntas.push('O produto está in natura (não cozido)? Qual o estado — fresco, resfriado, congelado ou processado?')
  }
  if (analise.sinais.includes('SEMENTE_PLANTIO')) {
    perguntas.push('É semente para semeadura (plantio) ou grão para consumo/industrialização?')
  }
  return perguntas
}

/**
 * Nível de confiança (etapa 5 do chain-of-thought).
 *
 * Regras determinísticas e auditáveis:
 * - sem candidato → baixa;
 * - condição de risco (sal, cozido, vivo sem destinação) → no máximo média;
 * - 1 candidato destacado (margem ≥ 30) e descrição com ≥ 2 tokens → alta;
 * - resto → média.
 */
export function calcularConfianca(args: {
  totalCandidatos: number
  margemTopo: number
  tokensUteis: number
  temCondicaoRisco: boolean
}): Confianca {
  if (args.totalCandidatos === 0 || args.tokensUteis < 2) return 'baixa'
  if (args.temCondicaoRisco) return 'media'
  if (args.totalCandidatos === 1 || args.margemTopo >= 30) return 'alta'
  return 'media'
}
