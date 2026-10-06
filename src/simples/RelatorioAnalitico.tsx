/**
 * Relatório Analítico e Inteligente — visualização compacta em seções.
 *
 * Componente PURO de leitura: apenas formata números do `ReportAnalitico`.
 * Nenhum cálculo aqui — qualquer número novo deve vir do orquestrador.
 *
 * Regra de exibição:
 * - Matriz III×V SOMENTE em CNPJ dual (contexto.mostrarMatrizIIIV).
 * - Caso contrário: duelo Convencional × Híbrido do anexo em foco.
 * - Insights IA + metodologia vivem no InsightsModal (botão na página).
 */
import { fmtCarga, fmtCnpj, fmtMoeda } from '@/domain/services/format';
import { Painel, Pill } from '@/ui/kit';
import type { ReportAnalitico, ScenarioId } from './relatorio-analitico';

function cenario(report: ReportAnalitico, id: ScenarioId) {
  return report.cenarios.find((c) => c.scenarioId === id)!;
}

function Kpi({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${destaque ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30' : 'border-[var(--line)] bg-white dark:bg-slate-900'}`}>
      <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">{rotulo}</span>
      <span className={`mt-0.5 block font-mono text-[15px] font-black tabular-nums ${destaque ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{valor}</span>
      {sub ? <span className="block truncate text-[10px] text-slate-500" title={sub}>{sub}</span> : null}
    </div>
  );
}

function Secao({ n, titulo, sub, children }: { n: string; titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-xs font-black tracking-tight">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0F3D3E] text-[10px] font-black text-white">{n}</span>
          <span className="min-w-0 flex-1 truncate" title={titulo}>{titulo}</span>
        </h3>
        {sub ? <p className="ml-6.5 mt-0.5 line-clamp-2 text-[10px] text-slate-500">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Faixa vantagem/desvantagem com o porquê determinístico (números do duelo). */
function FaixaVantagem({ vencedor, economia, texto }: { vencedor: 'CONV' | 'HIB' | 'EMPATE'; economia: number; texto: string }) {
  if (vencedor === 'EMPATE') {
    return (
      <p className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" role="status">
        ◆ Empate técnico — {texto}
      </p>
    );
  }
  const rotulo = vencedor === 'CONV' ? 'Vantagem do convencional' : 'Vantagem do híbrido';
  return (
    <p className={`rounded-xl px-3 py-2 text-[11px] font-bold ${vencedor === 'CONV' ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'}`} role="status">
      {vencedor === 'CONV' ? '◆' : '●'} {rotulo} — economia de {fmtMoeda(economia)}. {texto}
    </p>
  );
}

export function RelatorioAnalitico({ report }: { report: ReportAnalitico }) {
  const comMatriz = report.contexto.mostrarMatrizIIIV;
  const iiiC = cenario(report, 'III_CONV');
  const vC = cenario(report, 'V_CONV');
  const iiiH = cenario(report, 'III_HIB');
  const vH = cenario(report, 'V_HIB');
  const menor = report.comparativo.menorCargaScenarioId ? cenario(report, report.comparativo.menorCargaScenarioId) : null;

  const economiaConv = vC.totalPagar - iiiC.totalPagar;
  const economiaHib = vH.totalPagar - iiiH.totalPagar;
  const maxTotal = Math.max(iiiC.totalPagar, vC.totalPagar, iiiH.totalPagar, vH.totalPagar, 1);

  const d = report.dueloFoco;
  const memFoco = report.memoriaHibrido[d.anexo];
  const economiaFoco = Math.abs(d.deltaRs);

  const manual = report.empresa.origem === 'MANUAL';
  const f = report.fatorR;
  const gaugePct = Math.min(100, (f.valor / 0.4) * 100);
  const marcoPct = (0.28 / 0.4) * 100;

  const veredito = menor
    ? `Menor carga: ${menor.anexo === 'III' ? 'Anexo III' : menor.anexo === 'V' ? 'Anexo V' : `Anexo ${menor.anexo}`} no ${menor.regime === 'CONVENCIONAL' ? 'convencional' : 'híbrido'} — ${fmtMoeda(menor.totalPagar)}`
    : 'Informe RBT12 e receita para apurar o veredito';

  const elegiveisLabel = report.contexto.anexosElegiveis.join(', ') || d.anexo;

  return (
    <div className="space-y-3">
      {/* Timbrado compacto (versão cheia só no PDF) */}
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
        <div className="h-1 bg-gradient-to-r from-[#C9A96A] via-[#0F3D3E] to-[#0F3D3E]" />
        <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#C9A96A]">Aurum Tax · Plataforma</p>
            <h2 className="mt-0.5 truncate text-[13px] font-black tracking-tight" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              Relatório Analítico e Inteligente — Simples Nacional
            </h2>
            <p className="mt-0.5 text-[10px] text-slate-500">
              LC 123/2006 × LC 214/2025 · {report.competencia} · {new Date(report.geradoEm).toLocaleDateString('pt-BR')}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-slate-400">#{report.reportId.slice(0, 8)}</span>
        </div>
        <div className="border-t border-[var(--line)] bg-slate-50/60 px-3 py-2 dark:bg-slate-950/40">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-xs">{report.empresa.razaoSocial || 'Empresa'}</strong>
            {manual ? (
              <span className="rounded-full border border-dashed border-[#92400E] bg-[#FEF3C7] px-2 py-px text-[10px] font-bold text-[#92400E]">
                Manual
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-px text-[10px] font-bold text-emerald-800">CNPJ</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-slate-500">
            {report.empresa.cnpj ? <span className="font-mono">CNPJ {fmtCnpj(report.empresa.cnpj)}</span> : null}
            {report.empresa.cnaePrincipal ? <span>CNAE {report.empresa.cnaePrincipal} (Anexo {elegiveisLabel})</span> : null}
            {report.empresa.regimeAtual ? <span>{report.empresa.regimeAtual}</span> : null}
          </div>
          <details className="mt-1 text-[10px] text-slate-400">
            <summary className="cursor-pointer font-semibold">Mais dados da empresa</summary>
            <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {report.empresa.nomeFantasia ? <span>Fantasia: {report.empresa.nomeFantasia}</span> : null}
              {report.empresa.enderecoCompleto ? <span className="sm:col-span-2">{report.empresa.enderecoCompleto}</span> : null}
              <span>Motor {report.motorVersao} · hash {report.hash}</span>
            </div>
          </details>
        </div>
      </div>

      {/* Sumário executivo compacto */}
      <Painel>
        <div className="border-b border-[var(--line)] px-3 py-2">
          <h3 className="text-xs font-black tracking-tight">Sumário executivo</h3>
        </div>
        <div className="space-y-2 p-3">
          <p className="rounded-xl bg-[#0F3D3E] px-3 py-2 text-xs font-bold text-white" role="status">✓ {veredito}</p>
          {comMatriz ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <Kpi rotulo="Menor total" valor={menor ? fmtMoeda(menor.totalPagar) : '—'} sub={menor ? `${menor.scenarioId.replace('_', ' · ')}` : undefined} destaque />
              <Kpi rotulo="Economia máx. V → III" valor={fmtMoeda(Math.max(economiaConv, economiaHib))} sub={`Conv ${fmtMoeda(economiaConv)} · Híb ${fmtMoeda(economiaHib)}`} />
              <Kpi rotulo="Fator r" valor={f.dadosSuficientes ? fmtCarga(f.valor * 100) : '—'} sub={f.dadosSuficientes ? (f.enquadrado ? 'Enquadrado (≥ 28%)' : 'Abaixo de 28%') : 'Informe a folha 12m'} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <Kpi rotulo={`Conv · ${d.anexo}`} valor={fmtMoeda(d.convTotal)} sub={`Efetiva ${fmtCarga(d.aliquotaEfetivaConv * 100)}`} destaque={d.vencedor === 'CONV'} />
              <Kpi rotulo={`Híb · ${d.anexo}`} valor={fmtMoeda(d.hibTotal)} sub="DAS reduzido + CBS fora" destaque={d.vencedor === 'HIB'} />
              <Kpi rotulo="Diferença" valor={d.vencedor === 'EMPATE' ? 'Empate' : fmtMoeda(economiaFoco)} sub={d.vencedor === 'EMPATE' ? 'Totais iguais' : d.vencedor === 'CONV' ? 'Convencional vence' : 'Híbrido vence'} />
            </div>
          )}
        </div>
      </Painel>

      {comMatriz ? (
        <Secao n="1" titulo="Anexo III × V — Conv × Híb" sub={`CNAE dual III/V · DAS: ${report.premissas.regraDas} · CBS ${(report.premissas.cbsRef * 100).toFixed(2).replace('.', ',')}%`}>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
            <table className="tbl tbl-compacta w-full min-w-[440px] text-[11px]">
              <thead>
                <tr>
                  <th scope="col">Cenário</th>
                  <th scope="col" className="th-r">Anexo III</th>
                  <th scope="col" className="th-r">Anexo V</th>
                  <th scope="col" className="th-r">Economia → III</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <tr className="border-t border-[var(--line)]">
                  <td className="font-sans font-semibold">Convencional <span className="block text-[10px] font-normal text-slate-400">{fmtCarga(iiiC.aliquotaEfetiva * 100)} × {fmtCarga(vC.aliquotaEfetiva * 100)}</span></td>
                  <td className={`text-right font-bold ${iiiC.vencedor ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(iiiC.totalPagar)}{iiiC.vencedor ? ' ●' : ''}</td>
                  <td className={`text-right ${vC.vencedor ? 'bg-emerald-50 font-bold dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(vC.totalPagar)}{vC.vencedor ? ' ●' : ''}</td>
                  <td className="text-right font-bold text-emerald-700 dark:text-emerald-300">− {fmtMoeda(economiaConv)}</td>
                </tr>
                <tr className="border-t border-[var(--line)] bg-slate-50/50 dark:bg-slate-950/30">
                  <td className="font-sans font-semibold">Híbrido <span className="block text-[10px] font-normal text-slate-400">DAS reduzido + CBS fora</span></td>
                  <td className={`text-right font-bold ${iiiH.vencedor ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(iiiH.totalPagar)}{iiiH.vencedor ? ' ●' : ''}</td>
                  <td className={`text-right ${vH.vencedor ? 'bg-emerald-50 font-bold dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(vH.totalPagar)}{vH.vencedor ? ' ●' : ''}</td>
                  <td className="text-right font-bold text-emerald-700 dark:text-emerald-300">− {fmtMoeda(economiaHib)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <FaixaVantagem
            vencedor="CONV"
            economia={economiaConv}
            texto={`III ${fmtMoeda(iiiC.totalPagar)} × V ${fmtMoeda(vC.totalPagar)} — efetiva III ${fmtCarga(iiiC.aliquotaEfetiva * 100)} < V ${fmtCarga(vC.aliquotaEfetiva * 100)}.`}
          />
          <div className="space-y-1 rounded-xl border border-[var(--line)] bg-white p-2.5 dark:bg-slate-900" aria-hidden="true">
            {([['III · Conv', iiiC.totalPagar, iiiC.vencedor], ['V · Conv', vC.totalPagar, vC.vencedor], ['III · Híb', iiiH.totalPagar, iiiH.vencedor], ['V · Híb', vH.totalPagar, vH.vencedor]] as [string, number, boolean][]).map(([r, v, win]) => (
              <div key={r} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 font-semibold">{r}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-2 rounded-full ${win ? 'bg-emerald-600' : 'bg-[#0F3D3E]'}`} style={{ width: `${(v / maxTotal) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums">{fmtMoeda(v)}</span>
              </div>
            ))}
          </div>
          <p className="hidden text-[10px] text-slate-400 sm:block">Híbrido = DAS sem CBS + CBS (débitos − créditos). CBS no DAS: III {fmtMoeda(iiiC.cbsDentroDas)} · V {fmtMoeda(vC.cbsDentroDas)}.</p>
        </Secao>
      ) : (
        <Secao n="1" titulo={`Convencional × Híbrido — Anexo ${d.anexo}`} sub={`Anexo único (${d.anexo}) · DAS: ${report.premissas.regraDas} · CBS ${(report.premissas.cbsRef * 100).toFixed(2).replace('.', ',')}%`}>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
            <table className="tbl tbl-compacta w-full min-w-[440px] text-[11px]">
              <thead>
                <tr>
                  <th scope="col">Regime</th>
                  <th scope="col" className="th-r">Total</th>
                  <th scope="col" className="th-r">Situação</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <tr className="border-t border-[var(--line)]">
                  <td className="font-sans font-semibold">Convencional <span className="block text-[10px] font-normal text-slate-400">DAS com CBS · efetiva {fmtCarga(d.aliquotaEfetivaConv * 100)}</span></td>
                  <td className={`text-right font-bold ${d.vencedor === 'CONV' ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(d.convTotal)}{d.vencedor === 'CONV' ? ' ●' : ''}</td>
                  <td className="text-right">{d.vencedor === 'CONV' ? 'Vantagem' : d.vencedor === 'EMPATE' ? 'Empate' : '—'}</td>
                </tr>
                <tr className="border-t border-[var(--line)] bg-slate-50/50 dark:bg-slate-950/30">
                  <td className="font-sans font-semibold">Híbrido <span className="block text-[10px] font-normal text-slate-400">Reduzido {fmtMoeda(memFoco.dasReduzido)} + CBS {fmtMoeda(memFoco.cbsARecolher)}</span></td>
                  <td className={`text-right font-bold ${d.vencedor === 'HIB' ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(d.hibTotal)}{d.vencedor === 'HIB' ? ' ●' : ''}</td>
                  <td className="text-right">{d.vencedor === 'HIB' ? 'Vantagem' : d.vencedor === 'EMPATE' ? 'Empate' : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <FaixaVantagem
            vencedor={d.vencedor}
            economia={economiaFoco}
            texto={
              d.vencedor === 'CONV'
                ? `Créditos ${fmtMoeda(memFoco.creditosCbs)} < CBS no DAS ${fmtMoeda(memFoco.cbsDentroDas)} — tirar a CBS não compensa.`
                : d.vencedor === 'HIB'
                  ? `Créditos ${fmtMoeda(memFoco.creditosCbs)} abatem débitos ${fmtMoeda(memFoco.debitosCbs)} → CBS fora ${fmtMoeda(memFoco.cbsARecolher)}.`
                  : 'Totais iguais: prefira o convencional (guia única).'
            }
          />
        </Secao>
      )}

      {comMatriz && report.contexto.mostrarFatorR ? (
        <Secao n="2" titulo="Fator r — massa salarial" sub="Folha 12m ÷ RBT12 · 28% decide III × V">
          <div className="rounded-xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900">
            {!f.dadosSuficientes ? (
              <p className="text-[11px] text-slate-500">Informe a folha 12m para avaliar o Fator r (RBT12 {fmtMoeda(report.premissas.rbt12)}).</p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <strong>Fator r {fmtCarga(f.valor * 100)}</strong>
                  {f.enquadrado
                    ? <Pill cor="emerald">Enquadrado — III</Pill>
                    : <Pill cor="amber">Abaixo — V</Pill>}
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-2 rounded-full ${f.enquadrado ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${gaugePct}%` }} />
                  <div className="absolute top-0 h-2 w-0.5 bg-[#0F3D3E]" style={{ left: `${marcoPct}%` }} title="Marco 28%" />
                </div>
                <div className="flex justify-between font-mono text-[10px] text-slate-400"><span>0%</span><span>▼ 28%</span><span>40%</span></div>
                {!f.enquadrado ? (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    Faltam <strong className="font-mono">{fmtMoeda(f.gapFolha)}</strong> (~<strong className="font-mono">{fmtMoeda(f.gapMensalProlabore)}/mês</strong>). Economia V→III: <strong className="font-mono">{fmtMoeda(economiaConv)}/mês</strong>.
                  </p>
                ) : (
                  <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    Folha mínima {fmtMoeda(f.folhaMinimaIII)} — monitore mensalmente.
                  </p>
                )}
              </div>
            )}
          </div>
        </Secao>
      ) : null}

      {/* Memória do híbrido — colapsada por padrão */}
      <details className="rounded-xl border border-[var(--line)] bg-slate-50/60 px-3 py-2 dark:bg-slate-950/30">
        <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">
          Como chegamos ao híbrido — memória de cálculo
        </summary>
        <div className="mt-2 space-y-2">
          {(comMatriz ? (['III', 'V'] as const) : ([d.anexo] as const)).map((ax) => {
            const mem = report.memoriaHibrido[ax];
            return (
              <div key={ax} className="rounded-xl border border-[var(--line)] bg-white p-2.5 dark:bg-slate-900">
                <h4 className="text-[11px] font-black">Anexo {ax} · {fmtMoeda(mem.totalHibrido)}</h4>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                  <li>DAS {fmtMoeda(mem.dasTotal)} − CBS {fmtMoeda(mem.cbsDentroDas)} = {fmtMoeda(mem.dasReduzido)}.</li>
                  <li>Débitos {fmtMoeda(mem.debitosCbs)} − créditos {fmtMoeda(mem.creditosCbs)} = {fmtMoeda(mem.cbsARecolher)}{mem.saldoCredor > 0 ? ` (saldo ${fmtMoeda(mem.saldoCredor)})` : ''}.</li>
                  <li>Total {fmtMoeda(mem.dasReduzido)} + {fmtMoeda(mem.cbsARecolher)} = {fmtMoeda(mem.totalHibrido)}.</li>
                </ol>
                <div className="mt-1.5 overflow-x-auto">
                  <table className="tbl tbl-compacta w-full min-w-[380px] text-[11px]">
                    <thead>
                      <tr>
                        <th scope="col">Despesa</th>
                        <th scope="col" className="th-r">Valor</th>
                        <th scope="col" className="th-r">Fator</th>
                        <th scope="col" className="th-r">Crédito</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {mem.creditosPorDespesa.map((cd) => (
                        <tr key={cd.rotulo} className="border-t border-[var(--line)]">
                          <td className="font-sans">{cd.rotulo}</td>
                          <td className="text-right">{fmtMoeda(cd.valor)}</td>
                          <td className="text-right">{fmtCarga(cd.fator * 100)}</td>
                          <td className="text-right font-bold">{fmtMoeda(cd.credito)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-[var(--line)] font-bold">
                        <td className="font-sans">Total</td>
                        <td />
                        <td />
                        <td className="text-right">{fmtMoeda(mem.creditosCbs)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {comMatriz ? (
        <details className="rounded-xl border border-[var(--line)] bg-slate-50/60 px-3 py-2 dark:bg-slate-950/30">
          <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">
            Demais anexos — referência (I, II, IV)
          </summary>
          <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
            <table className="tbl tbl-compacta w-full min-w-[440px] text-[11px]">
              <thead>
                <tr>
                  <th scope="col">Anexo</th>
                  <th scope="col" className="th-r">Conv</th>
                  <th scope="col" className="th-r">Híb</th>
                  <th scope="col" className="th-r">Dif.</th>
                  <th scope="col" className="th-r">Vencedor</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {report.comparativo.tabelaOutrosAnexos.map((l) => (
                  <tr key={l.anexo} className="border-t border-[var(--line)]">
                    <td className="font-sans font-semibold">Anexo {l.anexo} <span className="block text-[10px] font-normal text-slate-400">{fmtCarga(l.aliquotaEfetivaConv * 100)}</span></td>
                    <td className="text-right">{fmtMoeda(l.convTotal)}</td>
                    <td className="text-right">{fmtMoeda(l.hibTotal)}</td>
                    <td className={`text-right font-bold ${l.deltaRs > 0 ? 'text-sky-700 dark:text-sky-300' : l.deltaRs < 0 ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                      {l.deltaRs === 0 ? '—' : `${l.deltaRs > 0 ? '+' : '−'} ${fmtMoeda(Math.abs(l.deltaRs))}`}
                    </td>
                    <td className="text-right">{l.vencedor === 'EMPATE' ? 'Empate' : l.vencedor === 'CONV' ? 'Conv' : 'Híb'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <p className="px-1 text-[10px] text-slate-400">Inteligência Tributária e metodologia completa no modal ✦ — use o botão acima para abrir gráficos e insights.</p>
    </div>
  );
}
