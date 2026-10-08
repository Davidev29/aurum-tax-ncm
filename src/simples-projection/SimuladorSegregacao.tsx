/**
 * <SimuladorSegregacao /> — componente reutilizável do simulador visual.
 *
 * Props: recebe o `RelatorioProjecao` já calculado + callbacks de interação.
 * Não calcula nada fiscal: apenas visualiza com animações suaves (300–500ms),
 * números animados, timeline de payback com pulso e tabela condicional.
 *
 * Gráficos (Chart.js):
 * - Linhas: RBT12 mãe × nova × unificado
 * - Barras empilhadas: DAS mãe + nova × unificado
 * - Área: economia acumulada líquida
 * - Timeline: trilha horizontal com marco de virada/payback
 */
import { useMemo, useState } from 'react';
import {
  type ChartOptions,
} from 'chart.js';
import { garantirChartsRegistrados } from '@/ui/chart-registry';
import { Bar, Line } from 'react-chartjs-2';
import { AnimatePresence, motion } from 'framer-motion';
import { fmtCarga, fmtMoeda } from '@/domain/services/format';
import type { RelatorioProjecao } from './types';
import { calcularCustoProLabore } from './pro-labore';
import { NumeroAnimado } from './NumeroAnimado';

garantirChartsRegistrados();

function rotuloMes(mes: string): string {
  const [a, m] = mes.split('-');
  return `${m}/${String(a).slice(2)}`;
}

const OPCAO_BASE: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 450, easing: 'easeInOutQuart' },
  plugins: {
    legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 } } },
    tooltip: { padding: 10, cornerRadius: 10 },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
    y: { beginAtZero: true, grace: '12%', grid: { color: 'rgba(100,116,139,0.16)' }, ticks: { font: { size: 12 }, maxTicksLimit: 5 } },
  },
};

export function GraficoRBT12({ relatorio }: { relatorio: RelatorioProjecao }) {
  const dados = useMemo(
    () => ({
      labels: relatorio.serieMensal.map((l) => rotuloMes(l.mes)),
      datasets: [
        {
          label: `Mãe (Anexo ${relatorio.metadados.anexoMae})`,
          data: relatorio.serieMensal.map((l) => l.rbt12Mae),
          borderColor: '#2b3f63',
          backgroundColor: 'rgba(43,63,99,0.12)',
          fill: false,
          tension: 0.42,
          borderWidth: 2.5,
          pointRadius: 3,
        },
        {
          label: `Nova (Anexo ${relatorio.metadados.anexoNova})`,
          data: relatorio.serieMensal.map((l) => l.rbt12Nova),
          borderColor: '#be9433',
          backgroundColor: 'rgba(190,148,51,0.12)',
          fill: false,
          tension: 0.42,
          borderWidth: 2.5,
          pointRadius: 3,
        },
        {
          label: 'Unificado (ref.)',
          data: relatorio.serieMensal.map((l) => l.rbt12Ref ?? 0),
          borderColor: '#94a3b8',
          borderDash: [6, 4],
          fill: false,
          tension: 0.42,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    }),
    [relatorio],
  );
  const opcoes = useMemo<ChartOptions<'line'>>(
    () => ({
      ...OPCAO_BASE,
      plugins: {
        ...OPCAO_BASE.plugins,
        tooltip: {
          ...OPCAO_BASE.plugins?.tooltip,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmtMoeda(Number(c.parsed.y))}`,
            afterBody: (itens) => {
              const i = itens[0]?.dataIndex ?? 0;
              const l = relatorio.serieMensal[i];
              if (!l) return [];
              return [
                `Mãe: faixa ${l.faixaMae}ª · efetiva ${fmtCarga(l.aliquotaEfetivaMae * 100)}`,
                `Nova: faixa ${l.faixaNova}ª · efetiva ${fmtCarga(l.aliquotaEfetivaNova * 100)}`,
              ];
            },
          },
        },
      },
    }),
    [relatorio],
  );
  return (
    <figure className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
      <figcaption className="mb-2">
        <div className="text-[13px] font-black">RBT12 acumulada — mãe × nova × unificado</div>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">Janela deslizante [t-12, t-1] · nova usa média × 12 até 12 meses</div>
      </figcaption>
      <div className="h-[280px]">
        <Line data={dados} options={opcoes} />
      </div>
    </figure>
  );
}

export function GraficoImpostoEmpilhado({ relatorio }: { relatorio: RelatorioProjecao }) {
  const dados = useMemo(
    () => ({
      labels: relatorio.serieMensal.map((l) => rotuloMes(l.mes)),
      datasets: [
        {
          label: 'DAS mãe',
          data: relatorio.serieMensal.map((l) => l.dasMae),
          backgroundColor: 'rgba(43,63,99,0.85)',
          borderRadius: 4,
          stack: 'div',
        },
        {
          label: 'DAS nova',
          data: relatorio.serieMensal.map((l) => l.dasNova),
          backgroundColor: 'rgba(190,148,51,0.85)',
          borderRadius: 4,
          stack: 'div',
        },
        {
          label: 'Unificado (ref.)',
          data: relatorio.serieMensal.map((l) => l.dasUnificadoReferencia),
          type: 'line' as const,
          borderColor: '#059669',
          backgroundColor: '#059669',
          borderDash: [5, 4],
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    [relatorio],
  );
  const opcoes = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 } } },
        tooltip: {
          padding: 10,
          cornerRadius: 10,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmtMoeda(Number(c.parsed.y))}`,
            footer: (itens) => {
              const i = itens[0]?.dataIndex ?? 0;
              const l = relatorio.serieMensal[i];
              if (!l) return '';
              return `Economia: ${fmtMoeda(l.economiaMes)} (bruta ${fmtMoeda(l.economiaBrutaMes ?? 0)} − custo ${fmtMoeda(l.custoMes ?? 0)})`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
        y: { stacked: false, beginAtZero: true, grace: '12%', grid: { color: 'rgba(100,116,139,0.16)' }, ticks: { font: { size: 12 }, maxTicksLimit: 5 } },
      },
    }),
    [relatorio],
  );
  return (
    <figure className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
      <figcaption className="mb-2">
        <div className="text-[13px] font-black">Imposto por empresa — barras empilhadas</div>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">Mãe + nova (empilhado) vs. unificado (linha)</div>
      </figcaption>
      <div className="h-[280px]">
        <Bar data={dados} options={opcoes} />
      </div>
    </figure>
  );
}

export function GraficoEconomiaArea({ relatorio }: { relatorio: RelatorioProjecao }) {
  const dados = useMemo(
    () => ({
      labels: relatorio.serieMensal.map((l) => rotuloMes(l.mes)),
      datasets: [
        {
          label: 'Economia acumulada (líquida)',
          data: relatorio.serieMensal.map((l) => l.economiaAcumulada),
          borderColor: '#059669',
          backgroundColor: 'rgba(5,150,105,0.22)',
          fill: true,
          tension: 0.42,
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#fff',
        },
      ],
    }),
    [relatorio],
  );
  return (
    <figure className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
      <figcaption className="mb-2">
        <div className="text-[13px] font-black">Economia acumulada líquida (após custos)</div>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">Cruza o zero no payback · área verde = ganho real</div>
      </figcaption>
      <div className="h-[280px]">
        <Line data={dados} options={OPCAO_BASE} />
      </div>
    </figure>
  );
}

/** Timeline horizontal animada com destaque no mês de virada/payback. */
export function TimelinePayback({ relatorio }: { relatorio: RelatorioProjecao }) {
  const { mesVirada, mes } = relatorio.payback;
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]" role="list" aria-label="Linha do tempo do retorno">
      <div className="mb-2 text-[13px] font-black">Timeline — mês a mês até o retorno</div>
      <ol className="flex items-center gap-1 overflow-x-auto pb-1">
        {relatorio.serieMensal.map((l) => {
          const ehVirada = mesVirada != null && l.mes === mesVirada;
          const ehPayback = mes != null && l.mes === mes;
          const positiva = l.economiaMes > 0;
          return (
            <li key={l.mes} className="flex min-w-14 flex-col items-center gap-1" title={`${l.mes} · economia ${fmtMoeda(l.economiaMes)} · acumulada ${fmtMoeda(l.economiaAcumulada)}`}>
              <motion.span
                layout
                transition={{ duration: 0.35, ease: 'easeInOut' }}
                className={`grid h-11 w-11 place-items-center rounded-full border text-[13px] font-black tabular-nums ${
                  ehPayback
                    ? 'animate-pulse border-emerald-500 bg-emerald-500 text-white shadow-[0_0_18px_rgba(5,150,105,0.65)]'
                    : ehVirada
                      ? 'border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                      : positiva
                        ? 'border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-red-600/30 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200'
                }`}
              >
                {rotuloMes(l.mes)}
              </motion.span>
              <span className={`font-mono text-[13px] tabular-nums ${positiva ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                {positiva ? '▲' : '▼'} {fmtMoeda(Math.abs(l.economiaMes)).replace('R$', '').trim()}
              </span>
              {ehPayback ? <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[12px] font-black uppercase text-white">payback</span> : null}
              {ehVirada && !ehPayback ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[12px] font-black uppercase text-emerald-900">virada</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Tabela mês a mês com cores condicionais + tooltip de memória de cálculo. */
export function TabelaMensal({ relatorio }: { relatorio: RelatorioProjecao }) {
  const [mesDetalhe, setMesDetalhe] = useState<string | null>(null);
  const linha = relatorio.serieMensal.find((l) => l.mes === mesDetalhe) ?? null;
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-[var(--line)] bg-white dark:bg-slate-900">
      <div className="px-3 py-2">
        <div className="text-[13px] font-black">Memória de cálculo — mês a mês</div>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">Passe o mouse ou toque para ver o detalhamento · verde = economia, vermelho = custo extra</div>
      </div>
      <div className="overflow-x-auto border-t border-[var(--line)]">
        <table className="tbl tbl-compacta simples-tabela w-full min-w-[760px]">
          <thead>
            <tr>
              <th scope="col">Mês</th>
              <th scope="col" className="th-r">RBT12 mãe</th>
              <th scope="col" className="th-r">RBT12 nova</th>
              <th scope="col" className="th-r">DAS mãe+nova</th>
              <th scope="col" className="th-r">DAS unificado</th>
              <th scope="col" className="th-r">Economia mês</th>
              <th scope="col" className="th-r">Acumulada</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {relatorio.serieMensal.map((l) => {
              const positiva = l.economiaMes >= 0;
              const ehPayback = relatorio.payback.mes === l.mes;
              return (
                <tr
                  key={l.mes}
                  onMouseEnter={() => setMesDetalhe(l.mes)}
                  onClick={() => setMesDetalhe(l.mes)}
                  className={`cursor-pointer border-t border-[var(--line)] transition-colors duration-300 ${
                    ehPayback ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <td className="font-sans font-bold">
                    {rotuloMes(l.mes)}
                    {ehPayback ? <span className="ml-1 rounded-full bg-emerald-600 px-1.5 py-0.5 align-middle text-[12px] font-black uppercase text-white">✦ payback</span> : null}
                  </td>
                  <td className="num text-right">{fmtMoeda(l.rbt12Mae)}</td>
                  <td className="num text-right">{fmtMoeda(l.rbt12Nova)}</td>
                  <td className="num text-right">{fmtMoeda(l.dasMae + l.dasNova)}</td>
                  <td className="num text-right text-slate-500">{fmtMoeda(l.dasUnificadoReferencia)}</td>
                  <td className={`num text-right font-black ${positiva ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                    {positiva ? '− ' : '+ '}{fmtMoeda(Math.abs(l.economiaMes))}
                  </td>
                  <td className={`num text-right font-black ${l.economiaAcumulada >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                    {fmtMoeda(l.economiaAcumulada)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AnimatePresence>
        {linha ? (
          <motion.div
            key={linha.mes}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="overflow-hidden border-t border-[var(--line)] bg-slate-50/70 dark:bg-slate-950/40"
          >
            <div className="px-3 py-2 font-mono text-[13px] leading-relaxed tabular-nums">
              <strong>{linha.mes}</strong> · receita mãe {fmtMoeda(linha.receitaMae)} (faixa {linha.faixaMae}ª, efetiva {fmtCarga(linha.aliquotaEfetivaMae * 100)}, DAS {fmtMoeda(linha.dasMae)})
              {' '} + nova {fmtMoeda(linha.receitaNova)} (faixa {linha.faixaNova}ª, efetiva {fmtCarga(linha.aliquotaEfetivaNova * 100)}, DAS {fmtMoeda(linha.dasNova)})
              {' '} vs. unificado {fmtMoeda(linha.dasUnificadoReferencia)} (faixa {linha.faixaRef}ª)
              {' '} → bruta {fmtMoeda(linha.economiaBrutaMes ?? 0)} − custo {fmtMoeda(linha.custoMes ?? 0)} = <strong>{fmtMoeda(linha.economiaMes)}</strong> · acumulada {fmtMoeda(linha.economiaAcumulada)}
              {(linha.detalheMae?.length ?? 0) > 1 || (linha.detalheNova?.length ?? 0) > 1 ? (
                <span className="mt-1 block">
                  Segregação: mãe {(linha.detalheMae ?? []).map((d) => `${fmtMoeda(d.receitaMes)} no ${d.anexoId} (faixa ${d.faixa}ª, ${fmtCarga(d.aliquotaEfetiva * 100)} → ${fmtMoeda(d.das)})`).join(' + ') || '—'}
                  {' '}· nova {(linha.detalheNova ?? []).map((d) => `${fmtMoeda(d.receitaMes)} no ${d.anexoId} (faixa ${d.faixa}ª, ${fmtCarga(d.aliquotaEfetiva * 100)} → ${fmtMoeda(d.das)})`).join(' + ') || '—'}
                </span>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Cabeçalho de veredito com número animado + pulso no payback. */
export function VereditoHero({ relatorio }: { relatorio: RelatorioProjecao }) {
  const v = relatorio.payback.veredito;
  const cls =
    v === 'compensa'
      ? 'border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
      : v === 'empate-tecnico'
        ? 'border-amber-600/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
        : 'border-red-600/40 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100';
  const titulo = v === 'compensa' ? '✓ Compensa abrir a nova empresa' : v === 'empate-tecnico' ? '≈ Empate técnico' : '✕ Não compensa';
  return (
    <motion.div layout transition={{ duration: 0.4, ease: 'easeInOut' }} className={`rounded-2xl border px-4 py-3 ${cls}`} role="status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black tracking-tight">{titulo}</div>
          <div className="mt-0.5 text-[13px] opacity-80">
            {relatorio.payback.mesVirada ? <>Virada no {rotuloMes(relatorio.payback.mesVirada)} ({relatorio.payback.mesesAteVirada}º mês) · </> : <>Sem virada mensal · </>}
            {relatorio.payback.mes ? <>payback em {rotuloMes(relatorio.payback.mes)} ({relatorio.payback.mesesAtePayback}º mês)</> : <>sem payback no horizonte</>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[13px] font-bold uppercase tracking-widest opacity-70">Economia líquida total</div>
          <NumeroAnimado
            valor={relatorio.economiaTotal}
            formatar={(n) => fmtMoeda(n)}
            className="block font-mono text-xl font-black tabular-nums"
          />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Projeção por empresa — como receita, RBT12, faixa e DAS evoluem mês a mês
 * em cada empresa. Um cartão por empresa: KPIs do período + mini gráfico
 * (receita em barras × RBT12 em linha) + tabela mensal expansível.
 */
type LadoEmpresa = 'mae' | 'nova';

function dadosLado(relatorio: RelatorioProjecao, lado: LadoEmpresa) {
  return relatorio.serieMensal.map((l) => ({
    mes: l.mes,
    receita: lado === 'mae' ? l.receitaMae : l.receitaNova,
    rbt12: lado === 'mae' ? l.rbt12Mae : l.rbt12Nova,
    faixa: lado === 'mae' ? l.faixaMae : l.faixaNova,
    efetiva: lado === 'mae' ? l.aliquotaEfetivaMae : l.aliquotaEfetivaNova,
    nominal: lado === 'mae' ? l.aliquotaNominalMae : l.aliquotaNominalNova,
    das: lado === 'mae' ? l.dasMae : l.dasNova,
  }));
}

function MiniGraficoEmpresa({ relatorio, lado, corBarra, corLinha }: { relatorio: RelatorioProjecao; lado: LadoEmpresa; corBarra: string; corLinha: string }) {
  const linhas = dadosLado(relatorio, lado);
  const dados = useMemo(
    () => ({
      labels: linhas.map((l) => rotuloMes(l.mes)),
      datasets: [
        {
          type: 'bar' as const,
          label: 'Receita do mês',
          data: linhas.map((l) => l.receita),
          backgroundColor: corBarra,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          type: 'line' as const,
          label: 'RBT12',
          data: linhas.map((l) => l.rbt12),
          borderColor: corLinha,
          borderWidth: 2.5,
          pointRadius: 2.5,
          tension: 0.42,
          yAxisID: 'y1',
        },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relatorio, lado],
  );
  const opcoes = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 } } },
        tooltip: {
          padding: 10,
          cornerRadius: 10,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmtMoeda(Number(c.parsed.y))}`,
            footer: (itens) => {
              const i = itens[0]?.dataIndex ?? 0;
              const l = linhas[i];
              if (!l) return '';
              return `Faixa ${l.faixa}ª · efetiva ${fmtCarga(l.efetiva * 100)} · DAS ${fmtMoeda(l.das)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
        y: { beginAtZero: true, grace: '12%', grid: { color: 'rgba(100,116,139,0.16)' }, ticks: { font: { size: 12 }, maxTicksLimit: 4 } },
        y1: { beginAtZero: true, grace: '12%', position: 'right' as const, grid: { display: false }, ticks: { font: { size: 12 }, maxTicksLimit: 4 } },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relatorio, lado],
  );
  return (
    <div className="h-[280px]">
      <Bar data={dados} options={opcoes} />
    </div>
  );
}

function CartaoEmpresa({ relatorio, lado }: { relatorio: RelatorioProjecao; lado: LadoEmpresa }) {
  const [expandida, setExpandida] = useState(false);
  const linhas = dadosLado(relatorio, lado);
  const anexo = lado === 'mae' ? relatorio.metadados.anexoMae : relatorio.metadados.anexoNova;
  const receitaTotal = linhas.reduce((a, l) => a + l.receita, 0);
  const dasTotal = linhas.reduce((a, l) => a + l.das, 0);
  const rbt12Ini = linhas[0]?.rbt12 ?? 0;
  const rbt12Fim = linhas[linhas.length - 1]?.rbt12 ?? 0;
  const delta = rbt12Fim - rbt12Ini;
  const ehMae = lado === 'mae';
  const titulo = ehMae ? 'Empresa-mãe' : 'Nova empresa';
  const corBarra = ehMae ? 'rgba(43,63,99,0.75)' : 'rgba(190,148,51,0.75)';
  const corLinha = ehMae ? '#2b3f63' : '#be9433';
  const faixaIni = linhas[0]?.faixa;
  const faixaFim = linhas[linhas.length - 1]?.faixa;

  return (
    <article className={`rounded-2xl border bg-white p-3 dark:bg-slate-900 ${ehMae ? 'border-[#2b3f63]/30' : 'border-[#be9433]/40'}`}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`grid h-11 w-11 place-items-center rounded-full text-[13px] font-black text-white ${ehMae ? 'bg-[#2b3f63]' : 'bg-[#be9433]'}`}>
          {ehMae ? 'M' : 'N'}
        </span>
        <div>
          <div className="text-[13px] font-black">{titulo} · Anexo {anexo}</div>
          <div className="font-mono text-[13px] tabular-nums text-slate-600 dark:text-slate-300">
            RBT12 {fmtMoeda(rbt12Ini)} → {fmtMoeda(rbt12Fim)}{' '}
            <span className={delta >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}>
              ({delta >= 0 ? '▲' : '▼'} {fmtMoeda(Math.abs(delta))})
            </span>
            {' '}· faixa {faixaIni}ª → {faixaFim}ª
          </div>
        </div>
        <div className="ml-auto flex gap-2 text-right">
          <div>
            <div className="text-[13px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">Receita período</div>
            <NumeroAnimado valor={receitaTotal} formatar={(n) => fmtMoeda(n)} className="block font-mono text-sm font-black tabular-nums" />
          </div>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">DAS período</div>
            <NumeroAnimado valor={dasTotal} formatar={(n) => fmtMoeda(n)} className="block font-mono text-sm font-black tabular-nums" />
          </div>
        </div>
      </header>
      <MiniGraficoEmpresa relatorio={relatorio} lado={lado} corBarra={corBarra} corLinha={corLinha} />
      <button
        type="button"
        onClick={() => setExpandida((v) => !v)}
        aria-expanded={expandida}
        className="mt-2 min-h-[44px] w-full rounded-xl border border-[var(--line)] px-3 py-1.5 text-[13px] font-bold text-slate-600 transition-all duration-300 hover:border-brand-700 hover:text-brand-700 dark:text-slate-300"
      >
        {expandida ? '▾ Ocultar mês a mês' : '▸ Ver mês a mês da ' + (ehMae ? 'mãe' : 'nova')}
      </button>
      <AnimatePresence initial={false}>
        {expandida ? (
          <motion.div
            key="tab"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto pt-2">
              <table className="tbl tbl-compacta simples-tabela w-full min-w-[520px]">
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col" className="th-r">Receita</th>
                    <th scope="col" className="th-r">RBT12</th>
                    <th scope="col" className="th-r">Faixa</th>
                    <th scope="col" className="th-r">Efetiva</th>
                    <th scope="col" className="th-r">DAS</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {linhas.map((l, i) => {
                    const anterior = i > 0 ? linhas[i - 1]!.faixa : l.faixa;
                    const mudou = l.faixa !== anterior;
                    return (
                      <tr key={l.mes} className="border-t border-[var(--line)]" title={`${l.mes} · nominal ${l.nominal != null ? fmtCarga(l.nominal * 100) : '—'} · DAS ${fmtMoeda(l.das)}`}>
                        <td className="font-sans font-bold">
                          {rotuloMes(l.mes)}
                          {mudou ? (
                            <span className={`ml-1 rounded-full px-1.5 py-0.5 align-middle text-[12px] font-black uppercase ${l.faixa > anterior ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'}`} title={`Faixa ${anterior}ª → ${l.faixa}ª`}>
                              {l.faixa > anterior ? '▲ faixa' : '▼ faixa'}
                            </span>
                          ) : null}
                        </td>
                        <td className="num text-right">{fmtMoeda(l.receita)}</td>
                        <td className="num text-right">{fmtMoeda(l.rbt12)}</td>
                        <td className="num text-right">{l.faixa}ª</td>
                        <td className="num text-right">{fmtCarga(l.efetiva * 100)}</td>
                        <td className="num text-right font-bold">{fmtMoeda(l.das)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}

export function PaineisEmpresas({ relatorio }: { relatorio: RelatorioProjecao }) {
  return (
    <section aria-label="Projeção por empresa">
      <div className="mb-2 text-[13px] font-black">Projeção por empresa — como a RBT12 se comporta mês a mês</div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <CartaoEmpresa relatorio={relatorio} lado="mae" />
        <CartaoEmpresa relatorio={relatorio} lado="nova" />
      </div>
    </section>
  );
}

/**
 * Carga fiscal do período — resumo ANUAL (horizonte) + IR/INSS por empresa.
 *
 * Agrega mês a mês (Σ): DAS único × DAS dividido, custos da nova e encargos
 * do pró-labore sugerido para manter 28% (INSS 11% + IRPF tabela 2026 +
 * CPP patronal quando Anexo IV). Leitura: "quanto pago a mais ou a menos no
 * período, e quanto de folha/encargos cada empresa carrega".
 */
interface EncargosEmpresa {
  proLaboreExtra: number;
  inss: number;
  irpf: number;
  cpp: number;
  total: number;
}

function agregarEncargos(relatorio: RelatorioProjecao, lado: 'mae' | 'nova'): EncargosEmpresa {
  const linhas = relatorio.analiseFatorR?.linhas ?? [];
  const envolveIV = relatorio.metadados.anexoMae === 'IV' || relatorio.metadados.anexoNova === 'IV';
  const acc: EncargosEmpresa = { proLaboreExtra: 0, inss: 0, irpf: 0, cpp: 0, total: 0 };
  for (const l of linhas) {
    const d = l[lado];
    if (!d?.aplicaFatorR || !(d.proLaboreMensalSugerido > 0)) continue;
    try {
      const c = calcularCustoProLabore(d.proLaboreMensalSugerido, { envolveAnexoIV: envolveIV });
      acc.proLaboreExtra += d.proLaboreMensalSugerido;
      acc.inss += c.inss;
      acc.irpf += c.irpf;
      acc.cpp += c.cppPatronalPorFora;
      acc.total += c.inss + c.irpf + c.cppPatronalPorFora;
    } catch {
      /* mês inválido — ignora na soma */
    }
  }
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  return { proLaboreExtra: r2(acc.proLaboreExtra), inss: r2(acc.inss), irpf: r2(acc.irpf), cpp: r2(acc.cpp), total: r2(acc.total) };
}

export function PainelCargaFiscal({ relatorio }: { relatorio: RelatorioProjecao }) {
  const n = Math.max(1, relatorio.serieMensal.length);
  const dasUnico = relatorio.serieMensal.reduce((a, l) => a + l.dasUnificadoReferencia, 0);
  const dasMae = relatorio.serieMensal.reduce((a, l) => a + l.dasMae, 0);
  const dasNova = relatorio.serieMensal.reduce((a, l) => a + l.dasNova, 0);
  const diferenca = dasUnico - (dasMae + dasNova);
  const encMae = agregarEncargos(relatorio, 'mae');
  const encNova = agregarEncargos(relatorio, 'nova');
  const folhaMae = relatorio.metadados.folha12Mae ?? 0;
  const folhaNova = relatorio.metadados.folha12Nova ?? 0;
  const r2 = (v: number): number => Math.round(v * 100) / 100;

  const cards = [
    { rotulo: `DAS único (${n}m)`, valor: r2(dasUnico), neutro: true },
    { rotulo: `DAS dividido (${n}m)`, valor: r2(dasMae + dasNova), neutro: true },
    { rotulo: diferenca >= 0 ? 'Imposto a MENOS' : 'Imposto a MAIS', valor: r2(Math.abs(diferenca)), bom: diferenca >= 0, ruim: diferenca < 0 },
    { rotulo: 'Encargos pró-labore (INSS+IRPF)', valor: r2(encMae.total + encNova.total), neutro: true },
  ];

  return (
    <section aria-label="Carga fiscal do período" className="space-y-2 rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
      <div>
        <div className="text-[13px] font-black">Carga fiscal do período — anual ({n} meses)</div>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">Quanto de imposto vai pagar a mais ou a menos, e quanto de folha/encargos cada empresa carrega</div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.rotulo} className={`rounded-xl border px-3 py-2 ${c.bom ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30' : c.ruim ? 'border-red-600/40 bg-red-50 dark:bg-red-950/30' : 'border-[var(--line)]'}`}>
            <span className="block text-[13px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">{c.rotulo}</span>
            <NumeroAnimado valor={c.valor} formatar={(v) => fmtMoeda(v)} className={`block font-mono text-[15px] font-black tabular-nums ${c.bom ? 'text-emerald-700 dark:text-emerald-300' : c.ruim ? 'text-red-600 dark:text-red-300' : ''}`} />
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="tbl tbl-compacta simples-tabela w-full min-w-[640px]">
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col" className="th-r">DAS período</th>
              <th scope="col" className="th-r">Folha 12m</th>
              <th scope="col" className="th-r">Pró-labore extra Σ</th>
              <th scope="col" className="th-r">INSS Σ</th>
              <th scope="col" className="th-r">IRPF Σ</th>
              <th scope="col" className="th-r">DAS + encargos</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {([
              { nome: `Mãe (Anexo ${relatorio.metadados.anexoMae})`, das: dasMae, folha: folhaMae, enc: encMae },
              { nome: `Nova (Anexo ${relatorio.metadados.anexoNova})`, das: dasNova, folha: folhaNova, enc: encNova },
            ]).map((e) => (
              <tr key={e.nome} className="border-t border-[var(--line)]" title="Pró-labore extra = Σ mensal sugerido para manter 28% em todos os meses; INSS 11% + IRPF tabela 2026 sobre ele">
                <td className="font-sans font-bold">{e.nome}</td>
                <td className="num text-right">{fmtMoeda(r2(e.das))}</td>
                <td className="num text-right text-slate-500">{fmtMoeda(e.folha)}</td>
                <td className="num text-right">{fmtMoeda(e.enc.proLaboreExtra)}</td>
                <td className="num text-right">{fmtMoeda(e.enc.inss)}</td>
                <td className="num text-right">{fmtMoeda(e.enc.irpf)}{e.enc.cpp > 0 ? ` (+${fmtMoeda(e.enc.cpp)} CPP)` : ''}</td>
                <td className="num text-right font-black">{fmtMoeda(r2(e.das + e.enc.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        INSS 11% com teto do RGPS · IRPF pela tabela mensal 2026 (Leis 15.191 e 15.270/2025) sobre o pró-labore adicional · Anexos III/V já embutem o CPP no DAS — só o IV tem CPP patronal por fora.
      </p>
    </section>
  );
}

/**
 * Redução mensal animada — barras de economia mês a mês (verde = paga menos,
 * vermelho = paga mais) com marcadores de virada e payback. Responde de um
 * relance "quando começa a fazer sentido".
 */
export function GraficoReducaoMensal({ relatorio }: { relatorio: RelatorioProjecao }) {
  const { mesVirada, mes: mesPayback } = relatorio.payback;
  const dados = useMemo(
    () => ({
      labels: relatorio.serieMensal.map((l) => rotuloMes(l.mes)),
      datasets: [
        {
          type: 'bar' as const,
          label: 'Economia do mês',
          data: relatorio.serieMensal.map((l) => l.economiaMes),
          backgroundColor: relatorio.serieMensal.map((l) =>
            l.economiaMes >= 0 ? 'rgba(5,150,105,0.8)' : 'rgba(220,38,38,0.75)',
          ),
          borderRadius: 5,
        },
        {
          type: 'scatter' as const,
          label: 'Virada',
          data: relatorio.serieMensal.filter((l) => mesVirada != null && l.mes === mesVirada).map((l) => ({ x: rotuloMes(l.mes), y: l.economiaMes })),
          backgroundColor: '#be9433',
          pointRadius: 7,
          pointStyle: 'star' as const,
        },
        {
          type: 'scatter' as const,
          label: 'Payback',
          data: relatorio.serieMensal.filter((l) => mesPayback != null && l.mes === mesPayback).map((l) => ({ x: rotuloMes(l.mes), y: l.economiaMes })),
          backgroundColor: '#059669',
          pointRadius: 8,
          pointStyle: 'rectRot' as const,
        },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relatorio],
  );
  const opcoes = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 12 }, usePointStyle: true } },
        tooltip: {
          padding: 10,
          cornerRadius: 10,
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmtMoeda(Number(c.parsed.y))}`,
            footer: (itens) => {
              const label = itens[0]?.label;
              const l = relatorio.serieMensal.find((x) => rotuloMes(x.mes) === label);
              if (!l) return '';
              return `Acumulada: ${fmtMoeda(l.economiaAcumulada)} · DAS dividido ${fmtMoeda(l.dasMae + l.dasNova)} vs único ${fmtMoeda(l.dasUnificadoReferencia)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
        y: { grace: '15%', grid: { color: 'rgba(100,116,139,0.16)' }, ticks: { font: { size: 12 }, maxTicksLimit: 5 } },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relatorio],
  );
  return (
    <figure className="rounded-2xl border border-[var(--line)] bg-white p-6 dark:bg-slate-900 min-h-[320px]">
      <figcaption className="mb-2">
        <div className="text-[13px] font-black">Redução mensal — quando começa a fazer sentido</div>
        <div className="text-[13px] text-slate-600 dark:text-slate-300">
          Verde = paga menos que hoje · estrela dourada = virada · losango verde = payback
          {mesVirada ? ` · a partir de ${rotuloMes(mesVirada)}` : ' · sem virada no horizonte'}
        </div>
      </figcaption>
      <div className="h-[280px]">
        <Bar data={dados} options={opcoes} />
      </div>
    </figure>
  );
}

/**
 * Simulador completo reutilizável: veredito + 3 gráficos + timeline + tabela.
 * Envolva com o modo de comparação (única × segregada) no componente pai.
 */
export function SimuladorSegregacao({ relatorio }: { relatorio: RelatorioProjecao }) {
  return (
    <div className="space-y-3">
      <VereditoHero relatorio={relatorio} />
      <PainelCargaFiscal relatorio={relatorio} />
      <GraficoReducaoMensal relatorio={relatorio} />
      <TimelinePayback relatorio={relatorio} />
      <PaineisEmpresas relatorio={relatorio} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <GraficoRBT12 relatorio={relatorio} />
        <GraficoImpostoEmpilhado relatorio={relatorio} />
      </div>
      <GraficoEconomiaArea relatorio={relatorio} />
      <TabelaMensal relatorio={relatorio} />
    </div>
  );
}
