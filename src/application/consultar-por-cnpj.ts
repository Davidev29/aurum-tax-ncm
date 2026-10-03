/**
 * Consulta por CNPJ (Phase 7) — BrasilAPI → CNAEs → 1 consulta Aurum AI NBS
 * por atividade de serviço.
 *
 * Fluxo: valida DV → cache Dexie (TTL 30 dias) → BrasilAPI (única rede da
 * tela Serviços) → para cada CNAE: lookup na tabela viva → GATE NBS com
 * `cnaeOrigem` → teto da matriz CNAE. Nunca lança: falhas viram atividades
 * com `estado` explícito.
 */
import type { CnaeAnexo, ConsultaCnpj } from '@/domain/entities'
import { validarCnpj, mensagemCnpjInvalido } from '@/domain/services/cnpj'
import {
  palavrasChaveNbsPorCnae,
  tetoConfiancaCnae,
  textoBuscavelCnae,
} from '@/domain/services/cnae'
import { fmtCnae } from '@/infrastructure/base/normalizacao'
import { buscarCnpj } from '@/infrastructure/receita/brasilapi'
import { buscarHipotesesLegais } from '@/infrastructure/base/classificacao-repo'
import {
  verificarCoerenciaServico,
  descricaoHipotese,
  pinsHipotesesPorCnae,
  type CoerenciaServico,
  type HipoteseLegal,
} from '@/domain/services/verificacao-servicos'
import { db } from '@/infrastructure/db/schema'
import { classificarComIAServicos } from '@/infrastructure/ia/classificacao-ia-servicos-repo'
import type { ResultadoConsultaIaServicos } from '@/infrastructure/ia/classificacao-ia-servicos-repo'
import { registrarAuditoria } from '@/application/auditoria'

/** Validade do cache de CNPJ (30 dias). */
export const TTL_CONSULTA_CNPJ_MS = 30 * 24 * 60 * 60 * 1000

export type EstadoAtividadeCnae =
  | 'classificado'
  | 'tributacao-integral'
  | 'manual-obrigatorio'
  | 'cnae-desconhecido'
  | 'falha'

export interface AtividadeCnae {
  cnae7: string
  codigoFormatado: string
  descricao: string
  principal: boolean
  cnaeTabela: CnaeAnexo | null
  estado: EstadoAtividadeCnae
  motivoEstado: string | null
  resultado: ResultadoConsultaIaServicos | null
  /** Confiança final = min(IA, teto da matriz CNAE). */
  confiancaFinal: number
  /** Benefícios da Reforma que o CNAE sugere (texto oficial, sem vínculo inventado). */
  hipoteses: HipoteseLegal[]
  /** A decisão NBS é coerente com as hipóteses? */
  coerencia: CoerenciaServico
}

export interface VereditoEmpresa {
  cnpj: string
  razaoSocial: string
  fantasia: string
  porte: string | null
  situacao: string | null
  opcaoSimples: boolean | null
  dataConsulta: string
  doCache: boolean
  atividades: AtividadeCnae[]
  resumo: {
    classificadas: number
    comBeneficio: number
    tributacaoIntegral: number
    manualObrigatorio: number
    desconhecidas: number
    falhas: number
  }
}

function resumir(atividades: AtividadeCnae[]): VereditoEmpresa['resumo'] {
  const r = {
    classificadas: 0,
    comBeneficio: 0,
    tributacaoIntegral: 0,
    manualObrigatorio: 0,
    desconhecidas: 0,
    falhas: 0,
  }
  for (const a of atividades) {
    if (a.estado === 'classificado') {
      r.classificadas++
      if (a.resultado && !a.resultado.regraGeral) r.comBeneficio++
      else r.tributacaoIntegral++
    } else if (a.estado === 'tributacao-integral') {
      r.classificadas++
      r.tributacaoIntegral++
    } else if (a.estado === 'manual-obrigatorio') r.manualObrigatorio++
    else if (a.estado === 'cnae-desconhecido') r.desconhecidas++
    else r.falhas++
  }
  return r
}

async function lerCache(cnpj: string): Promise<ConsultaCnpj | null> {
  try {
    const reg = await db.consultasCnpj.get(cnpj)
    if (!reg) return null
    if (Date.now() - Date.parse(reg.quando) > TTL_CONSULTA_CNPJ_MS) return null
    return reg
  } catch {
    return null
  }
}

async function classificarAtividade(
  cnae7: string,
  descricaoApi: string,
  principal: boolean,
): Promise<AtividadeCnae> {
  const base = {
    cnae7,
    codigoFormatado: fmtCnae(cnae7),
    descricao: descricaoApi,
    principal,
  }
  let tabela: CnaeAnexo | null = null
  try {
    tabela = (await db.cnae.get(cnae7)) ?? null
  } catch {
    tabela = null
  }
  if (!tabela) {
    return {
      ...base,
      descricao: descricaoApi || 'CNAE fora da tabela viva',
      cnaeTabela: null,
      estado: 'cnae-desconhecido',
      motivoEstado: 'CNAE ausente da tabela viva — classifique no modo manual.',
      resultado: null,
      confiancaFinal: 0,
      hipoteses: [],
      coerencia: 'sem-base',
    }
  }
  // Conferência contra a tabela da Reforma (vale para todos os estados com
  // tabela: a IA usa para comparar, a UI exibe como hipótese a verificar).
  let hipoteses: HipoteseLegal[] = []
  try {
    hipoteses = await buscarHipotesesLegais(textoBuscavelCnae(tabela), 3, {
      pinsCct: pinsHipotesesPorCnae(cnae7),
    })
  } catch {
    hipoteses = []
  }
  if (tabela.situacao === 'Depende da atividade') {
    return {
      ...base,
      descricao: tabela.descricao,
      cnaeTabela: tabela,
      estado: 'manual-obrigatorio',
      motivoEstado: 'Situação "Depende da atividade" — a IA nunca ancora sozinha; use o modo manual com contexto.',
      resultado: null,
      confiancaFinal: 0,
      hipoteses,
      coerencia: 'sem-base',
    }
  }
  try {
    // Tentativa 1: palavras-chave do setor (divisão CNAE → vocabulário NBS).
    // Tentativa 2: descrição oficial completa do CNAE.
    const chaves = palavrasChaveNbsPorCnae(cnae7)
    const tentativas = chaves.length
      ? [chaves.join(' '), textoBuscavelCnae(tabela)]
      : [textoBuscavelCnae(tabela)]
    let resultado: ResultadoConsultaIaServicos | null = null
    for (const descricao of tentativas) {
      try {
        const r = await classificarComIAServicos({ descricao }, { cnaeOrigem: cnae7 })
        if (r.codigoEscolhido && r.decisao) {
          resultado = r
          break
        }
      } catch {
        /* próxima tentativa */
      }
    }
    if (!resultado || !resultado.codigoEscolhido) {
      // Serviço sem benefício mapeado na base atual → tributação integral
      // (regra geral), honesto e sem chute de NBS. Se a tabela da Reforma
      // sugere benefício, ele aparece como hipótese a verificar.
      const top = hipoteses[0]
      return {
        ...base,
        descricao: tabela.descricao,
        cnaeTabela: tabela,
        estado: 'tributacao-integral',
        motivoEstado: top
          ? `Nenhum NBS mapeado, mas a lei prevê ${descricaoHipotese(top)} — hipótese a verificar com o contador (sem NBS vinculado na base atual).`
          : 'Nenhum benefício mapeado para esta atividade na base atual da Reforma — tributação integral (regra geral). Confirme com o contador.',
        resultado: null,
        confiancaFinal: 0,
        hipoteses,
        coerencia: 'sem-base',
      }
    }
    const teto = tetoConfiancaCnae(tabela.situacao)
    const confiancaFinal = Math.min(resultado.confiancaIa, teto)
    const motivo = teto < 1 && resultado.confiancaIa > teto
      ? `${resultado.motivo}/teto-matriz-ressalva`
      : resultado.motivo
    const coerencia = verificarCoerenciaServico(resultado.decisao?.cClassTrib, hipoteses)
    return {
      ...base,
      descricao: tabela.descricao,
      cnaeTabela: tabela,
      estado: 'classificado',
      motivoEstado:
        (teto < 1 ? 'Situação com ressalvas — confiança limitada a 60%, verificar com o contador.' : null) ??
        (coerencia === 'divergente'
          ? 'Atenção: o NBS decidido diverge das hipóteses da tabela da Reforma para este CNAE — conferir destinação/operação.'
          : null),
      resultado: { ...resultado, motivo, confiancaIa: confiancaFinal },
      confiancaFinal,
      hipoteses,
      coerencia,
    }
  } catch (e) {
    return {
      ...base,
      descricao: tabela.descricao,
      cnaeTabela: tabela,
      estado: 'falha',
      motivoEstado: e instanceof Error ? e.message : String(e),
      resultado: null,
      confiancaFinal: 0,
      hipoteses,
      coerencia: 'sem-base',
    }
  }
}

/**
 * Consulta completa por CNPJ. `forcarAtualizacao` ignora o cache.
 * Nunca lança — erro de rede/DV vira `Error` apenas para DV inválido;
 * demais falhas retornam veredito parcial com atividades em `falha`.
 */
export async function consultarPorCnpj(
  cnpjBruto: string,
  opts?: { forcarAtualizacao?: boolean; fetchFn?: typeof fetch },
): Promise<VereditoEmpresa> {
  const validado = validarCnpj(cnpjBruto)
  if (!validado.ok) {
    throw new Error(mensagemCnpjInvalido(validado.motivo ?? 'cnpj-tamanho'))
  }
  const cnpj = validado.cnpj

  let cached: ConsultaCnpj | null = null
  if (!opts?.forcarAtualizacao) cached = await lerCache(cnpj)

  let razaoSocial = cached?.razaoSocial ?? ''
  let fantasia = cached?.fantasia ?? ''
  let porte = cached?.porte ?? null
  let situacao = cached?.situacao ?? null
  let opcaoSimples = cached?.opcaoSimples ?? null
  let principal = cached?.cnaePrincipal ?? null
  let secundarios = cached?.cnaesSecundarios ?? []
  let doCache = Boolean(cached)
  let dataConsulta = cached?.quando ?? new Date().toISOString()

  if (!cached) {
    const dados = await buscarCnpj(cnpj, opts?.fetchFn ?? fetch)
    razaoSocial = dados.razaoSocial
    fantasia = dados.fantasia
    porte = dados.porte ?? null
    situacao = dados.situacao ?? null
    opcaoSimples = dados.opcaoSimples ?? null
    principal = dados.cnaePrincipal ?? null
    secundarios = (dados.cnaesSecundarios ?? []).map((s) => s.codigo)
    doCache = false
    dataConsulta = new Date().toISOString()
    const registro: ConsultaCnpj = {
      cnpj,
      razaoSocial,
      fantasia,
      porte,
      situacao,
      opcaoSimples,
      cnaePrincipal: principal,
      cnaesSecundarios: secundarios,
      quando: dataConsulta,
    }
    try {
      await db.consultasCnpj.put(registro)
    } catch {
      /* cache é best-effort */
    }
  }

  const fila: { codigo: string; descricao: string; principal: boolean }[] = []
  if (principal) fila.push({ codigo: principal, descricao: '', principal: true })
  for (const s of secundarios) {
    if (s && s !== principal && !fila.some((f) => f.codigo === s)) {
      fila.push({ codigo: s, descricao: '', principal: false })
    }
  }

  const atividades: AtividadeCnae[] = new Array(fila.length)
  const CONCORRENCIA = 5
  for (let i = 0; i < fila.length; i += CONCORRENCIA) {
    const fatia = fila.slice(i, i + CONCORRENCIA)
    const resultados = await Promise.all(
      fatia.map((f) => classificarAtividade(f.codigo, f.descricao, f.principal)),
    )
    resultados.forEach((r, k) => {
      atividades[i + k] = r
    })
  }

  const veredito: VereditoEmpresa = {
    cnpj,
    razaoSocial,
    fantasia,
    porte,
    situacao,
    opcaoSimples,
    dataConsulta,
    doCache,
    atividades,
    resumo: resumir(atividades),
  }
  void registrarAuditoria('consultas_cnpj', `${cnpj} — ${razaoSocial}`.slice(0, 80), 'criar', null, {
    atividades: atividades.length,
    doCache,
    resumo: veredito.resumo,
  })
  return veredito
}
