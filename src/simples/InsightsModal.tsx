/**
 * Simples Nacional — Relatório Analítico e Inteligente em modal.
 *
 * Todo o bloco "Relatório Analítico e Inteligente" vive aqui (condensado):
 * Resumo + Comparativo + Gráficos (barras/donut/tabela/deltas) + IA + Método.
 * Exportações (CSV / JSON / PDF) ficam no topo do modal.
 *
 * Componente PURO de leitura: apenas formata `ReportAnalitico` + `AiInsight`.
 * Nenhum cálculo aqui — qualquer número novo deve vir do orquestrador.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtCarga, fmtCnpj, fmtMoeda } from '@/domain/services/format';
import { Btn, empilharEscapeModal, ehTopoEscapeModal, useAcaoTatil } from '@/ui/kit';
import { EMITENTE_PADRAO } from '@/domain/entities';
import { useSessao } from '@/store/sessao';
import { toast } from '@/store/ui';
import { exportarRelatorioAnaliticoCSV, exportarRelatorioAnaliticoJSON, exportarRelatorioAnaliticoPDF } from './export-relatorio-analitico';
import type { AiInsight } from './ia-insights';
import type { ReportAnalitico, ScenarioId } from './relatorio-analitico';

type TabId = 'resumo' | 'comparativo' | 'graficos' | 'ia' | 'metodo';
type ChartView = 'barras' | 'donut' | 'tabela' | 'delta';

function cenario(report: ReportAnalitico, id: ScenarioId) {
  return report.cenarios.find((c) => c.scenarioId === id)!;
}

const TABS: { id: TabId; rotulo: string }[] = [
  { id: 'resumo', rotulo: 'Resumo' },
  { id: 'comparativo', rotulo: 'Comparativo' },
  { id: 'graficos', rotulo: 'Gráficos' },
  { id: 'ia', rotulo: 'Insights IA' },
  { id: 'metodo', rotulo: 'Método' },
];

const VIEWS: { id: ChartView; rotulo: string }[] = [
  { id: 'barras', rotulo: 'Barras' },
  { id: 'donut', rotulo: 'Donut' },
  { id: 'tabela', rotulo: 'Tabela' },
  { id: 'delta', rotulo: 'Deltas' },
];

const ICONE_NIVEL: Record<AiInsight['nivel'], string> = {
  OPORTUNIDADE: '●',
  ALERTA: '▲',
  INFO: '◆',
};

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

function Donut({ partes }: { partes: { rotulo: string; valor: number; cor: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0) || 1;
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = partes.map((p) => {
    const frac = p.valor / total;
    const seg = { ...p, dash: frac * C, offset: acc * C };
    acc += frac;
    return seg;
  });
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0" role="img" aria-label="Distribuição dos cenários">
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="14" className="stroke-slate-100 dark:stroke-slate-800" />
        {segs.map((s) => (
          <circle
            key={s.rotulo}
            cx="50" cy="50" r={R} fill="none" strokeWidth="14"
            stroke={s.cor}
            strokeDasharray={`${s.dash} ${C - s.dash}`}
            strokeDashoffset={-s.offset + C / 4}
            strokeLinecap="butt"
            transform="rotate(-90 50 50)"
          />
        ))}
        <text x="50" y="52" textAnchor="middle" className="fill-slate-700 text-[11px] font-black dark:fill-slate-200">
          {fmtMoeda(Math.min(...partes.map((p) => p.valor)))}
        </text>
        <text x="50" y="62" textAnchor="middle" className="fill-slate-400 text-[7px]">menor total</text>
      </svg>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {partes.map((p) => (
          <li key={p.rotulo} className="flex items-center gap-2 text-[11px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.cor }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{p.rotulo}</span>
            <span className="font-mono font-bold tabular-nums">{fmtMoeda(p.valor)}</span>
            <span className="w-11 text-right font-mono text-slate-400 tabular-nums">{((p.valor / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InsightsModal({ report, insights, aberto, onFechar }: { report: ReportAnalitico; insights: AiInsight[]; aberto: boolean; onFechar: () => void }) {
  const [tab, setTab] = useState<TabId>('resumo');
  const [view, setView] = useState<ChartView>('barras');
  const [filtro, setFiltro] = useState<'TODOS' | AiInsight['nivel']>('TODOS');
  const [memAberta, setMemAberta] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const pdf = useAcaoTatil(async () => {
    const emitente = useSessao.getState().emitente ?? EMITENTE_PADRAO;
    await exportarRelatorioAnaliticoPDF(report, insights, emitente);
    toast('Relatório analítico em PDF gerado.', 'ok');
  });

  useEffect(() => {
    if (aberto) {
      setTab('resumo');
      setView('barras');
      setFiltro('TODOS');
      setMemAberta(null);
    }
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ehTopoEscapeModal(onKey)) onFechar();
    };
    window.addEventListener('keydown', onKey);
    const desempilhar = empilharEscapeModal(onKey);
    const t = window.setTimeout(() => boxRef.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      desempilhar();
      window.clearTimeout(t);
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;
  if (typeof document === 'undefined') return null;

  const comMatriz = report.contexto.mostrarMatrizIIIV;
  const iiiC = cenario(report, 'III_CONV');
  const vC = cenario(report, 'V_CONV');
  const iiiH = cenario(report, 'III_HIB');
  const vH = cenario(report, 'V_HIB');
  const menor = report.comparativo.menorCargaScenarioId ? cenario(report, report.comparativo.menorCargaScenarioId) : null;
  const maxTotal = Math.max(iiiC.totalPagar, vC.totalPagar, iiiH.totalPagar, vH.totalPagar, 1);
  const d = report.dueloFoco;
  const memFoco = report.memoriaHibrido[d.anexo];
  const economiaFoco = Math.abs(d.deltaRs);
  const economiaConv = vC.totalPagar - iiiC.totalPagar;
  const economiaHib = vH.totalPagar - iiiH.totalPagar;
  const f = report.fatorR;
  const gaugePct = Math.min(100, (f.valor / 0.4) * 100);
  const marcoPct = (0.28 / 0.4) * 100;
  const manual = report.empresa.origem === 'MANUAL';
  const elegiveisLabel = report.contexto.anexosElegiveis.join(', ') || d.anexo;

  const veredito = menor
    ? `Menor carga: ${menor.anexo === 'III' ? 'Anexo III' : menor.anexo === 'V' ? 'Anexo V' : `Anexo ${menor.anexo}`} no ${menor.regime === 'CONVENCIONAL' ? 'convencional' : 'híbrido'} — ${fmtMoeda(menor.totalPagar)}`
    : d.vencedor === 'EMPATE'
      ? `Empate no Anexo ${d.anexo} — ${fmtMoeda(d.convTotal)}`
      : `${d.vencedor === 'CONV' ? 'Convencional' : 'Híbrido'} vence no Anexo ${d.anexo} — ${fmtMoeda(Math.min(d.convTotal, d.hibTotal))}`;

  const barras: [string, number, boolean][] = comMatriz
    ? [['III · Conv', iiiC.totalPagar, !!iiiC.vencedor], ['V · Conv', vC.totalPagar, !!vC.vencedor], ['III · Híb', iiiH.totalPagar, !!iiiH.vencedor], ['V · Híb', vH.totalPagar, !!vH.vencedor]]
    : [[`Conv · ${d.anexo}`, d.convTotal, d.vencedor === 'CONV'], [`Híb · ${d.anexo}`, d.hibTotal, d.vencedor === 'HIB']];

  const donutPartes = barras.map(([r, v], i) => ({
    rotulo: r,
    valor: v,
    cor: ['#0F3D3E', '#C9A96A', '#0E7490', '#A3A3A3'][i % 4]!,
  }));

  const deltas = comMatriz
    ? report.comparativo.matrizDeltas.map((x) => ({ rotulo: `${x.de} → ${x.para}`, valor: x.deltaRs }))
    : [{ rotulo: `${d.convId} → ${d.hibId}`, valor: d.deltaRs }];

  const insightsFiltrados = insights.filter((ins) => filtro === 'TODOS' || ins.nivel === filtro);
  const contagem = (n: AiInsight['nivel']) => insights.filter((i) => i.nivel === n).length;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Relatório Analítico e Inteligente — Simples Nacional"
    >
      <div ref={boxRef} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* Cabeçalho + empresa + exports */}
        <header className="border-b border-[var(--line)] px-4 pb-2.5 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-black tracking-tight">Relatório Analítico e Inteligente <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-px align-middle text-[10px] font-bold text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">EXECUTIVO</span></h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                <strong className="truncate text-slate-700 dark:text-slate-200">{report.empresa.razaoSocial || 'Empresa'}</strong>
                {manual
                  ? <span className="rounded-full border border-dashed border-[#92400E] bg-[#FEF3C7] px-1.5 py-px text-[10px] font-bold text-[#92400E]">Manual</span>
                  : <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-800">CNPJ</span>}
                {report.empresa.cnpj ? <span className="font-mono">CNPJ {fmtCnpj(report.empresa.cnpj)}</span> : null}
                <span>{report.competencia}</span>
                {report.empresa.cnaePrincipal ? <span className="truncate">CNAE {report.empresa.cnaePrincipal} (Anexo {elegiveisLabel})</span> : null}
              </p>
            </div>
            <button type="button" data-autofocus onClick={onFechar} aria-label="Fechar relatório" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn tam="sm" className="flex-1" onClick={() => exportarRelatorioAnaliticoCSV(report)}>CSV analítico</Btn>
            <Btn tam="sm" className="flex-1" onClick={() => exportarRelatorioAnaliticoJSON(report, insights)}>JSON canônico</Btn>
            <Btn tam="sm" variante="primary" className="flex-[2]" carregando={pdf.carregando} onClick={() => pdf.executar()}>
              {pdf.carregando ? 'Gerando…' : 'PDF analítico premium'}
            </Btn>
          </div>
        </header>
        <nav role="tablist" aria-label="Seções do relatório" className="flex gap-1 overflow-x-auto border-b border-[var(--line)] px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-bold transition ${tab === t.id ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
            >
              {t.rotulo}
              {t.id === 'ia' ? <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-[10px] dark:bg-slate-700">{insights.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="tabpanel">
          {tab === 'resumo' ? (
            <div className="space-y-2.5">
              <p className="rounded-xl bg-[#0F3D3E] px-3 py-2 text-xs font-bold text-white" role="status">✓ {veredito}</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {(comMatriz ? [
                  { rotulo: 'Menor total', valor: menor ? fmtMoeda(menor.totalPagar) : '—', sub: menor?.scenarioId.replace('_', ' · ') },
                  { rotulo: 'Economia V → III', valor: fmtMoeda(Math.max(economiaConv, economiaHib)), sub: `Conv ${fmtMoeda(economiaConv)} · Híb ${fmtMoeda(economiaHib)}` },
                  { rotulo: 'Fator r', valor: f.dadosSuficientes ? fmtCarga(f.valor * 100) : '—', sub: f.dadosSuficientes ? (f.enquadrado ? 'Enquadrado (≥ 28%)' : 'Abaixo de 28%') : 'Informe a folha' },
                ] : [
                  { rotulo: `Conv · ${d.anexo}`, valor: fmtMoeda(d.convTotal), sub: `Efetiva ${fmtCarga(d.aliquotaEfetivaConv * 100)}` },
                  { rotulo: `Híb · ${d.anexo}`, valor: fmtMoeda(d.hibTotal), sub: 'DAS reduzido + CBS fora' },
                  { rotulo: 'Diferença', valor: d.vencedor === 'EMPATE' ? 'Empate' : fmtMoeda(economiaFoco), sub: d.vencedor === 'EMPATE' ? 'Totais iguais' : d.vencedor === 'CONV' ? 'Convencional vence' : 'Híbrido vence' },
                ]).map((k) => (
                  <div key={k.rotulo} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 dark:bg-slate-900">
                    <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">{k.rotulo}</span>
                    <span className="mt-0.5 block font-mono text-[15px] font-black tabular-nums">{k.valor}</span>
                    {k.sub ? <span className="block truncate text-[10px] text-slate-500" title={k.sub}>{k.sub}</span> : null}
                  </div>
                ))}
              </div>
              {comMatriz ? (
                <FaixaVantagem
                  vencedor="CONV"
                  economia={economiaConv}
                  texto={`III ${fmtMoeda(iiiC.totalPagar)} × V ${fmtMoeda(vC.totalPagar)} — efetiva III ${fmtCarga(iiiC.aliquotaEfetiva * 100)} < V ${fmtCarga(vC.aliquotaEfetiva * 100)}.`}
                />
              ) : (
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
              )}
              {report.contexto.mostrarFatorR ? (
                <div className="rounded-xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900">
                  <div className="flex items-center justify-between text-[11px]">
                    <strong>Fator r {f.dadosSuficientes ? fmtCarga(f.valor * 100) : '—'}</strong>
                    {f.dadosSuficientes ? (
                      f.enquadrado
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">≥ 28% · III</span>
                        : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">&lt; 28% · V</span>
                    ) : <span className="text-[10px] text-slate-400">informe a folha 12m</span>}
                  </div>
                  <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-2 rounded-full ${f.enquadrado ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${gaugePct}%` }} />
                    <div className="absolute top-0 h-2 w-0.5 bg-[#0F3D3E]" style={{ left: `${marcoPct}%` }} />
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-400"><span>0%</span><span>▼ 28%</span><span>40%</span></div>
                  {!f.enquadrado && f.dadosSuficientes ? (
                    <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Faltam <strong className="font-mono">{fmtMoeda(f.gapFolha)}</strong> (~<strong className="font-mono">{fmtMoeda(f.gapMensalProlabore)}/mês</strong>). Economia V→III: <strong className="font-mono">{fmtMoeda(economiaConv)}/mês</strong>.
                    </p>
                  ) : f.enquadrado ? (
                    <p className="mt-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                      Folha mínima {fmtMoeda(f.folhaMinimaIII)} — monitore mensalmente.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'comparativo' ? (
            <div className="space-y-2.5">
              {comMatriz ? (
                <>
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
                </>
              ) : (
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
              )}
              <details className="rounded-xl border border-[var(--line)] px-3 py-2" open={false}>
                <summary className="cursor-pointer text-xs font-bold">Como chegamos ao híbrido — memória de cálculo</summary>
                <div className="mt-2 space-y-1.5">
                  {(comMatriz ? (['III', 'V'] as const) : ([d.anexo] as const)).map((ax) => {
                    const mem = report.memoriaHibrido[ax];
                    const aberta = memAberta === ax;
                    return (
                      <div key={ax} className="rounded-lg border border-[var(--line)] bg-white dark:bg-slate-900">
                        <button type="button" onClick={() => setMemAberta(aberta ? null : ax)} aria-expanded={aberta} className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-bold">
                          <span>Anexo {ax} · {fmtMoeda(mem.totalHibrido)}</span>
                          <span className="text-slate-400">{aberta ? '▾' : '▸'}</span>
                        </button>
                        {aberta ? (
                          <div className="border-t border-[var(--line)] px-2.5 py-1.5">
                            <ol className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                              <li>1. DAS {fmtMoeda(mem.dasTotal)} − CBS {fmtMoeda(mem.cbsDentroDas)} = {fmtMoeda(mem.dasReduzido)}.</li>
                              <li>2. Débitos {fmtMoeda(mem.debitosCbs)} − créditos {fmtMoeda(mem.creditosCbs)} = {fmtMoeda(mem.cbsARecolher)}{mem.saldoCredor > 0 ? ` (saldo ${fmtMoeda(mem.saldoCredor)})` : ''}.</li>
                              <li>3. Total {fmtMoeda(mem.dasReduzido)} + {fmtMoeda(mem.cbsARecolher)} = {fmtMoeda(mem.totalHibrido)}.</li>
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
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
              {comMatriz ? (
                <details className="rounded-xl border border-[var(--line)] px-3 py-2">
                  <summary className="cursor-pointer text-xs font-bold">Demais anexos — referência (I, II, IV)</summary>
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
            </div>
          ) : null}

          {tab === 'graficos' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" aria-label="Tipo de visualização" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold dark:bg-slate-800">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={view === v.id}
                      onClick={() => setView(v.id)}
                      className={`rounded-md px-2.5 py-1 transition ${view === v.id ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-white' : 'text-slate-500'}`}
                    >
                      {v.rotulo}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-400">{comMatriz ? 'III × V · Conv × Híb' : `Duelo Anexo ${d.anexo}`}</span>
              </div>

              {view === 'barras' ? (
                <div className="space-y-1.5 rounded-xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900">
                  {barras.map(([r, v, win]) => (
                    <div key={r} className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 shrink-0 font-semibold">{r}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className={`h-2 rounded-full ${win ? 'bg-emerald-600' : 'bg-[#0F3D3E]'}`} style={{ width: `${(v / maxTotal) * 100}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right font-mono tabular-nums">{fmtMoeda(v)}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {view === 'donut' ? (
                <div className="rounded-xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900">
                  <Donut partes={donutPartes} />
                </div>
              ) : null}

              {view === 'tabela' ? (
                <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
                  <table className="tbl tbl-compacta w-full min-w-[440px]">
                    <thead>
                      <tr>
                        <th scope="col">Cenário</th>
                        <th scope="col" className="th-r">Total</th>
                        <th scope="col" className="th-r">Efetiva</th>
                        <th scope="col" className="th-r">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {(comMatriz ? [iiiC, vC, iiiH, vH] : [cenario(report, d.convId), cenario(report, d.hibId)]).map((c) => (
                        <tr key={c.scenarioId} className="border-t border-[var(--line)]">
                          <td className="font-sans font-semibold">{c.scenarioId.replace('_', ' · ')}</td>
                          <td className="text-right font-bold">{fmtMoeda(c.totalPagar)}</td>
                          <td className="text-right">{fmtCarga(c.aliquotaEfetiva * 100)}</td>
                          <td className="text-right">{c.vencedor ? 'Vantagem' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {view === 'delta' ? (
                <ul className="space-y-1.5">
                  {deltas.map((x) => (
                    <li key={x.rotulo} className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold ${x.valor <= 0 ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200'}`}>
                      <span className="font-mono">{x.rotulo}</span>
                      <span className="font-mono tabular-nums">{x.valor === 0 ? '—' : `${x.valor > 0 ? '+' : '−'} ${fmtMoeda(Math.abs(x.valor))}`}</span>
                    </li>
                  ))}
                  <li className="text-[10px] text-slate-400">Negativo = economia ao migrar para o destino.</li>
                </ul>
              ) : null}
            </div>
          ) : null}

          {tab === 'ia' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por nível">
                {(['TODOS', 'OPORTUNIDADE', 'ALERTA', 'INFO'] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={filtro === n}
                    onClick={() => setFiltro(n)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${filtro === n ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    {n === 'TODOS' ? `Todos (${insights.length})` : `${n} (${contagem(n)})`}
                  </button>
                ))}
              </div>
              {insightsFiltrados.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-center text-xs text-slate-400">Sem insights neste filtro.</p>
              ) : insightsFiltrados.map((ins, i) => (
                <article key={ins.insightId} className="rounded-xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0F3D3E] to-[#C9A96A] text-[10px] font-black text-white">{i + 1}</span>
                    <h4 className="min-w-0 flex-1 truncate text-xs font-black" title={ins.titulo}>{ins.titulo}</h4>
                    <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ${ins.nivel === 'OPORTUNIDADE' ? 'bg-emerald-100 text-emerald-800' : ins.nivel === 'ALERTA' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{ICONE_NIVEL[ins.nivel]} {ins.nivel}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-300">{ins.texto}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">ref: {ins.cenariosRef.join(' · ')}</p>
                </article>
              ))}
              <p className="text-[10px] text-slate-400">Textos gerados por IA em modo leitura a partir do motor — a IA não altera valores.</p>
            </div>
          ) : null}

          {tab === 'metodo' ? (
            <div className="space-y-2 text-[11px] text-slate-500">
              <ul className="list-disc space-y-0.5 pl-4 font-mono">
                {report.metodologia.formulas.map((x) => <li key={x}>{x}</li>)}
              </ul>
              <p>Fontes: {report.metodologia.fontes.join(' · ')}</p>
              <p>{report.metodologia.aviso}</p>
              <p className="font-mono text-[10px] text-slate-400">Motor {report.motorVersao} · #{report.reportId.slice(0, 8)} · hash {report.hash}</p>
            </div>
          ) : null}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-2.5">
          <Btn tam="sm" onClick={onFechar}>Fechar</Btn>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
