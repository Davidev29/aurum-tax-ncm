/**
 * Sessão: empresa ativa, catálogo de empresas e emitente (timbrado dos PDFs).
 */
import { create } from 'zustand'
import type { Emitente, Empresa } from '@/domain/entities'
import {
  cadastrarEmpresa,
  cadastrarEmpresaPorCnpj,
  definirEmpresaAtiva as definirEmpresaAtivaSessao,
  empresaAtivaId,
  excluirEmpresa,
  importarEmpresas,
  importarEmpresasPorCnpjs,
  listarEmpresas,
} from '@/application/empresas'
import { carregarEmitente, salvarEmitente } from '@/application/emitente'
import { toast } from './ui'

interface SessaoState {
  empresas: Empresa[]
  ativa: Empresa | null
  emitente: Emitente | null
  carregando: boolean

  /** Recarrega empresas + emitente e restaura a sessão salva. */
  iniciar: () => Promise<void>
  selecionar: (id: number | null) => Promise<void>
  limparSessao: () => Promise<void>
  criar: (dados: { razaoSocial: string; cnpj?: string; fantasia?: string }) => Promise<boolean>
  excluir: (id: number) => Promise<void>
  importar: (file: File) => Promise<number>
  /** Cadastra pelo CNPJ via BrasilAPI (idempotente). Devolve `false` se falhar. */
  criarPorCnpj: (cnpj: string) => Promise<boolean>
  /** Lote de CNPJs via BrasilAPI (idempotente, com progresso). */
  importarLoteCnpjs: (cnpjs: string[], onProgress?: (feito: number, total: number) => void) => Promise<{ novas: number; atualizadas: number; erros: number }>
  persistirEmitente: (parcial: Partial<Emitente>) => Promise<void>
}

export const useSessao = create<SessaoState>((set, get) => ({
  empresas: [],
  ativa: null,
  emitente: null,
  carregando: true,

  iniciar: async () => {
    set({ carregando: true })
    const [empresas, emitente] = await Promise.all([listarEmpresas(), carregarEmitente()])
    // Migração silenciosa: quarentenas legadas gravadas no cadastro errado
    // voltam ao dono (isolamento por perfil). Best-effort, nunca trava o boot.
    try {
      const { realocarQuarentenaLegada } = await import('@/application/notas-xml')
      await realocarQuarentenaLegada()
    } catch {
      /* base antiga sem índice — segue o jogo */
    }
    const id = empresaAtivaId()
    const ativa = id === null ? null : (empresas.find((e) => e.id === id) ?? null)
    if (id !== null && !ativa) definirEmpresaAtivaSessao(null)
    set({ empresas, emitente, ativa, carregando: false })
  },

  selecionar: async (id) => {
    if (id === null) return get().limparSessao()
    const alvo = get().empresas.find((e) => e.id === id)
    if (!alvo) return
    definirEmpresaAtivaSessao(id)
    set({ ativa: alvo })
  },

  limparSessao: async () => {
    definirEmpresaAtivaSessao(null)
    set({ ativa: null })
    toast('Empresa ativa removida.', 'warn')
  },

  criar: async (dados) => {
    const r = await cadastrarEmpresa(dados)
    if (!r.ok) {
      toast(r.motivo ?? 'Não foi possível cadastrar.', 'warn')
      return false
    }
    const empresas = await listarEmpresas()
    // D22 — a primeira empresa cadastrada é ativada automaticamente.
    let ativa = get().ativa
    if (!ativa && r.empresa) {
      definirEmpresaAtivaSessao(r.empresa.id ?? null)
      ativa = r.empresa
    }
    set({ empresas, ativa })
    toast('Empresa cadastrada.', 'ok')
    return true
  },

  excluir: async (id) => {
    await excluirEmpresa(id)
    const eraAtiva = get().ativa?.id === id
    if (eraAtiva) definirEmpresaAtivaSessao(null)
    const empresas = await listarEmpresas()
    set({ empresas, ativa: eraAtiva ? null : get().ativa })
  },

  importar: async (file) => {
    const { total } = await importarEmpresas(file)
    const empresas = await listarEmpresas()
    set({ empresas })
    return total
  },

  criarPorCnpj: async (cnpj) => {
    try {
      const r = await cadastrarEmpresaPorCnpj(cnpj)
      if (!r.ok) {
        toast(r.motivo ?? 'Não foi possível cadastrar.', 'warn')
        return false
      }
      const empresas = await listarEmpresas()
      let ativa = get().ativa
      if (!ativa && r.empresa) {
        definirEmpresaAtivaSessao(r.empresa.id ?? null)
        ativa = r.empresa
      } else if (r.empresa) {
        // Recarrega a ativa caso tenha sido completada (IE/IM/endereço).
        const recarregada = empresas.find((e) => e.id === ativa?.id) ?? ativa
        ativa = recarregada
      }
      set({ empresas, ativa })
      toast(r.atualizada ? 'Empresa já existia — dados completados.' : 'Empresa cadastrada.', 'ok')
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
      return false
    }
  },

  importarLoteCnpjs: async (cnpjs, onProgress) => {
    const resumo = await importarEmpresasPorCnpjs(cnpjs, onProgress)
    const empresas = await listarEmpresas()
    let ativa = get().ativa
    if (!ativa && empresas.length) {
      definirEmpresaAtivaSessao(empresas[0].id ?? null)
      ativa = empresas[0]
    }
    set({ empresas, ativa })
    return { novas: resumo.novas, atualizadas: resumo.atualizadas, erros: resumo.erros.length }
  },

  persistirEmitente: async (parcial) => {
    const emitente = await salvarEmitente(parcial)
    set({ emitente })
    try {
      const id = `${emitente?.razaoSocial ?? ''}|${emitente?.cnpj ?? ''}`.trim()
      if (id.replace('|', '')) localStorage.setItem('aurum_emitente_id', id)
    } catch { /* offline-first: memoria segue em default */ }
  },
}))
