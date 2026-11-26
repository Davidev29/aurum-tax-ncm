/**
 * Simples Nacional — cartão secundário com título e ação opcional no cabeçalho.
 */

function SubCard({ titulo, children, aside }: { titulo: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xl font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">{titulo}</h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

export { SubCard }
