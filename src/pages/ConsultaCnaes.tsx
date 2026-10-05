/**
 * Tela **Consulta de CNAEs** (Phase 9 / 09-03).
 *
 * Busca nos 1.090 (código `XXXX-X/XX`/7 dígitos ou descrição), tabela estilo
 * SISCOMEX (`Código | Descrição | Anexo Simples | Situação | NBS | Benefício`)
 * paginada em `PAGE_SIZE` com filtro em debounce de 150 ms, e painel do CNAE:
 * bloco Regras (sempre) + bloco NBS/Reforma (condicional — destaque,
 * ranking, escolha quando ambíguo, selo do ano) ou faixa bens→NCM.
 *
 * Invariante A: as células Anexo/Situação nunca saem vazias (fallbacks do
 * domínio aplicados na store).
 */
import { useEffect, useMemo, useState } from 'react'
import { PAGE_SIZE } from '@/domain/constants'
import {
  ANOS_REFERENCIA_CNAE,
  filtrarCnaes,
  selecionarVeredito,
  useCnaes,
  type LinhaCnae,
} from '@/store/consulta-cnaes'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import { toast, useUi } from '@/store/ui'
import { Btn, Painel, Texto, Vazio, useDebounce } from '@/ui/kit'
import { Entrada, Secao } from '@/ui/motion'
import {
  BlocoRegrasCnae,
  CartaoCnaeNbs,
  LinhaNbsBeneficio,
  SeloAnoReferencia,
  SeletorNbsAmbigua,
} from '@/ui/cnaes'

/* ------------------------------------------------------- paginação (PAGE_SIZE) --- */

function PaginacaoCnaes({
  pagina,
  totalPaginas,
  inicio,
  fim,
  total,
  aoMudar,
}: {
  pagina: number
  totalPaginas: number
  inicio: number
  fim: number
  total: number
  aoMudar: (p: number) => void
}) {
  const numeros = useMemo(() => {
    const t = Math.max(1, totalPaginas)
    const p = Math.min(Math.max(1, pagina), t)
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
    const janela = new Set([1, 2, p - 1, p, p + 1, t - 1, t])
    return [...janela].filter((n) => n >= 1 && n <= t).sort((a, b) => a - b)
  }, [pagina, totalPaginas])
  const base =
    'grid h-7 min-w-7 place-items-center rounded-lg px-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40'
  const idle =
    'text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-800'
  const ativa = 'bg-brand-600 text-white shadow-pop'
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="num text-[11px] text-slate-500 dark:text-slate-400">
        Exibindo {inicio}–{fim} de {total}
      </span>
      <nav className="flex items-center gap-1" aria-label="Paginação">
        <button type="button" title="Primeira página" aria-label="Primeira página" className={`${base} ${idle}`} disabled={pagina <= 1} onClick={() => aoMudar(1)}>«</button>
        <button type="button" title="Página anterior" aria-label="Página anterior" className={`${base} ${idle}`} disabled={pagina <= 1} onClick={() => aoMudar(pagina - 1)}>‹</button>
        {numeros.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Página ${n}`}
            aria-current={n === pagina ? 'page' : undefined}
            className={`${base} ${n === pagina ? ativa : idle}`}
            onClick={() => aoMudar(n)}
          >
            {n}
          </button>
        ))}
        <button type="button" title="Próxima página" aria-label="Próxima página" className={`${base} ${idle}`} disabled={pagina >= totalPaginas} onClick={() => aoMudar(pagina + 1)}>›</button>
        <button type="button" title="Última página" aria-label="Última página" className={`${base} ${idle}`} disabled={pagina >= totalPaginas} onClick={() => aoMudar(totalPaginas)}>»</button>
      </nav>
    </div>
  )
}

/* ------------------------------------------------------- células (nunca vazias) --- */

/** Coluna NBS: contagem (`98 NBS`) ou badge `sem-NBS` (bens) / `s/mapeamento`. */
function CelulaNbs({ linha }: { linha: LinhaCnae }) {
  if (linha.ehBens) {
    return (
      <span
        className="pill bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        title="Sem NBS aplicável — atividade de bens (ver NCM)"
      >
        sem-NBS
      </span>
    )
  }
  if (linha.totalNbs > 0) {
    return (
      <span className="num whitespace-nowrap font-mono font-bold">
        {linha.totalNbs.toLocaleString('pt-BR')} NBS
      </span>
    )
  }
  return (
    <span
      className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
      title="Serviço sem mapeamento NBS na base atual (fallback Phase 7)"
    >
      s/mapeamento
    </span>
  )
}

/* ------------------------------------------------------- tela --- */

export function ConsultaCnaes() {
  const lista = useCnaes((s) => s.lista)
  const carregandoLista = useCnaes((s) => s.carregandoLista)
  const carregarLista = useCnaes((s) => s.carregarLista)
  const busca = useCnaes((s) => s.busca)
  const setBusca = useCnaes((s) => s.setBusca)
  const sugestoes = useCnaes((s) => s.sugestoes)
  const sugerirCnae = useCnaes((s) => s.sugerirCnae)
  const consulta = useCnaes((s) => s.consulta)
  const consultando = useCnaes((s) => s.consultando)
  const erroConsulta = useCnaes((s) => s.erroConsulta)
  const consultarCnae = useCnaes((s) => s.consultarCnae)
  const anoReferencia = useCnaes((s) => s.anoReferencia)
  const setAnoReferencia = useCnaes((s) => s.setAnoReferencia)
  const nbsEscolhida = useCnaes((s) => s.nbsEscolhida)
  const setNbsEscolhida = useCnaes((s) => s.setNbsEscolhida)
  const trocarView = useUi((s) => s.trocarView)

  const [texto, setTexto] = useState(busca)
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    void carregarLista()
  }, [carregarLista])

  // Menu nativo (Ctrl+E): exporta o resumo da consulta ativa em JSON.
  useEffect(
    () =>
      registrarExportador('cnaes', () => {
        const c = useCnaes.getState().consulta
        if (!c) {
          toast('Consulte um CNAE antes de exportar.', 'warn')
          return
        }
        try {
          const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `consulta-cnae-${c.regra.cnae7}-ref${c.anoReferencia}.json`
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
          toast('Consulta de CNAE exportada.', 'ok')
        } catch {
          toast('Falha ao exportar a consulta.', 'err')
        }
      }),
    [],
  )

  // Filtro com debounce de 150 ms (volta para a página 1).
  const aplicarBusca = useDebounce((t: string) => {
    setBusca(t)
    setPagina(1)
    void sugerirCnae(t)
  }, 150)

  const filtrados = useMemo(() => filtrarCnaes(lista, busca), [lista, busca])
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  const visiveis = filtrados.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE)
  const inicio = filtrados.length === 0 ? 0 : (paginaSegura - 1) * PAGE_SIZE + 1
  const fim = Math.min(paginaSegura * PAGE_SIZE, filtrados.length)

  const cnaeAtivo = consulta?.regra.cnae7 ?? null
  const ativo = selecionarVeredito(consulta, nbsEscolhida)
  const porNbs = useMemo(
    () => new Map((consulta?.vereditos ?? []).map((v) => [v.nbs, v] as const)),
    [consulta],
  )
  const plausibilidadeAtiva = ativo
    ? (consulta?.ranking.find((r) => r.nbs === ativo.nbs)?.score ?? undefined)
    : undefined

  const beneficioLinha = (l: LinhaCnae): string => {
    if (cnaeAtivo === l.cnae7 && consulta && consulta.estadoNbs === 'mapeado') {
      const com = consulta.vereditos.filter((v) => v.temBeneficio).length
      return com > 0 ? `${com} com benefício` : 'tributação integral'
    }
    return '—'
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Entrada>
        <Painel>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <span className="text-lg">🏭</span> Consulta de CNAEs
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {lista.length.toLocaleString('pt-BR')} CNAEs · regra do Simples sempre · NBS e
                benefício quando houver mapeamento
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="field-wrap">
                <span className="field-icon">🔍</span>
                <Texto
                  type="search"
                  className="field-sm w-64"
                  placeholder="Código (XXXX-X/XX) ou descrição…"
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value)
                    aplicarBusca(e.target.value)
                  }}
                />
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="Ano de referência">
                {ANOS_REFERENCIA_CNAE.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={anoReferencia === a}
                    title={a === 2033 ? 'Regime pleno (REF_DEFAULT)' : a === 2027 ? 'CBS plena + IBS em teste' : 'Ano-teste LC 214 (0,1% + 0,1%)'}
                    className={`rounded-lg px-2 py-1 font-mono text-xs font-black transition ${
                      anoReferencia === a
                        ? 'bg-brand-600 text-white shadow-pop'
                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                    onClick={() => void setAnoReferencia(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="p-5">
            {texto.trim() && sugestoes.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Sugestões de CNAE">
                {sugestoes.slice(0, 6).map((s) => (
                  <button
                    key={s.cnae7}
                    type="button"
                    className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-700 transition hover:bg-brand-100 dark:border-aurum-900 dark:bg-brand-950/30 dark:text-brand-200"
                    title={s.descricao}
                    onClick={() => void consultarCnae(s.cnae7)}
                  >
                    {s.codigoFormatado}
                  </button>
                ))}
              </div>
            ) : null}
            {carregandoLista ? (
              <div className="animate-pulse space-y-2" aria-label="Carregando CNAEs">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : !visiveis.length ? (
              <Vazio
                icone="🔍"
                titulo={busca ? `Nenhum CNAE para "${busca}"` : 'Base de CNAEs vazia'}
                texto={busca ? 'Ajuste a busca.' : 'Importe a base em Configurações → Bases.'}
              />
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="tbl w-full">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descrição</th>
                        <th>Anexo Simples</th>
                        <th>Situação</th>
                        <th>NBS</th>
                        <th>Benefício</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((l) => (
                        <tr
                          key={l.cnae7}
                          className={`cursor-pointer transition hover:bg-brand-50/50 dark:hover:bg-brand-950/20 ${
                            cnaeAtivo === l.cnae7 ? 'bg-brand-50 dark:bg-brand-950/30' : ''
                          }`}
                          onClick={() => void consultarCnae(l.cnae7)}
                          title={`Consultar ${l.codigoFormatado}`}
                        >
                          <td className="whitespace-nowrap font-mono font-bold">{l.codigoFormatado || l.cnae7}</td>
                          <td className="max-w-md truncate" title={l.descricao}>{l.descricao || '—'}</td>
                          <td className="whitespace-nowrap text-[11px] font-bold text-cyan-800 dark:text-cyan-200">
                            {l.rotuloAnexo || 'Anexo Simples —'}
                          </td>
                          <td className="whitespace-nowrap text-[11px]">{l.situacao || 'Depende da atividade'}</td>
                          <td><CelulaNbs linha={l} /></td>
                          <td className="whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400">{beneficioLinha(l)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginacaoCnaes
                  pagina={paginaSegura}
                  totalPaginas={totalPaginas}
                  inicio={inicio}
                  fim={fim}
                  total={filtrados.length}
                  aoMudar={setPagina}
                />
              </>
            )}
          </div>
        </Painel>
      </Entrada>

      <Secao>
        <Painel>
          <div className="border-b border-slate-100 p-5 dark:border-slate-800">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <span className="text-lg">📋</span> Painel do CNAE
            </h2>
            {consulta ? (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{consulta.resumo}</p>
            ) : null}
          </div>
          <div className="space-y-4 p-5">
            {consultando ? (
              <div className="animate-pulse space-y-2" aria-label="Consultando CNAE">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : erroConsulta ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                <div className="font-bold">Falha ao consultar o CNAE</div>
                <p className="mt-1">{erroConsulta}</p>
              </div>
            ) : !consulta ? (
              <Vazio
                icone="🏭"
                titulo="Nenhum CNAE selecionado"
                texto="Busque acima e clique em uma linha para ver a regra do Simples e o enriquecimento NBS/Reforma."
              />
            ) : (
              <>
                <BlocoRegrasCnae consulta={consulta} />
                {consulta.estadoNbs === 'bens→NCM' ? (
                  <div
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                    role="status"
                  >
                    <span className="text-lg">📦</span>
                    <p className="min-w-[200px] flex-1">
                      <strong>Sem NBS aplicável — atividade de bens (ver NCM).</strong> NBS
                      cobre só serviços; classifique o produto na Consulta NCM.{' '}
                      <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
                    </p>
                    <Btn variante="primary" tam="sm" onClick={() => trocarView('consulta')}>
                      Ir à Consulta NCM
                    </Btn>
                  </div>
                ) : null}
                {consulta.estadoNbs === 'sem-mapeamento-NBS' ? (
                  <div
                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    role="status"
                  >
                    <strong>Sem mapeamento NBS</strong> para este CNAE na base atual — a regra
                    do Simples acima vale integralmente; o enriquecimento Reforma segue o
                    fallback Phase 7.{' '}
                    <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
                  </div>
                ) : null}
                {consulta.estadoNbs === 'mapeado' && ativo ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        NBS {nbsEscolhida ? 'escolhida' : 'mais provável'} · {consulta.vereditos.length.toLocaleString('pt-BR')} vinculada(s)
                      </span>
                      <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
                    </div>
                    <CartaoCnaeNbs veredito={ativo} destaque plausibilidade={plausibilidadeAtiva} />
                    {consulta.ambiguo ? (
                      <SeletorNbsAmbigua
                        ranking={consulta.ranking}
                        porNbs={porNbs}
                        ativa={nbsEscolhida ?? consulta.maisProvavel}
                        onEscolher={(nbs) => setNbsEscolhida(nbs)}
                      />
                    ) : null}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                      <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        Ranking por plausibilidade ({consulta.ranking.length.toLocaleString('pt-BR')})
                      </div>
                      <ul className="scroll-elegante max-h-64 space-y-0.5 overflow-y-auto p-2">
                        {consulta.ranking.map((item) => {
                          const v = porNbs.get(item.nbs)
                          if (!v) return null
                          const ehAtivo = ativo.nbs === item.nbs
                          return (
                            <LinhaNbsBeneficio
                              key={item.nbs}
                              veredito={v}
                              item={item}
                              ativa={ehAtivo}
                              onEscolher={() => setNbsEscolhida(item.nbs)}
                            />
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Painel>
      </Secao>
    </div>
  )
}
