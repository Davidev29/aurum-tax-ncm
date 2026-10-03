/**
 * Gate determinístico → Aurum AI para SERVIÇOS (Phase 7).
 *
 * Mesma arquitetura do GATE de bens (`./classificacao-ia.ts`), com
 * adaptadores de domínio NBS:
 * 1. `classificarServicoPorDescricao()` primeiro; `nbs_provavel` com
 *    confiança `alta` devolve `via: 'deterministico'` sem worker;
 * 2. senão, Top-20 RAG NBS → worker (`window.aurum.ia.classificar`, que é
 *    por índice e portanto agnóstico a 8/9 dígitos) ou seletor local NBS →
 *    `resolverClassificacoesNbs` (única verdade; fora da base = inválido);
 * 3. NÃO SEI só sem lastro oficial; hipótese provisória ancorada caso contrário.
 */
import {
  classificarServicoPorDescricao,
  type EntradaDescricaoServico,
  type SugestaoNbsJson,
} from './classificacao-inteligente-servicos'
import {
  buscarNbsPorTexto,
  resolverClassificacoesNbs,
} from '@/infrastructure/base/classificacao-repo'
import { bridge, type CandidatoIa } from '@/infrastructure/bridge'
import { LIMIAR_NAO_SEI, calibrarConfiancaFinal } from '@/domain/aurum-ai'
import type { ViaClassificacao } from '@/store/ia'
import { normalizarBusca, tokensRelevantes } from '@/domain/services/busca-texto'
import { casaToken } from '@/domain/services/vocabulario'
import { norm } from '@/domain/services/format'

export type { ViaClassificacao }

/** Ficha do NBS lida pela Aurum AI (conjunto de dados da decisão). */
export interface FichaAbsolutaServico {
  codigo: string
  titulo: string
  cst: string
  cClassTrib: string
  anexo: string | null
  reducaoIBS: number
  reducaoCBS: number
  baseLegal: string | null
  documentos: string
  regraGeral: boolean
  /** CNAE de origem quando a consulta veio do modo CNPJ. */
  cnaeOrigem: string | null
}

export interface VereditoServico {
  exigeVerificacao: boolean
  mensagemHipotese?: string
  mensagemVigente: string
}

export interface ResultadoGateIaServicos {
  via: ViaClassificacao
  sugestao: SugestaoNbsJson
  candidatos: CandidatoIa[]
  codigoEscolhido: string | null
  confiancaIa: number
  motivo: string
  mock: boolean
  /** Validação pelo resolvedor NBS (única fonte de verdade). */
  nbsValidado: string | null
  regraGeral: boolean
  ms: number
  ficha: FichaAbsolutaServico | null
  veredito: VereditoServico | null
  fontes: string[]
}

function combinarContextoIaServicos(entrada: EntradaDescricaoServico): string {
  return [entrada.descricao, entrada.tomador ?? '', entrada.local ?? '', entrada.uso ?? '']
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function montarFichaServico(
  codigo9: string,
  regraGeral: boolean,
  cnaeOrigem: string | null,
): Promise<FichaAbsolutaServico | null> {
  try {
    const r = await resolverClassificacoesNbs(codigo9)
    const cl = r.lista[0]
    if (!cl) return null
    const docs = cl.resumo.documentosHabilitados
    const docsAtivos = docs
      ? Object.entries(docs).filter(([, v]) => v === true).map(([k]) => k).join(', ')
      : ''
    return {
      codigo: codigo9,
      titulo: cl.resumo.descricaoCClassTrib || cl.descricao,
      cst: cl.cst,
      cClassTrib: cl.cClassTrib,
      anexo: cl.resumo.anexo,
      reducaoIBS: Number(cl.resumo.percentualReducaoIBS) || 0,
      reducaoCBS: Number(cl.resumo.percentualReducaoCBS) || 0,
      baseLegal: cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || null,
      documentos: docsAtivos,
      regraGeral: regraGeral || r.regraGeral,
      cnaeOrigem,
    }
  } catch {
    return null
  }
}

function vereditoServico(ficha: FichaAbsolutaServico | null): VereditoServico | null {
  if (!ficha) return null
  if (ficha.regraGeral) {
    return {
      exigeVerificacao: true,
      mensagemVigente: 'Sem vínculo específico na base da Reforma: tributação integral, a verificar com o contador.',
    }
  }
  return { exigeVerificacao: false, mensagemVigente: `Vínculo oficial ${ficha.cst}/${ficha.cClassTrib} vigente na base.` }
}

/**
 * Seletor Aurum AI local para NBS (web/testes ou segunda opinião).
 * Overlap textual + calibragem multi-fator + tetos (regra geral ≤ 0.60).
 */
async function selecionarAurumAILocalNbs(
  descricao: string,
  candidatos: CandidatoIa[],
): Promise<{ codigo: string; confianca: number; motivo: string }> {
  const relevantes = tokensRelevantes(descricao)
  if (!relevantes.length || !candidatos.length) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente' }
  }
  const conjunto = new Set(relevantes)
  const teto = Math.max(1, relevantes.length)

  const rejeitados = new Set<string>()
  try {
    const { db } = await import('@/infrastructure/db/schema')
    const fb = await db.table('ia_feedback').orderBy('quando').reverse().limit(30).toArray().catch(() => [])
    const alvoNorm = normalizarBusca(descricao)
    for (const r of fb as { descricao?: unknown; decisao?: unknown }[]) {
      if (r?.decisao && normalizarBusca(r.descricao) === alvoNorm) {
        rejeitados.add(String(r.decisao).replace(/\D+/g, ''))
      }
    }
  } catch {
    /* sem feedback: segue sem demote */
  }

  const pontuados: { c: CandidatoIa; pontos: number }[] = []
  for (const c of candidatos) {
    const toks = new Set(normalizarBusca(c.descricao).split(' ').filter(Boolean))
    let pontos = 0
    for (const q of conjunto) {
      if (toks.has(q)) pontos += 1
      else {
        for (const o of toks) {
          if (casaToken(q, o)) {
            pontos += 0.8
            break
          }
        }
      }
    }
    let score = pontos
    if (rejeitados.has(String(c.codigo).replace(/\D+/g, ''))) score -= 500
    pontuados.push({ c, pontos: score })
  }
  pontuados.sort((a, b) => b.pontos - a.pontos || a.c.codigo.localeCompare(b.c.codigo))
  const topo = pontuados[0]
  const segundo = pontuados[1]
  if (!topo || topo.pontos <= 0) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente' }
  }
  const margem = segundo ? Math.max(0, topo.pontos - segundo.pontos) : 999
  const confianca = calibrarConfiancaFinal({
    baseTexto: topo.pontos / teto,
    margem: margem >= 999 ? 30 : margem * 10,
    temVinculo: true,
    temPin: false,
    tokens: relevantes.length,
  })
  if (confianca < LIMIAR_NAO_SEI) {
    return { codigo: topo.c.codigo, confianca: LIMIAR_NAO_SEI, motivo: 'similaridade-fraca-ancorada/pista-ancorada-base-oficial' }
  }
  return { codigo: topo.c.codigo, confianca, motivo: 'aurum-ai-nbs-overlap' }
}

const FONTES_GATE_NBS = [
  'Vínculos NBS × CST × cClassTrib (LC 214/2025)',
  'Base oficial · correspondências por nome (NBS avaliados no Top)',
  'Tabela CNAE × Anexo Simples + Fator R (quando origem CNPJ)',
  'Regra geral dos serviços 000/000001 (tributação integral)',
]

export async function classificarComIaServicos(
  entrada: EntradaDescricaoServico,
  opts?: { aoWorker?: (usou: boolean) => void; cnaeOrigem?: string | null },
): Promise<ResultadoGateIaServicos> {
  const t0 = Date.now()
  const cnaeOrigem = opts?.cnaeOrigem ? norm(opts.cnaeOrigem) || null : null
  const sugestao = await classificarServicoPorDescricao(entrada)

  if (sugestao.nbs_provavel && sugestao.confianca === 'alta') {
    opts?.aoWorker?.(false)
    return {
      via: 'deterministico',
      sugestao,
      candidatos: [],
      codigoEscolhido: norm(sugestao.nbs_provavel),
      confiancaIa: 0,
      motivo: 'deterministico-alta-confianca',
      mock: false,
      nbsValidado: norm(sugestao.nbs_provavel),
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes: [],
    }
  }

  if (sugestao.foraDeEscopo) {
    opts?.aoWorker?.(false)
    return {
      via: 'deterministico',
      sugestao,
      candidatos: [],
      codigoEscolhido: null,
      confiancaIa: 0,
      motivo: 'fora-de-escopo',
      mock: false,
      nbsValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes: [],
    }
  }

  opts?.aoWorker?.(true)
  const contextoRico = combinarContextoIaServicos(entrada)
  const textoBusca = contextoRico || entrada.descricao
  const achados = await buscarNbsPorTexto(textoBusca, 20)
  // Sem truncamento cego: o vocabulário distintivo mora no fim do texto
  // jurídico ("…espetáculos teatrais…") — cortar em 300 chars amputava o
  // match do seletor (que lê tokens, não substring como o RAG estrito).
  const candidatos: CandidatoIa[] = achados.map((a) => ({
    codigo: a.codigo,
    descricao: `${a.titulo} — ${a.descricao}`.slice(0, 2000),
    score: a.score,
  }))

  let escolha: { codigo: string; confianca: number; motivo: string } = {
    codigo: 'NÃO SEI',
    confianca: 0,
    motivo: 'sem-candidatos',
  }
  let mock = true
  if (candidatos.length) {
    if (bridge?.ia) {
      const r = await bridge.ia.classificar(contextoRico || entrada.descricao, candidatos).catch((e) => {
        throw new Error(`Modelo IA obrigatório indisponível: ${e instanceof Error ? e.message : String(e)}`)
      })
      if (!r.ok) {
        throw new Error(`Modelo IA obrigatório indisponível: ${r.erro}`)
      }
      mock = r.mock
      if (r.codigo === 'NÃO SEI') {
        try {
          const segunda = await selecionarAurumAILocalNbs(contextoRico || entrada.descricao, candidatos)
          escolha = segunda.codigo !== 'NÃO SEI'
            ? { ...segunda, motivo: `${r.motivo}/segunda-opiniao-${segunda.motivo}` }
            : { codigo: 'NÃO SEI', confianca: 0, motivo: r.motivo }
        } catch {
          escolha = { codigo: 'NÃO SEI', confianca: 0, motivo: r.motivo }
        }
      } else {
        escolha = { codigo: r.codigo, confianca: Math.max(0, Math.min(1, Number(r.confianca) || 0)), motivo: r.motivo }
      }
    } else {
      escolha = await selecionarAurumAILocalNbs(contextoRico || entrada.descricao, candidatos)
    }
  }

  if (escolha.codigo === 'NÃO SEI') {
    return {
      via: 'ia',
      sugestao,
      candidatos,
      codigoEscolhido: null,
      confiancaIa: 0,
      motivo: escolha.motivo,
      mock,
      nbsValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes: FONTES_GATE_NBS,
    }
  }

  // Gate absoluto: 9 dígitos homologados na base NBS (bloqueia alucinação).
  const digitos = norm(escolha.codigo)
  const validacao = await resolverClassificacoesNbs(digitos)
  const valido = digitos.length === 9 && validacao.lista.length > 0
  if (!valido) {
    return {
      via: 'ia',
      sugestao,
      candidatos,
      codigoEscolhido: escolha.codigo,
      confiancaIa: 0,
      motivo: escolha.motivo,
      mock,
      nbsValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes: FONTES_GATE_NBS,
    }
  }
  let confianca = Math.round(escolha.confianca * 100) / 100
  if (validacao.regraGeral && confianca > 0.6) confianca = 0.6
  const ficha = await montarFichaServico(digitos, validacao.regraGeral, cnaeOrigem)
  return {
    via: 'ia',
    sugestao,
    candidatos,
    codigoEscolhido: digitos,
    confiancaIa: confianca,
    motivo: escolha.motivo,
    mock,
    nbsValidado: digitos,
    regraGeral: validacao.regraGeral,
    ms: Date.now() - t0,
    ficha,
    veredito: vereditoServico(ficha),
    fontes: FONTES_GATE_NBS,
  }
}
