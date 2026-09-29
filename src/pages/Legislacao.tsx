/**
 * Tela **Legislação** — cards das normas da Reforma.
 *
 * Clicar em um card abre a norma **na íntegra em nova aba** (`target=_blank`),
 * para leitura completa. O detalhamento por trecho (artigo/parágrafo) acontece
 * na **Consulta**, via modal "Visualizar legislação" que ancora no `#artNNN`.
 */
import { LEGISLACOES, type ItemLegislacao } from '@/domain/legislacao'
import { Painel, Pill, Vazio } from '@/ui/kit'

const COR_TIPO: Record<ItemLegislacao['tipo'], 'brand' | 'emerald' | 'amber' | 'slate'> = {
  lei: 'brand',
  decreto: 'emerald',
  resolucao: 'amber',
  portal: 'slate',
}

const ICONE_TIPO: Record<ItemLegislacao['tipo'], string> = {
  lei: '⚖️',
  decreto: '📜',
  resolucao: '📑',
  portal: '🌐',
}

export function Legislacao() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Painel className="p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">⚖️</span> Legislação da Reforma Tributária
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Todos os produtos do sistema referenciam algum <strong>artigo, parágrafo ou
          anexo</strong> da lei. Clique em um card para ler a norma <strong>na íntegra em
          nova aba</strong>. Na <strong>Consulta NCM</strong>, o botão{' '}
          <strong>“Visualizar legislação”</strong> abre um modal que leva direto ao trecho
          citado (artigo ancorado).
        </p>
      </Painel>

      {LEGISLACOES.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {LEGISLACOES.map((item) => (
            <CartaoLegislacao key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <Vazio icone="⚖️" titulo="Nenhuma legislação cadastrada" />
      )}
    </div>
  )
}

function CartaoLegislacao({ item }: { item: ItemLegislacao }) {
  return (
    <article className="panel animate-fade-up card-hover flex flex-col p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill cor={COR_TIPO[item.tipo]}>
          {ICONE_TIPO[item.tipo]} {item.rotuloTipo}
        </Pill>
        <span className="font-mono text-[11px] font-bold text-slate-400">{item.sigla}</span>
      </div>

      <h3 className="text-sm font-black leading-snug">{item.titulo}</h3>
      <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {item.descricao}
      </p>
      <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
        <strong>Utilidade:</strong> {item.utilidade}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="btn btn-press btn-primary btn-sm"
          title={`Ler ${item.titulo} na íntegra em nova aba`}
        >
          📖 Ler na íntegra ↗
        </a>
        <button
          type="button"
          className="btn btn-press btn-ghost btn-sm"
          onClick={() => {
            try {
              void navigator.clipboard?.writeText(item.url)?.catch?.(() => undefined)
            } catch {
              /* clipboard indisponível (http/Electron antigo) — ignora */
            }
          }}
          title="Copiar link oficial"
        >
          🔗 Copiar link
        </button>
      </div>
      <div className="mt-2 truncate font-mono text-[10px] text-slate-400" title={item.url}>
        {item.url}
      </div>
    </article>
  )
}
