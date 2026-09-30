/**
 * Tela **Calculadora Tributária** — itens, alíquotas de referência e resumo.
 *
 * As reduções de cada item são **congeladas na adição** (SPEC D10): reimportar
 * a base não altera simulações em andamento.
 * Ao sair da tela, os itens são descartados (`registrarLimpeza`): toda
 * entrada parte limpa — exceto quando chega via "Adicionar à calculadora",
 * que popula o item recém-confirmado.
 */
import { create } from 'zustand'
import { REF_DEFAULT } from '@/domain/constants'
import { obterAliquotasRefDinamica } from '@/domain/services/referencia-service'
import type { Classificacao, Produto, ResultadoCalculo } from '@/domain/entities'
import { calcularTributos, round2 } from '@/domain/services/calculo'
import { clamp, fmtNcm, parseMoeda, parseQtd, uid } from '@/domain/services/format'
import {
  atualizarValoresProduto,
  buscarProduto,
  classificacaoDeItemManual,
  produtoParaCalculadora,
  reresolverClassificacao,
  salvarProduto,
} from '@/application/produtos'
import { useSessao } from './sessao'
import { confirmar, perguntar } from './dialogo'
import { registrarLimpeza } from './ui'
import { toast } from './ui'

export type OrigemItem = 'produto' | 'classificacao' | 'manual'

export interface ItemCalc {
  uid: string
  origem: OrigemItem
  produtoId: number | null
  codigo: string
  nome: string
  ncm: string
  cst: string
  cClassTrib: string
  descClass: string
  redIBS: number
  redCBS: number
  regraGeral: boolean
  quantidade: number
  valorUnitario: number
  baseLegal: string
}

/** Ajuste opcional sobre o item derivado de um produto (modal de cálculo). */
export type AjusteItem = Partial<Pick<ItemCalc, 'quantidade' | 'valorUnitario'>>

export interface ResumoCalc {
  itens: number
  base: number
  bcIBS: number
  bcCBS: number
  ibs: number
  cbs: number
  tributos: number
  total: number
  carga: number
}

interface CalcState {
  itens: ItemCalc[]
  rateIBS: number
  rateCBS: number

  adicionarProduto: (p: Produto, ajuste?: AjusteItem) => void
  adicionarClassificacao: (cl: Classificacao, ajuste?: AjusteItem) => void
  adicionarManual: (cl: Classificacao, qtd: number, valor: number) => void
  editar: (itemUid: string, campo: 'quantidade' | 'valorUnitario', texto: string) => void
  remover: (itemUid: string) => void
  limpar: () => void
  setRate: (tributo: 'IBS' | 'CBS', valor: number) => void
  /** Recarrega as alíquotas de referência do banco (reativo a mudanças de regras vigentes). */
  recarregarTaxas: () => Promise<void>
  /**
   * Re-resolve todos os itens no motor único, preservando a escolha quando
   * ainda válida. Devolve quantos itens mudaram (base alterada desde a adição).
   */
  revalidarItens: () => Promise<number>
  /** Grava/atualiza os produtos ligados aos itens (R7.9–R7.13). */
  salvarNoProdutos: () => Promise<void>
}

function deClassificacao(cl: Classificacao, origem: OrigemItem, extras: Partial<ItemCalc>): ItemCalc {
  const r = cl.resumo
  return {
    uid: uid(),
    origem,
    produtoId: null,
    codigo: '',
    nome: cl.descricao || cl.codigoFormatado || 'Item',
    ncm: cl.codigo,
    cst: cl.cst,
    cClassTrib: cl.cClassTrib,
    descClass: r.descricaoCClassTrib || cl.baseLegal || '—',
    redIBS: Number(r.percentualReducaoIBS ?? 0),
    redCBS: Number(r.percentualReducaoCBS ?? 0),
    regraGeral: cl.regraGeral,
    quantidade: 1,
    valorUnitario: 0,
    baseLegal: cl.baseLegal || '',
    ...extras,
  }
}

export const useCalculadora = create<CalcState>((set, get) => ({
  itens: [],
  rateIBS: REF_DEFAULT.IBS,
  rateCBS: REF_DEFAULT.CBS,

  adicionarProduto: (p, ajuste) => {
    const base = produtoParaCalculadora(p)
    // O modal pode trazer quantidade/valor editados pelo usuário.
    set((s) => ({ itens: [...s.itens, { ...base, ...ajuste }] }))
  },

  adicionarClassificacao: (cl, ajuste) => {
    set((s) => ({
      itens: [
        ...s.itens,
        deClassificacao(cl, 'classificacao', {
          nome: cl.descricao || cl.codigoFormatado || 'Item',
          ...ajuste,
        }),
      ],
    }))
  },

  adicionarManual: (cl, qtd, valor) => {
    set((s) => ({
      itens: [
        ...s.itens,
        deClassificacao(cl, 'manual', { nome: cl.descricao || 'Item manual', quantidade: qtd, valorUnitario: valor }),
      ],
    }))
    toast('Item adicionado à calculadora.', 'ok')
  },

  editar: (itemUid, campo, texto) => {
    const valor = campo === 'quantidade' ? parseQtd(texto) : parseMoeda(texto)
    set((s) => ({
      itens: s.itens.map((i) => (i.uid === itemUid ? { ...i, [campo]: valor } : i)),
    }))
  },

  remover: (itemUid) => set((s) => ({ itens: s.itens.filter((i) => i.uid !== itemUid) })),

  limpar: () => set({ itens: [] }),

  setRate: (tributo, valor) => {
    const v = clamp(Number(valor) || 0, 0, 100)
    set(tributo === 'IBS' ? { rateIBS: v } : { rateCBS: v })
  },

  /** Recarrega as alíquotas de referência do banco (reativo a mudanças de regras vigentes). */
  recarregarTaxas: async () => {
    const ref = await obterAliquotasRefDinamica()
    set({ rateIBS: ref.refIBS, rateCBS: ref.refCBS })
  },

  revalidarItens: async () => {
    const { itens } = get()
    if (!itens.length) return 0
    const novos: ItemCalc[] = []
    let ajustados = 0
    for (const it of itens) {
      const viva = await reresolverClassificacao(it.ncm, { cst: it.cst, cClassTrib: it.cClassTrib })
      if (!viva) {
        novos.push(it)
        continue
      }
      const redIBS = Number(viva.resumo.percentualReducaoIBS ?? 0)
      const redCBS = Number(viva.resumo.percentualReducaoCBS ?? 0)
      if (
        viva.cst !== it.cst ||
        viva.cClassTrib !== it.cClassTrib ||
        redIBS !== it.redIBS ||
        redCBS !== it.redCBS ||
        viva.regraGeral !== it.regraGeral
      ) {
        ajustados++
      }
      novos.push({
        ...it,
        cst: viva.cst,
        cClassTrib: viva.cClassTrib,
        descClass: viva.resumo.descricaoCClassTrib || viva.baseLegal || it.descClass,
        redIBS,
        redCBS,
        regraGeral: viva.regraGeral,
        baseLegal: viva.baseLegal || it.baseLegal,
      })
    }
    set({ itens: novos })
    return ajustados
  },

  salvarNoProdutos: async () => {
    const { itens } = get()
    if (!itens.length) {
      toast('Adicione itens antes de salvar.', 'warn')
      return
    }
    const ativa = useSessao.getState().ativa
    let atualizados = 0
    let criados = 0

    // 1) Itens ligados a um produto existente → atualiza só qtd/valor (R7.11).
    for (const it of itens) {
      if (!it.produtoId) continue
      const existe = await buscarProduto(it.produtoId)
      if (!existe) continue
      await atualizarValoresProduto(it.produtoId, it.quantidade, it.valorUnitario)
      atualizados++
    }

    // 2) Itens manuais → cadastrados como produtos (R7.12). A classificação
    // é re-resolvida no motor único antes de gravar: o item da calculadora
    // congela as reduções na adição, e a base pode ter mudado desde então.
    const semProd = itens.filter((i) => !i.produtoId)
    if (semProd.length) {
      const continuar = await confirmar(
        'Cadastrar itens manuais?',
        `Cadastrar os ${semProd.length} item(ns) manuais como produtos?`,
        { icone: '💾', confirmar: 'Cadastrar' },
      )
      if (!continuar) {
        toast(`${atualizados} atualizado(s)`, 'ok')
        return
      }
      let revalidados = 0
      for (const it of semProd) {
        const r = await perguntar(
          'Cadastrar item manual',
          `Informe SKU e nome para o item NCM ${fmtNcm(it.ncm)}.`,
          [
            { nome: 'sku', rotulo: 'SKU / Código interno', placeholder: 'SKU-0001', mono: true, obrigatorio: true },
            { nome: 'nome', rotulo: 'Nome do produto', valorInicial: it.nome || '', obrigatorio: true },
          ],
          { icone: '📦', confirmar: 'Cadastrar' },
        )
        if (!r) continue
        const gravado = await salvarProduto(
          {
            empresaId: ativa?.id ?? null,
            codigo: r.sku.trim(),
            nome: r.nome.trim(),
            ncm: it.ncm,
            cfop: '',
            cstIcms: '',
            pis: '',
            cofins: '',
            quantidade: it.quantidade,
            valorUnitario: it.valorUnitario,
            classificacao: classificacaoDeItemManual(it),
          },
          { forcar: true, reresolver: true },
        )
        if (gravado.ok) {
          criados++
          if (gravado.revalidada) revalidados++
        }
      }
      if (revalidados) toast(`🔄 ${revalidados} item(ns) gravado(s) pela regra vigente (era outra na simulação).`, 'warn')
    }
    toast(
      `${atualizados} atualizado(s)${criados ? ` · ${criados} criado(s)` : ''}.`,
      'ok',
    )
  },
}))

// Ao sair da tela, a simulação é descartada: toda entrada na Calculadora
// parte limpa (só as alíquotas de referência, globais, são preservadas).
registrarLimpeza('calculadora', () => useCalculadora.getState().limpar())

// Carrega alíquotas dinâmicas do banco na inicialização (reativo a mudanças de regras vigentes)
void obterAliquotasRefDinamica().then((ref) => {
  useCalculadora.setState({ rateIBS: ref.refIBS, rateCBS: ref.refCBS })
})

/* --------------------------------------------------------------- cálculo --- */

/** Base do item: `qtd × valor unitário`, arredondada para centavos. */
export const baseDoItem = (it: ItemCalc): number =>
  round2((Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0))

export function calculoDoItem(it: ItemCalc, rateIBS: number, rateCBS: number): ResultadoCalculo {
  return calcularTributos(baseDoItem(it), it.redIBS, it.redCBS, rateIBS, rateCBS)
}

export function resumoDaCalculadora(
  itens: ItemCalc[],
  rateIBS: number,
  rateCBS: number,
): ResumoCalc {
  let base = 0
  let bcIBS = 0
  let bcCBS = 0
  let ibs = 0
  let cbs = 0
  for (const it of itens) {
    const c = calculoDoItem(it, rateIBS, rateCBS)
    base = round2(base + c.base)
    bcIBS = round2(bcIBS + c.bcIBS)
    bcCBS = round2(bcCBS + c.bcCBS)
    ibs = round2(ibs + c.vIBS)
    cbs = round2(cbs + c.vCBS)
  }
  const tributos = round2(ibs + cbs)
  const total = round2(base + tributos)
  return {
    itens: itens.length,
    base,
    bcIBS,
    bcCBS,
    ibs,
    cbs,
    tributos,
    total,
    carga: base > 0 ? (tributos / base) * 100 : 0,
  }
}
