/**
 * Guardas de ação sensível — `canRun` antes de excluir/exportar/trocar titular.
 *
 * Uso nos pontos de estrangulamento (já ligados):
 *   - `src/infrastructure/pdf/menu-exportacao.ts` (`dispararExportacao`);
 *   - `src/store/sessao.ts` (`excluir`, `selecionar`).
 *
 * Botões de exportação dentro das páginas (CSV/XLSX/PDF por tela) devem chamar
 * `exigirAcaoSensivel('exportar')` antes de disparar — hoje o menu global
 * (Ctrl+E) e o modo degradado (banner) cobrem o caminho principal.
 */
import { useUi } from '@/store/ui';
import { avaliarGate } from './gate';
import { useLicenca } from './store';
import type { AcaoSensivel } from './types';

export interface BloqueioAcao {
  ok: boolean;
  motivo: string;
}

const ROTULO_ACAO: Record<AcaoSensivel, string> = {
  excluir: 'excluir',
  exportar: 'exportar',
  'trocar-titular': 'trocar a empresa ativa',
};

/**
 * Avalia o gate AGORA (fora do React) e diz se a ação sensível pode seguir.
 * Em `DENY` ou graça degradada → `{ ok: false }` com motivo pronto p/ toast.
 */
export function exigirAcaoSensivel(acao: AcaoSensivel): BloqueioAcao {
  const { estado } = useLicenca.getState();
  const gate = avaliarGate(estado);
  if (gate.decisao === 'DENY') {
    return { ok: false, motivo: `Licença bloqueada (${gate.motivo}) — não é possível ${ROTULO_ACAO[acao]} agora.` };
  }
  if (gate.bloquearSensiveis) {
    return { ok: false, motivo: `Período de graça — regularize a assinatura para ${ROTULO_ACAO[acao]}.` };
  }
  return { ok: true, motivo: '' };
}

/** Atalho p/ componentes: checa, toasta e retorna `true` se liberado. */
export function podeAcaoSensivel(acao: AcaoSensivel): boolean {
  const r = exigirAcaoSensivel(acao);
  if (!r.ok) useUi.getState().toast(r.motivo, 'warn');
  return r.ok;
}
