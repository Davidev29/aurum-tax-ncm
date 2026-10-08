import { REGRA_GERAL } from '@/domain/constants'
import type { Classificacao, HerancaFamilia, NomenclaturaNcm, VinculoNbs, VinculoNcm } from '@/domain/entities'
import {
  montarClassificacao,
  montarClassificacaoHerdada,
  montarRegraGeral,
  isNcmExtinto,
  type ContextoClassificacao,
} from '@/domain/services/classificacao'
import { revogacaoDe, type Revogacao } from '@/domain/services/revogacao'
import {
  decidirHeranca,
  ehCondicional,
  condicaoDoCct,
  origemDoNivel,
  regraDoCapitulo,
  tamanhoDoNivel,
  type NivelHeranca,
} from '@/domain/services/regras-hierarquicas'
import { prefixoDeEntradaTruncada, type NivelNcm } from '@/domain/services/hierarquia-fiscal'
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
async function contextoDe(vinculo: VinculoNcm | VinculoNbs): Promise<ContextoClassificacao> {
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
  /** Tokens pré-computados (evita split O(docs) por consulta no RAG). */
  toksPropria: string[]
  toksCaminho: string[]
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
        const normPropria = normalizarBusca(item.descricao)
        const normCaminho = normalizarBusca([...caminho, item.descricao].join(' '))
        return {
          item,
          caminho,
          normPropria,
          normCaminho,
          toksPropria: normPropria ? [...new Set(normPropria.split(' ').filter((t) => t.length >= 2))] : [],
          toksCaminho: normCaminho ? [...new Set(normCaminho.split(' ').filter((t) => t.length >= 2))] : [],
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
 * 2. vínculos oficiais da base (exatos, 8 dígitos);
 * 3. herança por família (subposição SH6 → posição SH4 → capítulo curado):
 *    NCM vigente sem vínculo exato herda o enquadramento unânime dos irmãos;
 * 4. regra geral (fallback universal).
 *
 * Rebaixamentos (nunca apresentam redução como vigente):
 * - NCM extinto (`dataFim` na nomenclatura) COM vínculo: o vínculo é
 *   histórico — lista vira regra geral com `extinto: true`.
 * - Vínculo com anexo/cct revogado: filtrado; se nada restar, regra geral
 *   com `revogado` (ato + motivo). A manual do usuário prevalece sobre ambos.
 * - Herança condicional: cct da família que exige destinação/adquirente
 *   nunca herda sozinho — vira hipótese em `hipoteseFamilia`.
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
  /** Presente quando a lista veio de herança por família. */
  heranca?: HerancaFamilia | null
  /** Hipótese qualificada quando há lastro parcial (sem herança automática). */
  hipoteseFamilia?: HipoteseFamilia | null
}> {
  const c = norm(codigo)
  const nomenclatura = await buscarNomenclatura(c)
  const vinculos = c.length === 8 ? await db.ncm.where('codigo').equals(c).toArray() : []
  const extinto = isNcmExtinto(nomenclatura) && c.length === 8
  if (c.length !== 8) {
    return { vinculos: [], lista: [], nomenclatura, regraGeral: false, manual: false, extinto: false, revogado: null, heranca: null, hipoteseFamilia: null }
  }
  // Manual do usuário vale acima de tudo: existindo, todas as telas puxam a
  // que ele criou (responsabilidade dele, sinalizada na UI) — inclusive
  // quando a base oficial tem vínculo ou o NCM está extinto/revogado.
  const manualReg = await buscarReclassificacaoManual(c)
  if (manualReg) {
    const cl = await classificacaoManual(manualReg, nomenclatura)
    return { vinculos, lista: [cl], nomenclatura, regraGeral: false, manual: true, extinto, revogado: null, heranca: null, hipoteseFamilia: null }
  }
  // NCM extinto: o vínculo virou histórico, sem valor como tributação vigente.
  if (extinto) {
    const rg = await classificacaoRegraGeral(c, nomenclatura)
    return { vinculos, lista: [rg], nomenclatura, regraGeral: true, manual: false, extinto, revogado: null, heranca: null, hipoteseFamilia: null }
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
    // Sem vínculo exato: tenta herança por família antes da regra geral.
    // (Só 15,9% dos NCMs vigentes têm vínculo exato — sem este passo,
    // NCMs novos da mesma família perderiam o benefício do anexo.)
    const familia = await resolverPorFamilia(c, nomenclatura)
    if (familia?.classificacao) {
      return { vinculos, lista: [familia.classificacao], nomenclatura, regraGeral: false, manual: false, extinto, revogado, heranca: familia.classificacao.heranca ?? null, hipoteseFamilia: null }
    }
    const rg = await classificacaoRegraGeral(c, nomenclatura)
    if (revogado) rg.revogado = revogado
    return { vinculos, lista: [rg], nomenclatura, regraGeral: true, manual: false, extinto, revogado, heranca: null, hipoteseFamilia: familia?.hipotese ?? null }
  }
  const ctxs = await Promise.all(vivos.map(contextoDe))
  const lista = vivos.map((v, i) =>
    montarClassificacao(v, nomenclatura ? { ...ctxs[i], nomenclatura } : ctxs[i]),
  )
  return { vinculos, lista, nomenclatura, regraGeral: false, manual: false, extinto: false, revogado: null, heranca: null, hipoteseFamilia: null }
}

/* -------------------------------- herança por família (LC 214/2025) ------- */

/** Hipótese qualificada de família (lastro parcial — a confirmar). */
export interface HipoteseFamilia {
  nivel: NivelHeranca
  prefixo: string
  cst: string
  cClassTrib: string
  anexo: string | null
  motivo: string
  /** Condição a confirmar quando o cct é condicional. */
  condicao?: string | null
}

/** Vínculos da Reforma sob um prefixo (irmãos da família). */
export async function buscarVinculosPorPrefixo(prefixo: unknown): Promise<VinculoNcm[]> {
  const p = norm(prefixo)
  if (p.length < 2 || p.length > 7) return []
  try {
    return await db.ncm.where('codigo').between(p, `${p}\uffff`, true, true).toArray()
  } catch {
    return []
  }
}

/** NCMs vigentes (8 dígitos, sem `dataFim`) sob um prefixo. */
export async function vigentesNoPrefixo(prefixo: unknown): Promise<NomenclaturaNcm[]> {
  const p = norm(prefixo)
  if (p.length < 2 || p.length > 7) return []
  try {
    const achados = await db.ncmNomenclatura.where('codigo').between(p, `${p}\uffff`, true, true).toArray()
    return achados.filter((n) => n.codigo.length === 8 && !n.dataFim)
  } catch {
    return []
  }
}

/**
 * Herança por família para um NCM de 8 dígitos sem vínculo exato.
 *
 * Tenta, nesta ordem: subposição SH6 → posição SH4 → capítulo (só nos 7
 * capítulos curados de `REGRAS_CAPITULO`). Cada nível exige unanimidade dos
 * irmãos vinculados + limiares de `decidirHeranca` (cobertura dos vigentes).
 * Vínculo-modelo revogado nunca é herdado. Retorna a classificação herdada
 * ou, com lastro parcial, a hipótese a confirmar — ou `null` (regra geral).
 */
export async function resolverPorFamilia(
  codigo: unknown,
  nomenclatura?: NomenclaturaNcm | null,
): Promise<{ classificacao: Classificacao; hipotese: null } | { classificacao: null; hipotese: HipoteseFamilia } | null> {
  const c = norm(codigo)
  if (c.length !== 8) return null
  const nomen = nomenclatura === undefined ? await buscarNomenclatura(c) : nomenclatura
  const dinamicas = await obterRevogacoesCff().catch(() => [])

  const niveis: NivelHeranca[] = ['subposicao', 'posicao', 'capitulo']
  let primeiraHipotese: HipoteseFamilia | null = null

  for (const nivel of niveis) {
    const tam = tamanhoDoNivel(nivel)
    // Capítulo só vale nos 7 curados (100% mapeados e unânimes) — nos demais,
    // a herança por capítulo seria ampla demais (ex.: cap. 29 com 3% de
    // cobertura herdaria benefício para 1.590 NCMs sem lastro).
    if (nivel === 'capitulo' && !regraDoCapitulo(c.slice(0, 2))) continue
    const prefixo = c.slice(0, tam)
    const [irmaos, vigentes] = await Promise.all([
      buscarVinculosPorPrefixo(prefixo),
      vigentesNoPrefixo(prefixo),
    ])
    // Exclui o próprio consultado (se um dia ganhar vínculo, o exato vence).
    const outros = irmaos.filter((v) => v.codigo !== c)
    if (!outros.length) continue
    const chaves = new Set(outros.map((v) => `${v.cst}|${v.cClassTrib}`))
    if (chaves.size !== 1) continue // família divergente: sem herança
    const [chave] = [...chaves]
    const [, cct] = String(chave).split('|')
    const modelo = outros.sort((a, b) => a.codigo.localeCompare(b.codigo))[0]
    if (!modelo) continue
    // Modelo revogado não é herdado (redução sem vigência).
    const ctxModelo = await contextoDe(modelo)
    if (revogacaoDe(modelo.cClassTrib, ctxModelo.referencia?.anexo, dinamicas)) continue
    const totalVigentes = vigentes.length > 0 ? vigentes.length : outros.length + 1
    const decisao = decidirHeranca({
      nivel,
      irmaosVinculados: outros.length,
      vigentesNoPrefixo: totalVigentes,
      unanime: true,
      condicional: ehCondicional(cct),
    })
    if (decisao.tipo === 'herdar') {
      const heranca: HerancaFamilia = {
        nivel,
        prefixo,
        irmaosVinculados: outros.length,
        vigentesNoPrefixo: totalVigentes,
        origem: origemDoNivel(nivel, nivel === 'capitulo'),
        confianca: decisao.confianca,
        aConfirmar: decisao.confianca !== 'alta',
      }
      const ctx = nomen ? { ...ctxModelo, nomenclatura: nomen } : ctxModelo
      const classificacao = montarClassificacaoHerdada(c, modelo, ctx, heranca)
      return { classificacao, hipotese: null }
    }
    if (decisao.tipo === 'hipotese' && !primeiraHipotese) {
      primeiraHipotese = {
        nivel,
        prefixo,
        cst: modelo.cst,
        cClassTrib: modelo.cClassTrib,
        anexo: ctxModelo.referencia?.anexo ?? null,
        motivo: decisao.motivo,
        condicao: condicaoDoCct(modelo.cClassTrib),
      }
    }
  }
  if (primeiraHipotese) return { classificacao: null, hipotese: primeiraHipotese }
  return null
}

/**
 * Classificação por prefixo truncado (2–7 dígitos): a Reforma às vezes
 * entrega subposição abreviada (4–5 dígitos). O motor classifica pela
 * família — lista os vínculos dos filhos + a hipótese agregada quando
 * unânime — em vez de devolver lista vazia.
 */
export async function resolverPorPrefixo(
  entrada: unknown,
): Promise<{
  nivel: NivelNcm
  prefixo: string
  totalFilhos: number
  totalVigentes: number
  lista: Classificacao[]
  unanime: boolean
  cst: string | null
  cClassTrib: string | null
} | null> {
  const conv = prefixoDeEntradaTruncada(entrada)
  if (!conv) return null
  if (conv.nivel === 'exato') {
    const r = await resolverClassificacoes(conv.prefixo)
    return {
      nivel: conv.nivel,
      prefixo: conv.prefixo,
      totalFilhos: r.vinculos.length,
      totalVigentes: r.nomenclatura ? 1 : 0,
      lista: r.lista,
      unanime: r.vinculos.length <= 1,
      cst: r.lista[0]?.cst ?? null,
      cClassTrib: r.lista[0]?.cClassTrib ?? null,
    }
  }
  const [irmaos, vigentes] = await Promise.all([
    buscarVinculosPorPrefixo(conv.prefixo),
    vigentesNoPrefixo(conv.prefixo),
  ])
  const chaves = new Set(irmaos.map((v) => `${v.cst}|${v.cClassTrib}`))
  const unanime = irmaos.length > 0 && chaves.size === 1
  const ctxs = await Promise.all(irmaos.slice(0, 20).map(contextoDe))
  const lista = irmaos.slice(0, 20).map((v, i) => montarClassificacao(v, ctxs[i]))
  const [chave] = [...chaves]
  const [cst, cct] = chave ? String(chave).split('|') : [null, null]
  return {
    nivel: conv.nivel,
    prefixo: conv.prefixo,
    totalFilhos: irmaos.length,
    totalVigentes: vigentes.length,
    lista,
    unanime,
    cst,
    cClassTrib: cct ?? null,
  }
}

/* ------------------------------------------------- NBS · serviços (Phase 7) -- */

import { classificacaoRegraGeralNbs } from '@/domain/services/classificacao-nbs'
import { fmtNbs } from '@/domain/services/format'
import { expandirSinonimoServicos, semJuridiques } from '@/domain/services/classificador-descricao-servicos'
import { casaToken } from '@/domain/services/vocabulario'
import type { HipoteseLegal } from '@/domain/services/verificacao-servicos'

/** Resultado da busca textual de NBS (título = Base Legal curta). */
export interface ResultadoBuscaTextoNbs {
  codigo: string
  codigoFormatado: string
  /** Base Legal curta (nome de exibição do serviço). */
  titulo: string
  descricao: string
  /** Documentos do vínculo (ex.: `NFE, NFSE`). */
  documentos: string
  /** Quantos vínculos da Reforma existem para este NBS. */
  totalClassificacoes: number
  score: number
}

interface EntradaIndiceTextoNbs {
  vinculo: VinculoNbs
  normTitulo: string
  normRico: string
  toksRico: string[]
}

let _indiceBuscaTextoNbs: EntradaIndiceTextoNbs[] | null = null
let _cacheBuscaTextoNbsTotal = -1

/** Invalida o cache da busca textual NBS (chamar após importar/apagar a base). */
export function invalidarCacheBuscaTextoNbs(): void {
  _indiceBuscaTextoNbs = null
  _cacheBuscaTextoNbsTotal = -1
}

async function indiceBuscaTextoNbs(): Promise<EntradaIndiceTextoNbs[]> {
  const total = await db.nbs.count()
  if (_indiceBuscaTextoNbs === null || _cacheBuscaTextoNbsTotal !== total) {
    const vinculos = await db.nbs.toArray()
    _indiceBuscaTextoNbs = vinculos.map((vinculo) => {
      const normTitulo = normalizarBusca(vinculo.baseLegal)
      const normRico = normalizarBusca(`${vinculo.baseLegal} ${vinculo.descricao}`)
      return {
        vinculo,
        normTitulo,
        normRico,
        toksRico: normRico ? [...new Set(normRico.split(' ').filter((t) => t.length >= 2))] : [],
      }
    })
    _cacheBuscaTextoNbsTotal = total
  }
  return _indiceBuscaTextoNbs ?? []
}

/** Rótulo curto de exibição do NBS (Base Legal já é curta por construção). */
export function tituloNbs(v: Pick<VinculoNbs, 'baseLegal' | 'descricao'>): string {
  const base = String(v.baseLegal ?? '').trim()
  if (base) return base
  return String(v.descricao ?? '').trim().slice(0, 90) || 'Serviço sem descrição'
}

/**
 * Legenda do serviço (NBS 9 dígitos) lida da ponte LC 116 → NBS
 * (`store lcNbs`: 1.739 relações, 676 NBS distintos). É a fonte do "o que é
 * este serviço" quando o NBS cai na regra geral (sem vínculo em `db.nbs`,
 * que só tem os 122 com benefício): `descricaoNbs` (nome curto do serviço)
 * + item LC 116 + `descricaoLc` (texto do item da LC 116).
 *
 * Best-effort: `null` quando o NBS não tem legenda (código inexistente) ou
 * a store ainda não foi semeada — o chamador mantém o fallback genérico.
 */
export async function buscarLegendaNbs(
  codigo: unknown,
): Promise<{ lc: string; descricaoNbs: string; descricaoLc: string } | null> {
  const c = norm(codigo)
  if (c.length !== 9) return null
  try {
    const rels = await db.lcNbs.where('nbs').equals(c).limit(10).toArray()
    if (!rels.length) return null
    const comNome = rels.find((r) => String(r.descricaoNbs ?? '').trim()) ?? rels[0]
    const descricaoNbs = String(comNome.descricaoNbs ?? '').trim()
    const descricaoLc = String(comNome.descricaoLc ?? '').trim()
    if (!descricaoNbs && !descricaoLc) return null
    return { lc: String(comNome.lc ?? '').trim(), descricaoNbs, descricaoLc }
  } catch {
    return null
  }
}

/** R2.3-NBS — prefixo com no mínimo 2 dígitos; vigentes conceituais primeiro. */
export async function sugerirNbs(prefixo: unknown, limite = 30): Promise<VinculoNbs[]> {
  const t = norm(prefixo)
  if (t.length < 2) return []
  const folga = Math.min(limite + 20, 100)
  const achados = await db.nbs
    .where('codigo')
    .between(t, `${t}\uffff`, true, true)
    .limit(folga)
    .toArray()
  achados.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return achados.slice(0, limite)
}

/**
 * Busca NBS pelo **nome/descrição do serviço**.
 *
 * RAG em 2 fases (paridade com `buscarNomenclaturaPorTexto`):
 * - Fase 1 (precisão): AND estrito sobre tokens relevantes + variação com
 *   sinônimos de serviços;
 * - Fase 2 (cobertura): OR tolerante até encher.
 */
export async function buscarNbsPorTexto(
  termo: unknown,
  limite = 30,
  opts?: { tolerante?: boolean },
): Promise<ResultadoBuscaTextoNbs[]> {
  // Núcleo semântico: boilerplate ("servico", "fornecimento", "anexo"...)
  // não é lastro — sem isso qualquer consulta com um termo →'servico'
  // (ex.: "desenvolvimento", "petshop") casava os 112 NBS via substring
  // "servico"⊂"servicos" e elegia benefício à toa.
  const tokens = semJuridiques(tokensRelevantes(termo))
  if (!tokens.length) return []
  const indice = await indiceBuscaTextoNbs()
  const teto = Math.max(1, Math.min(limite, 100))
  const tolerante = opts?.tolerante ?? true

  const expandidos = tokens.map((t) => expandirSinonimoServicos(t) ?? t)
  const expandidosUteis = semJuridiques([...new Set(expandidos)])
  const tokensExpandidos = expandidosUteis.length && expandidosUteis.join(' ') !== tokens.join(' ') ? expandidosUteis : null

  const porCodigo = new Map<string, ResultadoBuscaTextoNbs>()

  function oferecer(e: EntradaIndiceTextoNbs, score: number): void {
    if (score < 0) return
    const atual = porCodigo.get(e.vinculo.codigo)
    if (!atual || score > atual.score) {
      porCodigo.set(e.vinculo.codigo, {
        codigo: e.vinculo.codigo,
        codigoFormatado: fmtNbs(e.vinculo.codigo),
        titulo: tituloNbs(e.vinculo),
        descricao: e.vinculo.descricao,
        documentos: e.vinculo.documentos ?? '',
        totalClassificacoes: 0,
        score,
      })
    }
  }

  for (const e of indice) {
    oferecer(e, pontuarCandidato(tokens, e.normTitulo, e.normRico))
  }
  if (tokensExpandidos) {
    for (const e of indice) {
      if (porCodigo.has(e.vinculo.codigo)) continue
      oferecer(e, pontuarCandidato(tokensExpandidos, e.normTitulo, e.normRico))
    }
  }

  if (tolerante && porCodigo.size < teto) {
    const listas: string[][] = [tokens]
    if (tokensExpandidos) listas.push(tokensExpandidos)
    for (const toks of listas) {
      for (const e of indice) {
        if (porCodigo.has(e.vinculo.codigo)) continue
        oferecer(e, pontuarCandidatoParcial(toks, e.normTitulo, e.normRico))
        if (porCodigo.size >= teto * 3) break
      }
      if (porCodigo.size >= teto * 3) break
    }
  }

  const candidatos = [...porCodigo.values()]
  candidatos.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.codigo.localeCompare(b.codigo)
  })
  const pagina = candidatos.slice(0, teto)

  if (pagina.length) {
    try {
      const vinculos = await db.nbs
        .where('codigo')
        .anyOf(pagina.map((p) => p.codigo))
        .toArray()
      const contagem = new Map<string, number>()
      for (const v of vinculos) contagem.set(v.codigo, (contagem.get(v.codigo) ?? 0) + 1)
      for (const p of pagina) p.totalClassificacoes = contagem.get(p.codigo) ?? 0
    } catch {
      // Sem vínculos: mantém 0, a busca continua útil.
    }
  }
  return pagina
}

/**
 * Fluxo 0/1/N dos SERVIÇOS (Phase 7) — motor único do menu Serviços.
 *
 * Prioridade: vínculos oficiais da base → regra geral (`000|000001`,
 * tributação integral). Vínculos com anexo/cct revogado são filtrados;
 * se nada restar, regra geral com `revogado`. Sem reclassificação manual
 * no v1 (fora de escopo Phase 7).
 */
export async function resolverClassificacoesNbs(
  codigo: unknown,
): Promise<{
  vinculos: VinculoNbs[]
  lista: Classificacao[]
  regraGeral: boolean
  revogado: Revogacao | null
}> {
  const c = norm(codigo)
  if (c.length !== 9) {
    return { vinculos: [], lista: [], regraGeral: false, revogado: null }
  }
  const vinculos = await db.nbs.where('codigo').equals(c).toArray()

  let revogado: Revogacao | null = null
  let vivos = vinculos
  if (vivos.length) {
    const dinamicas = await obterRevogacoesCff()
    const mantidos: VinculoNbs[] = []
    for (const v of vivos) {
      const ctx = await contextoDe(v)
      const rev = revogacaoDe(v.cClassTrib, ctx.referencia?.anexo, dinamicas)
      if (rev && !revogado) revogado = rev
      if (!rev) mantidos.push(v)
    }
    vivos = mantidos
  }
  vivos.sort((a, b) => a.cst.localeCompare(b.cst) || a.cClassTrib.localeCompare(b.cClassTrib))
  if (!vivos.length) {
    const rg = await classificacaoRegraGeralNbs(c)
    if (revogado) rg.revogado = revogado
    return { vinculos, lista: [rg], regraGeral: true, revogado }
  }
  const ctxs = await Promise.all(vivos.map(contextoDe))
  const lista = vivos.map((v, i) => montarClassificacao(v, ctxs[i]))
  // NBS com vínculo: anexa a legenda curta do serviço (nome + item LC 116)
  // para a UI identificar "o que é" sem ler o juridiquês do vínculo.
  try {
    const legenda = await buscarLegendaNbs(c)
    if (legenda) {
      for (const cl of lista) {
        if (!cl.detalheNbs) cl.detalheNbs = legenda
      }
    }
  } catch {
    /* legenda é enriquecimento — nunca quebra a classificação */
  }
  return { vinculos, lista, regraGeral: false, revogado: null }
}

/* --------------------------------- hipóteses legais (conferência Phase 7) -- */

/**
 * Genéricos que nunca decidem um match sozinhos (aparecem em todas as linhas
 * da referência: "observado o art…", "Lei Complementar nº 214…").
 */
const GENERICOS_HIPOTESE = new Set([
  'atividade', 'atividades', 'servico', 'servicos', 'serv', 'fornec',
  'fornecimento', 'fornecimentos', 'prestacao', 'prestacoes', 'similares',
  'similar', 'outros', 'outras', 'outro', 'outra', 'demais', 'geral', 'forma',
  'observado', 'observada', 'artigo', 'artigos', 'art', 'arts', 'lei', 'complementar',
  'inciso', 'incisos', 'paragrafo', 'alinea', 'bem', 'bens',
])

function tokensHipoteses(texto: unknown): string[] {
  const base = tokensRelevantes(texto).filter(
    (t) => !GENERICOS_HIPOTESE.has(t) && !/^\d+$/.test(t),
  )
  const expandidos = base.map((t) => expandirSinonimoServicos(t) ?? t)
  return [...new Set([...base, ...expandidos])]
}

/**
 * Benefícios da LC 214 que o texto do CNAE sugere, lidos DA REFERÊNCIA
 * OFICIAL (redução > 0). Ordenados por cobertura textual; só cobertura
 * ≥ 0,40 vira hipótese. Nunca inventa vínculo: `temNbs` indica se existe
 * NBS mapeado para o cct na base atual.
 */
export async function buscarHipotesesLegais(
  textoCnae: unknown,
  limite = 3,
  opts?: { pinsCct?: string[] },
): Promise<HipoteseLegal[]> {
  const query = tokensHipoteses(textoCnae)
  if (!query.length && !(opts?.pinsCct?.length)) return []
  const [referencia, cstct, nbs] = await Promise.all([
    db.referencia.toArray(),
    db.cstClassTrib.toArray(),
    db.nbs.toArray().catch(() => []),
  ])
  const porCct = new Map(referencia.map((r) => [r.cClassTrib, r]))
  const cctsComNbs = new Set(nbs.map((v) => v.cClassTrib))
  const lcRefPorId = new Map(cstct.map((c) => [c.id, c.lcRef ?? null]))

  function montar(r: (typeof referencia)[number], cobertura: number, origem: HipoteseLegal['origem']): HipoteseLegal {
    return {
      cst: r.cst,
      cClassTrib: r.cClassTrib,
      reducaoIBS: Number(r.pRedIBS) || 0,
      reducaoCBS: Number(r.pRedCBS) || 0,
      anexo: r.anexo,
      descricao: r.descricao,
      baseLegal: lcRefPorId.get(`${r.cst}|${r.cClassTrib}`) ?? null,
      urlLegislacao: r.urlLegislacao,
      temNbs: cctsComNbs.has(r.cClassTrib),
      cobertura,
      origem,
    }
  }

  // Pins de setor primeiro (curadoria > inferência), deduplicados abaixo.
  const pontuadas: HipoteseLegal[] = []
  for (const cct of opts?.pinsCct ?? []) {
    const r = porCct.get(String(cct).replace(/\D+/g, ''))
    if (!r) continue
    if (!(Number(r.pRedIBS) > 0 || Number(r.pRedCBS) > 0)) continue
    pontuadas.push(montar(r, 1, 'setor'))
  }
  const pinados = new Set(pontuadas.map((h) => h.cClassTrib))

  for (const r of referencia) {
    if (pinados.has(r.cClassTrib)) continue
    const redIBS = Number(r.pRedIBS) || 0
    const redCBS = Number(r.pRedCBS) || 0
    if (redIBS <= 0 && redCBS <= 0) continue
    const refToks = tokensHipoteses(`${r.descricao} ${r.cstDescricao}`)
    if (!refToks.length || !query.length) continue
    let casados = 0
    for (const q of query) {
      if (refToks.includes(q)) {
        casados += 1
        continue
      }
      for (const o of refToks) {
        if (casaToken(q, o)) {
          casados += 0.8
          break
        }
      }
    }
    const cobertura = Math.round((casados / query.length) * 100) / 100
    if (cobertura < 0.4) continue
    pontuadas.push(montar(r, cobertura, 'texto'))
  }
  pontuadas.sort(
    (a, b) => b.cobertura - a.cobertura || Math.max(b.reducaoIBS, b.reducaoCBS) - Math.max(a.reducaoIBS, a.reducaoCBS),
  )
  // Pins de setor têm precedência sobre o léxico (curadoria > inferência).
  const pins = pontuadas.filter((h) => h.origem === 'setor')
  const resto = pontuadas.filter((h) => h.origem !== 'setor')
  return [...pins, ...resto].slice(0, Math.max(1, limite))
}
