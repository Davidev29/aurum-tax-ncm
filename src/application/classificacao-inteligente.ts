/**
 * Classificação inteligente por descrição livre — etapa 2 (orquestração).
 *
 * Pipeline (chain-of-thought do prompt, auditável em `trilha`):
 * 1. análise da descrição → `analisarDescricao` (pura);
 * 2. candidatos NCM → busca textual oficial sobre a nomenclatura vigente
 *    (somente códigos que EXISTEM na base; nunca inventa NCM);
 * 3. verificação de exceções → `resolverClassificacoes` (join 3NF oficial);
 *    exceção só existe se houver vínculo com benefício real na base;
 * 4. validação de contexto (destinação/composição/uso) + condições de risco;
 * 5. confiança + alternativas + perguntas complementares.
 *
 * Saída no formato JSON pedido (campos `ncm_provavel…alternativas`) mais
 * ancoragem oficial (`cst`, `cClassTrib`, `anexo`, `baseLegal`,
 * `urlLegislacao`) e diagnóstico (`perguntasComplementares`, `trilha`).
 */
import { REGRA_GERAL } from '@/domain/constants'
import type { Classificacao } from '@/domain/entities'
import {
  analisarDescricao,
  calcularConfianca,
  consultasEfetivas,
  consultasTolerantes,
  perguntasComplementares,
  type Confianca,
  type EntradaDescricao,
} from '@/domain/services/classificador-descricao'
import { fmtNcm, norm } from '@/domain/services/format'
import {
  buscarNomenclatura,
  buscarNomenclaturaPorTexto,
  resolverClassificacoes,
  sugerirNomenclatura,
  type ResultadoBuscaTexto,
} from '@/infrastructure/base/classificacao-repo'
import { buscarNoDicionarioComercial } from '@/domain/constants/dicionario-comercial'
import { pareceCodigoNcm } from '@/domain/services/busca-texto'
import { detectarForaDeEscopo, MENSAGEM_FORA_DE_ESCOPO } from '@/domain/services/escopo-consulta'
import { db } from '@/infrastructure/db/schema'

/**
 * NCM parcial digitado como texto ("0406", "10.05", "2309.10"): 2–7 dígitos,
 * só dígitos/pontuação, sem letras. Retorna os dígitos ou `null`.
 */
export function hipoteseNcmParcial(descricao: unknown): string | null {
  const cru = String(descricao ?? '')
  if (!cru.trim() || !pareceCodigoNcm(cru)) return null
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cru)) return null
  const dig = norm(cru)
  if (dig.length >= 2 && dig.length <= 7) return dig
  return null
}

async function sugerirNomenclaturaPrefixo(prefixo: string, limite = 5) {
  try {
    const lista = await sugerirNomenclatura(prefixo, limite)
    return lista.filter((n) => !n.dataFim).slice(0, limite)
  } catch {
    return []
  }
}

export type { EntradaDescricao, Confianca }

export interface EtapaTrilha {
  etapa: string
  detalhe: string
}

export interface SugestaoNcmJson {
  ncm_provavel: string | null
  descricao_ncm: string | null
  excecao_enquadravel: boolean
  tipo_excecao: string | null
  justificativa: string
  confianca: Confianca
  alternativas: string[]
  /** Ancoragem oficial (base Deus) — extras além do JSON pedido. */
  cst: string | null
  cClassTrib: string | null
  anexo: string | null
  baseLegal: string | null
  urlLegislacao: string | null
  perguntasComplementares: string[]
  trilha: EtapaTrilha[]
  /**
   * Pedido fora do escopo do sistema (conhecimento geral, tarefas externas,
   * jailbreak…). Quando `true`, a `justificativa` é a mensagem fixa de
   * escopo e a UI exibe o cartão de recusa — sem worker, sem chute.
   */
  foraDeEscopo?: boolean
}

/** Bônus de desempate quando o capítulo do candidato é prioritário. */
const BONUS_CAPITULO = 40
/** Penalidade para NCM extinto (histórico: só aparece se nada vigente servir). */
const PENALIDADE_EXTINTO = 1000

interface CandidatoRanckeado {
  item: ResultadoBuscaTexto
  score: number
  capitulos: string
}

function capituloDe(codigo: string): string {
  return codigo.replace(/\D+/g, '').slice(0, 2)
}

/** Rótulo curto de benefício por cClassTrib (fallback; primária é a base). */
const ROTULO_CURTO_CCT: Record<string, string> = {
  '200003': 'Cesta Básica Nacional',
  '200009': 'Medicamento',
  '200014': 'Hortícolas, frutas e ovos',
  '200030': 'Dispositivo médico',
  '200004': 'Dispositivo médico',
  '200005': 'Dispositivo médico (adm. pública)',
  '200034': 'Alimento para consumo humano',
  '200038': 'Insumo agropecuário',
}

/** Dígito → romano para apresentar o anexo oficial (I–XV). */
const ANEXO_ROMANO: Record<string, string> = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI',
  '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII',
  '13': 'XIII', '14': 'XIV', '15': 'XV',
}

/**
 * Anexo a partir do nome do cClassTrib quando a referência não o informa
 * (ex.: nome "…(Anexo VII)" → "VII"). Nunca inventa: só extrai do texto oficial.
 */
function extrairAnexoDoNome(...fontes: (string | null | undefined)[]): string | null {
  for (const f of fontes) {
    const m = /Anexo\s+([IVX]+|\d{1,2})/i.exec(f ?? '')
    if (m) {
      const cru = m[1].toUpperCase()
      if (ANEXO_ROMANO[cru]) return ANEXO_ROMANO[cru]
      const romano = Object.entries(ANEXO_ROMANO).find(([, r]) => r === cru)?.[1]
      if (romano) return romano
    }
  }
  return null
}

function extrairArtigo(...fontes: (string | null | undefined)[]): string | null {
  for (const f of fontes) {
    const m = /Art\.\s*(\d+)(?:\s*,\s*§\s*\d+º?)?(?:\s*,?\s*(I{1,3}|\d+º?))?/i.exec(f ?? '')
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }
  return null
}

/** Monta `tipo_excecao` a partir do vínculo oficial (nunca inventado). */
function montarTipoExcecao(cl: Classificacao): { tipo: string; anexo: string | null; baseLegal: string | null; url: string | null } {
  const cct = cl.cstClassTribDetalhes
  const oficial = cl.resumo.anexo && /^\d+$/.test(cl.resumo.anexo)
    ? ANEXO_ROMANO[cl.resumo.anexo] ?? cl.resumo.anexo
    : cl.resumo.anexo
  const anexo = oficial ?? extrairAnexoDoNome(cct?.nome, cct?.descricao, cl.resumo.descricaoCClassTrib)
  const reducao = Math.max(cl.resumo.percentualReducaoIBS ?? 0, cl.resumo.percentualReducaoCBS ?? 0)
  const curto = ROTULO_CURTO_CCT[cl.cClassTrib] ?? cl.resumo.descricaoCClassTrib ?? `cClassTrib ${cl.cClassTrib}`
  const artigo = extrairArtigo(cct?.lcRef, cct?.lcRedacao, cl.baseLegal) ?? 'LC 214/2025'
  const efeito = reducao >= 100 ? 'alíquota zero' : `redução de ${reducao}%`
  const tipo = anexo
    ? `${curto} – Anexo ${anexo} (${artigo}, ${efeito})`
    : `${curto} (${artigo}, ${efeito})`
  return { tipo, anexo, baseLegal: cct?.lcRef || cl.baseLegal || null, url: cl.resumo.urlLegislacao ?? null }
}

/**
 * Classifica uma descrição livre e retorna o JSON de sugestão ancorado na
 * base oficial. `limiteCandidatos` limita o custo do join 3NF por candidato.
 */
export async function classificarPorDescricao(
  entrada: EntradaDescricao,
  limiteCandidatos = 12,
): Promise<SugestaoNcmJson> {
  // Barreira anti-alucinação (primeira coisa): pedido fora do escopo do
  // sistema NÃO é classificado, NÃO acorda worker e NÃO ganha chute —
  // retorna a mensagem fixa de escopo. Sem lastro fiscal + com marcador
  // externo, qualquer "resposta" seria invenção.
  const textoPedido = [entrada.descricao, entrada.destinacao ?? '', entrada.composicao ?? '', entrada.uso ?? ''].join(' ').trim()
  if (detectarForaDeEscopo(textoPedido)) {
    return {
      ncm_provavel: null,
      descricao_ncm: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa: MENSAGEM_FORA_DE_ESCOPO,
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: [],
      trilha: [{ etapa: 'Escopo', detalhe: 'pedido fora do âmbito de classificação de NCM — recusa fixa, sem consulta à base' }],
      foraDeEscopo: true,
    }
  }
  // Hipótese de NCM parcial (2–7 dígitos): a entrada JÁ é um começo de
  // código, não uma descrição. Retorna os filhos vigentes como alternativas
  // navegáveis em vez de NÃO SEI seco — autonomia sem inventar NCM.
  const parcial = hipoteseNcmParcial(entrada.descricao)
  if (parcial) {
    const sugestoes = await sugerirNomenclaturaPrefixo(parcial, 5)
    const analiseParcial = analisarDescricao(entrada)
    const trilhaParcial: EtapaTrilha[] = [
      { etapa: 'Análise da descrição', detalhe: `NCM parcial "${parcial}" (${parcial.length} dígitos) — hipótese de capítulo/posição` },
      { etapa: 'RGIs aplicadas', detalhe: analiseParcial.rgiAplicaveis.join(' · ') },
    ]
    if (sugestoes.length) {
      const alts = sugestoes.map((s) => fmtNcm(s.codigo))
      return {
        ncm_provavel: null,
        descricao_ncm: `${sugestoes.length} NCM(s) começando por ${parcial} (ex.: ${sugestoes[0].descricao})`,
        excecao_enquadravel: false,
        tipo_excecao: null,
        justificativa: `NCM incompleto (${parcial.length}/8 dígitos): refine até 8 dígitos para classificar. Abaixo, os primeiros NCMs vigentes com esse prefixo — toque para classificar oficialmente.`,
        confianca: 'baixa',
        alternativas: alts,
        cst: null,
        cClassTrib: null,
        anexo: null,
        baseLegal: null,
        urlLegislacao: null,
        perguntasComplementares: ['Complete os 8 dígitos do NCM (ex.: escolha uma alternativa abaixo).'],
        trilha: [...trilhaParcial, { etapa: 'Candidatos (prefixo vigente)', detalhe: alts.join(' · ') }],
      }
    }
  }
  const analise = analisarDescricao(entrada)
  const trilha: EtapaTrilha[] = [
    { etapa: 'Análise da descrição', detalhe: `tokens úteis: ${analise.tokens.join(', ') || '—'} · sinais: ${analise.sinais.join(', ') || '—'}` },
    { etapa: 'RGIs aplicadas', detalhe: analise.rgiAplicaveis.join(' · ') },
  ]

  const perguntas = perguntasComplementares(analise)
  if (analise.insuficiente) {
    return {
      ncm_provavel: null,
      descricao_ncm: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa:
        'Ainda não tenho o suficiente para classificar com segurança — e prefiro pedir mais detalhes a chutar um NCM. Me diga mais 1 ou 2 características do produto: é vivo ou abatido? Para plantio, consumo ou ração? De que material é feito (algodão, aço, plástico)? Quanto mais específico, melhor a resposta.',
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: perguntas,
      trilha: [...trilha, { etapa: 'Validação de contexto', detalhe: 'entrada insuficiente — solicitadas informações complementares' }],
    }
  }

  // Etapa 2 — candidatos: agrega resultados de cada consulta efetiva.
  // ESTRITO aqui (`tolerante: false`): match fraco não pode virar "alta".
  // A tolerância do determinístico é só via `consultasTolerantes` (drop-1 com
  // trilha auditável). O RAG tolerante (fuzzy/OR) vive no fallback IA + Por nome.
  const agregados = new Map<string, CandidatoRanckeado>()
  const efetivas = consultasEfetivas(analise)
  async function agregar(consultas: string[]): Promise<void> {
    for (const consulta of consultas) {
      const achados = await buscarNomenclaturaPorTexto(consulta, 30, { tolerante: false })
      for (const item of achados) {
        let score = item.score
        if (analise.capitulosPrioritarios.includes(capituloDe(item.codigo))) score += BONUS_CAPITULO
        if (item.dataFim) score -= PENALIDADE_EXTINTO
        const atual = agregados.get(item.codigo)
        if (!atual || score > atual.score) {
          agregados.set(item.codigo, { item, score, capitulos: analise.capitulosPrioritarios.join(',') || '—' })
        }
      }
    }
  }
  await agregar(efetivas)
  // Tolerância a ruído: nenhum match → tenta sem 1 termo por vez
  // (ex.: "raça" não existe no texto oficial e bloqueava o AND).
  if (!agregados.size) {
    const tol = consultasTolerantes(efetivas)
    await agregar(tol.consultas)
    if (agregados.size && tol.ignorados.length) {
      trilha.push({
        etapa: 'Tolerância a ruído',
        detalhe: `match obtido ignorando termos sem correspondente oficial (ex.: ${tol.ignorados.slice(0, 3).join(', ')})`,
      })
    }
  }
  // Etapa 2b — dicionário comercial (nomes populares → NCM exato).
  // Cobre o que o léxico oficial jamais contém ("parmesão" ∉ TEC). O pin
  // curado supera o lexical por construção (conhecimento > inferência), mas a
  // confiança continua gated por `calcularConfianca` e cada código passa pelo
  // resolvedor abaixo — pin errado/extinto morre na validação.
  const acertosDict = buscarNoDicionarioComercial(analise.textoNormalizado).slice(0, 6)
  const pinsAplicados: string[] = []
  for (const acerto of acertosDict) {
    const scoreDict = 500 + acerto.termo.length
    const atual = agregados.get(acerto.ncm)
    if (atual) {
      // O léxico pode já ter o código (ex.: "queijo" casa no caminho): o pin
      // curado SOBE o score em vez de ser ignorado (conhecimento > inferência).
      if (scoreDict > atual.score) {
        agregados.set(acerto.ncm, { ...atual, score: scoreDict })
        pinsAplicados.push(`“${acerto.termo}” → ${fmtNcm(acerto.ncm)}`)
      }
      continue
    }
    const nom = await buscarNomenclatura(acerto.ncm)
    if (!nom || nom.dataFim) continue
    const item: ResultadoBuscaTexto = {
      ...nom,
      caminho: [],
      caminhoTexto: nom.descricao,
      totalClassificacoes: 0,
      score: scoreDict,
    }
    agregados.set(acerto.ncm, { item, score: item.score, capitulos: analise.capitulosPrioritarios.join(',') || '—' })
    pinsAplicados.push(`“${acerto.termo}” → ${fmtNcm(acerto.ncm)}`)
  }
  if (pinsAplicados.length) {
    trilha.push({ etapa: 'Dicionário comercial', detalhe: pinsAplicados.join(' · ') })
  }
  const ranckeados = [...agregados.values()]
    .sort((a, b) => {
      const vig = Number(Boolean(a.item.dataFim)) - Number(Boolean(b.item.dataFim))
      if (vig !== 0) return vig
      return b.score - a.score
    })
    .slice(0, Math.max(1, limiteCandidatos))

  trilha.push({
    etapa: 'Candidatos (nomenclatura vigente)',
    detalhe: ranckeados.length
      ? ranckeados.map((c) => `${fmtNcm(c.item.codigo)} (${c.score})`).join(' · ')
      : 'nenhum match na nomenclatura vigente',
  })

  if (!ranckeados.length) {
    return {
      ncm_provavel: null,
      descricao_ncm: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa:
        'Não encontrei nenhum NCM da nomenclatura vigente que corresponda a essa descrição — e prefiro dizer isso claramente a inventar um código. Tente de outro jeito: use sinônimos do vocabulário oficial (ex.: "bovino" em vez de "boi", "semeadura" em vez de "plantio"), informe a espécie, o estado (fresco, congelado, cozido?) ou o uso (consumo, plantio, ração?).',
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: [...perguntas, 'Informe sinônimos ou características físicas do produto (espécie, estado, uso).'],
      trilha,
    }
  }

  // Etapa 3 — verificação de exceções (join oficial por candidato).
  const resolvidos: { cand: CandidatoRanckeado; lista: Classificacao[]; regraGeral: boolean }[] = []
  for (const cand of ranckeados) {
    const r = await resolverClassificacoes(cand.item.codigo)
    resolvidos.push({ cand, lista: r.lista, regraGeral: r.regraGeral })
  }
  const comBeneficio = resolvidos.filter((r) => !r.regraGeral)
  trilha.push({
    etapa: 'Verificação de exceções (base da Reforma)',
    detalhe: resolvidos
      .map((r) =>
        r.regraGeral
          ? `${fmtNcm(r.cand.item.codigo)}: sem vínculo → regra geral ${REGRA_GERAL.cst}/${REGRA_GERAL.cClassTrib}`
          : `${fmtNcm(r.cand.item.codigo)}: ${r.lista.map((c) => `${c.cst}/${c.cClassTrib}`).join(', ')}`,
      )
      .join(' · '),
  })

  // Escolha: melhor score textual; vínculo oficial enriquece, não filtra.
  // (Um NCM vigente sem vínculo é resposta válida: tributação integral.)
  const [topo, segundo] = resolvidos
  const margem = segundo ? topo.cand.score - segundo.cand.score : 999
  const principal = topo.lista[0]
  const temVinculo = !topo.regraGeral
  const temRisco = analise.ambiguidades.length > 0
  const confianca = calcularConfianca({
    totalCandidatos: resolvidos.length,
    margemTopo: margem,
    tokensUteis: analise.tokens.length,
    temCondicaoRisco: temRisco,
  })

  const codigoFmt = fmtNcm(topo.cand.item.codigo)
  const descricaoNcm = topo.cand.item.descricao || principal.descricao || ''
  const caminho = topo.cand.item.caminho?.length ? ` (${topo.cand.item.caminho.join(' › ')})` : ''

  let excecao = false
  let tipoExcecao: string | null = null
  let anexo: string | null = null
  let baseLegal: string | null = null
  let url: string | null = null
  let justificativa: string

  if (temVinculo) {
    // Se houver mais de um vínculo (ex.: milho 1005.10.00 em dois anexos),
    // cita todos — a escolha do cClassTrib depende da operação real.
    const tipos = topo.lista.map(montarTipoExcecao)
    const primeiro = tipos[0]
    excecao = true
    tipoExcecao = tipos.length > 1
      ? `${primeiro.tipo} (+${tipos.length - 1} enquadramento(s) alternativo(s): ${tipos.slice(1).map((t) => t.tipo).join('; ')})`
      : primeiro.tipo
    anexo = primeiro.anexo
    baseLegal = primeiro.baseLegal
    url = primeiro.url
    justificativa =
      `Posição ${codigoFmt} — "${descricaoNcm}"${caminho}, pela ${analise.rgiAplicaveis.join(' + ')}. ` +
      `Vínculo oficial ${principal.cst}/${principal.cClassTrib} (${principal.resumo.descricaoCClassTrib})` +
      `${anexo ? `, Anexo ${anexo}` : ''}${baseLegal ? `, ${baseLegal}` : ''}.`
  } else {
    justificativa =
      `Posição ${codigoFmt} — "${descricaoNcm}"${caminho}, pela ${analise.rgiAplicaveis.join(' + ')}. ` +
      `Sem vínculo específico na base da Reforma: tributação integral (CST ${REGRA_GERAL.cst}/cClassTrib ${REGRA_GERAL.cClassTrib}), sem exceção enquadrável.`
  }
  if (temRisco) justificativa += ` Atenção: ${analise.ambiguidades.join(' ')}`
  if (comBeneficio.length > 1 && !temVinculo) {
    // Nunca ocorre (topo sem vínculo), mantido como guarda explícita.
    justificativa += ''
  }

  const alternativas = resolvidos.slice(1, 4).map((r) => fmtNcm(r.cand.item.codigo))

  trilha.push({
    etapa: 'Validação de contexto',
    detalhe: [
      `destinação/uso: ${(entrada.destinacao ?? entrada.uso ?? '').trim() || 'não informada'}`,
      `composição: ${(entrada.composicao ?? '').trim() || 'não informada'}`,
      temRisco ? `condição de risco: ${analise.ambiguidades.join(' ')}` : 'sem condição de risco',
      `confiança: ${confianca} (candidatos: ${resolvidos.length}, margem do topo: ${margem})`,
    ].join(' · '),
  })

  return {
    ncm_provavel: codigoFmt,
    descricao_ncm: descricaoNcm,
    excecao_enquadravel: excecao,
    tipo_excecao: tipoExcecao,
    justificativa,
    confianca,
    alternativas,
    cst: principal.cst ?? null,
    cClassTrib: principal.cClassTrib ?? null,
    anexo,
    baseLegal,
    urlLegislacao: url,
    perguntasComplementares: confianca === 'alta' && !temRisco ? [] : perguntas,
    trilha,
  }
}

/**
 * Detalhe auxiliar da base para a UI instrutiva: quantos vínculos cada
 * cClassTrib com benefício possui (para "saber instruir" sem hardcode).
 */
export async function resumoBeneficios(): Promise<{ cClassTrib: string; nome: string; totalNcm: number }[]> {
  const vinculos = await db.ncm.toArray().catch(() => [])
  const contagem = new Map<string, number>()
  for (const v of vinculos) contagem.set(v.cClassTrib, (contagem.get(v.cClassTrib) ?? 0) + 1)
  const ccts = await db.cstClassTrib.toArray().catch(() => [])
  return [...contagem.entries()]
    .map(([cClassTrib, totalNcm]) => ({
      cClassTrib,
      nome: ccts.find((c) => c.cClassTrib === cClassTrib)?.nome ?? '',
      totalNcm,
    }))
    .sort((a, b) => b.totalNcm - a.totalNcm)
}
