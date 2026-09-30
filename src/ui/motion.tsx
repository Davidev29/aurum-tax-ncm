/**
 * Primitivos de animação do sistema (framer-motion).
 *
 * Centraliza curvas, distâncias e o respeito a `prefers-reduced-motion` para
 * que todas as telas animem com a mesma linguagem — em especial a tela de XML.
 *
 * - `Secao`: reveal on-scroll (itens aparecendo conforme rolagem).
 * - `Lista` / `Item`: stagger para grids (stats, KPIs, rankings).
 * - `Expansivel`: acordeão animado por altura (filtros Reforma).
 * - `useMovimentoReduzido`: desliga deslocamentos quando o SO pedir.
 */
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

export const CURVA = [0.22, 0.9, 0.3, 1] as const
export const DURACAO = 0.35

export function useMovimentoReduzido(): boolean {
  return useReducedMotion() ?? false
}

const VARIANTS_SECAO: Variants = {
  oculta: { opacity: 0, y: 18 },
  visivel: {
    opacity: 1,
    y: 0,
    transition: { duration: DURACAO, ease: [...CURVA] },
  },
}

/** Bloco que surge suavemente ao entrar na viewport (uma vez só). */
export function Secao({
  children,
  className = '',
  atraso = 0,
  id,
}: {
  children: ReactNode
  className?: string
  atraso?: number
  id?: string
}) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div id={id} className={className}>{children}</div>
  return (
    <motion.section
      id={id}
      className={className}
      variants={VARIANTS_SECAO}
      initial="oculta"
      whileInView="visivel"
      viewport={{ once: true, margin: '-48px' }}
      transition={{ delay: atraso }}
    >
      {children}
    </motion.section>
  )
}

/** Container com stagger — os `Item` filhos entram em cascata. */
export function Lista({
  children,
  className = '',
  intervalo = 0.06,
}: {
  children: ReactNode
  className?: string
  intervalo?: number
}) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial="oculta"
      whileInView="visivel"
      viewport={{ once: true, margin: '-32px' }}
      variants={{ oculta: {}, visivel: { transition: { staggerChildren: intervalo } } }}
    >
      {children}
    </motion.div>
  )
}

/** Item de uma `Lista` — fade-up curto com a curva padrão. */
export function Item({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      variants={{
        oculta: { opacity: 0, y: 14 },
        visivel: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [...CURVA] } },
      }}
    >
      {children}
    </motion.div>
  )
}

/** Entrada imediata (acima da dobra): sem `whileInView`, anima na montagem. */
export function Entrada({
  children,
  className = '',
  atraso = 0,
}: {
  children: ReactNode
  className?: string
  atraso?: number
}) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURACAO, ease: [...CURVA], delay: atraso }}
    >
      {children}
    </motion.div>
  )
}

/** Acordeão vertical animado (altura + opacidade). */
export function Expansivel({ aberto, children }: { aberto: boolean; children: ReactNode }) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return aberto ? <div>{children}</div> : null
  return (
    <motion.div
      initial={false}
      animate={aberto ? 'aberta' : 'fechada'}
      variants={{
        aberta: { height: 'auto', opacity: 1, transition: { duration: 0.3, ease: [...CURVA] } },
        fechada: { height: 0, opacity: 0, transition: { duration: 0.25, ease: [...CURVA] } },
      }}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

/** Barra horizontal que cresce de 0 até `pct` ao entrar em vista. */
export function BarraAnimada({
  pct,
  className = '',
}: {
  pct: number
  className?: string
}) {
  const reduzir = useMovimentoReduzido()
  const alvo = `${Math.max(4, Math.min(100, pct))}%`
  if (reduzir) return <div className={className} style={{ width: alvo }} />
  return (
    <motion.div
      className={className}
      initial={{ width: 0 }}
      whileInView={{ width: alvo }}
      viewport={{ once: true, margin: '-24px' }}
      transition={{ duration: 0.6, ease: [...CURVA] }}
    />
  )
}
