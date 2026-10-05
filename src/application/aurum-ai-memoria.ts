/**
 * Aurum AI — memória persistente e aprendizado contínuo (leve, offline-first).
 *
 * Técnica: memória episódica (conversas por emitente, já em `conversasEmitente`)
 * + memória semântica (perfil/fatos em `meta`, sem migração de banco) +
 * aprendizado por reforço simples (sinais de acerto/erro vindos do chat
 * alimentam `ia_feedback`, que o gate NCM/NBS já usa para demover
 * candidatos rejeitados).
 *
 * - Lembra nome/preferências entre sessões e entre seções (perfil global por
 *   emitente, não por conversa).
 * - Cordial: usa o nome em saudações/agradecimentos/despedidas.
 * - Aprende com todo chat: confirmações reforçam, correções penalizam
 *   (via `ia_feedback` + fato `termo -> código` confirmado).
 * - 100% local (Dexie `meta` + `localStorage` fallback p/ testes), best-effort:
 *   nunca trava o chat.
 */

import { normalizarBusca } from '@/domain/services/busca-texto'

export interface PerfilMemoria {
  /** Nome do usuário ("David"). */
  nome: string | null
  /** Como chamar (por padrão = primeiro nome). */
  comoChamar: string | null
  /** Contador de interações (para "ao longo da vida do software"). */
  interacoes: number
  /** Última vez que o perfil foi atualizado (ISO). */
  atualizadoEm: string | null
  /**
   * Padrões de conversa aprendidos (fine-tuning v5 — fluxos simples).
   * Contagem de intenções por turno: o chat personaliza sugestões e
   * saudações sem novas consultas (zero I/O extra — vem do perfil em cache).
   */
  padroes?: PadroesConversa | null
}

/**
 * Padrões de conversa do usuário (aprendizado leve e local).
 * `intents` conta quantos turnos caíram em cada intenção; `total` é o
 * número de turnos registrados. Só intenções reais (sem teto por chave).
 */
export interface PadroesConversa {
  intents: Record<string, number>
  total: number
  atualizadoEm: string | null
}

export const PADROES_VAZIOS: PadroesConversa = { intents: {}, total: 0, atualizadoEm: null }

/** Soma um turno aos padrões (puro — não persiste). */
export function contarTurno(padroes: PadroesConversa | null | undefined, intencao: string): PadroesConversa {
  const base: PadroesConversa = padroes ?? { ...PADROES_VAZIOS, intents: { ...PADROES_VAZIOS.intents } }
  const intents = { ...base.intents }
  const chave = String(intencao || 'generico')
  intents[chave] = (Number(intents[chave]) || 0) + 1
  return { intents, total: (Number(base.total) || 0) + 1, atualizadoEm: new Date().toISOString() }
}

/** Intenção dominante quando há padrão estabelecido (mínimo 3 turnos). */
export function intencaoDominante(padroes: PadroesConversa | null | undefined, minimo = 3): string | null {
  const p = padroes
  if (!p || (Number(p.total) || 0) < minimo) return null
  let melhor: string | null = null
  let melhorVotos = 0
  for (const [k, v] of Object.entries(p.intents ?? {})) {
    if (v > melhorVotos) {
      melhorVotos = v
      melhor = k
    }
  }
  return melhorVotos >= 2 ? melhor : null
}

export const PERFIL_VAZIO: PerfilMemoria = {
  nome: null,
  comoChamar: null,
  interacoes: 0,
  atualizadoEm: null,
}

/** Palavras que NÃO são nome (atividade/estado, não pessoa). */
const NAO_NOMES = new Set([
  'comerciante', 'lojista', 'empresario', 'empresaria', 'contador', 'contadora',
  'medico', 'medica', 'advogado', 'advogada', 'engenheiro', 'professor', 'professora',
  'estudante', 'cliente', 'fornecedor', 'mei', 'simples', 'empresa', 'humano',
  'brasileiro', 'brasileira', 'curioso', 'curiosa', 'novo', 'nova', 'velho',
])

/**
 * Extrai nome declarado ("meu nome é David", "me chamo Ana Souza",
 * "me chama de Dani", "sou o Carlos"). Retorna null se não houver declaração.
 * Puro e testável.
 */
export function extrairNomeDeTexto(texto: unknown): string | null {
  const cru = String(texto ?? '').trim()
  if (!cru || cru.length > 120) return null
  const m = cru.match(
    /(?:meu nome (?:é|e)|me chamo|me chama de|pode me chamar de|sou (?:o|a) |eu sou (?:o|a) |eu sou |meu apelido (?:é|e))\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'´`-]*(?:\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'´`-]*){0,2})/i,
  )
  if (!m?.[1]) return null
  let nome = m[1].trim().replace(/\s*[.!,?;:\s]+$/, '').trim()
  // Corta cauda ("David e sou contador" → "David").
  nome = nome.split(/\s+e\s+/i)[0].trim()
  const partes = nome.split(/\s+/).filter(Boolean)
  if (!partes.length || partes.length > 3) return null
  // Cada parte: 2–20 letras, primeira maiúscula ou texto todo simples.
  for (const p of partes) {
    const limpo = p.replace(/[^A-Za-zÀ-ú]/g, '')
    if (limpo.length < 2 || limpo.length > 20) return null
    if (NAO_NOMES.has(normalizarBusca(limpo))) return null
  }
  // Capitaliza ("david" → "David").
  const bonito = partes
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
  if (normalizarBusca(bonito).length < 2) return null
  return bonito
}

/** `true` quando o usuário declara o nome nesta frase. */
export function ehDeclaracaoNome(texto: unknown): boolean {
  return extrairNomeDeTexto(texto) != null
}

/** `true` quando pergunta o que a IA lembra ("qual meu nome?", "o que sabe sobre mim?"). */
export function ehPerguntaMemoria(texto: unknown): boolean {
  const n = normalizarBusca(texto)
  if (!n) return false
  return (
    /qual (e |eh )?(o )?meu nome/.test(n) ||
    /voce (lembra|sabe|conhece)( o)? meu nome/.test(n) ||
    /meu nome$/.test(n) ||
    /o que voce (sabe|lembra|guardou|registrou)( sobre mim| de mim)?/.test(n) ||
    /quem sou eu/.test(n)
  )
}

export type SinalAprendizado = 'confirmacao' | 'correcao' | null

/**
 * Sinal de aprendizado da frase (reforço simples):
 * - confirmação ("isso mesmo", "obrigado, era isso", "perfeito") → reforça;
 * - correção ("não é esse", "errado", "não era isso") → penaliza via ia_feedback.
 * Puro e testável.
 */
export function extrairSinalAprendizado(texto: unknown): SinalAprendizado {
  const n = ` ${normalizarBusca(texto)} `
  if (!n.trim()) return null
  if (
    / nao (e|eh) esse /.test(n) ||
    / nao era isso /.test(n) ||
    / voce errou /.test(n) ||
    / classificacao errada /.test(n) ||
    / ncm errado /.test(n) ||
    / errado /.test(n) && /ncm|nbs|classific/.test(n)
  ) {
    return 'correcao'
  }
  if (
    / isso mesmo /.test(n) ||
    / era isso /.test(n) ||
    / exatamente isso /.test(n) ||
    / perfeito /.test(n) && /obrigad|valeu|isso/.test(n) ||
    / obrigad(o|a) era isso /.test(n)
  ) {
    return 'confirmacao'
  }
  return null
}

/** Primeiro nome para tratamento cordial ("Ana Souza" → "Ana"). */
export function primeiroNome(perfil: PerfilMemoria | null | undefined): string | null {
  const base = perfil?.comoChamar ?? perfil?.nome ?? null
  if (!base) return null
  const p = String(base).trim().split(/\s+/)[0]
  return p || null
}

/** "Olá, David! ..." — vazio quando sem nome (nunca "Olá, null"). */
export function vocativo(perfil: PerfilMemoria | null | undefined): string {
  const n = primeiroNome(perfil)
  return n ? `, ${n}` : ''
}

/* ------------------------------------------------- persistência -- */

/**
 * Fila serializada de escritas (fine-tuning v5): turnos chegam em rajada e
 * cada escrita é ler-modificar-gravar — sem fila, contagens se perdem.
 * Leituras nunca passam pela fila (só escritas).
 */
let filaEscrita: Promise<unknown> = Promise.resolve()

function emSerie<T>(fn: () => Promise<T>): Promise<T> {
  const p = filaEscrita.then(fn, fn)
  filaEscrita = p.catch(() => null)
  return p
}

/** Aguarda as escritas pendentes (testes/diagnóstico). */
export function descarregarMemoria(): Promise<void> {
  return emSerie(async () => undefined)
}

/** Chave do emitente (mesma convenção do chat). */
export function emitenteIdAtual(): string {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('aurum_emitente_id') : null
    if (ls) return ls
  } catch {
    /* segue default */
  }
  return 'default'
}

function chavePerfil(emitenteId: string): string {
  return `aurum_memoria_perfil__${emitenteId}`
}

function chaveFato(emitenteId: string, termo: string): string {
  return `aurum_memoria_fato__${emitenteId}__${normalizarBusca(termo).slice(0, 60)}`
}

function lerLocal(chave: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(chave) : null
  } catch {
    return null
  }
}

function gravarLocal(chave: string, valor: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(chave, valor)
  } catch {
    /* memória nunca trava o chat */
  }
}

async function lerMeta(chave: string): Promise<unknown | null> {
  try {
    const { db } = await import('@/infrastructure/db/schema')
    const row = await db.table('meta').get(chave).catch(() => null)
    const v = (row as { valor?: unknown } | null)?.valor
    return v ?? null
  } catch {
    return null
  }
}

async function gravarMeta(chave: string, valor: unknown): Promise<void> {
  try {
    const { db } = await import('@/infrastructure/db/schema')
    await db.table('meta').put({ chave, valor }).catch(() => null)
  } catch {
    /* best-effort */
  }
}

/** Carrega o perfil do emitente (Dexie `meta` + espelho localStorage). */
export async function carregarPerfilMemoria(emitenteId?: string): Promise<PerfilMemoria> {
  const id = emitenteId ?? emitenteIdAtual()
  // 1) Dexie (fonte principal, sobrevive entre seções).
  const viaMeta = await lerMeta(chavePerfil(id)).catch(() => null)
  if (viaMeta && typeof viaMeta === 'object') {
    const p = viaMeta as Partial<PerfilMemoria>
    if (typeof p.nome === 'string' || p.nome == null) {
      return {
        nome: typeof p.nome === 'string' && p.nome ? p.nome : null,
        comoChamar: typeof p.comoChamar === 'string' && p.comoChamar ? p.comoChamar : null,
        interacoes: Number(p.interacoes) || 0,
        atualizadoEm: typeof p.atualizadoEm === 'string' ? p.atualizadoEm : null,
        padroes: padroesValidos(p.padroes),
      }
    }
  }
  // 2) Fallback local (testes / Dexie indisponível).
  try {
    const raw = lerLocal(chavePerfil(id))
    if (raw) {
      const p = JSON.parse(raw) as Partial<PerfilMemoria>
      return {
        nome: typeof p.nome === 'string' && p.nome ? p.nome : null,
        comoChamar: typeof p.comoChamar === 'string' && p.comoChamar ? p.comoChamar : null,
        interacoes: Number(p.interacoes) || 0,
        atualizadoEm: typeof p.atualizadoEm === 'string' ? p.atualizadoEm : null,
        padroes: padroesValidos(p.padroes),
      }
    }
  } catch {
    /* segue vazio */
  }
  return { ...PERFIL_VAZIO }
}

/** Valida os padrões vindos do storage (nunca confia em dado persistido). */
function padroesValidos(v: unknown): PadroesConversa | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Partial<PadroesConversa>
  if (typeof p.intents !== 'object' || !p.intents) return null
  const intents: Record<string, number> = {}
  for (const [k, val] of Object.entries(p.intents)) {
    const n = Number(val)
    if (k && Number.isFinite(n) && n > 0) intents[k.slice(0, 32)] = Math.min(100000, Math.floor(n))
  }
  return { intents, total: Number(p.total) || 0, atualizadoEm: typeof p.atualizadoEm === 'string' ? p.atualizadoEm : null }
}

/** Salva o perfil (Dexie + espelho local). */
export async function salvarPerfilMemoria(perfil: PerfilMemoria, emitenteId?: string): Promise<void> {
  const id = emitenteId ?? emitenteIdAtual()
  const dado = { ...perfil, atualizadoEm: new Date().toISOString() }
  gravarLocal(chavePerfil(id), JSON.stringify(dado))
  await gravarMeta(chavePerfil(id), dado).catch(() => null)
}

/** Declara o nome ("meu nome é David") e persiste. Devolve o nome ou null. */
export async function declararNomeMemoria(texto: string, emitenteId?: string): Promise<string | null> {
  const nome = extrairNomeDeTexto(texto)
  if (!nome) return null
  return emSerie(async () => {
    const id = emitenteId ?? emitenteIdAtual()
    const atual = await carregarPerfilMemoria(id).catch(() => ({ ...PERFIL_VAZIO }))
    await salvarPerfilMemoria(
      { ...atual, nome, comoChamar: nome.split(' ')[0], interacoes: (atual.interacoes || 0) + 1, atualizadoEm: new Date().toISOString() },
      id,
    ).catch(() => null)
    return nome
  })
}

/** Incrementa o contador de interações (vida do software). Best-effort. */
export async function contarInteracaoMemoria(emitenteId?: string): Promise<void> {
  return emSerie(async () => {
    try {
      const id = emitenteId ?? emitenteIdAtual()
      const atual = await carregarPerfilMemoria(id).catch(() => ({ ...PERFIL_VAZIO }))
      await salvarPerfilMemoria({ ...atual, interacoes: (atual.interacoes || 0) + 1 }, id).catch(() => null)
    } catch {
      /* nunca trava */
    }
  })
}

/**
 * Registra um turno completo em UMA escrita (fine-tuning v5 — fluxos
 * simples): interações + intenção do turno nos padrões. Substitui
 * `contarInteracaoMemoria` nos caminhos do chat (fast e full) para que a
 * rotina aprenda o padrão de conversa sem consultas extras.
 */
export async function registrarTurnoMemoria(intencao: string, emitenteId?: string): Promise<void> {
  return emSerie(async () => {
    try {
      const id = emitenteId ?? emitenteIdAtual()
      const atual = await carregarPerfilMemoria(id).catch(() => ({ ...PERFIL_VAZIO }))
      await salvarPerfilMemoria(
        { ...atual, interacoes: (atual.interacoes || 0) + 1, padroes: contarTurno(atual.padroes, intencao) },
        id,
      ).catch(() => null)
    } catch {
      /* nunca trava */
    }
  })
}

export interface FatoAprendido {
  termo: string
  codigo: string
  tipo: 'ncm' | 'nbs'
  /** +1 confirmação · −1 correção (reforço simples). */
  peso: number
  atualizadoEm: string
}

/**
 * Registra aprendizado termo → código (reforço simples com decaimento implícito
 * pelo peso acumulado). Correções negativas alimentam também o `ia_feedback`
 * (o gate já demove rejeitados). Best-effort.
 */
export async function registrarAprendizadoTermo(
  termo: string,
  codigo: string,
  tipo: 'ncm' | 'nbs',
  sinal: 'confirmacao' | 'correcao',
  emitenteId?: string,
): Promise<void> {
  return emSerie(async () => {
    try {
    const id = emitenteId ?? emitenteIdAtual()
    const chave = chaveFato(id, termo)
    const anterior = ((await lerMeta(chave).catch(() => null)) as FatoAprendido | null) ?? null
    const peso = (anterior?.peso ?? 0) + (sinal === 'confirmacao' ? 1 : -1)
    const fato: FatoAprendido = {
      termo: normalizarBusca(termo).slice(0, 80),
      codigo: String(codigo).replace(/\D+/g, ''),
      tipo,
      peso: Math.max(-5, Math.min(5, peso)),
      atualizadoEm: new Date().toISOString(),
    }
    gravarLocal(chave, JSON.stringify(fato))
    await gravarMeta(chave, fato).catch(() => null)
    if (sinal === 'correcao') {
      try {
        const { db } = await import('@/infrastructure/db/schema')
        await db
          .table('ia_feedback')
          .add({
            quando: new Date().toISOString(),
            descricao: termo.slice(0, 200),
            via: 'aurum-chat',
            decisao: fato.codigo,
            confianca: 0,
            motivo: 'correcao-usuario-chat',
          })
          .catch(() => null)
      } catch {
        /* sem Dexie: segue */
      }
    }
    } catch {
      /* aprendizado nunca trava o chat */
    }
  })
}

/** Recupera o fato aprendido para um termo (para re-ranquear / atalho). */
export async function fatoAprendidoPara(termo: string, emitenteId?: string): Promise<FatoAprendido | null> {
  try {
    const id = emitenteId ?? emitenteIdAtual()
    const chave = chaveFato(id, termo)
    const viaMeta = ((await lerMeta(chave).catch(() => null)) as FatoAprendido | null) ?? null
    if (viaMeta && viaMeta.codigo) return viaMeta
    const raw = lerLocal(chave)
    if (raw) {
      const f = JSON.parse(raw) as FatoAprendido
      if (f?.codigo) return f
    }
  } catch {
    /* segue null */
  }
  return null
}

function prefixoFatos(emitenteId: string): string {
  return `aurum_memoria_fato__${emitenteId}__`
}

/**
 * Lista os fatos aprendidos do emitente (para o artefato-resumo).
 * Dexie `meta` por prefixo + espelho localStorage. Best-effort, sem throw.
 */
export async function listarFatosMemoria(emitenteId?: string, limite = 20): Promise<FatoAprendido[]> {
  const out: FatoAprendido[] = []
  try {
    const id = emitenteId ?? emitenteIdAtual()
    const prefixo = prefixoFatos(id)
    try {
      const { db } = await import('@/infrastructure/db/schema')
      const linhas = await db.table('meta').where('chave').startsWith(prefixo).toArray().catch(() => [])
      for (const l of linhas as { valor?: unknown }[]) {
        const f = l?.valor as FatoAprendido | null
        if (f && typeof f.codigo === 'string' && f.codigo) out.push(f)
      }
    } catch {
      /* segue para o espelho local */
    }
    if (!out.length) {
      try {
        if (typeof localStorage !== 'undefined') {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (!k || !k.startsWith(prefixo)) continue
            try {
              const f = JSON.parse(localStorage.getItem(k) ?? 'null') as FatoAprendido
              if (f && typeof f.codigo === 'string' && f.codigo) out.push(f)
            } catch {
              /* item ilegível: ignora */
            }
          }
        }
      } catch {
        /* sem storage */
      }
    }
  } catch {
    /* nunca joga */
  }
  out.sort((a, b) => Math.abs(b.peso) - Math.abs(a.peso))
  return out.slice(0, Math.max(1, limite))
}
