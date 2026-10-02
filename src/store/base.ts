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
import { toast } from './ui'
import { useAuxiliares } from './auxiliares'

interface BaseState {
  status: StatusBase | null
  progresso: { etapa: string; pct: number } | null
  erro: string | null
  pronta: boolean

  iniciar: () => Promise<void>
  recarregar: () => Promise<void>
  importar: (json: unknown, nomeArquivo: string, sistema?: string) => Promise<boolean>
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

        // Sem sincronização de rede: as tabelas viajam embutidas em
        // `dist/base` e são renovadas pela atualização do programa
        // (electron-updater, aba 🔄 Atualização nas Configurações).
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

    importar: async (json, nomeArquivo, sistema) => {
      try {
        const formato = await importarArquivoBase(json, nomeArquivo, onProgress, { sistema })
        await get().recarregar()
        set({ progresso: null })
        const rotulo =
          formato.formato === 'nomenclatura'
            ? `Nomenclatura NCM importada: ${formato.total} códigos.`
            : formato.formato === 'classprod-cff'
              ? `Produtos ${formato.sistema} importados: ${formato.total} itens.`
              : formato.formato === 'anexos-cff'
                ? `Anexos importados: ${formato.total} linhas.`
                : formato.formato === 'classtrib-cff'
                  ? `Classificação tributária (CFF) importada: ${formato.total} referências.`
                  : `Base importada (${formato.formato}): ${formato.total} registros.`
        toast(rotulo, 'ok')
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
