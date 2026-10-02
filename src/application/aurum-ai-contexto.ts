/**
 * Aurum AI — contexto absoluto (conjunto de dados completo por NCM).
 *
 * A predição completa NUNCA decide por um campo isolado (só descrição,
 * só capítulo, só vínculo). Cada candidato carrega a **ficha absoluta**:
 * nomenclatura + hierarquia + vínculos + reduções + capítulo (in natura /
 * art. 135) + vigência (extinto / revogado / manual) + anexo oficial.
 *
 * O veredito unificado (`analisarFichaAbsoluta`) separa com precisão máxima:
 * - **Vigente (fato oficial)**: o que vale hoje — regra geral OU vínculo.
 * - **Hipótese condicional (a verificar)**: o que PODE valer SE o produto /
 *   operação comprovar a condição (in natura Art. 137, alimento Art. 135,
 *   diferimento Anexo IX). Hipótese nunca entra no cálculo nem no selo de
 *   redução — só em bloco "a verificar" assinado pela Aurum AI.
 *
 * Isso elimina a divergência do cartão 0302.11.00 (regra geral "alíquota
 * cheia" × aviso "redução 60%"): agora há UM veredito com duas camadas
 * rotuladas — vigente vs hipótese — sem afirmar redução sem vínculo.
 */
import { CAPITULOS_ART_135 } from '@/domain/constants/tributarios'
import { CAPITULOS_IN_NATURA, CAPITULOS_NCM } from '@/domain/constants/capitulos'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { comporCaminho } from '@/domain/services/busca-texto'
import { norm } from '@/domain/services/format'
import {
  buscarNomenclatura,
  resolverClassificacoes,
} from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

export interface CapituloFicha {
  codigo: string
  nome: string
  podeSerInNatura: boolean
  ehAlimentoArt135: boolean
}

export interface FichaAbsoluta {
  codigo: string
  nomenclatura: NomenclaturaNcm | null
  caminho: string[]
  caminhoTexto: string
  capitulo: CapituloFicha
  classificacoes: Classificacao[]
  regraGeral: boolean
  manual: boolean
  extinto: boolean
  revogado: boolean
  redIBS: number
  redCBS: number
  anexoOficial: string | null
  baseLegal: string | null
  totalVinculos: number
}

export type SituacaoAurumAI =
  | 'tributacao-integral'
  | 'beneficio-confirmado'
  | 'hipotese-condicional'
  | 'indefinido'

export interface VereditoAurumAI {
  situacao: SituacaoAurumAI
  /** Rótulo único, sem divergência (ex.: "Tributação integral vigente"). */
  rotuloSituacao: string
  /** Redução que VALE hoje (0 quando regra geral). */
  reducaoVigente: { ibs: number; cbs: number }
  /** Redução que VALERIA se a hipótese se confirmar (null quando não há). */
  reducaoPotencial: { ibs: number; cbs: number } | null
  /** `true` quando há hipótese a verificar (in natura / alimento / IX). */
  exigeVerificacao: boolean
  artigosHipotese: string[]
  mensagemVigente: string
  mensagemHipotese: string | null
  /** Checklist do que confirmar antes de escriturar a hipótese. */
  checklist: string[]
  fontes: string[]
}

function capituloDe(codigo: string): CapituloFicha {
  const cap = norm(codigo).slice(0, 2)
  return {
    codigo: cap,
    nome: CAPITULOS_NCM[cap] ?? '',
    podeSerInNatura: CAPITULOS_IN_NATURA.has(cap),
    ehAlimentoArt135: CAPITULOS_ART_135.has(cap),
  }
}

/** Monta a ficha absoluta de UM NCM (todas as bases à disposição da Aurum AI). */
export async function montarFichaAbsoluta(codigo: unknown): Promise<FichaAbsoluta> {
  const c = norm(codigo)
  const [nomenclatura, resolvido] = await Promise.all([
    buscarNomenclatura(c).catch(() => null),
    c.length === 8 ? resolverClassificacoes(c) : Promise.resolve(null),
  ])
  const lista = resolvido?.lista ?? []
  const principal = lista[0]
  const redIBS = Number(principal?.resumo?.percentualReducaoIBS ?? 0) || 0
  const redCBS = Number(principal?.resumo?.percentualReducaoCBS ?? 0) || 0

  // Caminho hierárquico (capítulo → … → item) para a IA "ler" o contexto.
  let caminho: string[] = []
  try {
    const todas = await db.ncmNomenclatura.toArray()
    const porCodigo = new Map(todas.map((n) => [n.codigo, n.descricao]))
    caminho = comporCaminho(c, (p) => porCodigo.get(p))
  } catch {
    caminho = []
  }
  const caminhoTexto = [...caminho, nomenclatura?.descricao ?? ''].filter(Boolean).join(' › ')

  return {
    codigo: c,
    nomenclatura,
    caminho,
    caminhoTexto,
    capitulo: capituloDe(c),
    classificacoes: lista,
    regraGeral: resolvido?.regraGeral ?? true,
    manual: resolvido?.manual ?? false,
    extinto: resolvido?.extinto ?? false,
    revogado: resolvido?.revogado != null,
    redIBS,
    redCBS,
    anexoOficial: (principal?.resumo?.anexo ?? principal?.referencia?.anexo ?? null) as string | null,
    baseLegal: principal?.baseLegal ?? principal?.cstClassTribDetalhes?.lcRef ?? null,
    totalVinculos: resolvido?.vinculos?.length ?? 0,
  }
}

/** Monta fichas em lote (Top-5 do fallback) com tolerância a falha isolada. */
export async function montarFichasAbsolutas(codigos: string[]): Promise<FichaAbsoluta[]> {
  const out: FichaAbsoluta[] = []
  for (const c of codigos.slice(0, 5)) {
    try {
      out.push(await montarFichaAbsoluta(c))
    } catch {
      /* candidato sem ficha continua avaliável pelo texto */
    }
  }
  return out
}

/**
 * Veredito unificado — UMA verdade com duas camadas rotuladas.
 *
 * - Com vínculo oficial → `beneficio-confirmado` (redução vigente afirmada).
 * - Sem vínculo (regra geral) + capítulo in natura/alimento → ainda é
 *   `tributacao-integral` vigente, MAS com `hipotese-condicional` a verificar
 *   (redução potencial 60% Art. 137/135). O cálculo e os selos usam SEMPRE a
 *   redução vigente (0) — a hipótese nunca infla o número.
 * - Sem vínculo e sem capítulo suspeito → `tributacao-integral` puro.
 */
export function analisarFichaAbsoluta(ficha: FichaAbsoluta): VereditoAurumAI {
  const fontes = [
    'Nomenclatura vigente (TEC)',
    'Vínculos oficiais da Reforma (CST × cClassTrib)',
    `Capítulo ${ficha.capitulo.codigo}${ficha.capitulo.nome ? ` — ${ficha.capitulo.nome}` : ''}`,
    ficha.extinto ? 'Vigência: NCM extinto' : 'Vigência: NCM vigente',
    ficha.manual ? 'Reclassificação manual do usuário' : 'Sem reclassificação manual',
  ]

  if (!ficha.regraGeral && ficha.classificacoes.length) {
    const p = ficha.classificacoes[0]
    const rotulo = `Benefício confirmado — redução vigente ${ficha.redIBS}% IBS / ${ficha.redCBS}% CBS`
    return {
      situacao: 'beneficio-confirmado',
      rotuloSituacao: rotulo,
      reducaoVigente: { ibs: ficha.redIBS, cbs: ficha.redCBS },
      reducaoPotencial: null,
      exigeVerificacao: false,
      artigosHipotese: [],
      mensagemVigente:
        `Enquadramento oficial ${p.cst}/${p.cClassTrib} (${p.resumo.descricaoCClassTrib})` +
        `${ficha.anexoOficial ? `, Anexo ${ficha.anexoOficial}` : ''}` +
        `${ficha.baseLegal ? ` — ${ficha.baseLegal}` : ''}. Redução vigente aplicada ao cálculo.`,
      mensagemHipotese: null,
      checklist: [],
      fontes,
    }
  }

  // Regra geral: fato vigente é tributação integral.
  const artigos: string[] = []
  const checklist: string[] = []
  if (ficha.capitulo.podeSerInNatura) {
    artigos.push('Art. 137 da LC 214/2025 (in natura — redução de 60%)')
    checklist.push('O produto é in natura (agropecuário, aquícola, pesqueiro, florestal ou extrativista vegetal, sem industrialização relevante)?')
  }
  if (ficha.capitulo.ehAlimentoArt135) {
    artigos.push('Art. 135 da LC 214/2025 (alimentos p/ consumo humano — redução de 60%)')
    checklist.push('O produto é alimento destinado ao consumo humano (e não insumo, ração ou uso industrial)?')
  }
  // Anexo IX é hipótese operacional (diferimento condicional), citada quando
  // o capítulo sugere insumo — sem afirmar, só para verificar.
  const temHipotese = artigos.length > 0

  if (!temHipotese) {
    return {
      situacao: 'tributacao-integral',
      rotuloSituacao: 'Tributação integral vigente — sem hipótese aplicável',
      reducaoVigente: { ibs: 0, cbs: 0 },
      reducaoPotencial: null,
      exigeVerificacao: false,
      artigosHipotese: [],
      mensagemVigente:
        'Sem vínculo específico na base oficial: vale a regra geral (CST 000/cClassTrib 000001, alíquota cheia de IBS/CBS). Nenhum capítulo sugere hipótese de redução para este NCM.',
      mensagemHipotese: null,
      checklist: [],
      fontes,
    }
  }

  return {
    situacao: 'tributacao-integral',
    rotuloSituacao: 'Tributação integral vigente — hipótese a verificar',
    reducaoVigente: { ibs: 0, cbs: 0 },
    reducaoPotencial: { ibs: 60, cbs: 60 },
    exigeVerificacao: true,
    artigosHipotese: artigos,
    mensagemVigente:
      'Sem vínculo específico na base oficial: HOJE vale a regra geral (CST 000/cClassTrib 000001, alíquota cheia). O cálculo abaixo usa a alíquota cheia — nenhuma redução foi aplicada.',
    mensagemHipotese:
      'A Aurum AI identificou hipótese CONDICIONAL de redução de 60% (não vigente): ela só vale SE o seu produto/operação comprovar a condição legal. Enquanto não comprovada, escriture pela regra geral.',
    checklist: [
      ...checklist,
      'Se confirmar a condição, reclassifique com a regra específica (botão "Reclassificar manualmente") informando descrição + link da legislação.',
      'Enquanto não reclassificado, XML/SPED/lote seguem a regra geral (responsabilidade sua).',
    ],
    fontes,
  }
}

/**
 * Pontuação absoluta do candidato (precisão máxima):
 * texto (0–140) + vínculo oficial (+50) + capítulo coerente (+15) −
 * extinto (1000) − genérico (−20). Usada pelo fallback Aurum AI para ordenar
 * o Top-5 antes da seleção — o resolvedor continua sendo a única verdade.
 */
export function pontuarFichaAbsoluta(ficha: FichaAbsoluta, scoreTexto: number): number {
  let s = Number(scoreTexto) || 0
  if (!ficha.regraGeral) s += 50
  if (ficha.extinto) s -= 1000
  if (ficha.revogado) s -= 200
  if (/^\s*(--\s*)?outros?\b/i.test(ficha.nomenclatura?.descricao ?? '')) s -= 20
  return Math.round(s * 100) / 100
}
