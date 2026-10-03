/**
 * Relatório Analítico e Inteligente — visualização Executive Editorial Premium.
 *
 * Componente PURO de leitura: apenas formata números do `ReportAnalitico`.
 * Nenhum cálculo aqui — qualquer número novo deve vir do orquestrador.
 *
 * Regra de exibição:
 * - Matriz III×V SOMENTE em CNPJ dual (contexto.mostrarMatrizIIIV).
 * - Caso contrário: duelo Convencional × Híbrido do anexo em foco.
 */
import { useMemo } from 'react';
import { fmtCarga, fmtCnpj, fmtMoeda } from '@/domain/services/format';
import { Painel, Pill } from '@/ui/kit';
import type { AiInsight } from './ia-insights';
import type { ReportAnalitico, ScenarioId } from './relatorio-analitico';

function cenario(report: ReportAnalitico, id: ScenarioId) {
  return report.cenarios.find((c) => c.scenarioId === id)!;
}

function Kpi({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${destaque ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30' : 'border-[var(--line)] bg-white dark:bg-slate-900'}`}>
      <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">{rotulo}</span>
      <span className={`mt-1 block font-mono text-xl font-black tabular-nums ${destaque ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{valor}</span>
      {sub ? <span className="mt-0.5 block text-[11px] text-slate-500">{sub}</span> : null}
    </div>
  );
}

function Secao({ n, titulo, sub, children }: { n: string; titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-black tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0F3D3E] text-[11px] font-black text-white">{n}</span>
          {titulo}
        </h3>
        {sub ? <p className="ml-8 mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Faixa vantagem/desvantagem com o porquê determinístico (números do duelo). */
function FaixaVantagem({ vencedor, economia, texto }: { vencedor: 'CONV' | 'HIB' | 'EMPATE'; economia: number; texto: string }) {
  if (vencedor === 'EMPATE') {
    return (
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" role="status">
        ◆ Empate técnico — {texto}
      </p>
    );
  }
  const rotulo = vencedor === 'CONV' ? 'Vantagem do regime convencional' : 'Vantagem do regime híbrido';
  return (
    <p className={`rounded-xl px-4 py-3 text-xs font-bold ${vencedor === 'CONV' ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'}`} role="status">
      {vencedor === 'CONV' ? '◆' : '●'} {rotulo} — economia de {fmtMoeda(economia)}. {texto}
    </p>
  );
}

/** Ícone do nível (navegador renderiza sem restrição de fonte). */
const ICONE_NIVEL: Record<AiInsight['nivel'], string> = {
  OPORTUNIDADE: '●',
  ALERTA: '▲',
  INFO: '◆',
};

export function RelatorioAnalitico({ report, insights }: { report: ReportAnalitico; insights: AiInsight[] }) {
  const comMatriz = report.contexto.mostrarMatrizIIIV;
  const iiiC = cenario(report, 'III_CONV');
  const vC = cenario(report, 'V_CONV');
  const iiiH = cenario(report, 'III_HIB');
  const vH = cenario(report, 'V_HIB');
  const menor = report.comparativo.menorCargaScenarioId ? cenario(report, report.comparativo.menorCargaScenarioId) : null;

  const economiaConv = useMemo(() => vC.totalPagar - iiiC.totalPagar, [vC, iiiC]);
  const economiaHib = useMemo(() => vH.totalPagar - iiiH.totalPagar, [vH, iiiH]);
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
    <div className="space-y-6">
      {/* Timbrado */}
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
        <div className="h-1.5 bg-gradient-to-r from-[#C9A96A] via-[#0F3D3E] to-[#0F3D3E]" />
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A96A]">Aurum Tax · Plataforma</p>
            <h2 className="mt-0.5 text-lg font-black tracking-tight" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              Relatório Analítico e Inteligente — Simples Nacional
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              LC 123/2006 × LC 214/2025 · {report.competencia} · Motor {report.motorVersao} · {new Date(report.geradoEm).toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="text-right font-mono text-[10px] text-slate-400">
            <span className="block">#{report.reportId.slice(0, 8)} · hash {report.hash}</span>
            <span className="block">Pág. tela/PDF idênticas</span>
          </div>
        </div>
        <div className="border-t border-[var(--line)] bg-slate-50/60 px-5 py-3 dark:bg-slate-950/40">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">{report.empresa.razaoSocial || 'Empresa'}</strong>
            {manual ? (
              <span className="rounded-full border border-dashed border-[#92400E] bg-[#FEF3C7] px-2.5 py-0.5 text-[10px] font-bold text-[#92400E]">
                Cálculo Realizado via Preenchimento Manual
              </span>
            ) : (
              <span className="pill bg-emerald-100 text-emerald-800">Dados via CNPJ</span>
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 text-[11px] text-slate-500 sm:grid-cols-2">
            {report.empresa.nomeFantasia ? <span>Fantasia: {report.empresa.nomeFantasia}</span> : null}
            {report.empresa.cnpj ? <span className="font-mono">CNPJ {fmtCnpj(report.empresa.cnpj)}</span> : null}
            {report.empresa.enderecoCompleto ? <span className="sm:col-span-2">{report.empresa.enderecoCompleto}</span> : null}
            {report.empresa.cnaePrincipal ? <span>CNAE em análise: {report.empresa.cnaePrincipal} (Anexo {elegiveisLabel})</span> : null}
            {report.empresa.regimeAtual ? <span>Regime atual: {report.empresa.regimeAtual}</span> : null}
          </div>
        </div>
      </div>

      {/* Sumário executivo */}
      <Painel>
        <div className="border-b border-[var(--line)] px-5 py-3">
          <h3 className="text-sm font-black tracking-tight">Sumário executivo</h3>
        </div>
        <div className="space-y-3 p-4">
          <p className="rounded-xl bg-[#0F3D3E] px-4 py-3 text-sm font-bold text-white" role="status">✓ {veredito}</p>
          {comMatriz ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Kpi rotulo="Menor total a pagar" valor={menor ? fmtMoeda(menor.totalPagar) : '—'} sub={menor ? `${menor.scenarioId.replace('_', ' · ')}` : undefined} destaque />
              <Kpi rotulo="Economia máxima V → III" valor={fmtMoeda(Math.max(economiaConv, economiaHib))} sub={`Conv ${fmtMoeda(economiaConv)} · Híb ${fmtMoeda(economiaHib)}`} />
              <Kpi rotulo="Fator r" valor={f.dadosSuficientes ? fmtCarga(f.valor * 100) : '—'} sub={f.dadosSuficientes ? (f.enquadrado ? 'Enquadrado (≥ 28%)' : 'Abaixo de 28%') : 'Informe a folha 12m'} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Kpi rotulo={`Convencional · Anexo ${d.anexo}`} valor={fmtMoeda(d.convTotal)} sub={`Efetiva ${fmtCarga(d.aliquotaEfetivaConv * 100)}`} destaque={d.vencedor === 'CONV'} />
              <Kpi rotulo={`Híbrido · Anexo ${d.anexo}`} valor={fmtMoeda(d.hibTotal)} sub={`DAS reduzido + CBS por fora`} destaque={d.vencedor === 'HIB'} />
              <Kpi rotulo="Diferença entre regimes" valor={d.vencedor === 'EMPATE' ? 'Empate' : fmtMoeda(economiaFoco)} sub={d.vencedor === 'EMPATE' ? 'Totais iguais' : d.vencedor === 'CONV' ? 'Convencional mais barato' : 'Híbrido mais barato'} />
            </div>
          )}
        </div>
      </Painel>

      {comMatriz ? (
        <Secao n="1" titulo="Anexo III × Anexo V — Convencional × Híbrido" sub={`CNAE com dois anexos (III e V) · Regra DAS: ${report.premissas.regraDas} · CBS referência ${(report.premissas.cbsRef * 100).toFixed(2).replace('.', ',')}%`}>
          <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#F2F0EB] text-left dark:bg-slate-800">
                  <th scope="col" className="px-3 py-2 font-bold">Cenário</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Anexo III</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Anexo V</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Economia → III</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <tr className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-sans font-semibold">Convencional <span className="block text-[10px] font-normal text-slate-400">DAS total · {fmtCarga(iiiC.aliquotaEfetiva * 100)} × {fmtCarga(vC.aliquotaEfetiva * 100)}</span></td>
                  <td className={`px-3 py-2 text-right font-bold ${iiiC.vencedor ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(iiiC.totalPagar)}{iiiC.vencedor ? ' ●' : ''}</td>
                  <td className={`px-3 py-2 text-right ${vC.vencedor ? 'bg-emerald-50 font-bold dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(vC.totalPagar)}{vC.vencedor ? ' ●' : ''}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-300">− {fmtMoeda(economiaConv)}</td>
                </tr>
                <tr className="border-t border-[var(--line)] bg-slate-50/50 dark:bg-slate-950/30">
                  <td className="px-3 py-2 font-sans font-semibold">Híbrido <span className="block text-[10px] font-normal text-slate-400">DAS reduzido + CBS por fora</span></td>
                  <td className={`px-3 py-2 text-right font-bold ${iiiH.vencedor ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(iiiH.totalPagar)}{iiiH.vencedor ? ' ●' : ''}</td>
                  <td className={`px-3 py-2 text-right ${vH.vencedor ? 'bg-emerald-50 font-bold dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(vH.totalPagar)}{vH.vencedor ? ' ●' : ''}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-300">− {fmtMoeda(economiaHib)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <FaixaVantagem
            vencedor={economiaConv >= 0 ? 'CONV' : 'CONV'}
            economia={economiaConv}
            texto={`No convencional, o Anexo III cobra ${fmtMoeda(iiiC.totalPagar)} contra ${fmtMoeda(vC.totalPagar)} do Anexo V, porque a alíquota efetiva do III (${fmtCarga(iiiC.aliquotaEfetiva * 100)}) é menor que a do V (${fmtCarga(vC.aliquotaEfetiva * 100)}) nesta faixa de receita.`}
          />
          <div className="space-y-1.5 rounded-2xl border border-[var(--line)] bg-white p-4 dark:bg-slate-900" aria-hidden="true">
            {([['III · Conv', iiiC.totalPagar, iiiC.vencedor], ['V · Conv', vC.totalPagar, vC.vencedor], ['III · Híb', iiiH.totalPagar, iiiH.vencedor], ['V · Híb', vH.totalPagar, vH.vencedor]] as [string, number, boolean][]).map(([r, v, win]) => (
              <div key={r} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 font-semibold">{r}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-2.5 rounded-full ${win ? 'bg-emerald-600' : 'bg-[#0F3D3E]'}`} style={{ width: `${(v / maxTotal) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums">{fmtMoeda(v)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">Híbrido = DAS sem CBS + CBS (débito × alíquota de referência − créditos DRE). CBS dentro do DAS: III {fmtMoeda(iiiC.cbsDentroDas)} · V {fmtMoeda(vC.cbsDentroDas)}.</p>
        </Secao>
      ) : (
        <Secao n="1" titulo={`Convencional × Híbrido — Anexo ${d.anexo}`} sub={`CNAE de anexo único (${d.anexo}) · Regra DAS: ${report.premissas.regraDas} · CBS referência ${(report.premissas.cbsRef * 100).toFixed(2).replace('.', ',')}%`}>
          <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
            <table className="w-full min-w-[480px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#F2F0EB] text-left dark:bg-slate-800">
                  <th scope="col" className="px-3 py-2 font-bold">Regime</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Total a pagar</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Situação</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <tr className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-sans font-semibold">Convencional <span className="block text-[10px] font-normal text-slate-400">DAS com CBS dentro · efetiva {fmtCarga(d.aliquotaEfetivaConv * 100)}</span></td>
                  <td className={`px-3 py-2 text-right font-bold ${d.vencedor === 'CONV' ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(d.convTotal)}{d.vencedor === 'CONV' ? ' ●' : ''}</td>
                  <td className="px-3 py-2 text-right">{d.vencedor === 'CONV' ? 'Vantagem' : d.vencedor === 'EMPATE' ? 'Empate' : 'Desvantagem'}</td>
                </tr>
                <tr className="border-t border-[var(--line)] bg-slate-50/50 dark:bg-slate-950/30">
                  <td className="px-3 py-2 font-sans font-semibold">Híbrido <span className="block text-[10px] font-normal text-slate-400">DAS reduzido ({fmtMoeda(memFoco.dasReduzido)}) + CBS por fora ({fmtMoeda(memFoco.cbsARecolher)})</span></td>
                  <td className={`px-3 py-2 text-right font-bold ${d.vencedor === 'HIB' ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{fmtMoeda(d.hibTotal)}{d.vencedor === 'HIB' ? ' ●' : ''}</td>
                  <td className="px-3 py-2 text-right">{d.vencedor === 'HIB' ? 'Vantagem' : d.vencedor === 'EMPATE' ? 'Empate' : 'Desvantagem'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <FaixaVantagem
            vencedor={d.vencedor}
            economia={economiaFoco}
            texto={
              d.vencedor === 'CONV'
                ? `O convencional vence porque os créditos de CBS (${fmtMoeda(memFoco.creditosCbs)}) são menores que a CBS embutida no DAS (${fmtMoeda(memFoco.cbsDentroDas)}). Tirar a CBS da guia não compensa.`
                : d.vencedor === 'HIB'
                  ? `O híbrido vence porque os créditos de CBS (${fmtMoeda(memFoco.creditosCbs)}) abatem os débitos (${fmtMoeda(memFoco.debitosCbs)}), e a CBS por fora cai para ${fmtMoeda(memFoco.cbsARecolher)}.`
                  : 'Os totais são iguais: prefira o convencional pela guia única.'
            }
          />
        </Secao>
      )}

      {comMatriz && report.contexto.mostrarFatorR ? (
        <Secao n="2" titulo="Fator r — massa salarial" sub="Folha dos últimos 12 meses ÷ RBT12 · limite de 28% (Anexo III a partir de 28%, Anexo V abaixo disso)">
          <div className="rounded-2xl border border-[var(--line)] bg-white p-4 dark:bg-slate-900">
            {!f.dadosSuficientes ? (
              <p className="text-xs text-slate-500">Informe a folha dos últimos 12 meses para avaliar o Fator r (RBT12 de {fmtMoeda(report.premissas.rbt12)}).</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <strong>Fator r de {fmtCarga(f.valor * 100)}</strong>
                  {f.enquadrado
                    ? <Pill cor="emerald">Enquadrado — Anexo III aplicável</Pill>
                    : <Pill cor="amber">Abaixo do limite — Anexo V aplicável</Pill>}
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-3 rounded-full ${f.enquadrado ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${gaugePct}%` }} />
                  <div className="absolute top-0 h-3 w-0.5 bg-[#0F3D3E]" style={{ left: `${marcoPct}%` }} title="Marco 28%" />
                </div>
                <div className="flex justify-between font-mono text-[10px] text-slate-400"><span>0%</span><span>▼ 28%</span><span>40%</span></div>
                <p className="font-mono text-[11px] text-slate-500">Fator r = folha ({fmtMoeda(f.folha12)}) ÷ RBT12 ({fmtMoeda(f.rbt12)}) = {fmtCarga(f.valor * 100)}</p>
                {!f.enquadrado ? (
                  <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    Faltam <strong className="font-mono">{fmtMoeda(f.gapFolha)}</strong> na folha dos últimos 12 meses (cerca de <strong className="font-mono">{fmtMoeda(f.gapMensalProlabore)} por mês</strong> de pró-labore) para atingir os 28%.
                    Economia do Anexo V para o III: <strong className="font-mono">{fmtMoeda(economiaConv)} por mês</strong> no convencional ({fmtCarga(vC.aliquotaEfetiva * 100)} para {fmtCarga(iiiC.aliquotaEfetiva * 100)}) e <strong className="font-mono">{fmtMoeda(economiaHib)} por mês</strong> no híbrido.
                  </div>
                ) : (
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    Folha mínima sustentada de {fmtMoeda(f.folhaMinimaIII)}. Mantenha o monitoramento mensal.
                  </p>
                )}
              </div>
            )}
          </div>
        </Secao>
      ) : null}

      {/* Memória do híbrido */}
      <Secao n={comMatriz ? '3' : '2'} titulo="Como chegamos ao híbrido — memória de cálculo" sub="Passo a passo com os números do motor: nada é estimado aqui">
        <div className="space-y-3">
          {(comMatriz ? (['III', 'V'] as const) : ([d.anexo] as const)).map((ax) => {
            const mem = report.memoriaHibrido[ax];
            return (
              <div key={ax} className="rounded-2xl border border-[var(--line)] bg-white p-4 dark:bg-slate-900">
                <h4 className="text-xs font-black">Anexo {ax}</h4>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  <li>DAS convencional de {fmtMoeda(mem.dasTotal)} (CBS de {fmtMoeda(mem.cbsDentroDas)} dentro da guia).</li>
                  <li>DAS reduzido = {fmtMoeda(mem.dasTotal)} − {fmtMoeda(mem.cbsDentroDas)} = {fmtMoeda(mem.dasReduzido)}.</li>
                  <li>Débitos de CBS sobre a receita: {fmtMoeda(mem.debitosCbs)}.</li>
                  <li>Créditos de CBS sobre as despesas: {fmtMoeda(mem.creditosCbs)} (detalhe abaixo).</li>
                  <li>CBS a recolher por fora = {fmtMoeda(mem.debitosCbs)} − {fmtMoeda(mem.creditosCbs)} = {fmtMoeda(mem.cbsARecolher)}{mem.saldoCredor > 0 ? ` (saldo credor de ${fmtMoeda(mem.saldoCredor)} para o mês seguinte)` : ''}.</li>
                  <li>Total híbrido = {fmtMoeda(mem.dasReduzido)} + {fmtMoeda(mem.cbsARecolher)} = {fmtMoeda(mem.totalHibrido)}.</li>
                </ol>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-[11px]">
                    <thead>
                      <tr className="text-left text-slate-400">
                        <th scope="col" className="py-1 font-bold">Despesa</th>
                        <th scope="col" className="py-1 text-right font-bold">Valor</th>
                        <th scope="col" className="py-1 text-right font-bold">Fator</th>
                        <th scope="col" className="py-1 text-right font-bold">Crédito</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {mem.creditosPorDespesa.map((cd) => (
                        <tr key={cd.rotulo} className="border-t border-[var(--line)]">
                          <td className="py-1 font-sans">{cd.rotulo}</td>
                          <td className="py-1 text-right">{fmtMoeda(cd.valor)}</td>
                          <td className="py-1 text-right">{fmtCarga(cd.fator * 100)}</td>
                          <td className="py-1 text-right font-bold">{fmtMoeda(cd.credito)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-[var(--line)] font-bold">
                        <td className="py-1 font-sans">Total de créditos</td>
                        <td className="py-1" />
                        <td className="py-1" />
                        <td className="py-1 text-right">{fmtMoeda(mem.creditosCbs)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </Secao>

      {comMatriz ? (
        <Secao n="4" titulo="Demais anexos — referência" sub="Comércio, indústria e serviços sem CPP, com os mesmos inputs (apenas referência)">
          <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#F2F0EB] text-left dark:bg-slate-800">
                  <th scope="col" className="px-3 py-2 font-bold">Anexo</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Conv (DAS)</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Híb (total)</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Diferença</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Vencedor</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {report.comparativo.tabelaOutrosAnexos.map((l) => (
                  <tr key={l.anexo} className="border-t border-[var(--line)]">
                    <td className="px-3 py-2 font-sans font-semibold">Anexo {l.anexo} <span className="block text-[10px] font-normal text-slate-400">efetiva {fmtCarga(l.aliquotaEfetivaConv * 100)}</span></td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(l.convTotal)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(l.hibTotal)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${l.deltaRs > 0 ? 'text-sky-700 dark:text-sky-300' : l.deltaRs < 0 ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                      {l.deltaRs === 0 ? '—' : `${l.deltaRs > 0 ? '+' : '−'} ${fmtMoeda(Math.abs(l.deltaRs))}`}
                    </td>
                    <td className="px-3 py-2 text-right">{l.vencedor === 'EMPATE' ? 'Empate' : l.vencedor === 'CONV' ? 'Convencional' : 'Híbrido'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      ) : null}

      {/* IA */}
      <Secao n="✦" titulo="Insights da Inteligência Tributária" sub="Textos gerados por IA em modo leitura a partir dos cálculos do motor — a IA não altera valores">
        <div className="space-y-2">
          {insights.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-center text-xs text-slate-400">Sem insights para este perfil.</p>
          ) : insights.map((ins, i) => (
            <article key={ins.insightId} className="rounded-2xl border border-[var(--line)] bg-white p-4 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#0F3D3E] to-[#C9A96A] text-[11px] font-black text-white">{i + 1}</span>
                <h4 className="flex-1 text-xs font-black">{ins.titulo}</h4>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ins.nivel === 'OPORTUNIDADE' ? 'bg-emerald-100 text-emerald-800' : ins.nivel === 'ALERTA' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{ICONE_NIVEL[ins.nivel]} {ins.nivel}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{ins.texto}</p>
              <p className="mt-1 font-mono text-[10px] text-slate-400">ref: {ins.cenariosRef.join(' · ')}</p>
            </article>
          ))}
          <p className="text-[10px] text-slate-400">Textos gerados por IA a partir de cálculos do motor. IA não recalcula valores — valide com seu contador.</p>
        </div>
      </Secao>

      {/* Metodologia */}
      <details className="rounded-2xl border border-[var(--line)] bg-slate-50/60 px-4 py-3 text-[11px] text-slate-500 dark:bg-slate-950/30">
        <summary className="cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-300">Metodologia e fontes</summary>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 font-mono">
          {report.metodologia.formulas.map((x) => <li key={x}>{x}</li>)}
        </ul>
        <p className="mt-1">Fontes: {report.metodologia.fontes.join(' · ')}</p>
        <p className="mt-0.5">{report.metodologia.aviso}</p>
      </details>
    </div>
  );
}
