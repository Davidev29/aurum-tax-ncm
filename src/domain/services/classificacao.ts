import { REGRA_GERAL } from '../constants'
import type {
  Classificacao,
  DocumentosHabilitados,
  NomenclaturaNcm,
  ReclassificacaoManual,
  ReferenciaCClassTrib,
  ReferenciaTributaria,
  ResumoClassificacao,
  TabelaCst,
  TabelaCstClassTrib,
  VinculoNbs,
  VinculoNcm,
} from '../entities'
import { fmtNbs, fmtNcm, norm } from './format'

/** Peças resolvidas pelo repositório (join 3NF) antes de montar a classificação. */
export interface ContextoClassificacao {
  cstDetalhes: TabelaCst | null
  cstClassTribDetalhes: TabelaCstClassTrib | null
  referencia: ReferenciaCClassTrib | null
  nomenclatura?: NomenclaturaNcm | null
}

const simNao = (v: boolean | null | undefined): boolean | string | null =>
  v == null ? null : v

/**
 * União dos documentos habilitados da referência (`CST×cClassTrib`, fonte
 * primária) com os da CST (fonte genérica por CST).
 *
 * Motivo: 4 itens da referência vêm com `docs` tudo-falso (ex.: 410011,
 * 550024) enquanto a CST correspondente autoriza documentos — exibir só a
 * referência apaga a linha "Docs:" sem dizer "sem documento habilitado".
 * A união (OR) nunca nega um documento que uma das tabelas oficiais autoriza;
 * quando ambas são nulas, devolve `null` (UI omite a linha).
 */
function unirDocs(
  ref: DocumentosHabilitados | Partial<DocumentosHabilitados> | null | undefined,
  cst: DocumentosHabilitados | null | undefined,
): DocumentosHabilitados | null {
  if (!ref && !cst) return null
  const chaves = new Set([...Object.keys(ref ?? {}), ...Object.keys(cst ?? {})])
  const out: Record<string, boolean> = {}
  for (const k of chaves) {
    out[k] =
      (ref as Record<string, unknown> | undefined)?.[k] === true ||
      String((ref as Record<string, unknown> | undefined)?.[k] ?? '').toLowerCase() === 'sim' ||
      (cst as Record<string, unknown> | undefined)?.[k] === true ||
      String((cst as Record<string, unknown> | undefined)?.[k] ?? '').toLowerCase() === 'sim'
  }
  return out as DocumentosHabilitados
}

/**
 * Monta a classificação de um vínculo importado.
 *
 * Paridade: `resumo` é reconstruído pelo join 3NF (`cst|cClassTrib` →
 * tabelas auxiliares + referência), o que foi verificado contra as 2.345
 * linhas do arquivo original (ver `docs/SPEC-LOGICA-NEGOCIO.md` §2.4).
 */
export function montarClassificacao(
  vinculo: VinculoNcm | VinculoNbs,
  ctx: ContextoClassificacao,
): Classificacao {
  const { cstDetalhes, cstClassTribDetalhes, referencia } = ctx
  const pRedIBS = cstClassTribDetalhes?.pRedIBS ?? referencia?.pRedIBS ?? 0
  const pRedCBS = cstClassTribDetalhes?.pRedCBS ?? referencia?.pRedCBS ?? 0

  const resumo: ResumoClassificacao = {
    descricaoCClassTrib:
      cstClassTribDetalhes?.nome ||
      cstClassTribDetalhes?.descricao ||
      referencia?.descricao ||
      vinculo.baseLegal ||
      '',
    percentualReducaoIBS: pRedIBS ?? 0,
    percentualReducaoCBS: pRedCBS ?? 0,
    anexo: referencia?.anexo ?? null,
    urlLegislacao: referencia?.urlLegislacao ?? null,
    documentosHabilitados: unirDocs(referencia?.docs, cstDetalhes?.docs),
  }

  return {
    id: vinculo.id,
    codigo: vinculo.codigo,
    codigoFormatado:
      'codigoFormatado' in vinculo && vinculo.codigoFormatado
        ? vinculo.codigoFormatado
        : fmtNbs(vinculo.codigo),
    cst: vinculo.cst,
    cClassTrib: vinculo.cClassTrib,
    baseLegal: vinculo.baseLegal ?? '',
    descricao: vinculo.descricao || ctx.nomenclatura?.descricao || '',
    vinculo,
    cstDetalhes,
    cstClassTribDetalhes,
    referencia: montarReferencia(referencia, cstDetalhes, cstClassTribDetalhes),
    resumo,
    regraGeral: false,
  }
}

/**
 * Monta a classificação a partir de uma reclassificação manual do usuário.
 * Reaproveita o join 3NF da CST/cClassTrib escolhida (reduções, anexo, docs)
 * e carimba `manual` para que toda a UI/APIs sinalizem responsabilidade do usuário.
 */
export function montarClassificacaoManual(
  manual: ReclassificacaoManual,
  ctx: ContextoClassificacao,
): Classificacao {
  const { cstDetalhes, cstClassTribDetalhes, referencia } = ctx
  const cod = norm(manual.ncm)
  const pRedIBS = cstClassTribDetalhes?.pRedIBS ?? referencia?.pRedIBS ?? 0
  const pRedCBS = cstClassTribDetalhes?.pRedCBS ?? referencia?.pRedCBS ?? 0

  const resumo: ResumoClassificacao = {
    descricaoCClassTrib:
      cstClassTribDetalhes?.nome ||
      cstClassTribDetalhes?.descricao ||
      referencia?.descricao ||
      manual.descricao ||
      '',
    percentualReducaoIBS: pRedIBS ?? 0,
    percentualReducaoCBS: pRedCBS ?? 0,
    anexo: referencia?.anexo ?? null,
    urlLegislacao: manual.fonteUrl || referencia?.urlLegislacao || null,
    documentosHabilitados: referencia?.docs ?? cstDetalhes?.docs ?? null,
  }

  return {
    id: `MANUAL|${cod}`,
    codigo: cod,
    codigoFormatado: fmtNcm(cod),
    cst: manual.cst,
    cClassTrib: manual.cClassTrib,
    baseLegal: manual.fonteDescricao || cstClassTribDetalhes?.lcRef || 'Reclassificação manual do usuário',
    descricao: ctx.nomenclatura?.descricao || manual.descricao || '',
    vinculo: null,
    cstDetalhes,
    cstClassTribDetalhes,
    referencia: montarReferencia(referencia, cstDetalhes, cstClassTribDetalhes),
    resumo,
    regraGeral: false,
    manual,
  }
}

/** Fallback universal: CST 000 × cClassTrib 000001 (SPEC R2.4–R2.5). */
export function montarRegraGeral(
  codigo: string,
  ctx: ContextoClassificacao,
): Classificacao {
  const cod = norm(codigo)
  const cstDet = ctx.cstDetalhes ?? cstDetalhePadrao()
  const cctDet = ctx.cstClassTribDetalhes ?? cctDetalhePadrao()
  const lcRef = cctDet.lcRef || cctDet.lcRedacao || 'LC 214/2025 — Regra geral'

  const resumo: ResumoClassificacao = {
    descricaoCClassTrib: cctDet.nome || cctDet.descricao || 'Tributação integral — regra geral',
    percentualReducaoIBS: cctDet.pRedIBS ?? 0,
    percentualReducaoCBS: cctDet.pRedCBS ?? 0,
    anexo: null,
    urlLegislacao: null,
    documentosHabilitados: cstDet.docs ?? null,
  }

  const referencia: ReferenciaTributaria = {
    lcRef,
    reducaoAliquota: false,
    reducaoBcCst: false,
    monofasica: false,
    creditoPresumido: false,
    diferimento: false,
    anexo: null,
    urlLegislacao: null,
    documentos: cstDet.docs ?? {},
  }

  return {
    id: `REGRA|${cod}`,
    codigo: cod,
    codigoFormatado: fmtNcm(cod),
    cst: cstDet.codigo || REGRA_GERAL.cst,
    cClassTrib: cctDet.cClassTrib || REGRA_GERAL.cClassTrib,
    baseLegal: lcRef,
    descricao: ctx.nomenclatura ? ctx.nomenclatura.descricao : cctDet.descricao || '—',
    vinculo: null,
    cstDetalhes: cstDet,
    cstClassTribDetalhes: cctDet,
    referencia,
    resumo,
    regraGeral: true,
    heranca: null,
  }
}

/**
 * Herança por família: monta a classificação de um NCM sem vínculo exato a
 * partir do vínculo-modelo de um irmão (mesma subposição/posição/capítulo).
 *
 * O join 3NF (`ctx`) é o do vínculo-modelo — reduções, anexo, docs e base
 * legal vêm da base oficial, nunca inventados. O carimbo `heranca` + o
 * sufixo na `baseLegal` deixam auditável que o enquadramento foi herdado
 * (nível, prefixo, cobertura) e se exige confirmação (`aConfirmar`).
 */
export function montarClassificacaoHerdada(
  codigoConsultado: string,
  vinculoModelo: VinculoNcm | VinculoNbs,
  ctx: ContextoClassificacao,
  heranca: NonNullable<Classificacao['heranca']>,
): Classificacao {
  const base = montarClassificacao(vinculoModelo, ctx)
  const cod = norm(codigoConsultado)
  const nivelRotulo =
    heranca.nivel === 'subposicao' ? 'Subposição SH6' : heranca.nivel === 'posicao' ? 'Posição SH4' : 'Capítulo'
  return {
    ...base,
    id: `HERDADO|${heranca.origem}|${cod}`,
    codigo: cod,
    codigoFormatado: fmtNcm(cod),
    descricao: ctx.nomenclatura?.descricao || base.descricao,
    baseLegal: `${base.baseLegal} (herdado por família — ${nivelRotulo} ${heranca.prefixo})`,
    regraGeral: false,
    heranca,
  }
}

/**
 * Observação de herança para os cartões (cor `amber` quando a confirmar,
 * `emerald` quando cobertura total). Retorna `null` sem herança.
 */
export function observacaoHerancaFamilia(
  heranca: Classificacao['heranca'],
): import('../entities').Observacao | null {
  if (!heranca) return null
  const nivelRotulo =
    heranca.nivel === 'subposicao' ? 'subposição SH6' : heranca.nivel === 'posicao' ? 'posição SH4' : 'capítulo'
  const pct = heranca.vigentesNoPrefixo > 0
    ? Math.round((heranca.irmaosVinculados / heranca.vigentesNoPrefixo) * 100)
    : 0
  if (heranca.aConfirmar) {
    return {
      titulo: `🟡 Benefício herdado por família (${nivelRotulo} ${heranca.prefixo}) — a confirmar`,
      texto:
        `Este NCM não tem vínculo exato na base da Reforma, mas ${heranca.irmaosVinculados} irmão(s) da mesma ${nivelRotulo} ` +
        `têm o mesmo enquadramento (cobertura ${pct}%). A tributação abaixo é herdada por família e vale como hipótese ` +
        `qualificada: confirme a destinação/composição do produto e o anexo da LC 214/2025 antes de operar ou salvar.`,
      cor: 'amber',
    }
  }
  return {
    titulo: `🟢 Benefício herdado por família (${nivelRotulo} ${heranca.prefixo})`,
    texto:
      `Este NCM não tem vínculo exato na base, mas todos os irmãos vigentes da mesma ${nivelRotulo} ` +
      `têm o mesmo enquadramento oficial — a tributação abaixo é herdada por família, com lastro integral.`,
    cor: 'emerald',
  }
}

/**
 * Observação do fallback integral multi-opção (cor `slate`, distinta do âmbar
 * de "N classificações" e do âmbar de regra geral pura).
 *
 * Exibida ACIMA do cartão de tributação integral anexado como última opção
 * de um NCM com 2+ enquadramentos oficiais. Retorna `null` quando a
 * classificação não é fallback.
 */
export function observacaoIntegralFallback(
  cl: Pick<Classificacao, 'integralFallback'> | null | undefined,
): import('../entities').Observacao | null {
  if (!cl?.integralFallback) return null
  return {
    titulo: '🛡 Não se encaixa nessa qualificação? Aplique a tributação integral',
    texto:
      'Mesmo com regra prevista na Reforma, o produto pode não atender à qualificação ' +
      '(propósito, descrição, destinação, composição ou adquirente). ' +
      'Confira se seu produto realmente atende a essa família de NCM antes de usar um benefício: ' +
      'na dúvida, escriture pela tributação integral abaixo (CST 000/cClassTrib 000001, alíquota cheia, sem redução).',
    cor: 'slate',
  }
}

/** Objeto sintético usado quando o NCM não tem 8 dígitos (SPEC R2.9). */
export function classificacaoNcmInvalido(ncm: string): Classificacao {
  const cod = norm(ncm)
  return {
    id: `INVALIDO|${cod}`,
    codigo: cod,
    codigoFormatado: fmtNcm(cod),
    cst: REGRA_GERAL.cst,
    cClassTrib: REGRA_GERAL.cClassTrib,
    baseLegal: '',
    descricao: 'NCM inválido',
    vinculo: null,
    cstDetalhes: null,
    cstClassTribDetalhes: null,
    referencia: null,
    resumo: {
      descricaoCClassTrib: 'NCM inválido',
      percentualReducaoIBS: 0,
      percentualReducaoCBS: 0,
      anexo: null,
      urlLegislacao: null,
      documentosHabilitados: null,
    },
    regraGeral: true,
  }
}

/* ---------------------------------- interpretação única da entrada (NCM) -- */

/**
 * Interpretação ÚNICA do que o usuário digitou como NCM.
 *
 * Garantia "um motor": Consulta, Lote, XML e SPED classificam o mesmo
 * `codigo` de 8 dígitos pelo mesmo resolvedor — divergências passadas vinham
 * de cada tela normalizar a entrada à sua maneira (umas truncavam >8
 * dígitos em silêncio, outras recusavam). A política de cada tela (aceitar
 * ou não o truncado) continua própria, mas o `codigo` classificado e o
 * motivo (`kind`) vêm sempre daqui.
 */
export type EntradaNcmKind = 'ok' | 'truncado' | 'invalido'

export interface EntradaNcm {
  kind: EntradaNcmKind
  /** 8 dígitos quando `ok` ou `truncado`; dígitos crus quando `invalido`. */
  codigo: string
  /** Total de dígitos digitados (para o aviso de truncamento). */
  digitos: number
}

export function interpretarEntradaNcm(v: unknown): EntradaNcm {
  const digitos = norm(v)
  if (digitos.length === 8) return { kind: 'ok', codigo: digitos, digitos: 8 }
  if (digitos.length > 8) {
    return { kind: 'truncado', codigo: digitos.slice(0, 8), digitos: digitos.length }
  }
  return { kind: 'invalido', codigo: digitos, digitos: digitos.length }
}

/* -------------------------------------------------------------------------- */

function montarReferencia(
  ref: ReferenciaCClassTrib | null,
  cstDet: TabelaCst | null,
  cctDet: TabelaCstClassTrib | null,
): ReferenciaTributaria | null {
  if (!ref) return null
  return {
    lcRef: cctDet?.lcRef || ref.urlLegislacao || cstDet?.descricao || '',
    reducaoAliquota: simNao(ref.reducaoAliquota) ?? (cstDet?.indReducao ?? null),
    reducaoBcCst: simNao(ref.reducaoBC) ?? (cctDet?.indRedutorBC != null ? cctDet.indRedutorBC === 1 : null),
    monofasica: simNao(ref.monofasica) ?? (cctDet?.indMono != null ? cctDet.indMono === 1 : null),
    creditoPresumido: simNao(ref.creditoPresumido) ?? (cctDet?.indCredPres != null ? cctDet.indCredPres === 1 : null),
    diferimento: typeof ref.diferimento === 'boolean' ? ref.diferimento : null,
    anexo: ref.anexo ?? null,
    urlLegislacao: ref.urlLegislacao ?? null,
    documentos: (unirDocs(ref.docs, cstDet?.docs) ?? {}) as Partial<DocumentosHabilitados>,
  }
}

/** Literais de fallback da SPEC R2.4 (usados quando a base auxiliar está vazia). */
export function cstDetalhePadrao(): TabelaCst {
  return {
    codigo: REGRA_GERAL.cst,
    descricao: 'Tributação integral',
    indIBSCBS: true,
    indIBSCBSMono: false,
    indReducao: false,
    indDiferimento: false,
    indTransferenciaCredito: true,
    docs: {
      NFe: true, NFCe: true, CTe: true, CTeOS: true, BPe: true,
      BPeTM: true, NF3e: true, NFCom: true, NFSe: true,
    },
  }
}

export function cctDetalhePadrao(): TabelaCstClassTrib {
  return {
    id: '000|000001',
    cst: REGRA_GERAL.cst,
    cClassTrib: REGRA_GERAL.cClassTrib,
    nome: 'Tributação integral — regra geral',
    descricao: 'Regra geral da LC 214/2025.',
    lcRedacao: '',
    // Na v1 havia duas chaves com o mesmo conteúdo; aqui `lcRef` carrega o
    // literal completo para reproduzir o `baseLegal` do cartão.
    lcRef: 'LC 214/2025 — Regra geral',
    tipoAliquota: 'Integral',
    pRedIBS: 0,
    pRedCBS: 0,
    indRedutorBC: 0,
    indTribRegular: 1,
    indCredPres: 0,
    indMono: 0,
    indMonoReten: 0,
    indMonoRet: 0,
    indMonoDif: 0,
    creditoPara: null,
    inicioVigencia: null,
    fimVigencia: null,
    atualizadoEm: null,
  }
}

/**
 * Chip de condição dos cartões (SPEC `chipCondicao`).
 * Devolve `null` quando o valor não é conclusivo (nem ligado nem desligado).
 */
export function chipCondicao(valor: unknown): boolean | null {
  if (valor === 1 || valor === 'Sim' || valor === true) return true
  if (valor === 0 || valor === 'Não' || valor === false) return false
  return null
}

/* ------------------------------------------------- vigência NCM (permitido/negado) -- */

/**
 * NCM "negado" = removido da nomenclatura vigente (`Data_Fim` diferente de
 * `31/12/9999`). Na prática: extinto da TEC, passa a ser tributado por outro
 * NCM — a classificação antiga não pode ser apresentada como atual.
 */
export function isNcmExtinto(nomen: NomenclaturaNcm | null | undefined): boolean {
  return Boolean(nomen?.dataFim)
}

/**
 * Observação de extinção exibida acima dos cartões (cor `red`, mesmo padrão
 * de `ListaObservacoes`). Retorna `null` quando o NCM está vigente ou sem
 * nomenclatura (nesse caso a UI usa o fluxo "não localizado").
 */
export function observacaoExtincaoNcm(
  nomen: NomenclaturaNcm | null | undefined,
): import('../entities').Observacao | null {
  if (!isNcmExtinto(nomen)) return null
  const fim = nomen?.dataFim ?? '—'
  const atoFim = nomen?.atoFim ? ` (${nomen.atoFim})` : ''
  return {
    titulo: `⛔ NCM extinto em ${fim} — removido da nomenclatura vigente`,
    texto:
      `Este NCM foi excluído da TEC${atoFim} e está "negado" na tabela vigente. ` +
      'Ele passa a ser tributado por outro NCM (desmembramento, fusão ou reclassificação). ' +
      'A tributação abaixo — vínculo antigo ou regra geral — é apenas referência histórica: ' +
      'confira o NCM substituto na Resolução Gecex vigente antes de operar, emitir documento fiscal ou salvar o produto.',
    cor: 'red',
  }
}

/* --------------------------------------- vigência do cClassTrib (dIni/dFim) -- */

/**
 * Interpreta `DD/MM/AAAA`, `AAAA-MM-DD` ou ISO (`AAAA-MM-DDTHH…`) como data
 * local (meia-noite). Retorna `null` quando vazia ou inválida.
 */
export function parseDataVigencia(v: unknown): Date | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export type StatusVigenciaCct = 'vigente' | 'futura' | 'expirada'

/**
 * Situação do cClassTrib em `agora` (comparação por dia, não por hora).
 * Sem datas = vigente. `dIniVig` futuro = ainda não vale; `dFimVig` passado
 * = deixou de valer (a tributação pode ter mudado).
 */
export function statusVigenciaCct(
  inicioVigencia: unknown,
  fimVigencia: unknown,
  agora: Date = new Date(),
): StatusVigenciaCct {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
  const ini = parseDataVigencia(inicioVigencia)
  const fim = parseDataVigencia(fimVigencia)
  if (ini && hoje < ini) return 'futura'
  if (fim && hoje > fim) return 'expirada'
  return 'vigente'
}

/**
 * Observação de vigência do cClassTrib para os cartões. `null` quando vigente
 * (caso comum hoje — a base oficial vem com `dIniVig/dFimVig` nulos).
 */
export function observacaoVigenciaCct(
  cct: Pick<TabelaCstClassTrib, 'cClassTrib' | 'inicioVigencia' | 'fimVigencia'> | null | undefined,
  agora: Date = new Date(),
): import('../entities').Observacao | null {
  if (!cct) return null
  const st = statusVigenciaCct(cct.inicioVigencia, cct.fimVigencia, agora)
  if (st === 'vigente') return null
  if (st === 'futura') {
    return {
      titulo: `⏳ cClassTrib ${cct.cClassTrib} passa a valer em ${cct.inicioVigencia}`,
      texto:
        'Este enquadramento ainda não está em vigor na data de hoje. ' +
        'A tributação exibida é a futura (base CFF): confira se a operação ocorre dentro da vigência antes de emitir o documento fiscal.',
      cor: 'amber',
    }
  }
  return {
    titulo: `⛔ cClassTrib ${cct.cClassTrib} venceu em ${cct.fimVigencia} — vigência expirada`,
    texto:
      'Este enquadramento deixou de valer (a linha CFF indica fim de vigência). ' +
      'A tributação exibida é referência histórica e pode estar desatualizada: ' +
      'sincronize a base CFF ou importe a tabela vigente antes de operar.',
    cor: 'red',
  }
}
