/**
 * Simples Projection — resultado reativo da divisão (componente PURO).
 *
 * Apenas formata `RelatorioProjecao` do motor. Nenhum cálculo fiscal aqui:
 * faixa, alíquota, DAS, economia e payback vêm de `simularCenarioDividido`.
 * Gráficos elegantes via `GraficoChatView` (Chart.js + relevo 3D do projeto),
 * reativos por `useMemo` — qualquer edição no modal recalcula e redesenha.
 */
import { useMemo } from 'react';
import { fmtCarga, fmtMoeda } from '@/domain/services/format';
import { GraficoChatView } from '@/ui/grafico-chat';
import { Painel } from '@/ui/kit';
import type { GraficoChat } from '@/application/aurum-ai-graficos';
import type { RelatorioProjecao } from './types';

function Kpi({ rotulo, valor, sub, destaque, alerta }: { rotulo: string; valor: string; sub?: string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${destaque ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30' : alerta ? 'border-red-600/40 bg-red-50 dark:bg-red-950/30' : 'border-[var(--line)] bg-white dark:bg-slate-900'}`}>
      <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">{rotulo}</span>
      <span className={`mt-1 block font-mono text-xl font-black tabular-nums ${destaque ? 'text-emerald-700 dark:text-emerald-300' : alerta ? 'text-red-700 dark:text-red-300' : ''}`}>{valor}</span>
      {sub ? <span className="mt-0.5 block text-[11px] text-slate-500">{sub}</span> : null}
    </div>
  );
}

function rotuloMes(mes: string): string {
  const [a, m] = mes.split('-');
  return `${m}/${String(a).slice(2)}`;
}

export function ResultadoDividido({ relatorio, custoMensalNova }: { relatorio: RelatorioProjecao; custoMensalNova: number }) {
  const serie = relatorio.serieMensal;

  const graficos = useMemo(() => {
    const labels = serie.map((l) => rotuloMes(l.mes));
    const aliqRef = serie.map((l) => (l.receitaTotal > 0 ? (l.dasUnificadoReferencia / l.receitaTotal) * 100 : 0));
    const somaDividida = serie.map((l) => Math.round((l.dasMae + l.dasNova) * 100) / 100);

    const gDas: GraficoChat = {
      titulo: 'DAS mensal — unificado × dividido',
      subtitulo: `Mãe (Anexo ${relatorio.metadados.anexoMae}) + Nova (Anexo ${relatorio.metadados.anexoNova})`,
      tipo: 'linha',
      labels,
      series: [
        { nome: 'Unificado (referência)', valores: serie.map((l) => l.dasUnificadoReferencia) },
        { nome: 'Dividido (mãe + nova, sem custo)', valores: somaDividida },
      ],
      unidade: 'moeda',
      insight: relatorio.economiaTotal >= 0 ? `Economia acumulada de ${fmtMoeda(relatorio.economiaTotal)} no horizonte.` : `Custo adicional de ${fmtMoeda(Math.abs(relatorio.economiaTotal))} no horizonte.`,
      colunas: ['Mês', 'Unificado (R$)', 'Dividido (R$)', 'Economia (R$)'],
      linhasTabela: serie.map((l) => [l.mes, l.dasUnificadoReferencia.toFixed(2), (l.dasMae + l.dasNova).toFixed(2), l.economiaMes.toFixed(2)]),
      alternativas: ['barra', 'tabela'],
      origem: 'simples-projection:das',
    };

    const gAliq: GraficoChat = {
      titulo: 'Alíquota efetiva mensal — queda por faixa',
      subtitulo: 'Efetiva = (RBT12 × nominal − dedução) ÷ RBT12 · motor `calculo.ts`',
      tipo: 'linha',
      labels,
      series: [
        { nome: 'Ref. unificada (%)', valores: aliqRef.map((v) => Math.round(v * 100) / 100) },
        { nome: `Mãe (%)`, valores: serie.map((l) => Math.round(l.aliquotaEfetivaMae * 100 * 100) / 100) },
        { nome: `Nova (%)`, valores: serie.map((l) => Math.round(l.aliquotaEfetivaNova * 100 * 100) / 100) },
      ],
      unidade: 'percent',
      insight: 'A nova empresa tende a operar em faixas iniciais — a curva dela revela a redução de alíquota.',
      colunas: ['Mês', 'Ref (%)', 'Mãe (%)', 'Nova (%)'],
      linhasTabela: serie.map((l, i) => [l.mes, aliqRef[i]!.toFixed(2), (l.aliquotaEfetivaMae * 100).toFixed(2), (l.aliquotaEfetivaNova * 100).toFixed(2)]),
      alternativas: ['barra', 'tabela'],
      origem: 'simples-projection:aliquota',
    };

    const gFaixa: GraficoChat = {
      titulo: 'Faixa mensal — mãe × nova',
      subtitulo: 'Faixa definida pelo RBT12 deslizante de cada empresa',
      tipo: 'barra',
      labels,
      series: [
        { nome: 'Faixa mãe', valores: serie.map((l) => l.faixaMae) },
        { nome: 'Faixa nova', valores: serie.map((l) => l.faixaNova) },
      ],
      unidade: 'numero',
      insight: undefined,
      colunas: ['Mês', 'Faixa mãe', 'Faixa nova'],
      linhasTabela: serie.map((l) => [l.mes, String(l.faixaMae), String(l.faixaNova)]),
      alternativas: ['linha', 'tabela'],
      origem: 'simples-projection:faixa',
    };

    const acum = serie.map((l) => l.economiaAcumulada);
    const gEcon: GraficoChat = {
      titulo: 'Economia mensal e acumulada (líquida de custos)',
      subtitulo: `Custo nova empresa ${fmtMoeda(custoMensalNova)}/mês já descontado`,
      tipo: 'linha',
      labels,
      series: [
        { nome: 'Economia mês', valores: serie.map((l) => l.economiaMes) },
        { nome: 'Acumulada', valores: acum },
      ],
      unidade: 'moeda',
      insight: relatorio.payback.mes ? `Payback em ${relatorio.payback.mes} (${relatorio.payback.mesesAtePayback}º mês).` : 'Sem payback no horizonte — o custo da nova empresa supera a economia de DAS.',
      colunas: ['Mês', 'Economia mês (R$)', 'Acumulada (R$)'],
      linhasTabela: serie.map((l) => [l.mes, l.economiaMes.toFixed(2), l.economiaAcumulada.toFixed(2)]),
      alternativas: ['barra', 'tabela'],
      origem: 'simples-projection:economia',
    };

    return { gDas, gAliq, gFaixa, gEcon };
  }, [serie, relatorio, custoMensalNova]);

  const economiaPositiva = relatorio.economiaTotal >= 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Kpi
          rotulo={economiaPositiva ? 'Economia total (líquida)' : 'Custo adicional total'}
          valor={`${economiaPositiva ? '' : '+ '}${fmtMoeda(Math.abs(relatorio.economiaTotal))}`}
          sub={economiaPositiva ? 'Dividido paga menos que o unificado' : 'Dividido paga mais (DAS + custos)'}
          destaque={economiaPositiva}
          alerta={!economiaPositiva}
        />
        <Kpi
          rotulo="Payback"
          valor={relatorio.payback.mes ? rotuloMes(relatorio.payback.mes) : '—'}
          sub={relatorio.payback.mes ? `${relatorio.payback.mesesAtePayback}º mês · ${fmtMoeda(relatorio.payback.valorAcumuladoNoPayback ?? 0)} acumulado` : 'Sem retorno no horizonte'}
        />
        <Kpi
          rotulo="Custo nova empresa"
          valor={fmtMoeda(custoMensalNova)}
          sub={`por mês · ${fmtMoeda(custoMensalNova * serie.length)} no horizonte (${serie.length}m)`}
        />
      </div>

      <GraficoChatView grafico={graficos.gDas} />
      <GraficoChatView grafico={graficos.gAliq} />
      <GraficoChatView grafico={graficos.gFaixa} />
      <GraficoChatView grafico={graficos.gEcon} />

      <Painel>
        <div className="border-b border-[var(--line)] px-5 py-3">
          <h3 className="text-sm font-black tracking-tight">Redução de faixa e alíquota — mês a mês</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">Cada linha compara o unificado (referência) com mãe + nova. Verde = pagou menos naquele mês.</p>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="tbl tbl-compacta w-full min-w-[720px]">
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col" className="th-r">RBT12 mãe</th>
                <th scope="col" className="th-r">RBT12 nova</th>
                <th scope="col" className="th-r">Faixa</th>
                <th scope="col" className="th-r">Alíquota</th>
                <th scope="col" className="th-r">DAS dividido</th>
                <th scope="col" className="th-r">DAS unificado</th>
                <th scope="col" className="th-r">Economia</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {serie.map((l) => {
                const ref = l.receitaTotal > 0 ? l.dasUnificadoReferencia / l.receitaTotal : 0;
                const novaMelhor = l.faixaNova < l.faixaMae;
                const positiva = l.economiaMes >= 0;
                return (
                  <tr key={l.mes} className="border-t border-[var(--line)]">
                    <td className="font-sans font-bold">{rotuloMes(l.mes)}</td>
                    <td className="num text-right">{fmtMoeda(l.rbt12Mae)}</td>
                    <td className="num text-right">{fmtMoeda(l.rbt12Nova)}</td>
                    <td className="num text-right">
                      {l.faixaMae}ª → <strong className={novaMelhor ? 'text-emerald-600 dark:text-emerald-400' : ''}>{l.faixaNova}ª</strong>{' '}
                      {novaMelhor ? <span className="pill bg-emerald-100 text-emerald-800">−{l.faixaMae - l.faixaNova}</span> : null}
                    </td>
                    <td className="num text-right">
                      {fmtCarga(l.aliquotaEfetivaNova * 100)}{' '}
                      <span className="text-slate-400">(ref {fmtCarga(ref * 100)})</span>
                    </td>
                    <td className="num text-right">{fmtMoeda(l.dasMae + l.dasNova)}</td>
                    <td className="num text-right">{fmtMoeda(l.dasUnificadoReferencia)}</td>
                    <td className={`num text-right font-black ${positiva ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                      {positiva ? '− ' : '+ '}{fmtMoeda(Math.abs(l.economiaMes))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Painel>

      {relatorio.alertas.length ? (
        <div className="space-y-2">
          {relatorio.alertas.map((a, i) => (
            <p
              key={`${a.codigo}-${i}`}
              className={`rounded-xl px-3 py-2 text-[11px] leading-relaxed ${a.codigo === 'DESENQUADRAMENTO_4_8M' ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : a.codigo === 'CONSOLIDACAO_RECEITA_GRUPO' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}
              role="note"
            >
              <strong className="font-mono">[{a.codigo}]</strong> {a.mes ? <strong>{rotuloMes(a.mes)} · </strong> : null}{a.mensagem}
            </p>
          ))}
        </div>
      ) : null}

      <p className="px-1 text-[10px] leading-relaxed text-slate-400">
        Projeção informativa com o motor oficial do Simples (`calculo.ts`). Grupo econômico pode exigir consolidação de receita — valide com o contador.
      </p>
    </div>
  );
}
