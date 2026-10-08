/**
 * Tour guiado — tutorial menu a menu em interface elegante.
 *
 * Carrossel de 10 passos (um por view) com:
 * - cabeçalho em degradê marinho→ouro + escudo
 * - barra de progresso + dots clicáveis
 * - "o que faz" + "como usar" + dica
 * - ação "Abrir menu" (navega sem fechar) + Anterior/Próximo/Pular/Concluir
 * - framer-motion com respeito a prefers-reduced-motion
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { PASSOS_TOUR } from '@/domain/tutorial'
import { useTutorial } from '@/store/tutorial'
import { Btn } from './kit'
import { EscudoAurum } from './Marca'

const TRANSICAO = { type: 'spring', stiffness: 300, damping: 28 } as const

export function TourGuiado() {
  const aberto = useTutorial((s) => s.aberto)
  const passo = useTutorial((s) => s.passo)
  const fechar = useTutorial((s) => s.fechar)
  const concluir = useTutorial((s) => s.concluir)
  const irPasso = useTutorial((s) => s.irPasso)
  const proximo = useTutorial((s) => s.proximo)
  const anterior = useTutorial((s) => s.anterior)
  const irParaMenu = useTutorial((s) => s.irParaMenu)
  const reduzir = useReducedMotion() ?? false

  const total = PASSOS_TOUR.length
  const atual = PASSOS_TOUR[Math.min(passo, total - 1)]
  const tituloRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (aberto) tituloRef.current?.focus?.()
  }, [aberto, passo])

  // Escape fecha (sem concluir — o carimbo só vai no "Concluir").
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
      if (e.key === 'ArrowRight') proximo(total)
      if (e.key === 'ArrowLeft') anterior()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, fechar, proximo, anterior, total])

  if (!aberto || !atual) return null
  if (typeof document === 'undefined') return null

  const ultimo = passo >= total - 1

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Tour guiado do Aurum Tax NCM"
    >
      <div className="glass-box modal-box my-6 w-full max-w-2xl" role="document">
        {/* Cabeçalho nobre: marinho profundo + filete ouro */}
        <div className="relative overflow-hidden border-b border-[var(--line)]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-700 to-brand-950 dark:from-brand-950 dark:via-brand-900 dark:to-black"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-aurum-400 to-transparent"
          />
          <div className="relative flex items-center gap-3 px-5 py-4 text-white">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-aurum-400/50 bg-white/10 text-2xl shadow-inner backdrop-blur">
              {atual.icone}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-aurum-200">
                Tour guiado · {passo + 1} de {total}
              </div>
              <h2 className="truncate text-base font-black tracking-tight">
                {atual.menu}
              </h2>
              <p className="truncate text-[11px] text-white/70">
                Menu por menu — o que faz e como usar
              </p>
            </div>
            <EscudoAurum tamanho={40} />
          </div>
          {/* progresso */}
          <div className="relative bg-black/20 px-5 pb-3 pt-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-aurum-300 via-aurum-400 to-aurum-200 transition-[width] duration-300"
                style={{ width: `${Math.round(((passo + 1) / total) * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Etapas do tour">
              {PASSOS_TOUR.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === passo}
                  title={p.menu}
                  onClick={() => irPasso(i)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                    i === passo
                      ? 'bg-aurum-400 text-brand-950'
                      : i < passo
                        ? 'bg-white/25 text-white hover:bg-white/35'
                        : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {i + 1} · {p.menu}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div ref={tituloRef} tabIndex={-1} className="outline-none">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={passo}
              initial={reduzir ? { opacity: 0 } : { opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduzir ? { opacity: 0 } : { opacity: 0, x: -48 }}
              transition={reduzir ? { duration: 0.15 } : TRANSICAO}
              className="modal-scroll scroll-elegante min-h-[16rem] space-y-3 px-5 py-4 text-xs leading-relaxed"
            >
              <p className="text-sm leading-relaxed">
                <strong>{atual.oQueFaz}</strong>
              </p>

              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Como usar
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                  {atual.comoUsar.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-aurum-500/40 bg-gradient-to-br from-aurum-50 to-white p-3 text-brand-800 dark:border-aurum-800 dark:from-brand-950/40 dark:to-slate-900 dark:text-aurum-200">
                <strong>✨ Dica:</strong> {atual.dica}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
          <button
            type="button"
            onClick={concluir}
            className="text-[11px] font-semibold text-slate-400 hover:text-brand-600"
          >
            Pular tour →
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={anterior} disabled={passo === 0}>
              ← Anterior
            </Btn>
            <Btn variante="soft" onClick={() => irParaMenu(atual.id)}>
              {atual.acao} →
            </Btn>
            {ultimo ? (
              <Btn variante="primary" onClick={concluir}>
                ✓ Concluir tour
              </Btn>
            ) : (
              <Btn variante="primary" onClick={() => proximo(total)}>
                Próximo →
              </Btn>
            )}
          </div>
        </div>
        <p className="border-t border-[var(--line)] bg-slate-50 px-5 py-2 text-center text-[10px] text-slate-400 dark:bg-slate-950/40">
          Dica: use ← → para navegar · Esc fecha · reabra quando quiser no botão <strong>✨ Guia</strong> do topo
        </p>
      </div>
    </div>,
    document.body,
  )
}
