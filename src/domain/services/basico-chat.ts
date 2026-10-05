/**
 * Aurum AI — perguntas básicas: hora/data + contas matemáticas simples.
 *
 * Puro, sem I/O, sem RAG. Usado pelo detector (`detector-chat.ts`) e pelo
 * orquestrador (`aurum-ai-chat.ts`) via fluxo simples (recursos nativos).
 *
 * - Tempo: "que horas são?", "que dia/mês/ano é hoje?" → responde com o
 *   relógio local (sem rede, sem LLM).
 * - Conta: adição, subtração, multiplicação, divisão, porcentagem e resto da
 *   divisão em PT-BR ("quanto é 2+3?", "10% de 500", "resto de 10 por 3").
 *   Todo número vem do parser determinístico — a IA só formata.
 * - Apelidos: a mascote chama-se Aurinha. "oi aurinha", "aurinha, que horas
 *   são?" continuam caindo na intenção real (o vocativo é ignorado na
 *   detecção e reconhecido na resposta).
 */

export const NOME_MASCOTE = 'Aurinha' as const

/** Apelidos reconhecidos da IA (forma normalizada, sem acento). */
export const APELIDOS_IA = ['aurinha', 'aurum ai', 'aurum'] as const

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** `true` quando o texto chama a IA pelo apelido. Puro. */
export function contemApelido(texto: unknown): boolean {
  const n = normBaixo(String(texto ?? ''))
  return /\baurinha\b/.test(n) || /\baurum\s*ai\b/.test(n) || /\baurum\b/.test(n)
}

/**
 * Remove o vocativo do apelido para a detecção ("aurinha, que horas são?"
 * → "que horas são?"). Mantém o resto intacto. Puro.
 */
export function removerApelido(texto: string): string {
  let t = ` ${String(texto ?? '')} `
  t = t.replace(/\b(aurinha|aurum\s*ai|aurum)\b[,.!?:;\s]*/gi, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------- tempo -- */

export type TipoTempo = 'hora' | 'data' | 'ambos'

const SINAIS_HORA = [
  'que horas',
  'que hora',
  'qual a hora',
  'qual e a hora',
  'me diz as horas',
  'me diga a hora',
  'me fala a hora',
  'horas agora',
  'hora agora',
  'hora atual',
  'horario atual',
  'horario de agora',
  'que horas sao agora',
]

const SINAIS_DATA = [
  'que dia e hoje',
  'que dia e',
  'qual a data',
  'qual e a data',
  'data de hoje',
  'hoje e dia',
  'em que dia estamos',
  'que mes e',
  'qual mes',
  'mes estamos',
  'que ano e',
  'qual ano',
  'ano estamos',
  'dia mes ano',
  'dia/mes/ano',
  'que dia do mes',
]

/**
 * Detecta pergunta de hora/data. Retorna null quando não é.
 * "bom dia" / "boa tarde" NUNCA são tempo (são saudação — o detector trata
 * antes e aqui há guarda explícita).
 */
export function detectarTempo(texto: unknown): TipoTempo | null {
  const cru = String(texto ?? '').trim()
  if (!cru) return null
  const semApelido = removerApelido(cru)
  const n = normBaixo(semApelido)
  if (!n) return null
  // Cumprimento puro não é pergunta de tempo.
  if (/^(bom dia|boa tarde|boa noite|oi|ola|opa|eai)[!?.\s]*$/.test(n)) return null
  const temHora = SINAIS_HORA.some((s) => n.includes(s)) || /\bhoras\b.*\b(agora|sao|e\??)\b/.test(n)
  const temData =
    SINAIS_DATA.some((s) => n.includes(s)) ||
    /que dia/.test(n) ||
    /data (de )?hoje/.test(n) ||
    /hoje e (dia|data)/.test(n) ||
    /qual (e |eh )?(o )?dia/.test(n)
  // "bom dia, tudo bem?" contém "dia" mas não é pergunta de data.
  if (!temHora && !temData) return null
  if (temHora && temData) return 'ambos'
  if (temHora) return 'hora'
  return 'data'
}

export function formatarHora(data: Date): string {
  const d = data instanceof Date && !Number.isNaN(data.getTime()) ? data : new Date()
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function formatarData(data: Date): { curta: string; longa: string; diaSemana: string } {
  const d = data instanceof Date && !Number.isNaN(data.getTime()) ? data : new Date()
  const curta = d.toLocaleDateString('pt-BR')
  const longa = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  const diaSemana = d.toLocaleDateString('pt-BR', { weekday: 'long' })
  return { curta, longa, diaSemana }
}

/* ------------------------------------------------------------- conta -- */

export type OperacaoConta = 'soma' | 'subtracao' | 'multiplicacao' | 'divisao' | 'porcentagem' | 'resto'

export interface ContaDetectada {
  operacao: OperacaoConta
  /** Primeiro operando (ou percentual, em porcentagem). */
  a: number
  /** Segundo operando (ou base, em porcentagem). */
  b: number
}

/** Símbolo canônico por operação (para exibir "2 + 3 = 5"). */
export const SIMBOLO_CONTA: Record<OperacaoConta, string> = {
  soma: '+',
  subtracao: '−',
  multiplicacao: '×',
  divisao: '÷',
  porcentagem: '% de',
  resto: 'mod',
}

/** Converte "1.000,50" / "1,5" / "2.500" em número. Puro. */
export function parseNumeroConta(s: string): number {
  const t = String(s ?? '').trim()
  if (!t) return NaN
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  const m = t.match(/^(-?\d+)\.(\d+)$/)
  if (m) return m[2].length === 3 ? Number(m[1] + m[2]) : Number(t)
  return Number(t)
}

const RX_NUM_CONTA = String.raw`(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+(?:[.,]\d+)?)`

function ehCodigoFiscal(texto: string): boolean {
  const t = String(texto ?? '')
  if (/\b\d{8,9}\b/.test(t)) return true
  if (/\b\d{4}\.\d{2}\.\d{2}\b/.test(t)) return true
  if (/\b\d{3}\.\d{3}\.\d{3}\b/.test(t)) return true
  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(t)) return true
  const soDig = t.replace(/\D+/g, '')
  if (soDig.length === 14 && /cnpj|empresa/i.test(t)) return true
  return false
}

function temLastroFiscalForte(n: string): boolean {
  return /\bncm\b|\bnbs\b|\bcnpj\b|\brbt\b|\bdas\b|\banexo\b|\bibs\b|\bcbs\b/.test(n)
}

/**
 * Detecta conta matemática básica em PT-BR. Puro.
 * Retorna null quando não há operação com 2 operandos — ou quando o texto
 * é fiscal (código NCM/NBS/CNPJ presente: o fluxo fiscal decide).
 */
export function detectarConta(texto: unknown): ContaDetectada | null {
  const cru = String(texto ?? '')
  if (!cru.trim()) return null
  if (ehCodigoFiscal(cru)) return null
  // Data/período ("01/01/2026", "de 01/01/2026 a 31/03/2026") NÃO é divisão:
  // o "01/01" casaria no símbolo "/" e roubaria o fluxo de dados. O fluxo
  // fiscal/dados decide esses casos.
  if (/\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/.test(cru)) return null
  const semApelido = removerApelido(cru)
  const n = normBaixo(semApelido)
  if (!n) return null
  if (temLastroFiscalForte(n)) return null

  // 1) Porcentagem explícita: "10% de 500", "10 % do 500", "10 por cento de 500".
  let m = semApelido.match(new RegExp(`${RX_NUM_CONTA}\\s*%\\s*(de|do|da|dos|das)?\\s*${RX_NUM_CONTA}`, 'i'))
  if (m?.[1] && m?.[3]) {
    const a = parseNumeroConta(m[1])
    const b = parseNumeroConta(m[3])
    if (Number.isFinite(a) && Number.isFinite(b)) return { operacao: 'porcentagem', a, b }
  }
  m = semApelido.match(new RegExp(`${RX_NUM_CONTA}\\s*por\\s*cento\\s*(de|do|da)?\\s*${RX_NUM_CONTA}`, 'i'))
  if (m?.[1] && m?.[3]) {
    const a = parseNumeroConta(m[1])
    const b = parseNumeroConta(m[3])
    if (Number.isFinite(a) && Number.isFinite(b)) return { operacao: 'porcentagem', a, b }
  }
  // "quanto é 20 por cento disso?" com 1 número + contexto é follow-up (orquestrador resolve).

  // 2) Resto da divisão: exige a palavra "resto" ou "mod".
  if (/resto|mod\b/.test(n)) {
    const nums = [...semApelido.matchAll(new RegExp(RX_NUM_CONTA, 'g'))].map((x) => parseNumeroConta(x[1])).filter((v) => Number.isFinite(v))
    if (nums.length >= 2) {
      const a = nums[0]
      const b = nums[1]
      if (a != null && b != null) return { operacao: 'resto', a, b }
    }
    m = semApelido.match(new RegExp(`${RX_NUM_CONTA}\\s*(mod|%)\\s*${RX_NUM_CONTA}`, 'i'))
    if (m?.[1] && m?.[3]) {
      const a = parseNumeroConta(m[1])
      const b = parseNumeroConta(m[3])
      if (Number.isFinite(a) && Number.isFinite(b)) return { operacao: 'resto', a, b }
    }
    // "resto" sem 2 números → não é conta (pede o 2º número no orquestrador).
    return null
  }

  // 3) Símbolos explícitos com 2 números: "2+3", "10 - 4", "4x5", "4*5", "10/2".
  // "%" sozinho aqui NÃO é porcentagem (porcentagem exige "de" — ver acima).
  m = semApelido.match(new RegExp(`${RX_NUM_CONTA}\\s*([+\\-x×*/÷])\\s*${RX_NUM_CONTA}`, 'i'))
  if (m?.[1] && m?.[3]) {
    const op = m[2]
    const a = parseNumeroConta(m[1])
    const b = parseNumeroConta(m[3])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    if (op === '+') return { operacao: 'soma', a, b }
    if (op === '-') return { operacao: 'subtracao', a, b }
    if (/^[x×*]$/i.test(op)) return { operacao: 'multiplicacao', a, b }
    if (/^[÷/]$/.test(op)) return { operacao: 'divisao', a, b }
  }

  // 4) Verbal com 2 números.
  const nums = [...semApelido.matchAll(new RegExp(RX_NUM_CONTA, 'g'))].map((x) => parseNumeroConta(x[1])).filter((v) => Number.isFinite(v))
  if (nums.length >= 2) {
    const a = nums[0] as number
    const b = nums[1] as number
    if (/dividid[oa]s?\s+por|divide|divisao/.test(n)) return { operacao: 'divisao', a, b }
    if (/multiplica|vezes|multiplicad/.test(n)) return { operacao: 'multiplicacao', a, b }
    if (/subtra|menos|subtracao|diminui|tirar|descont/.test(n)) {
      // "subtrai 5 de 20" → 20 − 5 (ordem invertida no PT).
      const inv = semApelido.match(/subtra\w*\s*.+?\s+de\s+/i)
      if (inv) return { operacao: 'subtracao', a: b, b: a }
      return { operacao: 'subtracao', a, b }
    }
    if (/mais|soma|somar|adiciona|acrescent|plus/.test(n)) return { operacao: 'soma', a, b }
    // 2 números + verbo de conta genérico ("calcula", "quanto é", "resolve").
    if (/calcula|quanto (e|eh)|quanto da|resolve|conta/.test(n)) {
      // Sem operador explícito e sem verbo de operação: não chuta (pede operador).
      return null
    }
  }

  // 5) Verbo + 1 número é follow-up ("soma 5", "e mais 5?") — o orquestrador
  // herda o 1º operando do contexto. Aqui retorna null (sem contexto não há conta).
  return null
}

/** Executa a conta. Retorna null em divisão/resto por zero. Puro. */
export function calcularConta(c: ContaDetectada): number | null {
  const { operacao, a, b } = c
  switch (operacao) {
    case 'soma': return a + b
    case 'subtracao': return a - b
    case 'multiplicacao': return a * b
    case 'divisao': return b === 0 ? null : a / b
    case 'porcentagem': return (a / 100) * b
    case 'resto': return b === 0 ? null : a % b
  }
}

/** Formata número em pt-BR (até 4 casas, sem zeros à toa). Puro. */
export function formatarNumeroConta(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const arred = Math.round(v * 10000) / 10000
  return arred.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
}

/** "2 + 3 = 5" legível em pt-BR. Puro. */
export function expressaoConta(c: ContaDetectada, resultado: number): string {
  const a = formatarNumeroConta(c.a)
  const b = formatarNumeroConta(c.b)
  const r = formatarNumeroConta(resultado)
  switch (c.operacao) {
    case 'soma': return `${a} + ${b} = ${r}`
    case 'subtracao': return `${a} − ${b} = ${r}`
    case 'multiplicacao': return `${a} × ${b} = ${r}`
    case 'divisao': return `${a} ÷ ${b} = ${r}`
    case 'porcentagem': return `${a}% de ${b} = ${r}`
    case 'resto': return `resto de ${a} ÷ ${b} = ${r}`
  }
}

/* --------------------------------------- follow-up ("e mais 5?") -- */

/** Extrai o último resultado de conta básica das respostas da assistente. Puro. */
export function extrairUltimoResultadoConta(historico: Array<{ papel: string; texto: string }>): number | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    const msg = historico[i]
    if (msg?.papel !== 'assistant') continue
    const t = String(msg.texto ?? '')
    // Nosso molde: "🧮 ... = **1.234,56**" ou "**Resultado: 5**".
    let mm = t.match(/=\s*\*\*([-\d.,]+)\*\*/)
    if (mm?.[1]) {
      const v = parseNumeroConta(mm[1])
      if (Number.isFinite(v)) return v
    }
    mm = t.match(/\*\*Resultado:\s*([-\d.,]+)\*\*/)
    if (mm?.[1]) {
      const v = parseNumeroConta(mm[1])
      if (Number.isFinite(v)) return v
    }
  }
  return null
}

/**
 * Tenta completar um follow-up curto ("e mais 5?", "e 10% disso?", "soma 5")
 * usando o último resultado como 1º operando. Puro (sem I/O).
 */
export function detectarContaFollowUp(
  texto: string,
  historico: Array<{ papel: string; texto: string }>,
): ContaDetectada | null {
  const anterior = extrairUltimoResultadoConta(historico)
  if (anterior == null) return null
  const cru = String(texto ?? '')
  if (!cru.trim() || cru.trim().split(/\s+/).length > 10) return null
  if (ehCodigoFiscal(cru)) return null
  const n = normBaixo(removerApelido(cru))
  // "e 10% disso?" → porcentagem sobre o resultado anterior.
  let m = cru.match(new RegExp(`${RX_NUM_CONTA}\\s*%`, 'i'))
  if (m?.[1] && /%/.test(cru) && (/disso|diso|desse|deste/.test(n) || /de\b/.test(n))) {
    const pct = parseNumeroConta(m[1])
    if (Number.isFinite(pct)) return { operacao: 'porcentagem', a: pct, b: anterior }
  }
  const nums = [...cru.matchAll(new RegExp(RX_NUM_CONTA, 'g'))].map((x) => parseNumeroConta(x[1])).filter((v) => Number.isFinite(v))
  if (!nums.length) return null
  const b = nums[nums.length - 1] as number
  if (/resto|mod\b/.test(n)) return { operacao: 'resto', a: anterior, b }
  if (/dividid|divide|divisao|\/\s*\d/.test(cru) || (/por\b/.test(n) && /divid|divis/.test(n))) return { operacao: 'divisao', a: anterior, b }
  if (/vezes|multiplica|\bx\b/i.test(n) || /\*\s*\d/.test(cru)) return { operacao: 'multiplicacao', a: anterior, b }
  if (/menos|subtra|tirar/.test(n) || /-\s*\d/.test(cru)) {
    // "subtrai 5 disso" → anterior − 5 (sem inversão aqui: o anterior é a base).
    return { operacao: 'subtracao', a: anterior, b }
  }
  if (/mais|soma|adiciona|acrescent|\+/.test(n) || /\+\s*\d/.test(cru)) return { operacao: 'soma', a: anterior, b }
  // Número solto após conta ("e 5?") não é conta — pede operador (orquestrador orienta).
  return null
}
