/**
 * Classificação inteligente de SERVIÇOS por descrição livre — etapa 2 (Phase 7).
 *
 * Espelho de `./classificacao-inteligente` para bens. Pipeline auditável:
 * 1. análise da descrição → `analisarDescricaoServico` (pura);
 * 2. candidatos NBS → busca textual oficial (somente códigos que EXISTEM;
 *    nunca inventa NBS);
 * 3. verificação → `resolverClassificacoesNbs` (join 3NF oficial);
 * 4. risco (Anexo X destinação, Anexo XI sócio, tomador exterior);
 * 5. confiança + alternativas + perguntas complementares.
 */
import { REGRA_GERAL_NBS } from '@/domain/constants'
import type { Classificacao } from '@/domain/entities'
import {
  analisarDescricaoServico,
  calcularConfiancaServicos,
  expandirConsultasServicos,
  expandirSinonimoServicos,
  perguntasComplementaresServicos,
  type ConfiancaServico,
  type EntradaDescricaoServico,
} from '@/domain/services/classificador-descricao-servicos'
import { consultasTolerantes } from '@/domain/services/classificador-descricao'
import { fmtNbs, norm } from '@/domain/services/format'
import {
  buscarNbsPorTexto,
  resolverClassificacoesNbs,
  sugerirNbs,
  tituloNbs,
  type ResultadoBuscaTextoNbs,
} from '@/infrastructure/base/classificacao-repo'
import { detectarForaDeEscopo } from '@/domain/services/escopo-consulta'

export type { EntradaDescricaoServico, ConfiancaServico }

export interface EtapaTrilhaServico {
  etapa: string
  detalhe: string
}

export interface SugestaoNbsJson {
  nbs_provavel: string | null
  descricao_nbs: string | null
  excecao_enquadravel: boolean
  tipo_excecao: string | null
  justificativa: string
  confianca: ConfiancaServico
  alternativas: string[]
  cst: string | null
  cClassTrib: string | null
  anexo: string | null
  baseLegal: string | null
  urlLegislacao: string | null
  perguntasComplementares: string[]
  trilha: EtapaTrilhaServico[]
  foraDeEscopo?: boolean
}

export const MENSAGEM_FORA_DE_ESCOPO_SERVICOS =
  'Caro usuário, fui treinada e projetada para lhe atender no âmbito de classificação de serviços (NBS) e atividades (CNAE), porém coisas externas ao sistema não tenho permissão e nem suporte para responder. Obrigado pela atenção.'

/** NBS parcial digitado como texto (2–8 dígitos, só dígitos/pontuação). */
export function hipoteseNbsParcial(descricao: unknown): string | null {
  const cru = String(descricao ?? '')
  if (!cru.trim()) return null
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cru)) return null
  if (!/^[\d.\s/-]+$/.test(cru.trim())) return null
  const dig = norm(cru)
  if (dig.length >= 2 && dig.length <= 8) return dig
  return null
}

const ANEXO_ROMANO: Record<string, string> = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI',
  '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII',
  '13': 'XIII', '14': 'XIV', '15': 'XV',
}

function montarTipoExcecaoNbs(cl: Classificacao): { tipo: string; anexo: string | null; baseLegal: string | null; url: string | null } {
  const oficial = cl.resumo.anexo && /^\d+$/.test(cl.resumo.anexo)
    ? ANEXO_ROMANO[cl.resumo.anexo] ?? cl.resumo.anexo
    : cl.resumo.anexo
  const reducao = Math.max(cl.resumo.percentualReducaoIBS ?? 0, cl.resumo.percentualReducaoCBS ?? 0)
  const curto = cl.resumo.descricaoCClassTrib || `cClassTrib ${cl.cClassTrib}`
  const efeito = reducao >= 100 ? 'alíquota zero' : `redução de ${reducao}%`
  const base = cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || 'LC 214/2025'
  const tipo = oficial ? `${curto} – Anexo LC 214 ${oficial} (${base}, ${efeito})` : `${curto} (${base}, ${efeito})`
  return { tipo, anexo: oficial, baseLegal: cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || null, url: cl.resumo.urlLegislacao ?? null }
}

export async function classificarServicoPorDescricao(
  entrada: EntradaDescricaoServico,
  limiteCandidatos = 12,
): Promise<SugestaoNbsJson> {
  const textoPedido = [entrada.descricao, entrada.tomador ?? '', entrada.local ?? '', entrada.uso ?? ''].join(' ').trim()
  if (detectarForaDeEscopo(textoPedido)) {
    return {
      nbs_provavel: null,
      descricao_nbs: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa: MENSAGEM_FORA_DE_ESCOPO_SERVICOS,
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: [],
      trilha: [{ etapa: 'Escopo', detalhe: 'pedido fora do âmbito de serviços — recusa fixa, sem consulta à base' }],
      foraDeEscopo: true,
    }
  }

  const parcial = hipoteseNbsParcial(entrada.descricao)
  if (parcial) {
    const sugestoes = await sugerirNbs(parcial, 5).catch(() => [])
    if (sugestoes.length) {
      const alts = sugestoes.map((s) => fmtNbs(s.codigo))
      return {
        nbs_provavel: null,
        descricao_nbs: `${sugestoes.length} NBS(s) começando por ${parcial} (ex.: ${tituloNbs(sugestoes[0])})`,
        excecao_enquadravel: false,
        tipo_excecao: null,
        justificativa: `NBS incompleto (${parcial.length}/9 dígitos): refine até 9 dígitos para classificar. Abaixo, os primeiros NBS com esse prefixo — toque para classificar oficialmente.`,
        confianca: 'baixa',
        alternativas: alts,
        cst: null,
        cClassTrib: null,
        anexo: null,
        baseLegal: null,
        urlLegislacao: null,
        perguntasComplementares: ['Complete os 9 dígitos do NBS (ex.: escolha uma alternativa abaixo).'],
        trilha: [
          { etapa: 'Análise da descrição', detalhe: `NBS parcial "${parcial}" (${parcial.length} dígitos)` },
          { etapa: 'Candidatos (prefixo)', detalhe: alts.join(' · ') },
        ],
      }
    }
  }

  const analise = analisarDescricaoServico(entrada)
  const trilha: EtapaTrilhaServico[] = [
    { etapa: 'Análise da descrição', detalhe: `tokens úteis: ${analise.tokens.join(', ') || '—'} · sinais: ${analise.sinais.join(', ') || '—'}` },
  ]

  const perguntas = perguntasComplementaresServicos(analise)
  if (analise.insuficiente) {
    return {
      nbs_provavel: null,
      descricao_nbs: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa:
        'Ainda não tenho o suficiente para classificar com segurança — e prefiro pedir mais detalhes a chutar um NBS. Descreva o serviço com 1 ou 2 características: é aula, consulta, show, atendimento? Presencial ou online? Para quem (pessoa física, empresa, exterior)?',
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

  const agregados = new Map<string, ResultadoBuscaTextoNbs & { score: number }>()
  async function agregar(consultas: string[]): Promise<void> {
    for (const consulta of consultas) {
      const achados = await buscarNbsPorTexto(consulta, 30, { tolerante: false })
      for (const item of achados) {
        const atual = agregados.get(item.codigo)
        if (!atual || item.score > atual.score) agregados.set(item.codigo, { ...item })
      }
    }
  }
  await agregar(analise.consultasExpandidas)
  // Tolerância a ruído: nenhum match → tenta sem 1 termo por vez
  // (ex.: "online" não existe no juridiquês oficial e bloqueava o AND).
  if (!agregados.size) {
    const tol = consultasTolerantes(analise.consultasExpandidas)
    await agregar(tol.consultas)
    if (agregados.size && tol.ignorados.length) {
      trilha.push({
        etapa: 'Tolerância a ruído',
        detalhe: `match obtido ignorando termos sem correspondente oficial (ex.: ${tol.ignorados.slice(0, 3).join(', ')})`,
      })
    }
  }
  // Última bala lexical: cada termo útil expandido sozinho. O corpus NBS é
  // juridiquês pobre ("fornecimento dos serviços de…") — descrições reais
  // trazem 2+ termos sem correspondente ("aula", "online"). Unigrama sem
  // match continua vazio (sem lastro, sem chute).
  if (!agregados.size) {
    const unigramas: string[] = []
    for (const t of analise.tokens) {
      const exp = expandirSinonimoServicos(t) ?? t
      if (!unigramas.includes(exp)) unigramas.push(exp)
    }
    await agregar(unigramas.filter((u) => u.length >= 4))
    if (agregados.size) {
      trilha.push({ etapa: 'Unigrama', detalhe: 'match obtido em termo isolado — confiança segue o cálculo padrão' })
    }
  }
  if (!agregados.size) {
    const nucleo = expandirConsultasServicos([...analise.tokens].sort((a, b) => b.length - a.length).slice(0, 2))
    if (nucleo.length) {
      await agregar(nucleo)
      if (agregados.size) {
        trilha.push({ etapa: 'Núcleo forte', detalhe: `match obtido no núcleo específico (“${nucleo.join('” / “')}”)` })
      }
    }
  }

  const ranckeados = [...agregados.values()]
    .sort((a, b) => b.score - a.score || a.codigo.localeCompare(b.codigo))
    .slice(0, Math.max(1, limiteCandidatos))

  trilha.push({
    etapa: 'Candidatos (base NBS)',
    detalhe: ranckeados.length
      ? ranckeados.map((c) => `${fmtNbs(c.codigo)} (${c.score})`).join(' · ')
      : 'nenhum match na base NBS',
  })

  if (!ranckeados.length) {
    return {
      nbs_provavel: null,
      descricao_nbs: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa:
        'Não encontrei nenhum NBS da base que corresponda a essa descrição — e prefiro dizer isso claramente a inventar um código. Tente de outro jeito: informe o tipo de serviço (aula, consulta, show, atendimento?), o tomador e se é presencial ou remoto.',
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: [...perguntas, 'Informe o tipo de serviço e o tomador (pessoa física, empresa, exterior?).'],
      trilha,
    }
  }

  const resolvidos: { cand: ResultadoBuscaTextoNbs & { score: number }; lista: Classificacao[]; regraGeral: boolean }[] = []
  for (const cand of ranckeados) {
    const r = await resolverClassificacoesNbs(cand.codigo)
    resolvidos.push({ cand, lista: r.lista, regraGeral: r.regraGeral })
  }
  trilha.push({
    etapa: 'Verificação de exceções (base da Reforma)',
    detalhe: resolvidos
      .map((r) =>
        r.regraGeral
          ? `${fmtNbs(r.cand.codigo)}: sem vínculo → regra geral ${REGRA_GERAL_NBS.cst}/${REGRA_GERAL_NBS.cClassTrib}`
          : `${fmtNbs(r.cand.codigo)}: ${r.lista.map((c) => `${c.cst}/${c.cClassTrib}`).join(', ')}`,
      )
      .join(' · '),
  })

  const [topo, segundo] = resolvidos
  const margem = segundo ? topo.cand.score - segundo.cand.score : 999
  const principal = topo.lista[0]
  const temVinculo = !topo.regraGeral
  const temRisco = analise.ambiguidades.length > 0
  const confianca = calcularConfiancaServicos({
    totalCandidatos: resolvidos.length,
    margemTopo: margem,
    tokensUteis: analise.tokens.length,
    temCondicaoRisco: temRisco,
  })

  const codigoFmt = fmtNbs(topo.cand.codigo)
  let excecao = false
  let tipoExcecao: string | null = null
  let anexo: string | null = null
  let baseLegal: string | null = null
  let url: string | null = null
  let justificativa: string

  if (temVinculo) {
    const tipos = topo.lista.map(montarTipoExcecaoNbs)
    const primeiro = tipos[0]
    excecao = true
    tipoExcecao = tipos.length > 1
      ? `${primeiro.tipo} (+${tipos.length - 1} enquadramento(s) alternativo(s): ${tipos.slice(1).map((t) => t.tipo).join('; ')})`
      : primeiro.tipo
    anexo = primeiro.anexo
    baseLegal = primeiro.baseLegal
    url = primeiro.url
    justificativa =
      `NBS ${codigoFmt} — "${topo.cand.titulo}". ` +
      `Vínculo oficial ${principal.cst}/${principal.cClassTrib} (${principal.resumo.descricaoCClassTrib})` +
      `${anexo ? `, Anexo LC 214 ${anexo}` : ''}${baseLegal ? `, ${baseLegal}` : ''}.`
  } else {
    justificativa =
      `NBS ${codigoFmt} — "${topo.cand.titulo}". ` +
      `Sem vínculo específico na base da Reforma: tributação integral (CST ${REGRA_GERAL_NBS.cst}/cClassTrib ${REGRA_GERAL_NBS.cClassTrib}), sem exceção enquadrável.`
  }
  if (temRisco) justificativa += ` Atenção: ${analise.ambiguidades.join(' ')}`

  const alternativas = resolvidos.slice(1, 4).map((r) => fmtNbs(r.cand.codigo))

  trilha.push({
    etapa: 'Validação de contexto',
    detalhe: [
      `tomador/local: ${(entrada.tomador ?? entrada.local ?? '').trim() || 'não informado'}`,
      temRisco ? `condição de risco: ${analise.ambiguidades.join(' ')}` : 'sem condição de risco',
      `confiança: ${confianca} (candidatos: ${resolvidos.length}, margem do topo: ${margem})`,
    ].join(' · '),
  })

  return {
    nbs_provavel: codigoFmt,
    descricao_nbs: topo.cand.titulo,
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
