/**
 * Estado da base tributária: status, progresso de importação/seed e
 * manutenção (importar JSON, resemear, apagar).
 */
import { create } from 'zustand'
import {
  apagarBase,
  importarArquivoBase,
  inicializarBase,
  resemearBase,
  restaurarBasePadrao,
  statusBase,
  type StatusBase,
} from '@/application/base'
import { sincronizacaoAutomatica } from '@/application/cff-sync'
import { sincronizacaoAutomaticaNcm } from '@/application/ncm-sync'
import { toast } from './ui'
import { useAuxiliares } from './auxiliares'

interface BaseState {
  status: StatusBase | null
  progresso: { etapa: string; pct: number } | null
  erro: string | null
  pronta: boolean

  iniciar: () => Promise<void>
  recarregar: () => Promise<void>
  importar: (json: unknown, nomeArquivo: string) => Promise<boolean>
  resemear: () => Promise<void>
  restaurar: () => Promise<void>
  apagar: () => Promise<void>
  limparProgresso: () => void
}

export const useBase = create<BaseState>((set, get) => {
  const onProgress = (etapa: string, pct: number) => set({ progresso: { etapa, pct } })

  return {
    status: null,
    progresso: null,
    erro: null,
    pronta: false,

    iniciar: async () => {
      try {
        const status = await inicializarBase(onProgress)
        set({ status, pronta: true, erro: null, progresso: null })

        // Dispara sincronização CFF em background (não bloqueia a UI)
        // Só roda se passou 24h desde a última verificação
        void sincronizacaoAutomatica().catch((e) => {
          console.warn('[CFF Sync] Falha na sincronização automática:', e)
        })

        // NCM vigente (Siscomex): mesma regra de 24h, em background
        void sincronizacaoAutomaticaNcm().catch((e) => {
          console.warn('[NCM Sync] Falha na sincronização automática:', e)
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ erro: msg, progresso: null, pronta: true })
        toast(`Falha ao preparar a base: ${msg}`, 'err')
      }
    },

    recarregar: async () => {
      const status = await statusBase()
      set({ status })
    },

    importar: async (json, nomeArquivo) => {
      try {
        const formato = await importarArquivoBase(json, nomeArquivo, onProgress)
        await get().recarregar()
        set({ progresso: null })
        toast(
          formato.formato === 'nomenclatura'
            ? `Nomenclatura NCM importada: ${formato.total} códigos.`
            : `Base da Reforma importada: ${formato.total} NCMs.`,
          'ok',
        )
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        set({ progresso: null })
        toast(`Erro na importação: ${msg}`, 'err')
        return false
      }
    },

    resemear: async () => {
      const status = await resemearBase(onProgress)
      set({ status, progresso: null })
      await useSessaoAux()
      toast('Base embutida recarregada.', 'ok')
    },

    restaurar: async () => {
      const status = await restaurarBasePadrao(onProgress)
      set({ status, progresso: null })
      await useSessaoAux()
      toast('Base restaurada para o padrão embutido.', 'ok')
    },

    apagar: async () => {
      onProgress('Apagando base importada', 30)
      try {
        await apagarBase()
        const status = await statusBase()
        set({ status, progresso: null })
        await useSessaoAux()
        toast('Base apagada.', 'warn')
      } catch (e) {
        set({ progresso: null })
        toast(`Erro ao apagar a base: ${e instanceof Error ? e.message : String(e)}`, 'err')
      }
    },

    limparProgresso: () => set({ progresso: null }),
  }
})

/** Recarrega os catálogos auxiliares que dependem da base. */
async function useSessaoAux(): Promise<void> {
  await useAuxiliares.getState().recarregarTudo()
}
