/**
 * Relatório XML — conferência na lei atual + recados simples (v5).
 *
 * Camada de aplicação entre a tela (`NfeXml`) e o PDF (`relatorios.ts`):
 * 1. `dedupNotasPorChave` — elimina duplicidades pela chave de acesso;
 * 2. `verificarCoerenciaRag` — confere cada NCM do filtro na base oficial
 *    (nomenclatura vigente + vínculos CST×cClassTrib + vigência/extinção +
 *    revogação + manuais). É o motor "nível deus" que diz se o imposto usado
 *    bate com a lei atual. Best-effort: nunca quebra o relatório;
 * 3. `gerarInsightsNfe` — no máximo 3 recados em linguagem simples, sempre
 *    a partir dos números do filtro (sem alucinação, sem promessa fiscal);
 * 4. `prepararRelatorioNfeComIA` — orquestra os três + apuração + confronto +
 *    ranking recalculado do filtro (evita divergência com o ranking global).
 *
 * O PDF nunca mostra os termos técnicos internos (RAG, CST, cClassTrib…):
 * tudo vira frase simples ("a Aurum AI encontrou…", "bate com a lei").
 */
import { norm } from '@/domain/services/format'
import { apurarIbsCbs, type ApuracaoIbsCbs } from '@/infrastructure/nfe/apuracao'
import { regimeDoEmitente } from '@/infrastructure/nfe/regime'
import type {
  AlertaRagNfe,
  ConfrontoRegimesNfe,
  CreditoFornecedor,
  InsightNfe,
  NotaXml,
  VerificacaoRagNfe,
} from '@/infrastructure/nfe/tipos'
import { buscarNomenclatura, resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { confrontoRegimes } from './nfe-insights'

const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

/* ------------------------------------------------------------ dedup --- */

export interface NotasDedup {
  unicas: NotaXml[]
  duplicadasIgnoradas: number
}

/**
 * Elimina duplicidades pela chave de acesso (mantém a 1ª ocorrência).
 * A importação já barra duplicadas no banco, mas o filtro/CSV pode reunir a
 * mesma chave duas vezes — o relatório nunca soma em dobro.
 */
export function dedupNotasPorChave(notas: NotaXml[]): NotasDedup {
  const vistas = new Set<string>()
  const unicas: NotaXml[] = []
  let duplicadasIgnoradas = 0
  for (const n of notas ?? []) {
    const chave = String(n?.chave ?? '').trim()
    if (!chave) {
      unicas.push(n)
      continue
    }
    if (vistas.has(chave)) {
      duplicadasIgnoradas++
      continue
    }
    vistas.add(chave)
    unicas.push(n)
  }
  return { unicas, duplicadasIgnoradas }
}

/* ------------------------------------------------- verificação RAG --- */

const FONTES_RAG = [
  'Nomenclatura vigente (TEC)',
  'Vínculos oficiais da Reforma (CST × cClassTrib)',
  'Vigência (NCM extinto · revogação cClassTrib/anexo)',
  'Reclassificações manuais do usuário',
] as const

interface GrupoNcm {
  ncm: string
  norm: string
  qtdItens: number
  base: number
  trib: number
  cstMaisComum: string
  cctMaisComum: string
  redIBS: number
  redCBS: number
  manuais: number
  regraGeral: number
  truncados: number
  invalidos: number
  ambiguos: number
}

function agruparPorNcm(notas: NotaXml[]): GrupoNcm[] {
  const mapa = new Map<string, GrupoNcm & { cstCont: Map<string, number>; cctCont: Map<string, number> }>()
  for (const n of notas ?? []) {
    for (const it of n?.itensAnalisados ?? []) {
      const raw = String(it?.ncm ?? '')
      const nd = norm(raw)
      const chave = nd || raw || '(sem-ncm)'
      let g = mapa.get(chave)
      if (!g) {
        g = {
          ncm: raw, norm: nd, qtdItens: 0, base: 0, trib: 0,
          cstMaisComum: '—', cctMaisComum: '—', redIBS: Number(it?.redIBS) || 0, redCBS: Number(it?.redCBS) || 0,
          manuais: 0, regraGeral: 0, truncados: 0, invalidos: 0, ambiguos: 0,
          cstCont: new Map(), cctCont: new Map(),
        }
        mapa.set(chave, g)
      }
      g.qtdItens++
      g.base = round2(g.base + (Number(it?.vlTotal) || 0))
      g.trib = round2(g.trib + (Number(it?.totalTributos) || 0))
      const cst = String(it?.classificacao?.cst ?? '—') || '—'
      const cct = String(it?.classificacao?.cClassTrib ?? '—') || '—'
      g.cstCont.set(cst, (g.cstCont.get(cst) ?? 0) + 1)
      g.cctCont.set(cct, (g.cctCont.get(cct) ?? 0) + 1)
      if (it?.manual) g.manuais++
      if (it?.regraGeral) g.regraGeral++
      const r = it as { ncmTruncado?: boolean; ncmInvalido?: boolean; opcoesClassificacao?: number }
      if (r?.ncmTruncado) g.truncados++
      if (r?.ncmInvalido) g.invalidos++
      if (Number(r?.opcoesClassificacao ?? 1) > 1) g.ambiguos++
    }
  }
  return [...mapa.values()].map((g) => {
    const top = (m: Map<string, number>): string => {
      let best = '—'
      let bestN = -1
      for (const [k, v] of m) {
        if (v > bestN) {
          bestN = v
          best = k
        }
      }
      return best
    }
    return { ...g, cstMaisComum: top(g.cstCont), cctMaisComum: top(g.cctCont) }
  })
}

/**
 * Passa por TODO o RAG oficial para cada NCM distinto do filtro.
 * Best-effort por NCM: falha isolada vira alerta `info`, nunca exceção.
 */
export async function verificarCoerenciaRag(notas: NotaXml[]): Promise<VerificacaoRagNfe> {
  const em = new Date().toISOString()
  const grupos = agruparPorNcm(notas)
  const validos = grupos.filter((g) => g.norm.length === 8)
  const invalidos = grupos.filter((g) => g.norm.length !== 8)

  let itensRegraGeral = 0
  let itensManuais = 0
  let itensExtintos = 0
  let itensAmbiguos = 0
  for (const g of grupos) {
    itensRegraGeral += g.regraGeral
    itensManuais += g.manuais
    itensAmbiguos += g.ambiguos
  }

  const alertas: AlertaRagNfe[] = []
  let conformes = 0

  for (const g of invalidos) {
    alertas.push({
      ncm: g.ncm || '(sem NCM)',
      tipo: 'erro',
      mensagem: `${g.qtdItens} item(ns) com NCM inválido — fora da apuração confiável, confira o XML.`,
    })
  }

  // Verificação oficial NCM a NCM (limitada para não travar o relatório).
  const lote = validos.slice(0, 120)
  for (const g of lote) {
    try {
      const [resolvido, nomen] = await Promise.all([
        resolverClassificacoes(g.norm),
        buscarNomenclatura(g.norm).catch(() => null),
      ])
      if (resolvido.extinto) itensExtintos += g.qtdItens

      const oficial = resolvido.lista[0] ?? null
      const cstOf = String(oficial?.cst ?? '—')
      const cctOf = String(oficial?.cClassTrib ?? '—')
      const redOfIBS = Number(oficial?.resumo?.percentualReducaoIBS ?? 0) || 0
      const redOfCBS = Number(oficial?.resumo?.percentualReducaoCBS ?? 0) || 0

      let ok = true

      if (!nomen) {
        ok = false
        alertas.push({
          ncm: g.norm,
          tipo: 'erro',
          mensagem: 'Sem nomenclatura vigente (TEC) — NCM não homologado, tributação pela regra geral.',
        })
      }
      if (resolvido.extinto) {
        ok = false
        alertas.push({
          ncm: g.norm,
          tipo: 'erro',
          mensagem: 'NCM extinto na vigência — vínculo virou histórico, vale a regra geral.',
        })
      }
      if (resolvido.revogado) {
        ok = false
        alertas.push({
          ncm: g.norm,
          tipo: 'alerta',
          mensagem: `Enquadramento revogado (${resolvido.revogado.ato ?? 'curadoria'}) — rebaixado para a regra geral.`,
        })
      }
      if (!resolvido.manual && resolvido.regraGeral) {
        // Não é erro: é ausência de vínculo — informa sem afirmar benefício.
        ok = false
        alertas.push({
          ncm: g.norm,
          tipo: 'info',
          mensagem: `Sem vínculo específico na base oficial (${g.qtdItens} item(ns)) — regra geral CST ${cstOf}/cClassTrib ${cctOf}, alíquota cheia.`,
        })
      }
      if (resolvido.manual) {
        alertas.push({
          ncm: g.norm,
          tipo: 'info',
          mensagem: `Prevalece sua reclassificação manual em ${g.manuais || g.qtdItens} item(ns) — responsabilidade sua, isenta o sistema.`,
        })
      } else if (
        oficial &&
        (g.cstMaisComum !== cstOf || g.cctMaisComum !== cctOf) &&
        g.cstMaisComum !== '—'
      ) {
        ok = false
        alertas.push({
          ncm: g.norm,
          tipo: 'alerta',
          mensagem: `Itens em ${g.cstMaisComum}/${g.cctMaisComum}, mas a base vigente indica ${cstOf}/${cctOf} — use "Reaplicar vigentes".`,
        })
      } else if (
        oficial &&
        !resolvido.regraGeral &&
        (Number(g.redIBS) !== redOfIBS || Number(g.redCBS) !== redOfCBS)
      ) {
        ok = false
        alertas.push({
          ncm: g.norm,
          tipo: 'alerta',
          mensagem: `Redução nos itens (${Number(g.redIBS)}%/${Number(g.redCBS)}%) difere da vigente (${redOfIBS}%/${redOfCBS}%) — reaplique.`,
        })
      }
      if ((resolvido.vinculos?.length ?? 0) > 1 || g.ambiguos > 0) {
        alertas.push({
          ncm: g.norm,
          tipo: 'info',
          mensagem: `NCM com ${Math.max(resolvido.vinculos?.length ?? 0, 2)} enquadramentos — usada a 1ª opção como estimativa.`,
        })
      }
      if (ok) conformes++
    } catch {
      alertas.push({
        ncm: g.norm,
        tipo: 'info',
        mensagem: 'Não foi possível conferir este NCM no RAG agora — mantida a estimativa dos itens.',
      })
    }
  }

  // Ordena: erro → alerta → info; enxuga para o PDF (máx. 8).
  const peso = { erro: 0, alerta: 1, info: 2 } as const
  alertas.sort((a, b) => peso[a.tipo] - peso[b.tipo] || a.ncm.localeCompare(b.ncm))

  const ncmsVerificados = validos.length
  const taxaConformidade =
    ncmsVerificados > 0 ? Math.round((conformes / ncmsVerificados) * 1000) / 10 : null

  return {
    em,
    ncmsVerificados,
    ncmsConformes: conformes,
    taxaConformidade,
    itensRegraGeral,
    itensManuais,
    itensExtintos,
    itensAmbiguos,
    alertas: alertas.slice(0, 8),
    fontes: [...FONTES_RAG],
  }
}

/* -------------------------------------------------------- insights --- */

const fmtBRL = (v: number): string =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtPct1 = (v: number): string => `${(Number(v) || 0).toFixed(1).replace('.', ',')}%`

function pushUnico(lista: InsightNfe[], chave: string, titulo: string, texto: string, tom: InsightNfe['tom']): void {
  if (lista.some((i) => i.chave === chave)) return
  lista.push({ chave, titulo, texto, tom })
}

/**
 * Até 3 recados em linguagem simples, sempre a partir dos números do filtro.
 * Regras anti-alucinação:
 * - todo número citado é calculado do filtro (nada externo, nada projetado);
 * - sem promessa fiscal ("economize X") — só o fato + uma dica prática;
 * - sem termo técnico no texto (nada de CST, RAG, EFD, regime antigo…);
 * - no máximo 3, deduplicados por `chave`;
 * - vazio quando sem movimento.
 */
export function gerarInsightsNfe(
  notas: NotaXml[],
  ap: ApuracaoIbsCbs,
  ranking: CreditoFornecedor[],
  confronto: ConfrontoRegimesNfe,
): InsightNfe[] {
  void confronto
  const out: InsightNfe[] = []
  if (!notas?.length) return out

  const baseTotal = round2(ap.baseEntradas + ap.baseSaidas)

  // 1. Compras que não geram crédito (o que mais confunde no dia a dia).
  if (ap.bloqueadoTotal > 0.005) {
    pushUnico(
      out, 'sem-credito',
      'Parte das suas compras não gera crédito',
      `A Aurum AI encontrou ${fmtBRL(ap.bloqueadoTotal)} em ${ap.qtdEntradasBloqueadas} compra(s) feita(s) em lojas do Simples. Essas compras não geram crédito desse imposto. Se o preço for parecido, pode valer mais a pena comprar de loja comum.`,
      'alerta',
    )
  }

  // 2. Crédito concentrado numa loja só.
  const comuns = (ranking ?? []).filter((r) => !r.simples)
  const totalComum = comuns.reduce((s, r) => s + (Number(r.creditoTotal) || 0), 0)
  if (comuns.length && totalComum > 0) {
    const top = [...comuns].sort((a, b) => b.creditoTotal - a.creditoTotal)[0]
    const pct = (Number(top.creditoTotal) / totalComum) * 100
    if (pct >= 50) {
      pushUnico(
        out, 'credito-concentrado',
        'Quase todo o seu crédito vem de um lugar só',
        `A Aurum AI encontrou que a loja ${top.nome} responde por ${fmtBRL(top.creditoTotal)} (${fmtPct1(pct)} do seu crédito). Se ela atrasar uma entrega, seu crédito cai junto.`,
        'alerta',
      )
    }
  }

  // 3. Uma compra domina o período.
  if (out.length < 3) {
    let maior: NotaXml | null = null
    for (const n of notas) {
      if (!maior || Number(n?.valorTotal) > Number(maior?.valorTotal)) maior = n
    }
    if (maior && baseTotal > 0 && notas.length >= 3) {
      const pct = (Number(maior.valorTotal) / baseTotal) * 100
      if (pct >= 25) {
        pushUnico(
          out, 'compra-dominante',
          'Uma compra pesa mais que as outras',
          `A Aurum AI encontrou que a compra ${maior.numero || String(maior.chave).slice(-8)} da loja ${maior.emitNome}, de ${fmtBRL(maior.valorTotal)}, representa ${fmtPct1(pct)} de tudo. O resultado do período depende muito dela — vale conferir se está tudo certo nela.`,
          'info',
        )
      }
    }
  }

  return out.slice(0, 3)
}

/* ------------------------------------------------------ orquestra --- */

export interface PacoteRelatorioNfe {
  notas: NotaXml[]
  duplicadasIgnoradas: number
  apuracao: ApuracaoIbsCbs
  confronto: ConfrontoRegimesNfe
  /** Ranking recalculado do filtro (entradas, consistente com o PDF). */
  rankingEfetivo: CreditoFornecedor[]
  verificacao: VerificacaoRagNfe
  insights: InsightNfe[]
}

/** Recalcula o ranking a partir das notas do filtro (consistência total). */
export function rankingDoFiltro(notas: NotaXml[], limite = 10): CreditoFornecedor[] {
  const mapa = new Map<string, CreditoFornecedor>()
  for (const n of notas ?? []) {
    if (n?.direcao !== 'entrada') continue
    const cnpj = String(n.emitCnpj || '—')
    let atual = mapa.get(cnpj)
    if (!atual) {
      atual = {
        cnpj, nome: n.emitNome || cnpj, qtdNotas: 0,
        totalEntradas: 0, creditoIBS: 0, creditoCBS: 0, creditoTotal: 0, simples: false,
      }
      mapa.set(cnpj, atual)
    }
    const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
    if (regime === 'simples' || regime === 'mei') atual.simples = true
    atual.qtdNotas++
    atual.totalEntradas = round2(atual.totalEntradas + (Number(n.valorTotal) || 0))
    atual.creditoIBS = round2(atual.creditoIBS + (Number(n.totalIBS) || 0))
    atual.creditoCBS = round2(atual.creditoCBS + (Number(n.totalCBS) || 0))
    atual.creditoTotal = round2(atual.creditoTotal + (Number(n.totalTributos) || 0))
  }
  return [...mapa.values()].sort((a, b) => b.creditoTotal - a.creditoTotal).slice(0, limite)
}

/**
 * Prepara tudo que o PDF precisa — DEDUP + RAG + insights — ANTES de gerar.
 * A tela deve chamar esta função e só então `exportarNfePDF`, exibindo um
 * feedback ("Verificando RAG…") enquanto o RAG é percorrido.
 */
export async function prepararRelatorioNfeComIA(
  notasEntrada: NotaXml[],
  rankingGlobal?: CreditoFornecedor[],
): Promise<PacoteRelatorioNfe> {
  const { unicas, duplicadasIgnoradas } = dedupNotasPorChave(notasEntrada)
  const apuracao = apurarIbsCbs(unicas)
  const c = confrontoRegimes(unicas)
  const confronto: ConfrontoRegimesNfe = {
    antigo: c.antigo, novo: c.novo, icms: c.icms, pisCofins: c.pisCofins,
    ibs: c.ibs, cbs: c.cbs, delta: c.delta, variacaoPct: c.variacaoPct,
  }
  // Consistência: o ranking do relatório SEMPRE deriva do filtro atual.
  // O ranking global (por período) serve só como fallback quando o filtro
  // não tem entradas (ex.: só saídas) — nunca misturado.
  const doFiltro = rankingDoFiltro(unicas)
  const rankingEfetivo = doFiltro.length ? doFiltro : (rankingGlobal ?? [])

  let verificacao: VerificacaoRagNfe
  try {
    verificacao = await verificarCoerenciaRag(unicas)
  } catch {
    verificacao = {
      em: new Date().toISOString(),
      ncmsVerificados: 0, ncmsConformes: 0, taxaConformidade: null,
      itensRegraGeral: 0, itensManuais: 0, itensExtintos: 0, itensAmbiguos: 0,
      alertas: [], fontes: [...FONTES_RAG],
    }
  }
  const insights = gerarInsightsNfe(unicas, apuracao, rankingEfetivo, confronto)
  return { notas: unicas, duplicadasIgnoradas, apuracao, confronto, rankingEfetivo, verificacao, insights }
}
