/**
 * Simples Nacional — barra de repartição tributária com legenda por tributo.
 */
import { fmtMoeda } from '@/domain/services/format'

function BarraReparticao({ partes }: { partes: { rotulo: string; valor: number; classe: string; cor?: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  return (
    <div>
      <div className="calc-bar" aria-hidden="true">
        {partes.map((p) => (
          <span key={p.rotulo} className={p.classe} style={{ width: `${total > 0 ? (p.valor / total) * 100 : 0}%`, ...(p.cor ? { backgroundColor: p.cor } : {}) }} title={`${p.rotulo}: ${fmtMoeda(p.valor)}`} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[13px] text-slate-600 sm:flex sm:flex-wrap dark:text-slate-300">
        {partes.filter((p) => p.valor > 0).map((p) => (
          <span key={p.rotulo}><span aria-hidden="true" style={p.cor ? { color: p.cor } : undefined}>■</span> {p.rotulo}: {fmtMoeda(p.valor)}</span>
        ))}
      </div>
    </div>
  );
}

export { BarraReparticao }
