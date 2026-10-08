/**
 * Tela **Notas Fiscais (XML)** — importação de NF-e/NFC-e vinculada à empresa
 * ativa, calendário histórico, filtros, ranking de fornecedores por crédito e
 * simulação da Reforma por produto.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BarraAnimada, Entrada, Expansivel, Item, Lista, Secao } from '@/ui/motion'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { rotuloAnexoOficial } from '@/domain/constants/tributarios'
import { fmtCarga, fmtCnpj, fmtMoeda, fmtNcm, fmtNum } from '@/domain/services/format'
import { totaisNotas } from '@/application/notas-xml'
import {
  confrontoRegimes,
  distribuicaoPorAnexo,
  evolucaoMensal,
  indicadoresXml,
  resumoDivergencias,
  topCfop,
  topCstReforma,
  topNcm,
} from '@/application/nfe-insights'
import { apurarIbsCbs, type ApuracaoIbsCbs } from '@/infrastructure/nfe/apuracao'
import { exportarNfeCSV, exportarNfePDF } from '@/infrastructure/exporters/relatorios'
import { ModalRelatorioNfe, type EscolhaRelatorio } from './ModalRelatorioNfe'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import { creditoDaNota, creditoIbsCbsDaNota, creditoIbsCbsDoItem, divergenciaXmlSistema } from '@/infrastructure/nfe/credito'
import { REGIME_LABELS, regimeDoEmitente, transfereCreditoIbsCbs } from '@/infrastructure/nfe/regime'
import type { DirecaoNota, FiltrosNfe, NotaXml, ResultadoItemNfe } from '@/infrastructure/nfe/tipos'
import { useSessao } from '@/store/sessao'
import { useNfe } from '@/store/nfe'
import { BannerContribuintesNovos } from './NfePendentes'
import { BlocoNaturezas } from './NfeNatureza'
import { ModalItemNfeDetalhe, Olho } from '@/ui/detalhes'
import { SeloST, SeloSTNota } from '@/ui/cest'
import { toast, useUi } from '@/store/ui'
import { CalendarioAnualModal } from './NfeCalendarioAnual'
import { CartaoStat } from '@/ui/cartoes'
import { Btn, IconeBadge, Modal, Painel, Pill, Texto, useAcaoTatil } from '@/ui/kit'
import { EscudoAurum } from '@/ui/Marca'

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend)

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
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-6">
      <Entrada>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-600 dark:text-aurum-200">
              Notas fiscais · XML
            </p>
            <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">
              Importação e análise da Reforma
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Importe os XMLs, acompanhe a apuração de IBS/CBS e explore fornecedores,
              produtos e notas — tudo vinculado à empresa ativa.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill cor="brand">LC 214/2025 · IBS + CBS</Pill>
            <button
              type="button"
              title="Experimentar o redesenho polido (tabs + hero executivo)"
              onClick={() => {
                try {
                  localStorage.setItem('xml-layout', 'polida')
                } catch { /* sem armazenamento — mantém clássica */ }
                window.location.reload()
              }}
              className="xml-focus-ouro pill bg-brand-700 text-white dark:bg-aurum-500/20 dark:text-aurum-200"
            >
              ✨ Prévia polida
            </button>
          </div>
        </div>
      </Entrada>
      <Entrada atraso={0.06}>
        <PainelImportacao />
      </Entrada>
      <ResumoImportacao />
      <BannerXml />
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
    <Painel className="overflow-hidden">
      <div className="border-b border-[var(--line)] bg-gradient-to-r from-brand-50/80 to-white px-5 py-4 dark:from-brand-950/30 dark:to-slate-900">
        <h2 className="flex items-center gap-2.5 text-base font-bold">
          <IconeBadge nome="nota" tom="brand" /> Importar XML (NF-e / NFC-e)
        </h2>
        <p className="mt-1 pl-11 text-xs text-slate-500 dark:text-slate-400">
          Os arquivos são guardados no computador e as notas ficam vinculadas à empresa ativa.
          Chaves já importadas são ignoradas sem duplicar.
        </p>
      </div>
      <div className="space-y-4 p-5">
        <motion.div
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
          animate={sobre ? { scale: 1.01 } : { scale: 1 }}
          whileTap={processando ? undefined : { scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors ${
            sobre
              ? 'border-brand-500 bg-brand-50/70 shadow-card'
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
          <motion.div
            className="mx-auto grid place-items-center"
            animate={sobre ? { scale: 1.15, y: -2 } : { scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            <IconeBadge nome="nota" tom="brand" tamanho="lg" />
          </motion.div>
          <p className="mt-3 text-sm font-semibold">
            Arraste os XMLs <span className="text-brand-600 dark:text-aurum-200">ou clique para escolher</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Aceita vários arquivos .xml de uma vez (NF-e mod. 55 e NFC-e mod. 65)
          </p>
        </motion.div>

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
  const aplicar = (t: string) => {
    setTexto(t)
    setRef(tributo, Number(t.replace(',', '.')) || 0)
  }

  return (
    <div className="calc-kpi min-w-32 flex-1 sm:max-w-44">
      <span className="field-label">{tributo} ref. (%)</span>
      <div className="flex items-baseline gap-1">
        <input
          type="number"
          step="0.01"
          min={0}
          max={100}
          value={texto}
          onChange={(e) => aplicar(e.target.value.replace(/[^\d.,]/g, ''))}
          aria-label={`Alíquota de referência ${tributo}`}
          className="w-full bg-transparent p-0 font-mono text-xl font-black outline-none"
        />
        <span className="font-mono text-xs font-bold text-slate-400">%</span>
      </div>
      <input
        type="range"
        min={0}
        max={30}
        step={0.05}
        value={Math.min(30, Number(texto.replace(',', '.')) || 0)}
        onChange={(e) => aplicar(e.target.value)}
        className="calc-range"
        aria-label={`Ajuste fino ${tributo}`}
      />
    </div>
  )
}

function BannerXml() {
  return <BannerContribuintesNovos />
}

function ResumoImportacao() {
  const resumo = useNfe((s) => s.ultimoResumo)
  return (
    <AnimatePresence initial={false}>
      {resumo ? (
        <motion.div
          key={`${resumo.novas}-${resumo.duplicadas}-${resumo.quarentena}-${resumo.erros.length}`}
          initial={{ opacity: 0, y: -10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.3, ease: [0.22, 0.9, 0.3, 1] }}
          className={`rounded-2xl border p-4 text-xs leading-relaxed ${
            resumo.erros.length
              ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30'
              : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
          }`}
        >
      <div className="font-bold">
        📥 {resumo.novas} nota(s) importada(s)
        {resumo.duplicadas ? ` · ${resumo.duplicadas} duplicada(s) ignorada(s)` : ''}
        {(resumo.redirecionadas ?? 0) > 0 ? ` · ${resumo.redirecionadas} em outro cadastro` : ''}
        {(resumo.orfas ?? 0) > 0 ? ` · ${resumo.orfas} de contribuinte novo` : ''}
        {(resumo.orfas ?? 0) === 0 && resumo.quarentena ? ` · ${resumo.quarentena} em quarentena` : ''}
      </div>
      {(resumo.pendentesCadastro?.length ?? 0) > 0 ? (
        <div className="mt-1 text-amber-700 dark:text-amber-300">
          ⚠ Contribuinte novo: {resumo.pendentesCadastro!.slice(0, 3).map((p) => p.cnpj).join(', ')}
          {resumo.pendentesCadastro!.length > 3 ? ` +${resumo.pendentesCadastro!.length - 3}` : ''} — cadastre no banner abaixo.
        </div>
      ) : null}
      {resumo.erros.length ? (
        <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
          {resumo.erros.map((e, i) => (
            <li key={`${e.arquivo}-${i}`} className="break-words">
              ❌ <strong>{e.arquivo}</strong>: {e.motivo}
            </li>
          ))}
        </ul>
      ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
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
          <div className="relative mx-auto grid h-20 w-20 place-items-center">
            <span className="absolute inset-0 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600 dark:border-slate-700 dark:border-t-aurum-300" />
            <EscudoAurum tamanho={52} />
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
  // Modal "Gerar relatório" (no início da seção) + trava do botão Gerar PDF.
  const [modalRelatorio, setModalRelatorio] = useState(false)
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false)
  // Giro nos botões de ação (reaplicar/vincular percorrem as notas filtradas).
  const acaoReaplicar = useAcaoTatil(reaplicarVigentes)
  const acaoVincular = useAcaoTatil(vincularProdutos)
  const filtrosTela = useNfe((s) => s.filtros)

  const fecharFornecedor = () => {
    setFiltros({ fornecedor: '', direcao: 'todas' })
    setFornecedorAberto(null)
  }

  // Entrada no módulo (ou troca de empresa): o conteúdo só é entregue
  // quando os dados estão prontos — o modal glass bloqueia até lá e o
  // esqueleto fica como fundo na primeira carga.
  const primeiraCarga = carregandoHistorico && !notas.length

  return (
    <div className="relative space-y-6" aria-busy={carregandoHistorico}>
      <ModalCarregamentoNotas visivel={carregandoHistorico} primeiraCarga={primeiraCarga} />
      {primeiraCarga ? (
        <EsqueletoHistorico />
      ) : (
      <div className={`xml-stack xml-stack--harmonica ${carregandoHistorico ? 'pointer-events-none select-none opacity-60 saturate-50' : ''}`}>
      <Lista className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6" intervalo={0.05}>
        <Item><CartaoStat rotulo="Notas" valor={tot.qtd} /></Item>
        <Item><CartaoStat rotulo="Entradas" valor={tot.entradas} /></Item>
        <Item><CartaoStat rotulo="Saídas" valor={tot.saidas} /></Item>
        <Item><CartaoStat rotulo="Base total" valor={fmtMoeda(tot.base)} /></Item>
        <Item><CartaoStat rotulo="IBS + CBS" valor={fmtMoeda(tot.trib)} cor="text-brand-700 dark:text-aurum-200" /></Item>
        <Item><CartaoStat rotulo="Carga média" valor={fmtCarga(tot.carga)} /></Item>
      </Lista>

      <Painel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="nota" tom="brand" tamanho="sm" />
            Relatório das notas
          </h3>
          <p className="mt-1 pl-8 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Monte o PDF sob medida: produtos, lojas que geram crédito, Simples,
            período, compras/vendas e conta final.
          </p>
        </div>
        <Btn variante="primary" className="shrink-0" onClick={() => setModalRelatorio(true)}>
          📕 Gerar relatório
        </Btn>
      </Painel>

      <Secao id="xml-filtros">
        <Filtros />
      </Secao>
      <Secao id="xml-notas">
        <TabelaNotas notas={notas} onVerDanfe={setDanfeNota} />
      </Secao>

      <Secao>
        <ApuracaoReforma apuracao={apuracao} inicio={filtrosTela.inicio} fim={filtrosTela.fim} />
      </Secao>

      <Secao>
        <BlocoNaturezas notas={notas} />
      </Secao>

      <Secao>
        <GraficosNfe notas={notas} />
      </Secao>

      <Secao>
        <IndicadoresXml notas={notas} />
      </Secao>

      <Secao>
        <ComparativoMensal notas={notas} />
      </Secao>

      <Secao>
        <RegimeAntigoVsNovo notas={notas} />
      </Secao>

      <Secao>
        <DistribuicaoReforma notas={notas} />
      </Secao>

      {notas.length ? (
        <Secao>
        <Painel className="overflow-hidden p-0">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <IconeBadge nome="caixa" tom="brand" />
                Cadastro de produtos
              </h3>
              <p className="mt-1 pl-9 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Vincula os itens das <strong>{notas.length} nota(s) filtrada(s)</strong> ao cadastro (NCM, CFOP,
                CST ICMS, PIS e COFINS), cria os que faltam e atualiza preço/quantidade.
                Exporte antes se quiser conferir a lista.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Btn onClick={() => setModalRelatorio(true)}>📕 PDF</Btn>
              <Btn onClick={() => exportarCsv(notas)}>📊 CSV</Btn>
              <Btn
                title="Recalcular as notas filtradas pela classificação vigente (base oficial › manual › regra geral) — use após uma reclassificação manual"
                carregando={acaoReaplicar.carregando}
                onClick={acaoReaplicar.executar}
              >
                {acaoReaplicar.carregando ? 'Reaplicando…' : '↻ Reaplicar vigentes'}
              </Btn>
              <Btn
                variante="primary"
                carregando={acaoVincular.carregando}
                onClick={acaoVincular.executar}
              >
                {acaoVincular.carregando ? 'Vinculando…' : '📦 Vincular produtos ao cadastro'}
              </Btn>
            </div>
          </div>
        </Painel>
        </Secao>
      ) : null}

      <Secao>
      <div className="grid grid-cols-1 gap-4 lg:h-[340px] lg:grid-cols-3 lg:items-stretch">
        <Calendario />
        <div className="lg:col-span-2 lg:min-h-0">
          <RankingFornecedores selecionado={fornecedorAberto} onSelecionar={setFornecedorAberto} />
        </div>
      </div>
      </Secao>

      <Secao>
        <TopProdutosNfe notas={notas} />
      </Secao>

      <Secao>
        <TopNcmCfop notas={notas} />
      </Secao>

      <Secao>
        <QualidadeXml notas={notas} />
      </Secao>

      {fornecedorAberto ? (
        <NotasFornecedor cnpj={fornecedorAberto} onFechar={fecharFornecedor} onVerDanfe={setDanfeNota} />
      ) : null}

      <ModalDetalheNfe onVerDanfe={setDanfeNota} />
      {danfeNota ? <DanfeModal nota={danfeNota} onFechar={() => setDanfeNota(null)} /> : null}
      <ModalRelatorioNfe
        aberto={modalRelatorio}
        onFechar={() => {
          if (!gerandoRelatorio) setModalRelatorio(false)
        }}
        onGerar={(escolha) => void exportarPdf(notas, escolha)}
        gerando={gerandoRelatorio}
        notas={notas}
        inicioPadrao={filtrosTela.inicio}
        fimPadrao={filtrosTela.fim}
      />
      </div>
      )}
    </div>
  )

  async function exportarPdf(lista: NotaXml[], escolha?: EscolhaRelatorio) {
    try {
      if (!lista.length) {
        toast('Nenhuma nota no filtro para gerar o relatório.', 'warn')
        return
      }
      // Recorte do modal (período + movimento) aplicado sobre a lista da tela.
      const recorte = escolha
        ? lista.filter((n) => {
            if (escolha.inicio && n.dataEmissao < escolha.inicio) return false
            if (escolha.fim && n.dataEmissao > escolha.fim) return false
            if (escolha.opcoes.direcao !== 'todas' && n.direcao !== escolha.opcoes.direcao) return false
            return true
          })
        : lista
      if (!recorte.length) {
        toast('Nenhuma nota entra neste recorte — ajuste o período ou as notas.', 'warn')
        return
      }
      const st = useNfe.getState()
      if (escolha) setGerandoRelatorio(true)
      else toast('Conferindo suas notas na lei de hoje…', 'warn')
      const { prepararRelatorioNfeComIA } = await import('@/application/nfe-relatorio-ia')
      const pacote = await prepararRelatorioNfeComIA(recorte, st.ranking)
      const { carregarEmitente } = await import('@/application/emitente')
      const salvo = await carregarEmitente().catch(() => null)
      const emitente = salvo ?? useSessao.getState().emitente ?? EMITENTE_PADRAO
      const periodo = escolha
        ? `${escolha.inicio || '…'} a ${escolha.fim || '…'}`
        : st.filtros.inicio || st.filtros.fim
          ? `${st.filtros.inicio || '…'} a ${st.filtros.fim || '…'}`
          : `${MESES[st.mesMes - 1]}/${st.mesAno}`
      await exportarNfePDF({
        notas: pacote.notas,
        ranking: pacote.rankingEfetivo,
        emitente,
        empresaNome: useSessao.getState().ativa?.razaoSocial ?? '—',
        periodo,
        verificacao: pacote.verificacao,
        insights: pacote.insights,
        confronto: pacote.confronto,
        duplicadasIgnoradas: pacote.duplicadasIgnoradas,
        opcoes: escolha?.opcoes,
      })
      if (escolha) setModalRelatorio(false)
      toast('PDF pronto — notas conferidas na lei de hoje.', 'ok')
    } catch (e) {
      toast(`Erro ao gerar PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setGerandoRelatorio(false)
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
 * Apuração **assistida** IBS/CBS no padrão do portal da Reforma: débitos das
 * saídas menos **créditos efetivos — os que vieram destacados na nota do
 * fornecedor** — por tributo e no total, com o veredito.
 *
 * A estimativa **via NCM** ("Análise pelo NCM — Pela reforma") é
 * **informativa**: não abate o saldo. O bloco mostra a diferença (nota − NCM)
 * e o cliente decide o que fazer.
 *
 * Calculada sobre as notas filtradas em tela: filtrar uma data específica
 * apura os créditos/débitos IBS e CBS daquela data (apuração assistida).
 */
function ApuracaoReforma({ apuracao: a, inicio, fim }: { apuracao: ApuracaoIbsCbs; inicio: string; fim: string }) {
  const temMovimento = a.resultado !== 'sem-movimento'
  const cobertura = a.debitoEfetivoTotal > 0 ? Math.min(100, (a.creditoEfetivoTotal / a.debitoEfetivoTotal) * 100) : 0
  const divergencia = a.divergenciaCreditoTotal
  const divergenciaDebito = a.divergenciaDebitoTotal
  // Sem destaque nas saídas (XML anterior à Reforma): débito comprovado zero.
  const semDestaqueSaidas = temMovimento && a.qtdSaidas > 0 && a.debitoEfetivoTotal <= 0.005 && a.debitoInformativoTotal > 0.005
  const vereditoTom =
    a.resultado === 'a-pagar' ? 'red' : a.resultado === 'saldo-credor' ? 'emerald' : 'slate'
  return (
    <Painel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-gradient-to-r from-brand-50/80 to-white px-5 py-4 dark:from-brand-950/30 dark:to-slate-900">
        <IconeBadge nome="calculadora" tom="brand" tamanho="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black tracking-tight">
            Apuração assistida IBS / CBS
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Débitos das vendas que você emitiu − créditos das notas que você recebeu · {a.qtdSaidas} saída(s) e{' '}
            {a.qtdEntradasApropriaveis + a.qtdEntradasBloqueadas + a.qtdEntradasNaoConfirmadas} entrada(s) no filtro
            {' · '}
            <strong className="text-slate-600 dark:text-slate-300">{rotuloPeriodoApuracao(inicio, fim)}</strong>
          </p>
        </div>
        <span className={`pill ${vereditoTom === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : vereditoTom === 'emerald' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
          {a.resultado === 'a-pagar' ? 'A PAGAR' : a.resultado === 'saldo-credor' ? 'SALDO CREDOR' : a.resultado === 'zerado' ? 'ZERADO' : 'SEM MOVIMENTO'}
        </span>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="calc-kpi border-l-4 !border-l-red-400">
            <div className="text-[10px] font-bold uppercase text-slate-500">Débitos · você destacou nas saídas</div>
            <div className="font-mono text-lg font-black">{fmtMoeda(a.debitoEfetivoTotal)}</div>
            <div className="font-mono text-[10px] text-slate-400">IBS {fmtMoeda(a.debitoEfetivoIBS)} + CBS {fmtMoeda(a.debitoEfetivoCBS)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{a.qtdSaidas} venda(s) que você emitiu · base {fmtMoeda(a.baseSaidasEfetiva)} · esperado {fmtMoeda(a.debitoInformativoTotal)}</div>
          </div>
          <div className="calc-kpi border-l-4 !border-l-emerald-500">
            <div className="text-[10px] font-bold uppercase text-slate-500">Créditos efetivos · vieram na nota</div>
            <div className="font-mono text-lg font-black text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoEfetivoTotal)}</div>
            <div className="font-mono text-[10px] text-slate-400">IBS {fmtMoeda(a.creditoEfetivoIBS)} + CBS {fmtMoeda(a.creditoEfetivoCBS)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{a.qtdEntradasEfetivas} nota(s) com destaque · base {fmtMoeda(a.baseEntradasEfetiva)}</div>
          </div>
          <div className="calc-hero rounded-xl p-3">
            <div className="calc-hero-rotulo">Saldo assistido</div>
            <div className="calc-hero-valor text-2xl text-white">{fmtMoeda(a.saldoTotal)}</div>
            <div className="font-mono text-[10px] text-white/70">IBS {fmtMoeda(a.saldoIBS)} · CBS {fmtMoeda(a.saldoCBS)}</div>
          </div>
        </div>

        {temMovimento ? (
          <div>
            <div className="flex justify-between font-mono text-[10px] text-slate-400">
              <span>Créditos da nota cobrem {cobertura.toFixed(0)}% dos débitos destacados</span>
              <span>{fmtMoeda(a.creditoEfetivoTotal)} / {fmtMoeda(a.debitoEfetivoTotal)}</span>
            </div>
            <div className="calc-bar mt-1" aria-hidden="true">
              <span className="bg-gradient-to-r from-emerald-600 to-teal-400" style={{ width: `${cobertura}%` }} />
              <span className="calc-bar-ibs opacity-40" style={{ width: `${100 - cobertura}%` }} />
            </div>
          </div>
        ) : null}
        <table className="tbl w-full">
          <thead>
            <tr>
              <th>Detalhamento LC 214/2025 — apuração assistida</th>
              <th className="th-r">IBS</th>
              <th className="th-r">CBS</th>
              <th className="th-r">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Débitos efetivos — você destacou nas saídas
                <span className="block text-[10px] font-normal text-slate-400">
                  {a.qtdSaidas} venda(s) que você emitiu · base {fmtMoeda(a.baseSaidasEfetiva)}
                  {a.debitoSemEfeitoTotal > 0 ? ` · +${fmtMoeda(a.debitoSemEfeitoTotal)} em ${a.qtdSaidasSemEfeito} saída(s) fora de venda (fora do saldo)` : ''}
                </span>
              </td>
              <td className="text-right font-mono">{fmtMoeda(a.debitoEfetivoIBS)}</td>
              <td className="text-right font-mono">{fmtMoeda(a.debitoEfetivoCBS)}</td>
              <td className="text-right font-mono font-bold">{fmtMoeda(a.debitoEfetivoTotal)}</td>
            </tr>
            <tr>
              <td>
                (−) Créditos efetivos — vieram na nota
                <span className="block text-[10px] font-normal text-slate-400">
                  {a.qtdEntradasEfetivas} nota(s) com destaque IBS/CBS · vale para a apuração assistida
                </span>
              </td>
              <td className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoEfetivoIBS)}</td>
              <td className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoEfetivoCBS)}</td>
              <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">{fmtMoeda(a.creditoEfetivoTotal)}</td>
            </tr>
            <tr>
              <td className="font-bold">(=) Saldo assistido · destacado − destacado</td>
              <td className="text-right font-mono font-bold">{fmtMoeda(a.saldoIBS)}</td>
              <td className="text-right font-mono font-bold">{fmtMoeda(a.saldoCBS)}</td>
              <td className="text-right font-mono font-black">{fmtMoeda(a.saldoTotal)}</td>
            </tr>
            <tr>
              <td>
                Análise pelo NCM — débito esperado das saídas
                <span className="block text-[10px] font-normal text-slate-400">
                  Informativo — o que a Reforma indica para suas vendas (não compõe o saldo)
                </span>
              </td>
              <td className="text-right font-mono text-slate-500">{fmtMoeda(a.debitoInformativoIBS)}</td>
              <td className="text-right font-mono text-slate-500">{fmtMoeda(a.debitoInformativoCBS)}</td>
              <td className="text-right font-mono font-bold text-slate-500">{fmtMoeda(a.debitoInformativoTotal)}</td>
            </tr>
            <tr>
              <td>
                Diferença débito (nota − NCM) — emissão correta?
                <span className="block text-[10px] font-normal text-slate-400">
                  {divergenciaDebito === 0 && a.qtdSaidas > 0
                    ? 'Você destacou exatamente o esperado — emissão de acordo com a Reforma.'
                    : divergenciaDebito < 0
                      ? 'Você destacou menos que o esperado — confira a emissão.'
                      : 'Você destacou mais que o esperado — confira a emissão.'}
                </span>
              </td>
              <td className={`text-right font-mono font-bold ${a.divergenciaDebitoIBS < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{a.divergenciaDebitoIBS >= 0 ? '+' : ''}{fmtMoeda(a.divergenciaDebitoIBS)}</td>
              <td className={`text-right font-mono font-bold ${a.divergenciaDebitoCBS < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{a.divergenciaDebitoCBS >= 0 ? '+' : ''}{fmtMoeda(a.divergenciaDebitoCBS)}</td>
              <td className={`text-right font-mono font-black ${divergenciaDebito < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{divergenciaDebito >= 0 ? '+' : ''}{fmtMoeda(divergenciaDebito)}</td>
            </tr>
          </tbody>
        </table>

        {temMovimento ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                🧮 Análise pelo NCM — Pela reforma
              </span>
              <Pill cor="slate">Informativo · não abate o saldo · você decide</Pill>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Pela lei (NCM), o seu débito <strong>poderia ser {fmtMoeda(a.debitoInformativoTotal)}</strong>{' '}
              (IBS {fmtMoeda(a.debitoInformativoIBS)} + CBS {fmtMoeda(a.debitoInformativoCBS)}).
              Você destacou <strong>{fmtMoeda(a.debitoEfetivoTotal)}</strong> — diferença de{' '}
              <strong className={divergenciaDebito < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                {divergenciaDebito >= 0 ? '+' : ''}{fmtMoeda(divergenciaDebito)}
              </strong>{' '}
              (nota − NCM). Vale o que você emitiu: confira se a emissão está de acordo com a Reforma.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Pela lei (NCM), o crédito <strong>poderia ser {fmtMoeda(a.creditoInformativoTotal)}</strong>{' '}
              (IBS {fmtMoeda(a.creditoInformativoIBS)} + CBS {fmtMoeda(a.creditoInformativoCBS)}).
              A nota trouxe <strong>{fmtMoeda(a.creditoEfetivoTotal)}</strong> — diferença de{' '}
              <strong className={divergencia < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                {divergencia >= 0 ? '+' : ''}{fmtMoeda(divergencia)}
              </strong>{' '}
              (nota − NCM). Vale o que o fornecedor destacou: compare e decida se aceita, contesta ou complementa.
            </p>
            {(a.semEfeitoTotal > 0 || a.imobilizadoTotal > 0 || a.creditoProvisorio || a.debitoProvisorio || semDestaqueSaidas) ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                {semDestaqueSaidas ? (
                  <>⤴ Suas saídas não destacam IBS/CBS (XML anterior à Reforma): débito comprovado zero — o esperado pela lei é <strong>{fmtMoeda(a.debitoInformativoTotal)}</strong>. Confira a emissão. </>
                ) : null}
                {a.debitoProvisorio && !semDestaqueSaidas ? (
                  <>📎 Há saída legada sem os campos do XML: o débito usou a estimativa NCM como proxy — confira a emissão. </>
                ) : null}
                {a.semEfeitoTotal > 0 ? (
                  <>⚠️ Operações diferentes de venda: <strong>{fmtMoeda(a.semEfeitoTotal)}</strong> ({a.qtdSemEfeito} nota(s)) fora do crédito — veja o bloco de naturezas acima dos gráficos. </>
                ) : null}
                {a.imobilizadoTotal > 0 ? (
                  <>🏭 Ativo imobilizado / uso e consumo: <strong>{fmtMoeda(a.imobilizadoTotal)}</strong> ({a.qtdImobilizado} nota(s)) sem crédito. </>
                ) : null}
                {a.creditoProvisorio ? (
                  <>📎 Há nota legada sem os campos do XML: o efetivo usou a estimativa NCM como proxy — confira o XML. </>
                ) : null}
                {a.debitoSemEfeitoTotal > 0 ? (
                  <>⤴ Saídas fora de venda: <strong>{fmtMoeda(a.debitoSemEfeitoTotal)}</strong> ({a.qtdSaidasSemEfeito} nota(s) que você emitiu sem vender) fora do débito — veja o bloco de naturezas. </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-1">
          {a.resultado === 'a-pagar' ? (
            <div className="calc-hero flex items-center gap-3 rounded-2xl !border-red-400/50 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 text-xl">▣</span>
              <div className="min-w-0 flex-1">
                <div className="calc-hero-rotulo">Imposto a pagar</div>
                <div className="calc-hero-valor text-2xl text-white">
                  {fmtMoeda(a.valorAPagar)}
                </div>
                <div className="text-[11px] text-white/70">
                  IBS {fmtMoeda(Math.max(0, a.saldoIBS))} + CBS {fmtMoeda(Math.max(0, a.saldoCBS))}
                  {a.saldoIBS < 0 || a.saldoCBS < 0 ? ' (tributo com saldo credor abatido no total)' : ''}
                </div>
              </div>
            </div>
          ) : a.resultado === 'saldo-credor' ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-600 to-teal-600 p-4 text-white">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 text-xl">↩</span>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">Saldo credor</div>
                <div className="font-mono text-2xl font-black">
                  {fmtMoeda(a.saldoCredor)}
                </div>
                <div className="text-[11px] text-emerald-50/90">
                  Créditos superaram os débitos — disponível para restituição ou compensação.
                </div>
              </div>
            </div>
          ) : a.resultado === 'zerado' ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-center text-xs font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
              {semDestaqueSaidas
                ? `✓ Débitos e créditos destacados se equivalem (zero) — mas suas saídas não destacam IBS/CBS: o esperado pela Reforma é ${fmtMoeda(a.debitoInformativoTotal)}. Confira a emissão.`
                : '✓ Débitos e créditos se equivalem — sem saldo a pagar ou restituir.'}
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
  const [anualAberto, setAnualAberto] = useState(false)

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
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" onClick={anterior} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Mês anterior">‹</button>
        <h3 className="flex items-center gap-2 text-sm font-bold"><IconeBadge nome="calendario" tom="brand" tamanho="sm" /> {MESES[mesMes - 1]} <span className="text-slate-400">{mesAno}</span></h3>
        <button type="button" onClick={proximo} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Próximo mês">›</button>
      </div>
      <button
        type="button"
        onClick={() => setAnualAberto(true)}
        title="Abre o calendário anual — meses com documentos ficam com a borda cintilante"
        className="xml-focus-ouro mb-2 rounded-lg border border-dashed border-brand-300 bg-brand-50/60 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-50 dark:border-aurum-900 dark:bg-brand-950/30 dark:text-aurum-200"
      >
        📅 Calendário anual — achar meses com notas
      </button>
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
      <CalendarioAnualModal aberto={anualAberto} onFechar={() => setAnualAberto(false)} />
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
          Notas que você recebeu (eles emitiram = seu crédito) · clique para ver as notas
        </p>
      </div>
      <div className="scroll-elegante max-h-[300px] min-h-0 space-y-2 overflow-y-auto p-3 lg:max-h-none lg:flex-1">
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
                <BarraAnimada
                  pct={max > 0 ? (r.creditoTotal / max) * 100 : 0}
                  className="h-full rounded-full bg-gradient-to-r from-brand-600 to-emerald-500"
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
        cst: string; cClassTrib: string; manual: boolean;
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
            manual: false,
          }
          atual.qtd += Number(it.qtd) || 0
          atual.base += Number(it.vlTotal) || 0
          atual.ibs += Number(it.ibs) || 0
          atual.cbs += Number(it.cbs) || 0
          atual.trib += Number(it.totalTributos) || 0
          // BLINDAGEM: se qualquer item agregado veio de escolha do usuário,
          // o selo abaixo deixa de afirmar "Pela legislação".
          atual.manual = atual.manual || it.manual || it.classificacao.manual != null
          // Enquadramento pela legislação (base da estimativa acima) — o CST do
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
  lista: { codigo: string; nome: string; ncm: string; cfop: string; qtd: number; base: number; ibs: number; cbs: number; trib: number; cst: string; cClassTrib: string; manual: boolean }[]
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
              <BarraAnimada
                pct={max > 0 ? (p.base / max) * 100 : 0}
                className={`h-full rounded-full bg-gradient-to-r ${barra}`}
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
              {p.manual ? (
                <Pill cor="amber">👤 Manual · CST {p.cst} · {p.cClassTrib}</Pill>
              ) : (
                <Pill cor={tom === 'emerald' ? 'emerald' : 'brand'}>Pela legislação CST {p.cst} · {p.cClassTrib}</Pill>
              )}
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
  const notas = useNfe((s) => s.notas)
  const [reformaAberto, setReformaAberto] = useState(false)
  const ativosReforma = [filtros.cClassTrib, filtros.cstReforma, filtros.reducao].filter((v) =>
    v.trim(),
  ).length
  const ativosTotal = [
    filtros.texto, filtros.fornecedor, filtros.cfop, filtros.cstIcms,
    filtros.cClassTrib, filtros.cstReforma, filtros.reducao,
  ].filter((v) => v.trim()).length + (filtros.direcao !== 'todas' ? 1 : 0)
  // Rascunho do período: digitar a data não refiltra sozinho — só aplica no
  // botão Filtrar (ou Enter), para não recarregar a cada número digitado.
  const [inicioRasc, setInicioRasc] = useState(filtros.inicio)
  const [fimRasc, setFimRasc] = useState(filtros.fim)
  useEffect(() => {
    setInicioRasc(filtros.inicio)
    setFimRasc(filtros.fim)
  }, [filtros.inicio, filtros.fim])
  const periodoPendente = inicioRasc !== filtros.inicio || fimRasc !== filtros.fim
  const aplicarPeriodo = () => {
    if (!periodoPendente) return
    setFiltros({ inicio: inicioRasc, fim: fimRasc })
  }

  const periodo = (dias: number) => {
    const hoje = new Date()
    // ISO local (sem o deslocamento UTC do `toISOString`).
    const l = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const f = l(hoje)
    const ini = new Date(hoje)
    ini.setDate(ini.getDate() - (dias - 1))
    setFiltros({ inicio: l(ini), fim: f })
  }

  return (
    <Painel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="lupa" tom="brand" tamanho="sm" />
          Filtros das notas
          <span className="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-black text-brand-700 dark:bg-brand-950/50 dark:text-aurum-200">
            {notas.length}
          </span>
          {ativosTotal > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {ativosTotal} ativo(s)
            </span>
          ) : null}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Btn tam="sm" onClick={() => periodo(7)} title="Últimos 7 dias">7d</Btn>
          <Btn tam="sm" onClick={() => periodo(30)} title="Últimos 30 dias">30d</Btn>
          <motion.span
            key={ativosReforma}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          >
            <Btn tam="sm" onClick={() => limparFiltros()} title="Volta aos últimos 30 dias">✕ Limpar</Btn>
          </motion.span>
        </div>
      </div>
      <div className="space-y-2.5 p-4">
        {/* Linha 1 — o essencial pedido: período, tipo, CFOP, CST, produto */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-12">
          <label className="block lg:col-span-2">
            <span className="field-label">Período · de</span>
            <Texto
              type="date"
              value={inicioRasc}
              onChange={(e) => setInicioRasc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') aplicarPeriodo()
              }}
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="field-label">Período · até</span>
            <Texto
              type="date"
              value={fimRasc}
              onChange={(e) => setFimRasc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') aplicarPeriodo()
              }}
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="field-label">Tipo de nota</span>
            <select
              className="field"
              value={filtros.direcao}
              onChange={(e) => setFiltros({ direcao: e.target.value as FiltrosNfe['direcao'] })}
            >
              <option value="todas">Todas</option>
              <option value="entrada">⤵ Entradas</option>
              <option value="saida">⤴ Saídas</option>
              <option value="quarentena">⚠ Quarentena</option>
            </select>
          </label>
          <label className="block lg:col-span-2">
            <span className="field-label">CFOP</span>
            <Texto
              value={filtros.cfop}
              onChange={(e) => setFiltros({ cfop: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              placeholder="5102"
              mono
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="field-label">CST / CSOSN</span>
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
          <label className="block lg:col-span-2">
            <span className="field-label">Fornecedor</span>
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variante={periodoPendente ? 'primary' : 'ghost'}
            onClick={aplicarPeriodo}
            disabled={!periodoPendente}
            title="Aplica o período digitado — digitar a data não filtra sozinho"
          >
            🔎 Filtrar período
          </Btn>
          {periodoPendente ? (
            <span className="text-[11px] text-amber-700 dark:text-amber-300">
              Período alterado — clique em Filtrar (ou Enter) para aplicar.
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">
              Digite as datas e clique em Filtrar — a lista só atualiza ao confirmar.
            </span>
          )}
          {(inicioRasc || fimRasc) && periodoPendente ? (
            <button
              type="button"
              onClick={() => {
                setInicioRasc(filtros.inicio)
                setFimRasc(filtros.fim)
              }}
              className="xml-focus-ouro pill bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title="Descarta o que foi digitado e volta ao período aplicado"
            >
              ✕ descartar digitação
            </button>
          ) : null}
        </div>
        {/* Linha 2 — produto em destaque + Reforma */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
          <label className="block lg:col-span-9">
            <span className="field-label">Produto · código · NCM</span>
            <Texto
              value={filtros.texto}
              onChange={(e) => setFiltros({ texto: e.target.value })}
              placeholder="Ex.: queijo, SKU-001, 0201…"
            />
          </label>
          <div className="flex items-end lg:col-span-3">
            <Btn
              className="w-full"
              variante={reformaAberto || ativosReforma > 0 ? 'primary' : 'ghost'}
              onClick={() => setReformaAberto((v) => !v)}
              title="Filtros específicos da Reforma: cClassTrib, CST e redução por item"
              aria-expanded={reformaAberto}
            >
              <motion.span
                className="inline-block"
                animate={{ rotate: reformaAberto ? 90 : 0 }}
                transition={{ duration: 0.2 }}
              >
                ▸
              </motion.span>
              {' '}🎛 Reforma{ativosReforma > 0 ? ` (${ativosReforma})` : ''}
            </Btn>
          </div>
        </div>
        <Expansivel aberto={reformaAberto}>
          <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-brand-200/60 bg-brand-50/40 p-3 md:grid-cols-3 dark:border-aurum-900 dark:bg-brand-950/20">
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
        </Expansivel>
      </div>
    </Painel>
  )
}

/* ---------------------------------------------------------------- tabela --- */

/**
 * Tabela de notas compacta + paginada.
 *
 * - Bloco menor: linhas densas (`tbl-compacta`), container `max-h-[360px]`
 *   com scroll interno, sem ocupar a tela inteira.
 * - Paginação: 15 por página, com Primeira/Anterior/numérica/Próxima/Última
 *   + seletor de tamanho (10/15/30/50). Volta à página 1 a cada filtro novo.
 */
const TAMANHOS_PAGINA = [10, 15, 30, 50] as const

/**
 * Estado vazio da tabela: em vez de "não exibe nada", oferece o
 * calendário anual — meses com documentos ficam com a borda cintilante.
 */
function TabelaVazia() {
  const [anualAberto, setAnualAberto] = useState(false)
  return (
    <Painel className="p-6 text-center">
      <div className="text-3xl" aria-hidden="true">🗂️</div>
      <p className="mt-2 text-sm font-bold">Nenhuma nota neste período</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Pode não haver documentos neste mês. Abra o calendário anual: os meses
        com notas ficam com a <strong>borda cintilante</strong> para facilitar a identificação.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Btn variante="primary" onClick={() => setAnualAberto(true)}>
          📅 Abrir calendário anual
        </Btn>
      </div>
      <CalendarioAnualModal aberto={anualAberto} onFechar={() => setAnualAberto(false)} />
    </Painel>
  )
}

function TabelaNotas({ notas, onVerDanfe }: { notas: NotaXml[]; onVerDanfe: (n: NotaXml) => void }) {
  const abrirNota = useNfe((s) => s.abrirNota)
  const excluir = useNfe((s) => s.excluir)
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState<number>(15)
  const listaId = useMemo(() => notas.map((n) => n.id ?? n.chave).join('|'), [notas])

  // Novo filtro / nova importação → volta à primeira página.
  useEffect(() => {
    setPagina(1)
  }, [listaId, porPagina])

  const totalPaginas = Math.max(1, Math.ceil(notas.length / porPagina))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const ini = (paginaSegura - 1) * porPagina
  const exibidas = notas.slice(ini, ini + porPagina)

  const irPara = (p: number) => setPagina(Math.min(Math.max(1, p), totalPaginas))

  // Janela numérica compacta: 1 … atual-1 atual atual+1 … última
  const janela = useMemo(() => {
    const set = new Set<number>([1, totalPaginas, paginaSegura - 1, paginaSegura, paginaSegura + 1])
    return [...set].filter((p) => p >= 1 && p <= totalPaginas).sort((a, b) => a - b)
  }, [paginaSegura, totalPaginas])

  if (!notas.length) {
    return <TabelaVazia />
  }

  return (
    <Painel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="nota" tom="brand" tamanho="sm" />
          Notas
          <span className="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-black text-brand-700 dark:bg-brand-950/50 dark:text-aurum-200">
            {notas.length}
          </span>
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <label className="flex items-center gap-1.5">
            <span>Por pág.</span>
            <select
              className="field !w-auto !rounded-lg !px-2 !py-1 text-[11px]"
              value={porPagina}
              onChange={(e) => setPorPagina(Number(e.target.value))}
            >
              {TAMANHOS_PAGINA.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <span className="hidden sm:inline">👁 itens · 🧾 DANFE</span>
        </div>
      </div>
      <div className="max-h-[360px] overflow-auto scroll-elegante">
        <table className="tbl tbl-notas tbl-compacta w-full table-fixed">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[30%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[9%]" />
          </colgroup>
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
            {exibidas.map((n) => {
              const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
              return (
              <motion.tr
                key={n.id ?? n.chave}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="cursor-pointer"
                onClick={() => abrirNota(n)}
                title="👁 Ver itens e todos os tributos"
              >
                <td className="truncate font-mono font-bold">{n.numero || n.chave.slice(-8)}</td>
                <td className="whitespace-nowrap font-mono text-[11px]">{fmtData(n.dataEmissao)}</td>
                <td className="min-w-0" title={`${n.emitNome} · ${fmtCnpj(n.emitCnpj)}${regime !== 'desconhecido' && regime !== 'normal' ? ` · ${REGIME_LABELS[regime]}` : ''} · ${n.itensAnalisados.length} item(ns)`}>
                  <span className="block truncate">{n.emitNome || fmtCnpj(n.emitCnpj)}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {regime === 'simples' || regime === 'mei' ? (
                      <span className="inline-block"><Pill cor="amber">{REGIME_LABELS[regime]}</Pill></span>
                    ) : null}
                    <span className="shrink-0 text-[10px] text-slate-400">{n.itensAnalisados.length} item(ns)</span>
                    <SeloSTNota itens={n.itensAnalisados} />
                  </span>
                </td>
                <td><Pill cor={COR_DIRECAO[n.direcao]}>{ROTULO_DIRECAO[n.direcao]}</Pill></td>
                <td className="truncate text-right font-mono">{fmtMoeda(n.valorTotal)}</td>
                <td
                  className="truncate text-right font-mono font-bold text-emerald-700 dark:text-emerald-400"
                  title={`Pela legislação: IBS ${fmtMoeda(n.totalIBS)} + CBS ${fmtMoeda(n.totalCBS)}`}
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
              </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500 dark:border-slate-800">
        <span>
          {notas.length ? `${ini + 1}–${Math.min(ini + porPagina, notas.length)} de ${notas.length}` : '0 notas'}
          {' · PDF e CSV exportam a lista completa'}
        </span>
        <nav className="flex items-center gap-1" aria-label="Paginação das notas">
          <Btn tam="sm" onClick={() => irPara(1)} disabled={paginaSegura <= 1} title="Primeira página">⏮</Btn>
          <Btn tam="sm" onClick={() => irPara(paginaSegura - 1)} disabled={paginaSegura <= 1} title="Página anterior">‹</Btn>
          {janela.map((p, i) => {
            const anterior = janela[i - 1]
            return (
              <span key={p} className="flex items-center gap-1">
                {anterior != null && p - anterior > 1 ? <span className="px-0.5 text-slate-300">…</span> : null}
                <button
                  type="button"
                  onClick={() => irPara(p)}
                  aria-current={p === paginaSegura ? 'page' : undefined}
                  className={`min-w-7 rounded-lg px-2 py-1 font-mono font-bold transition ${
                    p === paginaSegura
                      ? 'bg-brand-600 text-white shadow-pop'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {p}
                </button>
              </span>
            )
          })}
          <Btn tam="sm" onClick={() => irPara(paginaSegura + 1)} disabled={paginaSegura >= totalPaginas} title="Próxima página">›</Btn>
          <Btn tam="sm" onClick={() => irPara(totalPaginas)} disabled={paginaSegura >= totalPaginas} title="Última página">⏭</Btn>
        </nav>
      </div>
    </Painel>
  )
}

const fmtData = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso

/** Rótulo do recorte temporal da apuração assistida (reage aos filtros). */
function rotuloPeriodoApuracao(inicio: string, fim: string): string {
  if (inicio && fim) return inicio === fim ? `em ${fmtData(inicio)}` : `${fmtData(inicio)} a ${fmtData(fim)}`
  if (inicio) return `desde ${fmtData(inicio)}`
  if (fim) return `até ${fmtData(fim)}`
  return 'todas as notas da empresa'
}

/* --------------------------------------------------------------- detalhe --- */

function ModalDetalheNfe({ onVerDanfe }: { onVerDanfe: (n: NotaXml) => void }) {
  const nota = useNfe((s) => s.notaAberta)
  const fecharNota = useNfe((s) => s.fecharNota)
  const reaplicarNota = useNfe((s) => s.reaplicarNota)
  // 👁 Item selecionado — modal compacto com todos os tributos (irmão, nunca aninhado no DOM do detalhe).
  const [itemDetalhe, setItemDetalhe] = useState<ResultadoItemNfe | null>(null)
  const [reaplicando, setReaplicando] = useState(false)
  // Itens com enquadramento feito pelo usuário (manual) — legenda explícita no corpo do modal.
  const qtdManual = nota?.itensAnalisados.filter((it) => it.manual || it.classificacao.manual != null).length ?? 0

  return (
    <>
    <Modal
      aberto={nota !== null}
      onFechar={() => { setItemDetalhe(null); fecharNota() }}
      titulo={nota ? `Nota ${nota.numero || nota.chave.slice(-8)} · ${ROTULO_DIRECAO[nota.direcao]}` : ''}
      subtitulo={nota ? `${nota.emitNome || nota.emitCnpj} · emissão ${fmtData(nota.dataEmissao)} · ${nota.itensAnalisados.length} item(ns)` : ''}
      largura="max-w-5xl"
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
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <Info rotulo="Chave" valor={nota.chave} mono />
            <Info rotulo="Série / Modelo" valor={`${nota.serie || '—'} / ${nota.modelo}`} />
            <Info rotulo="Destinatário" valor={nota.destNome || (nota.destDoc ? fmtCnpj(nota.destDoc) : '—')} />
            <Info rotulo="Valor da nota" valor={fmtMoeda(nota.valorTotal)} mono forte />
          </div>
          <BlocoCreditoIbsCbs nota={nota} />
          <ConfrontoCredito nota={nota} />
          <AlertaRegime nota={nota} />
          {qtdManual > 0 ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <span aria-hidden className="text-sm">👤</span>
              <div>
                <span className="font-black">
                  {qtdManual} de {nota.itensAnalisados.length} item(ns) com classificação feita por você
                </span>
                <span>
                  {' '}— o sistema apenas aplicou a sua escolha. A responsabilidade pelo enquadramento é{' '}
                  <strong>sua, não do sistema</strong>. Abra o 👁 do item para ver a fonte informada.
                </span>
              </div>
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                Itens ({nota.itensAnalisados.length})
                <SeloSTNota itens={nota.itensAnalisados} />
              </h4>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700">👁 abre todos os tributos do item</span>
            </div>
          {/* Somente scroll vertical: a tabela é fixa em 100% da largura do modal (sem scroll horizontal). */}
          <div className="max-h-[38vh] overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200/80 shadow-sm dark:border-slate-700/60">
            <table className="tbl w-full table-fixed">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[25%]" />
                <col className="w-[8%]" />
                <col className="w-[14%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[7%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="!whitespace-normal">Código</th>
                  <th className="!whitespace-normal">Produto</th>
                  <th className="th-r !whitespace-normal">Qtd</th>
                  <th className="th-r !whitespace-normal">Valor</th>
                  <th className="!whitespace-normal">No XML</th>
                  <th className="!whitespace-normal">Pela legislação</th>
                  <th className="th-r !whitespace-normal">Total est.</th>
                  <th className="th-r !whitespace-normal">👁</th>
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            <span><strong>No XML</strong> = destacado pelo emitente</span>
            <span><strong>Pela legislação</strong> = base oficial › regra geral</span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">👤 você</span>
              = classificação feita por você (manual) — responsabilidade sua, não do sistema
            </span>
            <span><strong className="font-mono text-brand-700 dark:text-aurum-200">⇄ comparar</strong> = leitura diferente da nota · <strong className="font-mono text-emerald-600">✓</strong> = mesma leitura</span>
          </div>
        </div>
      ) : null}
    </Modal>
    <ModalItemNfeDetalhe item={itemDetalhe} onFechar={() => setItemDetalhe(null)} />
    </>
  )
}

/**
 * Linha do item com as duas tributações lado a lado: **No XML** (o que o
 * emitente destacou no grupo IBSCBS) × **Pela legislação** (o que diz a legislação:
 * base oficial › manual › regra geral). Leitura diferente ganha o selo `⇄`.
 */
function LinhaItemNfe({ item: it, onDetalhe }: { item: ResultadoItemNfe; onDetalhe: () => void }) {
  const credXml = creditoIbsCbsDoItem(it)
  const div = divergenciaXmlSistema(it)
  const manual = it.manual || it.classificacao.manual != null
  return (
    <tr className="cursor-pointer transition-colors hover:bg-brand-50/50" onClick={onDetalhe} title="Ver o confronto completo XML × legislação">
      <td className="min-w-0 break-all font-mono text-[11px] font-bold">{it.codProd}</td>
      <td className="min-w-0" title={`${it.descricao} · NCM ${fmtNcm(it.ncm)} · CFOP ${it.cfop || '—'}`}>
        <span className="block truncate text-xs">{it.descricao}</span>
        <span className="block truncate font-mono text-[10px] text-slate-400">
          {fmtNcm(it.ncm)} · CFOP {it.cfop || '—'}
        </span>
        <SeloST cest={it.cest} />
      </td>
      <td className="whitespace-normal break-words text-right text-xs">{fmtNum(it.qtd)}</td>
      <td className="whitespace-normal break-words text-right font-mono text-xs">{fmtMoeda(it.vlTotal)}</td>
      <td className="min-w-0" title={div.temXml ? `XML: CST ${it.cstIbsCbs || '—'} · cClassTrib ${it.cClassTribIbsCbs || '—'} · IBS ${fmtMoeda(credXml.vIbs)} + CBS ${fmtMoeda(credXml.vCbs)}` : 'Sem grupo IBSCBS neste item'}>
        {div.temXml ? (
          <span className="block whitespace-normal break-words font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
            {it.cstIbsCbs || '—'} · {it.cClassTribIbsCbs || '—'}
            <span className="block text-[10px] font-normal text-slate-400">
              {credXml.temCredito ? fmtMoeda(credXml.vTotal) : 's/ valores'}
            </span>
          </span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
      <td className="min-w-0" title={manual ? 'Classificação feita por você (manual) — responsabilidade sua, não do sistema' : it.regraGeral ? 'Pela legislação · regra geral (alíquota cheia)' : 'Pela legislação · base oficial'}>
        <span className="block whitespace-normal break-words font-mono text-[11px] font-bold text-brand-700 dark:text-aurum-200">
          {it.classificacao.cst} · {it.classificacao.cClassTrib}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          {manual ? (
            <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" title="Classificação feita por você (manual) — responsabilidade sua, não do sistema">
              👤 você
            </span>
          ) : null}
          {div.diverge ? (
            <span className="rounded bg-brand-100 px-1 py-0.5 font-mono text-[10px] font-bold text-brand-700 dark:bg-brand-950/50 dark:text-aurum-200" title="Leitura diferente da nota — abra o detalhe para comparar Na nota × Pela legislação">
              ⇄ comparar
            </span>
          ) : div.temXml ? (
            <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400" title="Confere com o XML">✓</span>
          ) : null}
        </span>
      </td>
      <td className="whitespace-normal break-words text-right font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
        {fmtMoeda(it.totalTributos)}
      </td>
      <td className="text-right" onClick={(e) => e.stopPropagation()}>
        <Olho somenteIcone onClick={onDetalhe} titulo="Ver o confronto completo XML × legislação" />
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
  // Direção correta: você EMITIU (saída) = DÉBITO seu; você RECEBEU a nota
  // (entrada) = CRÉDITO seu — desde que a operação seja de venda.
  const ehSaida = nota.direcao === 'saida'
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
    <div className={`overflow-hidden rounded-2xl border bg-gradient-to-br dark:to-slate-900 ${ehSaida ? 'border-red-300 from-red-50 via-white to-orange-50/60 dark:border-red-800 dark:from-red-950/40 dark:via-slate-900' : 'border-emerald-300 from-emerald-50 via-white to-teal-50/60 dark:border-emerald-800 dark:from-emerald-950/40 dark:via-slate-900'}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <span className={`grid h-8 w-8 place-items-center rounded-xl text-base text-white shadow-pop ${ehSaida ? 'bg-red-500' : 'bg-emerald-500'}`}>💠</span>
        <div>
          <div className={`text-[10px] font-black uppercase tracking-widest ${ehSaida ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {ehSaida ? 'Débito IBS / CBS destacado no XML' : 'Crédito IBS / CBS destacado no XML'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {cred.itensComCredito} de {cred.totalItens} item(ns) ·{' '}
            {ehSaida
              ? 'destacado nesta saída — é o DÉBITO da sua emissão (você emitiu, você deve)'
              : apropriavel
                ? 'apropriável nesta entrada — você recebeu a nota, o crédito é seu'
                : 'verifique o regime do emitente'}
          </div>
        </div>
        <span className={`ml-auto font-mono text-xl font-black ${ehSaida ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {fmtMoeda(cred.totalDestacado)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="rounded-xl bg-white/80 p-3 shadow-card dark:bg-slate-900/70">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">IBS {ehSaida ? 'do débito' : 'destacado'}</div>
          <div className={`font-mono text-base font-black ${ehSaida ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{fmtMoeda(cred.ibsDestacado)}</div>
        </div>
        <div className="rounded-xl bg-white/80 p-3 shadow-card dark:bg-slate-900/70">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CBS {ehSaida ? 'do débito' : 'destacada'}</div>
          <div className={`font-mono text-base font-black ${ehSaida ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{fmtMoeda(cred.cbsDestacado)}</div>
        </div>
      </div>
      <div className="px-4 pb-3 text-[10px] text-slate-400">
        {ehSaida
          ? '⤴ Você emitiu esta nota (saída de venda) — o destaque é o seu débito, não crédito.'
          : '⤵ Esta nota foi emitida pelo fornecedor (entrada) — o destaque é o seu crédito, se a operação for de venda.'}
      </div>
    </div>
  )
}

/**
 * Identidade visual do crédito por anexo — rótulo e cores da microinteração
 * da borda. Sem redução, a legenda é **Crédito integral de IBS/CBS** com
 * verde cintilante; cada regra tem sua cor (integral = verde, alíquota
 * zero = roxo, reduções 80/70/60% = âmbar/laranja, reduções 50/40/30% = azul,
 * IBS ≠ CBS = violeta).
 */
const CREDITO_POR_ANEXO: Record<string, { rotulo: string; cor: string; brilho: string }> = {
  isento: { rotulo: 'Crédito integral de IBS/CBS', cor: '#10b981', brilho: '#6ee7b7' },
  '0': { rotulo: 'Alíquota Zero', cor: '#8b5cf6', brilho: '#c4b5fd' },
  '80': { rotulo: 'Redução 80%', cor: '#ea580c', brilho: '#fdba74' },
  '70': { rotulo: 'Redução 70%', cor: '#f97316', brilho: '#fdba74' },
  '60': { rotulo: 'Redução 60%', cor: '#f59e0b', brilho: '#fcd34d' },
  '50': { rotulo: 'Redução 50%', cor: '#0ea5e9', brilho: '#7dd3fc' },
  '40': { rotulo: 'Redução 40%', cor: '#3b82f6', brilho: '#93c5fd' },
  '30': { rotulo: 'Redução 30%', cor: '#6366f1', brilho: '#a5b4fc' },
  misto: { rotulo: 'Redução IBS ≠ CBS', cor: '#8b5cf6', brilho: '#c4b5fd' },
}

/** Selo do crédito com ponto na cor do anexo (claro e escuro).
 *
 * BLINDAGEM: faixas derivadas (`isento`, `0`, `60`…) mantêm os rótulos de
 * redução (descrevem o % oficial, sem fingir anexo). Anexo OFICIAL
 * (`9`, `1`, `90111`…) usa o rótulo oficial neutro — nunca cai no
 * `isento: Crédito integral` (falso para item com redução). Qualquer outro
 * valor (nota mista, sem itens) vira selo neutro, nunca afirmação.
 */
function PillCreditoAnexo({ anexo }: { anexo: string }) {
  if (anexo in CREDITO_POR_ANEXO) {
    const conf = CREDITO_POR_ANEXO[anexo]
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
  if (anexo && anexo !== 'variados') {
    return (
      <span
        className="pill"
        style={{ background: '#64748b1a', color: '#64748b', border: '1px solid #64748b66' }}
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#64748b' }} />
        {rotuloAnexoOficial(anexo)}
      </span>
    )
  }
  return (
    <span
      className="pill"
      style={{ background: '#64748b1a', color: '#64748b', border: '1px solid #64748b66' }}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#64748b' }} />
      Enquadramentos variados
    </span>
  )
}

/**
 * Faixa de confronto: à esquerda o **crédito IBS/CBS que veio no XML**
 * (destaque da Reforma), no meio o ICMS do regime anterior (auxiliar) e à
 * direita a **tributação que a legislação indica** (estimativa por NCM,
 * com borda cintilante na cor do anexo).
 */
function ConfrontoCredito({ nota }: { nota: NotaXml }) {
  const cred = creditoDaNota(nota.itensAnalisados)
  const credReforma = creditoIbsCbsDaNota(nota.itensAnalisados, nota)
  // Direção correta: saída que você emitiu = DÉBITO seu; entrada que você
  // recebeu = CRÉDITO seu (quando a operação é de venda).
  const ehSaidaNota = nota.direcao === 'saida'
  const regime = regimeDoEmitente(nota.emitCrt, nota.itensAnalisados)
  const semTransferencia = !transfereCreditoIbsCbs(regime)
  // BLINDAGEM: o selo/cor da nota usa o anexo do 1º item SOMENTE quando todos
  // os itens têm o mesmo anexo; nota mista ou vazia vira 'variados' (selo
  // neutro) — nunca o 1º item pela nota inteira, nunca `isento` presumido.
  const anexosNota = [...new Set(nota.itensAnalisados.map((it) => it.anexo))]
  const anexoEst = nota.itensAnalisados.length === 0 || anexosNota.length !== 1 ? 'variados' : anexosNota[0]
  const confEst = CREDITO_POR_ANEXO[anexoEst] ?? { cor: '#64748b', brilho: '#cbd5e1' }
  const comXml = nota.itensAnalisados.filter((it) => divergenciaXmlSistema(it).temXml)
  const divergentes = nota.itensAnalisados.filter((it) => divergenciaXmlSistema(it).diverge)
  return (
    <div className="space-y-3">
    {comXml.length ? (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${
        divergentes.length
          ? 'border-brand-200 bg-brand-50/70 text-brand-800 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-200'
          : 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
      }`}>
        <span aria-hidden>{divergentes.length ? '⇄' : '✓'}</span>
        <span>
          {divergentes.length
            ? `${divergentes.length} de ${comXml.length} item(ns) com leitura diferente da nota — compare as colunas "No XML" × "Pela legislação" abaixo.`
            : `Todos os ${comXml.length} item(ns) com IBS/CBS no XML têm a mesma leitura da legislação.`}
        </span>
      </div>
    ) : null}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className={`rounded-2xl border bg-gradient-to-br p-4 dark:to-slate-900 ${ehSaidaNota ? 'border-red-200 from-red-50/80 to-white dark:border-red-900 dark:from-red-950/30' : 'border-emerald-200 from-emerald-50/80 to-white dark:border-emerald-900 dark:from-emerald-950/30'}`}>
        <div className={`text-[10px] font-black uppercase tracking-wide ${ehSaidaNota ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {ehSaidaNota ? '💠 IBS/CBS no XML — seu débito' : '💠 IBS/CBS no XML — seu crédito'}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`font-mono text-lg font-black ${ehSaidaNota ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
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
          🧮 Análise pelo NCM — Pela reforma
        </div>
        <div className="mt-0.5 text-[10px] text-slate-400">
          Informativo — o sistema estimou pela lei; vale o que veio na nota. Você decide.
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
    <div className="min-w-0 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className={`mt-0.5 break-words [overflow-wrap:anywhere] text-xs ${mono ? 'font-mono' : ''} ${forte ? 'font-black' : 'font-semibold'}`}>
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
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
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

/* --------------------------------------- novas seções de visualização --- */

/**
 * Faixa de indicadores executivos do filtro atual: tickets médios por
 * direção, maior nota, cargas efetivas, NCMs distintos e conferência
 * XML × legislação. Leitura rápida antes dos gráficos comparativos.
 */
function IndicadoresXml({ notas }: { notas: NotaXml[] }) {
  const ind = useMemo(() => indicadoresXml(notas), [notas])
  if (!notas.length) return null
  const cards: { rotulo: string; valor: string; sub: string }[] = [
    { rotulo: 'Ticket médio', valor: fmtMoeda(ind.ticketMedio), sub: `entr ${fmtCompactoNfe(ind.ticketEntradas)} · saíd ${fmtCompactoNfe(ind.ticketSaidas)}` },
    { rotulo: 'Maior nota', valor: ind.maiorNota ? fmtMoeda(ind.maiorNota.valor) : '—', sub: ind.maiorNota ? `Nº ${ind.maiorNota.numero} · ${ind.maiorNota.emitente.slice(0, 28)}` : '—' },
    { rotulo: 'Carga entradas', valor: fmtCarga(ind.cargaEntradas), sub: 'IBS+CBS / base entradas' },
    { rotulo: 'Carga saídas', valor: fmtCarga(ind.cargaSaidas), sub: 'IBS+CBS / base saídas' },
    { rotulo: 'NCMs · itens', valor: `${ind.ncmsDistintos} · ${ind.totalItens}`, sub: 'distintos · linhas de item' },
    { rotulo: 'Conferência XML', valor: ind.qtdComXml ? `${ind.qtdComXml - ind.qtdDivergentes}/${ind.qtdComXml}` : '—', sub: ind.qtdDivergentes ? `${ind.qtdDivergentes} leitura(s) diferente(s)` : 'todas com a mesma leitura' },
  ]
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="moeda" tom="brand" />
          Indicadores do período
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          Tickets, cargas efetivas e conferência — calculados sobre o filtro atual
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.rotulo} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{c.rotulo}</div>
            <div className="mt-0.5 truncate font-mono text-sm font-black" title={`${c.valor} · ${c.sub}`}>{c.valor}</div>
            <div className="truncate text-[10px] text-slate-400" title={c.sub}>{c.sub}</div>
          </div>
        ))}
      </div>
    </Painel>
  )
}

/**
 * Comparativo mês a mês Entradas × Saídas com alternância de visualização
 * (barras / linha / tabela). Compara base (valor das notas) e tributos
 * (IBS+CBS) no mesmo eixo temporal.
 */
function ComparativoMensal({ notas }: { notas: NotaXml[] }) {
  const [modo, setModo] = useState<'barras' | 'linha' | 'tabela'>('barras')
  const evo = useMemo(() => evolucaoMensal(notas), [notas])
  if (!notas.length || !evo.length) return null
  const labels = evo.map((p) => p.rotulo)
  return (
    <Painel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="grafico" tom="brand" />
            Entradas × Saídas por mês
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
            Base (barras) e IBS+CBS (linha) · últimos {evo.length} mese(s) do filtro
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-[11px] font-bold dark:bg-slate-800">
          {(['barras', 'linha', 'tabela'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${modo === m ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-aurum-200' : 'text-slate-500'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {modo === 'tabela' ? (
          <div className="overflow-x-auto">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="th-r">Base entr.</th>
                  <th className="th-r">Base saíd.</th>
                  <th className="th-r">IBS+CBS entr.</th>
                  <th className="th-r">IBS+CBS saíd.</th>
                  <th className="th-r">Notas</th>
                </tr>
              </thead>
              <tbody>
                {evo.map((p) => (
                  <tr key={p.mes}>
                    <td className="font-mono font-bold">{p.rotulo}</td>
                    <td className="text-right font-mono">{fmtMoeda(p.baseEntradas)}</td>
                    <td className="text-right font-mono">{fmtMoeda(p.baseSaidas)}</td>
                    <td className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoeda(p.tribEntradas)}</td>
                    <td className="text-right font-mono text-brand-700 dark:text-aurum-200">{fmtMoeda(p.tribSaidas)}</td>
                    <td className="text-right font-mono text-slate-500">{p.qtdEntradas + p.qtdSaidas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : modo === 'linha' ? (
          <div className="h-72">
            <Line
              data={{
                labels,
                datasets: [
                  { label: 'Base entradas', data: evo.map((p) => p.baseEntradas), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', fill: true, tension: 0.4, pointRadius: 3 },
                  { label: 'Base saídas', data: evo.map((p) => p.baseSaidas), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.4, pointRadius: 3 },
                  { label: 'IBS+CBS', data: evo.map((p) => p.tribEntradas + p.tribSaidas), borderColor: '#8b5cf6', borderDash: [6, 4], tension: 0.4, pointRadius: 3 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, padding: 10, color: '#64748b' } }, tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoeda(Number(ctx.raw))}` } } },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                  y: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoNfe(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                },
              }}
            />
          </div>
        ) : (
          <div className="h-72">
            <Bar
              data={{
                labels,
                datasets: [
                  { label: 'Entradas', data: evo.map((p) => p.baseEntradas), backgroundColor: '#3b82f6', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
                  { label: 'Saídas', data: evo.map((p) => p.baseSaidas), backgroundColor: '#10b981', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, padding: 10, color: '#64748b' } }, tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoeda(Number(ctx.raw))}`, afterLabel: (ctx) => { const p = evo[ctx.dataIndex]; return p ? ` IBS+CBS ${fmtMoeda((ctx.datasetIndex === 0 ? p.tribEntradas : p.tribSaidas))} · ${p.qtdEntradas + p.qtdSaidas} nota(s)` : '' } } } },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                  y: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoNfe(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                },
              }}
            />
          </div>
        )}
      </div>
    </Painel>
  )
}

/**
 * Confronto regime antigo × novo: ICMS+PIS+COFINS destacados nos itens
 * contra IBS+CBS estimados, mês a mês (barras lado a lado) + veredito.
 */
function RegimeAntigoVsNovo({ notas }: { notas: NotaXml[] }) {
  const evo = useMemo(() => evolucaoMensal(notas), [notas])
  const conf = useMemo(() => confrontoRegimes(notas), [notas])
  if (!notas.length || !evo.length) return null
  const variacao = conf.variacaoPct
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="calculadora" tom="amber" />
          Regime antigo × Reforma
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          ICMS + PIS + COFINS destacados × IBS + CBS estimados · diferença{' '}
          <strong className={conf.delta >= 0 ? 'text-red-600' : 'text-emerald-600'}>
            {conf.delta >= 0 ? '+' : ''}{fmtMoeda(conf.delta)}
            {variacao != null ? ` (${variacao >= 0 ? '+' : ''}${variacao.toFixed(1).replace('.', ',')}%)` : ''}
          </strong>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_240px]">
        <div className="h-64">
          <Bar
            data={{
              labels: evo.map((p) => p.rotulo),
              datasets: [
                { label: 'Antigo (ICMS+PIS+COFINS)', data: evo.map((p) => p.antigoEntradas + p.antigoSaidas), backgroundColor: '#94a3b8', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
                { label: 'Novo (IBS+CBS)', data: evo.map((p) => p.tribEntradas + p.tribSaidas), backgroundColor: '#3a5dff', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, padding: 10, color: '#64748b' } }, tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoeda(Number(ctx.raw))}` } } },
              scales: {
                x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                y: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoNfe(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
              },
            }}
          />
        </div>
        <div className="space-y-2 text-xs">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
            <div className="text-[10px] font-bold uppercase text-slate-500">Antigo destacado</div>
            <div className="font-mono text-base font-black">{fmtMoeda(conf.antigo)}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">ICMS {fmtMoeda(conf.icms)} · PIS/COFINS {fmtMoeda(conf.pisCofins)}</div>
          </div>
          <div className="rounded-xl bg-brand-50/60 p-3 dark:bg-brand-950/20">
            <div className="text-[10px] font-bold uppercase text-brand-600 dark:text-aurum-200">Novo estimado</div>
            <div className="font-mono text-base font-black text-brand-700 dark:text-aurum-200">{fmtMoeda(conf.novo)}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">IBS {fmtMoeda(conf.ibs)} · CBS {fmtMoeda(conf.cbs)}</div>
          </div>
          <p className="px-1 text-[10px] leading-relaxed text-slate-400">
            O antigo é o que o emitente destacou no XML; o novo é o cálculo pela legislação (LC 214/2025). Use para
            sentir o impacto da transição por competência.
          </p>
        </div>
      </div>
    </Painel>
  )
}

/** Rótulos de anexo da Reforma. */
const ROTULO_ANEXO: Record<string, string> = {
  isento: 'Integral',
  '0': 'Alíq. zero',
  '80': 'Red. 80%',
  '70': 'Red. 70%',
  '60': 'Red. 60%',
  '50': 'Red. 50%',
  '40': 'Red. 40%',
  '30': 'Red. 30%',
  misto: 'IBS≠CBS',
}

/**
 * Distribuição da Reforma: rosca por anexo/benefício + barras de CST e CFOP.
 * Três leituras complementares do mesmo filtro.
 */
function DistribuicaoReforma({ notas }: { notas: NotaXml[] }) {
  const anexo = useMemo(() => distribuicaoPorAnexo(notas), [notas])
  const csts = useMemo(() => topCstReforma(notas), [notas])
  const cfops = useMemo(() => topCfop(notas), [notas])
  if (!notas.length) return null
  const totalAnexo = anexo.reduce((s, l) => s + l.trib, 0)
  const CORES = ['#10b981', '#8b5cf6', '#f59e0b', '#3b82f6', '#94a3b8', '#06b6d4']
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-emerald-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="rosca" tom="emerald" />
            Por benefício
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">IBS+CBS por anexo</p>
        </div>
        <div className="relative h-64 p-4">
          {totalAnexo > 0 ? (
            <>
              <Doughnut
                data={{
                  // BLINDAGEM: faixas derivadas usam o rótulo de redução;
                  // anexos oficiais (ex.: `9`) usam o rótulo oficial
                  // (`Anexo IX — LC 214/2025`), nunca o valor cru.
                  labels: anexo.map((l) => ROTULO_ANEXO[l.anexo] ?? rotuloAnexoOficial(l.anexo)),
                  datasets: [{ data: anexo.map((l) => l.trib), backgroundColor: CORES, hoverOffset: 10, borderWidth: 3, borderColor: '#ffffff', spacing: 2, borderRadius: 6 }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: '68%',
                  plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true, padding: 12, color: '#64748b' } },
                    tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => { const v = Number(ctx.raw) || 0; const pct = totalAnexo > 0 ? ((v / totalAnexo) * 100).toFixed(1).replace('.', ',') : '0,0'; return ` ${fmtMoeda(v)} (${pct}%)` }, afterLabel: (ctx) => { const l = anexo[ctx.dataIndex]; return l ? ` ${l.itens} item(ns) · base ${fmtCompactoNfe(l.base)}` : '' } } },
                  },
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[calc(100%-52px)] flex-col items-center justify-center">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">IBS+CBS</span>
                <span className="text-lg font-black text-slate-800 dark:text-slate-100">{fmtCompactoNfe(totalAnexo)}</span>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem tributos no filtro.</div>
          )}
        </div>
      </Painel>

      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="trofeu" tom="brand" />
            Por CST da Reforma
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top {csts.length || 6} · IBS+CBS</p>
        </div>
        <div className="h-64 p-4">
          {csts.length ? (
            <Bar
              data={{ labels: csts.map((c) => c.rotulo), datasets: [{ data: csts.map((c) => c.trib), backgroundColor: '#3a5dff', borderRadius: 7, borderSkipped: false, maxBarThickness: 22 }] }}
              options={{
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}`, afterLabel: (ctx) => { const c = csts[ctx.dataIndex]; return c ? ` ${c.sub} · ${c.qtd} item(ns)` : '' } } } },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 4, callback: (v) => fmtCompactoNfe(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                  y: { ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' }, grid: { display: false }, border: { display: false } },
                },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem CST no filtro.</div>
          )}
        </div>
      </Painel>

      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="caixa" tom="amber" />
            Por CFOP
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top {cfops.length || 6} · valor da operação</p>
        </div>
        <div className="h-64 p-4">
          {cfops.length ? (
            <Bar
              data={{ labels: cfops.map((c) => c.rotulo.replace('CFOP ', '')), datasets: [{ data: cfops.map((c) => c.base), backgroundColor: '#f59e0b', borderRadius: 7, borderSkipped: false, maxBarThickness: 22 }] }}
              options={{
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_ESCURO_NFE, callbacks: { label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}`, afterLabel: (ctx) => { const c = cfops[ctx.dataIndex]; return c ? ` ${c.qtd} item(ns) · IBS+CBS ${fmtMoeda(c.trib)}` : '' } } } },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 4, callback: (v) => fmtCompactoNfe(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                  y: { ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' }, grid: { display: false }, border: { display: false } },
                },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem CFOP no filtro.</div>
          )}
        </div>
      </Painel>
    </div>
  )
}

/**
 * Top NCMs + qualidade do XML: duas leituras tabulares lado a lado —
 * onde está o dinheiro (NCM) e o quanto o XML já vem com IBS/CBS.
 */
function TopNcmCfop({ notas }: { notas: NotaXml[] }) {
  const linhas = useMemo(() => topNcm(notas, 8), [notas])
  if (!notas.length) return null
  const max = linhas.reduce((m, l) => Math.max(m, l.base), 0)
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="lupa" tom="brand" />
          Top NCMs por valor
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          Onde está concentrada a base · top {linhas.length || 8} do filtro
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2">
        {!linhas.length ? (
          <p className="py-4 text-center text-[11px] text-slate-500 md:col-span-2">Sem itens no filtro.</p>
        ) : linhas.map((l, i) => (
          <div key={l.chave} className="rounded-lg border border-transparent p-2 transition-all hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-950/40" title={`${l.sub ?? ''} · IBS+CBS ${fmtMoeda(l.trib)}`}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
                <span className="truncate font-mono font-bold">{fmtNcm(l.rotulo)}</span>
                <span className="truncate text-slate-400">{l.sub}</span>
              </span>
              <span className="shrink-0 font-mono font-bold text-brand-700 dark:text-aurum-200">{fmtMoeda(l.base)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <BarraAnimada
                pct={max > 0 ? (l.base / max) * 100 : 0}
                className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
              <span className="font-mono">{l.qtd} item(ns)</span>
              <span className="font-mono">IBS+CBS <strong className="text-emerald-700 dark:text-emerald-400">{fmtMoeda(l.trib)}</strong></span>
            </div>
          </div>
        ))}
      </div>
    </Painel>
  )
}

/**
 * Qualidade dos XMLs: quanto já traz o grupo IBSCBS, taxa de conferência
 * com a legislação e quantas leituras diferem — termômetro da prontidão para 2026.
 */
function QualidadeXml({ notas }: { notas: NotaXml[] }) {
  const q = useMemo(() => resumoDivergencias(notas), [notas])
  if (!notas.length) return null
  const pctXml = q.totalItens > 0 ? (q.comXml / q.totalItens) * 100 : 0
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-emerald-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="alerta" tom="emerald" />
          Prontidão dos XMLs para a Reforma
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          {q.comXml} de {q.totalItens} item(ns) com grupo IBSCBS ·{' '}
          {q.taxaConferencia != null ? `${q.taxaConferencia.toFixed(1).replace('.', ',')}% conferem com a legislação` : 'nenhum XML com IBS/CBS ainda'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-950/40">
          <div className="font-mono text-xl font-black">{q.totalItens}</div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Itens</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-950/40">
          <div className="font-mono text-xl font-black text-brand-700 dark:text-aurum-200">{pctXml.toFixed(0)}%</div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Com IBSCBS</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
          <div className="font-mono text-xl font-black text-emerald-700 dark:text-emerald-300">{q.conferem}</div>
          <div className="text-[10px] font-bold uppercase text-emerald-600">Conferem ✓</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${q.divergentes ? 'bg-brand-50 dark:bg-brand-950/30' : 'bg-slate-50 dark:bg-slate-950/40'}`}>
          <div className={`font-mono text-xl font-black ${q.divergentes ? 'text-brand-700 dark:text-aurum-200' : ''}`}>{q.divergentes}</div>
          <div className="text-[10px] font-bold uppercase text-slate-500">A comparar ⇄</div>
        </div>
      </div>
      {q.divergentes > 0 ? (
        <p className="px-5 pb-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Abra a nota e confira as colunas <strong>No XML × Pela legislação</strong> — geralmente é o CST/cClassTrib
          do emitente diferente da base oficial ou valores calculados com outra alíquota-base de referência.
        </p>
      ) : null}
    </Painel>
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
            <span className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Produtos / serviços ({nota.itensAnalisados.length}) <SeloSTNota itens={nota.itensAnalisados} /></span>
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
                  <th className="px-3 py-2.5 text-right font-extrabold">Legislação · est.</th>
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
                        <SeloST cest={it.cest} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{fmtNum(it.qtd)} {it.unid}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold">{fmtMoeda(it.vlTotal)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-emerald-700" title={it.cstIbsCbs || it.cClassTribIbsCbs ? `XML: CST ${it.cstIbsCbs || '—'} · ${it.cClassTribIbsCbs || '—'}` : 'Sem grupo IBSCBS neste item'}>{ibsCbs > 0 ? fmtMoeda(ibsCbs) : <span className="text-slate-300">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-brand-700" title={`Pela legislação: CST ${it.classificacao.cst} · ${it.classificacao.cClassTrib}${it.manual || it.classificacao.manual ? ' · manual' : ''}`}>{fmtMoeda(it.totalTributos)}</td>
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
          fiscal válido é o XML da chave acima. Cálculo pela legislação:
          IBS {fmtMoeda(nota.totalIBS)} + CBS {fmtMoeda(nota.totalCBS)} (refs {nota.refIBS}% / {nota.refCBS}%).
          ICMS {fmtMoeda(totaisAnteriores.icms)} · PIS + COFINS {fmtMoeda(totaisAnteriores.pisCofins)} no botão Tributos de cada item.
        </div>
      </div>
    </Modal>
    <ModalItemNfeDetalhe item={itemDetalhe} onFechar={() => setItemDetalhe(null)} />
    </>
  )
}
