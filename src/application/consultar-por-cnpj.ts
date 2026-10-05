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
import { consultarPorCnae } from '@/application/consultar-por-cnae'
import {
  ANO_REFERENCIA_PADRAO,
  normalizarAnoReferencia,
  regrasDoCnae,
  type EstadoNbsCnae,
  type RegraCnae,
  type VereditoNbs,
} from '@/domain/services/cnae-nbs'

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
  /**
   * Predição informativa por nomes/sinônimos (fine-tuning NBS v2).
   * Preenchida quando a atividade NÃO puxa NBS mas BATE com os termos do
   * sistema. Cada item tem `apenasInformativo: true` — nunca decisão final.
   */
  preditivas: import('@/domain/services/preditivo-servicos').SugestaoPreditivaServico[]
  /* ------------------------------------------------ Phase 9 / 09-04 --- */
  /** Camada 1 (`regrasDoCnae`) — sempre presente após o GATE (null só se o banco falhar). */
  regras: RegraCnae | null
  /** Camada 2 (`consultarPorCnae`, best-effort) — vereditos NBS no ano de referência. */
  nbsLista: VereditoNbs[]
  /** Quantos vereditos têm benefício (`temBeneficio`). */
  nbsComBeneficio: number
  /** NBS mais provável do ranking (null quando sem mapeamento/bens). */
  maisProvavel: string | null
  /** Estado do enriquecimento NBS (badge da UI). */
  estadoNbs: EstadoNbsAtividade
  /** Ano de referência da precificação (default 2033 — regime pleno). */
  anoReferencia: number
}

/**
 * Estado do enriquecimento NBS por atividade (Phase 9 / 09-04).
 * Reaproveita `EstadoNbsCnae` do motor (`mapeado | sem-mapeamento-NBS |
 * bens→NCM`) + `cnae-desconhecido` quando o CNAE está fora dos 1.090.
 */
export type EstadoNbsAtividade = EstadoNbsCnae | 'cnae-desconhecido'

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
  /** Ano de referência do enriquecimento NBS (Phase 9 / 09-04, default 2033). */
  anoReferencia: number
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

/** Base Phase 7 sem o enriquecimento Phase 9 (o GATE nunca quebra). */
type BaseAtividadeCnae = Omit<
  AtividadeCnae,
  'regras' | 'nbsLista' | 'nbsComBeneficio' | 'maisProvavel' | 'estadoNbs' | 'anoReferencia'
>

async function classificarAtividadeGate(
  cnae7: string,
  descricaoApi: string,
  principal: boolean,
): Promise<BaseAtividadeCnae> {
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
      preditivas: [],
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
      preditivas: [],
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
      // Fine-tuning NBS v2 — predição informativa: mesmo sem NBS, se a
      // atividade BATER com os termos do sistema (nomes/sinônimos), sugere
      // pistas a título informativo (nunca decisão final).
      let preditivas: import('@/domain/services/preditivo-servicos').SugestaoPreditivaServico[] = []
      try {
        const { sugerirPreditivoServicos } = await import('@/domain/services/preditivo-servicos')
        preditivas = await sugerirPreditivoServicos(textoBuscavelCnae(tabela), { limite: 3 })
      } catch {
        preditivas = []
      }
      const top = hipoteses[0]
      return {
        ...base,
        descricao: tabela.descricao,
        cnaeTabela: tabela,
        estado: 'tributacao-integral',
        motivoEstado: top
          ? `Nenhum NBS mapeado, mas a lei prevê ${descricaoHipotese(top)} — hipótese a verificar com o contador (sem NBS vinculado na base atual).${preditivas.length ? ` Pistas informativas pelos nomes do sistema: ${preditivas.map((p) => `${p.codigoFormatado} — ${p.titulo}`).join('; ')} (não são decisão final).` : ''}`
          : preditivas.length
            ? `Nenhum benefício mapeado para esta atividade na base atual da Reforma — tributação integral (regra geral). Pistas informativas pelos nomes do sistema: ${preditivas.map((p) => `${p.codigoFormatado} — ${p.titulo}`).join('; ')} (não são decisão final). Confirme com o contador.`
            : 'Nenhum benefício mapeado para esta atividade na base atual da Reforma — tributação integral (regra geral). Confirme com o contador.',
        resultado: null,
        confiancaFinal: 0,
        hipoteses,
        coerencia: 'sem-base',
        preditivas,
      }
    }
    const teto = tetoConfiancaCnae(tabela.situacao)
    const confiancaFinal = Math.min(resultado.confiancaIa, teto)
    const motivo = teto < 1 && resultado.confiancaIa > teto
      ? `${resultado.motivo}/teto-matriz-ressalva`
      : resultado.motivo
    const coerencia = verificarCoerenciaServico(resultado.decisao?.cClassTrib, hipoteses)
    // Repassa as preditivas do GATE (quando a confiança não é alta ou há
    // regra geral, o determinístico já anexou pistas informativas).
    const preditivasGate = resultado.sugestao?.sugestoesPreditivas ?? []
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
      preditivas: preditivasGate,
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
      preditivas: [],
    }
  }
}

/* ------------------------------------------------- Phase 9 / 09-04: enriquecimento --- */

/** Enriquecimento vazio (fallback honesto — nunca quebra o GATE Phase 7). */
function enriquecimentoVazio(
  regras: RegraCnae | null,
): Pick<AtividadeCnae, 'estadoNbs' | 'nbsLista' | 'nbsComBeneficio' | 'maisProvavel'> {
  if (regras?.estado === 'ok' && regras.ehBens) {
    return { estadoNbs: 'bens→NCM', nbsLista: [], nbsComBeneficio: 0, maisProvavel: null }
  }
  return { estadoNbs: 'sem-mapeamento-NBS', nbsLista: [], nbsComBeneficio: 0, maisProvavel: null }
}

/**
 * Camada 2 best-effort via `consultarPorCnae` (cache por NBS — no CNPJ com
 * 98 NBS o cache evita 98× `calcularTributos`, B.3). Nunca lança: falha vira
 * enriquecimento vazio e o fallback Phase 7 segue intacto.
 */
async function enriquecimentoBestEffort(
  cnae7: string,
  anoReferencia: number,
  regras: RegraCnae | null,
): Promise<Pick<AtividadeCnae, 'estadoNbs' | 'nbsLista' | 'nbsComBeneficio' | 'maisProvavel'>> {
  try {
    const c = await consultarPorCnae(cnae7, { anoReferencia })
    return {
      estadoNbs: c.estadoNbs,
      nbsLista: c.vereditos,
      nbsComBeneficio: c.vereditos.filter((v) => v.temBeneficio).length,
      maisProvavel: c.maisProvavel,
    }
  } catch {
    return enriquecimentoVazio(regras)
  }
}

/**
 * GATE Phase 7 + camadas Phase 9 (09-04): após o GATE, camada 1
 * `regrasDoCnae` SEMPRE + camada 2 best-effort via `consultarPorCnae`.
 * `anoReferencia` default 2033 (regime pleno).
 */
async function classificarAtividade(
  cnae7: string,
  descricaoApi: string,
  principal: boolean,
  opts?: { anoReferencia?: number },
): Promise<AtividadeCnae> {
  const ano = normalizarAnoReferencia(opts?.anoReferencia ?? ANO_REFERENCIA_PADRAO)
  const base = await classificarAtividadeGate(cnae7, descricaoApi, principal)
  let regras: RegraCnae | null = null
  try {
    regras = await regrasDoCnae(cnae7)
  } catch {
    regras = null
  }
  const enr = await enriquecimentoBestEffort(cnae7, ano, regras)
  return { ...base, regras, ...enr, anoReferencia: ano }
}

/**
 * Consulta completa por CNPJ. `forcarAtualizacao` ignora o cache.
 * Nunca lança — erro de rede/DV vira `Error` apenas para DV inválido;
 * demais falhas retornam veredito parcial com atividades em `falha`.
 * `anoReferencia` (default 2033) precifica o enriquecimento NBS (09-04).
 */
export async function consultarPorCnpj(
  cnpjBruto: string,
  opts?: { forcarAtualizacao?: boolean; fetchFn?: typeof fetch; anoReferencia?: number },
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
  const ano = normalizarAnoReferencia(opts?.anoReferencia ?? ANO_REFERENCIA_PADRAO)
  for (let i = 0; i < fila.length; i += CONCORRENCIA) {
    const fatia = fila.slice(i, i + CONCORRENCIA)
    const resultados = await Promise.all(
      fatia.map((f) => classificarAtividade(f.codigo, f.descricao, f.principal, { anoReferencia: ano })),
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
    anoReferencia: ano,
  }
  void registrarAuditoria('consultas_cnpj', `${cnpj} — ${razaoSocial}`.slice(0, 80), 'criar', null, {
    atividades: atividades.length,
    doCache,
    resumo: veredito.resumo,
  })
  return veredito
}
