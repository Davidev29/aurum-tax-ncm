/**
 * Tour guiado — guia de uso do sistema, redesenho v2.
 *
 * Pós-avaliação multiagente (UX · motion · instrucional · visual/A11y):
 * - 9 passos em 3 TRILHAS por objetivo (Calcular / Organizar / Dominar);
 * - 1 ideia por tela: promessa + onde fica + 3 micro-ações + dica-ganho;
 * - 1 ritmo de movimento (CURVA + 0.32s + stagger 0.06), 1 loop ambiente
 *   por tela, spotlight com `layoutId`, sem cursor-loop/ripple/ping/shimmer;
 * - CTA "Experimentar agora" navega ao menu real (antes era só informativo);
 * - stepper minimalista (dots + contador) em vez de 10 pills + mini-menu;
 * - `animar` pausa o ambiente; `prefers-reduced-motion` zera tudo.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  PASSOS_TOUR,
  TRILHAS_TOUR,
  primeiroIndiceDaTrilha,
  secaoDoPasso,
  trilhaDoPasso,
  type TrilhaId,
} from '@/domain/tutorial'
import { useTutorial } from '@/store/tutorial'
import { useUi } from '@/store/ui'
import { Btn } from './kit'
import { EscudoAurum } from './Marca'
import { CURVA, DURACAO_ENTRADA, useMovimentoReduzido } from './motion'

const TRANSICAO_PASSO = { duration: DURACAO_ENTRADA, ease: [...CURVA] } as const

/** Cor de destaque por trilha (filete + selo). */
function tomTrilha(trilha: TrilhaId): string {
  if (trilha === 'organizar') return 'from-emerald-500 to-teal-400'
  if (trilha === 'dominar') return 'from-violet-500 to-purple-400'
  return 'from-brand-600 to-aurum-400'
}

/**
 * Ilustração única por trilha — 1 animate-on-mount + 1 flutuação suave
 * (pausada por `animar` ou reduced-motion). Nada em loop concorrente.
 */
function Ilustracao({ trilha, icone, animar }: { trilha: TrilhaId; icone: string; animar: boolean }) {
  const barra =
    'h-2 rounded-full bg-gradient-to-r'
  const linha = (pct: string, classe: string, atraso: number) =>
    animar ? (
      <motion.div
        aria-hidden="true"
        className={`${barra} ${classe}`}
        initial={{ width: 0 }}
        animate={{ width: pct }}
        transition={{ duration: 0.7, ease: [...CURVA], delay: atraso }}
      />
    ) : (
      <div aria-hidden="true" className={`${barra} ${classe}`} style={{ width: pct }} />
    )

  return (
    <div
      aria-hidden="true"
      className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-3"
    >
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${tomTrilha(trilha)} opacity-70`} />
      {animar ? (
        <motion.span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-950 text-xl text-white ring-1 ring-inset ring-aurum-400/40"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {icone}
        </motion.span>
      ) : (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-950 text-xl text-white ring-1 ring-inset ring-aurum-400/40">
          {icone}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        {trilha === 'calcular' ? (
          <>
            {linha('64%', 'from-slate-400 to-slate-500', 0.1)}
            {linha('46%', 'from-emerald-500 to-emerald-400', 0.22)}
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">convencional × híbrido</div>
          </>
        ) : trilha === 'organizar' ? (
          <>
            {linha('88%', 'from-brand-600 via-brand-500 to-aurum-400', 0.1)}
            <div className="flex gap-1 text-[10px] font-black">
              <span className="rounded-full bg-emerald-100 px-1.5 py-px text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">✓ pronta</span>
              <span className="rounded-full bg-amber-100 px-1.5 py-px text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">⚠ revisar</span>
            </div>
          </>
        ) : (
          <>
            {linha('72%', 'from-violet-500 to-purple-400', 0.1)}
            <div className="font-mono text-[10px] font-bold text-slate-400">#art128 — base legal acesa</div>
          </>
        )}
      </div>
    </div>
  )
}

export function TourGuiado() {
  const aberto = useTutorial((s) => s.aberto)
  const passo = useTutorial((s) => s.passo)
  const animarStore = useTutorial((s) => s.animar)
  const alternarAnimacao = useTutorial((s) => s.alternarAnimacao)
  const fechar = useTutorial((s) => s.fechar)
  const concluir = useTutorial((s) => s.concluir)
  const irPasso = useTutorial((s) => s.irPasso)
  const proximo = useTutorial((s) => s.proximo)
  const anterior = useTutorial((s) => s.anterior)
  const reduzir = useMovimentoReduzido()
  const animar = animarStore && !reduzir

  const total = PASSOS_TOUR.length
  const atual = PASSOS_TOUR[Math.min(passo, total - 1)]
  const tituloRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (aberto) tituloRef.current?.focus?.()
  }, [aberto, passo])

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
      if (e.key === 'ArrowRight') proximo(total)
      if (e.key === 'ArrowLeft') anterior()
      if (e.key === 'Home') irPasso(0)
      if (e.key === 'End') irPasso(total - 1)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, fechar, proximo, anterior, irPasso, total])

  if (!aberto || !atual) return null
  if (typeof document === 'undefined') return null

  const ultimo = passo >= total - 1
  const trilha = trilhaDoPasso(atual.id)
  const info = secaoDoPasso(atual.id)
  const pct = Math.round(((passo + 1) / total) * 100)

  const experimentar = () => {
    const destino = atual.id
    concluir()
    useUi.getState().trocarView(destino)
  }

  const transicao = animar ? TRANSICAO_PASSO : { duration: 0 }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-titulo"
      aria-describedby="tour-desc"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) fechar()
      }}
    >
      <div className="glass-box modal-box my-6 flex max-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col overflow-hidden" role="document">
        {/* Cabeçalho compacto */}
        <div className="relative shrink-0 overflow-hidden border-b border-[var(--line)]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-700 to-brand-950 dark:from-brand-950 dark:via-brand-900 dark:to-black"
          />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-aurum-400 to-transparent" />
          <div className="relative flex items-center gap-3 px-5 py-3.5 text-white">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-aurum-400/50 bg-white/10 text-xl shadow-inner backdrop-blur">
              {atual.icone}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-aurum-200">
                Guia do sistema · {trilha.titulo}
              </div>
              <div aria-live="polite" className="truncate text-[11px] text-white/70">
                Passo {passo + 1} de {total} · {Math.max(0, total - passo - 1) === 0 ? 'último passo' : `faltam ${total - passo - 1}`}
              </div>
            </div>
            <EscudoAurum tamanho={32} />
            <button
              type="button"
              onClick={fechar}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
              title="Fechar guia (Esc)"
              aria-label="Fechar guia"
            >
              ✕
            </button>
          </div>
          <div className="relative bg-black/20 px-5 pb-3 pt-1.5">
            <div className="h-1 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do guia">
              {animar ? (
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-aurum-300 via-aurum-400 to-aurum-200"
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.4, ease: [...CURVA] }}
                />
              ) : (
                <div className="h-full rounded-full bg-gradient-to-r from-aurum-300 via-aurum-400 to-aurum-200" style={{ width: `${pct}%` }} />
              )}
            </div>
          </div>
        </div>

        {/* Trilhas + stepper minimalista */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-5 py-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Trilhas do guia">
            {TRILHAS_TOUR.map((t) => {
              const ativa = t.id === trilha.id
              return (
                <button
                  key={t.id}
                  type="button"
                  title={`${t.titulo} — ${t.descricao}`}
                  aria-pressed={ativa}
                  onClick={() => irPasso(primeiroIndiceDaTrilha(t.id))}
                  className={`relative rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    ativa ? 'text-brand-950' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {ativa && (
                    <motion.span
                      layoutId="tour-trilha"
                      className="absolute inset-0 rounded-full bg-aurum-400/90 ring-1 ring-inset ring-aurum-500"
                      transition={{ duration: 0.3, ease: [...CURVA] }}
                    />
                  )}
                  <span className="relative">
                    {t.icone} {t.titulo}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <nav className="flex items-center gap-1" aria-label="Etapas do guia">
              {PASSOS_TOUR.map((p, i) => {
                const ativo = i === passo
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={`${i + 1} · ${p.menu}`}
                    aria-label={`Ir para o passo ${i + 1}: ${p.menu}`}
                    aria-current={ativo ? 'step' : undefined}
                    onClick={() => irPasso(i)}
                    className={`relative grid h-5 w-5 place-items-center rounded-full transition ${
                      ativo ? '' : 'hover:scale-110'
                    }`}
                  >
                    {ativo && (
                      <motion.span
                        layoutId="tour-dot"
                        className="absolute inset-0 rounded-full bg-brand-900 ring-2 ring-aurum-400 dark:bg-aurum-400"
                        transition={{ duration: 0.3, ease: [...CURVA] }}
                      />
                    )}
                    <span
                      className={`relative h-1.5 rounded-full transition-all ${
                        ativo ? 'w-2.5 bg-white dark:bg-brand-950' : i < passo ? 'w-1.5 bg-brand-500' : 'w-1.5 bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                  </button>
                )
              })}
            </nav>
            <button
              type="button"
              onClick={alternarAnimacao}
              aria-pressed={!animarStore}
              title={animarStore ? 'Pausar animações do guia' : 'Retomar animações do guia'}
              aria-label={animarStore ? 'Pausar animações do guia' : 'Retomar animações do guia'}
              className="grid h-7 w-7 place-items-center rounded-lg text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-100"
            >
              {animarStore ? '⏸' : '▶'}
            </button>
          </div>
        </div>

        {/* Corpo — 1 ideia por tela, 1 nível de transição */}
        <div className="modal-scroll scroll-elegante min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={passo}
              initial={animar ? { opacity: 0, y: 14 } : { opacity: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={animar ? { opacity: 0, y: -10 } : { opacity: 0 }}
              transition={transicao}
              className="space-y-4 px-5 py-4"
            >
              <div>
                <h2 ref={tituloRef} id="tour-titulo" tabIndex={-1} className="text-[17px] font-extrabold tracking-tight outline-none">
                  {atual.icone} {atual.menu}
                </h2>
                <p id="tour-desc" className="mt-0.5 text-[13.5px] font-semibold text-brand-800 dark:text-aurum-200">
                  {atual.promessa}
                </p>
                <p className="mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  📍 Menu lateral → <strong>{info.secao}</strong> → <strong>{atual.menu}</strong>
                  <span className="text-slate-400">· item {info.pos}/{info.de}</span>
                </p>
              </div>

              <Ilustracao trilha={atual.trilha} icone={atual.icone} animar={animar} />

              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                <strong className="text-slate-800 dark:text-slate-100">{atual.oQueFaz}</strong>
              </p>

              <div>
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Como usar · 3 toques
                </div>
                <ol className="space-y-2">
                  {atual.comoUsar.map((c, i) => (
                    animar ? (
                      <motion.li
                        key={c}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: [...CURVA], delay: 0.08 + i * 0.06 }}
                        className="flex gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300"
                      >
                        <span aria-hidden="true" className="font-mono text-[11px] font-black text-[#8a6a1f] dark:text-aurum-300">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{c}</span>
                      </motion.li>
                    ) : (
                      <li
                        key={c}
                        className="flex gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300"
                      >
                        <span aria-hidden="true" className="font-mono text-[11px] font-black text-[#8a6a1f] dark:text-aurum-300">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{c}</span>
                      </li>
                    )
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>💡 Ganho:</strong> {atual.dica}
              </div>

              <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
                ✅ {atual.resultado}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Rodapé — CTA real + navegação */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
          <button
            type="button"
            onClick={concluir}
            className="text-[11px] font-semibold text-slate-400 hover:text-brand-600 dark:hover:text-aurum-300"
          >
            Pular tour →
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Btn tam="sm" onClick={anterior} disabled={passo === 0}>
              ← Anterior
            </Btn>
            <Btn tam="sm" variante="soft" onClick={experimentar} title={`Fechar o guia e abrir ${atual.menu} de verdade`}>
              ↗ {atual.acao}
            </Btn>
            {ultimo ? (
              <Btn tam="sm" variante="primary" onClick={concluir}>
                ✓ Concluir tour
              </Btn>
            ) : (
              <Btn tam="sm" variante="primary" onClick={() => proximo(total)}>
                Próximo →
              </Btn>
            )}
          </div>
        </div>
        <p className="shrink-0 border-t border-[var(--line)] bg-slate-50 px-5 py-2 text-center text-[10px] text-slate-400 dark:bg-slate-950/40">
          ← → navega · Home/End pula p/ extremos · Esc fecha · reabra em <strong>✨ Guia</strong>
        </p>
      </div>
    </div>,
    document.body,
  )
}
