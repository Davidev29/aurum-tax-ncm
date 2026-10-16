/**
 * Banner da licença (graça/offline) + selo do cabeçalho.
 *
 * Renderizado pelo `Layout` acima do conteúdo: em `GRACE` avisa o vencimento
 * e o bloqueio de excluir/exportar/trocar titular; offline mostra o modo
 * offline permitido. Exibe SEMPRE `keyMasked` (`••••-WXYZ`), nunca a chave.
 */
import { useUi } from '@/store/ui';
import { diasParaVencer } from '../gate';
import { useLicenca } from '../store';

function fmtData(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function BannerLicenca() {
  const estado = useLicenca((s) => s.estado);
  const gate = useLicenca((s) => s.gate);
  const online = useLicenca((s) => s.online);
  const trocarView = useUi((s) => s.trocarView);
  if (!estado) return null;

  if (gate.motivo === 'GRACE') {
    return (
      <div
        role="alert"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-white px-4 py-2.5 text-xs text-amber-900 shadow-card dark:border-amber-900 dark:from-amber-950/40 dark:to-slate-900 dark:text-amber-200"
      >
        <span className="text-base" aria-hidden="true">⏳</span>
        <div className="min-w-[180px] flex-1">
          <strong>Assinatura vencida — período de graça até {fmtData(estado.grace_until)}.</strong>{' '}
          Excluir, exportar e trocar a empresa ativa estão bloqueados. Licença {estado.keyMasked ?? '••••-????'}.
        </div>
        <button type="button" onClick={() => trocarView('faturas')} className="btn btn-press btn-primary btn-sm">
          Ver faturas / Renovar
        </button>
      </div>
    );
  }

  if (!online && gate.decisao === 'ALLOW') {
    const dias = diasParaVencer(estado);
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 shadow-card dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <span className="text-base" aria-hidden="true">📴</span>
        <div className="min-w-[180px] flex-1">
          Você está <strong>offline</strong> — licença válida{dias !== null && dias >= 0 ? ` por mais ${dias} dia(s)` : ''} (até {fmtData(estado.off_exp)}).
        </div>
      </div>
    );
  }

  return null;
}

/** Selo compacto do cabeçalho: licença mascarada + dias restantes. */
export function SeloLicenca() {
  const estado = useLicenca((s) => s.estado);
  const gate = useLicenca((s) => s.gate);
  const trocarView = useUi((s) => s.trocarView);
  if (!estado) return null;
  const dias = diasParaVencer(estado);
  const tom = gate.motivo === 'GRACE'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
  return (
    <button
      type="button"
      onClick={() => trocarView('faturas')}
      className={`pill ${tom} cursor-pointer`}
      title={`Licença ${estado.keyMasked ?? '••••-????'} — ver conta e faturas`}
    >
      {gate.motivo === 'GRACE' ? '⏳ Graça' : '✓ Licenciado'} · {estado.keyMasked ?? '••••-????'}
      {dias !== null && dias >= 0 && dias <= 30 ? ` · ${dias}d` : ''}
    </button>
  );
}
