/**
 * Tela **Legislação** — normas da Reforma e do ICMS-CE em grupos.
 *
 * Clicar em "Ler no sistema" abre a norma **dentro da aplicação**
 * (`ModalLegislacao`): texto interno quando o site oficial permite, senão a
 * página original embutida — com Baixar PDF, Imprimir e Recarregar, sem sair
 * do app. O detalhamento por trecho (artigo/parágrafo) acontece na
 * **Consulta**, via modal "Visualizar legislação" que ancora no `#artNNN`.
 *
 * Os decretos do RICMS-CE vivem no portal SEFAZLEGIS (SPA sem link profundo
 * por norma): o card aponta para o portal e indica o termo exato de busca.
 */
import { useMemo, useState } from 'react'
import { GRUPOS_LEGISLACAO, LEGISLACOES, type ItemLegislacao } from '@/domain/legislacao'
import { Painel, Pill, Vazio } from '@/ui/kit'
import { Entrada, Lista, Item, Secao } from '@/ui/motion'
import { ModalLegislacao, type DestinoLegislacao } from '@/ui/ModalLegislacao'

const COR_TIPO: Record<ItemLegislacao['tipo'], 'brand' | 'emerald' | 'amber' | 'slate'> = {
  emenda: 'brand',
  lei: 'brand',
  decreto: 'emerald',
  resolucao: 'amber',
  portal: 'slate',
}

const ICONE_TIPO: Record<ItemLegislacao['tipo'], string> = {
  emenda: '🏛️',
  lei: '⚖️',
  decreto: '📜',
  resolucao: '📑',
  portal: '🌐',
}

export function Legislacao() {
  const [filtro, setFiltro] = useState('')
  const [destino, setDestino] = useState<DestinoLegislacao | null>(null)

  const grupos = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    const casa = (item: ItemLegislacao) =>
      !termo ||
      [item.sigla, item.titulo, item.descricao, item.buscaPortal ?? '']
        .join(' ')
        .toLowerCase()
        .includes(termo)
    return GRUPOS_LEGISLACAO.map((grupo) => ({
      ...grupo,
      itens: LEGISLACOES.filter((item) => item.grupo === grupo.id && casa(item)),
    })).filter((grupo) => grupo.itens.length > 0)
  }, [filtro])

  const total = grupos.reduce((acc, g) => acc + g.itens.length, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Entrada>
      <Painel className="p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">⚖️</span> Legislação da Reforma Tributária
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Todos os produtos do sistema referenciam algum <strong>artigo, parágrafo ou
          anexo</strong> da lei. Clique em <strong>“Ler no sistema”</strong> para ler a
          norma <strong>sem sair do app</strong> — com Baixar PDF, Imprimir e Recarregar.
          Na <strong>Consulta NCM</strong>, o botão <strong>“Visualizar legislação”</strong>{' '}
          abre um modal que leva direto ao trecho citado (artigo ancorado).
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <strong>Decretos federais:</strong> índice oficial do Planalto + regulamento da
          CBS. <strong>ICMS do Ceará:</strong> Nova Lei + decretos do RICMS via portal
          SEFAZLEGIS (use o termo de busca indicado no card).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por sigla, título ou número do decreto…"
            aria-label="Filtrar legislações"
            className="field field-sm min-w-[220px] flex-1"
          />
          <span className="font-mono text-[11px] text-slate-400" aria-live="polite">
            {total} {total === 1 ? 'norma' : 'normas'}
          </span>
        </div>
      </Painel>
      </Entrada>

      {grupos.length ? (
        grupos.map((grupo) => (
          <Secao key={grupo.id} rotulo={grupo.titulo}>
            <div className="mb-2 px-1">
              <h3 className="text-sm font-black">{grupo.titulo}</h3>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {grupo.descricao}
              </p>
            </div>
            <Lista className="grid grid-cols-1 gap-4 md:grid-cols-2" intervalo={0.05}>
              {grupo.itens.map((item) => (
                <Item key={item.id}>
                <CartaoLegislacao
                  item={item}
                  onLer={(alvo) =>
                    setDestino({ url: alvo.url, titulo: alvo.titulo, integra: true })
                  }
                />
                </Item>
              ))}
            </Lista>
          </Secao>
        ))
      ) : (
        <Vazio icone="⚖️" titulo="Nenhuma legislação encontrada para o filtro" />
      )}

      <ModalLegislacao destino={destino} onFechar={() => setDestino(null)} />
    </div>
  )
}

function CartaoLegislacao({
  item,
  onLer,
}: {
  item: ItemLegislacao
  onLer: (item: ItemLegislacao) => void
}) {
  return (
    <article className="panel card-hover flex flex-col p-5">
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
      {item.buscaPortal ? (
        <p className="mt-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-2.5 font-mono text-[11px] leading-relaxed text-brand-800 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-200">
          🔎 No portal SEFAZLEGIS, buscar por: <strong>{item.buscaPortal}</strong>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-press btn-primary btn-sm"
          onClick={() => onLer(item)}
          title={`Ler ${item.titulo} dentro do sistema`}
        >
          📖 Ler no sistema
        </button>
        <button
          type="button"
          className="btn btn-press btn-ghost btn-sm"
          onClick={() => {
            try {
              void navigator.clipboard?.writeText(item.url)?.catch?.(() => undefined)
            } catch {
              /* clipboard indisponível — ignora */
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
