/**
 * Mini-IA de comportamento da Aurinha — 100% local, sem rede, sem modelo.
 *
 * Ela observa o uso (views visitadas, acertos, erros, carinhos, voos) e
 * dispara pequenas rotinas de comportamento: saudações por turno, dicas
 * contextuais, comemoração de sequência boa, apoio após erros e o modo
 * sentinela noturna. Tudo com cooldown para nunca virar spam.
 *
 * Desenho para leveza e teste:
 * - `decidirAcaoIA` é pura (perfil + evento + agora → ação ou `null`);
 * - `registrarEventoPet`/`saudacaoInicialPet` são a casca com estado
 *   (persistência em `localStorage`, teto de 100 eventos em memória).
 */

import { usePet, type PetMood } from './pet'

export type EventoPet =
  | { tipo: 'view'; view: string }
  | { tipo: 'sucesso' }
  | { tipo: 'erro' }
  | { tipo: 'carinho' }
  | { tipo: 'voo' }
  | { tipo: 'despertar' }

/** Perfil agregado do humano — o que a IA "aprendeu" nesta máquina. */
export interface PerfilPet {
  visitasPorView: Record<string, number>
  viewsDistintas: string[]
  sucessosSeguidos: number
  errosRecentes: number[]
  carinhos: number
  voos: number
  /** `executadaEm` por regra — base do cooldown. */
  cooldowns: Record<string, number>
  oiDadoEm: string
}

export interface AcaoIA {
  regra: string
  mood: PetMood
  frase: string
}

export function perfilVazio(): PerfilPet {
  return {
    visitasPorView: {},
    viewsDistintas: [],
    sucessosSeguidos: 0,
    errosRecentes: [],
    carinhos: 0,
    voos: 0,
    cooldowns: {},
    oiDadoEm: '',
  }
}

/** Cooldowns por regra (ms) — a pet sugere, nunca importuna. */
const COOLDOWN: Record<string, number> = {
  explorador: 30 * 60_000,
  dica: 20 * 60_000,
  sequencia: 15 * 60_000,
  apoio: 10 * 60_000,
  fidelidade: 60 * 60_000,
  coruja: 24 * 60 * 60_000,
  voo: 5 * 60_000,
}

function livre(perfil: PerfilPet, regra: string, agora: number): boolean {
  // Regra nunca executada está sempre livre (o zero da época não é castigo).
  const ultimo = perfil.cooldowns[regra]
  if (ultimo === undefined) return true
  return ultimo + (COOLDOWN[regra.split(':')[0]] ?? 0) <= agora
}

/** Dica de segunda visita por tela — a IA vira guia local. */
export const DICA_POR_VIEW: Record<string, string> = {
  calculadora: 'Dica: simule com e sem redução pra comparar!',
  consulta: 'Dica: vale buscar pelo nome do produto também!',
  lote: 'Dica: arraste o CSV pra cá que eu confiro tudo!',
  nfe: 'Dica: importe vários XMLs de uma vez!',
  produtos: 'Dica: o botão Editar leva pra Consulta!',
  auxiliares: 'Dica: CST e cClassTrib andam juntinhos!',
  legislacao: 'Dica: use o buscar do navegador aqui dentro!',
  debugia: 'Shhh… área secreta de detetives!',
}

const FRASES_CORUJA = [
  'Trabalhando até tarde? Pega um café!',
  'Madrugada fiscal? Eu faço companhia!',
]

/**
 * Núcleo puro da IA: dado o perfil atualizado COM o evento, decide a ação.
 * Ordem = prioridade (apoio a erro passa na frente de dica, etc.).
 * Retorna `null` quando o melhor comportamento é ficar quietinha.
 */
export function decidirAcaoIA(perfil: PerfilPet, evento: EventoPet, agora: number, hora: number): AcaoIA | null {
  // Coruja noturna: vale para qualquer evento, uma vez ao dia.
  if ((hora >= 22 || hora < 6) && livre(perfil, 'coruja', agora)) {
    return { regra: 'coruja', mood: 'curious', frase: FRASES_CORUJA[hora >= 22 ? 0 : 1] }
  }
  if (evento.tipo === 'erro' && perfil.errosRecentes.length >= 2) {
    const recentes = perfil.errosRecentes.filter((t) => agora - t < 5 * 60_000)
    if (recentes.length >= 2 && livre(perfil, 'apoio', agora)) {
      return { regra: 'apoio', mood: 'curious', frase: 'Respira… vamos tentar juntos?' }
    }
  }
  if (evento.tipo === 'sucesso' && perfil.sucessosSeguidos >= 3 && livre(perfil, 'sequencia', agora)) {
    return { regra: 'sequencia', mood: 'celebrating', frase: 'Você tá imparável!' }
  }
  if (evento.tipo === 'carinho' && perfil.carinhos >= 5 && livre(perfil, 'fidelidade', agora)) {
    return { regra: 'fidelidade', mood: 'love', frase: 'Melhor humano do mundo!' }
  }
  if (evento.tipo === 'voo' && perfil.voos >= 2 && livre(perfil, 'voo', agora)) {
    return { regra: 'voo', mood: 'happy', frase: 'De novo! Wheee!' }
  }
  if (evento.tipo === 'view') {
    if (perfil.viewsDistintas.length >= 4 && livre(perfil, 'explorador', agora)) {
      return { regra: 'explorador', mood: 'waving', frase: 'Explorador oficial da Aurum!' }
    }
    if ((perfil.visitasPorView[evento.view] ?? 0) >= 3 && livre(perfil, `dica:${evento.view}`, agora)) {
      return { regra: `dica:${evento.view}`, mood: 'curious', frase: DICA_POR_VIEW[evento.view] ?? 'Já tô craque aqui!' }
    }
  }
  return null
}

/* ------------------------------------------------- casca com estado --- */

const CHAVE = 'aurum:pet-ia-v1'

function carregar(): PerfilPet {
  try {
    const cru = localStorage.getItem(CHAVE)
    if (!cru) return perfilVazio()
    const p = { ...perfilVazio(), ...(JSON.parse(cru) as Partial<PerfilPet>) }
    p.errosRecentes = []
    return p
  } catch {
    return perfilVazio()
  }
}

function salvar(perfil: PerfilPet): void {
  try {
    const { errosRecentes: _descarta, ...resto } = perfil
    void _descarta
    localStorage.setItem(CHAVE, JSON.stringify(resto))
  } catch {
    // Armazenamento indisponível: a IA vive só na sessão.
  }
}

let perfil: PerfilPet | null = null
let oiDadoNestaSessao = false

function obterPerfil(): PerfilPet {
  if (!perfil) perfil = carregar()
  return perfil
}

/** Humores que a IA pode interromper sem ser rude. */
const INTERROMPIVEL: PetMood[] = ['idle', 'reading', 'searching', 'happy', 'curious', 'calculating']

/**
 * Registra um evento de uso e, se alguma rotina disparar (e a pet estiver
 * livre), executa a ação. Retorna `true` quando a IA assumiu o palco — o
 * chamador pode pular sua própria reação para não brigar no balão.
 */
export function registrarEventoPet(evento: EventoPet): boolean {
  const p = obterPerfil()
  const agora = Date.now()
  switch (evento.tipo) {
    case 'view':
      p.visitasPorView[evento.view] = (p.visitasPorView[evento.view] ?? 0) + 1
      if (!p.viewsDistintas.includes(evento.view)) p.viewsDistintas.push(evento.view)
      break
    case 'sucesso':
      p.sucessosSeguidos += 1
      break
    case 'erro':
      p.sucessosSeguidos = 0
      p.errosRecentes.push(agora)
      p.errosRecentes = p.errosRecentes.slice(-6)
      break
    case 'carinho':
      p.carinhos += 1
      break
    case 'voo':
      p.voos += 1
      break
    case 'despertar':
      break
  }
  const hora = new Date().getHours()
  const acao = decidirAcaoIA(p, evento, agora, hora)
  salvar(p)
  if (!acao) return false
  if (!INTERROMPIVEL.includes(usePet.getState().mood)) return false
  p.cooldowns[acao.regra] = agora
  salvar(p)
  usePet.getState().agir(acao.mood, acao.frase)
  return true
}

/** Saudação por turno — uma vez por dia, na primeira montagem. */
export function saudacaoInicialPet(): void {
  if (oiDadoNestaSessao) return
  oiDadoNestaSessao = true
  const p = obterPerfil()
  const hoje = new Date().toDateString()
  if (p.oiDadoEm === hoje) return
  // Só saúda se a pet estiver livre (nunca pisa em carregamento inicial).
  if (usePet.getState().mood !== 'idle') return
  const hora = new Date().getHours()
  const frase = hora < 6 ? 'Madrugada fiscal? Eu faço companhia!' : hora < 12 ? 'Bom dia! Pronta pra farejar!' : hora < 18 ? 'Boa tarde! Bora classificar?' : 'Boa noite! Ainda dá tempo de um NCM!'
  p.oiDadoEm = hoje
  salvar(p)
  usePet.getState().agir('waving', frase)
}
