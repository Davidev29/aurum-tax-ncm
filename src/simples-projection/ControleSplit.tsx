/**
 * Controle de split no resultado — slider 0–100% + steppers + presets.
 *
 * Ligado direto ao store (`percentualNova`): arrastar recalcula o relatório
 * em tempo real via `useMemo(simularCenarioDividido)` no modal.
 */
import { fmtMoeda } from '@/domain/services/format';
import { NumeroAnimado } from './NumeroAnimado';
import { useProjecaoDividida } from './store';

const PRESETS = [0, 25, 35, 45, 50, 75, 100];

export function ControleSplit() {
  const percentualNova = useProjecaoDividida((s) => s.percentualNova);
  const receitaTotalMensal = useProjecaoDividida((s) => s.receitaTotalMensal);
  const set = useProjecaoDividida((s) => s.set);

  const pct = Math.round(percentualNova * 100);
  const receitaMedia = receitaTotalMensal.length
    ? receitaTotalMensal.reduce((a, r) => a + (Number(r.receita) || 0), 0) / receitaTotalMensal.length
    : 0;

  const ajustar = (delta: number) => set({ percentualNova: (pct + delta) / 100 });

  return (
    <section className="rounded-2xl border border-brand-700/30 bg-brand-50/50 p-4 dark:bg-brand-950/20" aria-label="Distribuição do faturamento">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
        <span>Distribuição do faturamento — ajuste e veja o resultado recalcular</span>
        <NumeroAnimado valor={pct} formatar={(n) => `${Math.round(n)}% na nova`} className="font-mono text-base tabular-nums" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => ajustar(-5)} aria-label="Menos 5 por cento" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-sm font-black transition-all duration-300 hover:border-brand-700 hover:text-brand-700 dark:bg-slate-900">−5</button>
        <button type="button" onClick={() => ajustar(-1)} aria-label="Menos 1 por cento" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-sm font-black transition-all duration-300 hover:border-brand-700 hover:text-brand-700 dark:bg-slate-900">−</button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => set({ percentualNova: Number(e.target.value) / 100 })}
          className="w-full accent-brand-700"
          aria-label="Percentual da nova empresa (0 a 100%)"
        />
        <button type="button" onClick={() => ajustar(1)} aria-label="Mais 1 por cento" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-sm font-black transition-all duration-300 hover:border-brand-700 hover:text-brand-700 dark:bg-slate-900">+</button>
        <button type="button" onClick={() => ajustar(5)} aria-label="Mais 5 por cento" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-sm font-black transition-all duration-300 hover:border-brand-700 hover:text-brand-700 dark:bg-slate-900">+5</button>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>0% · tudo na mãe</span><span>50%</span><span>100% · tudo na nova</span></div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set({ percentualNova: p / 100 })}
            aria-pressed={pct === p}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all duration-300 ${pct === p ? 'border-brand-700 bg-brand-700 text-white' : 'border-[var(--line)] text-slate-500 hover:border-brand-700 hover:text-brand-700'}`}
          >
            {p}%
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
          mãe <NumeroAnimado valor={receitaMedia * (1 - percentualNova)} formatar={(n) => fmtMoeda(n)} /> · nova <NumeroAnimado valor={receitaMedia * percentualNova} formatar={(n) => fmtMoeda(n)} />/mês
        </span>
      </div>
    </section>
  );
}
