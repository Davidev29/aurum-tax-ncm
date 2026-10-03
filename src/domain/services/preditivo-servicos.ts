/**
 * Predição informativa de serviços (NBS) — camada preditiva por nomes/sinônimos.
 *
 * Problema (pedido do usuário): algumas atividades NÃO puxam NBS no fluxo
 * oficial (sem vínculo na base, RAG estrito vazio, CNAE sem NBS mapeado),
 * mas BATEM com os termos do sistema (título NBS, descrição do vínculo,
 * descrição do cClassTrib/anexo LC 214). Antes, esses casos morriam em
 * "NÃO SEI / regra geral seca" — sem nenhuma pista.
 *
 * Solução: comparação preditiva de nomes + sinônimos que SEMPRE sugere
 * (top-3) a título INFORMATIVO — nunca como decisão final:
 * - só usa códigos que EXISTEM na base (NBS 9 dígitos / cct da referência);
 * - cada sugestão carrega `apenasInformativo: true`, cobertura, termos que
 *   casaram e sinônimos usados (auditoria);
 * - o resolvedor continua sendo a única verdade: a UI deve exibir o selo
 *   "Sugestão preditiva — apenas informativa, confirme com o contador"
 *   e o botão "Classificar oficialmente" (que valida via resolvedor).
 *
 * Fine-tuning NBS v2: este módulo é o "cérebro preditivo" do pack de
 * serviços — scoring ponderado título×2 + descrição×1 + bônus benefício,
 * com expansão sinonímica em lote e tolerância casaToken (radical/fuzzy).
 */

import { normalizarBusca, tokensRelevantes } from './busca-texto'
import { casaToken } from './vocabulario'
import { expandirSinonimoServicos, semJuridiques, TOKENS_JURIDIQUES_NBS } from './classificador-descricao-servicos'
import {
  GRUPOS_CONTEXTO_NBS,
  anexoLc214ParaExibicao,
  obterContextoNbs,
  tokensDoContexto,
  viewDoGrupo,
  type ContextoNbsView,
  type GrupoNbsId,
} from '@/domain/constants/contexto-nbs'
import { fmtNbs } from './format'
import { db } from '@/infrastructure/db/schema'

/** Aviso fixo exibido em TODA sugestão preditiva (nunca é decisão final). */
export const AVISO_PREDITIVO_INFORMATIVO =
  'Sugestão preditiva da Aurum AI — apenas informativa, NÃO é decisão final. Confirme com o contador e classifique oficialmente antes de escriturar.'

export interface SugestaoPreditivaServico {
  /** NBS 9 dígitos (só dígitos) ou cct quando for hipótese sem NBS direto. */
  codigo: string
  codigoFormatado: string
  titulo: string
  /** 'nbs' = NBS existente; 'hipotese-cct' = benefício possível sem NBS direto. */
  tipo: 'nbs' | 'hipotese-cct'
  score: number
  /** 0–1: fração dos termos da consulta com lastro no alvo. */
  cobertura: number
  termosCasados: string[]
  sinonimosUsados: string[]
  /** Onde casou: título NBS, descrição do vínculo, contexto personalizado ou descrição do cct. */
  origem: 'nbs-titulo' | 'nbs-descricao' | 'contexto-personalizado' | 'cct-descricao'
  cst: string | null
  cClassTrib: string | null
  anexo: string | null
  reducaoIBS: number
  reducaoCBS: number
  baseLegal: string | null
  urlLegislacao: string | null
  /** Sempre `true` — a UI bloqueia escrituração direta desta sugestão. */
  apenasInformativo: true
  aviso: string
  /** Contexto personalizado do item (resumo, aplica/não-aplica, condições). */
  contexto: ContextoNbsView | null
}

interface AlvoPreditivo {
  codigo: string
  titulo: string
  descricaoRica: string
  toksTitulo: Set<string>
  toksRico: Set<string>
  /** Tokens do contexto personalizado (termos populares do grupo). */
  toksContexto: Set<string>
  grupo: GrupoNbsId | null
  cst: string | null
  cClassTrib: string | null
  anexo: string | null
  reducaoIBS: number
  reducaoCBS: number
  baseLegal: string | null
  urlLegislacao: string | null
  tipo: 'nbs' | 'hipotese-cct'
  origemTitulo: string
}

function toks(texto: string): Set<string> {
  return new Set(normalizarBusca(texto).split(' ').filter((t) => t.length >= 2))
}

/**
 * Pontua um alvo contra a consulta (puro, testável).
 * Título vale ×2 (nome do serviço), contexto personalizado ×1,2, descrição ×1.
 * Retorna pontos, cobertura, evidências (termos + sinônimos) e a fonte de
 * cada termo casado (para `origem` auditável).
 */
export function pontuarAlvoPreditivo(
  queryTokens: string[],
  queryExpandidos: Map<string, string>,
  alvo: { toksTitulo: Set<string>; toksRico: Set<string>; toksContexto?: Set<string> },
): { pontos: number; cobertura: number; casados: string[]; sinonimos: string[]; fontes: ('titulo' | 'rico' | 'contexto')[] } {
  const casados: string[] = []
  const sinonimos: string[] = []
  const fontes: ('titulo' | 'rico' | 'contexto')[] = []
  let pontos = 0
  const ctx = alvo.toksContexto ?? new Set<string>()
  for (const q of queryTokens) {
    const exp = queryExpandidos.get(q)
    const variantes = exp && exp !== q ? [q, exp] : [q]
    let melhor: { peso: number; viaSinonimo: string | null; fonte: 'titulo' | 'rico' | 'contexto' } | null = null
    for (const v of variantes) {
      const viaSinonimo = v !== q ? `${q}→${v}` : null
      // Exato no título = evidência forte.
      if (alvo.toksTitulo.has(v)) {
        const peso = 2
        if (!melhor || peso > melhor.peso) melhor = { peso, viaSinonimo, fonte: 'titulo' }
        continue
      }
      // Exato no contexto personalizado = evidência de curadoria.
      if (ctx.has(v)) {
        const peso = 1.2
        if (!melhor || peso > melhor.peso) melhor = { peso, viaSinonimo, fonte: 'contexto' }
        continue
      }
      // Exato no rico = evidência média.
      if (alvo.toksRico.has(v)) {
        const peso = 1
        if (!melhor || peso > melhor.peso) melhor = { peso, viaSinonimo, fonte: 'rico' }
        continue
      }
      // Tolerante (radical/fuzzy) — percorre o alvo uma vez por variante.
      let achouTitulo = false
      let achouRico = false
      for (const o of alvo.toksTitulo) {
        if (casaToken(v, o)) {
          achouTitulo = true
          break
        }
      }
      if (achouTitulo) {
        const peso = 1.6
        if (!melhor || peso > melhor.peso) melhor = { peso, viaSinonimo, fonte: 'titulo' }
        continue
      }
      let achouCtx = false
      for (const o of ctx) {
        if (casaToken(v, o)) {
          achouCtx = true
          break
        }
      }
      if (achouCtx) {
        const peso = 0.9
        if (!melhor || peso > melhor.peso) melhor = { peso, viaSinonimo, fonte: 'contexto' }
        continue
      }
      for (const o of alvo.toksRico) {
        if (casaToken(v, o)) {
          achouRico = true
          break
        }
      }
      if (achouRico) {
        const peso = 0.8
        if (!melhor || peso > melhor.peso) melhor = { peso, viaSinonimo, fonte: 'rico' }
      }
    }
    if (melhor) {
      pontos += melhor.peso
      casados.push(q)
      fontes.push(melhor.fonte)
      if (melhor.viaSinonimo) sinonimos.push(melhor.viaSinonimo)
    }
  }
  const cobertura = queryTokens.length ? casados.length / queryTokens.length : 0
  return { pontos, cobertura: Math.round(cobertura * 100) / 100, casados, sinonimos, fontes }
}

/**
 * Sugestões preditivas informativas para uma atividade/descrição livre.
 * Lê NBS + referência oficial (somente leitura) e devolve até `limite`
 * candidatos com lastro mínimo — mesmo quando o fluxo oficial deu
 * regra geral ou vazio. NUNCA inventa código.
 *
 * @param texto Atividade ou descrição livre (ex.: CNAE "Formação de condutores").
 * @param opts.limite Top-N (padrão 3). @param opts.coberturaMinima Lastro mínimo (padrão 0.25).
 */
export async function sugerirPreditivoServicos(
  texto: unknown,
  opts?: { limite?: number; coberturaMinima?: number },
): Promise<SugestaoPreditivaServico[]> {
  const limite = Math.max(1, Math.min(5, opts?.limite ?? 3))
  const coberturaMinima = opts?.coberturaMinima ?? 0.25
  // Núcleo semântico: boilerplate ("servico", "fornecimento", "anexo"...)"
  // não é lastro — sem isso "consultoria" (→"servico") casava os 112 NBS.
  const queryTokens = semJuridiques(tokensRelevantes(texto))
  if (!queryTokens.length) return []
  const queryExpandidos = new Map<string, string>()
  for (const q of queryTokens) {
    const exp = expandirSinonimoServicos(q)
    // Expansão para juridiquês ("desenvolvimento"→"servico") NÃO é lastro:
    // "servico" casa "servicos" em todos os 112 NBS via substring.
    if (exp && exp !== q && !TOKENS_JURIDIQUES_NBS.has(exp)) queryExpandidos.set(q, exp)
  }

  const [vinculos, referencia, cstct] = await Promise.all([
    db.nbs.toArray().catch(() => []),
    db.referencia.toArray().catch(() => []),
    db.cstClassTrib.toArray().catch(() => []),
  ])
  if (!vinculos.length && !referencia.length) return []
  const lcRefPorId = new Map(cstct.map((c) => [`${c.cst}|${c.cClassTrib}`, c.lcRef ?? null]))
  const urlPorCct = new Map(referencia.map((r) => [r.cClassTrib, r.urlLegislacao ?? null]))

  const alvos: AlvoPreditivo[] = []
  const vistosNbs = new Set<string>()
  for (const v of vinculos) {
    const cod = String(v.codigo ?? '').replace(/\D+/g, '')
    if (!/^\d{9}$/.test(cod) || vistosNbs.has(cod)) continue
    vistosNbs.add(cod)
    const titulo = String(v.baseLegal ?? '').trim() || String(v.descricao ?? '').trim().slice(0, 90)
    const rica = `${v.baseLegal ?? ''} ${v.descricao ?? ''}`
    const ctx = obterContextoNbs(cod)
    alvos.push({
      codigo: cod,
      titulo,
      descricaoRica: rica,
      toksTitulo: toks(titulo),
      toksRico: toks(rica),
      toksContexto: new Set((ctx ? tokensDoContexto(ctx.grupo) : []).map((t) => t)),
      grupo: ctx?.grupo ?? null,
      cst: v.cst ?? null,
      cClassTrib: v.cClassTrib ?? null,
      anexo: null,
      reducaoIBS: 0,
      reducaoCBS: 0,
      baseLegal: null,
      urlLegislacao: null,
      tipo: 'nbs',
      origemTitulo: titulo,
    })
  }
  // Hipóteses de benefício (cct com redução > 0) — para atividades que batem
  // com os TERMOS DO SISTEMA (descrição da referência) mas não têm NBS direto.
  const cctsComNbs = new Set(vinculos.map((v) => String(v.cClassTrib ?? '').replace(/\D+/g, '')))
  for (const r of referencia) {
    const redIBS = Number((r as { pRedIBS?: unknown }).pRedIBS) || 0
    const redCBS = Number((r as { pRedCBS?: unknown }).pRedCBS) || 0
    if (!(redIBS > 0 || redCBS > 0)) continue
    const cct = String(r.cClassTrib ?? '').replace(/\D+/g, '')
    if (!cct || cctsComNbs.has(cct)) continue
    const grupoCct = (Object.values(GRUPOS_CONTEXTO_NBS).find((g) => g.cct === cct)?.grupo ?? null) as GrupoNbsId | null
    // Rótulo curto curado (a descrição oficial é longa e corta no meio —
    // ex.: a lista de profissões do 200052 ficava de fora do título).
    const titulo = (grupoCct ? GRUPOS_CONTEXTO_NBS[grupoCct].rotuloHipotese : '') || String(r.descricao ?? '').slice(0, 120) || `cClassTrib ${cct}`
    const rica = `${r.descricao ?? ''} ${(r as { cstDescricao?: unknown }).cstDescricao ?? ''}`
    alvos.push({
      codigo: cct,
      titulo,
      descricaoRica: rica,
      toksTitulo: toks(titulo),
      toksRico: toks(rica),
      toksContexto: new Set(grupoCct ? tokensDoContexto(grupoCct) : []),
      grupo: grupoCct,
      cst: (r as { cst?: unknown }).cst != null ? String((r as { cst?: unknown }).cst) : null,
      cClassTrib: cct,
      anexo: (r as { anexo?: unknown }).anexo != null ? String((r as { anexo?: unknown }).anexo) : null,
      reducaoIBS: redIBS,
      reducaoCBS: redCBS,
      baseLegal: lcRefPorId.get(`${r.cst}|${r.cClassTrib}`) ?? null,
      urlLegislacao: urlPorCct.get(cct) ?? null,
      tipo: 'hipotese-cct',
      origemTitulo: titulo,
    })
  }

  // Enriquecer NBS com dados da referência (anexo/redução/base legal).
  const refPorCct = new Map(referencia.map((r) => [String(r.cClassTrib ?? '').replace(/\D+/g, ''), r]))
  for (const a of alvos) {
    if (a.tipo !== 'nbs' || !a.cClassTrib) continue
    const r = refPorCct.get(String(a.cClassTrib).replace(/\D+/g, ''))
    if (!r) continue
    a.anexo = (r as { anexo?: unknown }).anexo != null ? String((r as { anexo?: unknown }).anexo) : null
    a.reducaoIBS = Number((r as { pRedIBS?: unknown }).pRedIBS) || 0
    a.reducaoCBS = Number((r as { pRedCBS?: unknown }).pRedCBS) || 0
    a.baseLegal = lcRefPorId.get(`${a.cst}|${a.cClassTrib}`) ?? null
    a.urlLegislacao = urlPorCct.get(String(a.cClassTrib).replace(/\D+/g, '')) ?? null
  }

  const pontuados: { alvo: AlvoPreditivo; pontos: number; cobertura: number; casados: string[]; sinonimos: string[]; fontes: ('titulo' | 'rico' | 'contexto')[]; bonus: number }[] = []
  for (const alvo of alvos) {
    const { pontos, cobertura, casados, sinonimos, fontes } = pontuarAlvoPreditivo(queryTokens, queryExpandidos, alvo)
    if (pontos <= 0 || cobertura < coberturaMinima) continue
    // Bônus benefício: fato oficial convergente vale mais que pista textual pura.
    let bonus = 0
    if ((alvo.reducaoIBS > 0 || alvo.reducaoCBS > 0) && alvo.tipo === 'nbs') bonus += 1
    if (alvo.tipo === 'hipotese-cct') bonus -= 0.5
    pontuados.push({ alvo, pontos: pontos + bonus, cobertura, casados, sinonimos, fontes, bonus })
  }
  pontuados.sort((a, b) => b.pontos - a.pontos || a.alvo.codigo.localeCompare(b.alvo.codigo))
  return pontuados.slice(0, limite).map((p) => {
    const temTitulo = p.fontes.includes('titulo')
    const soContexto = !temTitulo && p.fontes.includes('contexto')
    const origem: SugestaoPreditivaServico['origem'] =
      p.alvo.tipo === 'hipotese-cct'
        ? 'cct-descricao'
        : temTitulo
          ? 'nbs-titulo'
          : soContexto
            ? 'contexto-personalizado'
            : 'nbs-descricao'
    // Contexto personalizado: NBS direto; hipótese sem NBS usa a visão do
    // grupo (ex.: PROF-30 para 200/200052) — sem código, nunca decisão.
    let contexto: ContextoNbsView | null = null
    if (p.alvo.tipo === 'nbs') {
      contexto = obterContextoNbs(p.alvo.codigo)
    } else if (p.alvo.grupo) {
      contexto = viewDoGrupo(p.alvo.grupo, p.alvo.cClassTrib)
    }
    return {
      codigo: p.alvo.codigo,
      codigoFormatado: p.alvo.tipo === 'nbs' ? fmtNbs(p.alvo.codigo) : p.alvo.codigo,
      titulo: p.alvo.titulo,
      tipo: p.alvo.tipo,
      score: Math.round(p.pontos * 100) / 100,
      cobertura: p.cobertura,
      termosCasados: p.casados,
      sinonimosUsados: [...new Set(p.sinonimos)],
      origem,
      cst: p.alvo.cst,
      cClassTrib: p.alvo.cClassTrib,
      anexo: anexoLc214ParaExibicao(p.alvo.anexo),
      reducaoIBS: p.alvo.reducaoIBS,
      reducaoCBS: p.alvo.reducaoCBS,
      baseLegal: p.alvo.baseLegal,
      urlLegislacao: p.alvo.urlLegislacao,
      apenasInformativo: true as const,
      aviso: AVISO_PREDITIVO_INFORMATIVO,
      contexto,
    }
  })
}
