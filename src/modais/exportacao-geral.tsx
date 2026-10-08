/**
 * Modal **Exportar dados** — escolhe tabelas + colunas + filtro + formato.
 *
 * - Lista as tabelas do escopo com contagem ao vivo do filtro.
 * - Produtos: colunas discriminadas (CFOP entrada × CFOP saída, etc.) com
 *   escolha do usuário — só o marcado sai no arquivo.
 * - Filtro de texto restringe o que sai (o que se vê é o que sai).
 * - Formato: CSV (um arquivo por tabela) · XLSX (uma aba por tabela) ·
 *   PDF (conferência visual com timbrado).
 * - Pré-visualização: 5 primeiras linhas já nas colunas escolhidas.
 */
import { useEffect, useMemo, useState } from 'react'
import { EMITENTE_PADRAO } from '@/domain/entities'
import {
  CHAVES_PRODUTOS_PADRAO,
  COLUNAS_PRODUTOS,
  amostraParaPreview,
  coletarTabela,
  contarTabelas,
  exportarTabelasCSV,
  exportarTabelasPDF,
  exportarTabelasXLSX,
  tabelasDoEscopo,
  type FiltroExportacao,
  type FormatoExportacao,
} from '@/application/exportacao-geral'
import { useSessao } from '@/store/sessao'
import { toast } from '@/store/ui'
import { Btn, Campo, Check, Modal, Pill, Texto } from '@/ui/kit'

export function ModalExportacaoGeral({
  aberto,
  onFechar,
  escopo = 'geral',
}: {
  aberto: boolean
  onFechar: () => void
  /**
   * `produto` = contexto da tela Produtos: só tabelas de produto
   * (sem NBS, sem CNAE, sem empresas/notas). `geral` = todas as tabelas.
   */
  escopo?: 'produto' | 'geral'
}) {
  const tabelas = tabelasDoEscopo(escopo)
  const ativa = useSessao((s) => s.ativa)
  const emitente = useSessao((s) => s.emitente)
  const [filtro, setFiltro] = useState('')
  const [marcadas, setMarcadas] = useState<string[]>(['produtos'])
  const [formato, setFormato] = useState<FormatoExportacao>('xlsx')
  // Colunas de produtos escolhidas (CFOP entrada × CFOP saída discriminados).
  const [colunasProdutos, setColunasProdutos] = useState<string[]>(CHAVES_PRODUTOS_PADRAO)
  const [contagens, setContagens] = useState<Record<string, number>>({})
  const [previewCols, setPreviewCols] = useState<string[]>([])
  const [previewLinhas, setPreviewLinhas] = useState<Record<string, unknown>[]>([])
  const [exportando, setExportando] = useState(false)

  const filtroObj: FiltroExportacao = useMemo(
    () => ({ texto: filtro, empresaId: ativa?.id ?? null }),
    [filtro, ativa],
  )

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const c = await contarTabelas(filtroObj)
          if (vivo) setContagens(c)
        } catch {
          /* contagem é cosmética */
        }
      })()
    }, 250)
    return () => {
      vivo = false
      window.clearTimeout(t)
    }
  }, [aberto, filtroObj])

  useEffect(() => {
    if (!aberto || !marcadas.length) {
      setPreviewCols([])
      setPreviewLinhas([])
      return
    }
    let vivo = true
    void (async () => {
      try {
        const primeira = marcadasVisiveis[0]
        if (!primeira) {
          setPreviewCols([])
          setPreviewLinhas([])
          return
        }
        const linhas = await coletarTabela(primeira, filtroObj)
        if (!vivo) return
        const amostra = amostraParaPreview(
          primeira,
          linhas,
          primeira === 'produtos' ? colunasProdutos : undefined,
        )
        setPreviewCols(amostra.cols)
        setPreviewLinhas(
          amostra.rows.map((r) => Object.fromEntries(amostra.cols.map((c, i) => [c, r[i] ?? '']))),
        )
      } catch {
        if (vivo) {
          setPreviewCols([])
          setPreviewLinhas([])
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [aberto, marcadas, filtroObj, colunasProdutos])

  const alternar = (store: string) =>
    setMarcadas((m) => (m.includes(store) ? m.filter((s) => s !== store) : [...m, store]))

  // Escopo produto: NBS nunca é exportado daqui — mesmo que venha marcado.
  const marcadasVisiveis = marcadas.filter((s) => tabelas.some((t) => t.store === s))
  const totalLinhas = marcadasVisiveis.reduce((s, t) => s + (contagens[t] ?? 0), 0)
  const colunasPorTabela =
    marcadasVisiveis.includes('produtos') && colunasProdutos.length
      ? { produtos: colunasProdutos }
      : undefined

  const exportar = async () => {
    if (!marcadasVisiveis.length) {
      toast('Marque ao menos uma tabela.', 'warn')
      return
    }
    if (marcadasVisiveis.includes('produtos') && !colunasProdutos.length) {
      toast('Marque ao menos uma coluna de Produtos (ex.: CFOP saída).', 'warn')
      return
    }
    if (totalLinhas === 0) {
      toast('Nada para exportar com o filtro atual.', 'warn')
      return
    }
    setExportando(true)
    try {
      if (formato === 'csv') {
        await exportarTabelasCSV(marcadasVisiveis, filtroObj, colunasPorTabela)
        toast(`${marcadasVisiveis.length} arquivo(s) CSV gerado(s).`, 'ok')
      } else if (formato === 'xlsx') {
        await exportarTabelasXLSX(marcadasVisiveis, filtroObj, colunasPorTabela)
        toast('XLSX gerado (uma aba por tabela).', 'ok')
      } else {
        await exportarTabelasPDF(marcadasVisiveis, filtroObj, {
          empresa: ativa,
          emitente: emitente ?? EMITENTE_PADRAO,
        }, colunasPorTabela)
        toast('PDF de conferência gerado.', 'ok')
      }
      onFechar()
    } catch (e) {
      toast(`Erro ao exportar: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="📤 Exportar dados"
      subtitulo={`Empresa: ${ativa?.razaoSocial ?? 'Todas / sem empresa'} · marque tabelas, filtre e escolha o formato`}
      largura="max-w-3xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Cancelar</Btn>
          <Btn variante="primary" carregando={exportando} onClick={() => void exportar()}>
            {exportando ? 'Exportando…' : `Exportar ${formato.toUpperCase()} (${totalLinhas} linhas)`}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Campo label="Filtro (vale para todas as tabelas)" dica="O que se vê na contagem é o que sai no arquivo.">
            <Texto
              type="search"
              className="field-sm"
              placeholder="Ex.: SKU, NCM, CFOP 5102…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </Campo>
          <Campo label="Formato">
            <div className="flex gap-2">
              {(
                [
                  ['csv', 'CSV'],
                  ['xlsx', 'XLSX'],
                  ['pdf', 'PDF visual'],
                ] as Array<[FormatoExportacao, string]>
              ).map(([f, rot]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormato(f)}
                  aria-pressed={formato === f}
                  className={`flex-1 rounded-xl border-2 px-3 py-2 text-xs font-bold transition ${
                    formato === f
                      ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200'
                      : 'border-[var(--line)] text-slate-500'
                  }`}
                >
                  {rot}
                </button>
              ))}
            </div>
          </Campo>
        </div>

        <div className="flex flex-wrap gap-2">
          <Btn tam="sm" onClick={() => setMarcadas(tabelas.map((t) => t.store))}>
            Marcar todas
          </Btn>
          <Btn tam="sm" onClick={() => setMarcadas(['produtos'])}>
            Só produtos
          </Btn>
          <Btn tam="sm" onClick={() => setMarcadas([])}>
            Limpar
          </Btn>
          <span className="ml-auto text-[11px] text-slate-500">
            {marcadasVisiveis.length} tabela(s) · {totalLinhas} linha(s)
            {escopo === 'produto' ? ' · só produto' : ''}
          </span>
        </div>

        <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
          {tabelas.map((t) => {
            const n = contagens[t.store] ?? 0
            const on = marcadas.includes(t.store)
            return (
              <button
                key={t.store}
                type="button"
                onClick={() => alternar(t.store)}
                aria-pressed={on}
                className={`rounded-xl border-2 p-2.5 text-left transition ${
                  on
                    ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-900/20'
                    : 'border-[var(--line)] opacity-70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden>{t.icone}</span>
                  <span className="text-xs font-bold">{t.titulo}</span>
                  <span className="pill ml-auto bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {n}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{t.descricao}</div>
              </button>
            )
          })}
        </div>

        {marcadasVisiveis.includes('produtos') ? (
          <details className="rounded-xl border border-[var(--line)]">
            <summary className="cursor-pointer list-none p-3 transition hover:bg-slate-50 dark:hover:bg-slate-950/40">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase text-slate-500">
                  🧾 Colunas de Produtos — entrada × saída
                </span>
                <span className="pill ml-auto bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                  {colunasProdutos.length} de {COLUNAS_PRODUTOS.length}
                </span>
                <span aria-hidden className="text-xs text-slate-400">▾</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                CFOP entrada e CFOP saída são campos diferentes — abra e marque o que vai na exportação.
              </span>
            </summary>
            <div className="border-t border-[var(--line)] p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <Btn tam="sm" onClick={() => setColunasProdutos(CHAVES_PRODUTOS_PADRAO)}>
                Todas
              </Btn>
              <Btn
                tam="sm"
                onClick={() =>
                  setColunasProdutos(
                    COLUNAS_PRODUTOS.filter((c) => c.fluxo !== 'saida').map((c) => c.chave),
                  )
                }
              >
                Só entrada
              </Btn>
              <Btn
                tam="sm"
                onClick={() =>
                  setColunasProdutos(
                    COLUNAS_PRODUTOS.filter((c) => c.fluxo !== 'entrada').map((c) => c.chave),
                  )
                }
              >
                Só saída
              </Btn>
              <Btn tam="sm" onClick={() => setColunasProdutos([])}>
                Limpar
              </Btn>
            </div>
            <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto pr-1 md:grid-cols-3">
              {COLUNAS_PRODUTOS.map((c) => {
                const on = colunasProdutos.includes(c.chave)
                return (
                  <button
                    key={c.chave}
                    type="button"
                    onClick={() =>
                      setColunasProdutos((atual) =>
                        atual.includes(c.chave)
                          ? atual.filter((k) => k !== c.chave)
                          : [...atual, c.chave],
                      )
                    }
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                      on
                        ? 'border-brand-500 bg-brand-50/70 font-bold dark:bg-brand-900/20'
                        : 'border-[var(--line)] text-slate-500 opacity-70'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-black ${
                        on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="truncate">{c.rotulo}</span>
                  </button>
                )
              })}
            </div>
            </div>
          </details>
        ) : null}

        <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-3 dark:bg-slate-950/40">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-black uppercase text-slate-500">👁 Conferência visual</span>
            {previewLinhas.length ? <Pill cor="brand">{marcadasVisiveis[0]} · 5 primeiras</Pill> : null}
          </div>
          {!previewLinhas.length ? (
            <div className="text-[11px] text-slate-500">Marque uma tabela com dados para pré-visualizar.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    {previewCols.map((c) => (
                      <th key={c}>{c.slice(0, 20)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewLinhas.map((r, i) => (
                    <tr key={i}>
                      {previewCols.map((c) => (
                        <td key={c} className="max-w-[180px] truncate font-mono text-[10px]">
                          {(() => {
                            const v = (r as Record<string, unknown>)[c]
                            const s = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
                            return s.length > 60 ? `${s.slice(0, 60)}…` : s
                          })()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="hidden">
          <Check label="interno" checked readOnly />
        </div>
      </div>
    </Modal>
  )
}
