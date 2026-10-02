/**
 * Aurum AI — selos, barra de confiança e painel de fontes.
 *
 * Micro-interações com visibilidade acessível:
 * - brilho ouro + pulso suave (respeita `prefers-reduced-motion`);
 * - `role="status"` + `aria-live="polite"` nas decisões;
 * - foco visível ouro (WCAG AA) em todos os botões/links;
 * - `title` explicando cada selo (sem jargão).
 */
import type { CSSProperties, ReactNode } from 'react'
import { useId } from 'react'
import { fmtConfiancaAurumAI, NOME_IA, nivelDeConfianca, type NivelConfiancaIa } from '@/domain/aurum-ai'

/**
 * Ícone premium da Aurum AI — brilho facetado em espectro, não emoji fixo.
 *
 * SVG inline com gradiente animado (ouro → violeta → ciano → ouro) + halo.
 * `title` acessível embutido; `aria-hidden` quando decorativo.
 */
export function IconeAurumPremium({
  tamanho = 'md',
  className = '',
  decorativo = true,
}: {
  tamanho?: 'sm' | 'md' | 'lg'
  className?: string
  decorativo?: boolean
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const gradId = `aurum-espectro-${uid}`
  const dim = tamanho === 'sm' ? '0.85rem' : tamanho === 'lg' ? '1.35rem' : '1.05rem'
  return (
    <span
      className={`aurum-ai-icone-premium aurum-ai-icone-premium--${tamanho} ${className}`}
      aria-hidden={decorativo ? 'true' : undefined}
      role={decorativo ? undefined : 'img'}
      aria-label={decorativo ? undefined : NOME_IA}
    >
      <svg viewBox="0 0 24 24" width={dim} height={dim} fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="200%" y2="100%">
            <stop offset="0%" stopColor="#be9433" />
            <stop offset="25%" stopColor="#e879f9" />
            <stop offset="50%" stopColor="#818cf8" />
            <stop offset="75%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#ead79e" />
          </linearGradient>
          <radialGradient id={`${gradId}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ead79e" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ead79e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="12" cy="12" r="10.5" fill={`url(#${gradId}-halo)`} opacity="0.55" />
        <path
          d="M12 2.2c.7 4.6 1.9 6.9 9.8 9.8-7.9 2.9-9.1 5.2-9.8 9.8-.7-4.6-1.9-6.9-9.8-9.8 7.9-2.9 9.1-5.2 9.8-9.8Z"
          fill={`url(#${gradId})`}
          stroke="#fff7e0"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path
          d="M18.6 2.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z"
          fill="#fffbe8"
          opacity="0.95"
        />
        <circle cx="7.4" cy="17.6" r="1.15" fill="#fffbe8" opacity="0.9" />
      </svg>
    </span>
  )
}

/** Linha cintilante em espectro — destaque da referência preferida da IA. */
export function LinhaPreferidaAurumAI({ rotulo = 'Referência preferida da IA' }: { rotulo?: string }) {
  return (
    <span className="aurum-ai-linha-preferida" role="presentation" aria-hidden="true" title={rotulo}>
      <span className="aurum-ai-linha-preferida-brilho" />
    </span>
  )
}

export function SeloAurumAI({
  variante = 'cheio',
  titulo = 'Decisão assistida pela Aurum AI — validada pela base oficial',
}: {
  variante?: 'cheio' | 'compacto' | 'fantasma'
  titulo?: string
}) {
  if (variante === 'compacto') {
    return (
      <span className="aurum-ai-selo aurum-ai-selo--compacto aurum-ai-selo--espectro" title={titulo} aria-label={NOME_IA}>
        <IconeAurumPremium tamanho="sm" /> {NOME_IA}
      </span>
    )
  }
  if (variante === 'fantasma') {
    return (
      <span className="aurum-ai-selo aurum-ai-selo--fantasma aurum-ai-selo--espectro" title={titulo} aria-label={NOME_IA}>
        <IconeAurumPremium tamanho="sm" /> {NOME_IA}
      </span>
    )
  }
  return (
    <span className="aurum-ai-selo aurum-ai-selo--espectro" title={titulo} aria-label={NOME_IA}>
      <IconeAurumPremium tamanho="md" />
      <span>
        {NOME_IA}
        <span className="aurum-ai-selo-sub">inteligência fiscal offline</span>
      </span>
    </span>
  )
}

/** "Sugerido por Aurum AI" — atribuição obrigatória de toda hipótese/sugestão. */
export function AtribuicaoAurumAI({ detalhe }: { detalhe?: string }) {
  return (
    <span
      className="aurum-ai-atribuicao aurum-ai-atribuicao--espectro"
      title={`Esta sugestão foi gerada pela ${NOME_IA} a partir do conjunto absoluto de dados (nomenclatura + vínculos + capítulos + vigência) e validada pelo resolvedor oficial.`}
    >
      <IconeAurumPremium tamanho="sm" /> Sugerido por {NOME_IA}
      {detalhe ? <span className="aurum-ai-atribuicao-detalhe"> · {detalhe}</span> : null}
    </span>
  )
}

/** Barra de confiança 0–1 com rótulo pt-BR e nível por cor. */
export function BarraConfiancaAurumAI({ valor, compact = false }: { valor: number; compact?: boolean }) {
  const nivel: NivelConfiancaIa = nivelDeConfianca(valor)
  const pct = Math.max(0, Math.min(100, Number(valor) * 100))
  return (
    <span
      className={`aurum-ai-confianca aurum-ai-confianca--${nivel}${compact ? ' aurum-ai-confianca--compacta' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${NOME_IA} · confiança ${nivel} ${fmtConfiancaAurumAI(valor)}`}
      title={`Confiança da ${NOME_IA}: ${fmtConfiancaAurumAI(valor)} (${nivel}). Alta ≥75% · Média ≥40% · abaixo disso, a IA declara NÃO SEI em vez de chutar.`}
    >
      <span className="aurum-ai-confianca-trilho" aria-hidden="true">
        <span className="aurum-ai-confianca-preenchimento" style={{ width: `${pct}%` }} />
      </span>
      <span className="aurum-ai-confianca-rotulo">
        {compact ? fmtConfiancaAurumAI(valor) : `confiança ${nivel} · ${fmtConfiancaAurumAI(valor)}`}
      </span>
    </span>
  )
}

/** Fontes lidas (conjunto absoluto) — prova de que a IA leu as bases. */
export function FontesAurumAI({ fontes }: { fontes: string[] }) {
  if (!fontes.length) return null
  return (
    <div className="aurum-ai-fontes" aria-label={`Bases lidas pela ${NOME_IA}`}>
      <span className="aurum-ai-fontes-titulo">Bases lidas pela {NOME_IA}:</span>
      <ul>
        {fontes.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
    </div>
  )
}

/** Linha de status do worker com micro-interação (pulsante ao processar). */
export function StatusAurumAI({ estado, children }: { estado: 'processando' | 'pronto' | 'indisponivel'; children: ReactNode }) {
  return (
    <span className={`aurum-ai-status aurum-ai-status--${estado}`} role="status" aria-live="polite">
      <span className="aurum-ai-status-ponto" aria-hidden="true" />
      {children}
    </span>
  )
}

/**
 * Moldura com **borda animada** (mesmo padrão `borda-cintilante` do sistema, em
 * ouro Aurum): identifica de relance o bloco que **foi a IA que classificou**.
 * O cabeçalho carrega selo + atribuição obrigatória; o corpo é livre.
 */
export function MolduraAurumAI({
  children,
  detalhe = 'classificou este NCM',
  className = '',
}: {
  children: ReactNode
  detalhe?: string
  className?: string
}) {
  return (
    <div
      className={`aurum-ai-destaque animate-fade-up rounded-2xl ${className}`}
      style={{ '--cor-borda': '#be9433', '--cor-brilho': '#ead79e' } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-label={`${NOME_IA} · ${detalhe}`}
    >
      <div className="aurum-ai-destaque-cab">
        <SeloAurumAI variante="compacto" />
        <AtribuicaoAurumAI detalhe={detalhe} />
      </div>
      <div className="p-3 pt-2 sm:p-4 sm:pt-2">{children}</div>
    </div>
  )
}

/** Etapas exibidas enquanto a IA raciocina (sensação de pipeline, sem prometer ordem real). */
const ETAPAS_PENSANDO = [
  'Lendo o que você digitou…',
  'Confrontando a base oficial…',
  'Verificando exceções e vigência…',
] as const

/**
 * Loading animado **enquanto a IA está pensando**: estrela pulsante + pontos em
 * cascata + barra ouro varrendo + etapas. Ecoa a entrada para o usuário saber
 * o que está sendo analisado. Respeita `prefers-reduced-motion` via CSS.
 */
export function CarregandoAurumAI({ entrada }: { entrada?: string }) {
  const eco = (entrada ?? '').trim()
  return (
    <div className="aurum-ai-pensando animate-fade-up" role="status" aria-live="polite" aria-busy="true" aria-label={`${NOME_IA} pensando…`}>
      <div className="aurum-ai-pensando-cab">
        <span className="aurum-ai-pensando-estrela aurum-ai-pensando-estrela--espectro" aria-hidden="true">
          <IconeAurumPremium tamanho="md" />
        </span>
        <span>
          {NOME_IA} pensando
          <span className="aurum-ai-pensando-pontos" aria-hidden="true">
            <span className="aurum-ai-pensando-ponto" />
            <span className="aurum-ai-pensando-ponto" />
            <span className="aurum-ai-pensando-ponto" />
          </span>
        </span>
        {eco ? (
          <span className="ml-auto max-w-[55%] truncate font-mono text-[11px] font-semibold normal-case opacity-70" title={eco}>
            “{eco.length > 60 ? `${eco.slice(0, 60)}…` : eco}”
          </span>
        ) : null}
      </div>
      <div className="aurum-ai-pensando-barra aurum-ai-pensando-barra--espectro" aria-hidden="true"><span /></div>
      <div className="aurum-ai-pensando-etapas">
        {ETAPAS_PENSANDO.map((etapa, i) => (
          <div key={etapa} className="aurum-ai-pensando-etapa">
            <span
              className="aurum-ai-pensando-orb"
              style={{ animationDelay: `${i * 150}ms` }}
              aria-hidden="true"
            />
            {etapa}
          </div>
        ))}
      </div>
      <span className="sr-only">{NOME_IA} analisando sua descrição e confrontando com a base oficial…</span>
    </div>
  )
}
