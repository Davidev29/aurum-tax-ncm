/**
 * <GraficosDAS /> — gráficos presentacionais do Simples Nacional.
 *
 * Componente PURO: não calcula nada fiscal, não faz fetch, não lê store.
 * Todos os valores chegam por props (já calculados em `src/simples/calculo.ts`).
 *
 * Modos de visualização (escolha do usuário, sem recálculo):
 * - "Rosca": Doughnut da repartição FINAL por tributo.
 * - "Pizza": Pie da repartição FINAL por tributo.
 * - "Barras": barras por tributo (Bruto × Guia com ST, só Guia sem ST),
 *   com alternância vertical/horizontal.
 * - "Tabela": leitura tabular acessível (tributo · valor · %).
 */
import { useMemo, useState } from 'react';
import {
  type ChartOptions,
} from 'chart.js';
import { garantirChartsRegistrados } from '@/ui/chart-registry';
import { Bar, Doughnut, Pie } from 'react-chartjs-2';
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

type ModoGrafico = 'rosca' | 'pizza' | 'barras' | 'tabela';

const MODOS: Array<{ id: ModoGrafico; rotulo: string; titulo: string }> = [
  { id: 'rosca', rotulo: 'Rosca', titulo: 'Gráfico de rosca — repartição final por tributo' },
  { id: 'pizza', rotulo: 'Pizza', titulo: 'Gráfico de pizza — repartição final por tributo' },
  { id: 'barras', rotulo: 'Barras', titulo: 'Gráfico de barras por tributo' },
  { id: 'tabela', rotulo: 'Tabela', titulo: 'Tabela de valores por tributo' },
];

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
  const [modo, setModo] = useState<ModoGrafico>('rosca');
  const [horizontal, setHorizontal] = useState(false);
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

  const dadosCirculares = useMemo(
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

  const opcoesCirculares = useMemo<ChartOptions<'doughnut'>>(
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

  const opcoesPie = useMemo(
    () => opcoesCirculares as unknown as ChartOptions<'pie'>,
    [opcoesCirculares],
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
              backgroundColor: tributosBarra.map((t) => COR_TRIBUTO[t]),
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
      indexAxis: horizontal ? ('y' as const) : ('x' as const),
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
            label: (c) => ` ${c.dataset.label}: ${fmtMoeda(Number(horizontal ? c.parsed.x : c.parsed.y))}`,
          },
        },
      },
      scales: horizontal
        ? {
            x: { beginAtZero: true, grace: '12%', grid: { color: 'rgba(100,116,139,0.16)' }, ticks: { font: { size: 12 }, maxTicksLimit: 5 } },
            y: { grid: { display: false }, ticks: { font: { size: 11 } } },
          }
        : {
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
    [semAnimacao, horizontal],
  );

  const linhasTabela = useMemo(
    () =>
      tributosDoughnut.map((t) => {
        const v = Number(final[t]) || 0;
        return { tributo: t, valor: v, pct: dasFinal > 0 ? (v / dasFinal) * 100 : 0, cor: COR_TRIBUTO[t] };
      }),
    [tributosDoughnut, final, dasFinal],
  );

  return (
    <section
      aria-label="Gráficos do DAS"
      className="relative z-0 isolate flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
            Para onde vai o DAS
          </h3>
          <p className="mt-0.5 truncate font-mono text-[13px] tabular-nums text-slate-600 dark:text-slate-300">
            {temST ? <>Bruto {fmtMoeda(dasBruto)} × Guia {fmtMoeda(dasFinal)}</> : <>Guia {fmtMoeda(dasFinal)}</>}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Modo de visualização do gráfico"
          className="flex shrink-0 flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
        >
          {MODOS.map((m) => {
            const ativo = modo === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={ativo}
                title={m.titulo}
                onClick={() => setModo(m.id)}
                className={`btn-press min-h-[36px] rounded-lg px-2.5 py-1 text-[13px] font-bold transition-all duration-200 ${
                  ativo
                    ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-aurum-200'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {m.rotulo}
              </button>
            );
          })}
        </div>
      </div>

      {modo === 'barras' ? (
        <div className="flex items-center justify-end gap-1 px-4 pt-2">
          <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">Orientação:</span>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {(['vertical', 'horizontal'] as const).map((o) => {
              const ativo = (o === 'horizontal') === horizontal;
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={ativo}
                  title={o === 'vertical' ? 'Barras verticais' : 'Barras horizontais'}
                  onClick={() => setHorizontal(o === 'horizontal')}
                  className={`min-h-[32px] rounded-md px-2 py-0.5 text-[13px] font-bold transition-all ${
                    ativo ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-aurum-200' : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {o === 'vertical' ? '↕' : '↔'}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col p-4">
        {modo === 'tabela' ? (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[280px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-left uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <th className="px-2 py-1.5 font-bold">Tributo</th>
                  <th className="px-2 py-1.5 text-right font-bold">Valor</th>
                  <th className="px-2 py-1.5 text-right font-bold">%</th>
                </tr>
              </thead>
              <tbody>
                {linhasTabela.map((l) => (
                  <tr key={l.tributo} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-2 py-1.5 font-semibold">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.cor }} aria-hidden="true" />
                      {l.tributo}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoeda(l.valor)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtPct(l.pct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--line)] font-black">
                  <td className="px-2 py-1.5">Guia</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoeda(dasFinal)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtPct(100)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="h-[280px] min-w-0 flex-1">
            {modo === 'rosca' ? (
              <Doughnut data={dadosCirculares} options={opcoesCirculares} />
            ) : modo === 'pizza' ? (
              <Pie data={dadosCirculares} options={opcoesPie} />
            ) : (
              <Bar data={dadosBarra} options={opcoesBarra} />
            )}
          </div>
        )}
        <p className="mt-2 truncate text-[13px] text-slate-600 dark:text-slate-300" title="Os valores do gráfico são os mesmos da guia DAS acima">
          {modo === 'rosca' || modo === 'pizza'
            ? 'Repartição final da guia — mesmos valores do bloco DAS.'
            : modo === 'barras'
              ? temST
                ? 'Bruto × guia por tributo — a diferença é a ST deduzida.'
                : 'Guia por tributo — mesmos valores do bloco DAS.'
              : 'Leitura tabular — mesmos valores do gráfico e da guia.'}
        </p>
      </div>
    </section>
  );
}
