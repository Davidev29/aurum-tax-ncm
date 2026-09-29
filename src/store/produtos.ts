/**
 * Estado da tela **Produtos**: cache recortado pela empresa ativa (D12),
 * filtro de texto, paginação e gravação com upsert por SKU.
 */
import { create } from 'zustand'
import { PAGE_SIZE } from '@/domain/constants'
import type { Classificacao, Produto } from '@/domain/entities'
import {
  entradaProdutoDeFormulario,
  excluirProduto,
  listarProdutos,
  produtoLinha,
  salvarProduto,
  type FormularioProduto,
  type ProdutoLinha,
} from '@/application/produtos'
import { useSessao } from './sessao'
import { registrarLimpeza, toast } from './ui'

interface ProdutosState {
  cache: ProdutoLinha[]
  filtro: string
  pagina: number
  editandoId: number | null
  carregando: boolean

  carregar: () => Promise<void>
  setFiltro: (t: string) => void
  ampliarPagina: () => void
  iniciarEdicao: (id: number | null) => void
  salvar: (
    dados: FormularioProduto,
    classificacao: Classificacao,
    forcar?: boolean,
  ) => Promise<boolean>
  excluir: (id: number) => Promise<void>
}

function mapaEmpresas(): Map<number, string> {
  const { empresas } = useSessao.getState()
  return new Map(empresas.map((e) => [e.id ?? -1, e.razaoSocial]))
}

export const useProdutos = create<ProdutosState>((set, get) => ({
  cache: [],
  filtro: '',
  pagina: PAGE_SIZE,
  editandoId: null,
  carregando: false,

  carregar: async () => {
    set({ carregando: true })
    const ativa = useSessao.getState().ativa
    const lista = await listarProdutos(ativa?.id ?? null)
    const mapa = mapaEmpresas()
    const linhas = lista.map((p) => produtoLinha(p, mapa))
    set({ cache: linhas, carregando: false, pagina: PAGE_SIZE })
  },

  setFiltro: (t) => set({ filtro: t, pagina: PAGE_SIZE }),
  ampliarPagina: () => set((s) => ({ pagina: s.pagina + PAGE_SIZE })),

  iniciarEdicao: (id) => set({ editandoId: id }),

  salvar: async (dados, classificacao, forcar = false) => {
    const ativa = useSessao.getState().ativa
    const editandoId = get().editandoId
    const entrada = entradaProdutoDeFormulario(dados, classificacao, ativa?.id ?? null)

    const r = await salvarProduto(entrada, { editarId: editandoId, forcar })
    if (!r.ok) {
      toast(r.motivo, 'warn')
      return false
    }
    await get().carregar()
    set({ editandoId: null })
    toast(r.status === 'criado' ? 'Produto salvo.' : 'Produto atualizado.', 'ok')
    return true
  },

  excluir: async (id) => {
    await excluirProduto(id)
    await get().carregar()
    toast('Produto excluído.', 'warn')
  },
}))

/** Ao sair da tela, filtro e paginação voltam ao início (o cache fica). */
registrarLimpeza('produtos', () =>
  useProdutos.setState({ filtro: '', pagina: PAGE_SIZE }),
)

/** Itens atualmente visíveis (filtro de texto + paginação). */
export function produtosVisiveis(p: {
  cache: ProdutoLinha[]
  filtro: string
  pagina: number
}): ProdutoLinha[] {
  const f = p.filtro.trim().toLowerCase()
  const filtrados = f
    ? p.cache.filter((x) =>
        // Busca também nos tributos do regime anterior: quem lembra do CST
        // ICMS/CSOSN ou do CFOP acha o produto sem decorar o SKU.
        `${x.codigo} ${x.nome} ${x.ncm} ${x.cstReforma} ${x.cClassTrib} ${x.cfop ?? ''} ${x.cstIcms ?? ''} ${x.pis ?? ''} ${x.cofins ?? ''}`
          .toLowerCase()
          .includes(f),
      )
    : p.cache
  return filtrados.slice(0, p.pagina)
}

export type { Produto, ProdutoLinha }
