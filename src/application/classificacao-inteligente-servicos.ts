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
  consultasTolerantesServicos,
  expandirConsultasServicos,
  expandirSinonimoServicos,
  perguntasComplementaresServicos,
  rotuloSetorServico,
  semJuridiques,
  temLastroServico,
  type ConfiancaServico,
  type EntradaDescricaoServico,
} from '@/domain/services/classificador-descricao-servicos'
import { fmtNbs, norm } from '@/domain/services/format'
import {
  buscarNbsPorTexto,
  resolverClassificacoesNbs,
  sugerirNbs,
  tituloNbs,
  type ResultadoBuscaTextoNbs,
} from '@/infrastructure/base/classificacao-repo'
import { buscarNoDicionarioServicos } from '@/domain/constants/dicionario-servicos'
import { obterContextoNbs } from '@/domain/constants/contexto-nbs'
import { db } from '@/infrastructure/db/schema'
import { temMarcadorExterno } from '@/domain/services/escopo-consulta'

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
  /**
   * Predição informativa por nomes/sinônimos (fine-tuning NBS v2).
   * Preenchida quando o fluxo oficial dá regra geral ou vazio, MAS há
   * lastro nos termos do sistema. Cada item tem `apenasInformativo: true`
   * — a UI exibe como sugestão a verificar, NUNCA como decisão final.
   */
  sugestoesPreditivas?: import('@/domain/services/preditivo-servicos').SugestaoPreditivaServico[]
  /**
   * Contexto personalizado do NBS sugerido (resumo, aplica/não-aplica,
   * condições) — alimenta a descrição preditiva na UI.
   */
  contextoNbs?: import('@/domain/constants/contexto-nbs').ContextoNbsView | null
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
  // Barreira anti-alucinação com lastro de serviços: marcador externo
  // ("teste", "receita de bolo"...) SÓ recusa quando NÃO há termo do sistema
  // de serviços — "teste de software" tem lastro e segue o fluxo normal.
  // (O `detectarForaDeEscopo` de bens aceitaria "receita de bolo" por causa
  // de "bolo"→pastelaria; aqui vale o lastro de SERVIÇOS.)
  if (temMarcadorExterno(textoPedido) && !temLastroServico(textoPedido)) {
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
    // Insuficiente NUNCA volta de mãos vazias: tenta pin comercial (ex.:
    // "dentista", "show") e predição informativa antes de pedir contexto.
    const pinsInsuf = buscarNoDicionarioServicos(textoPedido).slice(0, 3)
    for (const pin of pinsInsuf) {
      try {
        const r = await resolverClassificacoesNbs(pin.nbs)
        if (!r.regraGeral && r.lista.length) {
          const principal = r.lista[0]
          const tipo = montarTipoExcecaoNbs(principal)
          trilha.push({
            etapa: 'Dicionário de serviços',
            detalhe: `pin curado “${pin.termo}” → ${fmtNbs(pin.nbs)} (${principal.cst}/${principal.cClassTrib}) — palavra única, confiança baixa, a verificar`,
          })
          return {
            nbs_provavel: fmtNbs(pin.nbs),
            descricao_nbs: principal.descricao || tipo.tipo,
            excecao_enquadravel: true,
            tipo_excecao: tipo.tipo,
            justificativa:
              `Pelo nome popular “${pin.termo}”, o NBS correspondente é ${fmtNbs(pin.nbs)} — "${principal.descricao || ''}", vínculo oficial ${principal.cst}/${principal.cClassTrib}${tipo.anexo ? `, Anexo LC 214 ${tipo.anexo}` : ''}. ` +
              `Como foi só 1 palavra, trate como pista (confiança baixa): confirme com 1–2 detalhes${analise.ambiguidades.length ? ` — atenção: ${analise.ambiguidades.join(' ')}` : ''}`,
            confianca: 'baixa',
            alternativas: [],
            cst: principal.cst ?? null,
            cClassTrib: principal.cClassTrib ?? null,
            anexo: tipo.anexo,
            baseLegal: tipo.baseLegal,
            urlLegislacao: tipo.url,
            perguntasComplementares: perguntas,
            trilha,
            contextoNbs: obterContextoNbs(pin.nbs),
          }
        }
      } catch {
        /* pin sem vínculo na base atual: segue para preditivas */
      }
    }
    let preditivasInsuf: import('@/domain/services/preditivo-servicos').SugestaoPreditivaServico[] = []
    try {
      const { sugerirPreditivoServicos } = await import('@/domain/services/preditivo-servicos')
      preditivasInsuf = await sugerirPreditivoServicos(textoPedido, { limite: 3 })
    } catch {
      preditivasInsuf = []
    }
    const setorInsuf = rotuloSetorServico(analise.sinais)
    return {
      nbs_provavel: null,
      descricao_nbs: null,
      excecao_enquadravel: false,
      tipo_excecao: null,
      justificativa:
        preditivasInsuf.length
          ? `Ainda não tenho o suficiente para cravar o NBS — mas pelos nomes do sistema há ${preditivasInsuf.length} pista(s) informativa(s) abaixo (não é decisão final). ${setorInsuf ? `Identifiquei o setor de ${setorInsuf}. ` : ''}Me diga mais 1 ou 2 características para eu fechar: é aula, consulta, show, atendimento? Presencial ou online? Para quem?`
          : `Ainda não tenho o suficiente para classificar com segurança — e prefiro pedir mais detalhes a chutar um NBS.${setorInsuf ? ` Identifiquei o setor de ${setorInsuf}.` : ''} Descreva o serviço com 1 ou 2 características: é aula, consulta, show, atendimento? Presencial ou online? Para quem (pessoa física, empresa, exterior)?`,
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: perguntas,
      trilha: [...trilha, { etapa: 'Validação de contexto', detalhe: `entrada insuficiente${setorInsuf ? ` (setor: ${setorInsuf})` : ''} — solicitadas informações complementares` }],
      sugestoesPreditivas: preditivasInsuf,
    }
  }

  const agregados = new Map<string, ResultadoBuscaTextoNbs & { score: number }>()
  async function agregar(consultas: string[], opts?: { filtrarJuridiques?: boolean }): Promise<void> {
    for (const consulta of consultas) {
      // Filtro anti-falso-benefício: consulta só de juridiquês ("servico",
      // "fornecimento") casava os 112 NBS e elegia o Anexo X à toa.
      let efetiva = consulta
      if (opts?.filtrarJuridiques !== false) {
        const nucleo = semJuridiques(consulta.split(' ').filter(Boolean))
        if (!nucleo.length) continue
        efetiva = nucleo.join(' ')
      }
      // RAG estrito aqui (precisão); a tolerância entra na última bala.
      const achados = await buscarNbsPorTexto(efetiva, 30, { tolerante: false })
      for (const item of achados) {
        const atual = agregados.get(item.codigo)
        if (!atual || item.score > atual.score) agregados.set(item.codigo, { ...item })
      }
    }
  }
  await agregar(analise.consultasExpandidas)
  // Dicionário comercial de serviços (nomes populares → NBS exato).
  // Roda ANTES das tolerâncias: pin curado supera o lexical por construção
  // (conhecimento > inferência — ex.: "formacao de condutores" não pode
  // perder para o falso amigo "formacao"⊂"informacao"). Cada código passa
  // pelo resolvedor — pin sem vínculo na base atual morre aqui.
  if (!agregados.size) {
    const pins = buscarNoDicionarioServicos(textoPedido).slice(0, 6)
    const pinsAplicados: string[] = []
    for (const pin of pins) {
      try {
        const vinc = await db.nbs.where('codigo').equals(pin.nbs).first()
        if (!vinc) continue
        const valid = await resolverClassificacoesNbs(pin.nbs)
        if (valid.regraGeral || !valid.lista.length) continue
        const scorePin = 500 + pin.termo.length
        const atual = agregados.get(pin.nbs)
        if (!atual || scorePin > atual.score) {
          agregados.set(pin.nbs, {
            codigo: vinc.codigo,
            codigoFormatado: fmtNbs(vinc.codigo),
            titulo: tituloNbs(vinc),
            descricao: vinc.descricao,
            documentos: vinc.documentos ?? '',
            totalClassificacoes: valid.lista.length,
            score: scorePin,
          })
          pinsAplicados.push(`“${pin.termo}” → ${fmtNbs(pin.nbs)}`)
        }
      } catch {
        /* pin sem base: segue sem ele */
      }
    }
    if (pinsAplicados.length) {
      trilha.push({ etapa: 'Dicionário de serviços', detalhe: pinsAplicados.join(' · ') })
    }
  }
  // Tolerância a ruído: nenhum match → tenta sem 1 termo por vez
  // (ex.: "online" não existe no juridiquês oficial e bloqueava o AND).
  if (!agregados.size) {
    const tol = consultasTolerantesServicos(analise.consultasExpandidas)
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
  // match continua vazio (sem lastro, sem chute). Mínimo ≥3 (antes ≥4
  // descartava "spa", "bar", "taxi", "app", "show").
  if (!agregados.size) {
    const unigramas: string[] = []
    for (const t of analise.tokens) {
      const exp = expandirSinonimoServicos(t) ?? t
      if (!unigramas.includes(exp)) unigramas.push(exp)
    }
    await agregar(semJuridiques(unigramas).filter((u) => u.length >= 3), { filtrarJuridiques: false })
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
  // Última rede de segurança: RAG tolerante (OR ponderado com radical/fuzzy)
  // sobre original + expandida + unigramas. O determinístico usava SÓ AND —
  // qualquer ruído ("online", "delivery") zerava tudo.
  if (!agregados.size) {
    const todasConsultas = [
      ...analise.consultasExpandidas,
      ...analise.tokens.map((t) => expandirSinonimoServicos(t) ?? t),
    ]
    const unicas = [...new Set(todasConsultas)].filter(Boolean)
    for (const consulta of unicas) {
      const nucleo = semJuridiques(consulta.split(' ').filter(Boolean))
      if (!nucleo.length) continue
      const achados = await buscarNbsPorTexto(nucleo.join(' '), 30, { tolerante: true })
      for (const item of achados) {
        const atual = agregados.get(item.codigo)
        if (!atual || item.score > atual.score) agregados.set(item.codigo, { ...item })
      }
      if (agregados.size >= 12) break
    }
    if (agregados.size) {
      trilha.push({ etapa: 'RAG tolerante', detalhe: 'match obtido no OR ponderado (radical/fuzzy) — confiança segue o cálculo padrão' })
    }
  }

  const ranckeados = [...agregados.values()]
    .sort((a, b) => b.score - a.score || a.codigo.localeCompare(b.codigo))
    .slice(0, Math.max(1, limiteCandidatos))

  trilha.push({
    etapa: 'Candidatos (base NBS)',
    detalhe: ranckeados.length
      ? ranckeados.map((c) => `${fmtNbs(c.codigo)} (${c.score})`).join(' · ')
      : `nenhum match na base NBS${rotuloSetorServico(analise.sinais) ? ` (setor detectado: ${rotuloSetorServico(analise.sinais)})` : ' (sem setor detectado)'}`,
  })

  if (!ranckeados.length) {
    // Predição informativa: mesmo sem match estrito, tenta nomes/sinônimos
    // contra os termos do sistema (NBS + referência). Se houver lastro,
    // sugere a título informativo — nunca como decisão final.
    let preditivas: import('@/domain/services/preditivo-servicos').SugestaoPreditivaServico[] = []
    try {
      const { sugerirPreditivoServicos } = await import('@/domain/services/preditivo-servicos')
      preditivas = await sugerirPreditivoServicos(textoPedido, { limite: 3 })
      if (preditivas.length) {
        trilha.push({
          etapa: 'Predição informativa (nomes/sinônimos)',
          detalhe: `sem match estrito, mas há lastro nos termos do sistema: ${preditivas.map((p) => `${p.codigoFormatado} (${p.cobertura * 100}% cobertura)`).join(' · ')} — apenas informativo`,
        })
      }
    } catch {
      preditivas = []
    }
    const setor = rotuloSetorServico(analise.sinais)
    const hipoteses = preditivas.filter((p) => p.tipo === 'hipotese-cct')
    const primeiraHipotese = hipoteses[0]
    // Sem contradição: se há hipótese de benefício, ela LIDERA a resposta
    // (antes o texto dizia "sem benefício" e mostrava a hipótese abaixo).
    let justificativa: string
    if (primeiraHipotese) {
      const red = Math.max(primeiraHipotese.reducaoIBS, primeiraHipotese.reducaoCBS)
      const condicao = primeiraHipotese.contexto?.condicoes[0] ?? ''
      justificativa =
        `Não há NBS vinculado para essa atividade — mas encontrei hipótese de benefício na legislação: ${primeiraHipotese.titulo} ` +
        `(${primeiraHipotese.cst}/${primeiraHipotese.cClassTrib}, redução de ${red}%).` +
        `${condicao ? ` Condição: ${condicao}.` : ''}` +
        `${setor ? ` Setor identificado: ${setor}.` : ''} ` +
        `É pista informativa (não decisão final) — confirme com o contador antes de escriturar.`
    } else {
      const orientacaoSetor = setor
        ? ` Identifiquei o setor de ${setor}: na base atual da Reforma não há NBS/benefício mapeado para ele — vale tributação integral (regra geral), sem exceção enquadrável. Se a operação tiver alguma condição especial (tomador no exterior, produção nacional, sócio brasileiro), me diga que eu reavalio.`
        : ''
      const justificativaBase =
        'Não encontrei nenhum NBS da base pelo caminho estrito — e prefiro dizer isso claramente a inventar um código.'
      justificativa = preditivas.length
        ? `${justificativaBase}${orientacaoSetor} Porém, pelos NOMES/SINÔNIMOS do sistema, há ${preditivas.length} pista(s) informativa(s) abaixo (não é decisão final — confirme com o contador e classifique oficialmente).`
        : `${justificativaBase}${orientacaoSetor} Tente de outro jeito: informe o tipo de serviço (aula, consulta, show, atendimento?), o tomador e se é presencial ou remoto.`
    }
    return {
      nbs_provavel: null,
      descricao_nbs: null,
      excecao_enquadravel: false,
      tipo_excecao: primeiraHipotese ? `${primeiraHipotese.titulo} (${primeiraHipotese.cst}/${primeiraHipotese.cClassTrib}) — hipótese a verificar` : null,
      justificativa,
      confianca: 'baixa',
      alternativas: [],
      cst: null,
      cClassTrib: null,
      anexo: null,
      baseLegal: null,
      urlLegislacao: null,
      perguntasComplementares: [...perguntas, 'Informe o tipo de serviço e o tomador (pessoa física, empresa, exterior?).'],
      trilha,
      sugestoesPreditivas: preditivas,
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

  // Predição informativa quando cai em regra geral (sem vínculo) ou a
  // confiança não é alta: compara nomes/sinônimos com os termos do sistema
  // e sugere pistas — sempre como informativo, nunca decisão final.
  let preditivasFinais: import('@/domain/services/preditivo-servicos').SugestaoPreditivaServico[] = []
  if (!temVinculo || confianca !== 'alta') {
    try {
      const { sugerirPreditivoServicos } = await import('@/domain/services/preditivo-servicos')
      // Evita sugerir o próprio topo como "preditivo" (já é a decisão oficial).
      const todas = await sugerirPreditivoServicos(textoPedido, { limite: 4 })
      preditivasFinais = todas.filter((p) => p.codigoFormatado !== codigoFmt).slice(0, 3)
      if (preditivasFinais.length) {
        trilha.push({
          etapa: 'Predição informativa (nomes/sinônimos)',
          detalhe: `${temVinculo ? 'confiança não-alta' : 'sem vínculo oficial'} — pistas pelos termos do sistema: ${preditivasFinais.map((p) => `${p.codigoFormatado} (${p.cobertura * 100}%)`).join(' · ')} — apenas informativo`,
        })
        if (!temVinculo) {
          justificativa += ` Pistas informativas pelos nomes do sistema (não são decisão final): ${preditivasFinais.map((p) => `${p.codigoFormatado} — ${p.titulo}`).join('; ')}. Confirme com o contador.`
        }
      }
    } catch {
      preditivasFinais = []
    }
  }

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
    sugestoesPreditivas: preditivasFinais,
    contextoNbs: obterContextoNbs(topo.cand.codigo),
  }
}
