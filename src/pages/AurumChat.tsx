/**
 * Tela **Aurum AI** — chat fiscal em cartão compacto estilo WhatsApp sobre
 * fundo animado (Pexels) com vidro fosco estilo Aero.
 *
 * - Esquerda: conversas arquivadas (nova, arquivar, restaurar, excluir).
 * - Direita: conversa estilo WhatsApp (bolhas, horários, divisores de dia,
 *   "digitando…" com 3 pontos, input contido em pílula).
 * - Fundo: ícone 🖼 abre o painel onde o usuário cola a chave de API do
 *   Pexels e o tema; sem chave, degradê local animado. O chat nunca altera
 *   dados do sistema.
 */
import { useEffect, useRef, useState } from 'react'
import { NOME_IA } from '@/domain/aurum-ai'
import { montarRelatorioCalculo, montarRelatorioConversa, montarRelatorioDados, montarRelatorioSimplesChat, type FormatoRelatorio } from '@/application/aurum-ai-chat'
import { exportarRelatorioChatPDF } from '@/application/aurum-ai-chat-pdf'
import { exportarRelatorioDadosPDF } from '@/application/aurum-ai-dados-pdf'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { useSessao } from '@/store/sessao'
import type { BotaoChat } from '@/application/aurum-ai-recursos'
import { useChat } from '@/store/chat'
import { useFundo } from '@/store/fundo'
import { toast, useUi, type ViewId } from '@/store/ui'
import { Btn, Texto } from '@/ui/kit'
import { Entrada } from '@/ui/motion'
import { TextoChat } from '@/ui/chat-markdown'
import { AurinhaAvatar } from '@/ui/AurinhaAvatar'
import { GraficoChatView } from '@/ui/grafico-chat'
import { baixar } from '@/infrastructure/exporters/relatorios'

/** HH:MM local de um ISO. */
function hora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Divisor de dia: "Hoje", "Ontem" ou dd/mm/aaaa. */
function rotuloDia(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hoje = new Date()
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((inicio(hoje) - inicio(d)) / 86400000)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR')
}

/** Indicador "digitando…" estilo WhatsApp: carinha da Aurinha + bolha clara + 3 pontos. */
function DigitandoAurum() {
  return (
    <div className="mr-auto flex w-fit items-end gap-1.5" role="status" aria-live="polite" aria-label={`${NOME_IA} digitando`}>
      <AurinhaAvatar tamanho={26} digitando titulo={`${NOME_IA} digitando`} />
      <div
        className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm dark:bg-[#1f2c34]"
        aria-hidden="true"
      >
        {[0, 1, 2].map((i) => (
          <span key={i} className="chat-dot" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </div>
    </div>
  )
}

/**
 * Recibo de leitura estilo WhatsApp para mensagens do usuário.
 * - 1 check cinza: enviada (ainda na fila / processando);
 * - 2 checks cinza: entregue (já no chat, aguardando leitura da IA);
 * - 2 checks azuis: visualizada (a IA já respondeu).
 * A cor muda de cinza (#8696a0) para azul (#53bdeb) ao ser visualizada.
 */
function StatusLeitura({ estado }: { estado: 'enviando' | 'enviada' | 'entregue' | 'lida' }) {
  const lida = estado === 'lida'
  const rotulo = estado === 'lida' ? 'Visualizada' : estado === 'entregue' ? 'Entregue' : estado === 'enviada' ? 'Enviada' : 'Enviando'
  const cor = lida ? '#53bdeb' : '#8696a0'
  if (estado === 'enviando' || estado === 'enviada') {
    return (
      <span role="img" aria-label={rotulo} title={rotulo} className="inline-flex items-center">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
          <path d="M1 6.5 4.5 10 15 1.5" stroke={cor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  return (
    <span role="img" aria-label={rotulo} title={rotulo} className="inline-flex items-center">
      <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden="true">
        <path d="M1 6.5 4.5 10 14 1.5" stroke={cor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 6.5 9.5 10 19 1.5" stroke={cor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** Recibo derivado: pendente → enviando; com resposta posterior → lida; senão → entregue. */
function estadoLeituraDe(
  m: { id: number; papel: string; status?: string },
  mensagens: { id: number; papel: string }[],
  fila: { id: number }[],
): 'enviando' | 'enviada' | 'entregue' | 'lida' {
  if (m.papel !== 'user') return 'lida'
  if (m.status === 'lida') return 'lida'
  if (fila.some((f) => f.id === m.id)) return 'enviando'
  if (m.status === 'enviada') {
    const idx = mensagens.findIndex((x) => x.id === m.id)
    const temRespostaDepois = idx >= 0 && mensagens.slice(idx + 1).some((x) => x.papel === 'assistant')
    return temRespostaDepois ? 'lida' : 'entregue'
  }
  const idx = mensagens.findIndex((x) => x.id === m.id)
  const temRespostaDepois = idx >= 0 && mensagens.slice(idx + 1).some((x) => x.papel === 'assistant')
  return temRespostaDepois ? 'lida' : 'entregue'
}

export function AurumChat() {
  const mensagens = useChat((s) => s.mensagens)
  const enviando = useChat((s) => s.enviando)
  const fila = useChat((s) => s.fila)
  const enviar = useChat((s) => s.enviar)
  const nova = useChat((s) => s.nova)
  const arquivar = useChat((s) => s.arquivar)
  const arquivadas = useChat((s) => s.arquivadas)
  const conversaId = useChat((s) => s.conversaId)
  const hidratar = useChat((s) => s.hidratar)
  const restaurar = useChat((s) => s.restaurar)
  const excluirConversa = useChat((s) => s.excluirConversa)
  const trocarView = useUi((s) => s.trocarView)
  const [entrada, setEntrada] = useState('')
  const [lateralAberta, setLateralAberta] = useState(true)
  const [painelFundoAberto, setPainelFundoAberto] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)
  const entradaRef = useRef<HTMLTextAreaElement>(null)
  const noFimRef = useRef(true)

  // Fundo global (mesma imagem de todas as telas) — aqui só o painel 🖼.
  const fotos = useFundo((s) => s.fotos)
  const indiceFoto = useFundo((s) => s.indice)
  const tema = useFundo((s) => s.tema)
  const setTema = useFundo((s) => s.setTema)
  const animar = useFundo((s) => s.animar)
  const setAnimar = useFundo((s) => s.setAnimar)
  const carregandoFundo = useFundo((s) => s.carregando)
  const chaveNoCodigo = useFundo((s) => s.chaveNoCodigo)
  const atualizarFundoStore = useFundo((s) => s.atualizar)

  const atualizarFundo = () => {
    void atualizarFundoStore().then(() => {
      const n = useFundo.getState().fotos.length
      toast(n ? `Fundo atualizado (${n} fotos).` : 'Fundo local em uso.', n ? 'ok' : 'warn')
      if (n) setPainelFundoAberto(false)
    })
  }

  const aoRolar = () => {
    const el = listaRef.current
    if (!el) return
    noFimRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Hidrata o arquivo persistido (Dexie por emitente) uma vez: as conversas
  // sobrevivem ao reload e alimentam o contexto/aprendizado da IA.
  useEffect(() => {
    void hidratar()
  }, [hidratar])

  useEffect(() => {
    if (noFimRef.current) {
      listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [mensagens, enviando])

  const submeter = (e?: React.FormEvent) => {
    e?.preventDefault()
    const texto = entrada.trim()
    // Lote: o input segue habilitado durante o envio — cada Enter enfileira
    // e a IA responde uma após a outra, em ordem (ver store `fila`).
    if (!texto) return
    setEntrada('')
    // O input NUNCA perde o foco ao enviar (exigência de UX): como o campo
    // segue habilitado durante o envio, basta re-focar + recolher a altura.
    requestAnimationFrame(() => {
      const ta = entradaRef.current ?? (document.getElementById('chat-aurum-entrada') as HTMLTextAreaElement | null)
      if (ta) {
        ta.style.height = 'auto'
        ta.focus({ preventScroll: true })
      }
    })
    void enviar(texto)
  }

  const aoTeclarEntrada = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia · Shift+Enter quebra linha (sem enviar).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submeter()
    } else if (e.key === 'Escape') {
      setEntrada('')
    }
  }

  const aoBotao = (
    b: BotaoChat,
    relatorio?: { nome: string; conteudo: string; mime: string } | null,
    relatorioOpcoes?: { base: 'conversa' | 'calculo' | 'dados' | 'simples'; dados: never } | null,
  ) => {
    if (b.acao === 'navegar') {
      trocarView(b.alvo as ViewId)
      return
    }
    if (b.acao === 'baixar') {
      if (relatorio) {
        baixar(relatorio.nome, relatorio.conteudo, relatorio.mime)
        toast('Relatório baixado.', 'ok')
      } else if (relatorioOpcoes) {
        if (relatorioOpcoes.base === 'dados') {
          const rel = montarRelatorioDados(relatorioOpcoes.dados as never, 'csv')
          baixar(rel.nome, rel.conteudo, rel.mime)
          toast('Relatório de dados baixado em CSV.', 'ok')
        } else if (relatorioOpcoes.base === 'simples') {
          const rel = montarRelatorioSimplesChat(relatorioOpcoes.dados as never, 'csv')
          baixar(rel.nome, rel.conteudo, rel.mime)
          toast('Relatório do Simples baixado em CSV.', 'ok')
        } else {
          const rel =
            relatorioOpcoes.base === 'calculo'
              ? montarRelatorioCalculo(relatorioOpcoes.dados as never, 'csv')
              : montarRelatorioConversa(relatorioOpcoes.dados as never, 'csv')
          baixar(rel.nome, rel.conteudo, rel.mime)
          toast('Relatório baixado em CSV.', 'ok')
        }
      }
      return
    }
    if (b.acao === 'formato') {
      if (!relatorioOpcoes) return
      const formato = b.alvo as FormatoRelatorio
      // PDF sai pelo motor pdfMake (timbrado do emitente); demais formatos
      // são texto gerado em memória.
      if (formato === 'pdf') {
        const emitente = useSessao.getState().emitente ?? EMITENTE_PADRAO
        toast('Gerando PDF…', '')
        const promessa = relatorioOpcoes.base === 'dados'
          ? exportarRelatorioDadosPDF((relatorioOpcoes.dados as unknown as { payload: never }).payload as never, emitente)
          : exportarRelatorioChatPDF(relatorioOpcoes.base, relatorioOpcoes.dados as never, emitente)
        void promessa
          .then(() => toast('Relatório em PDF gerado.', 'ok'))
          .catch(() => toast('Não consegui gerar o PDF agora.', 'err'))
        return
      }
      if (relatorioOpcoes.base === 'dados') {
        const rel = montarRelatorioDados(relatorioOpcoes.dados as never, formato)
        baixar(rel.nome, rel.conteudo, rel.mime)
        toast(`Relatório de dados baixado em ${formato.toUpperCase()}.`, 'ok')
        return
      }
      if (relatorioOpcoes.base === 'simples') {
        const rel = montarRelatorioSimplesChat(relatorioOpcoes.dados as never, formato)
        baixar(rel.nome, rel.conteudo, rel.mime)
        toast(`Relatório do Simples baixado em ${formato.toUpperCase()}.`, 'ok')
        return
      }
      const rel =
        relatorioOpcoes.base === 'calculo'
          ? montarRelatorioCalculo(relatorioOpcoes.dados as never, formato)
          : montarRelatorioConversa(relatorioOpcoes.dados as never, formato)
      baixar(rel.nome, rel.conteudo, rel.mime)
      toast(`Relatório baixado em ${formato.toUpperCase()}.`, 'ok')
      return
    }
    void enviar(b.alvo)
  }

  let ultimoDia = ''
  const fotoAtual = fotos[indiceFoto % Math.max(1, fotos.length)]

  return (
    <Entrada className="aurum-modulo relative z-[1] mx-auto w-full max-w-[73rem] px-2 py-3">
      <div className="aero-vidro relative flex h-[calc(91dvh-8.2rem)] min-h-[416px] overflow-hidden rounded-2xl shadow-pop">
        {/* Esquerda: arquivadas */}
        {lateralAberta ? (
          <aside className="flex w-60 min-h-0 shrink-0 flex-col border-r border-white/40 dark:border-white/10" aria-label="Conversas arquivadas">
            <div className="flex items-center gap-1.5 p-2.5">
              <button
                type="button"
                onClick={() => {
                  nova()
                  toast('Nova conversa iniciada.', 'ok')
                  // Abre a telinha limpa já com o cursor no campo de digitação.
                  requestAnimationFrame(() => {
                    document.getElementById('chat-aurum-entrada')?.focus()
                  })
                }}
                className="flex-1 rounded-full bg-brand-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-700"
              >
                ✚ Nova conversa
              </button>
              <button
                type="button"
                onClick={() => setLateralAberta(false)}
                className="rounded-full px-2.5 py-2 text-xs text-slate-500 transition hover:bg-white/50 dark:text-slate-300 dark:hover:bg-white/10"
                title="Ocultar painel"
                aria-label="Ocultar painel de conversas"
              >
                ◀
              </button>
            </div>
            <div className="flex items-center justify-between px-3 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Arquivadas ({arquivadas.length})
              </span>
              <button
                type="button"
                onClick={() => { arquivar(); toast('Conversa arquivada.', 'ok') }}
                className="text-[11px] font-bold text-brand-700 hover:underline dark:text-brand-300"
                title="Arquivar conversa atual"
              >
                Arquivar atual
              </button>
            </div>
            <ul className="scroll-elegante min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {arquivadas.length === 0 ? (
                <li className="rounded-xl px-3 py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                  Nenhuma arquivada ainda.<br />A conversa atual vai para cá ao iniciar outra.
                </li>
              ) : (
                arquivadas.map((a) => {
                  const ativa = a.id === conversaId
                  return (
                    <li key={a.id}>
                      <div
                        className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 transition ${
                          ativa ? 'bg-white/70 shadow-sm dark:bg-white/10' : 'hover:bg-white/50 dark:hover:bg-white/5'
                        }`}
                      >
                        <button type="button" onClick={() => restaurar(a.id)} className="min-w-0 flex-1 text-left" title={ativa ? `Conversa atual — ${a.titulo}` : `Abrir: ${a.titulo}`}>
                          <span className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{a.titulo}</span>
                          <span className="block text-[10px] text-slate-400">
                            {new Date(a.quando).toLocaleDateString('pt-BR')} · {a.mensagens.length} msgs{ativa ? ' · atual' : ''}
                          </span>
                        </button>
                        {/* Ações por chat: aparecem ao passar o mouse / focar (teclado e toque sempre visíveis no mobile). */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              if (ativa) {
                                arquivar()
                                toast('Conversa arquivada.', 'ok')
                                requestAnimationFrame(() => entradaRef.current?.focus({ preventScroll: true }))
                              } else {
                                toast('Conversa já está arquivada — clique para abrir.', '')
                              }
                            }}
                            className="rounded-lg px-1.5 py-1 text-[13px] leading-none text-slate-400 transition hover:bg-amber-100 hover:text-amber-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-300"
                            title={ativa ? 'Arquivar esta conversa' : 'Já arquivada'}
                            aria-label={ativa ? `Arquivar ${a.titulo}` : `${a.titulo} já arquivada`}
                          >
                            📦
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              excluirConversa(a.id)
                              toast('Conversa excluída.', 'ok')
                              requestAnimationFrame(() => entradaRef.current?.focus({ preventScroll: true }))
                            }}
                            className="rounded-lg px-1.5 py-1 text-[13px] leading-none text-slate-400 transition hover:bg-red-100 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-red-900/40 dark:hover:text-red-300"
                            title="Excluir esta conversa"
                            aria-label={`Excluir ${a.titulo}`}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })
              )}
            </ul>
            {fotoAtual ? (
              <p className="px-3 pb-2 text-[10px] text-slate-400">Foto: {fotoAtual.autor} · Pexels</p>
            ) : null}
          </aside>
        ) : null}

        {/* Direita: conversa WhatsApp */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Conversa com ${NOME_IA}`}>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/40 px-3 dark:border-white/10">
            {!lateralAberta ? (
              <button
                type="button"
                onClick={() => setLateralAberta(true)}
                className="rounded-full px-2.5 py-2 text-xs text-slate-500 transition hover:bg-white/50 dark:text-slate-300 dark:hover:bg-white/10"
                title="Mostrar conversas"
                aria-label="Mostrar conversas arquivadas"
              >
                ☰
              </button>
            ) : null}
            <AurinhaAvatar
              tamanho={38}
              digitando={enviando}
              titulo={enviando ? 'Aurinha digitando…' : 'Aurinha — assistente Aurum AI online'}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{NOME_IA}</div>
              <div className="truncate text-[11px] text-emerald-600 dark:text-emerald-400">
                {enviando ? 'digitando…' : 'online'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPainelFundoAberto((v) => !v)}
              className="rounded-full px-2.5 py-2 text-sm text-slate-500 transition hover:bg-white/50 dark:text-slate-300 dark:hover:bg-white/10"
              title="Fundo da conversa (chave Pexels)"
              aria-label="Configurar fundo da conversa"
              aria-expanded={painelFundoAberto}
            >
              🖼
            </button>
          </header>

          {painelFundoAberto ? (
            <div className="shrink-0 border-b border-white/40 bg-white/60 px-3 py-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
              <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                Fundo animado (Pexels)
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {chaveNoCodigo
                  ? 'Chave configurada no código — só escolha o tema.'
                  : 'Sem chave no código — usando fundo local.'}
              </p>
              <div className="mt-2 grid gap-1.5">
                <Texto
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Tema das fotos (ex.: natureza minimalista)"
                  value={tema}
                  onChange={(e) => setTema(e.target.value)}
                  aria-label="Tema das fotos de fundo"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Btn variante="primary" tam="sm" carregando={carregandoFundo} onClick={atualizarFundo}>
                  {carregandoFundo ? 'Buscando…' : 'Salvar tema e atualizar fundo'}
                </Btn>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={animar}
                    onChange={(e) => setAnimar(e.target.checked)}
                    className="h-3.5 w-3.5 accent-brand-600"
                  />
                  Animar fundo
                </label>
                <span className="ml-auto text-[10px] text-slate-400">
                  {fotos.length ? `${fotos.length} fotos · ${fotoAtual?.autor ?? ''}` : 'fundo local'}
                </span>
              </div>
            </div>
          ) : null}

          <div
            ref={listaRef}
            onScroll={aoRolar}
            className="wa-fundo scroll-elegante min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3 sm:px-5"
            aria-live="polite"
          >
            {mensagens.map((m) => {
              const dia = rotuloDia(m.quando)
              const mostrarDia = dia !== ultimoDia
              ultimoDia = dia
              return (
                <div key={m.id}>
                  {mostrarDia ? (
                    <div className="flex justify-center py-1">
                      <span className="rounded-lg bg-white/80 px-2.5 py-1 text-[10px] font-bold text-slate-500 shadow-sm backdrop-blur dark:bg-slate-800/80 dark:text-slate-300">
                        {dia}
                      </span>
                    </div>
                  ) : null}
                  {m.papel === 'user' ? (
                    <div className="flex justify-end">
                      <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm dark:bg-[#005c4b]">
                        <div className="whitespace-pre-wrap text-sm leading-snug text-slate-900 dark:text-slate-50">{m.texto}</div>
                        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500 dark:text-slate-300/70">
                          <span>{hora(m.quando)}</span>
                          <StatusLeitura estado={estadoLeituraDe(m, mensagens, fila)} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mr-auto max-w-[82%] rounded-2xl rounded-bl-sm bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur dark:bg-[#1f2c34]/95">
                      {m.emRespostaA ? (
                        <div className="mb-1 rounded-lg border-l-2 border-brand-500 bg-slate-100/80 px-2 py-1 text-[11px] leading-snug text-slate-600 dark:bg-white/10 dark:text-slate-300" title={`Em resposta a: ${m.emRespostaA.texto}`}>
                          <span className="font-bold">Em resposta a: </span>
                          <span className="opacity-90">{m.emRespostaA.texto.length > 120 ? `${m.emRespostaA.texto.slice(0, 120)}…` : m.emRespostaA.texto}</span>
                        </div>
                      ) : null}
                      <TextoChat texto={m.texto} className="chat-md text-slate-800 dark:text-slate-100" />
                      {m.streaming ? (
                        <span className="chat-cursor" aria-hidden="true">▍</span>
                      ) : null}
                      {m.grafico ? (
                        <div className="mt-1.5">
                          <GraficoChatView grafico={m.grafico} />
                        </div>
                      ) : null}
                      {m.pensamento?.etapas.length ? (
                        <details className="mt-1 text-[11px] text-slate-400">
                          <summary className="cursor-pointer">ver raciocínio</summary>
                          <ol className="mt-0.5 list-disc pl-4">
                            {m.pensamento.etapas.map((e) => <li key={e}>{e}</li>)}
                          </ol>
                          {m.pensamento.detalhe ? <p className="mt-0.5 opacity-80">{m.pensamento.detalhe}</p> : null}
                        </details>
                      ) : null}
                      {m.fontes?.length ? (
                        <details className="mt-1 text-[11px] text-slate-400">
                          <summary className="cursor-pointer">Fontes ({m.fontes.length})</summary>
                          <ul className="mt-0.5 list-disc pl-4">
                            {m.fontes.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        </details>
                      ) : null}
                      {m.relatorio ? (
                        <div className="mt-1.5">
                          <Btn
                            variante="primary"
                            tam="sm"
                            onClick={() => {
                              baixar(m.relatorio!.nome, m.relatorio!.conteudo, m.relatorio!.mime)
                              toast('Relatório baixado.', 'ok')
                            }}
                          >
                            Baixar relatório ({m.relatorio.nome})
                          </Btn>
                        </div>
                      ) : null}
                      {m.botoes?.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={m.relatorioOpcoes ? 'Escolher formato do relatório' : 'Ações'}>
                          {m.botoes.map((b) => {
                            const ehFormato = b.acao === 'formato'
                            const ehPrimario = b.acao === 'navegar' || (ehFormato && b.alvo === 'pdf')
                            // Lote: perguntar enfileira (não bloqueia); baixar/formato exige payload.
                            const semPayload = (b.acao === 'baixar' || ehFormato) && !m.relatorio && !m.relatorioOpcoes
                            return (
                              <button
                                key={`${b.acao}:${b.rotulo}`}
                                type="button"
                                disabled={semPayload}
                                onClick={() => aoBotao(b, m.relatorio, m.relatorioOpcoes as never)}
                                className={
                                  ehPrimario
                                    ? 'rounded-full bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50'
                                    : 'rounded-full border border-slate-300 bg-white/70 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20'
                                }
                                title={ehFormato ? `Baixar relatório em ${String(b.alvo).toUpperCase()}` : b.acao === 'navegar' ? `Ir para ${b.alvo} (sem alterar dados)` : b.acao === 'baixar' ? 'Baixar o relatório' : `Perguntar: ${b.alvo}`}
                                aria-label={ehFormato ? `Baixar relatório em ${String(b.alvo).toUpperCase()}` : b.rotulo}
                              >
                                {b.rotulo}
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                      {m.sugestoes?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Sugestões">
                          {m.sugestoes.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => void enviar(s)}
                              className="rounded-full px-2 py-0.5 text-[11px] text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-800 disabled:opacity-50 dark:text-brand-300"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-0.5 text-right text-[10px] text-slate-400">{hora(m.quando)}</div>
                    </div>
                  )}
                </div>
              )
            })}
            {enviando ? <DigitandoAurum /> : null}
            {fila.length ? (
              <div className="px-1 pb-1 text-right text-[10px] font-bold text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
                {fila.length === 1 ? '1 mensagem na fila — respondo em ordem' : `${fila.length} mensagens na fila — respondo uma após a outra, em ordem`}
              </div>
            ) : null}
          </div>

          <form onSubmit={submeter} className="flex shrink-0 items-end gap-2 px-3 py-2">
            <div className="field-wrap min-w-0 flex-1 !rounded-2xl">
              <textarea
                id="chat-aurum-entrada"
                ref={entradaRef}
                autoComplete="off"
                spellCheck={false}
                placeholder={enviando ? 'Pode enviar a próxima — respondo em ordem… (Enter envia · Shift+Enter quebra linha)' : 'Conversar com Aurum AI… (Enter envia · Shift+Enter quebra linha)'}
                title="Enter envia · Shift+Enter quebra linha"
                value={entrada}
                aria-busy={enviando}
                rows={1}
                onChange={(e) => {
                  setEntrada(e.target.value)
                  // auto-expande até ~5 linhas sem empurrar o chat
                  const ta = e.target
                  ta.style.height = 'auto'
                  ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`
                }}
                onKeyDown={aoTeclarEntrada}
                aria-label={`Perguntar a ${NOME_IA} (Enter envia, Shift+Enter quebra linha)`}
                className="field field-chat !rounded-2xl"
              />
            </div>
            <button
              type="submit"
              disabled={!entrada.trim()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-base text-white shadow transition hover:bg-brand-700 disabled:opacity-40"
              title="Enviar"
              aria-label="Enviar mensagem"
            >
              ➤
            </button>
          </form>
        </section>
      </div>
    </Entrada>
  )
}
