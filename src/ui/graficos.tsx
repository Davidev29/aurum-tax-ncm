/**
 * Gráficos da tela **SPED Fiscal** (SPEC §4).
 *
 * Registram no Chart.js somente os elementos usados (doughnut + barras
 * horizontais), mantendo o bundle enxuto. A identidade usa gradientes suaves,
 * tooltips escuros arredondados e tipografia compacta — legível no claro e no
 * escuro — com valor total sobreposto no centro da rosca.
 */
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type Chart as ChartTipo,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { fmtMoeda } from '@/domain/services/format'
import { Painel } from '@/ui/kit'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

/** Ordem: Alíquota Zero, Redução 80%, 70%, 60%, 50%, 40%, 30%, IBS≠CBS, Sem redução. */
export const CORES_ANEXO = ['#10b981', '#ea580c', '#f97316', '#f59e0b', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#94a3b8'] as const
const CORES_ANEXO_SUAVE = ['#6ee7b7', '#fdba74', '#fdba74', '#fcd34d', '#7dd3fc', '#93c5fd', '#a5b4fc', '#c4b5fd', '#cbd5e1'] as const

const TOOLTIP_ESCURO = {
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

const fmtCompacto = (v: number): string =>
  v >= 1000000
    ? `R$ ${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : v >= 1000
      ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
      : fmtMoeda(v)

/** Preenchimento em degradê vertical a partir da cor base (barras). */
function degradêBarra(cor: string) {
  return (ctx: { chart: ChartTipo }) => {
    const { ctx: g, chartArea } = ctx.chart
    if (!chartArea) return cor
    const grad = g.createLinearGradient(chartArea.left, 0, chartArea.right, 0)
    grad.addColorStop(0, cor)
    grad.addColorStop(1, `${cor}b3`)
    return grad
  }
}

/** Distribuição de valor por anexo (rosca, total ao centro, legenda embaixo). */
export function GraficoAnexo({ rotulos, valores }: { rotulos: string[]; valores: number[] }) {
  const total = valores.reduce((s, v) => s + (Number(v) || 0), 0)
  if (!total) return <GraficoVazio mensagem="Sem valores para distribuir por anexo." />
  return (
    <div className="relative h-72">
      <Doughnut
        data={{
          labels: rotulos,
          datasets: [
            {
              data: valores,
              backgroundColor: [...CORES_ANEXO],
              hoverBackgroundColor: [...CORES_ANEXO],
              hoverOffset: 10,
              borderWidth: 3,
              borderColor: '#ffffff',
              spacing: 2,
              borderRadius: 6,
            },
          ],
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
                boxWidth: 10,
                boxHeight: 10,
                borderRadius: 3,
                useBorderRadius: true,
                padding: 12,
                color: '#64748b',
                generateLabels: (chart) => {
                  const base = ChartJS.defaults.plugins.legend.labels.generateLabels(chart)
                  return base.map((l, i) => ({
                    ...l,
                    text: `${rotulos[i]} · ${fmtCompacto(valores[i])}`,
                  }))
                },
              },
            },
            tooltip: {
              ...TOOLTIP_ESCURO,
              callbacks: {
                label: (ctx) => {
                  const v = Number(ctx.raw) || 0
                  const pct = total > 0 ? ((v / total) * 100).toFixed(1).replace('.', ',') : '0,0'
                  return ` ${fmtMoeda(v)} (${pct}%)`
                },
              },
            },
          },
          animation: { animateRotate: true, duration: 700 },
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[calc(100%-52px)] flex-col items-center justify-center">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Base total
        </span>
        <span className="text-xl font-black text-slate-800 dark:text-slate-100">
          {fmtCompacto(total)}
        </span>
      </div>
    </div>
  )
}

/** Top produtos por tributos (barras horizontais em degradê). */
export function GraficoTop({ rotulos, valores }: { rotulos: string[]; valores: number[] }) {
  if (!rotulos.length || !valores.some((v) => v > 0)) {
    return <GraficoVazio mensagem="Sem tributos apurados para ranquear produtos." />
  }
  const max = Math.max(...valores)
  return (
    <div className="h-72">
      <Bar
        data={{
          labels: rotulos,
          datasets: [
            {
              label: 'Tributos (R$)',
              data: valores,
              backgroundColor: degradêBarra('#3a5dff') as unknown as string,
              hoverBackgroundColor: '#2547f5',
              borderRadius: 7,
              borderSkipped: false,
              barThickness: 'flex' as const,
              maxBarThickness: 22,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              ...TOOLTIP_ESCURO,
              callbacks: {
                label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}`,
                afterLabel: (ctx) => {
                  const v = Number(ctx.raw) || 0
                  return max > 0 ? ` ${(100 * (v / max)).toFixed(0)}% do maior` : ''
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                font: { size: 9 },
                color: '#94a3b8',
                maxTicksLimit: 5,
                callback: (v) => fmtCompacto(Number(v)),
              },
              grid: { color: 'rgba(148, 163, 184, 0.14)' },
              border: { display: false },
            },
            y: {
              ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' },
              grid: { display: false },
              border: { display: false },
            },
          },
          animation: { duration: 700 },
        }}
      />
    </div>
  )
}

function GraficoVazio({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 text-center dark:bg-slate-950/40">
      <span className="text-3xl">📈</span>
      <p className="max-w-[220px] text-xs text-slate-500 dark:text-slate-400">{mensagem}</p>
    </div>
  )
}

/**
 * Par de gráficos do SPED (rosca por anexo + top produtos), exportado como
 * default para ser carregado com `React.lazy`: o Chart.js só entra quando a
 * análise de fato renderiza os gráficos.
 */
export default function GraficosSped({
  anexo,
  top,
}: {
  anexo: { rotulos: string[]; valores: number[] }
  top: { rotulos: string[]; valores: number[] }
}) {
  void CORES_ANEXO_SUAVE
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-emerald-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-sm dark:bg-emerald-950">
              📊
            </span>
            Distribuição por Anexo
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
            Base de cálculo por faixa de benefício fiscal
          </p>
        </div>
        <div className="p-5">
          <GraficoAnexo rotulos={anexo.rotulos} valores={anexo.valores} />
        </div>
      </Painel>
      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-sm dark:bg-brand-950">
              🏆
            </span>
            Top Produtos por Tributos
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
            IBS + CBS estimados por produto de saída
          </p>
        </div>
        <div className="p-5">
          <GraficoTop rotulos={top.rotulos} valores={top.valores} />
        </div>
      </Painel>
    </div>
  )
}
