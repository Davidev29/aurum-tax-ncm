/**
 * Tela **Notas Fiscais (XML)** — importação de NF-e/NFC-e vinculada à empresa
 * ativa, calendário histórico, filtros, ranking de fornecedores por crédito e
 * simulação da Reforma por produto.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { ROWS_LIMIT } from '@/domain/constants'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { fmtCarga, fmtCnpj, fmtMoeda, fmtNcm, fmtNum } from '@/domain/services/format'
import { totaisNotas } from '@/application/notas-xml'
import { apurarIbsCbs, type ApuracaoIbsCbs } from '@/infrastructure/nfe/apuracao'
import { exportarNfeCSV, exportarNfePDF } from '@/infrastructure/exporters/relatorios'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import { creditoDaNota, creditoIbsCbsDaNota, creditoIbsCbsDoItem, divergenciaXmlSistema } from '@/infrastructure/nfe/credito'
import { REGIME_LABELS, regimeDoEmitente, transfereCreditoIbsCbs } from '@/infrastructure/nfe/regime'
import type { DirecaoNota, FiltrosNfe, NotaXml, ResultadoItemNfe } from '@/infrastructure/nfe/tipos'
import { useSessao } from '@/store/sessao'
import { useNfe } from '@/store/nfe'
import { ModalItemNfeDetalhe, Olho } from '@/ui/detalhes'
import { toast, useUi } from '@/store/ui'
import { CartaoStat } from '@/ui/cartoes'
import { Btn, IconeBadge, Modal, Painel, Pill, Texto } from '@/ui/kit'
import { EscudoAurum } from '@/ui/Marca'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend)

const COR_DIRECAO: Record<DirecaoNota, 'brand' | 'emerald' | 'amber'> = {
  entrada: 'brand',
  saida: 'emerald',
  quarentena: 'amber',
}
const ROTULO_DIRECAO: Record<DirecaoNota, string> = {
  entrada: '⤵ Entrada',
  saida: '⤴ Saída',
  quarentena: '⚠ Quarentena',
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function NfeXml() {
  const ativa = useSessao((s) => s.ativa)
  const carregar = useNfe((s) => s.carregar)

  useEffect(() => {
    void carregar()
  }, [ativa?.id, carregar])

  if (!ativa) return <SemEmpresa />

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-4">
      <PainelImportacao />
      <ResumoImportacao />
      <PainelHistorico />
    </div>
  )
}

function SemEmpresa() {
  const abrirModal = useUi((s) => s.abrirModal)
  return (
    <Painel className="mx-auto max-w-2xl p-8 text-center">
      <div className="text-4xl">🏢</div>
      <h2 className="mt-3 text-base font-bold">Vincule uma empresa para importar XMLs</h2>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Cada nota é gravada no cadastro da empresa ativa — é pelo CNPJ dela que o
        sistema diferencia <strong>entradas</strong> de <strong>saídas</strong> e organiza o histórico.
      </p>
      <div className="mt-4">
        <Btn variante="primary" onClick={() => abrirModal('empresas')}>
          🏢 Escolher empresa
        </Btn>
      </div>
    </Painel>
  )
}

/* ------------------------------------------------------------ importação --- */

function PainelImportacao() {
  const importar = useNfe((s) => s.importar)
  const processando = useNfe((s) => s.processando)
  const etapa = useNfe((s) => s.etapa)
  const inputRef = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)

  const enviar = (files: FileList | File[] | null) => {
    if (!files || files.length === 0 || processando) return
    void importar(files)
  }

  return (
    <Painel>
      <div className="border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2.5 text-base font-bold">
          <IconeBadge nome="nota" tom="brand" /> Importar XML (NF-e / NFC-e)
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Os arquivos são guardados no computador e as notas ficam vinculadas à empresa ativa.
          Chaves já importadas são ignoradas sem duplicar.
        </p>
      </div>
      <div className="space-y-4 p-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => !processando && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !processando) inputRef.current?.click()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!processando) setSobre(true)
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={(e) => {
            e.preventDefault()
            setSobre(false)
            enviar(e.dataTransfer.files)
          }}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
            sobre
              ? 'border-brand-500 bg-brand-50/70'
              : 'border-slate-300 bg-slate-50 hover:border-brand-500 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-950/40'
          } ${processando ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".xml"
            multiple
            onChange={(e) => {
              enviar(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="mx-auto grid place-items-center transition-transform group-hover:scale-110">
            <IconeBadge nome="nota" tom="brand" tamanho="lg" />
          </div>
          <p className="mt-3 text-sm font-semibold">
            Arraste os XMLs <span className="text-brand-600 dark:text-aurum-200">ou clique para escolher</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Aceita vários arquivos .xml de uma vez (NF-e mod. 55 e NFC-e mod. 65)
          </p>
        </div>

        {processando ? (
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full w-1/3 animate-shimmer rounded-full bg-gradient-to-r from-brand-600 to-brand-400" />
            </div>
            <div className="text-[11px] text-slate-500">{etapa ?? 'Processando…'}</div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
          <CampoTaxaNfe tributo="IBS" />
          <CampoTaxaNfe tributo="CBS" />
          <p className="min-w-[240px] flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Alíquotas de referência usadas <strong>na importação</strong>. Valem para as notas
            importadas a partir de agora.
          </p>
        </div>
      </div>
    </Painel>
  )
}

function CampoTaxaNfe({ tributo }: { tributo: 'IBS' | 'CBS' }) {
  const valor = useNfe((s) => (tributo === 'IBS' ? s.refIBS : s.refCBS))
  const setRef = useNfe((s) => s.setRef)
  const [texto, setTexto] = useState(() => String(valor))

  return (
    <label className="block w-28">
      <span className="field-label">{tributo} (%)</span>
      <Texto
        type="number"
        step="0.01"
        min={0}
        max={100}
        mono
        className="num-input"
        value={texto}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '')
          setTexto(t)
          setRef(tributo, Number(t.replace(',', '.')) || 0)
        }}
      />
    </label>
  )
}

function ResumoImportacao() {
  const resumo = useNfe((s) => s.ultimoResumo)
  if (!resumo) return null
  return (
    <div className={`rounded-2xl border p-4 text-xs leading-relaxed ${
      resumo.erros.length
        ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30'
        : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
    }`}>
      <div className="font-bold">
        📥 {resumo.novas} nota(s) importada(s)
        {resumo.duplicadas ? ` · ${resumo.duplicadas} duplicada(s) ignorada(s)` : ''}
        {resumo.quarentena ? ` · ${resumo.quarentena} em quarentena` : ''}
      </div>
      {resumo.erros.length ? (
        <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
          {resumo.erros.map((e, i) => (
            <li key={`${e.arquivo}-${i}`} className="break-words">
              ❌ <strong>{e.arquivo}</strong>: {e.motivo}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- histórico --- */

/**
 * Esqueleto exibido ao entrar no módulo enquanto as notas existentes são
 * lidas — tamanhos fixos com shimmer para nada "surgir do nada".
 */
/**
 * Modal glass de carregamento das notas — bloqueia a interação até os dados
 * estarem prontos. Sem botão fechar / Escape: só sai quando
 * `carregandoHistorico` vira false.
 *
 * Duas garantias:
 * - aparece SEMPRE que uma carga começa, inclusive ao voltar à tela com
 *   dados em cache (a leitura local resolve em <150 ms e o atraso antigo de
 *   150 ms cancelava o modal antes de pintar — "só aparecia uma vez");
 * - em vez do atraso, há exibição mínima (750 ms) para a animação completar
 *   um ciclo em vez de piscar.
 * Animações só no compositor (`transform`/`opacity`) para não engasgar.
 */
/** Tempo mínimo com o modal visível — um ciclo completo da animação. */
const EXIBICAO_MINIMA_MS = 750

function ModalCarregamentoNotas({ visivel, primeiraCarga }: { visivel: boolean; primeiraCarga: boolean }) {
  const [mostrar, setMostrar] = useState(false)
  const inicioRef = useRef(0)

  // Toda carga mostra o modal na hora — primeira ou retorno à tela.
  useEffect(() => {
    if (!visivel) return
    inicioRef.current = Date.now()
    setMostrar(true)
  }, [visivel])

  // ...e ele só sai após a exibição mínima.
  useEffect(() => {
    if (visivel || !mostrar) return
    const falta = Math.max(0, EXIBICAO_MINIMA_MS - (Date.now() - inicioRef.current))
    if (falta === 0) {
      setMostrar(false)
      return
    }
    const t = window.setTimeout(() => setMostrar(false), falta)
    return () => window.clearTimeout(t)
  }, [visivel, mostrar])

  if (!mostrar || typeof document === 'undefined') return null
  // Portal no <body>: o `animate-fade-up` da entrada da view aplica
  // `transform` no ancestral e vira referência de `position: fixed`,
  // jogando o modal para baixo do conteúdo. No body ele centraliza na
  // viewport — na altura dos olhos, com leve viés para cima.
  return createPortal(
    <div
      className="modal-backdrop"
      style={{ paddingBottom: '8vh' }}
      role="alertdialog"
      aria-modal="true"
      aria-label={primeiraCarga ? 'Carregando notas fiscais' : 'Atualizando notas fiscais'}
      aria-busy="true"
    >
      <div className="modal-box modal-box--loader glass-box max-w-sm text-center">
        <div className="h-1.5 rounded-t-2xl bg-gradient-to-r from-brand-700 via-aurum-400 to-emerald-500" />
        <div className="min-h-[240px] px-6 py-6">
          <div className="relative mx-auto grid h-14 w-14 place-items-center">
            <span className="absolute inset-0 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600 dark:border-slate-700 dark:border-t-aurum-300" />
            <EscudoAurum tamanho={34} />
          </div>
          <h2 className="mt-4 text-base font-black tracking-tight text-[var(--ink)]">
            {primeiraCarga ? 'Carregando notas fiscais…' : 'Atualizando notas…'}
          </h2>
          <p className="mx-auto mt-1 max-w-[28ch] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {primeiraCarga
              ? 'Lendo o histórico, o calendário e os fornecedores da empresa ativa.'
              : 'Recalculando totais, apuração e ranking com os filtros atuais.'}
          </p>
          <div
            className="mx-auto mt-4 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/60"
            role="progressbar"
            aria-label="Progresso do carregamento"
          >
            <div className="loading-bar h-full w-1/4 rounded-full bg-gradient-to-r from-brand-700 via-aurum-400 to-emerald-500" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {['Notas', 'Apuração', 'Ranking'].map((etapa) => (
              <span key={etapa} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-aurum-500" />
                {etapa}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function EsqueletoHistorico() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando notas" className="space-y-6">
      <div className="flex items-center justify-center gap-2 rounded-full border border-brand-200/70 bg-white/85 py-2 text-xs font-bold text-brand-700 shadow-card dark:border-aurum-900 dark:bg-slate-900/85 dark:text-brand-300">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        Carregando notas…
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200/70 p-4 dark:border-slate-700/60">
            <div className="skeleton h-3 w-2/3" />
            <div className="skeleton mt-2 h-6 w-full" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200/70 p-4 dark:border-slate-700/60">
        <div className="skeleton h-4 w-48" />
        <div className="skeleton mt-3 h-24 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/70 p-4 dark:border-slate-700/60">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton mt-3 h-40 w-full" />
        </div>
        <div className="rounded-2xl border border-slate-200/70 p-4 lg:col-span-2 dark:border-slate-700/60">
          <div className="skeleton h-4 w-56" />
          <div className="space-y-2 pt-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200/70 p-4 dark:border-slate-700/60">
        <div className="skeleton h-4 w-40" />
        <div className="space-y-2 pt-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

function PainelHistorico() {
  const notas = useNfe((s) => s.notas)
  const carregandoHistorico = useNfe((s) => s.carregandoHistorico)
  const vincularProdutos = useNfe((s) => s.vincularProdutos)
  const reaplicarVigentes = useNfe((s) => s.reaplicarVigentes)
  const setFiltros = useNfe((s) => s.setFiltros)
  const tot = useMemo(() => totaisNotas(notas), [notas])
  const apuracao = useMemo(() => apurarIbsCbs(notas), [notas])
  const [fornecedorAberto, setFornecedorAberto] = useState<string | null>(null)
  // DANFE única no topo da página (irmã dos demais modais, nunca aninhada):
  // abrir a nota não fecha mais o detalhe nem some da tela.
  const [danfeNota, setDanfeNota] = useState<NotaXml | null>(null)

  const fecharFornecedor = () => {
    setFiltros({ fornecedor: '', direcao: 'todas' })
    setFornecedorAberto(null)
  }

  // Entrada no módulo (ou troca de empresa): o conteúdo só é entregue
  // quando os dados estão prontos — o modal glass bloqueia até lá e o
  // esqueleto fica como fundo na primeira carga.
  const primeiraCarga = carregandoHistorico && !notas.length

  return (
    <div className="relative space-y-8" aria-busy={carregandoHistorico}>
      <ModalCarregamentoNotas visivel={carregandoHistorico} primeiraCarga={primeiraCarga} />
      {primeiraCarga ? (
        <EsqueletoHistorico />
      ) : (
      <div className={`xml-stack ${carregandoHistorico ? 'pointer-events-none select-none opacity-60 saturate-50' : ''}`}>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
        <CartaoStat rotulo="Notas" valor={tot.qtd} />
        <CartaoStat rotulo="Entradas" valor={tot.entradas} />
        <CartaoStat rotulo="Saídas" valor={tot.saidas} />
        <CartaoStat rotulo="Base total" valor={fmtMoeda(tot.base)} />
        <CartaoStat rotulo="IBS + CBS" valor={fmtMoeda(tot.trib)} cor="text-brand-700 dark:text-aurum-200" />
        <CartaoStat rotulo="Carga média" valor={fmtCarga(tot.carga)} />
      </div>

      <ApuracaoReforma apuracao={apuracao} />

      <GraficosNfe notas={notas} />

      {notas.length ? (
        /*
          Seção de ações do lote: Painel próprio com cabeçalho + descrição à
          esquerda e botões alinhados à direita (uma linha no desktop, quebra
          limpa no mobile). Antes eram três botões soltos na página — sem
          hierarquia visual e desalinhados em telas estreitas.
        */
        <Painel className="overflow-hidden p-0">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <IconeBadge nome="caixa" tom="brand" />
                Cadastro de produtos
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Vincula os itens das <strong>{notas.length} nota(s) filtrada(s)</strong> ao cadastro (NCM, CFOP,
                CST ICMS, PIS e COFINS), cria os que faltam e atualiza preço/quantidade.
                Exporte antes se quiser conferir a lista.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Btn onClick={() => void exportarPdf(notas)}>📕 PDF</Btn>
              <Btn onClick={() => exportarCsv(notas)}>📊 CSV</Btn>
              <Btn
                title="Recalcular as notas filtradas pela classificação vigente (base oficial › manual › regra geral) — use após uma reclassificação manual"
                onClick={() => void reaplicarVigentes()}
              >
                ↻ Reaplicar vigentes
              </Btn>
              <Btn variante="primary" onClick={() => void vincularProdutos()}>
                📦 Vincular produtos ao cadastro
              </Btn>
            </div>
          </div>
        </Painel>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:h-[320px] lg:grid-cols-3 lg:items-stretch">
        <Calendario />
        <div className="lg:col-span-2 lg:min-h-0">
          <RankingFornecedores selecionado={fornecedorAberto} onSelecionar={setFornecedorAberto} />
        </div>
      </div>

      <TopProdutosNfe notas={notas} />

      {fornecedorAberto ? (
        <NotasFornecedor cnpj={fornecedorAberto} onFechar={fecharFornecedor} onVerDanfe={setDanfeNota} />
      ) : null}

      <Filtros />
      <TabelaNotas notas={notas} onVerDanfe={setDanfeNota} />
      <ModalDetalheNfe onVerDanfe={setDanfeNota} />
      {danfeNota ? <DanfeModal nota={danfeNota} onFechar={() => setDanfeNota(null)} /> : null}
      </div>
      )}
    </div>
  )

  async function exportarPdf(lista: NotaXml[]) {
    try {
      const st = useNfe.getState()
      const { carregarEmitente } = await import('@/application/emitente')
      const salvo = await carregarEmitente().catch(() => null)
      const emitente = salvo ?? useSessao.getState().emitente ?? EMITENTE_PADRAO
      const periodo = st.filtros.inicio || st.filtros.fim
        ? `${st.filtros.inicio || '…'} a ${st.filtros.fim || '…'}`
        : `${MESES[st.mesMes - 1]}/${st.mesAno}`
      await exportarNfePDF({
        notas: lista,
        ranking: st.ranking,
        emitente,
        empresaNome: useSessao.getState().ativa?.razaoSocial ?? '—',
        periodo,
      })
      toast('PDF das notas gerado.', 'ok')
    } catch (e) {
      toast(`Erro ao gerar PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  // Menu nativo (Ctrl+E): registra o exportador de PDF desta view.
  useEffect(() => registrarExportador('nfe', () => void exportarPdf(notas)), [notas])

  function exportarCsv(lista: NotaXml[]) {
    exportarNfeCSV(lista)
    toast('CSV das notas gerado.', 'ok')
  }
}

/* -------------------------------------------------------------- apuração --- */

/**
 * Apuração IBS/CBS no padrão do portal da Reforma (tributação sobre o
 * consumo): débitos das saídas menos créditos apropriáveis das entradas,
 * por tributo e no total — com o veredito (a pagar / saldo credor).
 * Calculada sobre as notas filtradas em tela.
 */
function ApuracaoReforma({ apuracao: a }: { apuracao: ApuracaoIbsCbs }) {
  const temMovimento = a.resultado !== 'sem-movimento'
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="calculadora" tom="brand" />
          Apuração IBS / CBS
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          Débitos das saídas − créditos das entradas · {a.qtdSaidas} saída(s) e{' '}
          {a.qtdEntradasApropriaveis + a.qtdEntradasBloqueadas + a.qtdEntradasNaoConfirmadas} entrada(s) no filtro
        </p>
      </div>
      <div className="p-5">
        <table className="tbl w-full">
          <thead>
            <tr>
              <th>Apuração (estimativa LC 214/2025)</th>
              <th className="th-r">IBS</th>
              <th className="th-r">CBS</th>
              <th className="th-r">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Débitos — Saídas
                <span className="block text-[10px] font-normal text-slate-400">
                  {a.qtdSaidas} nota(s) · base {fmtMoeda(a.baseSaidas)}
                </span>
              </td>
              <td className="text-right font-mono">{fmtMoeda(a.debitoIBS)}</td>
              <td className="text-right font-mono">{fmtMoeda(a.debitoCBS)}</td>
              <td className="text-right font-mono font-bold">{fmtMoeda(a.debitoTotal)}</td>
            </tr>
            <tr>
              <td>
                (−) Créditos apropriáveis — Entradas
                <span className="block text-[10px] font-normal text-slate-400">
                  {a.qtdEntradasApropriaveis} nota(s) de regime normal · base {fmtMoeda(a.baseEntradas)}
                </span>
              </td>
              <td className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoIBS)}</td>
              <td className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoCBS)}</td>
              <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoTotal)}</td>
            </tr>
            <tr>
              <td className="font-bold">(=) Saldo apurado</td>
              <td className="text-right font-mono font-bold">{fmtMoeda(a.saldoIBS)}</td>
              <td className="text-right font-mono font-bold">{fmtMoeda(a.saldoCBS)}</td>
              <td className="text-right font-mono font-black">{fmtMoeda(a.saldoTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-3">
          {a.resultado === 'a-pagar' ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-white p-3.5 dark:border-red-900 dark:from-red-950/40 dark:to-slate-900">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-100 text-lg dark:bg-red-950">💰</span>
              <div>
                <div className="text-sm font-black text-red-700 dark:text-red-300">
                  Imposto a pagar: {fmtMoeda(a.valorAPagar)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  IBS {fmtMoeda(Math.max(0, a.saldoIBS))} + CBS {fmtMoeda(Math.max(0, a.saldoCBS))}
                  {a.saldoIBS < 0 || a.saldoCBS < 0 ? ' (tributo com saldo credor abatido no total)' : ''}
                </div>
              </div>
            </div>
          ) : a.resultado === 'saldo-credor' ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-3.5 dark:border-emerald-900 dark:from-emerald-950/40 dark:to-slate-900">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-lg dark:bg-emerald-950">↩</span>
              <div>
                <div className="text-sm font-black text-emerald-700 dark:text-emerald-300">
                  Saldo credor: {fmtMoeda(a.saldoCredor)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Créditos superaram os débitos — valor disponível para restituição ou compensação.
                </div>
              </div>
            </div>
          ) : a.resultado === 'zerado' ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-center text-xs font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
              ✓ Débitos e créditos se equivalem — sem saldo a pagar ou restituir.
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-3.5 text-center text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-950/30">
              Sem movimento no filtro — importe XMLs com entradas e saídas para apurar.
            </div>
          )}
        </div>

        {temMovimento && (a.bloqueadoTotal > 0 || a.naoConfirmadoTotal > 0 || a.qtdQuarentena > 0) ? (
          <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
            {a.bloqueadoTotal > 0 ? (
              <>⛔ Créditos bloqueados (Simples/MEI, {a.qtdEntradasBloqueadas} nota(s)): <strong>{fmtMoeda(a.bloqueadoTotal)}</strong> — não abatem o saldo. </>
            ) : null}
            {a.naoConfirmadoTotal > 0 ? (
              <>❓ Créditos não confirmados ({a.qtdEntradasNaoConfirmadas} nota(s)): <strong>{fmtMoeda(a.naoConfirmadoTotal)}</strong> — regime do emitente não identificado. </>
            ) : null}
            {a.qtdQuarentena > 0 ? (
              <>⚠ {a.qtdQuarentena} nota(s) em quarentena fora da apuração.</>
            ) : null}
          </p>
        ) : null}
      </div>
    </Painel>
  )
}

/* ------------------------------------------------------------- calendário --- */

function Calendario() {
  const mesAno = useNfe((s) => s.mesAno)
  const mesMes = useNfe((s) => s.mesMes)
  const setMes = useNfe((s) => s.setMes)
  const dias = useNfe((s) => s.diasComNota)
  const filtrarPorDia = useNfe((s) => s.filtrarPorDia)
  const filtros = useNfe((s) => s.filtros)

  const primeiroDia = new Date(mesAno, mesMes - 1, 1).getDay()
  const totalDias = new Date(mesAno, mesMes, 0).getDate()
  const diaSel = filtros.inicio && filtros.inicio === filtros.fim
    ? Number(filtros.inicio.slice(8, 10))
    : null

  const anterior = () => {
    const d = new Date(mesAno, mesMes - 2, 1)
    setMes(d.getFullYear(), d.getMonth() + 1)
  }
  const proximo = () => {
    const d = new Date(mesAno, mesMes, 1)
    setMes(d.getFullYear(), d.getMonth() + 1)
  }

  return (
    <Painel className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={anterior} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Mês anterior">‹</button>
        <h3 className="flex items-center gap-2 text-sm font-bold"><IconeBadge nome="calendario" tom="brand" tamanho="sm" /> {MESES[mesMes - 1]} <span className="text-slate-400">{mesAno}</span></h3>
        <button type="button" onClick={proximo} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Próximo mês">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-slate-400">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: primeiroDia }, (_, i) => <span key={`v-${i}`} />)}
        {Array.from({ length: totalDias }, (_, i) => {
          const dia = i + 1
          const qtd = dias.get(dia) ?? 0
          const sel = diaSel === dia
          return (
            <button
              key={dia}
              type="button"
              onClick={() => filtrarPorDia(sel ? null : dia)}
              title={qtd ? `${qtd} nota(s)` : 'Sem notas'}
              className={`grid h-8 place-items-center rounded-lg text-xs transition-all ${
                sel
                  ? 'bg-brand-600 font-black text-white shadow-pop'
                  : qtd
                    ? 'bg-brand-50 font-bold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300'
                    : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex flex-col items-center leading-none">
                {dia}
                {qtd ? <span className={`mt-0.5 h-1 w-1 rounded-full ${sel ? 'bg-white' : 'bg-brand-500'}`} /> : null}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-auto pt-2 text-[10px] text-slate-400 dark:text-slate-500">
        Clique num dia para filtrar as notas.
      </p>
    </Painel>
  )
}

/* -------------------------------------------------------------- ranking --- */

function RankingFornecedores({
  selecionado,
  onSelecionar,
}: {
  selecionado: string | null
  onSelecionar: (cnpj: string | null) => void
}) {
  const ranking = useNfe((s) => s.ranking)
  const setFiltros = useNfe((s) => s.setFiltros)
  const max = ranking.reduce((m, r) => Math.max(m, r.creditoTotal), 0)

  const alternar = (cnpj: string) => {
    if (selecionado === cnpj) {
      onSelecionar(null)
      return
    }
    onSelecionar(cnpj)
    // Filtra a tabela principal para as notas desse fornecedor (entradas).
    setFiltros({ fornecedor: cnpj, direcao: 'entrada' })
  }

  return (
    <Painel className="flex h-full flex-col overflow-hidden p-0">
      <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-2 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-1.5 text-xs font-bold">
          <IconeBadge nome="fornecedor" tom="emerald" tamanho="sm" />
          Fornecedores com maior crédito
        </h3>
        <p className="mt-0.5 pl-8 text-[10px] text-slate-500 dark:text-slate-400">
          IBS + CBS das entradas · clique para ver as notas
        </p>
      </div>
      <div className="max-h-[300px] min-h-0 space-y-2 overflow-y-auto p-3 lg:max-h-none lg:flex-1">
        {!ranking.length ? (
          <p className="py-4 text-center text-[11px] text-slate-500">
            Sem entradas no período para ranquear fornecedores.
          </p>
        ) : ranking.map((r) => {
          const ativo = selecionado === r.cnpj
          return (
            <button
              key={r.cnpj}
              type="button"
              onClick={() => alternar(r.cnpj)}
              title={`Ver notas de ${r.nome} (${r.qtdNotas})`}
              className={`w-full rounded-lg border p-2 text-left transition-all hover:shadow-card ${
                ativo
                  ? 'border-brand-500 bg-brand-50/70 shadow-card dark:bg-brand-950/30'
                  : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-950/40'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1">
                  <span className={`transition-transform ${ativo ? 'rotate-90' : ''} text-slate-400`}>›</span>
                  <span className="truncate font-semibold" title={`${r.nome} · ${fmtCnpj(r.cnpj)}`}>
                    {r.nome}
                  </span>
                  {r.simples ? (
                    <span title="Fornecedor Simples/MEI: valores abaixo são estimativa — não há transferência de crédito de IBS/CBS.">
                      <Pill cor="amber">Simples · sem crédito</Pill>
                    </span>
                  ) : null}
                </span>
                <span className={`shrink-0 font-mono font-bold ${r.simples ? 'text-slate-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {fmtMoeda(r.creditoTotal)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-600 to-emerald-500 transition-all"
                  style={{ width: `${max > 0 ? Math.max(4, (r.creditoTotal / max) * 100) : 0}%` }}
                />
              </div>
              <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-slate-400">
                <span>
                  {r.qtdNotas} nota(s) · {fmtMoeda(r.totalEntradas)} · IBS {fmtMoeda(r.creditoIBS)} + CBS {fmtMoeda(r.creditoCBS)}
                </span>
                <span className="font-sans font-bold text-brand-600 dark:text-aurum-200">
                  {ativo ? '▲' : '›'}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </Painel>
  )
}

/* ---------------------------------------------------------- top produtos --- */

/**
 * Top produtos do período analisado — mais comprados (entradas) e mais
 * vendidos (saídas) lado a lado, com os tributos da Reforma por item
 * (IBS + CBS estimados, CST/cClassTrib).
 */
function TopProdutosNfe({ notas }: { notas: NotaXml[] }) {
  const dados = useMemo(() => {
    const agregar = (fluxo: 'entrada' | 'saida') => {
      const mapa = new Map<string, {
        codigo: string; nome: string; ncm: string; cfop: string;
        qtd: number; base: number; ibs: number; cbs: number; trib: number;
        cst: string; cClassTrib: string;
      }>()
      for (const n of notas) {
        if (n.direcao !== fluxo) continue
        for (const it of n.itensAnalisados) {
          const chave = `${it.codProd}‖${it.ncm}`
          const atual = mapa.get(chave) ?? {
            codigo: it.codProd,
            nome: it.descricao || it.codProd,
            ncm: it.ncm,
            cfop: it.cfop || '—',
            qtd: 0, base: 0, ibs: 0, cbs: 0, trib: 0,
            cst: it.classificacao.cst || '—',
            cClassTrib: it.classificacao.cClassTrib || '—',
          }
          atual.qtd += Number(it.qtd) || 0
          atual.base += Number(it.vlTotal) || 0
          atual.ibs += Number(it.ibs) || 0
          atual.cbs += Number(it.cbs) || 0
          atual.trib += Number(it.totalTributos) || 0
          // Enquadramento do sistema (base da estimativa acima) — o CST do
          // XML é o do emitente e aparece no detalhe da nota, não aqui.
          atual.cst = it.classificacao.cst || atual.cst
          atual.cClassTrib = it.classificacao.cClassTrib || atual.cClassTrib
          mapa.set(chave, atual)
        }
      }
      return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, 5)
    }
    return { entradas: agregar('entrada'), saidas: agregar('saida') }
  }, [notas])

  if (!notas.length) return null
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <QuadroTopProdutos
        titulo="Mais comprados"
        subtitulo="Entradas do período · top 5 por valor"
        tom="emerald"
        lista={dados.entradas}
        vazio="Sem entradas no período para ranquear produtos."
      />
      <QuadroTopProdutos
        titulo="Mais vendidos"
        subtitulo="Saídas do período · top 5 por valor"
        tom="brand"
        lista={dados.saidas}
        vazio="Sem saídas no período para ranquear produtos."
      />
    </div>
  )
}

function QuadroTopProdutos({
  titulo,
  subtitulo,
  tom,
  lista,
  vazio,
}: {
  titulo: string
  subtitulo: string
  tom: 'emerald' | 'brand'
  lista: { codigo: string; nome: string; ncm: string; cfop: string; qtd: number; base: number; ibs: number; cbs: number; trib: number; cst: string; cClassTrib: string }[]
  vazio: string
}) {
  const max = lista.reduce((m, p) => Math.max(m, p.base), 0)
  const barra = tom === 'emerald' ? 'from-emerald-600 to-teal-400' : 'from-brand-600 to-brand-400'
  const valor = tom === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-brand-700 dark:text-aurum-200'
  return (
    <Painel className="flex h-full flex-col overflow-hidden p-0">
      <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-2 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-1.5 text-xs font-bold">
          <IconeBadge nome="trofeu" tom={tom} tamanho="sm" />
          {titulo}
        </h3>
        <p className="mt-0.5 pl-8 text-[10px] text-slate-500 dark:text-slate-400">{subtitulo}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {!lista.length ? (
          <p className="py-4 text-center text-[11px] text-slate-500">{vazio}</p>
        ) : lista.map((p, i) => (
          <div
            key={`${p.codigo}-${p.ncm}`}
            className="rounded-lg border border-transparent p-2 transition-all hover:border-slate-200 hover:bg-slate-50 hover:shadow-card dark:hover:border-slate-700 dark:hover:bg-slate-950/40"
            title={`${p.nome} · NCM ${fmtNcm(p.ncm)} · CFOP ${p.cfop} · CST ${p.cst} · ${p.cClassTrib}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {i + 1}
                </span>
                <span className="truncate font-semibold">{p.nome}</span>
              </span>
              <span className={`shrink-0 font-mono font-bold ${valor}`}>{fmtMoeda(p.base)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${barra} transition-all`}
                style={{ width: `${max > 0 ? Math.max(4, (p.base / max) * 100) : 0}%` }}
              />
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate font-mono text-slate-400">
                {p.codigo} · {fmtNcm(p.ncm)} · qtd {fmtNum(p.qtd)}
              </span>
              <span className="shrink-0 font-mono text-slate-500 dark:text-slate-400">
                IBS {fmtMoeda(p.ibs)} + CBS {fmtMoeda(p.cbs)} = <strong className={valor}>{fmtMoeda(p.trib)}</strong>
              </span>
            </div>
            <div className="mt-1">
              <Pill cor={tom === 'emerald' ? 'emerald' : 'brand'}>Sistema CST {p.cst} · {p.cClassTrib}</Pill>
            </div>
          </div>
        ))}
      </div>
    </Painel>
  )
}

/**
 * Notas do fornecedor selecionado no ranking — abre em **modal** com todas
 * as notas que ele emitiu para a empresa ativa, com valores e acesso ao
 * detalhe completo + visualização da nota (DANFE).
 */
function NotasFornecedor({
  cnpj,
  onFechar,
  onVerDanfe,
}: {
  cnpj: string
  onFechar: () => void
  onVerDanfe: (n: NotaXml) => void
}) {
  const ranking = useNfe((s) => s.ranking)
  const notas = useNfe((s) => s.notas)
  const abrirNota = useNfe((s) => s.abrirNota)

  const info = ranking.find((r) => r.cnpj === cnpj)
  // A tabela principal já está filtrada por este fornecedor; aqui mostra o
  // recorte exato (todas as direções do emitente, com entradas primeiro).
  const lista = useMemo(
    () => notas.filter((n) => n.emitCnpj === cnpj).sort((a, b) => (b.dataEmissao > a.dataEmissao ? 1 : -1)),
    [notas, cnpj],
  )
  const totalCred = useMemo(() => {
    const c = creditoIbsCbsDaNota(
      lista.flatMap((n) => n.itensAnalisados),
      {
        totalIbsXml: lista.reduce((s, n) => s + (Number(n.totalIbsXml) || 0), 0),
        totalCbsXml: lista.reduce((s, n) => s + (Number(n.totalCbsXml) || 0), 0),
      },
    )
    return c
  }, [lista])

  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo={`Notas de ${info?.nome ?? 'fornecedor'}`}
      subtitulo={`${fmtCnpj(cnpj)} · ${lista.length} nota(s) emitida(s) para a sua empresa · crédito IBS/CBS destacado ${fmtMoeda(totalCred.totalDestacado)}${info?.simples ? ' · Simples/MEI — sem transferência de crédito' : ''}`}
      largura="max-w-4xl"
      rodape={<Btn tam="sm" onClick={onFechar}>✕ Fechar</Btn>}
    >
      <div className="max-h-[44vh] overflow-auto">
        {!lista.length ? (
          <p className="p-6 text-center text-xs text-slate-500">
            Nenhuma nota deste fornecedor no filtro atual. Limpe o período/calendário e tente de novo.
          </p>
        ) : (
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>Número</th>
                <th>Emissão</th>
                <th className="th-r">Valor</th>
                <th className="th-r">IBS + CBS</th>
                <th className="th-r">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((n) => {
                const cred = creditoIbsCbsDaNota(n.itensAnalisados, n)
                return (
                  <tr key={n.id ?? n.chave}>
                    <td className="font-mono font-bold">{n.numero || n.chave.slice(-8)}</td>
                    <td className="font-mono text-[11px]">{fmtData(n.dataEmissao)}</td>
                    <td className="text-right font-mono">{fmtMoeda(n.valorTotal)}</td>
                    <td
                      className="text-right font-mono text-emerald-700 dark:text-emerald-400"
                      title={`IBS ${fmtMoeda(cred.ibsDestacado)} + CBS ${fmtMoeda(cred.cbsDestacado)} · estimativa ${fmtMoeda(n.totalTributos)}`}
                    >
                      {cred.temDestaque ? fmtMoeda(cred.totalDestacado) : <span className="text-slate-400">{fmtMoeda(n.totalTributos)}</span>}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-bold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                          title="Ver itens, NCM e valores"
                          onClick={() => abrirNota(n)}
                        >
                          Detalhes
                        </button>
                        <button
                          type="button"
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="Visualizar nota (DANFE)"
                          onClick={() => onVerDanfe(n)}
                        >
                          🧾 Nota
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- filtros --- */

function Filtros() {
  const filtros = useNfe((s) => s.filtros)
  const setFiltros = useNfe((s) => s.setFiltros)
  const limparFiltros = useNfe((s) => s.limparFiltros)
  const fornecedores = useNfe((s) => s.fornecedores)
  const cstIcmsOpcoes = useNfe((s) => s.cstIcmsOpcoes)
  const [reformaAberto, setReformaAberto] = useState(false)
  const ativosReforma = [filtros.cClassTrib, filtros.cstReforma, filtros.reducao].filter((v) =>
    v.trim(),
  ).length

  return (
    <Painel className="space-y-3 p-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <label className="block lg:col-span-2">
          <span className="field-label">Produto / código / NCM</span>
          <Texto
            value={filtros.texto}
            onChange={(e) => setFiltros({ texto: e.target.value })}
            placeholder="Ex.: queijo, SKU-001, 0201…"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="field-label">Fornecedor (emitente)</span>
          <select
            className="field"
            value={filtros.fornecedor}
            onChange={(e) => setFiltros({ fornecedor: e.target.value })}
          >
            <option value="">Todos</option>
            {fornecedores.map((f) => (
              <option key={f.cnpj} value={f.cnpj}>{f.nome}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Direção</span>
          <select
            className="field"
            value={filtros.direcao}
            onChange={(e) => setFiltros({ direcao: e.target.value as FiltrosNfe['direcao'] })}
          >
            <option value="todas">Todas</option>
            <option value="entrada">Entradas</option>
            <option value="saida">Saídas</option>
            <option value="quarentena">Quarentena</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">CFOP</span>
          <Texto
            value={filtros.cfop}
            onChange={(e) => setFiltros({ cfop: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            placeholder="5102"
            mono
          />
        </label>
        <label className="block">
          <span className="field-label">CST ICMS</span>
          <select
            className="field font-mono"
            value={filtros.cstIcms}
            onChange={(e) => setFiltros({ cstIcms: e.target.value })}
            disabled={!cstIcmsOpcoes.length}
            title={
              cstIcmsOpcoes.length
                ? 'CST (regime normal) ou CSOSN (Simples) existente nas notas importadas'
                : 'Sem CST nas notas importadas'
            }
          >
            <option value="">{cstIcmsOpcoes.length ? 'Todos' : '—'}</option>
            {cstIcmsOpcoes.map((cst) => (
              <option key={cst} value={cst}>{cst}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">De</span>
          <Texto type="date" value={filtros.inicio} onChange={(e) => setFiltros({ inicio: e.target.value })} />
        </label>
        <label className="block">
          <span className="field-label">Até</span>
          <Texto type="date" value={filtros.fim} onChange={(e) => setFiltros({ fim: e.target.value })} />
        </label>
        <div className="flex items-end gap-2 lg:col-span-3">
          <Btn onClick={() => limparFiltros()}>✕ Limpar</Btn>
          <Btn
            variante={reformaAberto || ativosReforma > 0 ? 'primary' : 'ghost'}
            onClick={() => setReformaAberto((v) => !v)}
            title="Filtros específicos da Reforma: cClassTrib, CST e redução por item"
          >
            🎛 Reforma{ativosReforma > 0 ? ` (${ativosReforma})` : ''} {reformaAberto ? '▾' : '▸'}
          </Btn>
        </div>
      </div>
      {reformaAberto ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-brand-200/60 bg-brand-50/40 p-4 md:grid-cols-3 dark:border-aurum-900 dark:bg-brand-950/20">
          <label className="block">
            <span className="field-label">cClassTrib</span>
            <Texto
              value={filtros.cClassTrib}
              onChange={(e) => setFiltros({ cClassTrib: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              placeholder="000001…"
              mono
            />
          </label>
          <label className="block">
            <span className="field-label">CST Reforma</span>
            <Texto
              value={filtros.cstReforma}
              onChange={(e) =>
                setFiltros({ cstReforma: e.target.value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 3) })
              }
              placeholder="000…"
              mono
            />
          </label>
          <label className="block">
            <span className="field-label">Redução / benefício</span>
            <select
              className="field"
              value={filtros.reducao}
              onChange={(e) => setFiltros({ reducao: e.target.value })}
            >
              <option value="">Todas</option>
              <option value="isento">💠 Crédito integral (sem redução)</option>
              <option value="0">Alíquota zero</option>
              <option value="60">Redução 60%</option>
              <option value="30">Redução 30%</option>
            </select>
          </label>
        </div>
      ) : null}
    </Painel>
  )
}

/* ---------------------------------------------------------------- tabela --- */

function TabelaNotas({ notas, onVerDanfe }: { notas: NotaXml[]; onVerDanfe: (n: NotaXml) => void }) {
  const abrirNota = useNfe((s) => s.abrirNota)
  const excluir = useNfe((s) => s.excluir)

  if (!notas.length) {
    return (
      <Painel className="p-8 text-center text-sm text-slate-500">
        Nenhuma nota encontrada. Importe XMLs ou ajuste os filtros.
      </Painel>
    )
  }

  return (
    <Painel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <span>🧾</span> Notas ({notas.length})
        </h3>
        <span className="text-[10px] text-slate-500">👁 ver itens e tributos · 🧾 abre a DANFE</span>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="tbl w-full">
          <thead>
            <tr>
              <th>Número</th>
              <th>Emissão</th>
              <th>Emitente</th>
              <th>Direção</th>
              <th className="th-r">Valor</th>
              <th className="th-r">IBS + CBS</th>
              <th className="th-r">Ações</th>
            </tr>
          </thead>
          <tbody>
            {notas.slice(0, ROWS_LIMIT).map((n) => {
              const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
              return (
              <tr key={n.id ?? n.chave} className="cursor-pointer" onClick={() => abrirNota(n)} title="👁 Ver itens e todos os tributos">
                <td className="font-mono font-bold">{n.numero || n.chave.slice(-8)}</td>
                <td className="font-mono text-[11px]">{fmtData(n.dataEmissao)}</td>
                <td className="max-w-[260px]" title={`${n.emitNome} · ${fmtCnpj(n.emitCnpj)}${regime !== 'desconhecido' && regime !== 'normal' ? ` · ${REGIME_LABELS[regime]}` : ''} · ${n.itensAnalisados.length} item(ns)`}>
                  <span className="block truncate">{n.emitNome || fmtCnpj(n.emitCnpj)}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {regime === 'simples' || regime === 'mei' ? (
                      <span className="inline-block"><Pill cor="amber">{REGIME_LABELS[regime]}</Pill></span>
                    ) : null}
                    <span className="text-[10px] text-slate-400">{n.itensAnalisados.length} item(ns)</span>
                  </span>
                </td>
                <td><Pill cor={COR_DIRECAO[n.direcao]}>{ROTULO_DIRECAO[n.direcao]}</Pill></td>
                <td className="text-right font-mono">{fmtMoeda(n.valorTotal)}</td>
                <td
                  className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400"
                  title={`Estimativa do sistema: IBS ${fmtMoeda(n.totalIBS)} + CBS ${fmtMoeda(n.totalCBS)}`}
                >
                  {fmtMoeda(n.totalTributos)}
                </td>
                <td className="text-right">
                  <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Olho titulo="Ver itens e todos os tributos" onClick={() => abrirNota(n)} />
                    <button
                      type="button"
                      className="rounded-md px-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Visualizar nota (DANFE)"
                      onClick={() => onVerDanfe(n)}
                    >
                      🧾
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      title="Excluir nota e XML"
                      onClick={(e) => {
                        e.stopPropagation()
                        void excluir(n)
                      }}
                    >
                      🗑
                    </button>
                  </span>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {notas.length > ROWS_LIMIT ? (
        <div className="border-t border-slate-100 p-3 text-center text-[11px] text-slate-500 dark:border-slate-800">
          Mostrando {ROWS_LIMIT} de {notas.length} notas · PDF e CSV exportam a lista completa.
        </div>
      ) : null}
    </Painel>
  )
}

const fmtData = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso

/* --------------------------------------------------------------- detalhe --- */

function ModalDetalheNfe({ onVerDanfe }: { onVerDanfe: (n: NotaXml) => void }) {
  const nota = useNfe((s) => s.notaAberta)
  const fecharNota = useNfe((s) => s.fecharNota)
  const reaplicarNota = useNfe((s) => s.reaplicarNota)
  // 👁 Item selecionado — modal compacto com todos os tributos (irmão, nunca aninhado no DOM do detalhe).
  const [itemDetalhe, setItemDetalhe] = useState<ResultadoItemNfe | null>(null)
  const [reaplicando, setReaplicando] = useState(false)

  return (
    <>
    <Modal
      aberto={nota !== null}
      onFechar={() => { setItemDetalhe(null); fecharNota() }}
      titulo={nota ? `Nota ${nota.numero || nota.chave.slice(-8)} · ${ROTULO_DIRECAO[nota.direcao]}` : ''}
      subtitulo={nota ? `${nota.emitNome || nota.emitCnpj} · emissão ${fmtData(nota.dataEmissao)} · ${nota.itensAnalisados.length} item(ns)` : ''}
      largura="max-w-3xl"
      rodape={
        nota ? (
          <span className="flex flex-wrap items-center gap-2">
            <Btn
              tam="sm"
              disabled={reaplicando}
              title="Recalcular os itens desta nota pela classificação vigente (base oficial › manual › regra geral) — use após uma reclassificação manual"
              onClick={async () => {
                if (nota.id == null || reaplicando) return
                setReaplicando(true)
                try {
                  await reaplicarNota(nota.id)
                } finally {
                  setReaplicando(false)
                }
              }}
            >
              {reaplicando ? '↻ Reaplicando…' : '↻ Reaplicar vigentes'}
            </Btn>
            <Btn variante="primary" tam="sm" onClick={() => onVerDanfe(nota)}>
              🧾 Visualizar nota
            </Btn>
            <Btn tam="sm" onClick={fecharNota}>
              Fechar
            </Btn>
          </span>
        ) : undefined
      }
    >
      {nota ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <Info rotulo="Chave" valor={nota.chave} mono />
            <Info rotulo="Série / Modelo" valor={`${nota.serie || '—'} / ${nota.modelo}`} />
            <Info rotulo="Destinatário" valor={nota.destNome || (nota.destDoc ? fmtCnpj(nota.destDoc) : '—')} />
            <Info rotulo="Valor da nota" valor={fmtMoeda(nota.valorTotal)} mono forte />
          </div>
          <BlocoCreditoIbsCbs nota={nota} />
          <ConfrontoCredito nota={nota} />
          <AlertaRegime nota={nota} />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                Itens ({nota.itensAnalisados.length})
              </h4>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700">Botão Tributos abre todos os tributos do item</span>
            </div>
          <div className="max-h-[36vh] overflow-auto rounded-2xl border border-slate-200/80 shadow-sm dark:border-slate-700/60">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Produto</th>
                  <th className="th-r">Qtd</th>
                  <th className="th-r">Valor</th>
                  <th>No XML</th>
                  <th>Sistema</th>
                  <th className="th-r">Total est.</th>
                  <th className="th-r">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {nota.itensAnalisados.map((it, i) => (
                  <LinhaItemNfe
                    key={`${it.codProd}-${i}`}
                    item={it}
                    onDetalhe={() => setItemDetalhe(it)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Colunas <strong>No XML</strong> (tributação destacada pelo emitente) ×{' '}
            <strong>Sistema</strong> (pela legislação: base oficial › manual › regra geral).
            Regime anterior (CST/CSOSN, ICMS, PIS, COFINS) fica no botão Tributos — o detalhe
            também permite salvar o item no cadastro.
          </p>
        </div>
      ) : null}
    </Modal>
    <ModalItemNfeDetalhe item={itemDetalhe} onFechar={() => setItemDetalhe(null)} />
    </>
  )
}

/**
 * Linha do item com as duas tributações lado a lado: **No XML** (o que o
 * emitente destacou no grupo IBSCBS) × **Sistema** (o que diz a legislação:
 * base oficial › manual › regra geral). Divergência ganha o selo `≠ XML`.
 */
function LinhaItemNfe({ item: it, onDetalhe }: { item: ResultadoItemNfe; onDetalhe: () => void }) {
  const credXml = creditoIbsCbsDoItem(it)
  const div = divergenciaXmlSistema(it)
  const manual = it.manual || it.classificacao.manual != null
  return (
    <tr className="cursor-pointer transition-colors hover:bg-brand-50/50" onClick={onDetalhe} title="Ver o confronto completo XML × sistema">
      <td className="font-mono font-bold">{it.codProd}</td>
      <td className="max-w-[220px]" title={`${it.descricao} · NCM ${fmtNcm(it.ncm)} · CFOP ${it.cfop || '—'}`}>
        <span className="block truncate">{it.descricao}</span>
        <span className="block font-mono text-[10px] text-slate-400">
          {fmtNcm(it.ncm)} · CFOP {it.cfop || '—'}
        </span>
      </td>
      <td className="text-right">{fmtNum(it.qtd)}</td>
      <td className="text-right font-mono">{fmtMoeda(it.vlTotal)}</td>
      <td title={div.temXml ? `XML: CST ${it.cstIbsCbs || '—'} · cClassTrib ${it.cClassTribIbsCbs || '—'} · IBS ${fmtMoeda(credXml.vIbs)} + CBS ${fmtMoeda(credXml.vCbs)}` : 'Sem grupo IBSCBS neste item'}>
        {div.temXml ? (
          <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
            {it.cstIbsCbs || '—'} · {it.cClassTribIbsCbs || '—'}
            <span className="block text-[10px] font-normal text-slate-400">
              {credXml.temCredito ? fmtMoeda(credXml.vTotal) : 's/ valores'}
            </span>
          </span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
      <td title={`Sistema: CST ${it.classificacao.cst || '—'} · cClassTrib ${it.classificacao.cClassTrib || '—'}${manual ? ' · Manual do usuário (isenta o sistema)' : it.regraGeral ? ' · Regra geral' : ' · Base oficial'}`}>
        <span className="font-mono text-[11px] font-bold text-brand-700 dark:text-aurum-200">
          {it.classificacao.cst} · {it.classificacao.cClassTrib}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          {manual ? (
            <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" title="Classificação manual do usuário — isenta o sistema">
              ✋
            </span>
          ) : null}
          {div.diverge ? (
            <span className="rounded bg-red-100 px-1 py-0.5 font-mono text-[10px] font-black text-red-700 dark:bg-red-950/50 dark:text-red-300" title="Enquadramento/valores diferentes do XML — abra o detalhe para confrontar">
              ≠ XML
            </span>
          ) : div.temXml ? (
            <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400" title="Confere com o XML">✓</span>
          ) : null}
        </span>
      </td>
      <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
        {fmtMoeda(it.totalTributos)}
      </td>
      <td className="text-right" onClick={(e) => e.stopPropagation()}>
        <Olho onClick={onDetalhe} titulo="Ver o confronto completo XML × sistema" />
      </td>
    </tr>
  )
}

/* ------------------------------------- confronto crédito × Reforma --- */

/**
 * Alerta de regime: quando o emitente é Simples/MEI, a nota **não destaca
 * crédito de IBS/CBS** — aviso âmbar explícito; quando o regime é
 * desconhecido, nota discreta sem afirmar nada.
 */
function AlertaRegime({ nota }: { nota: NotaXml }) {
  const regime = regimeDoEmitente(nota.emitCrt, nota.itensAnalisados)
  if (regime === 'desconhecido') {
    return (
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-400 dark:bg-slate-950/40">
        Regime do emitente não identificado no XML (sem CRT nem CSOSN) — a transferência de
        crédito de IBS/CBS não pôde ser confirmada.
      </p>
    )
  }
  if (transfereCreditoIbsCbs(regime)) return null
  const rotulo = REGIME_LABELS[regime]
  const texto =
    nota.direcao === 'saida'
      ? `Emitente optante do ${rotulo} — esta saída não transfere crédito de IBS/CBS ao cliente.`
      : `Emitente optante do ${rotulo} — esta nota não destaca crédito de IBS/CBS: a entrada não gera crédito apropriável.`
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-white p-3.5 text-xs leading-relaxed dark:border-amber-900 dark:from-amber-950/40 dark:to-slate-900">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-100 text-base dark:bg-amber-950">🏪</span>
      <div>
        <div className="font-bold text-amber-800 dark:text-amber-300">
          Sem crédito de IBS/CBS — {rotulo}
        </div>
        <div className="mt-0.5 text-slate-500 dark:text-slate-400">
          {texto} Os valores de IBS/CBS exibidos são estimativa da Reforma, não crédito.
          Ressalva: optante que recolhe pelo regime regular pode destacar — verifique o CRT.
        </div>
      </div>
    </div>
  )
}

/**
 * **Crédito IBS/CBS destacado no XML**: o crédito da Reforma
 * que a nota efetivamente transfere (grupo `imposto/IBSCBS`, NT 2025.002).
 * Quando o XML não traz o grupo (nota anterior à Reforma), exibe estado
 * "sem destaque" em vez de zero — sem afirmar o que o XML não prova.
 */
function BlocoCreditoIbsCbs({ nota }: { nota: NotaXml }) {
  const cred = creditoIbsCbsDaNota(nota.itensAnalisados, nota)
  const regime = regimeDoEmitente(nota.emitCrt, nota.itensAnalisados)
  const apropriavel = nota.direcao === 'entrada' && transfereCreditoIbsCbs(regime)
  if (!cred.temDestaque) {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-3.5 text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-950/30">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-200 text-base dark:bg-slate-800">💠</span>
        <div>
          <div className="font-bold text-slate-600 dark:text-slate-300">
            Sem destaque de IBS/CBS neste XML
          </div>
          <div className="mt-0.5 text-slate-500 dark:text-slate-400">
            Nenhum item traz valores no grupo <span className="font-mono">imposto/IBSCBS</span> (NT 2025.002) —
            XML anterior à Reforma ou emitente sem preenchimento. A estimativa da Reforma está no bloco ao lado.
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 dark:border-emerald-800 dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-900">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500 text-base text-white shadow-pop">💠</span>
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Crédito IBS / CBS destacado no XML
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {cred.itensComCredito} de {cred.totalItens} item(ns) ·{' '}
            {apropriavel ? 'apropriável nesta entrada' : nota.direcao === 'saida' ? 'destacado nesta saída (débito do emitente)' : 'verifique o regime do emitente'}
          </div>
        </div>
        <span className="ml-auto font-mono text-xl font-black text-emerald-700 dark:text-emerald-300">
          {fmtMoeda(cred.totalDestacado)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="rounded-xl bg-white/80 p-3 shadow-card dark:bg-slate-900/70">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">IBS destacado</div>
          <div className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">{fmtMoeda(cred.ibsDestacado)}</div>
        </div>
        <div className="rounded-xl bg-white/80 p-3 shadow-card dark:bg-slate-900/70">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CBS destacada</div>
          <div className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">{fmtMoeda(cred.cbsDestacado)}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * Identidade visual do crédito por anexo — rótulo e cores da microinteração
 * da borda. Sem redução, a legenda é **Crédito integral de IBS/CBS** com
 * verde cintilante; cada regra tem sua cor (integral = verde, alíquota
 * zero = roxo, redução 60% = âmbar, redução 30% = azul).
 */
const CREDITO_POR_ANEXO: Record<string, { rotulo: string; cor: string; brilho: string }> = {
  isento: { rotulo: 'Crédito integral de IBS/CBS', cor: '#10b981', brilho: '#6ee7b7' },
  '0': { rotulo: 'Alíquota Zero', cor: '#8b5cf6', brilho: '#c4b5fd' },
  '60': { rotulo: 'Redução 60%', cor: '#f59e0b', brilho: '#fcd34d' },
  '30': { rotulo: 'Redução 30%', cor: '#3b82f6', brilho: '#93c5fd' },
}

/** Selo do crédito com ponto na cor do anexo (claro e escuro). */
function PillCreditoAnexo({ anexo }: { anexo: string }) {
  const conf = CREDITO_POR_ANEXO[anexo] ?? CREDITO_POR_ANEXO.isento
  return (
    <span
      className="pill"
      style={{ background: `${conf.cor}1a`, color: conf.cor, border: `1px solid ${conf.cor}66` }}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: conf.cor }} />
      {conf.rotulo}
    </span>
  )
}

/**
 * Faixa de confronto: à esquerda o **crédito IBS/CBS que veio no XML**
 * (destaque da Reforma), no meio o ICMS do regime anterior (auxiliar) e à
 * direita a **tributação que o sistema encontrou** (estimativa por NCM,
 * com borda cintilante na cor do anexo).
 */
function ConfrontoCredito({ nota }: { nota: NotaXml }) {
  const cred = creditoDaNota(nota.itensAnalisados)
  const credReforma = creditoIbsCbsDaNota(nota.itensAnalisados, nota)
  const regime = regimeDoEmitente(nota.emitCrt, nota.itensAnalisados)
  const semTransferencia = !transfereCreditoIbsCbs(regime)
  const anexoEst = nota.itensAnalisados[0]?.anexo ?? 'isento'
  const confEst = CREDITO_POR_ANEXO[anexoEst] ?? CREDITO_POR_ANEXO.isento
  const comXml = nota.itensAnalisados.filter((it) => divergenciaXmlSistema(it).temXml)
  const divergentes = nota.itensAnalisados.filter((it) => divergenciaXmlSistema(it).diverge)
  return (
    <div className="space-y-3">
    {comXml.length ? (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${
        divergentes.length
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
      }`}>
        <span>{divergentes.length ? '⚠' : '✓'}</span>
        <span>
          {divergentes.length
            ? `${divergentes.length} de ${comXml.length} item(ns) com IBS/CBS no XML ${divergentes.length === 1 ? 'diverge' : 'divergem'} do sistema — compare as colunas "No XML" × "Sistema" abaixo.`
            : `Todos os ${comXml.length} item(ns) com IBS/CBS no XML ${comXml.length === 1 ? 'confere' : 'conferem'} com o sistema.`}
        </span>
      </div>
    ) : null}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white p-4 dark:border-emerald-900 dark:from-emerald-950/30 dark:to-slate-900">
        <div className="text-[10px] font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          💠 IBS/CBS no XML
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-lg font-black text-emerald-700 dark:text-emerald-300">
            {fmtMoeda(credReforma.totalDestacado)}
          </span>
          <span className="text-[11px] text-slate-500">destacado</span>
        </div>
        <div className="mt-1.5 text-[11px] text-slate-500">
          {credReforma.temDestaque ? (
            <span>
              IBS {fmtMoeda(credReforma.ibsDestacado)} + CBS {fmtMoeda(credReforma.cbsDestacado)} ·{' '}
              <strong>{credReforma.itensComCredito}</strong> de {credReforma.totalItens} item(ns)
            </span>
          ) : (
            <span>Sem grupo IBSCBS — XML anterior à Reforma.</span>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/80 to-white p-4 dark:border-slate-700 dark:from-slate-950/40 dark:to-slate-900">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          📥 Regime anterior (auxiliar)
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-lg font-black text-slate-600 dark:text-slate-300">
            {fmtMoeda(cred.icmsDestacado)}
          </span>
          <span className="text-[11px] text-slate-500">ICMS destacado</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          {cred.itensComCredito ? (
            <>
              <span>
                <strong>{cred.itensComCredito}</strong> de {cred.totalItens} item(ns)
              </span>
              {cred.fontes.map((f) => (
                <Pill key={f} cor="slate">✓ {f}</Pill>
              ))}
            </>
          ) : (
            <span>Sem CST de crédito nem ICMS destacado.</span>
          )}
        </div>
      </div>
      <div
        className="borda-cintilante rounded-2xl bg-gradient-to-br from-brand-50/80 to-white p-4 dark:from-brand-950/30 dark:to-slate-900"
        style={{ '--cor-borda': confEst.cor, '--cor-brilho': confEst.brilho } as CSSProperties}
      >
        <div className="text-[10px] font-black uppercase tracking-wide text-brand-600 dark:text-aurum-200">
          🧮 Estimativa do sistema
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-lg font-black text-brand-700 dark:text-brand-300">
            {fmtMoeda(nota.totalTributos)}
          </span>
          <span className="text-[11px] text-slate-500">
            IBS {fmtMoeda(nota.totalIBS)} + CBS {fmtMoeda(nota.totalCBS)}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <PillCreditoAnexo anexo={anexoEst} />
          <span>refs {nota.refIBS}% / {nota.refCBS}%</span>
          {semTransferencia ? (
            <span className="font-bold text-amber-600 dark:text-amber-400">
              · ⛔ sem transferência de crédito
            </span>
          ) : null}
        </div>
      </div>
    </div>
    </div>
  )
}

function Info({ rotulo, valor, mono, forte }: { rotulo: string; valor: string; mono?: boolean; forte?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className={`mt-0.5 break-words text-xs ${mono ? 'font-mono' : ''} ${forte ? 'font-black' : 'font-semibold'}`}>
        {valor}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- gráficos --- */

const TOOLTIP_ESCURO_NFE = {
  backgroundColor: 'rgba(15, 23, 42, 0.94)',
  titleFont: { size: 11, weight: 'bold' as const },
  bodyFont: { size: 11 },
  padding: 10,
  cornerRadius: 10,
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  boxPadding: 3,
}

const fmtCompactoNfe = (v: number): string =>
  v >= 1000000
    ? `R$ ${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : v >= 1000
      ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
      : fmtMoeda(v)

/**
 * Gráficos elegantes do módulo XML: rosca entradas × saídas (valor),
 * evolução mensal de IBS+CBS (linha) e top fornecedores por crédito (barras).
 */
function GraficosNfe({ notas }: { notas: NotaXml[] }) {
  const ranking = useNfe((s) => s.ranking)
  const dados = useMemo(() => {
    let baseEntradas = 0
    let baseSaidas = 0
    const porMes = new Map<string, number>()
    for (const n of notas) {
      if (n.direcao === 'entrada') baseEntradas += Number(n.valorTotal) || 0
      else if (n.direcao === 'saida') baseSaidas += Number(n.valorTotal) || 0
      const mes = n.dataEmissao.slice(0, 7)
      if (/^\d{4}-\d{2}$/.test(mes)) {
        porMes.set(mes, (porMes.get(mes) ?? 0) + (Number(n.totalTributos) || 0))
      }
    }
    const meses = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-6)
    const top = [...ranking].slice(0, 6)
    return { baseEntradas, baseSaidas, meses, top }
  }, [notas, ranking])

  if (!notas.length) return null
  const totalBases = dados.baseEntradas + dados.baseSaidas

  return (
    <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-3">
      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="rosca" tom="brand" />
            Entradas × Saídas
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Base (valor das notas) no filtro</p>
        </div>
        <div className="relative h-64 p-4">
          {totalBases > 0 ? (
            <>
              <Doughnut
                data={{
                  labels: ['Entradas', 'Saídas'],
                  datasets: [{
                    data: [dados.baseEntradas, dados.baseSaidas],
                    backgroundColor: ['#3b82f6', '#10b981'],
                    hoverOffset: 10,
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    spacing: 2,
                    borderRadius: 6,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '68%',
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        font: { size: 10, weight: 'bold' as const },
                        boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true,
                        padding: 12, color: '#64748b',
                      },
                    },
                    tooltip: {
                      ...TOOLTIP_ESCURO_NFE,
                      callbacks: {
                        label: (ctx) => {
                          const v = Number(ctx.raw) || 0
                          const pct = totalBases > 0 ? ((v / totalBases) * 100).toFixed(1).replace('.', ',') : '0,0'
                          return ` ${fmtMoeda(v)} (${pct}%)`
                        },
                      },
                    },
                  },
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[calc(100%-52px)] flex-col items-center justify-center">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Base total</span>
                <span className="text-lg font-black text-slate-800 dark:text-slate-100">{fmtCompactoNfe(totalBases)}</span>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem valores no filtro.</div>
          )}
        </div>
      </Painel>

      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-emerald-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="grafico" tom="emerald" />
            IBS + CBS por mês
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Estimativa (últimos 6 meses do filtro)</p>
        </div>
        <div className="h-64 p-4">
          {dados.meses.length ? (
            <Line
              data={{
                labels: dados.meses.map(([m]) => `${m.slice(5, 7)}/${m.slice(2, 4)}`),
                datasets: [{
                  label: 'IBS + CBS',
                  data: dados.meses.map(([, v]) => v),
                  borderColor: '#3a5dff',
                  backgroundColor: 'rgba(58, 93, 255, 0.15)',
                  fill: true,
                  tension: 0.4,
                  pointBackgroundColor: '#3a5dff',
                  pointBorderColor: '#ffffff',
                  pointBorderWidth: 2,
                  pointRadius: 4,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}` } },
                },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                  y: {
                    ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoNfe(Number(v)) },
                    grid: { color: 'rgba(148, 163, 184, 0.14)' },
                    border: { display: false },
                  },
                },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem movimento mensal.</div>
          )}
        </div>
      </Painel>

      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="trofeu" tom="amber" />
            Crédito por fornecedor
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top 6 · IBS + CBS estimados</p>
        </div>
        <div className="h-64 p-4">
          {dados.top.length ? (
            <Bar
              data={{
                labels: dados.top.map((r) => (r.nome.length > 14 ? `${r.nome.slice(0, 14)}…` : r.nome)),
                datasets: [{
                  label: 'Crédito (R$)',
                  data: dados.top.map((r) => r.creditoTotal),
                  backgroundColor: ['#3a5dff', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#94a3b8'],
                  borderRadius: 7,
                  borderSkipped: false,
                  maxBarThickness: 22,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...TOOLTIP_ESCURO_NFE,
                    callbacks: {
                      label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}`,
                      afterLabel: (ctx) => {
                        const r = dados.top[ctx.dataIndex]
                        return r ? ` ${r.qtdNotas} nota(s) · ${fmtCnpj(r.cnpj)}` : ''
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 4, callback: (v) => fmtCompactoNfe(Number(v)) },
                    grid: { color: 'rgba(148, 163, 184, 0.14)' },
                    border: { display: false },
                  },
                  y: { ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' }, grid: { display: false }, border: { display: false } },
                },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem fornecedores no período.</div>
          )}
        </div>
      </Painel>
    </div>
  )
}

/* -------------------------------------------------- DANFE (visualização) --- */

const formatarChave = (chave: string): string => (chave || '').replace(/(\d{4})(?=\d)/g, '$1 ')

/**
 * Visualização da nota fiscal no padrão DANFE (Documento Auxiliar da NF-e):
 * cabeçalho com emitente + quadro da NF-e, chave de acesso, destinatário,
 * itens (código, descrição, NCM, CFOP, qtd, valores, IBS/CBS destacados e
 * estimados) e totais. Somente leitura, a partir dos dados do XML importado.
 */
function DanfeModal({ nota, onFechar }: { nota: NotaXml; onFechar: () => void }) {
  const credReforma = creditoIbsCbsDaNota(nota.itensAnalisados, nota)
  const regime = regimeDoEmitente(nota.emitCrt, nota.itensAnalisados)
  // 👁 Tributos do regime anterior por item ficam no modal compacto.
  const [itemDetalhe, setItemDetalhe] = useState<ResultadoItemNfe | null>(null)
  // Totais do regime anterior destacados nos itens (ICMS/PIS/COFINS): somados
  // aqui porque o XML nem sempre traz o grupo `ICMSTot` completo nos arquivos
  // importados — a visão completa não depende do totalizador.
  const totaisAnteriores = useMemo(() => {
    let icms = 0
    let pis = 0
    let cofins = 0
    for (const it of nota.itensAnalisados) {
      icms += Number(it.vlIcms) || 0
      pis += Number(it.vPis) || 0
      cofins += Number(it.vCofins) || 0
    }
    return { icms, pis, cofins, pisCofins: pis + cofins }
  }, [nota])
  return (
    <>
    <Modal
      aberto
      onFechar={() => { setItemDetalhe(null); onFechar() }}
      titulo={`DANFE · NF-e ${nota.numero || '—'} · Série ${nota.serie || '—'}`}
      subtitulo={`${nota.emitNome || nota.emitCnpj} · emissão ${fmtData(nota.dataEmissao)}`}
      largura="max-w-4xl"
      rodape={
        <span className="flex gap-2">
          <Btn tam="sm" onClick={() => window.print()}>Imprimir DANFE</Btn>
          <Btn variante="primary" tam="sm" onClick={onFechar}>Fechar</Btn>
        </span>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-card">
        {/* Faixa superior elegante */}
        <div className="h-1.5 bg-gradient-to-r from-brand-600 via-brand-400 to-emerald-400" />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px]">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-lg font-black text-white shadow-pop">
                {(nota.emitNome || 'E').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-base font-black uppercase tracking-tight">{nota.emitNome || 'Emitente'}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                  CNPJ {fmtCnpj(nota.emitCnpj)}
                  {nota.emitIe ? ` · IE ${nota.emitIe}` : ''}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              {[nota.emitEndereco, nota.emitCidade && nota.emitUf ? `${nota.emitCidade}/${nota.emitUf}` : nota.emitCidade || nota.emitUf].filter(Boolean).join(' · ') || 'Endereço não informado no XML'}
              <br />
              <span className="text-slate-500">
                {nota.natOp ? `Natureza: ${nota.natOp} · ` : ''}Modelo {nota.modelo || '55'}
                {regime !== 'desconhecido' ? ` · ${REGIME_LABELS[regime]}` : ''}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-1.5 border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white p-5 text-center md:border-l md:border-t-0">
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${nota.direcao === 'entrada' ? 'bg-brand-100 text-brand-700' : nota.direcao === 'saida' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {nota.direcao === 'entrada' ? 'Entrada' : nota.direcao === 'saida' ? 'Saída' : 'Quarentena'}
            </span>
            <div className="text-2xl font-black tracking-tight">DANFE</div>
            <div className="text-[10px] leading-tight text-slate-500">
              Documento Auxiliar da<br />Nota Fiscal Eletrônica
            </div>
            <div className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="font-mono text-sm font-black">Nº {nota.numero || '—'}</div>
              <div className="font-mono text-[11px] text-slate-500">Série {nota.serie || '—'} · {fmtData(nota.dataEmissao)}</div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Chave de acesso</div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(nota.chave).then(
                  () => toast('Chave de acesso copiada.', 'ok'),
                  () => toast('Não foi possível copiar a chave.', 'warn'),
                )
              }}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 shadow-sm transition hover:border-brand-400 hover:text-brand-700"
              title="Copiar chave de acesso"
            >
              Copiar chave
            </button>
          </div>
          <div className="mt-1.5 break-all font-mono text-[13px] font-bold tracking-wide text-slate-800">{formatarChave(nota.chave)}</div>
          <div className="mt-2 flex h-9 items-stretch gap-[2px] overflow-hidden rounded-md" aria-hidden>
            {nota.chave.split('').map((d, i) => (
              <span key={i} className="bg-slate-900/90" style={{ width: `${1 + ((Number(d) || 0) % 3)}px` }} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-5 py-4 text-[11px] md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Destinatário</div>
            <div className="mt-1.5 text-[13px] font-bold">{nota.destNome || '—'}</div>
            <div className="mt-0.5 text-slate-500">
              {nota.destDoc ? `CNPJ/CPF ${fmtCnpj(nota.destDoc)}` : 'Documento não informado'}
              {nota.destIe ? ` · IE ${nota.destIe}` : ''}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fatura / valores</div>
            <div className="mt-1.5 space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Produtos</span><strong className="font-mono">{fmtMoeda(nota.valorProdutos || nota.valorTotal)}</strong></div>
              <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 text-[13px]"><span className="font-bold">Total da nota</span><strong className="font-mono">{fmtMoeda(nota.valorTotal)}</strong></div>
              <div className="flex justify-between text-slate-500"><span>ICMS destacado</span><strong className="font-mono">{fmtMoeda(totaisAnteriores.icms)}</strong></div>
              <div className="flex justify-between text-slate-500">
                <span>PIS + COFINS</span>
                <strong className="font-mono">{fmtMoeda(totaisAnteriores.pisCofins)}</strong>
              </div>
              <div className="flex justify-between rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700"><span className="font-bold">IBS/CBS destacados</span><strong className="font-mono">{fmtMoeda(credReforma.totalDestacado)}</strong></div>
              <div className="flex justify-between px-2 text-slate-400"><span>IBS/CBS estimados</span><strong className="font-mono">{fmtMoeda(nota.totalTributos)}</strong></div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Produtos / serviços ({nota.itensAnalisados.length})</span>
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700">Botão Tributos abre ICMS · PIS · COFINS</span>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 shadow-sm">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-slate-900 text-left text-[10px] uppercase tracking-wider text-white">
                  <th className="px-3 py-2.5 font-extrabold">Item</th>
                  <th className="px-3 py-2.5 font-extrabold">Descrição</th>
                  <th className="px-3 py-2.5 text-right font-extrabold">Qtd</th>
                  <th className="px-3 py-2.5 text-right font-extrabold">V. total</th>
                  <th className="px-3 py-2.5 text-right font-extrabold">XML · IBS + CBS</th>
                  <th className="px-3 py-2.5 text-right font-extrabold">Sistema · est.</th>
                  <th className="px-3 py-2.5 text-right font-extrabold">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nota.itensAnalisados.map((it, i) => {
                  const c = creditoIbsCbsDoItem(it)
                  const ibsCbs = (Number(c.vIbs) || 0) + (Number(c.vCbs) || 0)
                  return (
                    <tr
                      key={`${it.codProd}-${i}`}
                      className={`cursor-pointer transition-colors hover:bg-brand-50/60 ${i % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}`}
                      onClick={() => setItemDetalhe(it)}
                      title="Ver ICMS · PIS · COFINS e demais tributos"
                    >
                      <td className="px-3 py-2.5"><span className="grid h-6 w-6 place-items-center rounded-lg bg-slate-100 font-mono text-[10px] font-black text-slate-600">{it.numItem || String(i + 1)}</span></td>
                      <td className="max-w-[280px] px-3 py-2.5">
                        <span className="block truncate font-semibold text-slate-800" title={it.descricao}>{it.descricao}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                          {it.codProd} · {fmtNcm(it.ncm)} · CFOP {it.cfop}
                          {it.cstIbsCbs ? ` · CST ${it.cstIbsCbs}` : ''}
                          {it.cClassTribIbsCbs ? ` · ${it.cClassTribIbsCbs}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{fmtNum(it.qtd)} {it.unid}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold">{fmtMoeda(it.vlTotal)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-emerald-700" title={it.cstIbsCbs || it.cClassTribIbsCbs ? `XML: CST ${it.cstIbsCbs || '—'} · ${it.cClassTribIbsCbs || '—'}` : 'Sem grupo IBSCBS neste item'}>{ibsCbs > 0 ? fmtMoeda(ibsCbs) : <span className="text-slate-300">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-brand-700" title={`Sistema: CST ${it.classificacao.cst} · ${it.classificacao.cClassTrib}${it.manual || it.classificacao.manual ? ' · manual' : ''}`}>{fmtMoeda(it.totalTributos)}</td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <Olho onClick={() => setItemDetalhe(it)} titulo="Ver ICMS · PIS · COFINS e demais tributos" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td className="px-3 py-2.5" colSpan={3}>Total destacado / estimado</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono">{fmtMoeda(nota.valorTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-emerald-700">{fmtMoeda(credReforma.totalDestacado)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-brand-700">{fmtMoeda(nota.totalTributos)}</td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3.5 text-[10px] leading-relaxed text-slate-500">
          Visualização gerada a partir do XML importado (LC 214/2025 · NT 2025.002) para conferência — o documento
          fiscal válido é o XML da chave acima. Estimativa do sistema:
          IBS {fmtMoeda(nota.totalIBS)} + CBS {fmtMoeda(nota.totalCBS)} (refs {nota.refIBS}% / {nota.refCBS}%).
          ICMS {fmtMoeda(totaisAnteriores.icms)} · PIS + COFINS {fmtMoeda(totaisAnteriores.pisCofins)} no botão Tributos de cada item.
        </div>
      </div>
    </Modal>
    <ModalItemNfeDetalhe item={itemDetalhe} onFechar={() => setItemDetalhe(null)} />
    </>
  )
}
