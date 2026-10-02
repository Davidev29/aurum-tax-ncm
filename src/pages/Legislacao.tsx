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
import { FONTES_BASES, GRUPOS_LEGISLACAO, LEGISLACOES, type FonteBase, type ItemLegislacao } from '@/domain/legislacao'
import { Modal, Painel, Pill, Vazio } from '@/ui/kit'
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
  const [fonteAtiva, setFonteAtiva] = useState<FonteBase | null>(null)

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

      <section aria-label="Portais para atualização das bases de dados">
        <div className="mb-2 px-1">
          <h3 className="text-sm font-black">🌐 Portais para atualização</h3>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Fontes oficiais para buscar as bases de dados. Baixe o arquivo no portal e
            importe no card correspondente da aba <strong>Configurações → Bases</strong>.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FONTES_BASES.map((fonte) => (
            <article key={fonte.id} className="panel animate-fade-up card-hover flex flex-col p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Pill cor="emerald">🗂 {fonte.rotuloBase}</Pill>
              </div>
              <h3 className="text-sm font-black leading-snug">{fonte.titulo}</h3>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {fonte.descricao}
              </p>
              <p className="mt-2 rounded-xl bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
                📄 {fonte.arquivo}
              </p>
              <p className="mt-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-2.5 text-[11px] leading-relaxed text-brand-800 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-200">
                👣 {fonte.passo}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-press btn-primary btn-sm"
                  onClick={() => setFonteAtiva(fonte)}
                  title={`Ver como obter ${fonte.titulo}`}
                >
                  🧭 Como obter
                </button>
                <button
                  type="button"
                  className="btn btn-press btn-ghost btn-sm"
                  onClick={() => {
                    try {
                      void navigator.clipboard?.writeText(fonte.url)?.catch?.(() => undefined)
                    } catch {
                      /* clipboard indisponível — ignora */
                    }
                  }}
                  title="Copiar link oficial"
                >
                  🔗 Copiar link
                </button>
              </div>
              <div className="mt-2 truncate font-mono text-[10px] text-slate-400" title={fonte.url}>
                {fonte.url}
              </div>
            </article>
          ))}
        </div>
      </section>

      {grupos.length ? (
        grupos.map((grupo) => (
          <section key={grupo.id} aria-label={grupo.titulo}>
            <div className="mb-2 px-1">
              <h3 className="text-sm font-black">{grupo.titulo}</h3>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {grupo.descricao}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {grupo.itens.map((item) => (
                <CartaoLegislacao
                  key={item.id}
                  item={item}
                  onLer={(alvo) =>
                    setDestino({ url: alvo.url, titulo: alvo.titulo, integra: true })
                  }
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        <Vazio icone="⚖️" titulo="Nenhuma legislação encontrada para o filtro" />
      )}

      <ModalLegislacao destino={destino} onFechar={() => setDestino(null)} />
      <ModalFonteBase fonte={fonteAtiva} onFechar={() => setFonteAtiva(null)} />
    </div>
  )
}

function ModalFonteBase({ fonte, onFechar }: { fonte: FonteBase | null; onFechar: () => void }) {
  return (
    <Modal
      aberto={fonte !== null}
      onFechar={onFechar}
      titulo={fonte ? `Como obter — ${fonte.titulo}` : 'Como obter'}
      subtitulo={fonte?.rotuloBase}
      largura="max-w-xl"
      rodape={
        <>
          <button type="button" className="btn btn-press btn-ghost btn-sm" onClick={onFechar}>
            Fechar
          </button>
          {fonte ? (
            <a
              className="btn btn-press btn-primary btn-sm"
              href={fonte.url}
              target="_blank"
              rel="noreferrer"
              title={`Abrir ${fonte.titulo} no navegador`}
            >
              ✅ Entendi, abrir portal
            </a>
          ) : null}
        </>
      }
    >
      {fonte ? (
        <div className="space-y-3 text-xs leading-relaxed">
          <p className="text-slate-600 dark:text-slate-300">{fonte.descricao}</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-slate-600 dark:text-slate-300">
            <li>
              Clique em <strong>“Entendi, abrir portal”</strong> abaixo para abrir o portal
              oficial no navegador.
            </li>
            {fonte.exigeCert ? (
              <li>
                Se o navegador pedir, selecione seu <strong>certificado digital e-CNPJ
                (ICP-Brasil)</strong> e autorize — sem ele o portal retorna 401/403.
              </li>
            ) : null}
            <li>
              Baixe e <strong>salve</strong> o arquivo no seu computador (
              <span className="font-mono">{fonte.arquivo}</span>).
            </li>
            <li>
              Volte ao sistema em <strong>Configurações → Bases de dados</strong> e importe o
              arquivo no card correspondente ({fonte.rotuloBase}).
            </li>
            <li>
              Clique em <strong>Atualizar bases de dados</strong> para validar e importar.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-press btn-ghost btn-sm"
              onClick={() => {
                try {
                  void navigator.clipboard?.writeText(fonte.url)?.catch?.(() => undefined)
                } catch {
                  /* clipboard indisponível — ignora */
                }
              }}
              title="Copiar link oficial"
            >
              🔗 Copiar link
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-400" title={fonte.url}>
              {fonte.url}
            </span>
          </div>
        </div>
      ) : null}
    </Modal>
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
