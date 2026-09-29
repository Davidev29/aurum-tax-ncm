/**
 * Tela **Classificação individual**: formulário do produto + escolha da
 * classificação tributária (fluxo 0/1/N da SPEC §2.3).
 *
 * Correção do `[BUG] L1061`: a escolha do rádio **não** dispara nova consulta,
 * de modo que a seleção nunca é perdida e o botão Salvar continua habilitado.
 */
import { create } from 'zustand'
import { SUGGEST_LIMITS } from '@/domain/constants'
import { MASK, fmtNum } from '@/domain/services/format'
import type { Classificacao, NomenclaturaNcm, Produto } from '@/domain/entities'
import { validarFormularioProduto } from '@/application/produtos'
import {
  resolverClassificacoes,
  sugerirNomenclatura,
} from '@/infrastructure/base/classificacao-repo'
import { toast, registrarLimpeza } from './ui'
import { useProdutos } from './produtos'

export interface FormProduto {
  codigo: string
  nome: string
  ncm: string
  cfop: string
  cstIcms: string
  pis: string
  cofins: string
  qtd: string
  valor: string
}

const FORM_VAZIO: FormProduto = {
  codigo: '',
  nome: '',
  ncm: '',
  cfop: '',
  cstIcms: '',
  pis: '',
  cofins: '',
  qtd: '',
  valor: '',
}

interface ClassificarState {
  form: FormProduto
  nomenclatura: NomenclaturaNcm | null
  opcoes: Classificacao[]
  escolhida: Classificacao | null
  regraGeral: boolean
  avisoInvalido: boolean
  carregando: boolean
  sugestoes: NomenclaturaNcm[]
  editandoId: number | null

  setCampo: (campo: keyof FormProduto, valor: string) => void
  carregarClassificacoes: (ncm?: string) => Promise<void>
  escolher: (indice: number) => void
  buscarSugestoes: (texto: string) => Promise<void>
  iniciarEdicao: (p: Produto) => Promise<void>
  salvar: (forcar?: boolean) => Promise<boolean>
  limpar: () => void
}

export const useClassificar = create<ClassificarState>((set, get) => ({
  form: { ...FORM_VAZIO },
  nomenclatura: null,
  opcoes: [],
  escolhida: null,
  regraGeral: false,
  avisoInvalido: false,
  carregando: false,
  sugestoes: [],
  editandoId: null,

  setCampo: (campo, valor) => set((s) => ({ form: { ...s.form, [campo]: valor } })),

  carregarClassificacoes: async (ncm) => {
    const codigo = (ncm ?? get().form.ncm).replace(/\D+/g, '')
    if (codigo.length !== 8) {
      set({
        nomenclatura: null,
        opcoes: [],
        escolhida: null,
        regraGeral: false,
        avisoInvalido: true,
      })
      return
    }
    set({ carregando: true })
    const r = await resolverClassificacoes(codigo)
    const lista = r.lista
    // Pré-seleção: automática apenas quando há exatamente uma opção (R2.3).
    set({
      nomenclatura: r.nomenclatura,
      opcoes: lista,
      escolhida: lista.length === 1 ? lista[0] : null,
      regraGeral: r.regraGeral,
      avisoInvalido: false,
      carregando: false,
    })
  },

  escolher: (indice) => {
    const alvo = get().opcoes[indice]
    if (!alvo) return
    set({ escolhida: alvo })
  },

  buscarSugestoes: async (texto) => {
    const t = texto.replace(/\D+/g, '')
    if (t.length < 2) {
      set({ sugestoes: [] })
      return
    }
    set({ sugestoes: await sugerirNomenclatura(t, SUGGEST_LIMITS.formulario) })
  },

  iniciarEdicao: async (p) => {
    set({
      form: {
        ...FORM_VAZIO,
        codigo: p.codigo,
        nome: p.nome,
        ncm: p.ncm,
        cfop: p.cfop ?? '',
        cstIcms: p.cstIcms ?? '',
        pis: p.pis ?? '',
        cofins: p.cofins ?? '',
        // Pré-preenche já no formato das máscaras dos campos (correção do
        // [BUG] L1112): sem isso `parseQtd('1.5')` viraria 15 e
        // `parseMoeda('49.9')` viraria 4,99.
        qtd: p.quantidade ? fmtNum(p.quantidade) : '',
        valor: p.valorUnitario
          ? MASK.moeda(String(Math.round(p.valorUnitario * 100)))
          : '',
      },
      editandoId: p.id ?? null,
    })
    useProdutos.getState().iniciarEdicao(p.id ?? null)
    await get().carregarClassificacoes(p.ncm)

    // Restaura a classificação já gravada (correção do [BUG] L1112).
    const { opcoes } = get()
    const idx = opcoes.findIndex(
      (n) => n.cClassTrib === p.cClassTrib && n.cst === p.cstReforma,
    )
    if (idx >= 0) {
      set({ escolhida: opcoes[idx], regraGeral: opcoes[idx].regraGeral })
    } else if (p.regraGeral) {
      set({ regraGeral: true })
    }
  },

  salvar: async (forcar = false) => {
    const { form, escolhida } = get()
    // Ordem de validação da v1 (index.html L1083): SKU → nome → NCM → escolha.
    const erro = validarFormularioProduto(form)
    if (erro) {
      toast(erro, 'warn')
      return false
    }
    if (!escolhida) {
      toast('Escolha uma classificação na lateral.', 'warn')
      return false
    }
    const ok = await useProdutos.getState().salvar(form, escolhida, forcar)
    if (ok) set({ editandoId: null })
    return ok
  },

  limpar: () => {
    useProdutos.getState().iniciarEdicao(null)
    set({
      form: { ...FORM_VAZIO },
      nomenclatura: null,
      opcoes: [],
      escolhida: null,
      regraGeral: false,
      avisoInvalido: false,
      sugestoes: [],
      editandoId: null,
    })
  },
}))

/** Ao sair, o formulário volta a ficar vazio (nada de rascunho congelado). */
registrarLimpeza('classificar', () => useClassificar.getState().limpar())
