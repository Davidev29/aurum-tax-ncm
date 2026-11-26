/**
 * Simples Nacional — cabeçalho de passo do wizard com selo de conclusão.
 */

function Passo({ n, titulo, desc, feito }: { n: string; titulo: string; desc: string; feito?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-black ${feito ? 'bg-emerald-600 text-white' : 'calc-step-dot !h-7 !w-7 !text-[13px]'}`}>{feito ? '✓' : n}</span>
      <span className="min-w-0">
        <span className="block truncate text-xl font-extrabold tracking-tight">{titulo}</span>
        <span className="block truncate text-[13px] text-slate-600 dark:text-slate-300" title={desc}>{desc}</span>
      </span>
    </div>
  );
}

export { Passo }
