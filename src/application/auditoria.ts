/**
 * Auditoria imutável (append-only).
 *
 * Toda escrita relevante passa por `registrarAuditoria()`: tabelas auxiliares
 * (`salvarRegistroAux`/`excluirRegistroAux`) e reclassificações manuais.
 * A store `audit_log` nunca é atualizada nem limpa pela UI — só `add`.
 * Best-effort: falha de auditoria nunca bloqueia a gravação principal.
 */
import { db } from '@/infrastructure/db/schema'

export type OperacaoAuditoria = 'criar' | 'atualizar' | 'excluir'

export async function registrarAuditoria(
  tabela: string,
  chave: string,
  operacao: OperacaoAuditoria,
  antes: unknown,
  depois: unknown,
  autor = 'local',
): Promise<void> {
  try {
    await db.table('audit_log').add({
      quando: new Date().toISOString(),
      tabela,
      chave: String(chave),
      operacao,
      autor,
      antes: (antes as Record<string, unknown> | null) ?? null,
      depois: (depois as Record<string, unknown> | null) ?? null,
    })
  } catch {
    /* auditoria nunca bloqueia a operação principal */
  }
}
