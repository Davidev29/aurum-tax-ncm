/**
 * Tela **Consulta de CNAEs** (Phase 9 / 09-03).
 *
 * Espelho enxuto de `store/consulta-servicos.ts` para o domínio CNAE
 * (7 dígitos):
 * - lista cobre os 1.090 (`db.cnae` + `classificacoesConsolidadas`);
 * - `consultarCnae` orquestra o motor em duas camadas via
 *   `consultarPorCnae` (regra sempre + enriquecimento NBS condicional);
 * - `sugerirCnae` completa por prefixo de código ou trecho de descrição;
 * - `anoReferencia` (2026/2027/2033, default 2033) parametriza a
 *   precificação dos vereditos — trocar o ano re-consulta o CNAE ativo.
 *
 * Invariante A (PLAN 09): Anexo Simples e Situação SEMPRE preenchidos nas
 * linhas — a célula nunca sai vazia (`rotuloAnexoSimples` já devolve
 * `Anexo Simples —`, e a situação cai em `Depende da atividade`).
 */
import { create } from 'zustand'
import { SUGGEST_LIMITS } from '@/domain/constants'
import { codigo7De, rotuloAnexoSimples } from '@/domain/services/cnae'
import {
  ANO_REFERENCIA_PADRAO,
  ehDivisaoBens,
  normalizarAnoReferencia,
  type VereditoNbs,
} from '@/domain/services/cnae-nbs'
import {
  consultarPorCnae,
  type ConsultaCnae,
} from '@/application/consultar-por-cnae'
import { db } from '@/infrastructure/db/schema'
import { registrarLimpeza } from './ui'

/** Anos de referência com precificação explícita (princípio 7 do PLAN 09). */
export const ANOS_REFERENCIA_CNAE = [2026, 2027, 2033] as const

/** Uma linha da tabela de CNAEs (regra sempre presente — invariante A). */
export interface LinhaCnae {
  cnae7: string
  codigoFormatado: string
  descricao: string
  /** Anexos I–V do SIMPLES NACIONAL (nunca da LC 214/2025). */
  anexoSimples: string[]
  /** Sempre com o prefixo "Anexo Simples" — nunca vazio. */
  rotuloAnexo: string
  /** Sempre preenchida — nunca vazia. */
  situacao: string
  fatorR: boolean
  totalNbs: number
  /** Divisão de bens (C/G) SEM NBS aplicável → caminho bens→NCM. */
  ehBens: boolean
}

export interface SugestaoCnae {
  cnae7: string
  codigoFormatado: string
  descricao: string
}

/**
 * Filtro puro da tabela (testável sem Dexie): casa por código
 * (`XXXX-X/XX`, 7 dígitos ou prefixo como `0161`) ou por trecho da
 * descrição. Nunca lança — linha corrompida é ignorada, nunca quebra.
 */
export function filtrarCnaes(lista: LinhaCnae[], termo: string): LinhaCnae[] {
  try {
    const t = String(termo ?? '').trim().toLowerCase()
    if (!t) return lista
    const digitos = t.replace(/\D+/g, '')
    return lista.filter((l) => {
      try {
        if (!l || typeof l !== 'object') return false
        if (digitos) {
          const alvo = `${l.cnae7 ?? ''} ${(l.codigoFormatado ?? '').replace(/\D+/g, '')}`
          if (alvo.includes(digitos)) return true
        }
        const texto = `${l.codigoFormatado ?? ''} ${l.descricao ?? ''}`.toLowerCase()
        return texto.includes(t)
      } catch {
        return false
      }
    })
  } catch {
    return lista
  }
}

/**
 * Veredito ativo do painel (puro): a NBS escolhida pela UX de escolha
 * quando `ambiguo`, senão a mais provável do ranking. `null` sem consulta.
 */
export function selecionarVeredito(
  consulta: ConsultaCnae | null,
  nbsEscolhida: string | null,
): VereditoNbs | null {
  if (!consulta || !consulta.vereditos.length) return null
  const alvo = (nbsEscolhida ?? '').replace(/\D+/g, '') || consulta.maisProvavel
  return consulta.vereditos.find((v) => v.nbs === alvo) ?? null
}

async function montarLinhas(): Promise<LinhaCnae[]> {
  const [anexos, templates, links] = await Promise.all([
    db.cnae.toArray().catch(() => []),
    db.classificacoesConsolidadas.toArray().catch(() => []),
    db.cnaeNbs.toArray().catch(() => []),
  ])
  const contagem = new Map<string, number>()
  for (const l of links) {
    try {
      const cnae7 = String(l?.cnae7 ?? '')
      if (/^\d{7}$/.test(cnae7)) contagem.set(cnae7, (contagem.get(cnae7) ?? 0) + 1)
    } catch {
      /* link corrompido: ignora */
    }
  }
  const tplPorCnae = new Map(templates.map((t) => [t.cnae7, t]))
  const chaves = new Set<string>([
    ...anexos.map((a) => a.codigo7),
    ...templates.map((t) => t.cnae7),
  ])
  const linhas: LinhaCnae[] = []
  for (const cnae7 of chaves) {
    try {
      if (!/^\d{7}$/.test(cnae7)) continue
      const anexo = anexos.find((a) => a.codigo7 === cnae7) ?? null
      const tpl = tplPorCnae.get(cnae7) ?? null
      if (!anexo && !tpl) continue
      const anexoSimples = anexo?.anexos ?? tpl?.anexoSimples ?? []
      // Invariante A.2: célula nunca vazia — fallbacks honestos do domínio.
      const situacao = anexo?.situacao ?? tpl?.situacao ?? 'Depende da atividade'
      const totalNbs = contagem.get(cnae7) ?? tpl?.nbsVinculadas.length ?? 0
      linhas.push({
        cnae7,
        codigoFormatado:
          anexo?.codigoFormatado ?? tpl?.codigoFormatado ?? cnae7,
        descricao: anexo?.descricao ?? tpl?.descricao ?? '',
        anexoSimples,
        rotuloAnexo: rotuloAnexoSimples(anexoSimples),
        situacao,
        fatorR: anexo?.fatorR ?? tpl?.fatorR ?? false,
        totalNbs,
        ehBens: ehDivisaoBens(cnae7) && totalNbs === 0,
      })
    } catch {
      /* linha corrompida: ignora sem quebrar a lista */
    }
  }
  linhas.sort((a, b) => a.codigoFormatado.localeCompare(b.codigoFormatado, 'pt-BR'))
  return linhas
}

interface CnaesState {
  /** Texto de busca (código `XXXX-X/XX`/7 dígitos ou descrição). */
  busca: string
  setBusca: (v: string) => void

  /** Ano de referência da precificação (2026/2027/2033, default 2033). */
  anoReferencia: number
  setAnoReferencia: (ano: number) => Promise<void>

  lista: LinhaCnae[]
  carregandoLista: boolean
  carregarLista: (forcar?: boolean) => Promise<void>

  sugestoes: SugestaoCnae[]
  sugerirCnae: (prefixo: string) => Promise<void>

  consulta: ConsultaCnae | null
  consultando: boolean
  erroConsulta: string | null
  consultarCnae: (cnae7: string, opts?: { anoReferencia?: number }) => Promise<void>

  /** NBS fixada pela UX de escolha quando o ranking é ambíguo. */
  nbsEscolhida: string | null
  setNbsEscolhida: (nbs: string | null) => void

  limpar: () => void
}

export const useCnaes = create<CnaesState>((set, get) => ({
  busca: '',
  setBusca: (v) => set({ busca: v }),

  anoReferencia: ANO_REFERENCIA_PADRAO,
  setAnoReferencia: async (ano) => {
    const normalizado = normalizarAnoReferencia(ano)
    set({ anoReferencia: normalizado })
    const ativo = get().consulta?.regra.cnae7
    if (ativo) await get().consultarCnae(ativo, { anoReferencia: normalizado })
  },

  lista: [],
  carregandoLista: false,
  carregarLista: async (forcar) => {
    if (get().carregandoLista) return
    if (!forcar && get().lista.length) return
    set({ carregandoLista: true })
    try {
      const lista = await montarLinhas()
      set({ lista, carregandoLista: false })
    } catch {
      set({ lista: [], carregandoLista: false })
    }
  },

  sugestoes: [],
  sugerirCnae: async (prefixo) => {
    const t = String(prefixo ?? '').trim().toLowerCase()
    if (!t) {
      set({ sugestoes: [] })
      return
    }
    if (!get().lista.length) await get().carregarLista()
    const digitos = t.replace(/\D+/g, '')
    const achados: SugestaoCnae[] = []
    for (const l of get().lista) {
      if (achados.length >= SUGGEST_LIMITS.buscaNomenclatura) break
      const casaCodigo = digitos
        ? l.cnae7.startsWith(digitos) || l.codigoFormatado.toLowerCase().includes(t)
        : l.codigoFormatado.toLowerCase().includes(t)
      const casaTexto = l.descricao.toLowerCase().includes(t)
      if (casaCodigo || casaTexto) {
        achados.push({
          cnae7: l.cnae7,
          codigoFormatado: l.codigoFormatado,
          descricao: l.descricao,
        })
      }
    }
    set({ sugestoes: achados })
  },

  consulta: null,
  consultando: false,
  erroConsulta: null,
  consultarCnae: async (cnaeBruto, opts) => {
    const ano = normalizarAnoReferencia(opts?.anoReferencia ?? get().anoReferencia)
    const cnae7 = codigo7De(cnaeBruto)
    set({ consultando: true, erroConsulta: null, anoReferencia: ano })
    try {
      const consulta = await consultarPorCnae(cnae7 || cnaeBruto, { anoReferencia: ano })
      set({ consulta, nbsEscolhida: null, consultando: false })
      // GRAFO-08: CNAE consultado alimenta o overlay (carteira).
      try {
        if (cnae7 && /^\d{7}$/.test(cnae7)) {
          void import('@/application/grafo-overlay').then((m) => {
            try {
              m.registrarCnaeUso(cnae7, null)
            } catch {
              /* best-effort */
            }
          }).catch(() => undefined)
        }
      } catch {
        /* overlay nunca quebra */
      }
    } catch (e) {
      set({
        consulta: null,
        consultando: false,
        erroConsulta: e instanceof Error ? e.message : String(e),
      })
    }
  },

  nbsEscolhida: null,
  setNbsEscolhida: (nbs) => {
    const dig = nbs ? nbs.replace(/\D+/g, '').slice(0, 9) : null
    set({ nbsEscolhida: dig })
    // GRAFO-08: escolha de NBS no painel CNAE alimenta o overlay.
    if (dig && dig.length === 9) {
      try {
        const cnae = get().consulta?.regra.cnae7 ?? ''
        void import('@/application/grafo-overlay').then((m) => {
          try {
            m.registrarUsoLocal({ tipo: 'NCM-ESCOLHIDO', termo: cnae ? `CNAE ${cnae}` : '', codigo: dig, peso: 0.1 })
          } catch {
            /* best-effort */
          }
        }).catch(() => undefined)
      } catch {
        /* overlay nunca quebra */
      }
    }
  },

  limpar: () =>
    set({
      busca: '',
      sugestoes: [],
      consulta: null,
      consultando: false,
      erroConsulta: null,
      nbsEscolhida: null,
    }),
}))

registrarLimpeza('cnaes', () => useCnaes.getState().limpar())
