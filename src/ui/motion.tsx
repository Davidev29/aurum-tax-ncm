/**
 * Primitivos de animação do sistema (framer-motion).
 *
 * Linguagem única de movimento — curva, duração e respeito a
 * `prefers-reduced-motion` centralizados aqui:
 *
 * - `Pagina`: invólucro de cada troca de menu (enter/exit suaves via
 *   `AnimatePresence mode="wait"` no `Layout`). Cada troca usa um preset
 *   DIFERENTE do anterior (carrossel `PRESETS_TRANSICAO` avançado a cada
 *   `trocarView`): subir, deslizar-esquerda, deslizar-direita, zoom e descer
 *   — nunca repete em sequência. Tudo no compositor (opacity/transform).
 * - `Secao` / `Revelar`: reveal on-scroll (scroll trigger) — surgem ao entrar
 *   na viewport UMA vez só. Funcionam dentro da área rolável `#conteudo`
 *   (IntersectionObserver observa a viewport; o container interno não impede
 *   o disparo).
 * - `Lista` / `Item`: stagger para grids (stats, KPIs, rankings).
 * - `Entrada`: conteúdo acima da dobra — anima na montagem, sem scroll trigger.
 * - `Expansivel`: acordeão animado por altura (filtros Reforma).
 */
import { AnimatePresence, motion, useReducedMotion, type Target, type TargetAndTransition, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

export const CURVA = [0.22, 0.9, 0.3, 1] as const
export const DURACAO = 0.35
/** Saída de view: propositalmente mais curta que a entrada. */
export const DURACAO_SAIDA = 0.18
/** Entrada de view: fade + deslize curto, elegante sem parecer lento. */
export const DURACAO_ENTRADA = 0.32

export function useMovimentoReduzido(): boolean {
  return useReducedMotion() ?? false
}

const VARIANTS_SECAO: Variants = {
  oculta: { opacity: 0, y: 22 },
  visivel: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [...CURVA] },
  },
}

/**
 * Carrossel de transições de menu — cada troca de view avança UMA posição
 * (`transicaoSeq` no store `ui`), então duas trocas seguidas NUNCA repetem
 * a mesma animação. Todos os presets usam só opacity + transform (GPU).
 */
export interface PresetTransicao {
  nome: string
  inicial: Target
  entrada: TargetAndTransition
  saida: TargetAndTransition
  /** Versão de amplitude reduzida para o título do cabeçalho (sincronizada). */
  cabecalhoInicial: Target
  cabecalhoSaida: TargetAndTransition
}

const ENTRADA_PAGINA: TargetAndTransition = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  transition: { duration: DURACAO_ENTRADA, ease: [...CURVA] },
}

const SAIDA_PAGINA: TargetAndTransition = {
  opacity: 0,
  transition: { duration: DURACAO_SAIDA, ease: [...CURVA] },
}

export const PRESETS_TRANSICAO: PresetTransicao[] = [
  {
    nome: 'subir',
    inicial: { opacity: 0, y: 26, scale: 0.996 },
    entrada: { ...ENTRADA_PAGINA },
    saida: { ...SAIDA_PAGINA, y: -14, scale: 0.998 },
    cabecalhoInicial: { opacity: 0, y: 10 },
    cabecalhoSaida: { opacity: 0, y: -8, transition: { duration: DURACAO_SAIDA, ease: [...CURVA] } },
  },
  {
    nome: 'esquerda',
    inicial: { opacity: 0, x: 36 },
    entrada: { ...ENTRADA_PAGINA },
    saida: { ...SAIDA_PAGINA, x: -22 },
    cabecalhoInicial: { opacity: 0, x: 14 },
    cabecalhoSaida: { opacity: 0, x: -10, transition: { duration: DURACAO_SAIDA, ease: [...CURVA] } },
  },
  {
    nome: 'zoom',
    inicial: { opacity: 0, scale: 0.965, y: 10 },
    entrada: { ...ENTRADA_PAGINA },
    saida: { ...SAIDA_PAGINA, scale: 0.982, y: -8 },
    cabecalhoInicial: { opacity: 0, scale: 0.96, y: 6 },
    cabecalhoSaida: { opacity: 0, scale: 0.98, transition: { duration: DURACAO_SAIDA, ease: [...CURVA] } },
  },
  {
    nome: 'direita',
    inicial: { opacity: 0, x: -36 },
    entrada: { ...ENTRADA_PAGINA },
    saida: { ...SAIDA_PAGINA, x: 22 },
    cabecalhoInicial: { opacity: 0, x: -14 },
    cabecalhoSaida: { opacity: 0, x: 10, transition: { duration: DURACAO_SAIDA, ease: [...CURVA] } },
  },
  {
    nome: 'descer',
    inicial: { opacity: 0, y: -24, scale: 0.996 },
    entrada: { ...ENTRADA_PAGINA },
    saida: { ...SAIDA_PAGINA, y: 16, scale: 0.998 },
    cabecalhoInicial: { opacity: 0, y: -10 },
    cabecalhoSaida: { opacity: 0, y: 8, transition: { duration: DURACAO_SAIDA, ease: [...CURVA] } },
  },
]

/** Preset da vez a partir do contador de trocas (nunca repete em sequência). */
export function presetTransicao(seq: number): PresetTransicao {
  const i = ((seq % PRESETS_TRANSICAO.length) + PRESETS_TRANSICAO.length) % PRESETS_TRANSICAO.length
  return PRESETS_TRANSICAO[i]
}

/**
 * Invólucro de página — usado pelo `Layout` em TODA troca de menu.
 * Não usar diretamente nas telas (o `Layout` já envolve o conteúdo).
 */
export function Pagina({
  children,
  className = '',
  viewKey,
  seq = 0,
}: {
  children: ReactNode
  className?: string
  viewKey: string
  /** Contador de trocas (`transicaoSeq`): cada valor usa um preset diferente. */
  seq?: number
}) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div className={className}>{children}</div>
  const preset = presetTransicao(seq)
  return (
    <motion.div
      key={viewKey}
      className={`view-motion transform-gpu ${className}`}
      initial={preset.inicial}
      animate={preset.entrada}
      exit={preset.saida}
      style={{ willChange: 'opacity, transform' }}
    >
      {children}
    </motion.div>
  )
}

/** `AnimatePresence` padrão das trocas de view (espera a saída antes de entrar). */
export function TransicaoView({ viewKey, children, seq = 0 }: { viewKey: string; children: ReactNode; seq?: number }) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div key={viewKey}>{children}</div>
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Pagina key={viewKey} viewKey={viewKey} seq={seq}>
        {children}
      </Pagina>
    </AnimatePresence>
  )
}

/** Bloco que surge suavemente ao entrar na viewport (uma vez só). */
export function Secao({
  children,
  className = '',
  atraso = 0,
  id,
  rotulo,
}: {
  children: ReactNode
  className?: string
  atraso?: number
  id?: string
  /** Rótulo acessível (`aria-label` da seção). */
  rotulo?: string
}) {
  const reduzir = useMovimentoReduzido()
  if (reduzir) return <div id={id} className={className}>{children}</div>
  return (
    <motion.section
      id={id}
      aria-label={rotulo}
      className={`transform-gpu ${className}`}
      variants={VARIANTS_SECAO}
      initial="oculta"
      whileInView="visivel"
      viewport={{ once: true, amount: 0.12, margin: '-48px' }}
      transition={{ delay: Math.min(atraso, 0.25) }}
      style={{ willChange: 'opacity, transform' }}
    >
      {children}
    </motion.section>
  )
}

/**
 * Mesmo reveal da `Secao`, mas como `div` — para blocos inline/cards dentro
 * das telas (scroll trigger sem semântica de seção).
 */
export function Revelar({
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
      className={`transform-gpu ${className}`}
      variants={VARIANTS_SECAO}
      initial="oculta"
      whileInView="visivel"
      viewport={{ once: true, amount: 0.12, margin: '-48px' }}
      transition={{ delay: Math.min(atraso, 0.25) }}
      style={{ willChange: 'opacity, transform' }}
    >
      {children}
    </motion.div>
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
      viewport={{ once: true, amount: 0.1, margin: '-32px' }}
      variants={{ oculta: {}, visivel: { transition: { staggerChildren: Math.min(intervalo, 0.07) } } }}
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
      className={`transform-gpu ${className}`}
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
      className={`transform-gpu ${className}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURACAO, ease: [...CURVA], delay: Math.min(atraso, 0.2) }}
      style={{ willChange: 'opacity, transform' }}
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
      viewport={{ once: true, amount: 0.4, margin: '-24px' }}
      transition={{ duration: 0.6, ease: [...CURVA] }}
    />
  )
}
