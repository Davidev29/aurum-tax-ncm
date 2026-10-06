/**
 * Simples Projection — resultado reativo da divisão (componente PURO).
 *
 * Apenas formata `RelatorioProjecao` do motor. Nenhum cálculo fiscal aqui:
 * faixa, alíquota, DAS, economia, Fator R e payback vêm de
 * `simularCenarioDividido` (+ `pro-labore.ts` para INSS/IRPF do pró-labore).
 * Gráficos essenciais via `GraficoChatView` (2: DAS e economia acumulada);
 * o restante é tabela de progressividade + diagnóstico do Fator R.
 */
import { useMemo } from 'react';
import { fmtCarga, fmtMoeda } from '@/domain/services/format';
import { GraficoChatView } from '@/ui/grafico-chat';
import { Painel, Pill } from '@/ui/kit';
import type { GraficoChat } from '@/application/aurum-ai-graficos';
import { analisarRetorno, type AnaliseRetorno } from './analise-retorno';
import { TETO_INSS_MENSAL_REF_2025 } from './pro-labore';
import type { RelatorioProjecao } from './types';

function Kpi({ rotulo, valor, sub, destaque, alerta }: { rotulo: string; valor: string; sub?: string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${destaque ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30' : alerta ? 'border-red-600/40 bg-red-50 dark:bg-red-950/30' : 'border-[var(--line)] bg-white dark:bg-slate-900'}`}>
      <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">{rotulo}</span>
      <span className={`mt-0.5 block font-mono text-[15px] font-black tabular-nums ${destaque ? 'text-emerald-700 dark:text-emerald-300' : alerta ? 'text-red-700 dark:text-red-300' : ''}`}>{valor}</span>
      {sub ? <span className="block truncate text-[10px] text-slate-500" title={sub}>{sub}</span> : null}
    </div>
  );
}

function rotuloMes(mes: string): string {
  const [a, m] = mes.split('-');
  return `${m}/${String(a).slice(2)}`;
}

const VEREDITO: Record<AnaliseRetorno['status'], { titulo: string; classe: string; dica: string }> = {
  'lucro-imediato': {
    titulo: 'Vale a pena desde o 1º mês',
    classe: 'border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
    dica: 'Todo mês o dividido paga menos — o acumulado nunca volta a zerar.',
  },
  'payback-horizonte': {
    titulo: 'Há retorno dentro do horizonte',
    classe: 'border-sky-600/40 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100',
    dica: 'Os primeiros meses pagam mais (custo da nova), depois a economia compensa.',
  },
  'sem-payback': {
    titulo: 'Sem retorno no horizonte',
    classe: 'border-amber-600/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
    dica: 'Existem meses positivos, mas insuficientes para zerar o acumulado.',
  },
  prejuizo: {
    titulo: 'Só prejuízo no horizonte',
    classe: 'border-red-600/40 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100',
    dica: 'Nenhum mês paga menos — dividir só aumenta o custo. Revise % ou custos.',
  },
};

export function ResultadoDividido({ relatorio, custoMensalNova }: { relatorio: RelatorioProjecao; custoMensalNova: number }) {
  const serie = relatorio.serieMensal;

  const retorno: AnaliseRetorno = useMemo(
    () => relatorio.analiseRetorno ?? analisarRetorno(serie, custoMensalNova),
    [relatorio.analiseRetorno, serie, custoMensalNova],
  );
  const veredito = VEREDITO[retorno.status];

  const graficos = useMemo(() => {
    const labels = serie.map((l) => rotuloMes(l.mes));
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

    const acum = serie.map((l) => l.economiaAcumulada);
    const gEcon: GraficoChat = {
      titulo: 'Economia acumulada — quando cruza o zero?',
      subtitulo: `Custo nova empresa ${fmtMoeda(custoMensalNova)}/mês já descontado`,
      tipo: 'linha',
      labels,
      series: [{ nome: 'Acumulada (líquida)', valores: acum }],
      unidade: 'moeda',
      insight: retorno.mesPayback
        ? `Retorno em ${rotuloMes(retorno.mesPayback)} (${retorno.mesesParaRetorno}º mês).`
        : 'Não há retorno no horizonte — o acumulado nunca fica positivo.',
      colunas: ['Mês', 'Economia mês (R$)', 'Acumulada (R$)'],
      linhasTabela: serie.map((l) => [l.mes, l.economiaMes.toFixed(2), l.economiaAcumulada.toFixed(2)]),
      alternativas: ['barra', 'tabela'],
      origem: 'simples-projection:economia',
    };

    return { gDas, gEcon };
  }, [serie, relatorio, custoMensalNova, retorno]);

  const economiaPositiva = relatorio.economiaTotal >= 0;
  const fr = relatorio.analiseFatorR;

  return (
    <div className="space-y-3">
      {/* Veredito do retorno */}
      <div className={`rounded-xl border px-3 py-2 ${veredito.classe}`} role="status">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-xs font-black tracking-tight">
            {veredito.titulo}
            {retorno.mesPayback ? ` · payback em ${rotuloMes(retorno.mesPayback)} (${retorno.mesesParaRetorno}º mês)` : ''}
          </strong>
          <span className="font-mono text-xs font-bold tabular-nums">
            {retorno.mesesPositivos} meses positivos · {retorno.mesesNegativos} negativos
          </span>
        </div>
        <p className="mt-1 text-xs opacity-80">{veredito.dica}</p>
        <p className="mt-1 font-mono text-[11px] tabular-nums opacity-80">
          Economia bruta de DAS {fmtMoeda(retorno.totalEconomiaBrutaDAS)} − custos {fmtMoeda(retorno.totalCustos)} = {fmtMoeda(retorno.economiaTotal)} no horizonte
          {retorno.melhorMes ? ` · melhor mês ${rotuloMes(retorno.melhorMes.mes)} (${fmtMoeda(retorno.melhorMes.valor)})` : ''}
          {retorno.piorMes && retorno.piorMes.valor < 0 ? ` · pior mês ${rotuloMes(retorno.piorMes.mes)} (${fmtMoeda(retorno.piorMes.valor)})` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <Kpi
          rotulo={economiaPositiva ? 'Economia total (líquida)' : 'Custo adicional total'}
          valor={`${economiaPositiva ? '' : '+ '}${fmtMoeda(Math.abs(relatorio.economiaTotal))}`}
          sub={economiaPositiva ? 'Dividido paga menos que o unificado' : 'Dividido paga mais (DAS + custos)'}
          destaque={economiaPositiva}
          alerta={!economiaPositiva}
        />
        <Kpi
          rotulo="Tempo até o retorno"
          valor={
            retorno.status === 'lucro-imediato'
              ? 'Imediato'
              : retorno.mesPayback
                ? `${retorno.mesesParaRetorno} meses`
                : 'Sem retorno'
          }
          sub={
            retorno.mesPayback
              ? `payback em ${rotuloMes(retorno.mesPayback)} · ${fmtMoeda(retorno.economiaTotal)} no horizonte`
              : retorno.status === 'prejuizo'
                ? 'só prejuízo — reveja % ou custos'
                : 'aumente o horizonte ou reduza custos'
          }
        />
        <Kpi
          rotulo="Custo nova empresa"
          valor={fmtMoeda(custoMensalNova)}
          sub={`por mês · ${fmtMoeda(custoMensalNova * serie.length)} no horizonte (${serie.length}m)`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <GraficoChatView grafico={graficos.gDas} />
        <GraficoChatView grafico={graficos.gEcon} />
      </div>

      {/* Progressividade: mãe × nova × referência, com RBT12p */}
      <details className="overflow-hidden rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
        <summary className="cursor-pointer px-3 py-2">
          <span className="text-xs font-black tracking-tight">Progressividade — mãe × nova × unificado</span>
          <span className="block text-[10px] font-normal text-slate-500">
            RBT12p = soma dos 12 meses anteriores. Clique para expandir a tabela mês a mês.
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-[var(--line)] p-2.5">
          <table className="tbl tbl-compacta w-full min-w-[960px]">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>Mês</th>
                <th scope="col" colSpan={5} className="text-center">Mãe (Anexo {relatorio.metadados.anexoMae})</th>
                <th scope="col" colSpan={5} className="text-center">Nova (Anexo {relatorio.metadados.anexoNova})</th>
                <th scope="col" colSpan={4} className="text-center">Unificado (ref.)</th>
                <th scope="col" rowSpan={2} className="th-r">Economia</th>
              </tr>
              <tr>
                <th scope="col" className="th-r">RBT12p</th>
                <th scope="col" className="th-r">Faixa</th>
                <th scope="col" className="th-r">Nominal</th>
                <th scope="col" className="th-r">Efetiva</th>
                <th scope="col" className="th-r">DAS</th>
                <th scope="col" className="th-r">RBT12p</th>
                <th scope="col" className="th-r">Faixa</th>
                <th scope="col" className="th-r">Nominal</th>
                <th scope="col" className="th-r">Efetiva</th>
                <th scope="col" className="th-r">DAS</th>
                <th scope="col" className="th-r">RBT12p</th>
                <th scope="col" className="th-r">Faixa</th>
                <th scope="col" className="th-r">Efetiva</th>
                <th scope="col" className="th-r">DAS</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {serie.map((l) => {
                const positiva = l.economiaMes >= 0;
                return (
                  <tr key={l.mes} className="border-t border-[var(--line)]">
                    <td className="font-sans font-bold">{rotuloMes(l.mes)}</td>
                    <td className="num text-right">{fmtMoeda(l.rbt12Mae)}</td>
                    <td className="num text-right">{l.faixaMae}ª</td>
                    <td className="num text-right">{l.aliquotaNominalMae != null ? fmtCarga(l.aliquotaNominalMae * 100) : '—'}</td>
                    <td className="num text-right">{fmtCarga(l.aliquotaEfetivaMae * 100)}</td>
                    <td className="num text-right">{fmtMoeda(l.dasMae)}</td>
                    <td className="num text-right">{fmtMoeda(l.rbt12Nova)}</td>
                    <td className="num text-right">{l.faixaNova}ª</td>
                    <td className="num text-right">{l.aliquotaNominalNova != null ? fmtCarga(l.aliquotaNominalNova * 100) : '—'}</td>
                    <td className="num text-right">{fmtCarga(l.aliquotaEfetivaNova * 100)}</td>
                    <td className="num text-right">{fmtMoeda(l.dasNova)}</td>
                    <td className="num text-right text-slate-500">{fmtMoeda(l.rbt12Ref ?? 0)}</td>
                    <td className="num text-right text-slate-500">{l.faixaRef ?? '—'}ª</td>
                    <td className="num text-right text-slate-500">{fmtCarga((l.aliquotaEfetivaRef ?? 0) * 100)}</td>
                    <td className="num text-right text-slate-500">{fmtMoeda(l.dasUnificadoReferencia)}</td>
                    <td className={`num text-right font-black ${positiva ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                      {positiva ? '− ' : '+ '}{fmtMoeda(Math.abs(l.economiaMes))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      {/* Fator R + pró-labore */}
      <Painel>
        <div className="border-b border-[var(--line)] px-3 py-2">
          <h3 className="text-xs font-black tracking-tight">Fator R — quanto falta para os 28%?</h3>
          <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">
            Folha 12m ÷ RBT12p. Abaixo de 28% → Anexo V; o déficit mostra o pró-labore p/ voltar ao III.
          </p>
        </div>
        <div className="space-y-2.5 p-3">
          {fr ? (
            <>
              {(['mae', 'nova'] as const).map((lado) => {
                const ultimo = fr.linhas[fr.linhas.length - 1]?.[lado];
                if (!ultimo) return null;
                if (!ultimo.aplicaFatorR) {
                  return (
                    <p key={lado} className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {lado === 'mae' ? 'Mãe' : 'Nova'} no Anexo {ultimo.anexo}: sem Fator R — folha dispensada.
                    </p>
                  );
                }
                const resumoMeses = lado === 'mae' ? fr.resumo.mesesAbaixo28Mae : fr.resumo.mesesAbaixo28Nova;
                const maior = lado === 'mae' ? fr.resumo.maiorDeficitMae : fr.resumo.maiorDeficitNova;
                const custo = lado === 'mae' ? fr.resumo.custoMaiorProLaboreMae : fr.resumo.custoMaiorProLaboreNova;
                return (
                  <div key={lado} className="rounded-2xl border border-[var(--line)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm">{lado === 'mae' ? 'Mãe' : 'Nova'} — Anexo {ultimo.anexo}</strong>
                      {ultimo.atinge28 ? <Pill cor="emerald">≥ 28% · fica no III</Pill> : <Pill cor="amber">&lt; 28% · cai no V</Pill>}
                      <span className="font-mono text-xs text-slate-500">
                        índice {(ultimo.indice * 100).toFixed(2)}% no último mês · {resumoMeses}/{fr.linhas.length} meses abaixo de 28%
                      </span>
                    </div>
                    {maior.valor > 0 && maior.mes ? (
                      <div className="mt-2 space-y-1 text-xs">
                        <p>
                          Maior déficit em <strong>{rotuloMes(maior.mes)}</strong>: faltam{' '}
                          <strong className="font-mono">{fmtMoeda(maior.valor)}</strong> na folha 12m →{' '}
                          <strong className="font-mono">{fmtMoeda(maior.valor / 12)}/mês</strong> de pró-labore adicional.
                        </p>
                        {custo ? (
                          <p className="font-mono text-[11px] text-slate-500">
                            Sobre esse pró-labore: INSS 11% {fmtMoeda(custo.inss)} + IRPF 2026 {fmtMoeda(custo.irpf)} ={' '}
                            descontos {fmtMoeda(custo.descontosPF)} · líquido {fmtMoeda(custo.liquido)}
                            {custo.cppPatronalPorFora > 0 ? ` · CPP patronal por fora (Anexo IV) ${fmtMoeda(custo.cppPatronalPorFora)}` : ''}
                            {custo.tetoINSSAplicado ? ' · teto do RGPS aplicado' : ''}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-slate-400">
                          Sugestão: elevar o pró-labore dos sócios (entra na folha e conta para os 28%). Avalie com o contador o ponto
                          em que o custo do pró-labore supera a economia do Anexo III.
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                        Folha suficiente em todos os meses — há margem de {fmtMoeda(ultimo.folha12 - ultimo.rbt12p * 0.28)} sobre os 28% no último mês.
                      </p>
                    )}
                  </div>
                );
              })}

              <details className="rounded-2xl border border-[var(--line)] px-4 py-3 text-xs">
                <summary className="cursor-pointer font-bold">
                  Pró-labore mensal sugerido — mês a mês (unificado × dividido)
                </summary>
                <p className="mt-1 text-[11px] text-slate-500">
                  Quanto de pró-labore/mês seria preciso para bater 28% em cada cenário. Unificado = mesma equipe, tudo na mãe.
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="tbl tbl-compacta w-full min-w-[560px]">
                    <thead>
                      <tr>
                        <th scope="col">Mês</th>
                        <th scope="col" className="th-r">Só na mãe (unificado)</th>
                        <th scope="col" className="th-r">Mãe (dividido)</th>
                        <th scope="col" className="th-r">Nova (dividido)</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {fr.linhas.map((l) => (
                        <tr key={l.mes} className="border-t border-[var(--line)]">
                          <td className="font-sans font-bold">{rotuloMes(l.mes)}</td>
                          <td className="num text-right">{l.unificado.aplicaFatorR ? fmtMoeda(l.unificado.proLaboreMensalSugerido) : '—'}</td>
                          <td className="num text-right">{l.mae.aplicaFatorR ? fmtMoeda(l.mae.proLaboreMensalSugerido) : '—'}</td>
                          <td className="num text-right">{l.nova.aplicaFatorR ? fmtMoeda(l.nova.proLaboreMensalSugerido) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="text-xs text-slate-400">Diagnóstico do Fator R indisponível neste relatório.</p>
          )}
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
        Projeção informativa com o motor oficial do Simples (`calculo.ts`). INSS 11% com teto RGPS {fmtMoeda(TETO_INSS_MENSAL_REF_2025)} (ref. 2025);
        IRPF pela tabela mensal 2026 (Leis 15.191 e 15.270/2025). Grupo econômico pode exigir consolidação de receita — valide com o contador.
      </p>
    </div>
  );
}
