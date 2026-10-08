/**
 * <GraficosDAS /> — gráficos presentacionais do Simples Nacional.
 *
 * Componente PURO: não calcula nada fiscal, não faz fetch, não lê store.
 * Todos os valores chegam por props (já calculados em `src/simples/calculo.ts`).
 *
 * - "Para onde vai o DAS": Doughnut da repartição FINAL por tributo.
 * - "Bruto × guia por tributo": barras Bruto × Guia por tributo.
 */
import { useMemo } from 'react';
import {
  type ChartOptions,
} from 'chart.js';
import { garantirChartsRegistrados } from '@/ui/chart-registry';
import { Bar, Doughnut } from 'react-chartjs-2';
import { fmtMoeda } from '@/domain/services/format';
import type { Reparticao } from './calculo';
import type { TributoSimples } from './tabelas';

garantirChartsRegistrados();

export interface GraficosDASProps {
  final: Reparticao;
  bruta?: Reparticao;
  dasBruto: number;
  dasFinal: number;
  temST: boolean;
}

const ORDEM_TRIBUTOS: TributoSimples[] = ['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'];

const COR_TRIBUTO: Record<TributoSimples, string> = {
  IRPJ: '#2b3f63',
  CSLL: '#475569',
  CBS: '#be9433',
  IBS: '#eab308',
  CPP: '#047857',
  ICMS: '#0284c7',
  IPI: '#7c3aed',
  ISS: '#e11d48',
};

const COR_BRUTO = '#94a3b8';
const COR_GUIA = '#be9433';

/** Tributos com valor residual (arredondamento) são ocultados. */
const LIMIAR = 0.005;

function reduzMovimento(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fmtPct(v: number): string {
  return `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`;
}

export function GraficosDAS({ final, bruta, dasBruto, dasFinal, temST }: GraficosDASProps) {
  const semAnimacao = reduzMovimento();
  const animacao = semAnimacao ? false : { duration: 450, easing: 'easeInOutQuart' as const };

  const tributosDoughnut = useMemo(
    () => ORDEM_TRIBUTOS.filter((t) => (Number(final[t]) || 0) > LIMIAR),
    [final],
  );

  const tributosBarra = useMemo(
    () =>
      ORDEM_TRIBUTOS.filter(
        (t) => (Number(final[t]) || 0) > LIMIAR || (Number(bruta?.[t]) || 0) > LIMIAR,
      ),
    [final, bruta],
  );

  const dadosDoughnut = useMemo(
    () => ({
      labels: tributosDoughnut,
      datasets: [
        {
          data: tributosDoughnut.map((t) => Number(final[t]) || 0),
          backgroundColor: tributosDoughnut.map((t) => COR_TRIBUTO[t]),
          borderWidth: 0,
          spacing: 3,
          hoverOffset: 6,
        },
      ],
    }),
    [tributosDoughnut, final],
  );

  const opcoesDoughnut = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: animacao,
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 } },
        },
        tooltip: {
          padding: 10,
          cornerRadius: 10,
          callbacks: {
            label: (c) => {
              const v = Number(c.parsed) || 0;
              const pct = dasFinal > 0 ? fmtPct((v / dasFinal) * 100) : fmtPct(0);
              return ` ${c.label}: ${fmtMoeda(v)} (${pct})`;
            },
          },
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dasFinal, semAnimacao],
  );

  const dadosBarra = useMemo(
    () => ({
      labels: tributosBarra,
      datasets: temST
        ? [
            {
              label: 'Bruto',
              data: tributosBarra.map((t) => Number(bruta?.[t]) || 0),
              backgroundColor: COR_BRUTO,
              borderRadius: 4,
            },
            {
              label: 'Guia',
              data: tributosBarra.map((t) => Number(final[t]) || 0),
              backgroundColor: COR_GUIA,
              borderRadius: 4,
            },
          ]
        : [
            {
              label: 'Guia',
              data: tributosBarra.map((t) => Number(final[t]) || 0),
              backgroundColor: COR_GUIA,
              borderRadius: 4,
            },
          ],
    }),
    [tributosBarra, final, bruta, temST],
  );

  const opcoesBarra = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: animacao,
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 } },
        },
        tooltip: {
          padding: 10,
          cornerRadius: 10,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmtMoeda(Number(c.parsed.y))}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grace: '12%',
          grid: { color: 'rgba(100,116,139,0.16)' },
          ticks: { font: { size: 12 }, maxTicksLimit: 5 },
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [semAnimacao],
  );

  return (
    <div className={`grid grid-cols-1 gap-3 ${temST ? 'md:grid-cols-2' : ''}`}>
      <figure className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
        <figcaption className="mb-1 text-[13px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
          Para onde vai o DAS
        </figcaption>
        <div className="mb-2 font-mono text-[13px] tabular-nums text-slate-600 dark:text-slate-300">
          Guia {fmtMoeda(dasFinal)}
        </div>
        <div className="h-[280px]">
          <Doughnut data={dadosDoughnut} options={opcoesDoughnut} />
        </div>
      </figure>
      {temST ? (
      <figure className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
        <figcaption className="mb-1 text-[13px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
          Bruto × guia por tributo
        </figcaption>
        <div className="mb-2 font-mono text-[13px] tabular-nums text-slate-600 dark:text-slate-300">
          {temST ? (
            <>
              Bruto {fmtMoeda(dasBruto)} × Guia {fmtMoeda(dasFinal)}
            </>
          ) : (
            <>Guia {fmtMoeda(dasFinal)}</>
          )}
        </div>
        <div className="h-[280px]">
          <Bar data={dadosBarra} options={opcoesBarra} />
        </div>
      </figure>
      ) : null}
    </div>
  );
}
