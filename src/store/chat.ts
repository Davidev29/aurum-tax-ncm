/**
 * Store do chat Aurum AI — conversa ativa + arquivo de chats.
 *
 * A conversa ativa é espelhada em `arquivadas` a cada mensagem (a partir da
 * 1ª mensagem do usuário): nada se perde ao trocar de conversa ou ao abrir
 * uma arquivada. O chat nunca escreve no sistema (só lê/consulta); o
 * aprendizado passa pelo `ia_feedback` do gate.
 */
import { create } from 'zustand'
import {
  responderChat,
  type BotaoChat,
  type PensamentoChat,
  type RelatorioChat,
  type RelatorioOpcoes,
} from '@/application/aurum-ai-chat'
import type { GraficoChat } from '@/application/aurum-ai-graficos'
import { atualizarArtefatoResumido } from '@/application/aurum-ai-artefatos'
import { registrarLimpeza } from './ui'

export type StatusLeitura = 'enviando' | 'enviada' | 'entregue' | 'lida'

export interface MensagemChat {
  id: number
  papel: 'user' | 'assistant'
  texto: string
  quando: string
  codigo?: string | null
  tipoCodigo?: 'ncm' | 'nbs' | 'cnae' | null
  confianca?: number
  /** Resposta a qual mensagem do usuário (lote: responde uma após a outra, indicando a origem). */
  emRespostaA?: { id: number; texto: string } | null
  /** Recibo de leitura estilo WhatsApp (mensagens do usuário). Derivado quando ausente. */
  status?: StatusLeitura
  fontes?: string[]
  relatorio?: RelatorioChat | null
  relatorioOpcoes?: RelatorioOpcoes | null
  /** Artefato visual (gráfico 3D / tabela) gerado pela IA nesta mensagem. */
  grafico?: GraficoChat | null
  sugestoes?: string[]
  botoes?: BotaoChat[]
  pensamento?: PensamentoChat | null
  /** IA-07: `true` enquanto o texto do modelo está sendo revelado (cursor). */
  streaming?: boolean
}

export interface ConversaArquivada {
  id: string
  titulo: string
  quando: string
  mensagens: MensagemChat[]
}

export interface ItemFilaChat {
  id: number
  texto: string
  /** `true` quando enviada em lote/rajada (junto com outras). */
  emLote?: boolean
}

interface ChatState {
  mensagens: MensagemChat[]
  conversaId: string
  arquivadas: ConversaArquivada[]
  enviando: boolean
  /** Fila de mensagens do usuário aguardando resposta (lote: responde em ordem, uma após a outra). */
  fila: ItemFilaChat[]
  /** `true` após carregar o arquivo persistido (Dexie) uma vez. */
  hidratado: boolean
  enviar: (texto: string) => Promise<void>
  /** Enfileira várias mensagens de uma vez (lote): cada uma vira resposta própria com `emRespostaA`. */
  enviarLote: (textos: string[]) => Promise<void>
  nova: () => void
  arquivar: () => void
  restaurar: (id: string) => void
  excluirArquivada: (id: string) => void
  /** Exclui QUALQUER conversa (ativa ou arquivada). Se for a ativa, abre telinha limpa. */
  excluirConversa: (id: string) => void
  limpar: () => void
  /** Carrega conversas do emitente (persistência entre sessões/seções). Idempotente. */
  hidratar: () => Promise<void>
}

let seq = 0
const novaId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const BOAS_VINDAS: MensagemChat = {
  id: 0,
  papel: 'assistant',
  texto:
    'Olá! Sou a Aurum AI, sua assistente fiscal. Pergunte com suas palavras — ex.: "tem algum ncm de banana?", "qual o nbs para aula de inglês?" ou "tem XML de algum cliente?". Consulto a base oficial na hora, calculo IBS/CBS, consulto seus dados (clientes, XMLs, fornecedores, produtos) e gero relatórios para baixar.',
  quando: new Date().toISOString(),
  sugestoes: ['Tem algum NCM de banana?', 'Tem XML de algum cliente?', 'Quanto fica R$ 1.000 no NCM 0803.10.00?'],
  botoes: [
    { rotulo: 'O que você pode fazer?', acao: 'perguntar', alvo: 'O que você pode fazer?' },
    { rotulo: 'Consultar NCM', acao: 'navegar', alvo: 'consulta' },
    { rotulo: 'Abrir Calculadora', acao: 'navegar', alvo: 'calculadora' },
  ],
}

function tituloDe(mensagens: MensagemChat[]): string {
  const primeira = mensagens.find((m) => m.papel === 'user')?.texto.trim() ?? ''
  if (!primeira) return 'Conversa sem título'
  return primeira.length > 42 ? `${primeira.slice(0, 42)}…` : primeira
}

/**
 * Espelha a conversa ativa no arquivo (upsert por `conversaId`).
 * Chamada a cada resposta — por isso a lista já contém a conversa desde a
 * 1ª mensagem, sem precisar de "arquivar" manual.
 */
function emitenteIdAtual(): string {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('aurum_emitente_id') : null
    if (ls) return ls
  } catch { /* segue default */ }
  return 'default'
}

type MensagemEnxuta = { papel: 'user' | 'assistant'; texto: string; quando: string; grafico?: GraficoChat | null; emRespostaA?: { id: number; texto: string } | null; status?: StatusLeitura }

function enxutar(mensagens: MensagemChat[]): MensagemEnxuta[] {
  return mensagens
    .slice(-100)
    .map((m) => ({
      papel: m.papel,
      texto: m.texto.slice(0, 2000),
      quando: m.quando,
      grafico: m.grafico ?? null,
      emRespostaA: m.emRespostaA ? { id: m.emRespostaA.id, texto: m.emRespostaA.texto.slice(0, 280) } : null,
      status: m.status ?? (m.papel === 'user' ? 'lida' : undefined),
    }))
}

function reidratar(enxutas: MensagemEnxuta[]): MensagemChat[] {
  return enxutas.map((m) => ({
    id: ++seq,
    papel: m.papel,
    texto: m.texto,
    quando: m.quando,
    grafico: m.grafico ?? null,
    emRespostaA: m.emRespostaA ?? null,
    status: m.status ?? (m.papel === 'user' ? 'lida' : undefined),
  }))
}

function persistirTudo(): void {
  try {
    const { mensagens, conversaId, arquivadas } = useChat.getState()
    const emitenteId = emitenteIdAtual()
    const agora = new Date().toISOString()
    // Todas as conversas com conteúdo real (ativa + arquivo), sem duplicar.
    const todas = new Map<string, { mensagens: MensagemChat[] }>()
    for (const a of arquivadas) {
      if (a.mensagens.some((m) => m.papel === 'user')) todas.set(a.id, { mensagens: a.mensagens })
    }
    if (mensagens.some((m) => m.papel === 'user')) todas.set(conversaId, { mensagens })
    if (!todas.size) return
    import('@/infrastructure/db/schema').then(({ db }) => {
      const puts: Promise<unknown>[] = []
      for (const [id, conv] of todas) {
        puts.push(
          db.table('conversasEmitente').put({
            conversaId: id, emitenteId, empresaAtivaId: null,
            titulo: tituloDe(conv.mensagens), mensagens: enxutar(conv.mensagens),
            updatedAt: id === conversaId ? agora : agora, createdAt: agora,
          }).catch(() => null),
        )
      }
      Promise.all(puts).then(() => {
        // TTL 90 dias + teto 30 por emitente (lazy, best-effort)
        db.table('conversasEmitente').where('emitenteId').equals(emitenteId).toArray().then((todasDb) => {
          const limite = Date.now() - 90 * 86400000
          for (const v of todasDb as { conversaId: string; updatedAt: string }[]) {
            if (Date.parse(v.updatedAt) < limite) db.table('conversasEmitente').delete(v.conversaId).catch(() => {})
          }
          if (todasDb.length > 30) {
            const ordenadas = [...(todasDb as { conversaId: string; updatedAt: string }[])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            for (const extra of ordenadas.slice(30)) db.table('conversasEmitente').delete(extra.conversaId).catch(() => {})
          }
        }).catch(() => {})
      }).catch(() => {})
    }).catch(() => {})
  } catch { /* memoria nunca trava o chat */ }
}

function persistirPorEmitente(): void {
  persistirTudo()
}

function espelharAtiva(): void {
  const { mensagens, conversaId } = useChat.getState()
  if (!mensagens.some((m) => m.papel === 'user')) return
  const item: ConversaArquivada = {
    id: conversaId,
    titulo: tituloDe(mensagens),
    quando: new Date().toISOString(),
    mensagens,
  }
  useChat.setState((s) => ({ arquivadas: [item, ...s.arquivadas.filter((a) => a.id !== conversaId)].slice(0, 30) }))
  persistirPorEmitente()
  // A IA condensa o chat num artefato-resumo CIFRADO (só ela descriptografa),
  // que contribui com os resultados do próximo chat. Throttle interno de 30s.
  try {
    const hist = mensagens.map((m) => ({ papel: m.papel, texto: m.texto }))
    const totalConversas = useChat.getState().arquivadas.length
    void atualizarArtefatoResumido(hist, { totalConversas }).catch(() => null)
  } catch { /* artefato nunca trava o chat */ }
}

/** Processador sequencial da fila (lote): responde uma após a outra, em ordem. */
let processandoFila: Promise<void> | null = null

function historicoAte(mensagens: MensagemChat[], userId: number): { papel: 'user' | 'assistant'; texto: string }[] {
  const idx = mensagens.findIndex((m) => m.id === userId)
  const recorte = idx >= 0 ? mensagens.slice(0, idx + 1) : mensagens
  return recorte.map((m) => ({ papel: m.papel, texto: m.texto }))
}

async function drenarFila(): Promise<void> {
  if (processandoFila) return processandoFila
  processandoFila = (async () => {
    while (useChat.getState().fila.length) {
      const proximo = useChat.getState().fila[0]
      if (!proximo) break
      // Citação "Em resposta a" só em lote/rajada: 2+ enviadas juntas.
      // Marca na fila (enviada com outras) ou rajada (anterior imediato é user).
      const msgsAntes = useChat.getState().mensagens
      const idxAntes = msgsAntes.findIndex((m) => m.id === proximo.id)
      const anteriorUsuario = idxAntes > 0 && msgsAntes[idxAntes - 1]?.papel === 'user'
      const emLote = Boolean(proximo.emLote) || useChat.getState().fila.length > 1 || anteriorUsuario
      const citacao = emLote ? { id: proximo.id, texto: proximo.texto.slice(0, 280) } : null
      try {
        const hist = historicoAte(useChat.getState().mensagens, proximo.id)
        const r = await responderChat(proximo.texto, hist)
        // IA-07: resposta do modelo revela em streaming (efeito digitação);
        // determinística entra instantânea. `enviando` segue true até o fim,
        // então o "digitando…" + avatar pulsante nunca somem no meio.
        const deveRevelar = Boolean((r as { viaModelo?: boolean }).viaModelo) && r.texto.length > 60
        if (!deveRevelar) {
          const assistant: MensagemChat = {
            id: ++seq,
            papel: 'assistant',
            texto: r.texto,
            quando: new Date().toISOString(),
            codigo: r.codigo ?? null,
            tipoCodigo: (r.tipoCodigo ?? null) as MensagemChat['tipoCodigo'],
            confianca: r.confianca,
            emRespostaA: citacao,
            fontes: r.fontes,
            relatorio: r.relatorio ?? null,
            relatorioOpcoes: r.relatorioOpcoes ?? null,
            grafico: r.grafico ?? null,
            sugestoes: r.sugestoes,
            botoes: r.botoes,
            pensamento: r.pensamento ?? null,
          }
          useChat.setState((s) => ({
            mensagens: [
              ...s.mensagens.map((m) => (m.id === proximo.id && m.papel === 'user' ? { ...m, status: 'lida' as StatusLeitura } : m)),
              assistant,
            ],
            fila: s.fila.filter((f) => f.id !== proximo.id),
          }))
          espelharAtiva()
          continue
        }
        const aid = ++seq
        const base: MensagemChat = {
          id: aid,
          papel: 'assistant',
          texto: '',
          quando: new Date().toISOString(),
          codigo: r.codigo ?? null,
          tipoCodigo: (r.tipoCodigo ?? null) as MensagemChat['tipoCodigo'],
          confianca: r.confianca,
          emRespostaA: citacao,
          fontes: r.fontes,
          relatorio: null,
          relatorioOpcoes: null,
          grafico: null,
          sugestoes: [],
          botoes: [],
          pensamento: r.pensamento ?? null,
          streaming: true,
        }
        useChat.setState((s) => ({
          mensagens: [
            ...s.mensagens.map((m) => (m.id === proximo.id && m.papel === 'user' ? { ...m, status: 'lida' as StatusLeitura } : m)),
            base,
          ],
        }))
        const alvo = r.texto
        const passo = Math.max(2, Math.round(alvo.length / 90))
        for (let i = passo; i < alvo.length; i += passo) {
          const parcial = alvo.slice(0, i)
          useChat.setState((s) => ({
            mensagens: s.mensagens.map((m) => (m.id === aid ? { ...m, texto: parcial } : m)),
          }))
          await new Promise((res) => setTimeout(res, 12))
        }
        useChat.setState((s) => ({
          mensagens: s.mensagens.map((m) =>
            m.id === aid
              ? {
                ...m, texto: alvo, streaming: false,
                relatorio: r.relatorio ?? null, relatorioOpcoes: r.relatorioOpcoes ?? null,
                grafico: r.grafico ?? null, sugestoes: r.sugestoes, botoes: r.botoes,
              }
              : m,
          ),
          fila: s.fila.filter((f) => f.id !== proximo.id),
        }))
        espelharAtiva()
      } catch {
        const erro: MensagemChat = {
          id: ++seq,
          papel: 'assistant',
          texto: 'Tive uma falha momentânea. Tente de novo com 1–2 detalhes do produto.',
          quando: new Date().toISOString(),
          emRespostaA: citacao,
        }
        useChat.setState((s) => ({
          mensagens: [
            ...s.mensagens.map((m) => (m.id === proximo.id && m.papel === 'user' ? { ...m, status: 'lida' as StatusLeitura } : m)),
            erro,
          ],
          fila: s.fila.filter((f) => f.id !== proximo.id),
        }))
        espelharAtiva()
      }
    }
    useChat.setState({ enviando: false })
  })().finally(() => {
    processandoFila = null
  })
  return processandoFila
}

export const useChat = create<ChatState>((set, get) => ({
  mensagens: [BOAS_VINDAS],
  conversaId: novaId(),
  arquivadas: [],
  enviando: false,
  fila: [],
  hidratado: false,

  hidratar: async () => {
    if (get().hidratado) return
    try {
      const { db } = await import('@/infrastructure/db/schema')
      const emitenteId = emitenteIdAtual()
      const todas = await db.table('conversasEmitente').where('emitenteId').equals(emitenteId).toArray().catch(() => [])
      if (!todas.length) {
        set({ hidratado: true })
        return
      }
      const ordenadas = [...(todas as { conversaId: string; titulo: string; mensagens: MensagemEnxuta[]; updatedAt: string }[])]
        .filter((t) => Array.isArray(t.mensagens) && t.mensagens.some((m) => m.papel === 'user'))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 30)
      if (!ordenadas.length) {
        set({ hidratado: true })
        return
      }
      // A mais recente vira a conversa ativa; as demais, o arquivo.
      const [ativa, ...resto] = ordenadas
      const mensagensAtivas = reidratar(ativa.mensagens)
      const arquivadas: ConversaArquivada[] = resto.map((t) => ({
        id: t.conversaId,
        titulo: t.titulo || tituloDe(reidratar(t.mensagens)),
        quando: t.updatedAt,
        mensagens: reidratar(t.mensagens),
      }))
      // Garante o espelho da ativa no arquivo (nada se perde ao trocar).
      const espelho: ConversaArquivada = {
        id: ativa.conversaId,
        titulo: ativa.titulo || tituloDe(mensagensAtivas),
        quando: ativa.updatedAt,
        mensagens: mensagensAtivas,
      }
      set({
        mensagens: mensagensAtivas,
        conversaId: ativa.conversaId,
        arquivadas: [espelho, ...arquivadas].slice(0, 30),
        enviando: false,
        fila: [],
        hidratado: true,
      })
    } catch {
      set({ hidratado: true })
    }
  },

  enviar: async (texto) => {
    const cru = String(texto ?? '').trim()
    if (!cru) return
    const emLote = get().enviando || get().fila.length > 0
    const user: MensagemChat = { id: ++seq, papel: 'user', texto: cru.slice(0, 2000), quando: new Date().toISOString(), status: 'enviada' }
    set((s) => ({ mensagens: [...s.mensagens, user], fila: [...s.fila, { id: user.id, texto: user.texto, emLote }], enviando: true }))
    await drenarFila()
  },

  enviarLote: async (textos) => {
    const limpos = (Array.isArray(textos) ? textos : [])
      .map((t) => String(t ?? '').trim())
      .filter(Boolean)
      .slice(0, 20)
    if (!limpos.length) return
    const emLote = limpos.length > 1 || get().enviando || get().fila.length > 0
    const novos: MensagemChat[] = limpos.map((texto) => ({
      id: ++seq,
      papel: 'user' as const,
      texto: texto.slice(0, 2000),
      quando: new Date().toISOString(),
      status: 'enviada' as StatusLeitura,
    }))
    set((s) => ({
      mensagens: [...s.mensagens, ...novos],
      fila: [...s.fila, ...novos.map((m) => ({ id: m.id, texto: m.texto, emLote }))],
      enviando: true,
    }))
    await drenarFila()
  },

  nova: () => {
    // A conversa anterior já está espelhada no arquivo desde a 1ª mensagem:
    // aqui só abre a telinha limpa para inicializar a próxima.
    // Fecha o artefato-resumo da conversa que termina (forçado, sem throttle).
    try {
      const { mensagens, arquivadas } = get()
      if (mensagens.some((m) => m.papel === 'user')) {
        const hist = mensagens.map((m) => ({ papel: m.papel, texto: m.texto }))
        void atualizarArtefatoResumido(hist, { forcar: true, totalConversas: arquivadas.length }).catch(() => null)
      }
    } catch { /* best-effort */ }
    set({ mensagens: [BOAS_VINDAS], conversaId: novaId(), enviando: false, fila: [] })
    persistirTudo()
  },

  arquivar: () => {
    const { mensagens, conversaId } = get()
    if (!mensagens.some((m) => m.papel === 'user')) return
    const item: ConversaArquivada = {
      id: conversaId,
      titulo: tituloDe(mensagens),
      quando: new Date().toISOString(),
      mensagens,
    }
    set((s) => ({
      arquivadas: [item, ...s.arquivadas.filter((a) => a.id !== conversaId)].slice(0, 30),
      mensagens: [BOAS_VINDAS],
      conversaId: novaId(),
      enviando: false,
      fila: [],
    }))
    persistirTudo()
    try {
      const hist = item.mensagens.map((m) => ({ papel: m.papel, texto: m.texto }))
      void atualizarArtefatoResumido(hist, { forcar: true, totalConversas: get().arquivadas.length }).catch(() => null)
    } catch { /* best-effort */ }
  },

  restaurar: (id) => {
    const { mensagens, conversaId, arquivadas } = get()
    if (id === conversaId) return
    const alvo = arquivadas.find((a) => a.id === id)
    if (!alvo) return
    // A conversa atual já está espelhada (upsert a cada resposta); aqui só
    // garante o espelho e abre a arquivada sem duplicar nem sumir da lista.
    const espelho: ConversaArquivada[] = mensagens.some((m) => m.papel === 'user')
      ? [{ id: conversaId, titulo: tituloDe(mensagens), quando: new Date().toISOString(), mensagens }]
      : []
    const resto = arquivadas.filter((a) => a.id !== conversaId)
    set({ arquivadas: [...espelho, ...resto].slice(0, 30), mensagens: alvo.mensagens, conversaId: alvo.id, enviando: false, fila: [] })
    persistirTudo()
    try {
      const hist = alvo.mensagens.map((m) => ({ papel: m.papel, texto: m.texto }))
      void atualizarArtefatoResumido(hist, { forcar: true, totalConversas: get().arquivadas.length }).catch(() => null)
    } catch { /* best-effort */ }
  },

  excluirArquivada: (id) => {
    set((s) => ({ arquivadas: s.arquivadas.filter((a) => a.id !== id) }))
    try {
      import('@/infrastructure/db/schema').then(({ db }) => {
        db.table('conversasEmitente').delete(id).catch(() => {})
      }).catch(() => {})
    } catch { /* best-effort */ }
  },

  excluirConversa: (id) => {
    const { conversaId } = get()
    if (id === conversaId) {
      // Excluindo a ativa: some o espelho e abre telinha limpa com novo id.
      set((s) => ({
        arquivadas: s.arquivadas.filter((a) => a.id !== id),
        mensagens: [BOAS_VINDAS],
        conversaId: novaId(),
        enviando: false,
        fila: [],
      }))
      try {
        import('@/infrastructure/db/schema').then(({ db }) => {
          db.table('conversasEmitente').delete(id).catch(() => {})
        }).catch(() => {})
      } catch { /* best-effort */ }
      persistirTudo()
      return
    }
    get().excluirArquivada(id)
  },

  limpar: () => set({ mensagens: [BOAS_VINDAS], conversaId: novaId(), enviando: false, fila: [], hidratado: false }),
}))

registrarLimpeza('aurum', () => useChat.getState().limpar())
