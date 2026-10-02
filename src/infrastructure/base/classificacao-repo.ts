import { REGRA_GERAL } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm, VinculoNcm } from '@/domain/entities'
import {
  montarClassificacao,
  montarRegraGeral,
  isNcmExtinto,
  type ContextoClassificacao,
} from '@/domain/services/classificacao'
import { revogacaoDe, type Revogacao } from '@/domain/services/revogacao'
import {
  comporCaminho,
  normalizarBusca,
  pontuarCandidato,
  pontuarCandidatoParcial,
  tokensRelevantes,
} from '@/domain/services/busca-texto'
import { expandirSinonimoFiscal } from '@/domain/services/vocabulario'
import { norm } from '@/domain/services/format'
import { db } from '../db/schema'
import { obterRevogacoesCff } from '../cff/cff-sync'
import { buscarReclassificacaoManual, classificacaoManual } from './reclassificacao-repo'

/**
 * Repositório de classificação — todas as leituras do núcleo passam por aqui
 * (SPEC R1.6: busca por NCM exclusivamente pelo índice `codigo`).
 */

/** Resolve o join 3NF de um vínculo (CST + cClassTrib + referência). */
async function contextoDe(vinculo: VinculoNcm): Promise<ContextoClassificacao> {
  const [cstDetalhes, cstClassTribDetalhes, referencia] = await Promise.all([
    db.cst.get(vinculo.cst),
    db.cstClassTrib.get(`${vinculo.cst}|${vinculo.cClassTrib}`),
    db.referencia.get(`${vinculo.cst}|${vinculo.cClassTrib}`),
  ])
  return { cstDetalhes: cstDetalhes ?? null, cstClassTribDetalhes: cstClassTribDetalhes ?? null, referencia: referencia ?? null }
}

/** Resolve o join 3NF da regra geral (SPEC R2.4). */
export async function contextoRegraGeral(): Promise<ContextoClassificacao> {
  let cstDetalhes = null
  let cstClassTribDetalhes = null
  try {
    cstDetalhes = (await db.cst.get(REGRA_GERAL.cst)) ?? null
  } catch {
    cstDetalhes = null
  }
  try {
    cstClassTribDetalhes = (await db.cstClassTrib.get(`${REGRA_GERAL.cst}|${REGRA_GERAL.cClassTrib}`)) ?? null
  } catch {
    cstClassTribDetalhes = null
  }
  return { cstDetalhes, cstClassTribDetalhes, referencia: null }
}

/** R2.1 — `[]` imediatamente quando o NCM não tem 8 dígitos.
 *
 * @deprecated Motor único: prefira `resolverClassificacoes` (aplica extinto,
 * revogado e manual). Mantida como envoltória fina para não quebrar chamadas
 * externas — delega ao resolvedor e devolve só a lista.
 */
export async function buscarClassificacoesDoNcm(codigo: unknown): Promise<Classificacao[]> {
  const r = await resolverClassificacoes(codigo)
  return r.lista
}

/** R2.2 — `null` para código vazio; `undefined` viria do Dexie, então normalizamos. */
export async function buscarNomenclatura(codigo: unknown): Promise<NomenclaturaNcm | null> {
  const c = norm(codigo)
  if (!c) return null
  return (await db.ncmNomenclatura.get(c)) ?? null
}

/** R2.3 — prefixo com no mínimo 2 dígitos; limite por SPEC (30 na busca). */
export async function sugerirNomenclatura(
  prefixo: unknown,
  limite = 30,
): Promise<NomenclaturaNcm[]> {
  const t = norm(prefixo)
  if (t.length < 2) return []
  // Busca folga extra para ordenar vigentes antes dos extintos ("negados")
  // sem ocultar os extintos (o usuário pode estar com o NCM antigo na nota).
  const folga = Math.min(limite + 20, 100)
  const achados = await db.ncmNomenclatura
    .where('codigo')
    .between(t, `${t}\uffff`, true, true)
    .limit(folga)
    .toArray()
  achados.sort((a, b) => Number(Boolean(a.dataFim)) - Number(Boolean(b.dataFim)))
  return achados.slice(0, limite)
}

/* ------------------------------------------------- busca por texto (nome) -- */

/** Resultado da busca textual: nomenclatura + contexto hierárquico e fiscal. */
export interface ResultadoBuscaTexto extends NomenclaturaNcm {
  /** Descrições dos ancestrais (capítulo → … → subposição). */
  caminho: string[]
  /** Caminho + descrição própria, para exibição (`A › B › C`). */
  caminhoTexto: string
  /** Quantos vínculos da Reforma existem para este NCM. */
  totalClassificacoes: number
  /** Pontuação interna (maior = melhor match). */
  score: number
}

/** Cache em memória da nomenclatura para a busca textual ser fluida. */
interface EntradaIndiceTexto {
  item: NomenclaturaNcm
  caminho: string[]
  normPropria: string
  normCaminho: string
}
let _indiceBuscaTexto: EntradaIndiceTexto[] | null = null
let _cacheBuscaTextoTotal = -1

/** Invalida o cache da busca textual (chamar após importar/apagar a base). */
export function invalidarCacheBuscaTexto(): void {
  _indiceBuscaTexto = null
  _cacheBuscaTextoTotal = -1
}

/** Carrega (uma vez) e pré-normaliza o índice de busca textual. */
async function indiceBuscaTexto(): Promise<EntradaIndiceTexto[]> {
  const total = await db.ncmNomenclatura.count()
  if (_indiceBuscaTexto === null || _cacheBuscaTextoTotal !== total) {
    const todas = await db.ncmNomenclatura.toArray()
    const porCodigo = new Map(todas.map((n) => [n.codigo, n.descricao]))
    const obter = (p: string) => porCodigo.get(p)
    _indiceBuscaTexto = todas
      .filter((n) => n.codigo.length === 8)
      .map((item) => {
        const caminho = comporCaminho(item.codigo, obter)
        return {
          item,
          caminho,
          normPropria: normalizarBusca(item.descricao),
          normCaminho: normalizarBusca([...caminho, item.descricao].join(' ')),
        }
      })
    _cacheBuscaTextoTotal = total
  }
  return _indiceBuscaTexto ?? []
}

/**
 * Busca NCMs pelo **nome do produto** (ex.: "queijo mozarela").
 *
 * RAG em 2 fases (proativo, sem inventar NCM):
 * - Fase 1 (precisão): AND estrito (`pontuarCandidato`) sobre tokens RELEVANTES
 *   (sem stopwords: "ração PARA cães" vira ["racao","caes"]) + variação com
 *   sinônimos ("boi"→"bovin", "celular"→"telefone");
 * - Fase 2 (cobertura): OR tolerante (`pontuarCandidatoParcial`: radical,
 *   prefixo, fuzzy) completa até o limite quando a fase 1 retorna pouco —
 *   é isto que evita a lista vazia ("IA nunca sabe o que é nada").
 *
 * - Somente NCMs de 8 dígitos (os únicos classificáveis);
 * - match sobre o caminho hierárquico completo (pais + item), insensível a
 *   acento/caixa — `0406.10.10` ("Mozarela") é achado por "queijo";
 * - vigentes antes dos extintos; com vínculo antes dos sem vínculo;
 *   genéricos ("Outros") por último;
 * - enriquece com a contagem de vínculos da Reforma (`totalClassificacoes`).
 */
export async function buscarNomenclaturaPorTexto(
  termo: unknown,
  limite = 30,
  opts?: { tolerante?: boolean },
): Promise<ResultadoBuscaTexto[]> {
  const tokens = tokensRelevantes(termo)
  if (!tokens.length) return []
  const indice = await indiceBuscaTexto()
  const teto = Math.max(1, Math.min(limite, 100))
  const tolerante = opts?.tolerante ?? true

  // Variação com sinônimos (dia a dia → oficial). Ex.: "boi"→"bovin".
  const expandidos = tokens.map((t) => expandirSinonimoFiscal(t) ?? t)
  const tokensExpandidos = [...new Set(expandidos)].join(' ') !== tokens.join(' ') ? [...new Set(expandidos)] : null

  const porCodigo = new Map<string, ResultadoBuscaTexto>()

  function oferecer(item: (typeof indice)[number], score: number): void {
    if (score < 0) return
    const atual = porCodigo.get(item.item.codigo)
    if (!atual || score > atual.score) {
      porCodigo.set(item.item.codigo, {
        ...item.item,
        caminho: item.caminho,
        caminhoTexto: [...item.caminho, item.item.descricao].filter(Boolean).join(' › '),
        totalClassificacoes: 0,
        score,
      })
    }
  }

  // Fase 1 — AND estrito (tokens originais + expandidos).
  for (const e of indice) {
    oferecer(e, pontuarCandidato(tokens, e.normPropria, e.normCaminho))
  }
  if (tokensExpandidos) {
    for (const e of indice) {
      if (porCodigo.has(e.item.codigo)) continue
      oferecer(e, pontuarCandidato(tokensExpandidos, e.normPropria, e.normCaminho))
    }
  }

  // Fase 2 — OR tolerante até encher (só se a fase 1 deu pouco e quando
  // permitido; o determinístico passa `tolerante: false` para não deixar match
  // fraco virar "alta" — tolerância no determinístico é só via `consultasTolerantes`).
  if (tolerante && porCodigo.size < teto) {
    const listas: string[][] = [tokens]
    if (tokensExpandidos) listas.push(tokensExpandidos)
    for (const toks of listas) {
      for (const e of indice) {
        if (porCodigo.has(e.item.codigo)) continue
        oferecer(e, pontuarCandidatoParcial(toks, e.normPropria, e.normCaminho))
        if (porCodigo.size >= teto * 3) break
      }
      if (porCodigo.size >= teto * 3) break
    }
  }

  const candidatos = [...porCodigo.values()]
  candidatos.sort((a, b) => {
    const vig = Number(Boolean(a.dataFim)) - Number(Boolean(b.dataFim))
    if (vig !== 0) return vig
    if (b.score !== a.score) return b.score - a.score
    return a.codigo.localeCompare(b.codigo)
  })
  const pagina = candidatos.slice(0, teto)

  // Enriquecimento fiscal: quantos vínculos cada NCM tem na base da Reforma.
  if (pagina.length) {
    try {
      const vinculos = await db.ncm
        .where('codigo')
        .anyOf(pagina.map((p) => p.codigo))
        .toArray()
      const contagem = new Map<string, number>()
      for (const v of vinculos) contagem.set(v.codigo, (contagem.get(v.codigo) ?? 0) + 1)
      for (const p of pagina) p.totalClassificacoes = contagem.get(p.codigo) ?? 0
    } catch {
      // Sem vínculos (base da Reforma vazia): mantém 0, a busca continua útil.
    }
  }
  return pagina
}

/** Monta a classificação de regra geral já com a nomenclatura do NCM. */
export async function classificacaoRegraGeral(
  codigo: unknown,
  nomenclatura?: NomenclaturaNcm | null,
): Promise<Classificacao> {
  const ctx = await contextoRegraGeral()
  const nomen = nomenclatura === undefined ? await buscarNomenclatura(codigo) : nomenclatura
  return montarRegraGeral(norm(codigo), { ...ctx, nomenclatura: nomen })
}

/**
 * Fluxo 0 / 1 / N (SPEC §2.3) usado por consulta, lote e XML.
 * Retorna também a nomenclatura resolvida para reaproveitamento na UI.
 *
 * Prioridade (motor único — vale igual em todas as telas):
 * 1. reclassificação manual do usuário (quando existe, puxa a que ele criou,
 *    acima da base oficial; responsabilidade dele, sinalizada na UI);
 * 2. vínculos oficiais da base;
 * 3. regra geral (fallback universal).
 *
 * Rebaixamentos (nunca apresentam redução como vigente):
 * - NCM extinto (`dataFim` na nomenclatura) COM vínculo: o vínculo é
 *   histórico — lista vira regra geral com `extinto: true`.
 * - Vínculo com anexo/cct revogado: filtrado; se nada restar, regra geral
 *   com `revogado` (ato + motivo). A manual do usuário prevalece sobre ambos.
 */
export async function resolverClassificacoes(
  codigo: unknown,
): Promise<{
  vinculos: VinculoNcm[]
  lista: Classificacao[]
  nomenclatura: NomenclaturaNcm | null
  regraGeral: boolean
  manual: boolean
  extinto: boolean
  revogado: Revogacao | null
}> {
  const c = norm(codigo)
  const nomenclatura = await buscarNomenclatura(c)
  const vinculos = c.length === 8 ? await db.ncm.where('codigo').equals(c).toArray() : []
  const extinto = isNcmExtinto(nomenclatura) && c.length === 8
  if (c.length !== 8) {
    return { vinculos: [], lista: [], nomenclatura, regraGeral: false, manual: false, extinto: false, revogado: null }
  }
  // Manual do usuário vale acima de tudo: existindo, todas as telas puxam a
  // que ele criou (responsabilidade dele, sinalizada na UI) — inclusive
  // quando a base oficial tem vínculo ou o NCM está extinto/revogado.
  const manualReg = await buscarReclassificacaoManual(c)
  if (manualReg) {
    const cl = await classificacaoManual(manualReg, nomenclatura)
    return { vinculos, lista: [cl], nomenclatura, regraGeral: false, manual: true, extinto, revogado: null }
  }
  // NCM extinto: o vínculo virou histórico, sem valor como tributação vigente.
  if (extinto) {
    const rg = await classificacaoRegraGeral(c, nomenclatura)
    return { vinculos, lista: [rg], nomenclatura, regraGeral: true, manual: false, extinto, revogado: null }
  }
  // Vínculos vivos: filtra anexo/cct revogado (curadoria + achados do CFF).
  let revogado: Revogacao | null = null
  let vivos = vinculos
  if (vivos.length) {
    const dinamicas = await obterRevogacoesCff()
    const mantidos: VinculoNcm[] = []
    for (const v of vivos) {
      const ctx = await contextoDe(v)
      const rev = revogacaoDe(v.cClassTrib, ctx.referencia?.anexo, dinamicas)
      if (rev && !revogado) revogado = rev
      if (!rev) mantidos.push(v)
    }
    vivos = mantidos
  }
  // Ordem determinística (CST, cClassTrib): a "1ª opção" (lista[0]) usada
  // como estimativa por Lote/XML/SPED/revalidação é a mesma em todas as
  // telas, independente da ordem de importação da base.
  vivos.sort((a, b) => a.cst.localeCompare(b.cst) || a.cClassTrib.localeCompare(b.cClassTrib))
  if (!vivos.length) {
    const rg = await classificacaoRegraGeral(c, nomenclatura)
    if (revogado) rg.revogado = revogado
    return { vinculos, lista: [rg], nomenclatura, regraGeral: true, manual: false, extinto, revogado }
  }
  const ctxs = await Promise.all(vivos.map(contextoDe))
  const lista = vivos.map((v, i) =>
    montarClassificacao(v, nomenclatura ? { ...ctxs[i], nomenclatura } : ctxs[i]),
  )
  return { vinculos, lista, nomenclatura, regraGeral: false, manual: false, extinto: false, revogado: null }
}
