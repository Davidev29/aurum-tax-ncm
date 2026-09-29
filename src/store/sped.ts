/**
 * Tela **SPED Fiscal** — leitura, detecção, análise e gravação.
 *
 * Regras preservadas da v1 (SPEC §4):
 * - **somente saídas** são analisadas (D01);
 * - modo **resumo** quando só há C190 (D02);
 * - recusa explícita de Reinf/e-Social/ECD/ECF (D05);
 * - alíquotas de referência **próprias** desta tela — corrigem o `[BUG] L973`,
 *   em que a calculadora alterava silenciosamente os totais do SPED/relatórios.
 */
import { create } from 'zustand'
import { REF_DEFAULT } from '@/domain/constants'
import { clamp } from '@/domain/services/format'
import { lerArquivoTexto, detectarTipo } from '@/infrastructure/sped/leitura'
import { extrairEstabelecimentoSped, parseContribuicoes, parseIcmsIpi } from '@/infrastructure/sped/parse'
import {
  analisarItens,
  analisarResumo,
} from '@/infrastructure/sped/analisar'
import type {
  ResultadoItem,
  ResultadoResumo,
  ResultadoSped,
  SpedModo,
  SpedStats,
  SpedTipo,
} from '@/infrastructure/sped/tipos'
import { salvarProdutosEmLote, type ItemLoteGravavel } from '@/application/produtos'
import { useProdutos } from './produtos'
import { useSessao } from './sessao'
import { registrarLimpeza, toast } from './ui'
import { confirmar } from './dialogo'

export type PainelSped =
  | { tipo: 'vazio' }
  | { tipo: 'incompativel'; detalhe: SpedTipo }
  | { tipo: 'semSaida'; apenasEntradas: boolean; stats: SpedStats; nome: string; contrib: boolean }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'ok' }

interface SpedState {
  processando: boolean
  etapa: string | null
  detalhe: SpedTipo | null
  modo: SpedModo | null
  stats: SpedStats | null
  dados: ResultadoSped
  painel: PainelSped
  refIBS: number
  refCBS: number
  detalheAberto: ResultadoItem | null

  processar: (file: File) => Promise<void>
  limpar: () => void
  setRef: (tributo: 'IBS' | 'CBS', valor: number) => void
  abrirDetalhe: (r: ResultadoItem) => void
  fecharDetalhe: () => void
  salvarProduto: (r: ResultadoItem) => Promise<boolean>
  salvarTodos: () => Promise<number>
}

export const useSped = create<SpedState>((set, get) => ({
  processando: false,
  etapa: null,
  detalhe: null,
  modo: null,
  stats: null,
  dados: [],
  painel: { tipo: 'vazio' },
  refIBS: REF_DEFAULT.IBS,
  refCBS: REF_DEFAULT.CBS,
  detalheAberto: null,

  processar: async (file) => {
    set({ processando: true, etapa: 'Lendo arquivo SPED…', painel: { tipo: 'vazio' } })
    try {
      const buf = await file.arrayBuffer()
      const texto = lerArquivoTexto(buf)
      const det = detectarTipo(texto)

      if (!det.compativel) {
        set({ processando: false, etapa: null, painel: { tipo: 'incompativel', detalhe: det } })
        return
      }

      const contrib = det.tipo === 'contribuicoes'
      set({ etapa: contrib ? 'Processando EFD Contribuições (PIS/COFINS)…' : 'Processando EFD ICMS/IPI…' })

      const parsed = contrib ? parseContribuicoes(texto) : parseIcmsIpi(texto)
      // Enriquecimento best-effort: o cabeçalho 0000/0005 pode trazer IE/IM
      // que o cadastro ainda não tem — completa sem quebrar a análise.
      void (async () => {
        try {
          const ativa = useSessao.getState().ativa
          if (!ativa?.id) return
          const est = extrairEstabelecimentoSped(texto)
          if (!est) return
          const { norm } = await import('@/domain/services/format')
          if (norm(est.cnpj) !== norm(ativa.cnpj)) return
          const { completarEmpresa } = await import('@/application/empresas')
          // Regime da própria empresa: CSOSN nas saídas denuncia o Simples.
          const { regimePorCsts } = await import('@/infrastructure/nfe/regime')
          const regimeSped = regimePorCsts(parsed.itens.map((i) => i.cstIcms))
          await completarEmpresa(ativa.id, {
            razaoSocial: est.nome || undefined,
            fantasia: est.fantasia || undefined,
            ie: est.ie || undefined,
            im: est.im || undefined,
            uf: est.uf || undefined,
            regimeTributario: regimeSped === 'desconhecido' ? undefined : regimeSped,
          })
        } catch {
          /* enriquecimento nunca quebra a análise */
        }
      })()
      const ref = { refIBS: get().refIBS, refCBS: get().refCBS }
      const stats = parsed.stats

      if (parsed.itens.length > 0) {
        set({ etapa: `Analisando ${parsed.itens.length} itens de saída…` })
        const resultados = await analisarItens(parsed.itens, ref, (feito, total) =>
          set({ etapa: `Analisando ${Math.min(feito, total)} de ${total} itens…` }),
        )
        const semNcm = resultados.filter((r) => !r.ncm || r.ncm.length !== 8).length
        let textoToast = `${resultados.length} itens de saída analisados`
        if (stats.itensEntrada > 0) textoToast += ` · ${stats.itensEntrada} itens de entrada ignorados`
        if (semNcm > 0) textoToast += ` · ${semNcm} sem NCM válido`

        set({
          processando: false,
          etapa: null,
          detalhe: det,
          modo: 'itens',
          stats,
          dados: resultados,
          painel: { tipo: 'ok' },
        })
        toast(textoToast, semNcm ? 'warn' : 'ok')
        return
      }

      if (parsed.resumoC190.length > 0) {
        set({ etapa: `Analisando ${parsed.resumoC190.length} registros C190 de saída…` })
        const resultados = analisarResumo(parsed.resumoC190, ref)
        set({
          processando: false,
          etapa: null,
          detalhe: det,
          modo: 'resumo',
          stats,
          dados: resultados,
          painel: { tipo: 'ok' },
        })
        toast(
          `Modo resumo: ${resultados.length} grupos CST/CFOP · ${stats.resumosSaida} C190 de saída`,
          'warn',
        )
        return
      }

      const temEntradas = stats.notasEntrada > 0 || stats.itensEntrada > 0
      set({
        processando: false,
        etapa: null,
        detalhe: det,
        modo: null,
        stats,
        dados: [],
        painel: {
          tipo: 'semSaida',
          apenasEntradas: temEntradas && stats.notasSaida === 0,
          stats,
          nome: det.nome,
          contrib,
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(e)
      set({ processando: false, etapa: null, painel: { tipo: 'erro', mensagem: msg } })
    }
  },

  limpar: () =>
    set({
      processando: false,
      etapa: null,
      detalhe: null,
      modo: null,
      stats: null,
      dados: [],
      painel: { tipo: 'vazio' },
      detalheAberto: null,
    }),

  setRef: (tributo, valor) => {
    const v = clamp(Number(valor) || 0, 0, 100)
    set(tributo === 'IBS' ? { refIBS: v } : { refCBS: v })
  },

  abrirDetalhe: (r) => set({ detalheAberto: r }),
  fecharDetalhe: () => set({ detalheAberto: null }),

  salvarProduto: async (r) => {
    if (!r) {
      toast('Nenhum produto selecionado.', 'warn')
      return false
    }
    const ativa = useSessao.getState().ativa
    if (!ativa) {
      toast('Selecione uma empresa ativa para salvar o produto.', 'warn')
      return false
    }
    const c = r.classificacao
    const r$ = c.resumo
    try {
      const qtd = Number(r.qtd) || 0
      const valorUnit = qtd > 0 ? (Number(r.vlItem) || 0) / qtd : 0
      const gravavel: ItemLoteGravavel = {
        codigo: r.codItem,
        nome: r.descricaoProduto || r.codItem,
        ncm: r.ncm,
        cfop: r.cfop,
        cstIcms: r.cstIcms,
        pis: r.cstPis || '',
        cofins: r.cstCofins || '',
        quantidade: qtd,
        valorUnitario: valorUnit,
        classificacao: {
          ...c,
          cst: c.cst || '000',
          cClassTrib: c.cClassTrib || '000001',
          resumo: {
            ...r$,
            percentualReducaoIBS: r$.percentualReducaoIBS ?? r.redIBS ?? 0,
            percentualReducaoCBS: r$.percentualReducaoCBS ?? r.redCBS ?? 0,
            anexo: r$.anexo ?? null,
          },
        },
      }
      const cont = await salvarProdutosEmLote([gravavel], ativa.id ?? null)
      await useProdutos.getState().carregar()
      set({ detalheAberto: null })
      toast(`Produto "${r.codItem}" salvo.`, cont.salvos || cont.atualizados ? 'ok' : 'warn')
      return true
    } catch (e) {
      toast(`Erro ao salvar o produto: ${e instanceof Error ? e.message : String(e)}`, 'err')
      return false
    }
  },

  salvarTodos: async () => {
    const { dados, modo } = get()
    if (!dados.length) {
      toast('Nenhum dado para salvar.', 'warn')
      return 0
    }
    if (modo === 'resumo') {
      toast('Análise em modo resumo não permite salvar produtos (sem NCM).', 'warn')
      return 0
    }
    const ativa = useSessao.getState().ativa
    if (!ativa) {
      toast('Selecione uma empresa ativa para salvar os produtos.', 'warn')
      return 0
    }
    const itens = dados as ResultadoItem[]
    const ok = await confirmar(
      'Salvar produtos?',
      `Salvar ${itens.length} produtos de saída na empresa "${ativa.razaoSocial}"?`,
      { icone: '💾', confirmar: 'Salvar' },
    )
    if (!ok) return 0
    try {
      const gravaveis: ItemLoteGravavel[] = itens.map((r) => {
        const qtd = Number(r.qtd) || 0
        return {
          codigo: r.codItem,
          nome: r.descricaoProduto || r.codItem,
          ncm: r.ncm,
          cfop: r.cfop,
          cstIcms: r.cstIcms,
          pis: r.cstPis || '',
          cofins: r.cstCofins || '',
          quantidade: qtd,
          valorUnitario: qtd > 0 ? (Number(r.vlItem) || 0) / qtd : 0,
          classificacao: {
            ...r.classificacao,
            cst: r.classificacao.cst || '000',
            cClassTrib: r.classificacao.cClassTrib || '000001',
            resumo: {
              ...r.classificacao.resumo,
              percentualReducaoIBS: r.classificacao.resumo.percentualReducaoIBS ?? r.redIBS,
              percentualReducaoCBS: r.classificacao.resumo.percentualReducaoCBS ?? r.redCBS,
            },
          },
        }
      })
      const c = await salvarProdutosEmLote(gravaveis, ativa.id ?? null)

      await useProdutos.getState().carregar()
      const total = c.salvos + c.atualizados
      toast(`${total} produtos salvos na empresa "${ativa.razaoSocial}"`, 'ok')
      return total
    } catch (e) {
      toast(`Erro ao salvar produtos: ${e instanceof Error ? e.message : String(e)}`, 'err')
      return 0
    }
  },
}))

/**
 * Ao sair da tela, só o transitório é descartado (detalhe aberto, etapa).
 * A análise do SPED e as alíquotas de referência próprias são resultado de um
 * import caro/digiteado de propósito e permanecem até a próxima importação.
 */
registrarLimpeza('sped', () =>
  useSped.setState({ detalheAberto: null, etapa: null, processando: false }),
)

export type { ResultadoItem, ResultadoResumo, SpedStats, SpedTipo }
