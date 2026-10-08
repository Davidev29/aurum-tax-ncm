/**
 * Kit de interface — componentes pequenos, sem estado de negócio.
 *
 * Toda a superfície visual usa as classes utilitárias declaradas em
 * `src/index.css` (`.btn`, `.field`, `.panel`, `.pill`, `.tbl`, `.modal-*`),
 * de modo que o design tokens da v1 continuam sendo a única fonte de verdade.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { ANEXO_LABELS, rotuloAnexoOficial } from '@/domain/constants/tributarios'
import { MASK, type MaskKey } from '@/domain/services/format'
import { useUi } from '@/store/ui'

/* --------------------------------------------------------------- botões --- */

type VarianteBtn = 'primary' | 'ghost' | 'soft' | 'danger'
type TamBtn = 'sm' | 'md' | 'lg'

const VARIANTE: Record<VarianteBtn, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  soft: 'btn-soft',
  danger: 'btn-danger',
}

export function Btn({
  variante = 'ghost',
  tam = 'md',
  carregando = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBtn
  tam?: TamBtn
  /**
   * Ação em andamento: desabilita, anuncia `busy` às tecnologias assistivas
   * e exibe o giro — o usuário nunca fica sem feedback tátil/visual.
   */
  carregando?: boolean
}) {
  const t = tam === 'sm' ? 'btn-sm' : tam === 'lg' ? 'btn-lg' : ''
  const ocupado = carregando || disabled
  return (
    <button
      type="button"
      className={`btn btn-press ${VARIANTE[variante]} ${t} ${className}`}
      disabled={ocupado}
      aria-busy={carregando || undefined}
      {...props}
    >
      {carregando ? <span className="btn-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

/**
 * Envolve uma ação assíncrona com estado de loading para o `Btn`.
 *
 * Uso: `const pdf = useAcaoTatil(exportarPdf)` →
 * `<Btn carregando={pdf.carregando} onClick={pdf.executar}>📕 PDF</Btn>`.
 * Ignora cliques repetidos enquanto a ação anterior não concluiu; a ação
 * mantém seu próprio `try/catch` + toast — aqui só vai e volta o giro.
 */
export function useAcaoTatil<A extends unknown[]>(acao: (...args: A) => Promise<unknown> | unknown): {
  carregando: boolean
  executar: (...args: A) => void
} {
  const [carregando, setCarregando] = useState(false)
  const acaoRef = useRef(acao)
  acaoRef.current = acao
  const ocupadoRef = useRef(false)
  const executar = useCallback((...args: A) => {
    if (ocupadoRef.current) return
    const r = acaoRef.current(...args)
    if (r != null && typeof (r as Promise<unknown>).then === 'function') {
      ocupadoRef.current = true
      setCarregando(true)
      const concluir = () => {
        ocupadoRef.current = false
        setCarregando(false)
      }
      void (r as Promise<unknown>).then(concluir, concluir)
    }
  }, [])
  return { carregando, executar }
}

/* -------------------------------------------------------------- campos --- */

export function Campo({
  label,
  obrigatorio,
  children,
  className = '',
  dica,
}: {
  label: string
  obrigatorio?: boolean
  children: ReactNode
  className?: string
  dica?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">
        {label}
        {obrigatorio ? <span className="req">*</span> : null}
      </span>
      {children}
      {dica ? <span className="mt-1 block text-[11px] text-slate-400">{dica}</span> : null}
    </label>
  )
}

export interface CampoTextoProps extends InputHTMLAttributes<HTMLInputElement> {
  mask?: MaskKey
  mono?: boolean
  grande?: boolean
  erro?: boolean
}

/**
 * Input com máscara aplicada em `input` — compensa o cursor (`delta`), como
 * fazia o listener global da v1 (SPEC R10.5).
 */
export function Texto({ mask, mono, grande, erro, className = '', onChange, ...props }: CampoTextoProps) {
  const ref = useRef<HTMLInputElement>(null)

  const aoMudar = (e: ChangeEvent<HTMLInputElement>) => {
    if (!mask) {
      onChange?.(e)
      return
    }
    const alvo = e.target
    const antes = alvo.value
    const depois = MASK[mask](antes)
    const pos = alvo.selectionStart ?? depois.length
    const delta = depois.length - antes.length
    // Aplica a máscara no DOM antes de propagar: o handler do componente pai
    // lê `e.target.value` já formatado (mesmo comportamento da v1).
    alvo.value = depois
    if (document.activeElement === alvo && typeof alvo.setSelectionRange === 'function') {
      const nova = Math.max(0, pos + delta)
      window.requestAnimationFrame(() => alvo.setSelectionRange(nova, nova))
    }
    onChange?.(e)
  }

  return (
    <input
      ref={ref}
      type="text"
      className={`field ${mono ? 'field-mono' : ''} ${grande ? 'field-lg' : ''} ${erro ? 'field-err' : ''} ${className}`}
      onChange={aoMudar}
      {...props}
    />
  )
}

export function Area({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`field ${className}`} {...props} />
}

export function Selecao({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`field select-glass ${className}`} {...props} />
}

export function Check({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <input type="checkbox" className="h-4 w-4 accent-brand-700 dark:accent-aurum-400" {...props} />
      {label}
    </label>
  )
}

/* ------------------------------------------------------------ superfícies -- */

export function Painel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>
}

export function TituloSecao({ children }: { children: ReactNode }) {
  return <div className="section-title">{children}</div>
}

export type CorPill = 'slate' | 'emerald' | 'amber' | 'red' | 'brand'

const CORES_PILL: Record<CorPill, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  brand: 'bg-brand-100 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200',
}

export function Pill({ cor = 'slate', children }: { cor?: CorPill; children: ReactNode }) {
  return <span className={`pill ${CORES_PILL[cor]}`}>{children}</span>
}

/* --------------------------------------------------------------- ícones --- */

/**
 * Ícones SVG inline do sistema (sem dependência externa).
 * Traço de 1.8px com `currentColor`: herdam a cor do badge, com alto
 * contraste no claro e no escuro — substituem os emojis, que variam por
 * plataforma e têm pouca visibilidade.
 */
export type NomeIcone =
  | 'nota'
  | 'calendario'
  | 'fornecedor'
  | 'caixa'
  | 'calculadora'
  | 'rosca'
  | 'grafico'
  | 'trofeu'
  | 'moeda'
  | 'lupa'
  | 'pasta'
  | 'documento'
  | 'livros'
  | 'empresa'
  | 'alerta'
  | 'aurum'

const TRACOS_ICONE: Record<NomeIcone, ReactNode> = {
  nota: (
    <path d="M7 3h7l4 4v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v4h4M9 12h6M9 15.5h6" />
  ),
  calendario: (
    <path d="M5 6h14a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1Zm-1 5h16M8 3v4M16 3v4" />
  ),
  fornecedor: (
    <path d="M4 20V10l5-5h6l5 5v10M4 20h16M9 20v-5h6v5M9 10h.01M12 10h.01M15 10h.01" />
  ),
  caixa: (
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5L12 12M4 7.5 12 12m0 9v-9" />
  ),
  calculadora: (
    <path d="M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm-1 6h14M9 6V4m6 2V4M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01M8.5 19h.01M12 19h.01M15.5 19h.01" />
  ),
  rosca: (
    <path d="M12 4a8 8 0 1 0 8 8M12 8a4 4 0 1 0 4 4M18 3v4h-4" />
  ),
  grafico: (
    <path d="M4 4v15a1 1 0 0 0 1 1h15M8 15v-4m4 4V8m4 7v-6" />
  ),
  trofeu: (
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 5H4a1 1 0 0 0-1 1c0 2.5 2 4.5 5 4.5m8-5.5h4a1 1 0 0 1 1 1c0 2.5-2 4.5-5 4.5M12 13v4m-4 4h8m-8 0-1 2m9-2 1 2" />
  ),
  moeda: (
    <path d="M12 3a9 9 0 1 0 9 9M12 7v10m-4-7.5c0-1 1.8-2 4-2s4 1 4 2-1.5 2.5-4 3-4 1.5-4 3 1.8 2 4 2 4-1 4-2" />
  ),
  alerta: (
    <path d="M12 3 2.5 20h19L12 3Zm0 7v4m0 3.5h.01" />
  ),
  lupa: (
    <path d="m14.5 14.5 5 5M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
  ),
  pasta: (
    <path d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
  ),
  documento: (
    <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm7 0v4h4" />
  ),
  livros: (
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11" />
  ),
  empresa: (
    <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M2 21h20M7 8h4m-4 4h4m-4 4h4" />
  ),
  aurum: (
    <path d="M12 2.5c.7 4.5 1.9 6.7 9.5 9.5-7.6 2.8-8.8 5-9.5 9.5-.7-4.5-1.9-6.7-9.5-9.5 7.6-2.8 8.8-5 9.5-9.5Z" />
  ),
}

export function Icone({ nome, className = '' }: { nome: NomeIcone; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icone-svg ${className}`}
      aria-hidden="true"
    >
      {TRACOS_ICONE[nome]}
    </svg>
  )
}

type TomBadge = 'brand' | 'emerald' | 'amber' | 'slate' | 'red' | 'violet'

/** Selo de ícone com gradiente + sombra: visível no claro e no escuro. */
export function IconeBadge({
  nome,
  tom = 'brand',
  tamanho = 'md',
}: {
  nome: NomeIcone
  tom?: TomBadge
  tamanho?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span className={`icone-badge icone-badge--${tom} icone-badge--${tamanho}`} aria-hidden="true">
      <Icone nome={nome} />
    </span>
  )
}

/** Badge de anexo — SPEC R3.3 (emoji incluído).
 *
 * Duas famílias distintas (nunca misturar):
 * - Derivado (`0`, `80`…`30`, `misto`, `isento`): faixa calculada da redução,
 *   usada no NF-e/Lote — rótulo em `ANEXO_LABELS`.
 * - Oficial (`1`…`15`, `9xxxx`): `Número do Anexo` da base CFF, exibido nos
 *   cartões de consulta — rótulo em `rotuloAnexoOficial` (antes caía no
 *   fallback "Sem redução", falso para ex.: Anexo I com alíquota zero).
 */
export function AnexoBadge({ anexo }: { anexo: string | null | undefined }) {
  const chave = anexo && anexo !== '' ? String(anexo) : 'isento'
  const derivado = ['0', '80', '70', '60', '50', '40', '30', 'misto', 'isento'].includes(chave)
  const classe = ['0', '80', '70', '60', '50', '40', '30'].includes(chave)
    ? `anexo-${chave}`
    : chave === 'misto'
      ? 'anexo-misto'
      : 'anexo-isento'
  return (
    <span className={`anexo-badge ${classe}`}>
      {derivado ? (ANEXO_LABELS[chave] ?? ANEXO_LABELS.isento) : rotuloAnexoOficial(chave)}
    </span>
  )
}

export function Vazio({
  icone = '📄',
  titulo,
  texto,
  children,
}: {
  icone?: string
  titulo: string
  texto?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center dark:border-slate-700 dark:bg-slate-950/30">
      <div className="text-4xl opacity-60">{icone}</div>
      <div className="mt-2 text-sm font-semibold">{titulo}</div>
      {texto ? <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{texto}</div> : null}
      {children}
    </div>
  )
}

export function BarraProgresso({ pct, etapa }: { pct: number; etapa?: string }) {
  const arred = Math.round(pct)
  return (
    <div className="space-y-1.5" role="progressbar" aria-valuenow={arred} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-brand-700 to-aurum-500 transition-[width] duration-300"
          style={{ width: `${Math.max(2, Math.min(100, arred))}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{etapa ?? 'Processando…'}</span>
        <span className="num font-mono">{arred}%</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- modal --- */

/**
 * Pilha global de `Escape` dos modais — com modais empilhados (detalhe →
 * DANFE, fornecedor → detalhe), só o modal do topo reage ao `Escape`.
 * O `z-index` também escala a cada abertura (o mais novo sempre pinta acima),
 * independente da ordem dos modais no DOM.
 */
let seqModal = 0
const pilhaEscapeModal: Array<(e: KeyboardEvent) => void> = []

/** Empilha um handler de `Escape`; retorna a função de desempilhar. */
export function empilharEscapeModal(handler: (e: KeyboardEvent) => void): () => void {
  pilhaEscapeModal.push(handler)
  return () => {
    const i = pilhaEscapeModal.indexOf(handler)
    if (i >= 0) pilhaEscapeModal.splice(i, 1)
    if (!pilhaEscapeModal.length) seqModal = 0
  }
}

/** O handler pertence ao modal do topo? */
export function ehTopoEscapeModal(handler: (e: KeyboardEvent) => void): boolean {
  return pilhaEscapeModal[pilhaEscapeModal.length - 1] === handler
}

export function Modal({
  aberto,
  onFechar,
  titulo,
  subtitulo,
  largura = 'max-w-2xl',
  children,
  rodape,
}: {
  aberto: boolean
  onFechar: () => void
  titulo: string
  subtitulo?: string
  largura?: string
  children: ReactNode
  rodape?: ReactNode
}) {
  const [visivel, setVisivel] = useState(aberto)
  const [saindo, setSaindo] = useState(false)
  // `z-index` próprio por abertura: o modal mais novo pinta acima dos
  // anteriores, mesmo sendo irmão no DOM (todos usam `.modal-backdrop`).
  const [z, setZ] = useState(60)
  const fecharRef = useRef(onFechar)
  fecharRef.current = onFechar
  // Focus-trap + retorno de foco (a11y): guarda quem abriu o modal.
  const caixaRef = useRef<HTMLDivElement>(null)
  const retornoFocoRef = useRef<Element | null>(null)

  // Abertura e fechamento suaves: ao fechar, mantém montado ~180 ms para a
  // animação de saída terminar antes de desmontar.
  useEffect(() => {
    if (aberto) {
      setVisivel(true)
      setSaindo(false)
      return
    }
    if (!visivel) return
    setSaindo(true)
    const t = window.setTimeout(() => {
      setVisivel(false)
      setSaindo(false)
    }, 180)
    return () => window.clearTimeout(t)
  }, [aberto, visivel])

  // Empilhado: registra o `Escape` na pilha global e só reage quando este
  // modal é o do topo — fechar o de cima nunca arrasta os de baixo.
  useEffect(() => {
    if (!aberto) return
    seqModal += 1
    // Teto 79: a pilha de modais cresce 65, 70, 75… mas NUNCA alcança o tour
    // (80), o diálogo de confirmação (85), o termo (90) nem os toasts (100).
    // Sem teto, o 2º modal empatava com o tour e o 3º cobria o diálogo —
    // ex.: "Sobrescrever produto?" sumia atrás do modal que o chamou.
    // (Produto → detalhe fiscal → legislação = 3 níveis distintos: 65/70/75.)
    setZ(Math.min(60 + seqModal * 5, 79))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ehTopoEscapeModal(onKey)) fecharRef.current()
    }
    window.addEventListener('keydown', onKey)
    const desempilhar = empilharEscapeModal(onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      desempilhar()
    }
  }, [aberto])

  // Foco inicial + retorno (a11y): ao abrir, guarda quem tinha o foco e move
  // para dentro do modal; ao fechar, devolve a quem abriu — o usuário de
  // teclado nunca se perde. Best-effort, nunca lança.
  useEffect(() => {
    if (!aberto) return
    try {
      retornoFocoRef.current = document.activeElement
    } catch {
      retornoFocoRef.current = null
    }
    const t = window.setTimeout(() => {
      try {
        const caixa = caixaRef.current
        const primeiro = caixa?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        ;(primeiro ?? caixa)?.focus?.()
      } catch {
        /* foco indisponível: segue */
      }
    }, 60)
    return () => {
      window.clearTimeout(t)
      try {
        const el = retornoFocoRef.current
        if (el instanceof HTMLElement && document.contains(el)) el.focus({ preventScroll: true })
      } catch {
        /* ignora */
      }
    }
  }, [aberto])

  if (!visivel) return null
  // Portal no `document.body`: o `fixed` do `.modal-backdrop` passa a ter a
  // viewport como referência. Sem isso, qualquer ancestral com
  // `transform/filter/perspective` (ex.: `Pagina`/`Entrada` do framer-motion,
  // `animate-fade-up` da tela de XML) vira o bloco de contenção do `fixed` e
  // o modal abre deslocado/fora da tela.
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`modal-backdrop${saindo ? ' is-saindo' : ''}`}
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar()
      }}
    >
      <div
        ref={caixaRef}
        className={`modal-box glass-box ${largura}${saindo ? ' is-saindo' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Focus-trap: Tab circula só dentro do modal.
          if (e.key !== 'Tab') return
          const caixa = caixaRef.current
          if (!caixa) return
          const focos = Array.from(
            caixa.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
          if (!focos.length) {
            e.preventDefault()
            return
          }
          const primeiro = focos[0]
          const ultimo = focos[focos.length - 1]
          if (e.shiftKey && document.activeElement === primeiro) {
            e.preventDefault()
            ultimo.focus()
          } else if (!e.shiftKey && document.activeElement === ultimo) {
            e.preventDefault()
            primeiro.focus()
          }
        }}
      >
        <div className="glass-header flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-base font-bold">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p> : null}
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="modal-scroll scroll-elegante px-5 py-4">{children}</div>
        {rodape ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3">
            {rodape}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/* --------------------------------------------------------------- toasts --- */

const ICONE_TOAST: Record<string, string> = { ok: '✓', err: '✕', warn: '⚠', '': 'ℹ' }
const BORDA_TOAST: Record<string, string> = {
  ok: 'border-l-emerald-500',
  err: 'border-l-red-500',
  warn: 'border-l-amber-500',
  '': 'border-l-brand-500',
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto animate-slide-in rounded-xl border border-[var(--line)] border-l-4 ${BORDA_TOAST[t.tipo]} bg-[var(--surface-2)] px-4 py-3 text-left text-xs font-semibold shadow-pop`}
        >
          <span className="mr-2">{ICONE_TOAST[t.tipo]}</span>
          {t.texto}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------- cabeçalho de página --- */

export function CabecalhoPagina({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-black tracking-tight sm:text-2xl">{titulo}</h1>
      <p className="mt-1 text-sm text-slate-500">{subtitulo}</p>
    </div>
  )
}

/** Sugestões em dropdown (`.sugg`), com navegação por teclado. */
export function ListaSugestoes<T>({
  itens,
  chave,
  render,
  onEscolher,
  ativo,
  onSetAtivo,
}: {
  itens: T[]
  chave: (i: T) => string
  render: (i: T) => ReactNode
  onEscolher: (i: T) => void
  ativo: number
  onSetAtivo: (n: number) => void
}) {
  if (!itens.length) return null
  return (
    <div className="sugg">
      {itens.map((item, i) => (
        <button
          key={chave(item)}
          type="button"
          className={`sugg-item ${i === ativo ? 'is-active' : ''}`}
          onMouseEnter={() => onSetAtivo(i)}
          onClick={() => onEscolher(item)}
        >
          {render(item)}
        </button>
      ))}
    </div>
  )
}

/** Simulador rápido embutido nos cards (SPEC R7.14). */
export function useDebounce<A extends unknown[]>(fn: (...a: A) => void, ms = 220) {
  const timer = useRef<number | null>(null)
  const ultimo = useRef(fn)
  ultimo.current = fn
  return (...args: A) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => ultimo.current(...args), ms)
  }
}

/** Contador animado simples para cartões de estatística. */
export function useNumeroInicial(ativo: boolean): boolean {
  const [pronto, setPronto] = useState(false)
  useEffect(() => {
    if (ativo) setPronto(true)
  }, [ativo])
  return pronto
}
