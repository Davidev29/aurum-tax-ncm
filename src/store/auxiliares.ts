/**
 * Estado das tabelas auxiliares: caches por tipo, filtro, paginação e
 * edição (modal genérico alimentado por `AUX_META`).
 */
import { create } from 'zustand'
import { PAGE_SIZE } from '@/domain/constants'
import { db } from '@/infrastructure/db/schema'
import type { StoreName } from '@/domain/constants'
import {
  AUX_META,
  TIPOS_AUX,
  type MetaAux,
  type TipoAux,
} from '@/application/aux-meta'
import {
  NORMALIZADORES,
  excluirRegistroAux,
  salvarRegistroAux,
  type KeyPath,
} from '@/application/auxiliares'
import { norm } from '@/domain/services/format'
import { registrarLimpeza, toast } from './ui'

export type RegistroAux = Record<string, unknown>

/** Normalização específica de cada tipo de tabela antes da gravação. */
const NORMALIZADORES_TIPO: Record<TipoAux, ((d: RegistroAux) => void) | undefined> = {
  ncm: (d) => {
    NORMALIZADORES.ncm(d)
    if (d.cst) d.cst = String(d.cst).replace(/\D/g, '').padStart(3, '0')
  },
  ncmnomen: NORMALIZADORES.ncmnomen,
  cfop: NORMALIZADORES.cfop,
  cst: NORMALIZADORES.cst,
  csticms: (d) => {
    if (d.codigo) d.codigo = norm(d.codigo).padStart(3, '0')
  },
  cstpiscofins: (d) => {
    if (d.codigo) d.codigo = norm(d.codigo).padStart(2, '0')
  },
  cstct: undefined,
}

export interface EdicaoAux {
  tipo: TipoAux
  /** `null` quando é um registro novo. */
  chaveOriginal: string | number | null
  dados: RegistroAux
  meta: MetaAux
  keyPath: KeyPath
}

interface AuxState {
  caches: Partial<Record<TipoAux, RegistroAux[]>>
  filtros: Partial<Record<TipoAux, string>>
  paginas: Partial<Record<TipoAux, number>>
  edicao: EdicaoAux | null
  carregando: boolean

  carregar: (tipo: TipoAux) => Promise<void>
  recarregarTudo: () => Promise<void>
  filtrar: (tipo: TipoAux, texto: string) => void
  pagina: (tipo: TipoAux, delta: 1 | -1) => void
  irParaPagina: (tipo: TipoAux, pagina: number) => void
  ampliarPagina: (tipo: TipoAux) => void
  novo: (tipo: TipoAux) => void
  editar: (tipo: TipoAux, chave: string | number) => void
  fecharEdicao: () => void
  salvar: (dados: RegistroAux) => Promise<boolean>
  excluir: (tipo: TipoAux, chave: string | number) => Promise<void>
}

/** Página atual (1-based) de cada tabela + total filtrado (paridade com `PAGE_SIZE`). */
export const itensVisiveis = (
  lista: RegistroAux[],
  paginaNum: number,
  filtro: string,
  meta: MetaAux,
  tamanhoPagina: number = PAGE_SIZE,
): RegistroAux[] => {
  const p = Math.max(1, Math.floor(paginaNum) || 1)
  const tam = Math.max(1, Math.floor(tamanhoPagina) || PAGE_SIZE)
  const f = filtro.trim().toLowerCase()
  const filtrados = f ? lista.filter((r) => meta.texto(r).includes(f)) : lista
  const inicio = (p - 1) * tam
  return filtrados.slice(inicio, inicio + tam)
}

export const totalFiltrado = (
  lista: RegistroAux[],
  filtro: string,
  meta: MetaAux,
): number => {
  const f = filtro.trim().toLowerCase()
  return f ? lista.filter((r) => meta.texto(r).includes(f)).length : lista.length
}

async function lerStore(store: StoreName): Promise<RegistroAux[]> {
  return (await db.table(store).toArray()) as RegistroAux[]
}

export const useAuxiliares = create<AuxState>((set, get) => ({
  caches: {},
  filtros: {},
  paginas: {},
  edicao: null,
  carregando: false,

  carregar: async (tipo) => {
    const lista = await lerStore(AUX_META[tipo].store)
    set((s) => ({ caches: { ...s.caches, [tipo]: lista } }))
  },

  recarregarTudo: async () => {
    set({ carregando: true })
    const caches: Partial<Record<TipoAux, RegistroAux[]>> = {}
    await Promise.all(
      TIPOS_AUX.map(async (t) => {
        caches[t] = await lerStore(AUX_META[t].store)
      }),
    )
    set({ caches, carregando: false })
  },

  filtrar: (tipo, texto) =>
    set((s) => ({
      filtros: { ...s.filtros, [tipo]: texto },
      paginas: { ...s.paginas, [tipo]: 1 },
    })),

  pagina: (tipo, delta) =>
    set((s) => {
      const atual = s.paginas[tipo] ?? 1
      return { paginas: { ...s.paginas, [tipo]: Math.max(1, atual + delta) } }
    }),

  irParaPagina: (tipo, pagina) =>
    set((s) => ({
      paginas: { ...s.paginas, [tipo]: Math.max(1, Math.floor(pagina) || 1) },
    })),

  // Mantido por compatibilidade: "ampliar" agora avança uma página (10 itens).
  ampliarPagina: (tipo) =>
    set((s) => ({
      paginas: { ...s.paginas, [tipo]: (s.paginas[tipo] ?? 1) + 1 },
    })),

  novo: (tipo) => {
    const meta = AUX_META[tipo]
    set({
      edicao: {
        tipo,
        chaveOriginal: null,
        dados: {},
        meta,
        keyPath: meta.keyPath,
      },
    })
  },

  editar: (tipo, chave) => {
    const meta = AUX_META[tipo]
    const registro = (get().caches[tipo] ?? []).find((r) => meta.chave(r) === String(chave))
    if (!registro) {
      toast('Registro não encontrado.', 'warn')
      return
    }
    const dados: RegistroAux = { ...registro }
    if (tipo === 'cst') dados.docs = { ...(registro.docs as Record<string, boolean> | undefined) }
    set({ edicao: { tipo, chaveOriginal: chave, dados, meta, keyPath: meta.keyPath } })
  },

  fecharEdicao: () => set({ edicao: null }),

  salvar: async (dados) => {
    const ed = get().edicao
    if (!ed) return false
    const obrigatorios = ed.meta.campos
      .filter((c) => c.required)
      .map((c) => ({ nome: c.nome, label: c.label }))

    const r = await salvarRegistroAux({
      store: ed.meta.store,
      keyPath: ed.keyPath,
      dados,
      chaveOriginal: ed.chaveOriginal,
      camposObrigatorios: obrigatorios,
      normalizar: NORMALIZADORES_TIPO[ed.tipo],
    })

    if (!r.ok) {
      toast(r.motivo, 'warn')
      return false
    }
    await get().carregar(ed.tipo)
    set({ edicao: null })
    toast(r.status === 'criado' ? 'Registro criado.' : 'Registro atualizado.', 'ok')
    return true
  },

  excluir: async (tipo, chave) => {
    const meta = AUX_META[tipo]
    await excluirRegistroAux(meta.store, chave)
    await get().carregar(tipo)
    toast('Registro excluído.', 'warn')
  },
}))

/**
 * Ao sair: filtros e páginas das tabelas voltam ao início e a edição aberta é
 * descartada. Os caches ficam — recarregá-los seria trabalho sem ganho.
 */
registrarLimpeza('auxiliares', () =>
  useAuxiliares.setState({ filtros: {}, paginas: {}, edicao: null }),
)
