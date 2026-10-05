/**
 * Valores monetários PT-BR à prova de falhas (chat Aurum AI).
 *
 * Puro, sem I/O. Cobre: "R$ 500.000,00", "500 mil", "500k", "1 milhão",
 * "1,5 mi", "1.2M", "500.000", "faturamento de 2 milhões", "RBT12 500 mil
 * e receita 40 mil". "Anexo III", NCM e "%" nunca viram dinheiro.
 */

export type AnexoId = 'I' | 'II' | 'III' | 'IV' | 'V'

export interface ValorExtraido {
  valor: number
  bruto: string
  inicio: number
  fim: number
}

export interface SlotsSimples {
  anexo: AnexoId | null
  rbt12: number | null
  receitaMes: number | null
  folha12: number | null
  rba: number | null
  valorBase: number | null
}

const RX_NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d+)?)`
/**
 * Sufixos de magnitude (fine-tuning v6 — dialetos):
 * - `k/mil`, `mi/milhão (com/sem acento)`, `bi/bilhão`, `M` maiúsculo;
 * - gírias BR: `pau(s)`, `pila(s)`, `conto(s)` (=1e3), `prata`, `manga`;
 * - `reais/real/brl` confirmam âncora com mult 1 (evitam falso positivo).
 * Matching é case-insensitive; a normalização sem acento acontece em
 * `multSufixo` (que recebe o bruto e normaliza antes de comparar).
 */
const RX_SUF = String.raw`(bilh[õo]es|bilh[ãa]o|bilhao|bilhoes|bi\b|milh[õo]es|milh[ãa]o|milhao|milhoes|mil\b|mi\b|k\b|M\b|paus?\b|pilas?\b|contos?\b|prata\b|mangos?\b|reais?\b|real\b|brl\b)`

function normSimples(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function multSufixo(sufRaw: string | undefined): number {
  const raw = String(sufRaw ?? '')
  const s = normSimples(raw).trim()
  if (!s) return 1
  if (s === 'k' || s === 'mil' || s === 'ka') return 1e3
  // conto/contos = 1e3 no BR atual ("500 contos" = 500 mil). Documentado.
  if (s === 'conto' || s === 'contos') return 1e3
  if (s === 'mi' || s === 'mio' || s === 'mm' || s.startsWith('milh')) return 1e6
  if (s === 'm') return raw === 'M' ? 1e6 : 1 // guarda anti "mês": só M maiúsculo multiplica
  if (s === 'bi' || s === 'bn' || s.startsWith('bilh')) return 1e9
  // Gíria 1x (não multiplica): "70 paus" = R$ 70. Se quis 70k, diga "70k/70 mil".
  if (s === 'pau' || s === 'paus' || s === 'pila' || s === 'pilas' || s === 'prata' || s === 'manga' || s === 'mangos') return 1
  // Âncora monetária sem magnitude: "1500 reais", "5.000 reais", "40k" já resolve.
  if (s === 'real' || s === 'reais' || s === 'brl' || s === 'r$') return 1
  return 1
}

function parseNumeroBR(s: string, temSufixo: boolean): number {
  const t = String(s ?? '').trim()
  if (!t) return NaN
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  // Com sufixo ("5.000 reais", "500mil"): ponto é milhar, não decimal.
  // Sem isso, Number("5.000") virava 5 (erro de 1000x).
  if (temSufixo && /^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  if (temSufixo) return Number(t)
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  const m = t.match(/^(\d+)\.(\d+)$/)
  if (m) return m[2].length === 3 ? Number(m[1] + m[2]) : Number(t)
  return Number(t)
}

function mascararNaoDinheiro(texto: string): string {
  return String(texto ?? ' ')
    .replace(/anexo\s*(i{1,3}|iv|v|[1-5]|primeiro|segundo|terceiro|quarto|quinto)/gi, ' ')
    .replace(/\b\d{4}\.\d{2}\.\d{2}\b/g, ' ')
    .replace(/\b\d{8,9}\b/g, ' ')
    .replace(/(\d[\d.,]*)\s*%/g, ' ')
    // "12" do rótulo RBT12 e "12 m/meses" (período) nunca são dinheiro:
    // sem isso, "RBT12 500 mil" gerava receita fantasma de R$ 12.
    .replace(/rbt\s*12/gi, 'RBT')
    .replace(/\b12\s*m(eses?)?\b/gi, ' ')
}

const RX_VALOR_GLOBAL = new RegExp(String.raw`(?:R\$\s*)?${RX_NUM}\s*${RX_SUF}?`, 'gi')

export function extrairTodosValores(texto: string): ValorExtraido[] {
  const base = mascararNaoDinheiro(texto)
  const out: ValorExtraido[] = []
  let m: RegExpExecArray | null
  RX_VALOR_GLOBAL.lastIndex = 0
  while ((m = RX_VALOR_GLOBAL.exec(base)) !== null) {
    // m[1] = número, m[2] = sufixo (últimos grupos da regex global)
    const num = m[1] ?? ''
    const suf = m[2] ?? ''
    // "mil" colado sem espaço em "500mil"? A regex já cobre via \s*.
    // Guarda: match vazio ou só "R$" não vale.
    if (!num) {
      if (m[0].length === 0) RX_VALOR_GLOBAL.lastIndex++
      continue
    }
    const n = parseNumeroBR(num, !!suf)
    const v = n * multSufixo(suf)
    if (Number.isFinite(v) && v > 0) {
      out.push({ valor: Math.round(v * 100) / 100, bruto: m[0], inicio: m.index, fim: m.index + m[0].length })
    }
    if (m[0].length === 0) RX_VALOR_GLOBAL.lastIndex++
  }
  return out
}

/** Último valor do texto (compatível com o antigo extrairValor). */
export function extrairValorRobusto(texto: string): number | null {
  const todos = extrairTodosValores(texto)
  return todos.length ? todos[todos.length - 1].valor : null
}

const LBL_RBT12 = String.raw`(?:rbt\s*12|\brbt\b|rba\s*12|receita\s*bruta|faturamento(?:\s*(?:bruto|anual|12\s*m(?:eses?)?|acumulad[oa]|dos\s+ultimos\s+12))?)`
const LBL_RECEITA = String.raw`(?:receita(?:\s*(?:do\s*m[eê]s|mensal|atual|compet[eê]ncia))?|faturamento\s*(?:do\s*m[eê]s|mensal|atual|desse\s+mes|este\s+mes)|fatura(?:mento)?\s*(?:do\s*mes|mensal)?|rec\b)`
const LBL_FOLHA = String.raw`(?:folha(?:\s*de\s*(?:pagamento|sal[aá]rios))?(?:\s*(?:12\s*m(?:eses?)?|12|anual|12m))?|massa\s*salarial|sal[aá]rios?(?:\s*12)?|folha\s*12m?|flh\b|pagamento\s*(?:de\s*)?salarios?|colaboradores?|funcion[aá]rios?|pro[\s-]?labore|prolabore|encargos?(?:\s*sociais)?|mao\s*de\s*obra)`
const LBL_RBA = String.raw`(?:\brba\b|rba\s*12|receita\s*bruta\s*anual)`
const LBL_BASE = String.raw`(?:base|valor(?:\s*base)?|total)`

/** Preposições entre rótulo e valor ("receita pra 50 mil", "folha de 200k"). */
const RX_PREP = String.raw`(?:de|do|da|dos|das|no|na|em|para|pra|p\/|por|com|como|em torno de|cerca de|:|=|-|—|→)?`

/** Typos comuns de digitação rápida (normaliza antes de ancorar). */
function normalizarTyposValores(texto: string): string {
  return String(texto ?? ' ')
    .replace(/\breceuta\b/gi, 'receita')
    .replace(/\breceta\b/gi, 'receita')
    .replace(/\bfolhs\b/gi, 'folha')
    .replace(/\bfolah\b/gi, 'folha')
    .replace(/\brbt12\b/gi, 'RBT12')
    .replace(/\banx\b/gi, 'anexo')
    .replace(/\banex\b/gi, 'anexo')
}

function pegaAncorado(texto: string, lbl: string): number | null {
  const t = normalizarTyposValores(String(texto ?? ' '))
  // `(?!\s*%)`: número seguido de % é percentual ("30% do RBT"), nunca dinheiro.
  const rx1 = new RegExp(`${lbl}\\s*(?:${RX_PREP}\\s*)?(?:R\\$\\s*)?${RX_NUM}\\s*${RX_SUF}?(?!\\s*%)`, 'i')
  const rx2 = new RegExp(`(?:R\\$\\s*)?${RX_NUM}\\s*${RX_SUF}?\\s*(?:${RX_PREP}\\s+)?(?:de\\s+)?${lbl}(?!\\s*%)`, 'i')
  for (const rx of [rx1, rx2]) {
    const m = t.match(rx)
    if (m) {
      const num = m[m.length - 2] ?? ''
      const suf = m[m.length - 1] ?? ''
      const v = parseNumeroBR(num, !!suf) * multSufixo(suf)
      if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100
    }
  }
  return null
}

/** Verbos de edição ("troca/muda/corrige/bota/aumenta...") — para eco explícito. */
export const VERBOS_EDICAO = /troca|troque|muda|mude|corrige|corrija|altera|altere|bota|bote|coloca|coloque|poe|p[oõ]e|aumenta|aumente|sobe|suba|reduz|reduza|baixa|baixe|diminui|ajusta|ajuste|refaz|refaca|recalcula|recalcule|considera|considere|e se|e com|mantem|mantém|so muda|só muda/i

/**
 * Classifica qual slot o usuário quer editar na frase atual.
 * Ordem: rótulo explícito > percentual-do-RBT (folha) > anexo > nulo.
 * Puro e testável. Usado pelo `responderSimples` para eco "Alterado: ...".
 */
export function classificarSlotEdicao(texto: string): 'rbt12' | 'receitaMes' | 'folha12' | 'anexo' | null {
  const bruto = normalizarTyposValores(String(texto ?? ' '))
  const n = normSimples(bruto)
  if (/anexo|anx|anex/.test(n)) return 'anexo'
  // Percentual do RBT ("30% do RBT", "28% do faturamento") sempre é folha.
  if (/\d+\s*[,.]?\d*\s*%\s*(do|da|de|sobre)?\s*(rbt|faturamento|receita\s*bruta)/.test(n)) return 'folha12'
  const temRbt = /\brbt\b|\brba\b|receita\s*bruta|faturamento(\s*(bruto|anual|12|acumulado|dos\s*ultimos))?/.test(n) && !/receita\s*(do\s*mes|mensal|atual|desse|deste|este)/.test(n)
  const temReceita = /receita(\s*(do\s*mes|mensal|atual|competencia|desse|deste|este))?|faturamento\s*(do\s*mes|mensal)|fatura\b|\brec\b/.test(n)
  const temFolha = /folha|massa\s*salarial|salario|colaborador|funcionario|pro[\s-]?labore|encargo|mao\s*de\s*obra|\bflh\b|pagamento/.test(n)
  // Desempate: rótulo mais próximo do número vence (evita "RBT ... receita ..." ambíguo).
  if (temFolha && !temRbt && !temReceita) return 'folha12'
  if (temRbt && !temFolha && !temReceita) return 'rbt12'
  if (temReceita && !temFolha && !temRbt) return 'receitaMes'
  if (temFolha || temRbt || temReceita) {
    const nums = [...String(texto ?? ' ').matchAll(/\d/g)]
    void nums
    // Com múltiplos rótulos, prioriza o primeiro rótulo citado na frase.
    const iFolha = n.search(/folha|massa\s*salarial|salario|colaborador|funcionario|pro[\s-]?labore|encargo|flh/)
    const iRbt = n.search(/\brbt\b|receita\s*bruta|faturamento/)
    const iRec = n.search(/receita|fatura|\brec\b/)
    const cand: Array<[number, 'rbt12' | 'receitaMes' | 'folha12']> = []
    if (iFolha >= 0) cand.push([iFolha, 'folha12'])
    if (iRbt >= 0) cand.push([iRbt, 'rbt12'])
    if (iRec >= 0 && !/receita\s*bruta/.test(n.slice(Math.max(0, iRec - 8), iRec + 20))) cand.push([iRec, 'receitaMes'])
    else if (iRec >= 0 && /receita\s*(do\s*mes|mensal|atual|desse|deste)/.test(n)) cand.push([iRec, 'receitaMes'])
    if (cand.length) {
      cand.sort((a, b) => a[0] - b[0])
      return cand[0][1]
    }
    if (temFolha) return 'folha12'
    if (temReceita) return 'receitaMes'
    return 'rbt12'
  }
  return null
}

/**
 * Extrai percentual aplicado sobre o RBT12 ("30% do RBT", "28% do faturamento").
 * Retorna a fração (0.30) ou null. Puro.
 */
export function extrairPercentualDeRBT(texto: string): number | null {
  const t = String(texto ?? ' ')
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:do|da|de|sobre)?\s*(rbt(?:\s*12)?|faturamento|receita\s*bruta)/i)
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0 || v > 100) return null
  return v / 100
}

/**
 * Resolve folha via percentual do RBT12 ("aumenta folha pra 30% do RBT").
 * Precisa do RBT12 de contexto. Retorna o valor absoluto ou null.
 */
export function resolverFolhaPercentual(texto: string, rbt12: number | null): number | null {
  const pct = extrairPercentualDeRBT(texto)
  if (pct == null || !(Number(rbt12) > 0)) return null
  return Math.round(Number(rbt12) * pct * 100) / 100
}

/* ------------------------------------------------------------------ */
/* v7 — memória em pilha + motor de intenção contínua                  */
/* ------------------------------------------------------------------ */

/** Anexos que exigem Fator R (folha). I/II/IV dispensam — folha arquivada. */
export const ANEXOS_COM_FATOR_R: AnexoId[] = ['III', 'V']

/** `true` quando o anexo usa folha/Fator R (III ou V). */
export function anexoExigeFolha(anexo: AnexoId | null | undefined): boolean {
  return anexo === 'III' || anexo === 'V'
}

export interface TurnoSimples {
  n: number
  anexo: AnexoId | null
  rbt12: number | null
  receitaMes: number | null
  folha12: number | null
  frase: string
}

export interface MemoriaPilhaSimples {
  turnos: TurnoSimples[]
  topo: TurnoSimples | null
}

/**
 * Reconstrói a pilha de turnos do Simples (ordem cronológica, cap 20).
 * Cada fala do usuário é extraída ISOLADA — nada de `join` cego (que fazia
 * o primeiro valor vencer o `match` e congelava o `ultimoRbt12` no passado).
 * Falas sem nenhum slot são ignoradas (não empilham ruído).
 */
export function historicoSlotsSimples(falas: string[]): MemoriaPilhaSimples {
  const turnos: TurnoSimples[] = []
  const lista = Array.isArray(falas) ? falas : []
  lista.slice(-20).forEach((frase, i) => {
    try {
      const s = extrairSlotsSimples(String(frase ?? ' '))
      if (s.anexo != null || s.rbt12 != null || s.receitaMes != null || s.folha12 != null) {
        turnos.push({ n: i, anexo: s.anexo, rbt12: s.rbt12, receitaMes: s.receitaMes, folha12: s.folha12, frase: String(frase).slice(0, 200) })
      }
    } catch {
      /* fala ilegível nunca quebra a pilha */
    }
  })
  return { turnos, topo: turnos.length ? turnos[turnos.length - 1] : null }
}

/* v7 — aplicarEdicaoSimples com pilha (abaixo) */

/**
 * Resolve referência temporal a valor ("primeiro/último/anterior/aquele").
 * - `primeiro/inicial/original` → lista[0]
 * - `ultimo/atual` → lista[lista.length-1]
 * - `anterior/penultimo/antes/de antes/como estava` (+ `volta/desfaz/reverte`)
 *   → penúltimo valor distinto do topo
 * Retorna null quando não há referência ou a pilha não resolve.
 */
export function resolverValorPorReferencia(
  texto: string,
  lista: number[],
): number | null {
  const n = normSimples(String(texto ?? ' '))
  const vals = (Array.isArray(lista) ? lista : []).filter((v) => Number.isFinite(v))
  if (!vals.length) return null
  const topo = vals[vals.length - 1]
  if (/primeiro|inicial|original|primeira/.test(n)) return vals[0]
  if (/ultimo|ultima|atual/.test(n)) return topo
  if (/anterior|penultimo|antes|como estava|de antes|volta|voltar|desfaz|reverte|retorna/.test(n)) {
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i] !== topo) return vals[i]
    }
    return topo
  }
  return null
}

/**
 * Resolve "o outro anexo" contra a pilha.
 * - Com anexo explícito na frase, o explícito sempre vence.
 * - Sem explícito: candidatos = anexos distintos empilhados; "outro" = o mais
 *   recente distinto do topo. Com 0–1 candidato, retorna null (o orquestrador
 *   PERGUNTA em vez de chutar).
 */
export function resolverAnexoPorReferencia(
  texto: string,
  historicoAnexos: AnexoId[],
  topoAnexo: AnexoId | null,
  anexoExplicito: AnexoId | null,
): AnexoId | null {
  if (anexoExplicito != null) return anexoExplicito
  const n = normSimples(String(texto ?? ' '))
  if (!/outro|outra|aquele|aquela|esse|essa|anterior|primeiro|ultimo/.test(n)) return null
  const distintos: AnexoId[] = []
  for (const a of historicoAnexos ?? []) {
    if (a != null && !distintos.includes(a)) distintos.push(a)
  }
  if (/primeiro|inicial|original/.test(n)) return distintos[0] ?? null
  if (/anterior|penultimo|antes|volta|desfaz|reverte/.test(n)) {
    for (let i = distintos.length - 1; i >= 0; i--) {
      if (distintos[i] !== topoAnexo) return distintos[i]
    }
    return null
  }
  // "o outro / aquele": o distinto mais recente diferente do topo.
  for (let i = historicoAnexos.length - 1; i >= 0; i--) {
    const a = historicoAnexos[i]
    if (a != null && a !== topoAnexo) return a
  }
  return null
}

export type TipoIntencaoSimples = 'reverte' | 'troca_anexo' | 'edita_slot' | 'novo_calculo' | 'comparativo' | 'indefinida'

export interface IntencaoSimples {
  tipo: TipoIntencaoSimples
  confianca: number
  slotAlvo: 'rbt12' | 'receitaMes' | 'folha12' | 'anexo' | null
}

/**
 * Motor de intenção contínua (probabilístico, puro e testável).
 * Ordem: `reverte > troca_anexo > edita_slot > novo_calculo`; `comparativo`
 * (`qual melhor/compara/vale a pena/III ou V`) é avaliado ANTES de tudo para
 * não ser roubado por `classificarSlotEdicao` ("anexo" ≠ edição).
 */
export function observarIntencaoSimples(
  texto: string,
  opts?: { temContexto?: boolean; qtdAnexosDistintos?: number },
): IntencaoSimples {
  const n = normSimples(String(texto ?? ' '))
  const temCtx = !!opts?.temContexto
  // Comparativo nunca é edição ("qual melhor, III ou V?").
  if (/qual melhor|qual compensa|vale a pena|compara|iii ou v|iii x v|convencional ou hibrido|conv x hib/.test(n)) {
    return { tipo: 'comparativo', confianca: 0.9, slotAlvo: null }
  }
  const temVolta = /volta|voltar|desfaz|reverte|retorna|como estava/.test(n)
  const temAnterior = /anterior|penultimo|antes|de antes/.test(n)
  const temPrimeiro = /primeiro|primeira|inicial|original/.test(n)
  const temOutro = /outro|outra|aquele|aquela/.test(n)
  const temMesmos = /mesmos valores|mantendo|mantem tudo|com esses numeros|so troca|somente.*anexo|mesmos numeros/.test(n)
  const temTroca = /troca|muda.*anexo|vai para.*anexo|e no anexo|calcula no|faz no/.test(n)
  const anexoCit = /(anexo|anx|anex)\s*(iv|v|i{1,3}|[1-5])/.test(n)
  if ((temVolta || temAnterior) && temCtx) {
    return { tipo: 'reverte', confianca: temVolta ? 0.95 : 0.85, slotAlvo: classificarSlotEdicao(texto) }
  }
  if (temPrimeiro && temCtx) {
    return { tipo: 'reverte', confianca: 0.9, slotAlvo: classificarSlotEdicao(texto) }
  }
  if ((anexoCit && temCtx && (temTroca || temMesmos || temOutro)) || (temMesmos && anexoCit)) {
    return { tipo: 'troca_anexo', confianca: temMesmos ? 0.95 : 0.85, slotAlvo: 'anexo' }
  }
  if (temOutro && /anexo|anx|anex/.test(n) && temCtx) {
    const qtd = Number(opts?.qtdAnexosDistintos ?? 1)
    return { tipo: 'troca_anexo', confianca: qtd >= 2 ? 0.7 : 0.55, slotAlvo: 'anexo' }
  }
  const slot = classificarSlotEdicao(texto)
  const temNumero = /\d/.test(texto) || /%/.test(texto)
  const temVerboEd = /troca|muda|corrige|altera|bota|coloca|aumenta|reduz|refaz|recalcula|considera|e se|e com/.test(n)
  if (slot != null && (temNumero || temVerboEd) && temCtx) {
    return { tipo: 'edita_slot', confianca: temNumero ? 0.9 : 0.75, slotAlvo: slot }
  }
  if (slot == null && temNumero && temCtx) {
    return { tipo: 'edita_slot', confianca: 0.8, slotAlvo: null }
  }
  // 2+ valores + anexo na mesma frase = cálculo novo (ignora pilha).
  const qtdVals = (String(texto).match(/\d[\d.,]*\s*(mil|mi|k|M|milh|reais)?/gi) ?? []).length
  if (anexoCit && qtdVals >= 2) {
    return { tipo: 'novo_calculo', confianca: 0.9, slotAlvo: null }
  }
  return { tipo: 'indefinida', confianca: 0.4, slotAlvo: slot }
}

/** `true` quando a frase pede explicitamente outro anexo sem nomeá-lo. */
export function ehPedidoOutroAnexoAmbiguo(texto: string, anexoExplicito: AnexoId | null): boolean {
  if (anexoExplicito != null) return false
  const n = normSimples(String(texto ?? ' '))
  return /anexo/.test(n) && /outro|outra|aquele|aquela/.test(n)
}

export function extrairAnexoRobusto(texto: string): AnexoId | null {
  const t = normSimples(texto)
  // Abreviações: anx/anex/anexo ("anx3", "anx 1", "anexo 3", "terceiro anexo").
  let m = t.match(/(?:anexo|anex|anx)\s*(iv|v|i{1,3}|[1-5]|primeiro|segundo|terceiro|quarto|quinto)/)
  if (m) {
    const v = m[1].toLowerCase()
    const mapa: Record<string, AnexoId> = {
      i: 'I', ii: 'II', iii: 'III', iv: 'IV', v: 'V',
      '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
      primeiro: 'I', segundo: 'II', terceiro: 'III', quarto: 'IV', quinto: 'V',
    }
    return mapa[v] ?? null
  }
  m = t.match(/(primeiro|segundo|terceiro|quarto|quinto|[1-5])\s*(?:º|o)?\s*(?:anexo|anex|anx)/)
  if (m) {
    const mapa: Record<string, AnexoId> = {
      primeiro: 'I', segundo: 'II', terceiro: 'III', quarto: 'IV', quinto: 'V',
      '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
    }
    return mapa[m[1].toLowerCase()] ?? null
  }
  return null
}

/**
 * Extrai os slots do Simples com desambiguação fixa (sem chute):
 * ancorado por rótulo vence; receita qualificada nunca é roubada pelo
 * faturamento genérico; sobras sem rótulo vão por ordem (RBT12, receita).
 */
export function extrairSlotsSimples(texto: string): SlotsSimples {
  const t = String(texto ?? ' ')
  const receitaMes = pegaAncorado(t, LBL_RECEITA)
  let rbt12 = pegaAncorado(t, LBL_RBT12)
  // "faturamento genérico" só vira RBT12 se a receita já não foi ancorada.
  if (rbt12 == null && receitaMes == null) {
    const todos = extrairTodosValores(t)
    if (todos.length >= 1) rbt12 = todos[0].valor
  }
  let receitaFinal = receitaMes
  if (receitaFinal == null) {
    const todos = extrairTodosValores(t)
    const livres = todos.map((x) => x.valor).filter((v) => v !== rbt12)
    if (livres.length >= 1) receitaFinal = livres[rbt12 == null ? 1 : 0] ?? livres[0] ?? null
    // Caso "RBT12 500 mil e receita 40 mil": o 2º número é a receita.
    if (rbt12 != null && livres.length === 0) {
      const todos2 = extrairTodosValores(t)
      if (todos2.length >= 2) receitaFinal = todos2[1].valor
    }
  }
  // Folha via percentual ("30% do RBT") não é valor monetário direto:
  // `mascararNaoDinheiro` apaga o "%", então resolve aqui contra o RBT.
  let folha = pegaAncorado(t, LBL_FOLHA)
  if (folha == null && rbt12 != null) {
    const pctFolha = resolverFolhaPercentual(t, rbt12)
    if (pctFolha != null) folha = pctFolha
  }
  return {
    anexo: extrairAnexoRobusto(t),
    rbt12,
    receitaMes: receitaFinal,
    folha12: folha,
    rba: pegaAncorado(t, LBL_RBA),
    valorBase: pegaAncorado(t, LBL_BASE),
  }
}

export interface ContextoSlotsSimples {
  ultimoAnexo?: AnexoId | null
  ultimoRbt12?: number | null
  ultimaReceita?: number | null
  ultimaFolha?: number | null
}

/**
 * Mescla os slots do turno atual com o contexto da conversa (fine-tuning v6).
 *
 * Regra anti-`RBT fantasma` (o bug do follow-up):
 * - Se a frase atual NÃO tem rótulo de RBT/receita/folha e traz 1 único valor
 *   avulso ("e com 200 mil?", "corrige para 1,2mi"), NÃO sobrescreve o RBT12.
 *   O valor vai para o slot classificado (`classificarSlotEdicao`) ou, sem
 *   pista, para a folha quando RBT+receita já existem (caso Fator R), senão
 *   pergunta (retorna sem alterar e sinaliza `ambiguo`).
 * - Com rótulo explícito, o slot rotulado vence e os demais herdam o contexto.
 * - Percentual-do-RBT ("30% do RBT") sempre resolve para folha contra o RBT
 *   (atual ou de contexto).
 */
export function aplicarEdicaoSimples(
  pergunta: string,
  slotsTurno: SlotsSimples,
  ctx: ContextoSlotsSimples,
  pilha?: MemoriaPilhaSimples | null,
): { rbt12: number | null; receitaMes: number | null; folha12: number | null; anexo: AnexoId | null; slotAlterado: 'rbt12' | 'receitaMes' | 'folha12' | 'anexo' | null; ambiguo: boolean; observacao?: 'volta' | 'primeiro' | 'mesmos_valores' | 'folha_arquivada' | null } {
  const t = normalizarTyposValores(String(pergunta ?? ' '))
  const slotAlvo = classificarSlotEdicao(t)
  const temRotuloRbt = pegaAncorado(t, LBL_RBT12) != null
  const temRotuloRec = pegaAncorado(t, LBL_RECEITA) != null
  const temRotuloFolha = pegaAncorado(t, LBL_FOLHA) != null || extrairPercentualDeRBT(t) != null
  const temAnexo = slotsTurno.anexo != null
  const temQualquerRotulo = temRotuloRbt || temRotuloRec || temRotuloFolha || temAnexo
  const valoresAvulsos = extrairTodosValores(t)
  const temContexto = ctx.ultimoRbt12 != null || ctx.ultimaReceita != null || ctx.ultimaFolha != null || ctx.ultimoAnexo != null
  const nNorm = normSimples(t)
  const pedePrimeiro = /primeiro|primeira|inicial|original/.test(nNorm)
  const pedeAnterior = /anterior|penultimo|antes|como estava|de antes/.test(nNorm)
  const pedeVolta = /volta|voltar|desfaz|reverte|retorna/.test(nNorm)
  const pedeMesmos = /mesmos valores|mantendo|mantem tudo|com esses numeros|so troca|somente.*anexo|mesmos numeros/.test(nNorm)
  const rbtLista = (pilha?.turnos ?? []).map((x) => x.rbt12).filter((v): v is number => v != null)
  const recLista = (pilha?.turnos ?? []).map((x) => x.receitaMes).filter((v): v is number => v != null)
  const folhaLista = (pilha?.turnos ?? []).map((x) => x.folha12).filter((v): v is number => v != null)
  const anexoLista = (pilha?.turnos ?? []).map((x) => x.anexo).filter((v): v is AnexoId => v != null)

  // Percentual-do-RBT tem prioridade sobre tudo ("aumenta folha pra 30% do RBT"):
  // resolve contra o RBT final (turno atual ou contexto), mesmo com folha antiga.
  const pctRbt = extrairPercentualDeRBT(t)
  if (pctRbt != null) {
    const baseRbt = temRotuloRbt && slotsTurno.rbt12 != null ? slotsTurno.rbt12 : (ctx.ultimoRbt12 ?? slotsTurno.rbt12 ?? null)
    if (baseRbt != null && baseRbt > 0) {
      const folhaPct = Math.round(baseRbt * pctRbt * 100) / 100
      return {
        rbt12: temRotuloRbt && slotsTurno.rbt12 != null ? slotsTurno.rbt12 : (ctx.ultimoRbt12 ?? slotsTurno.rbt12 ?? null),
        receitaMes: temRotuloRec && slotsTurno.receitaMes != null ? slotsTurno.receitaMes : (ctx.ultimaReceita ?? slotsTurno.receitaMes ?? null),
        folha12: folhaPct,
        anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null,
        slotAlterado: 'folha12',
        ambiguo: false,
      }
    }
  }

  // Follow-up com contexto: SÓ slots rotulados vencem; fantasmas do fallback
  // ("E COM FOLHA DE 200 MIL?" gerava rbt=200k via todos[0]) são ignorados.
  if (temContexto) {
    // v7 — "e no outro anexo?" sem nome e sem número: resolve pela pilha antes
    // de qualquer branch (aqui temQualquerRotulo é false). Com 2+ candidatos,
    // alterna para o distinto do topo; sem isso, ambiguo → o orquestrador
    // PERGUNTA o destino em vez de chutar.
    if (!temQualquerRotulo && valoresAvulsos.length === 0 && ehPedidoOutroAnexoAmbiguo(t, slotsTurno.anexo)) {
      const resolvidoOutro = resolverAnexoPorReferencia(t, anexoLista, ctx.ultimoAnexo ?? null, slotsTurno.anexo)
      if (resolvidoOutro != null) {
        const arquivaOutro = !anexoExigeFolha(resolvidoOutro)
        return {
          rbt12: ctx.ultimoRbt12 ?? null,
          receitaMes: ctx.ultimaReceita ?? null,
          folha12: arquivaOutro ? null : (ctx.ultimaFolha ?? null),
          anexo: resolvidoOutro,
          slotAlterado: 'anexo',
          ambiguo: false,
          observacao: arquivaOutro ? 'folha_arquivada' : 'mesmos_valores',
        }
      }
      return {
        rbt12: ctx.ultimoRbt12 ?? null,
        receitaMes: ctx.ultimaReceita ?? null,
        folha12: ctx.ultimaFolha ?? null,
        anexo: ctx.ultimoAnexo ?? null,
        slotAlterado: null,
        ambiguo: true,
        observacao: null,
      }
    }
    // v7 — referências à pilha ("primeiro/anterior/volta") vencem o valor novo:
    // "volta para o RBT anterior", "usa o primeiro RBT", "volta a receita".
    if ((pedePrimeiro || pedeAnterior || pedeVolta) && slotAlvo != null && slotAlvo !== 'anexo' && !temRotuloRbt && !temRotuloRec && !temRotuloFolha && valoresAvulsos.length === 0) {
      const lista = slotAlvo === 'rbt12' ? rbtLista : slotAlvo === 'receitaMes' ? recLista : folhaLista
      const resolvido = pedePrimeiro ? (lista[0] ?? null) : resolverValorPorReferencia(t, lista)
      if (resolvido != null) {
        return {
          rbt12: slotAlvo === 'rbt12' ? resolvido : (ctx.ultimoRbt12 ?? null),
          receitaMes: slotAlvo === 'receitaMes' ? resolvido : (ctx.ultimaReceita ?? null),
          folha12: slotAlvo === 'folha12' ? resolvido : (ctx.ultimaFolha ?? null),
          anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null,
          slotAlterado: slotAlvo,
          ambiguo: false,
          observacao: pedePrimeiro ? 'primeiro' : 'volta',
        }
      }
    }
    // v7 — "aquele RBT de 600 mil": o número citado ancora na pilha (sem fantasma).
    // Como o número já vem rotulado, o branch rotulado abaixo resolve; nada extra.
    let rbt12: number | null
    let receitaMes: number | null
    let folha12: number | null
    if (temQualquerRotulo) {
      rbt12 = temRotuloRbt ? slotsTurno.rbt12 : (ctx.ultimoRbt12 ?? null)
      receitaMes = temRotuloRec ? slotsTurno.receitaMes : (ctx.ultimaReceita ?? null)
      folha12 = temRotuloFolha ? (slotsTurno.folha12 ?? ctx.ultimaFolha ?? null) : (ctx.ultimaFolha ?? null)
      // "refaz com folha mínima do Fator R" sem número: mantém folha atual
      // (o orquestrador mostra a mínima no bloco Fator R).
      let anexo = slotsTurno.anexo ?? ctx.ultimoAnexo ?? null
      // v7 — "o outro anexo" sem nome: resolve pela pilha; sem 2 candidatos,
      // mantém e deixa o orquestrador PERGUNTAR (nunca chuta).
      if (!temAnexo && ehPedidoOutroAnexoAmbiguo(t, null)) {
        const resolvido = resolverAnexoPorReferencia(t, anexoLista, ctx.ultimoAnexo ?? null, null)
        if (resolvido != null) {
          anexo = resolvido
        } else {
          return { rbt12, receitaMes, folha12, anexo: ctx.ultimoAnexo ?? null, slotAlterado: null, ambiguo: true, observacao: null }
        }
      }
      let slotAlterado: 'rbt12' | 'receitaMes' | 'folha12' | 'anexo' | null = null
      let observacao: 'volta' | 'primeiro' | 'mesmos_valores' | 'folha_arquivada' | null = null
      const ehTrocaAnexo = temAnexo && slotsTurno.anexo != null && slotsTurno.anexo !== ctx.ultimoAnexo
      if (ehTrocaAnexo) {
        slotAlterado = 'anexo'
        observacao = pedeMesmos || (!temRotuloRbt && !temRotuloRec && !temRotuloFolha) ? 'mesmos_valores' : null
        // v7 — troca de anexo: só carrega o que o destino exige. Folha para
        // I/II/IV é arquivada (some do eco), mas segue na pilha para a volta.
        if (!anexoExigeFolha(slotsTurno.anexo)) {
          folha12 = null
          observacao = 'folha_arquivada'
        }
      }
      else if (temRotuloFolha && folha12 != null && folha12 !== ctx.ultimaFolha) slotAlterado = 'folha12'
      else if (temRotuloRec && receitaMes != null && receitaMes !== ctx.ultimaReceita) slotAlterado = 'receitaMes'
      else if (temRotuloRbt && rbt12 != null && rbt12 !== ctx.ultimoRbt12) slotAlterado = 'rbt12'
      else if (slotAlvo != null && slotAlvo !== 'anexo') slotAlterado = slotAlvo
      return { rbt12, receitaMes, folha12, anexo, slotAlterado, ambiguo: false, observacao }
    }
    // Sem rótulo + 1 valor avulso ("e com 200 mil?"): classifica ou assume
    // folha quando RBT+receita já existem (caso Fator R); senão, ambíguo.
    if (valoresAvulsos.length === 1) {
      const unico = valoresAvulsos[0].valor
      const alvo = slotAlvo ?? (ctx.ultimoRbt12 != null && ctx.ultimaReceita != null ? 'folha12' : null)
      if (alvo === 'folha12') {
        return { rbt12: ctx.ultimoRbt12 ?? null, receitaMes: ctx.ultimaReceita ?? null, folha12: unico, anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null, slotAlterado: 'folha12', ambiguo: false }
      }
      if (alvo === 'receitaMes') {
        return { rbt12: ctx.ultimoRbt12 ?? null, receitaMes: unico, folha12: ctx.ultimaFolha ?? null, anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null, slotAlterado: 'receitaMes', ambiguo: false }
      }
      if (alvo === 'rbt12') {
        return { rbt12: unico, receitaMes: ctx.ultimaReceita ?? null, folha12: ctx.ultimaFolha ?? null, anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null, slotAlterado: 'rbt12', ambiguo: false }
      }
      return { rbt12: ctx.ultimoRbt12 ?? null, receitaMes: ctx.ultimaReceita ?? null, folha12: ctx.ultimaFolha ?? null, anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null, slotAlterado: null, ambiguo: true }
    }
    // Sem rótulo e sem valor único: mantém contexto (ex.: "refaz com folha mínima").
    return { rbt12: ctx.ultimoRbt12 ?? null, receitaMes: ctx.ultimaReceita ?? null, folha12: ctx.ultimaFolha ?? null, anexo: slotsTurno.anexo ?? ctx.ultimoAnexo ?? null, slotAlterado: slotAlvo === 'anexo' ? null : slotAlvo, ambiguo: false }
  }

  // Primeiro turno (sem contexto): usa o fallback posicional original.
  let rbt12 = slotsTurno.rbt12 ?? null
  let receitaMes = slotsTurno.receitaMes ?? null
  let folha12 = slotsTurno.folha12 ?? null
  let anexo = slotsTurno.anexo ?? null
  let slotAlterado: 'rbt12' | 'receitaMes' | 'folha12' | 'anexo' | null = null
  let ambiguo = false

  // Com rótulo: descobre o que realmente mudou vs. contexto (para o eco).
  if (temAnexo && slotsTurno.anexo != null && slotsTurno.anexo !== ctx.ultimoAnexo) slotAlterado = 'anexo'
  else if (temRotuloFolha && slotsTurno.folha12 != null && slotsTurno.folha12 !== ctx.ultimaFolha) slotAlterado = 'folha12'
  else if (temRotuloRec && slotsTurno.receitaMes != null && slotsTurno.receitaMes !== ctx.ultimaReceita) slotAlterado = 'receitaMes'
  else if (temRotuloRbt && slotsTurno.rbt12 != null && slotsTurno.rbt12 !== ctx.ultimoRbt12) slotAlterado = 'rbt12'
  else if (slotAlvo === 'folha12' && slotsTurno.folha12 != null) slotAlterado = 'folha12'
  else if (slotAlvo != null && slotAlvo !== 'anexo') slotAlterado = slotAlvo

  return { rbt12, receitaMes, folha12, anexo, slotAlterado, ambiguo }
}
