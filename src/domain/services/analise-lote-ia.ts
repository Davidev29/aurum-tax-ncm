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
 * - Com 1 vínculo oficial: confirma e fixa o oficial (o NCM manda), mas com
 *   a integral de segurança como ALTERNATIVA trocável — a finalidade e a
 *   descrição da planilha podem não dar lastro ao benefício; sem aderência
 *   do nome ao texto oficial, emite alerta para conferir.
 * - Com N vínculos (incluindo diferimento): NUNCA fixa benefício — sugere a
 *   integral de segurança e orienta a escolha (comparando os campos oficiais
 *   que de fato diferem). Decisão final do usuário.
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
  /** Índice (em `classificacoes`) que a busca sugere como mais provável. */
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
  /** Mantido por compatibilidade — sempre `false` (alerta nome × NCM removido). */
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
  /** Descrição oficial da nomenclatura (mantida por compatibilidade — sem uso). */
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

/** Texto oficial de UMA opção (tudo que a busca pode ler — nada fora da base). */
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

  // Fallback integral multi-opção: última opção de segurança, nunca sugerida
  // como provável pelo nome — vale quando o produto não atende a nenhuma
  // qualificação com benefício.
  if (c.integralFallback) {
    return {
      comentario:
        `Opção ${indice + 1}: CST ${c.cst || '—'} · cClassTrib ${c.cClassTrib || '—'} — ${descricao}. ` +
        `Opção de segurança (tributação integral, alíquota cheia, sem redução): ` +
        `use quando o produto NÃO atender a nenhuma qualificação com benefício ` +
        `(propósito, descrição, destinação ou composição). Base: ${baseLegal}.`,
      redIBS, redCBS, anexo, anexoRotulo,
    }
  }

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
  const oficiais = opcoes.filter((c) => !c.integralFallback)
  const temFallback = opcoes.some((c) => c.integralFallback)
  const base = oficiais.length ? oficiais : opcoes
  const linhas = base.map((c, i) => {
    const redIBS = Number(c.resumo?.percentualReducaoIBS ?? 0) || 0
    const redCBS = Number(c.resumo?.percentualReducaoCBS ?? 0) || 0
    const anexo = String(c.resumo?.anexo ?? c.referencia?.anexo ?? '').trim()
    return `(${i + 1}) CST ${c.cst || '—'}/${c.cClassTrib || '—'} — ${c.resumo?.descricaoCClassTrib || c.descricao || '—'} — redução ${fmtRed(redIBS)}/${fmtRed(redCBS)}${anexo ? ` — anexo oficial ${anexo}` : ''}`;
  })
  const diffs: string[] = []
  const u = (xs: unknown[]) => [...new Set(xs.map((x) => String(x ?? '—')))]
  const csts = u(base.map((c) => c.cst))
  const ccts = u(base.map((c) => c.cClassTrib))
  const reds = u(base.map((c) => `${Number(c.resumo?.percentualReducaoIBS ?? 0) || 0}/${Number(c.resumo?.percentualReducaoCBS ?? 0) || 0}`))
  const anexos = u(base.map((c) => String(c.resumo?.anexo ?? c.referencia?.anexo ?? '—').trim() || '—'))
  const tipos = u(base.map((c) => String(c.cstClassTribDetalhes?.tipoAliquota ?? '—')))
  const difs = u(base.map((c) => diferimentoDe(c) ?? 'sem-diferimento'))
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
    `Este NCM possui ${base.length} vínculos oficiais distintos na base da Reforma (CST × cClassTrib) — ` +
    `por isso há ${base.length} tributações possíveis, uma por enquadramento previsto para operações/produtos diferentes sob o mesmo NCM: ` +
    `${linhas.join('; ')}. ${diffTxt} ` +
    `Todas as opções vêm da base oficial do sistema; o nome da planilha só ajuda a ordenar.` +
    (temFallback
      ? ` Além delas, há a última opção de segurança (tributação integral 000/000001): use quando o produto NÃO atender a nenhuma qualificação com benefício — confira se seu produto realmente atende a essa família de NCM.`
      : '')
  )
}

/* ------------------------------------------------------------- entrada -- */

/**
 * Análise assistida de UM item do lote (pura, síncrona, sem I/O).
 *
 * Ordem de prioridade (espelha o resolvedor):
 * inválida → extinta → manual → regra geral → única → múltipla.
 *
 * Nota: o alerta nome × NCM foi removido — o produto tem NCM e existe para
 * ser classificado. O NCM manda na tributação, sem confrontar o nome
 * comercial com a descrição oficial.
 */
export function analisarItemLoteIA(entrada: EntradaAnaliseLote): AnaliseLoteIA {
  const { nome, ncm, classificacoes, regraGeral, manual, extinto } = entrada
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
      resumo: `Você já reclassificou o NCM ${ncm} manualmente (${c ? `CST ${c.cst}/${c.cClassTrib}` : '—'}). A busca automática não disputa: vale a sua regra, com a sua fonte — responsabilidade sua, sinalizada em toda a tela.`,
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
    return {
      situacao: 'regra-geral',
      totalOpcoes: classificacoes.length,
      maisProvavelIndice: 0,
      confianca: 0.8,
      nivel: nivelDeConfianca(0.8),
      titulo: 'Sem vínculo oficial — vale a regra geral (tributação integral)',
      resumo:
        `O NCM ${ncm} não tem vínculo específico CST × cClassTrib na base oficial — HOJE vale a regra geral CST 000/cClassTrib 000001 (alíquota cheia, redução 0%). ` +
        (c ? `Leitura oficial: ${c.resumo?.descricaoCClassTrib || c.descricao || 'tributação integral'}.` : '') +
        (originais.length ? ` O nome (“${nomeSeguro.slice(0, 60)}”) foi confrontado e não criou nenhum enquadramento novo.` : ''),
      porqueMultiplas: null,
      orientacaoEscolha:
        'Escriture pela regra geral. Se você conhece uma regra específica com fonte legal, use “Reclassificar manualmente” informando descrição + link — aí a linha passa a valer como manual (responsabilidade sua).',
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

  // ---- 1 ou N vínculos oficiais: nome ordena, base decide ----
  // O fallback integral (última opção de segurança) nunca é pontuado pelo
  // nome (score -1): em múltiplas ele é a SUGESTÃO (segurança), e o nome
  // serve só como comparativo entre as oficiais — nunca como decisão.
  const { originais, expandidos } = tokensDoNome(nomeSeguro)
  const pontuadas = classificacoes.map((c, i) => {
    const { score, termos } = c.integralFallback
      ? { score: -1, termos: [] as string[] }
      : pontuarOpcaoPeloNome(expandidos, originais, c)
    return { c, i, score, termos }
  })
  const ordenadas = [...pontuadas].sort((a, b) => b.score - a.score || a.i - b.i)
  const topoOficial = ordenadas.find((o) => !o.c.integralFallback) ?? ordenadas[0]
  const topo = topoOficial
  // Pré-calcula a integral de segurança (usada como sugestão em multipla).
  const idxIntegralPre = (() => {
    const f = classificacoes.findIndex((c) => c.integralFallback)
    if (f >= 0) return f
    return classificacoes.findIndex((c) => c.cst === '000' && c.cClassTrib === '000001')
  })()
  // Múltipla = 2+ OFICIAIS. "1 oficial + integral de segurança" continua
  // `unica` (oficial fixado), mas com a integral trocável — a finalidade e a
  // descrição da planilha podem não dar lastro ao benefício.
  const totalOficiaisPre = classificacoes.filter((c) => !c.integralFallback).length
  const ehMultipla = totalOficiaisPre > 1
  const idxSugeridoPre = ehMultipla
    ? (idxIntegralPre >= 0 ? idxIntegralPre : (topo ? topo.i : 0))
    : (topo ? topo.i : 0)

  const opcoes: OpcaoAnalisada[] = pontuadas.map(({ c, i, score, termos }) => {
    const ehSugerida = i === idxSugeridoPre
    const { comentario, redIBS, redCBS, anexo, anexoRotulo } = comentarOpcao(c, i, termos, nomeSeguro, ehSugerida)
    return {
      indice: i, cst: c.cst, cClassTrib: c.cClassTrib,
      descricao: c.resumo?.descricaoCClassTrib || c.descricao || '', redIBS, redCBS,
      anexo, anexoRotulo, baseLegal: c.baseLegal || '', urlLegislacao: c.resumo?.urlLegislacao ?? null,
      tipoAliquota: c.cstClassTribDetalhes?.tipoAliquota ?? null,
      diferimento: diferimentoDe(c), termosCasados: termos, scoreNome: score, comentario,
    }
  })

  if (!ehMultipla && topo) {
    const conf = !nomeSeguro ? 0.9 : topo.score > 0 ? 0.95 : 0.85
    // Integral de segurança como ALTERNATIVA trocável (o lote anexa para
    // todo benefício único): a finalidade/descrição pode não dar lastro.
    const idxIntegral = classificacoes.findIndex((c) => c.integralFallback)
    const temAlternativa = idxIntegral >= 0 && idxIntegral !== topo.i
    const alertas: string[] = []
    if (!topo.termos.length && temAlternativa) {
      alertas.push(
        `O nome (“${nomeSeguro.slice(0, 60) || '—'}”) não adere ao texto oficial do benefício — confira finalidade e descrição antes de salvar; a integral (Opção ${idxIntegral + 1}) está disponível.`,
      )
    }
    return {
      situacao: 'unica',
      totalOpcoes: classificacoes.length,
      maisProvavelIndice: topo.i,
      confianca: conf,
      nivel: nivelDeConfianca(conf),
      titulo: temAlternativa
        ? 'Tributação única oficial — integral disponível se não houver lastro'
        : 'Tributação única oficial — conferida pelo nome',
      resumo:
        `O NCM ${ncm} tem 1 vínculo oficial na base (${topo.c.cst}/${topo.c.cClassTrib} — ${topo.c.resumo?.descricaoCClassTrib || topo.c.descricao || '—'}). ` +
        (topo.termos.length
          ? `O nome confirma: ${topo.termos.length} termo(s) casaram (${topo.termos.join(', ')}).`
          : nomeSeguro
            ? 'O nome não trouxe termos que batam na descrição oficial — o que é normal (nome comercial × texto legal). O vínculo único continua valendo.'
            : 'Sem nome na planilha para confrontar — o vínculo único vale pela base oficial.') +
        (temAlternativa
          ? ` Se o produto NÃO atender à qualificação do benefício (finalidade, descrição, destinação), troque pela Opção ${idxIntegral + 1} (tributação integral).`
          : ''),
      porqueMultiplas: null,
      orientacaoEscolha: temAlternativa
        ? `Tributação única pré-selecionada (Opção ${topo.i + 1}). Confira a base legal; se a finalidade/descrição do produto não der lastro ao benefício, selecione a integral (Opção ${idxIntegral + 1}) antes de salvar.`
        : 'Tributação única: nenhuma escolha a fazer. Confira a base legal no cartão e salve.',
      alertas,
      opcoes,
      fontes,
      divergenciaNome: false,
      nomeIA: NOME_IA,
    }
  }

  // ---- múltiplas ----
  // REGRA DO LOTE (segurança): com 2+ tributações o sistema NUNCA fixa um
  // benefício (redução, alíquota zero ou diferimento — efetivo ou
  // condicional) como escolha. A descrição da planilha pode não ser coerente
  // com o produto real do cliente, então o sistema pré-seleciona a
  // TRIBUTAÇÃO INTEGRAL (fallback de segurança, última opção) e deixa o
  // usuário escolher. A aderência do nome serve só como comparativo entre
  // as opções oficiais — nunca como decisão. Fixa (pré-seleção automática)
  // só vale para referência única (unica / regra-geral / manual).
  const temFallback = classificacoes.some((c) => c.integralFallback)
  const totalOficiais = classificacoes.filter((c) => !c.integralFallback).length || classificacoes.length
  let sugerida = classificacoes.findIndex((c) => c.integralFallback)
  if (sugerida < 0) {
    sugerida = classificacoes.findIndex((c) => c.cst === '000' && c.cClassTrib === '000001')
  }
  if (sugerida < 0) sugerida = topo?.i ?? 0
  const integralSugerida = classificacoes[sugerida]
  const ehIntegral = Boolean(
    integralSugerida && (integralSugerida.integralFallback || (integralSugerida.cst === '000' && integralSugerida.cClassTrib === '000001')),
  )
  const melhorPorNome = topo && !topo.c.integralFallback ? topo : null
  const sufixoFallback = temFallback || ehIntegral
    ? ` A Opção ${sugerida + 1} (tributação integral) já vem pré-selecionada por segurança — troque somente se o produto atender a alguma qualificação com benefício.`
    : ''
  // Confiança baixa de propósito: integral é ponto de partida seguro, não
  // predição — exige conferência do usuário em todos os casos.
  const confianca = 0.35
  let resumo: string
  let orientacao: string
  const nomeCurto = nomeSeguro.slice(0, 60)
  const comparativoNome = melhorPorNome && originais.length && melhorPorNome.score > 0
    ? ` Pelo nome (“${nomeCurto}”), a opção com maior aderência textual seria a Opção ${melhorPorNome.i + 1} (CST ${melhorPorNome.c.cst}/${melhorPorNome.c.cClassTrib} — ${melhorPorNome.termos.join(', ') || 'aderência parcial'}), mas o sistema NÃO a fixou: a descrição pode não corresponder ao produto real.`
    : originais.length
      ? ` O nome (“${nomeCurto}”) não foi usado para decidir — nenhuma aderência textual fixa benefício no lote.`
      : ` A linha veio sem nome para confrontar — sem nome, sem desempate.`
  resumo =
    `O NCM ${ncm} tem ${totalOficiais} tributações oficiais possíveis${temFallback ? ' + a integral de segurança' : ''} e exige a sua escolha.` +
    comparativoNome +
    ` Por segurança, deixei pré-selecionada a Opção ${sugerida + 1} (tributação integral, alíquota cheia): use quando o produto NÃO atender a nenhuma qualificação com benefício (propósito, descrição, destinação ou composição — inclusive diferimento, que depende da operação).${temFallback || ehIntegral ? '' : ''}`
  orientacao = `Escolha obrigatória: confira cada base legal abaixo e selecione a que descreve a sua operação/produto real. A integral (Opção ${sugerida + 1}) é o ponto de partida seguro — só saia dela com lastro (benefício confirmado). A decisão final é sua e fica registrada na linha.${sufixoFallback}`

  const alertas: string[] = [
    'Mais de uma tributação oficial — o sistema não fixou benefício (nem redução, nem diferimento): a integral vem pré-selecionada por segurança.',
  ]

  return {
    situacao: 'multipla',
    totalOpcoes: classificacoes.length,
    maisProvavelIndice: sugerida,
    confianca,
    nivel: nivelDeConfianca(confianca),
    titulo: `Mais de uma tributação — integral sugerida, escolha sua`,
    resumo,
    porqueMultiplas: explicarMultiplas(classificacoes),
    orientacaoEscolha: orientacao,
    alertas,
    opcoes,
    fontes,
    divergenciaNome: false,
    nomeIA: NOME_IA,
  }
}
