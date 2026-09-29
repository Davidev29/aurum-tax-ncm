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
  VinculoNcm,
} from '../entities'
import { fmtNcm, norm } from './format'

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
 * Monta a classificação de um vínculo importado.
 *
 * Paridade: `resumo` é reconstruído pelo join 3NF (`cst|cClassTrib` →
 * tabelas auxiliares + referência), o que foi verificado contra as 2.345
 * linhas do arquivo original (ver `docs/SPEC-LOGICA-NEGOCIO.md` §2.4).
 */
export function montarClassificacao(
  vinculo: VinculoNcm,
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
    documentosHabilitados: referencia?.docs ?? null,
  }

  return {
    id: vinculo.id,
    codigo: vinculo.codigo,
    codigoFormatado: vinculo.codigoFormatado,
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
    anexo: ref.anexo ?? null,
    urlLegislacao: ref.urlLegislacao ?? null,
    documentos: (ref.docs ?? {}) as Partial<DocumentosHabilitados>,
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
