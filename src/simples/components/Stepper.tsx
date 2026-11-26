/**
 * Simples Nacional — navegação entre as três etapas do wizard.
 */

function Stepper({ etapa, onIr, podeIr3, carregando }: { etapa: 1 | 2 | 3; onIr: (n: 1 | 2 | 3) => void; podeIr3: boolean; carregando?: boolean }) {
  const itens = [
    { n: '1', rotulo: 'Valores' },
    { n: '2', rotulo: 'Anexo' },
    { n: '3', rotulo: 'Resultado' },
  ];
  return (
    <div className="flex justify-center border-b border-[var(--line)] px-3 py-2.5">
    <ol className="flex w-full max-w-[560px] items-center justify-center gap-1 sm:gap-2" aria-label="Etapas" aria-busy={carregando ? true : undefined}>
      {itens.map((it, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const ativo = idx === etapa;
        const feito = idx < etapa || (idx === 3 && podeIr3 && !ativo);
        const bloqueado = idx === 3 && !podeIr3;
        const carregandoEste = carregando && idx === 3;
        return (
          <li key={it.n} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onIr(idx)}
              disabled={bloqueado || carregandoEste}
              aria-current={ativo ? 'step' : undefined}
              title={carregandoEste ? 'Calculando…' : bloqueado ? 'Calcule para ver o resultado' : `Ir para ${it.rotulo}`}
              className={`btn-press flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 py-0.5 text-center transition-all duration-200 ${bloqueado || carregandoEste ? 'min-h-[44px] cursor-not-allowed opacity-60' : 'min-h-[44px] hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <span className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-black transition-all duration-200 ${feito && !carregandoEste ? 'bg-emerald-600 text-white' : ativo || carregandoEste ? 'bg-brand-700 text-white shadow-md ring-2 ring-brand-700/30' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {carregandoEste ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/50 border-t-white" aria-hidden="true" />
                ) : ativo ? (
                  <>
                    <span className="animate-pulse-soft" aria-hidden="true">{it.n}</span>
                    <span className="absolute inset-0 animate-ping rounded-full bg-brand-700/20" aria-hidden="true" />
                  </>
                ) : feito ? (
                  '✓'
                ) : (
                  it.n
                )}
              </span>
              <span className={`truncate text-center text-[13px] ${ativo ? 'font-black' : 'font-semibold text-slate-600 dark:text-slate-300'}`}>{it.rotulo}</span>
            </button>
            {i < itens.length - 1 ? (
              <span className="relative h-px min-w-3 flex-1 overflow-hidden bg-[var(--line)]" aria-hidden="true">
                {ativo || carregando ? <span className="absolute inset-0 animate-pulse-soft bg-gradient-to-r from-transparent via-brand-500/60 to-transparent" /> : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
    </div>
  );
}

export { Stepper }
