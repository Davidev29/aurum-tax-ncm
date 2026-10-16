/**
 * Registro de exportadores de PDF por view.
 *
 * O menu nativo do Electron ("Exportar relatório…" / Ctrl+E) envia a ação
 * `exportar` pelo canal IPC `menu:acao` (ver `electron/main.ts` e
 * `electron/preload.ts`). O `Layout` assina esse canal e chama
 * `dispararExportacao(viewAtiva)` — cada tela que exporta PDF registra seu
 * handler aqui quando é montada e remove ao desmontar.
 */
import type { ViewId } from '@/store/ui'
// AURUM-GATE: exportação é ação sensível (bloqueada em graça/DENY).
import { podeAcaoSensivel } from '@/aurum/guards'

type Exportador = () => void | Promise<void>

const exportadores = new Map<ViewId, Exportador>()

/**
 * Registra o handler de exportação de PDF de uma view.
 * Devolve uma função de limpeza para o `useEffect` da página.
 */
export function registrarExportador(view: ViewId, fn: Exportador): () => void {
  exportadores.set(view, fn)
  return () => {
    exportadores.delete(view)
  }
}

/** Dispara a exportação de PDF da view ativa (menu nativo Ctrl+E). */
export function dispararExportacao(view: ViewId): void {
  // AURUM-GATE: sem licença válida (ou em graça), não exporta.
  if (!podeAcaoSensivel('exportar')) return
  const fn = exportadores.get(view)
  if (fn) void fn()
}
