/**
 * Loading Skeleton da Consulta unificada — sensação de processamento por seção.
 *
 * Cada seção (Exata / Por nome / Predição assistiva) tem seu próprio estado
 * de carga; enquanto o worker correspondente resolve, a seção exibe o
 * esqueleto em vez de "piscar" vazia. Usa a classe `.skeleton` dos tokens
 * (`src/index.css`) + `animate-pulse-soft`, com `aria-busy`/`role=status`
 * para leitores de tela.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton motion-safe:animate-pulse-soft ${className}`} />
}

/** Linha de sugestão (código + descrição). */
export function SkeletonLinhaSugestao({ comSelo = false }: { comSelo?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
      <Skeleton className="h-4 w-20 shrink-0" />
      <Skeleton className="h-4 min-w-0 flex-1" />
      {comSelo ? <Skeleton className="h-4 w-12 shrink-0 !rounded-full" /> : null}
    </div>
  )
}

/** Lista de sugestões carregando (prefixo NCM / busca por nome). */
export function SkeletonListaSugestoes({ linhas = 5, comSelo = false }: { linhas?: number; comSelo?: boolean }) {
  return (
    <div role="status" aria-label="Buscando sugestões…" aria-busy="true" className="space-y-1 py-1">
      {Array.from({ length: linhas }, (_, i) => (
        <SkeletonLinhaSugestao key={i} comSelo={comSelo} />
      ))}
      <span className="sr-only">Buscando sugestões…</span>
    </div>
  )
}

/** Cartão de classificação carregando (painel 0/1/N). */
export function SkeletonCartaoClassificacao() {
  return (
    <div role="status" aria-label="Classificando…" aria-busy="true" className="space-y-2 rounded-2xl border border-[var(--line)] p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-16 !rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-8 w-24 !rounded-[0.7rem]" />
        <Skeleton className="h-8 w-24 !rounded-[0.7rem]" />
      </div>
      <span className="sr-only">Classificando…</span>
    </div>
  )
}

/**
 * Etapas da predição assistiva — dá a sensação de pipeline agentico:
 * analisar → confrontar base → verificar exceções.
 */
const ETAPAS_PREDICAO = ['Analisando descrição…', 'Confrontando base oficial…', 'Verificando exceções…'] as const

export function SkeletonPredicao() {
  return (
    <div role="status" aria-label="Analisando descrição…" aria-busy="true" className="space-y-3">
      <ol className="space-y-1.5">
        {ETAPAS_PREDICAO.map((etapa, i) => (
          <li key={etapa} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
              style={{ animationDelay: `${i * 150}ms` }}
            />
            {etapa}
          </li>
        ))}
      </ol>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20 !rounded-full" />
          <Skeleton className="h-5 w-28 !rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <span className="sr-only">Analisando descrição e confrontando com a base oficial…</span>
    </div>
  )
}

/** Moldura de seção com título + esqueleto (reuso nas 3 seções). */
export function SecaoCarregando({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section aria-busy="true" className="space-y-2">
      <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        {titulo}
      </h3>
      {children}
    </section>
  )
}
