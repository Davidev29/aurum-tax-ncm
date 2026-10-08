/**
 * Store da conferência de produtos do XML — espelha `useLote`.
 *
 * Fluxo: preparar(notas) -> usuário confere/escolhe a regra por produto
 * (múltiplas regras exigem escolha, igual ao lote; regra já salva no
 * cadastro vem pré-selecionada) -> salvar() grava com upsert por SKU após
 * aceite no modal de revisão -> a apuração assistida adota as regras salvas.
 */
import { create } from 'zustand'
import type { Classificacao } from '@/domain/entities'
import { dividirLoteParaSalvamento } from '@/domain/services/salvamento-lote'
import {
  distribuirCfopUnico,
  salvarProdutosEmLote,
  type ItemLoteGravavel,
} from '@/application/produtos'
import { prepararConferenciaXml, type ResumoConferenciaXml } from '@/application/xml-conferencia'
import type { NotaXml } from '@/infrastructure/nfe/tipos'
import { useProdutos } from './produtos'
import { useSessao } from './sessao'
import { toast } from './ui'

interface ConferenciaXmlState {
  aberto: boolean
  preparando: boolean
  progresso: string | null
  resumo: ResumoConferenciaXml | null
  empresaId: number | null
  qtdNotas: number

  preparar: (notas: NotaXml[], empresaId: number | null) => Promise<void>
  escolher: (indice: number, opcao: number) => void
  fechar: () => void
  salvar: () => Promise<boolean>
}

export const useConferenciaXml = create<ConferenciaXmlState>((set, get) => ({
  aberto: false,
  preparando: false,
  progresso: null,
  resumo: null,
  empresaId: null,
  qtdNotas: 0,

  preparar: async (notas, empresaId) => {
    if (!notas.length) {
      toast('Nenhuma nota filtrada para conferir.', 'warn')
      return
    }
    set({ preparando: true, progresso: `Lendo ${notas.length} nota(s)…`, resumo: null, empresaId, qtdNotas: notas.length })
    try {
      const resumo = await prepararConferenciaXml(
        notas,
        `${notas.length} nota(s) filtrada(s)`,
        (feito, total) => set({ progresso: `Resolvendo NCMs ${Math.min(feito, total)} de ${total}…` }),
        empresaId,
      )
      if (!resumo.itens.length) {
        toast('Nenhum produto com SKU nas notas filtradas.', 'warn')
        set({ preparando: false, progresso: null })
        return
      }
      set({ resumo, aberto: true, preparando: false, progresso: null })
    } catch (e) {
      set({ preparando: false, progresso: null })
      toast(`Erro ao preparar conferência: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  },

  escolher: (indice, opcao) => {
    const r = get().resumo
    if (!r) return
    const item = r.itens[indice]
    const alvo = item?.classificacoes[opcao]
    if (!item || !alvo) return
    item.escolhida = alvo
    set({ resumo: { ...r, itens: [...r.itens] } })
  },

  fechar: () => set({ aberto: false }),

  salvar: async () => {
    const r = get().resumo
    const empresaId = get().empresaId ?? useSessao.getState().ativa?.id ?? null
    if (!r?.itens.length) {
      toast('Nenhum dado para salvar.', 'warn')
      return false
    }
    const { gravaveis } = dividirLoteParaSalvamento(r.itens)
    if (!gravaveis.length) {
      toast('Nada para salvar — todas as linhas estão sem SKU ou sem classificação.', 'warn')
      return false
    }
    const paraGravar: ItemLoteGravavel[] = gravaveis.map((it) => {
      const extra = it as typeof it & { quantidade?: number; valorUnitario?: number }
      const fluxoCfop = distribuirCfopUnico(it.cfop ?? '')
      return {
        codigo: it.codigo,
        nome: it.nome || it.codigo,
        ncm: it.ncm,
        cfop: it.cfop,
        ...fluxoCfop,
        cstIcms: it.cstIcms,
        cstIcmsEntrada: it.cstIcms,
        cstIcmsSaida: it.cstIcms,
        pis: it.pis,
        pisEntrada: it.pis,
        pisSaida: it.pis,
        cofins: it.cofins,
        cofinsEntrada: it.cofins,
        cofinsSaida: it.cofins,
        quantidade: Number(extra.quantidade) || 0,
        valorUnitario: Number(extra.valorUnitario) || 0,
        classificacao: it.escolhida as Classificacao,
      }
    })
    const ignorados = r.itens.length - paraGravar.length
    const c = await salvarProdutosEmLote(paraGravar, empresaId)
    await useProdutos.getState().carregar()
    // A apuração assistida adota na hora o que foi salvo: propaga as regras
    // do cadastro para as notas com estes SKUs (a tela recarrega sozinha).
    let apuracao = ''
    if (empresaId != null) {
      try {
        const { propagarRegrasProdutosParaNotas } = await import('@/application/notas-xml')
        const prop = await propagarRegrasProdutosParaNotas(
          empresaId,
          paraGravar.map((p) => p.codigo),
        )
        if (prop.notas > 0) apuracao = ` Apuração atualizada em ${prop.notas} nota(s).`
      } catch {
        /* notas indisponíveis — o cadastro foi salvo; reaplicar adota depois */
      }
    }
    toast(`${c.salvos + c.atualizados} produto(s) vinculado(s).${ignorados ? ` ${ignorados} ignorado(s).` : ''}${apuracao}`, 'ok')
    set({ aberto: false })
    return true
  },
}))
