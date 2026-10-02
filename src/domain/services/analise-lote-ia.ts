/**
 * Aurum AI — análise assistida do lote (nome + NCM = tributação provável).
 *
 * Papel: dar relevância à importação em lote sem alucinar.
 *
 * - A verdade tributária vem SEMPRE do resolvedor (`Classificacao[]` já
 *   resolvida): CST, cClassTrib, reduções, anexo, base legal, tipo de
 *   alíquota, diferimento, vigência. Nenhum número, artigo ou anexo é
 *   inventado — todo comentário é montado por template a partir desses
 *   campos (princípio anti-alucinação: sem cobertura oficial, sem afirmação).
 * - O `nome` da planilha NUNCA cria tributação: ele só *ordena* as opções
 *   oficiais por aderência textual (tokens do nome × texto oficial das
 *   opções) para sugerir a mais provável — escolha assistida, decisão final
 *   do usuário.
 * - Com 1 opção: confirma (ou alerta divergência nome × NCM).
 * - Com N opções: explica *por que* há N (comparando os campos oficiais que
 *   de fato diferem) + sugere a mais aderente ao nome + orienta a escolha.
 */
import { NOME_IA, nivelDeConfianca, type NivelConfiancaIa } from '@/domain/aurum-ai'
import { rotuloAnexoOficial } from '@/domain/constants/tributarios'
import type { Classificacao } from '@/domain/entities'
import { normalizarBusca, tokensRelevantes } from '@/domain/services/busca-texto'
import {
  ehDiferimento,
  ehDiferimentoCondicionalAnexoIX,
} from '@/domain/services/calculo'
import { casaToken, expandirSinonimoFiscal } from '@/domain/services/vocabulario'

export type SituacaoAnaliseLote =
  | 'invalida'
  | 'extinta'
  | 'manual'
  | 'regra-geral'
  | 'unica'
  | 'multipla'

export interface OpcaoAnalisada {
  /** Posição na `classificacoes` original (para o `select` / radio). */
  indice: number
  cst: string
  cClassTrib: string
  descricao: string
  redIBS: number
  redCBS: number
  anexo: string | null
  anexoRotulo: string | null
  baseLegal: string
  urlLegislacao: string | null
  tipoAliquota: string | null
  diferimento: 'efetivo' | 'condicional' | null
  /** Termos do nome que casaram com o texto oficial desta opção. */
  termosCasados: string[]
  scoreNome: number
  /** Comentário 100% embasado nos campos acima (sem artigo inventado). */
  comentario: string
}

export interface AnaliseLoteIA {
  situacao: SituacaoAnaliseLote
  totalOpcoes: number
  /** Índice (em `classificacoes`) que a IA sugere como mais provável. */
  maisProvavelIndice: number
  confianca: number
  nivel: NivelConfiancaIa
  titulo: string
  resumo: string
  /** Por que este NCM tem N tributações (só quando N > 1; grounded). */
  porqueMultiplas: string | null
  orientacaoEscolha: string
  alertas: string[]
  opcoes: OpcaoAnalisada[]
  fontes: string[]
  /** `true` quando o nome não conversa com o NCM — revisar o NCM. */
  divergenciaNome: boolean
  nomeIA: typeof NOME_IA
}

export interface EntradaAnaliseLote {
  nome: string
  ncm: string
  classificacoes: Classificacao[]
  regraGeral: boolean
  manual: boolean
  extinto: boolean
  /** Descrição oficial da nomenclatura (para o alerta nome × NCM). */
  nomenclaturaDescricao?: string | null
}

const FONTES_LOTE = [
  'Nomenclatura vigente (TEC) — descrição oficial do NCM',
  'Vínculos oficiais da Reforma (CST × cClassTrib) — base do sistema',
  'Referência CST × cClassTrib (reduções, anexo, base legal, tipo de alíquota)',
  'Vigência (NCM extinto · revogação CFF · reclassificação manual)',
  'Nome do produto na planilha (ajuda a ordenar as opções oficiais)',
] as const

/* ------------------------------------------------------------ scoring -- */

/** Tokens do nome expandidos com sinônimo fiscal (dia a dia → oficial). */
function tokensDoNome(nome: string): { originais: string[]; expandidos: Set<string> } {
  const originais = tokensRelevantes(nome)
  const expandidos = new Set<string>(originais)
  for (const t of originais) {
    const sin = expandirSinonimoFiscal(t)
    if (sin) {
      for (const s of sin.split(' ').filter(Boolean)) expandidos.add(s)
    }
  }
  return { originais, expandidos }
}

/** Texto oficial de UMA opção (tudo que a IA pode ler — nada fora da base). */
function textoOficialDaOpcao(c: Classificacao): string {
  return [
    c.resumo?.descricaoCClassTrib ?? '',
    c.descricao ?? '',
    c.vinculo?.descricao ?? '',
    c.cstDetalhes?.descricao ?? '',
    c.cstClassTribDetalhes?.nome ?? '',
    c.cstClassTribDetalhes?.descricao ?? '',
    c.baseLegal ?? '',
  ].join(' ')
}

function pontuarOpcaoPeloNome(
  tokens: Set<string>,
  originais: string[],
  opcao: Classificacao,
): { score: number; termos: string[] } {
  if (!originais.length) return { score: 0, termos: [] }
  const normCorpus = normalizarBusca(textoOficialDaOpcao(opcao))
  if (!normCorpus) return { score: 0, termos: [] }
  const toksCorpus = new Set(normCorpus.split(' ').filter(Boolean))
  const termos: string[] = []
  for (const q of originais) {
    if (toksCorpus.has(q)) {
      termos.push(q)
      continue
    }
    // Sinônimo expandido também conta quando aparece no oficial.
    const sin = expandirSinonimoFiscal(q)
    if (sin && sin.split(' ').some((s) => toksCorpus.has(s))) {
      termos.push(q)
      continue
    }
    for (const o of toksCorpus) {
      if (casaToken(q, o)) {
        termos.push(q)
        break
      }
    }
  }
  // +10 por termo casado; frase completa no oficial dá bônus de desempate.
  let score = termos.length * 10
  const frase = normalizarBusca(originais.join(' '))
  if (frase.length > 3 && normCorpus.includes(frase)) score += 5
  void tokens
  return { score, termos }
}

function diferimentoDe(c: Classificacao): 'efetivo' | 'condicional' | null {
  if (ehDiferimento(c)) return 'efetivo'
  if (ehDiferimentoCondicionalAnexoIX(c)) return 'condicional'
  return null
}

function rotuloDiferimento(d: 'efetivo' | 'condicional' | null): string | null {
  if (d === 'efetivo') return 'Diferimento efetivo (CST 510/515 — base oficial)'
  if (d === 'condicional') return 'Anexo IX condicional — diferimento só se a operação se enquadrar (art. 138, §2º — ver base legal)'
  return null
}

/** Comentário de UMA opção — template fixo, só com campos oficiais. */
function comentarOpcao(
  c: Classificacao,
  indice: number,
  termos: string[],
  nome: string,
  ehSugerida: boolean,
): { comentario: string; redIBS: number; redCBS: number; anexo: string | null; anexoRotulo: string | null } {
  const redIBS = Number(c.resumo?.percentualReducaoIBS ?? 0) || 0
  const redCBS = Number(c.resumo?.percentualReducaoCBS ?? 0) || 0
  const anexoRaw = String(c.resumo?.anexo ?? c.referencia?.anexo ?? '').trim()
  const anexo = anexoRaw ? anexoRaw : null
  const anexoRotulo = anexo ? rotuloAnexoOficial(anexo) : null
  const descricao = c.resumo?.descricaoCClassTrib || c.descricao || c.baseLegal || '—'
  const baseLegal = (c.baseLegal || c.cstClassTribDetalhes?.lcRef || 'LC 214/2025 — base oficial').slice(0, 220)
  const dif = diferimentoDe(c)
  const rotDif = rotuloDiferimento(dif)

  const partes: string[] = []
  partes.push(`Opção ${indice + 1}: CST ${c.cst || '—'} · cClassTrib ${c.cClassTrib || '—'} — ${descricao}.`)
  partes.push(`Redução ${fmtRed(redIBS)} IBS / ${fmtRed(redCBS)} CBS${anexo ? ` · ${anexoRotulo} (anexo oficial “${anexo}”)` : ' · sem anexo oficial na base'}.`)
  partes.push(`Base: ${baseLegal}.`)
  if (c.cstClassTribDetalhes?.tipoAliquota) {
    partes.push(`Tipo de alíquota (base oficial): ${c.cstClassTribDetalhes.tipoAliquota}.`)
  }
  if (rotDif) partes.push(`${rotDif}.`)
  if (c.referencia?.monofasica === true) partes.push('Sinal oficial de monofasia na referência CST × cClassTrib.')
  if (c.referencia?.creditoPresumido === true) partes.push('Sinal oficial de crédito presumido na referência CST × cClassTrib.')

  const nomeCurto = nome.trim().slice(0, 60)
  if (!nomeCurto) {
    partes.push('Sem nome na planilha para confrontar — mantida a ordem oficial.')
  } else if (termos.length) {
    partes.push(
      `${ehSugerida ? 'Conversa' : 'Também conversa'} com o nome “${nomeCurto}” em ${termos.length} termo(s): ${termos.join(', ')} (match no texto oficial da opção).`,
    )
  } else {
    partes.push(
      `Nenhum termo do nome “${nomeCurto}” aparece no texto oficial desta opção — não descartada (o NCM manda), apenas menos aderente ao nome informado.`,
    )
  }
  return { comentario: partes.join(' '), redIBS, redCBS, anexo, anexoRotulo }
}

function fmtRed(v: number): string {
  return `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
}

/* ------------------------------------------- por que N tributações? -- */

/**
 * Explica por que o NCM tem N opções — comparando SÓ os campos que de fato
 * diferem entre as opções oficiais (CST, cClassTrib, reduções, anexo, tipo
 * de alíquota, diferimento). Nada de artigo inferido por faixa.
 */
function explicarMultiplas(opcoes: Classificacao[]): string {
  const linhas = opcoes.map((c, i) => {
    const redIBS = Number(c.resumo?.percentualReducaoIBS ?? 0) || 0
    const redCBS = Number(c.resumo?.percentualReducaoCBS ?? 0) || 0
    const anexo = String(c.resumo?.anexo ?? c.referencia?.anexo ?? '').trim()
    return `(${i + 1}) CST ${c.cst || '—'}/${c.cClassTrib || '—'} — ${c.resumo?.descricaoCClassTrib || c.descricao || '—'} — redução ${fmtRed(redIBS)}/${fmtRed(redCBS)}${anexo ? ` — anexo oficial ${anexo}` : ''}`;
  })
  const diffs: string[] = []
  const u = (xs: unknown[]) => [...new Set(xs.map((x) => String(x ?? '—')))]
  const csts = u(opcoes.map((c) => c.cst))
  const ccts = u(opcoes.map((c) => c.cClassTrib))
  const reds = u(opcoes.map((c) => `${Number(c.resumo?.percentualReducaoIBS ?? 0) || 0}/${Number(c.resumo?.percentualReducaoCBS ?? 0) || 0}`))
  const anexos = u(opcoes.map((c) => String(c.resumo?.anexo ?? c.referencia?.anexo ?? '—').trim() || '—'))
  const tipos = u(opcoes.map((c) => String(c.cstClassTribDetalhes?.tipoAliquota ?? '—')))
  const difs = u(opcoes.map((c) => diferimentoDe(c) ?? 'sem-diferimento'))
  if (csts.length > 1) diffs.push(`CSTs distintos (${csts.join(' × ')})`)
  if (ccts.length > 1) diffs.push(`${ccts.length} cClassTribs distintos`)
  if (reds.length > 1) diffs.push(`reduções distintas de IBS/CBS (${reds.join(' × ')})`)
  if (anexos.length > 1) diffs.push(`anexos oficiais distintos (${anexos.join(' × ')})`)
  if (tipos.length > 1) diffs.push(`tipos de alíquota distintos (${tipos.join(' × ')})`)
  if (difs.length > 1) diffs.push('situações de diferimento distintas (efetivo × condicional × sem diferimento)')
  const diffTxt = diffs.length
    ? `A diferença está em: ${diffs.join('; ')}.`
    : 'Os enquadramentos diferem no detalhamento oficial (descrição/base legal) — confira cada base.'

  return (
    `Este NCM possui ${opcoes.length} vínculos oficiais distintos na base da Reforma (CST × cClassTrib) — ` +
    `por isso há ${opcoes.length} tributações possíveis, uma por enquadramento previsto para operações/produtos diferentes sob o mesmo NCM: ` +
    `${linhas.join('; ')}. ${diffTxt} ` +
    `Todas as opções vêm da base oficial do sistema; o nome da planilha só ajuda a ordenar.`
  )
}

/* ------------------------------------------------------------- entrada -- */

/** Alerta nome × NCM: o nome não conversa com a descrição oficial do NCM. */
function detectarDivergenciaNome(
  nome: string,
  nomenclaturaDescricao: string | null | undefined,
  opcoes: Classificacao[],
  melhorScore: number,
): boolean {
  const toks = tokensRelevantes(nome)
  if (toks.length < 2) return false
  if (melhorScore > 0) return false
  const alvo = [nomenclaturaDescricao ?? '', ...opcoes.map((c) => c.descricao ?? '')].join(' ')
  const normAlvo = normalizarBusca(alvo)
  if (!normAlvo) return true
  const toksAlvo = new Set(normAlvo.split(' ').filter(Boolean))
  for (const q of toks) {
    if (toksAlvo.has(q)) return false
    const sin = expandirSinonimoFiscal(q)
    if (sin && sin.split(' ').some((s) => toksAlvo.has(s))) return false
    for (const o of toksAlvo) {
      if (casaToken(q, o)) return false
    }
  }
  return true
}

/**
 * Análise assistida de UM item do lote (pura, síncrona, sem I/O).
 *
 * Ordem de prioridade (espelha o resolvedor):
 * inválida → extinta → manual → regra geral → única → múltipla.
 */
export function analisarItemLoteIA(entrada: EntradaAnaliseLote): AnaliseLoteIA {
  const { nome, ncm, classificacoes, regraGeral, manual, extinto } = entrada
  const nomenDesc = entrada.nomenclaturaDescricao ?? null
  const fontes = [...FONTES_LOTE]
  const nomeSeguro = String(nome ?? '').trim()

  if (String(ncm ?? '').replace(/\D/g, '').length !== 8) {
    return {
      situacao: 'invalida',
      totalOpcoes: 0,
      maisProvavelIndice: 0,
      confianca: 0,
      nivel: 'baixa',
      titulo: 'NCM inválido — sem tributação para sugerir',
      resumo: `A linha traz “${String(ncm || '—').slice(0, 20)}”, que não tem 8 dígitos — o motor nem entrou (política do lote). Corrija o NCM na planilha; o nome (“${nomeSeguro.slice(0, 60) || '—'}”) sozinho não classifica.`,
      porqueMultiplas: null,
      orientacaoEscolha: 'Corrija o NCM para 8 dígitos e reimporte a linha. Enquanto inválido, ela não salva como produto.',
      alertas: ['NCM fora do padrão de 8 dígitos — veredito do resolvedor: sem lista, sem regra geral.'],
      opcoes: [],
      fontes,
      divergenciaNome: false,
      nomeIA: NOME_IA,
    }
  }

  if (extinto) {
    return {
      situacao: 'extinta',
      totalOpcoes: classificacoes.length,
      maisProvavelIndice: 0,
      confianca: 0.35,
      nivel: 'baixa',
      titulo: 'NCM extinto — tributação abaixo é só referência histórica',
      resumo: `O NCM ${ncm} saiu da TEC vigente (Data_Fim preenchida). O vínculo/regra geral exibido é histórico: confira o NCM substituto na Resolução Gecex vigente antes de operar ou salvar.`,
      porqueMultiplas: classificacoes.length > 1 ? explicarMultiplas(classificacoes) : null,
      orientacaoEscolha: 'Não escriture por este NCM. Localize o NCM substituto e reimporte a linha com o código vigente.',
      alertas: ['NCM “negado” na tabela vigente — classificação antiga não vale como atual.'],
      opcoes: classificacoes.map((c, i) => {
        const { comentario, redIBS, redCBS, anexo, anexoRotulo } = comentarOpcao(c, i, [], nomeSeguro, i === 0)
        return {
          indice: i, cst: c.cst, cClassTrib: c.cClassTrib,
          descricao: c.resumo?.descricaoCClassTrib || c.descricao || '', redIBS, redCBS,
          anexo, anexoRotulo, baseLegal: c.baseLegal || '', urlLegislacao: c.resumo?.urlLegislacao ?? null,
          tipoAliquota: c.cstClassTribDetalhes?.tipoAliquota ?? null,
          diferimento: diferimentoDe(c), termosCasados: [], scoreNome: 0, comentario,
        }
      }),
      fontes,
      divergenciaNome: false,
      nomeIA: NOME_IA,
    }
  }

  if (manual || (classificacoes.length === 1 && classificacoes[0]?.manual != null)) {
    const c = classificacoes[0]
    return {
      situacao: 'manual',
      totalOpcoes: classificacoes.length,
      maisProvavelIndice: 0,
      confianca: 1,
      nivel: 'alta',
      titulo: 'Enquadramento manual seu — o sistema só aplicou',
      resumo: `Você já reclassificou o NCM ${ncm} manualmente (${c ? `CST ${c.cst}/${c.cClassTrib}` : '—'}). A ${NOME_IA} não disputa: vale a sua regra, com a sua fonte — responsabilidade sua, sinalizada em toda a tela.`,
      porqueMultiplas: null,
      orientacaoEscolha: 'Se a regra manual continua valendo, mantenha. Para voltar à base oficial, exclua a reclassificação manual e reimporte.',
      alertas: [],
      opcoes: c
        ? (() => {
            const { comentario, redIBS, redCBS, anexo, anexoRotulo } = comentarOpcao(c, 0, [], nomeSeguro, true)
            return [{
              indice: 0, cst: c.cst, cClassTrib: c.cClassTrib,
              descricao: c.resumo?.descricaoCClassTrib || c.descricao || '', redIBS, redCBS,
              anexo, anexoRotulo, baseLegal: c.baseLegal || '', urlLegislacao: c.resumo?.urlLegislacao ?? null,
              tipoAliquota: c.cstClassTribDetalhes?.tipoAliquota ?? null,
              diferimento: diferimentoDe(c), termosCasados: [], scoreNome: 0, comentario,
            }]
          })()
        : [],
      fontes,
      divergenciaNome: false,
      nomeIA: NOME_IA,
    }
  }

  if (regraGeral) {
    const c = classificacoes[0]
    const { originais } = tokensDoNome(nomeSeguro)
    const divergente = detectarDivergenciaNome(nomeSeguro, nomenDesc, classificacoes, 0)
    return {
      situacao: 'regra-geral',
      totalOpcoes: classificacoes.length,
      maisProvavelIndice: 0,
      confianca: divergente ? 0.5 : 0.8,
      nivel: nivelDeConfianca(divergente ? 0.5 : 0.8),
      titulo: 'Sem vínculo oficial — vale a regra geral (tributação integral)',
      resumo:
        `O NCM ${ncm} não tem vínculo específico CST × cClassTrib na base oficial — HOJE vale a regra geral CST 000/cClassTrib 000001 (alíquota cheia, redução 0%). ` +
        (c ? `Leitura oficial: ${c.resumo?.descricaoCClassTrib || c.descricao || 'tributação integral'}.` : '') +
        (originais.length ? ` O nome (“${nomeSeguro.slice(0, 60)}”) foi confrontado e não criou nenhum enquadramento novo.` : ''),
      porqueMultiplas: null,
      orientacaoEscolha:
        'Escriture pela regra geral. Se você conhece uma regra específica com fonte legal, use “Reclassificar manualmente” informando descrição + link — aí a linha passa a valer como manual (responsabilidade sua).',
      alertas: divergente
        ? [`O nome “${nomeSeguro.slice(0, 60)}” não conversa com a descrição oficial do NCM — o NCM manda na tributação: confira se o NCM está correto antes de salvar.`]
        : [],
      opcoes: c
        ? (() => {
            const { comentario, redIBS, redCBS, anexo, anexoRotulo } = comentarOpcao(c, 0, [], nomeSeguro, true)
            return [{
              indice: 0, cst: c.cst, cClassTrib: c.cClassTrib,
              descricao: c.resumo?.descricaoCClassTrib || c.descricao || '', redIBS, redCBS,
              anexo, anexoRotulo, baseLegal: c.baseLegal || '', urlLegislacao: c.resumo?.urlLegislacao ?? null,
              tipoAliquota: c.cstClassTribDetalhes?.tipoAliquota ?? null,
              diferimento: diferimentoDe(c), termosCasados: [], scoreNome: 0, comentario,
            }]
          })()
        : [],
      fontes,
      divergenciaNome: divergente,
      nomeIA: NOME_IA,
    }
  }

  // ---- 1 ou N vínculos oficiais: nome ordena, base decide ----
  const { originais, expandidos } = tokensDoNome(nomeSeguro)
  const pontuadas = classificacoes.map((c, i) => {
    const { score, termos } = pontuarOpcaoPeloNome(expandidos, originais, c)
    return { c, i, score, termos }
  })
  const ordenadas = [...pontuadas].sort((a, b) => b.score - a.score || a.i - b.i)
  const topo = ordenadas[0]
  const segunda = ordenadas[1]
  const gap = topo && segunda ? topo.score - segunda.score : topo ? topo.score : 0
  const melhorScore = topo?.score ?? 0
  const divergente = detectarDivergenciaNome(nomeSeguro, nomenDesc, classificacoes, melhorScore)

  const opcoes: OpcaoAnalisada[] = pontuadas.map(({ c, i, score, termos }) => {
    const ehSugerida = topo ? i === topo.i : i === 0
    const { comentario, redIBS, redCBS, anexo, anexoRotulo } = comentarOpcao(c, i, termos, nomeSeguro, ehSugerida)
    return {
      indice: i, cst: c.cst, cClassTrib: c.cClassTrib,
      descricao: c.resumo?.descricaoCClassTrib || c.descricao || '', redIBS, redCBS,
      anexo, anexoRotulo, baseLegal: c.baseLegal || '', urlLegislacao: c.resumo?.urlLegislacao ?? null,
      tipoAliquota: c.cstClassTribDetalhes?.tipoAliquota ?? null,
      diferimento: diferimentoDe(c), termosCasados: termos, scoreNome: score, comentario,
    }
  })

  if (classificacoes.length === 1 && topo) {
    const alertas: string[] = []
    if (divergente) {
      alertas.push(
        `O nome “${nomeSeguro.slice(0, 60)}” não conversa com a descrição oficial do NCM — o NCM manda na tributação: confira se o NCM está correto antes de salvar. A tributação única abaixo continua valendo.`,
      )
    }
    const conf = !nomeSeguro ? 0.9 : divergente ? 0.6 : topo.score > 0 ? 0.95 : 0.85
    return {
      situacao: 'unica',
      totalOpcoes: 1,
      maisProvavelIndice: 0,
      confianca: conf,
      nivel: nivelDeConfianca(conf),
      titulo: 'Tributação única oficial — conferida pelo nome',
      resumo:
        `O NCM ${ncm} tem 1 vínculo oficial na base (${topo.c.cst}/${topo.c.cClassTrib} — ${topo.c.resumo?.descricaoCClassTrib || topo.c.descricao || '—'}). ` +
        (topo.termos.length
          ? `O nome confirma: ${topo.termos.length} termo(s) casaram (${topo.termos.join(', ')}). Pode salvar.`
          : nomeSeguro
            ? 'O nome não trouxe termos que batam na descrição oficial — o que é normal (nome comercial × texto legal). O vínculo único continua valendo.'
            : 'Sem nome na planilha para confrontar — o vínculo único vale pela base oficial.'),
      porqueMultiplas: null,
      orientacaoEscolha: 'Tributação única: nenhuma escolha a fazer. Confira a base legal no cartão e salve.',
      alertas,
      opcoes,
      fontes,
      divergenciaNome: divergente,
      nomeIA: NOME_IA,
    }
  }

  // ---- múltiplas ----
  const sugerida = topo?.i ?? 0
  let confianca: number
  let resumo: string
  let orientacao: string
  if (!originais.length) {
    confianca = 0.35
    resumo =
      `O NCM ${ncm} tem ${classificacoes.length} tributações oficiais possíveis e a linha veio sem nome para confrontar — ` +
      `a ${NOME_IA} manteve a ordem oficial (CST/cClassTrib crescente) como sugestão inicial. Abra cada opção e escolha pela operação real.`
    orientacao = 'Sem nome, sem desempate: leia cada base legal abaixo e escolha a que descreve a sua operação. A decisão final é sua.'
  } else if (gap >= 10) {
    confianca = 0.85
    const top = opcoes[sugerida]
    resumo =
      `O NCM ${ncm} tem ${classificacoes.length} tributações oficiais possíveis. ` +
      `Pelo nome (“${nomeSeguro.slice(0, 60)}”), a mais provável é a Opção ${sugerida + 1} (CST ${top.cst}/${top.cClassTrib}) — ` +
      `${top.termosCasados.length} termo(s) casaram (${top.termosCasados.join(', ')}), contra ${segunda?.score ? `${Math.round((segunda.score) / 10)} termo(s) na segunda colocada` : 'nenhum termo nas demais'}. Já deixei ela pré-selecionada, mas confira a base legal antes de salvar.`
    orientacao = `Sugestão da ${NOME_IA}: Opção ${sugerida + 1} (maior aderência ao nome). Se a sua operação for outra, troque — a escolha final é sua e fica registrada na linha.`
  } else if (gap > 0) {
    confianca = 0.6
    const top = opcoes[sugerida]
    resumo =
      `O NCM ${ncm} tem ${classificacoes.length} tributações oficiais possíveis e o nome (“${nomeSeguro.slice(0, 60)}”) dá vantagem pequena à Opção ${sugerida + 1} ` +
      `(CST ${top.cst}/${top.cClassTrib} — ${top.termosCasados.join(', ') || 'aderência parcial'}). Vale conferir as demais antes de salvar.`
    orientacao = `Sugestão fraca da ${NOME_IA}: Opção ${sugerida + 1} à frente por pouco. Compare as bases legais abaixo — em caso de dúvida, prevalece a operação real, não o nome.`
  } else {
    confianca = 0.35
    resumo =
      `O NCM ${ncm} tem ${classificacoes.length} tributações oficiais possíveis e o nome (“${nomeSeguro.slice(0, 60)}”) não desempatou ` +
      `(empate ou nenhum termo no texto oficial). Mantive a ordem oficial como ponto de partida — a escolha precisa da sua conferência.`
    orientacao = `Empate técnico: a ${NOME_IA} não chutou — manteve a ordem oficial. Leia cada comentário (redução, anexo, base legal) e escolha pela operação real.`
  }

  const alertas: string[] = []
  if (divergente) {
    alertas.push(
      `Atenção: nenhum termo do nome (“${nomeSeguro.slice(0, 60)}”) aparece nos textos oficiais deste NCM — o NCM manda na tributação. Confira se o NCM está correto; se estiver, escolha pela operação real.`,
    )
  }

  return {
    situacao: 'multipla',
    totalOpcoes: classificacoes.length,
    maisProvavelIndice: sugerida,
    confianca,
    nivel: nivelDeConfianca(confianca),
    titulo:
      gap >= 10
        ? `Mais provável: Opção ${sugerida + 1} — confira e confirme`
        : 'Mais de uma tributação oficial — escolha assistida',
    resumo,
    porqueMultiplas: explicarMultiplas(classificacoes),
    orientacaoEscolha: orientacao,
    alertas,
    opcoes,
    fontes,
    divergenciaNome: divergente,
    nomeIA: NOME_IA,
  }
}
