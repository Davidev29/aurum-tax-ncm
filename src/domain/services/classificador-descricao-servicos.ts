/**
 * Classificador por descrição livre de SERVIÇOS — etapa 1 (pura, sem IndexedDB).
 *
 * Espelho de `./classificador-descricao` para bens: transforma
 * "aula de inglês online" em sinais auditáveis. A etapa 2
 * (`src/application/classificacao-inteligente-servicos.ts`) ancora cada
 * candidato no NBS vigente + vínculo oficial — **nunca inventa NBS**.
 */
import { normalizarBusca, tokenizarBusca } from './busca-texto'
import { expandirSinonimoServico } from './vocabulario-servicos'
import { expandirSinonimoFiscal } from './vocabulario'

/** Entrada do classificador de serviços + contexto opcional. */
export interface EntradaDescricaoServico {
  descricao: string
  /** Tomador do serviço (ex.: pessoa física, empresa, exterior). */
  tomador?: string
  /** Local da prestação (ex.: presencial, remoto/online, domicílio). */
  local?: string
  /** Destinação/uso (ex.: produção artística nacional, consumo próprio). */
  uso?: string
}

export type ConfiancaServico = 'alta' | 'media' | 'baixa'

/** Sinais fiscais de serviços (ids estáveis, usados em testes). */
export type SinalServico =
  | 'ENSINO'
  | 'SAUDE'
  | 'CULTURA_EVENTO'
  | 'AUDIOVISUAL'
  | 'SOBERANIA_SEGURANCA'
  | 'CIBERSEGURANCA'
  | 'PRESENCIAL'
  | 'REMOTO'
  | 'TOMADOR_EXTERIOR'
  | 'PRODUCAO_NACIONAL'

export interface AnaliseDescricaoServico {
  textoNormalizado: string
  tokens: string[]
  sinais: SinalServico[]
  ambiguidades: string[]
  consultasExpandidas: string[]
  insuficiente: boolean
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na',
  'nos', 'nas', 'e', 'ou', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as',
  'tipo', 'servico', 'servicos', 'prestacao', 'item', 'que', 'por', 'meu', 'minha',
])

const REGRAS_SINAL: { sinal: SinalServico; gatilhos: string[] }[] = [
  { sinal: 'ENSINO', gatilhos: ['educacao', 'escola', 'colegio', 'faculdade', 'universidade', 'curso', 'aula', 'ensino', 'treinamento', 'idioma', 'ingles', 'aluno', 'professor'] },
  { sinal: 'SAUDE', gatilhos: ['saude', 'medico', 'hospital', 'clinica', 'consulta', 'exame', 'dentista', 'odontologia', 'fisioterapia', 'enfermagem', 'terapia', 'psicologo', 'paciente', 'saude'] },
  { sinal: 'CULTURA_EVENTO', gatilhos: ['espetaculo', 'teatral', 'show', 'evento', 'feira', 'congresso', 'musical', 'danca', 'circo', 'carnaval', 'exposicao', 'palestra'] },
  { sinal: 'AUDIOVISUAL', gatilhos: ['filme', 'serie', 'novela', 'cinema', 'documentario', 'jornalistico', 'programa', 'entrevista', 'clipe', 'audiovisual'] },
  { sinal: 'SOBERANIA_SEGURANCA', gatilhos: ['soberania', 'seguranca', 'administracao', 'publica', 'defesa'] },
  { sinal: 'CIBERSEGURANCA', gatilhos: ['cibernetica', 'informacao', 'software', 'socio', 'brasileiro'] },
  { sinal: 'PRESENCIAL', gatilhos: ['presencial', 'domicilio', 'domiciliar', 'local', 'clinica'] },
  { sinal: 'REMOTO', gatilhos: ['online', 'remoto', 'distancia', 'ead', 'internet', 'plataforma'] },
  { sinal: 'TOMADOR_EXTERIOR', gatilhos: ['exterior', 'estrangeiro', 'exportacao', 'internacional'] },
  { sinal: 'PRODUCAO_NACIONAL', gatilhos: ['nacional', 'brasileira', 'producao', 'cultural', 'artistica'] },
]

export function expandirSinonimoServicos(token: string): string | null {
  return expandirSinonimoServico(token) ?? expandirSinonimoFiscal(token)
}

export function extrairSinaisServicos(tokens: string[]): SinalServico[] {
  const tem = new Set(tokens)
  const out: SinalServico[] = []
  for (const regra of REGRAS_SINAL) {
    if (regra.gatilhos.some((g) => tem.has(g))) out.push(regra.sinal)
  }
  return out
}

export function expandirConsultasServicos(tokensUteis: string[]): string[] {
  const base = tokensUteis.join(' ')
  if (!base) return []
  const consultas = [base]
  const expandidos = tokensUteis.map((t) => expandirSinonimoServicos(t) ?? t)
  const expandida = [...new Set(expandidos.join(' ').split(' '))].join(' ')
  if (expandida && expandida !== base) consultas.push(expandida)
  return [...new Set(consultas)].slice(0, 2)
}

export function analisarDescricaoServico(entrada: EntradaDescricaoServico): AnaliseDescricaoServico {
  const combinado = [entrada.descricao, entrada.tomador ?? '', entrada.local ?? '', entrada.uso ?? '']
    .join(' ')
    .trim()
  const textoNormalizado = normalizarBusca(combinado)
  const tokens = tokenizarBusca(combinado).filter((t) => !STOPWORDS.has(t))
  const sinais = extrairSinaisServicos(tokens)

  const ambiguidades: string[] = []
  if (sinais.includes('CULTURA_EVENTO') && !sinais.includes('PRODUCAO_NACIONAL')) {
    ambiguidades.push('O benefício do Anexo X exige destinação a produção nacional artística/cultural — confirmar a destinação do serviço.')
  }
  if (sinais.includes('CIBERSEGURANCA')) {
    ambiguidades.push('O benefício do Anexo XI para cibersegurança exige sociedade com sócio brasileiro (≥20%) — confirmar a composição societária.')
  }
  if (sinais.includes('TOMADOR_EXTERIOR')) {
    ambiguidades.push('Tomador no exterior pode mudar o enquadramento (exportação de serviços) — confirmar o local do tomador.')
  }

  const unico = tokens.length === 1 ? tokens[0] : ''
  const unicoForte = unico.length >= 5 && !STOPWORDS.has(unico)
  const insuficiente = tokens.length === 0 || (tokens.length < 2 && !unicoForte)
  return {
    textoNormalizado,
    tokens,
    sinais,
    ambiguidades,
    consultasExpandidas: expandirConsultasServicos(tokens),
    insuficiente,
  }
}

export function perguntasComplementaresServicos(analise: AnaliseDescricaoServico): string[] {
  const perguntas: string[] = []
  if (analise.insuficiente) {
    perguntas.push('Descreva o serviço com 1–2 detalhes (ex.: aula de inglês online para adultos? consulta médica domiciliar?).')
    return perguntas
  }
  if (analise.sinais.includes('ENSINO')) {
    perguntas.push('O ensino é presencial ou a distância (online)? Qual o nível (livre, técnico, superior)?')
  }
  if (analise.sinais.includes('SAUDE')) {
    perguntas.push('O atendimento é presencial, domiciliar ou por telemedicina? Qual a especialidade?')
  }
  if (analise.sinais.includes('CULTURA_EVENTO') || analise.sinais.includes('AUDIOVISUAL')) {
    perguntas.push('O serviço destina-se a produção nacional (teatro, show, filme, evento)? Qual o tipo de produção?')
  }
  if (!perguntas.length && analise.tokens.length <= 2) {
    perguntas.push('Informe o tomador (pessoa física, empresa, exterior?) e o local (presencial ou remoto?).')
  }
  return perguntas
}

export function calcularConfiancaServicos(args: {
  totalCandidatos: number
  margemTopo: number
  tokensUteis: number
  temCondicaoRisco: boolean
}): ConfiancaServico {
  if (args.totalCandidatos === 0 || args.tokensUteis < 2) return 'baixa'
  if (args.temCondicaoRisco) return 'media'
  if (args.totalCandidatos === 1 || args.margemTopo >= 30) return 'alta'
  return 'media'
}
