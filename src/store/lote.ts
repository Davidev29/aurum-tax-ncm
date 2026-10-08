/**
 * Tela **Classificação em lote** — leitura da planilha, troca manual da
 * classificação por linha e gravação em massa (upsert por SKU).
 */
import { create } from 'zustand'
import type { Classificacao } from '@/domain/entities'
import { dividirLoteParaSalvamento } from '@/domain/services/salvamento-lote'
import type { ItemLote, ResumoLote } from '@/infrastructure/parsers/lote'
import { salvarProdutosEmLote, type ItemLoteGravavel } from '@/application/produtos'
import { useProdutos } from './produtos'
import { useSessao } from './sessao'
import { registrarLimpeza, toast } from './ui'

interface LoteState {
  resumo: ResumoLote | null
  processando: boolean
  progresso: number
  erro: string | null

  processar: (file: File) => Promise<void>
  escolher: (indice: number, opcao: number) => void
  salvarTodos: () => Promise<boolean>
  limpar: () => void
}

export const useLote = create<LoteState>((set, get) => ({
  resumo: null,
  processando: false,
  progresso: 0,
  erro: null,

  processar: async (file) => {
    set({ processando: true, erro: null, progresso: 0, resumo: null })
    try {
      // Import dinâmico: o parser (e o xlsx, ~330 kB) só entram quando um
      // arquivo de lote é de fato enviado.
      const { processarArquivoLote } = await import('@/infrastructure/parsers/lote')
      const r = await processarArquivoLote(file, (feito, total) =>
        set({ progresso: total ? Math.round((feito / total) * 100) : 0 }),
      )
      set({ resumo: r, processando: false, progresso: 100 })
      const invalidos = r.itens.filter((i) => i.ncm.length !== 8).length
      toast(
        `${r.comClassificacao} classificadas · ${r.itens.length} linhas`,
        invalidos ? 'warn' : 'ok',
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ processando: false, erro: msg })
      toast(msg, 'err')
    }
  },

  escolher: (indice, opcao) => {
    const r = get().resumo
    if (!r) return
    const item = r.itens[indice]
    const alvo = item?.classificacoes[opcao]
    if (!item || !alvo) return
    item.escolhida = alvo
    set({ resumo: { ...r } })
    // GRAFO-08: escolha em <select> alimenta o overlay (só reordena).
    try {
      void import('@/application/grafo-overlay').then((m) => {
        try {
          m.registrarEscolhaUso(String(item.nome || item.ncm || ''), String(item.ncm || ''))
        } catch {
          /* best-effort */
        }
      }).catch(() => undefined)
    } catch {
      /* overlay nunca quebra o lote */
    }
  },

  salvarTodos: async () => {
    const r = get().resumo
    if (!r?.itens.length) {
      toast('Nenhum dado para salvar.', 'warn')
      return false
    }
    // Mesma divisão exibida no modal de revisão (sem surpresa no salvamento).
    const { gravaveis } = dividirLoteParaSalvamento(r.itens)
    if (!gravaveis.length) {
      toast('Nada para salvar — todas as linhas estão sem SKU ou sem classificação.', 'warn')
      return false
    }
    const ativa = useSessao.getState().ativa
    const paraGravar: ItemLoteGravavel[] = gravaveis.map((it) => ({
      codigo: it.codigo,
      nome: it.nome || it.codigo,
      ncm: it.ncm,
      cfop: it.cfop,
      cstIcms: it.cstIcms,
      pis: it.pis,
      cofins: it.cofins,
      classificacao: it.escolhida as Classificacao,
    }))

    const ignorados = r.itens.length - paraGravar.length
    const c = await salvarProdutosEmLote(paraGravar, ativa?.id ?? null)
    await useProdutos.getState().carregar()
    // Mesma garantia da conferência do XML: a apuração assistida adota na
    // hora as regras salvas nas notas com estes SKUs.
    let apuracao = ''
    if (ativa?.id != null) {
      try {
        const { propagarRegrasProdutosParaNotas } = await import('@/application/notas-xml')
        const prop = await propagarRegrasProdutosParaNotas(
          ativa.id,
          paraGravar.map((p) => p.codigo),
        )
        if (prop.notas > 0) apuracao = ` Apuração atualizada em ${prop.notas} nota(s).`
      } catch {
        /* notas indisponíveis — o cadastro foi salvo; reaplicar adota depois */
      }
    }
    toast(`${c.salvos + c.atualizados} produtos salvos.${ignorados ? ` ${ignorados} ignorados.` : ''}${apuracao}`, 'ok')
    return true
  },

  limpar: () => set({ resumo: null, erro: null, progresso: 0 }),
}))

/** Ao sair, a planilha processada não fica congelada na próxima visita. */
registrarLimpeza('lote', () => useLote.getState().limpar())

export type { ItemLote }
export { dividirLoteParaSalvamento, origemLinhaLote } from '@/domain/services/salvamento-lote'
export type { IgnoradoLote } from '@/domain/services/salvamento-lote'
