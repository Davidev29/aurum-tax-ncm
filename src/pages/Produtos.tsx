/**
 * Tela **Produtos** (SPEC §8).
 *
 * Lista paginada do catálogo da empresa ativa (ou de todas, quando não há
 * empresa selecionada), com filtro em 180 ms, ações por linha e exportação
 * CSV/JSON/PDF.
 *
 * Paridade com a v1:
 * - coluna **Empresa** só aparece quando não há empresa ativa (D12);
 * - ações: ver na Consulta, abrir o modal de cálculo, editar no formulário
 *   de Classificação e excluir com confirmação;
 * - a paginação avança `PAGE_SIZE` por clique em "Carregar mais".
 */
import { useEffect, useState, type ReactNode } from 'react'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { fmtMoeda, fmtNcm } from '@/domain/services/format'
import {
  exportarProdutosCSV,
  exportarProdutosJSON,
  exportarProdutosPDF,
} from '@/infrastructure/exporters/relatorios'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import { useClassificar } from '@/store/classificar'
import { useConsulta } from '@/store/consulta'
import { produtosVisiveis, useProdutos, type ProdutoLinha } from '@/store/produtos'
import { useSessao } from '@/store/sessao'
import { confirmar } from '@/store/dialogo'
import { toast, useUi } from '@/store/ui'
import { Vazio, Btn, Painel, Texto, useDebounce } from '@/ui/kit'
import { ModalProdutoDetalhe, Olho } from '@/ui/detalhes'

export function Produtos() {
  const cache = useProdutos((s) => s.cache)
  const filtro = useProdutos((s) => s.filtro)
  const pagina = useProdutos((s) => s.pagina)
  const setFiltro = useProdutos((s) => s.setFiltro)
  const ampliarPagina = useProdutos((s) => s.ampliarPagina)
  const ativa = useSessao((s) => s.ativa)
  const emitente = useSessao((s) => s.emitente)
  const [textoFiltro, setTextoFiltro] = useState(filtro)
  // 👁 Detalhe compacto de tributos (tabela minimalista — resto vai ao modal).
  const [detalhe, setDetalhe] = useState<ProdutoLinha | null>(null)

  // Filtro com debounce de 180 ms (paridade com a v1).
  const aplicarFiltro = useDebounce((t: string) => setFiltro(t), 180)

  const visiveis = produtosVisiveis({ cache, filtro, pagina })
  // Mesmo texto pesquisado em `produtosVisiveis` — o total precisa bater com
  // a lista visível (inclui CFOP, CST ICMS, PIS e COFINS).
  const total = filtro
    ? cache.filter((x) =>
        `${x.codigo} ${x.nome} ${x.ncm} ${x.cstReforma} ${x.cClassTrib} ${x.cfop ?? ''} ${x.cstIcms ?? ''} ${x.pis ?? ''} ${x.cofins ?? ''}`
          .toLowerCase()
          .includes(filtro.trim().toLowerCase()),
      ).length
    : cache.length
  const restantes = total - visiveis.length
  const semEmpresa = !ativa

  const vazio = (msg: string, texto: ReactNode) => <Vazio icone="📦" titulo={msg} texto={texto} />

  const exportarCsv = () => {
    if (!cache.length) return toast('Nenhum produto para exportar.', 'warn')
    exportarProdutosCSV(cache, ativa)
    toast('CSV gerado.', 'ok')
  }
  const exportarJson = () => {
    if (!cache.length) return toast('Nenhum produto para exportar.', 'warn')
    exportarProdutosJSON(cache, ativa)
    toast('JSON gerado.', 'ok')
  }
  const exportarPdf = async () => {
    if (!cache.length) return toast('Nenhum produto para exportar.', 'warn')
    try {
      await exportarProdutosPDF({
        produtos: cache,
        empresa: ativa,
        emitente: emitente ?? EMITENTE_PADRAO,
      })
      toast('PDF gerado.', 'ok')
    } catch (e) {
      toast(`Erro ao gerar PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  // Menu nativo (Ctrl+E): registra o exportador de PDF desta view.
  useEffect(() => registrarExportador('produtos', () => void exportarPdf()), [exportarPdf])

  return (
    <div className="mx-auto max-w-6xl">
      <Painel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <span className="text-lg">📦</span> Produtos cadastrados
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Empresa ativa: <strong>{ativa?.razaoSocial ?? 'Todas / sem empresa'}</strong> ·{' '}
              <span>{cache.length}</span> produtos
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="field-wrap">
              <span className="field-icon">🔍</span>
              <Texto
                type="search"
                className="field-sm w-56"
                placeholder="Filtrar SKU, nome, NCM…"
                value={textoFiltro}
                onChange={(e) => {
                  setTextoFiltro(e.target.value)
                  aplicarFiltro(e.target.value)
                }}
              />
            </div>
            <Btn onClick={exportarCsv}>📊 CSV</Btn>
            <Btn onClick={exportarJson}>🧾 JSON</Btn>
            <Btn variante="primary" onClick={() => void exportarPdf()}>
              📕 PDF
            </Btn>
          </div>
        </div>

        <div className="p-5">
          {!cache.length
            ? vazio(
                'Nenhum produto cadastrado',
                <>
                  Comece pela aba <strong>Consulta NCM</strong>,{' '}
                  <strong>Classificação individual</strong> ou{' '}
                  <strong>Classificação em lote</strong>.
                </>,
              )
            : !visiveis.length
              ? vazio('Nenhum produto corresponde ao filtro', 'Ajuste o texto da busca.')
              : (
                  <>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                      <table className="tbl w-full">
                        <thead>
                          <tr>
                            {semEmpresa ? <th>Empresa</th> : null}
                            <th>SKU</th>
                            <th>Produto</th>
                            <th>NCM</th>
                            <th>Reforma</th>
                            <th className="th-r">Total</th>
                            <th className="th-r">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visiveis.map((p) => (
                            <LinhaProduto
                              key={p.id ?? `${p.codigo}-${p.ncm}`}
                              p={p}
                              semEmpresa={semEmpresa}
                              onDetalhe={() => setDetalhe(p)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span>
                        Mostrando {visiveis.length} de {total} produtos
                      </span>
                      {restantes > 0 ? (
                        <Btn tam="sm" onClick={ampliarPagina}>
                          ⬇ Carregar mais (exibindo {visiveis.length} de {total})
                        </Btn>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-400">
                      👁 abre todos os tributos (regime anterior, reduções e valores).
                    </p>
                  </>
                )}
        </div>
      </Painel>
      <ModalProdutoDetalhe produto={detalhe} onFechar={() => setDetalhe(null)} />
    </div>
  )
}

/* --------------------------------------------------------------- linhas --- */

function LinhaProduto({ p, semEmpresa, onDetalhe }: { p: ProdutoLinha; semEmpresa: boolean; onDetalhe: () => void }) {
  const trocarView = useUi((s) => s.trocarView)
  const abrirCalc = useUi((s) => s.abrirCalc)
  const iniciarEdicao = useClassificar((s) => s.iniciarEdicao)
  const setCodigo = useConsulta((s) => s.setCodigo)
  const consultar = useConsulta((s) => s.consultar)
  const excluir = useProdutos((s) => s.excluir)

  const ver = () => {
    const codigo = fmtNcm(p.ncm) || p.ncm
    setCodigo(codigo)
    void consultar(codigo)
    trocarView('consulta')
  }

  // Mesmo caminho da Consulta: o cálculo do item acontece no modal, sem
  // arrastar o usuário para a tela da Calculadora.
  const paraCalculadora = () => abrirCalc({ tipo: 'produto', produto: p })

  const editar = () => {
    void iniciarEdicao(p)
    trocarView('classificar')
  }

  const remover = () => {
    void (async () => {
      const ok = await confirmar(
        'Excluir produto?',
        `Excluir o produto "${p.codigo}"?`,
        { icone: '🗑', confirmar: 'Excluir', perigo: true },
      )
      if (ok) void excluir(p.id ?? -1)
    })()
  }

  return (
    <tr className="cursor-pointer" onClick={onDetalhe} title="👁 Ver todos os tributos">
      {semEmpresa ? (
        <td className="text-xs" onClick={(e) => e.stopPropagation()}>
          {p.empresaNome ? (
            p.empresaNome
          ) : (
            <em className="text-slate-400">— sem empresa —</em>
          )}
        </td>
      ) : null}
      <td className="font-mono font-bold">{p.codigo}</td>
      <td className="max-w-[260px] truncate" title={p.nome}>
        {p.nome}
      </td>
      <td className="font-mono">{fmtNcm(p.ncm)}</td>
      <td className="max-w-[220px]" title={p.descClass}>
        <span className="block whitespace-nowrap font-mono text-[11px] font-bold">
          {p.cstReforma || '—'} · {p.cClassTrib || '—'}
          {p.classificacaoManual || p.classificacaoSnapshot?.manual ? ' ✋' : null}
        </span>
        <span className="block truncate text-[10px] text-slate-500">
          {p.classificacaoManual || p.classificacaoSnapshot?.manual ? 'Manual · usuário — ' : ''}{p.descClass}
        </span>
      </td>
      <td className="text-right font-mono font-bold">{fmtMoeda(p.total)}</td>
      <td>
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Olho onClick={onDetalhe} />
          <Acao titulo="Ver na consulta" icone="🔍" onClick={ver} />
          <Acao titulo="Enviar para a calculadora" icone="🧮" onClick={paraCalculadora} />
          <Acao titulo="Editar" icone="✏️" onClick={editar} />
          <Acao titulo="Excluir" icone="🗑" onClick={remover} perigo />
        </div>
      </td>
    </tr>
  )
}

function Acao({
  titulo,
  icone,
  onClick,
  perigo,
}: {
  titulo: string
  icone: string
  onClick: () => void
  perigo?: boolean
}) {
  return (
    <button
      type="button"
      title={titulo}
      className={`grid h-7 w-7 place-items-center rounded-lg transition ${
        perigo
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30'
      }`}
      onClick={onClick}
    >
      {icone}
    </button>
  )
}
