import type {
  Classificacao,
  NomenclaturaNcm,
  ReclassificacaoManual,
  TabelaCst,
  TabelaCstClassTrib,
} from '@/domain/entities'
import { montarClassificacaoManual, type ContextoClassificacao } from '@/domain/services/classificacao'
import { norm } from '@/domain/services/format'
import { db } from '../db/schema'
import { registrarAuditoria } from '@/application/auditoria'

/** Busca a reclassificação manual de um NCM (ou `null`). */
export async function buscarReclassificacaoManual(codigo: unknown): Promise<ReclassificacaoManual | null> {
  const c = norm(codigo)
  if (c.length !== 8) return null
  try {
    return (await db.reclassificacoesManuais.get(c)) ?? null
  } catch {
    return null
  }
}

/** Monta a `Classificacao` manual com join 3NF da CST/cClassTrib escolhida. */
export async function classificacaoManual(
  manual: ReclassificacaoManual,
  nomenclatura?: NomenclaturaNcm | null,
): Promise<Classificacao> {
  const [cstDetalhes, cstClassTribDetalhes, referencia] = await Promise.all([
    db.cst.get(manual.cst).catch(() => null),
    db.cstClassTrib.get(`${manual.cst}|${manual.cClassTrib}`).catch(() => null),
    db.referencia.get(`${manual.cst}|${manual.cClassTrib}`).catch(() => null),
  ])
  const ctx: ContextoClassificacao = {
    cstDetalhes: (cstDetalhes ?? null) as ContextoClassificacao['cstDetalhes'],
    cstClassTribDetalhes: (cstClassTribDetalhes ?? null) as ContextoClassificacao['cstClassTribDetalhes'],
    referencia: (referencia ?? null) as ContextoClassificacao['referencia'],
    nomenclatura: nomenclatura ?? null,
  }
  return montarClassificacaoManual(manual, ctx)
}

export interface EntradaReclassificacao {
  ncm: string
  cst: string
  cClassTrib: string
  descricao: string
  fonteDescricao: string
  fonteUrl: string
}

function validarEntrada(e: EntradaReclassificacao): string | null {
  if (norm(e.ncm).length !== 8) return 'NCM deve ter 8 dígitos.'
  if (!e.cst.trim()) return 'Escolha a CST.'
  if (!e.cClassTrib.trim()) return 'Escolha a cClassTrib.'
  if (!e.descricao.trim()) return 'Descreva a justificativa.'
  if (!e.fonteDescricao.trim()) return 'Informe de onde tirou a informação (fonte).'
  if (!e.fonteUrl.trim()) return 'Informe o link da legislação/fonte.'
  try {
    const u = new URL(e.fonteUrl.trim())
    if (!['http:', 'https:'].includes(u.protocol)) return 'O link deve começar com http(s)://.'
  } catch {
    return 'O link informado não é uma URL válida.'
  }
  return null
}

/** Validação fiscal da combinação CST × cClassTrib contra a base vigente. */
export async function validarCombinacaoFiscal(
  cst: string,
  cClassTrib: string,
): Promise<string | null> {
  // Forma canônica com zeros à esquerda (o usuário digita `5`/`123`; a base
  // usa `005`/`000123` — mesma normalização do `idCstCct` dos auxiliares).
  if (!String(cst).trim() || !String(cClassTrib).trim()) return 'Escolha a CST e a cClassTrib.'
  const c = String(cst).replace(/\D/g, '').padStart(3, '0')
  const cc = String(cClassTrib).replace(/\D/g, '').padStart(6, '0')
  if (!c || !cc) return 'Escolha a CST e a cClassTrib.'
  try {
    const [cstRow, cctRow] = await Promise.all([
      db.cst.get(c).catch(() => null),
      db.cstClassTrib.get(`${c}|${cc}`).catch(() => null),
    ])
    if (!cstRow) return `CST ${c} não existe na base vigente — confira a LC 214/2025.`
    if (!cctRow) return `Combinação ${c} × ${cc} não existe na base vigente — escolha uma opção da lista oficial.`
  } catch {
    return null
  }
  return null
}

/** Salva (upsert por NCM) a reclassificação manual. */
export async function salvarReclassificacaoManual(
  e: EntradaReclassificacao,
): Promise<{ ok: true; manual: ReclassificacaoManual } | { ok: false; motivo: string }> {
  const erro = validarEntrada(e)
  if (erro) return { ok: false, motivo: erro }
  const fiscal = await validarCombinacaoFiscal(e.cst, e.cClassTrib)
  if (fiscal) return { ok: false, motivo: fiscal }
  const agora = new Date().toISOString()
  const ncm = norm(e.ncm)
  const anterior = await buscarReclassificacaoManual(ncm)
  const manual: ReclassificacaoManual = {
    ncm,
    cst: String(e.cst).replace(/\D/g, '').padStart(3, '0'),
    cClassTrib: String(e.cClassTrib).replace(/\D/g, '').padStart(6, '0'),
    descricao: e.descricao.trim(),
    fonteDescricao: e.fonteDescricao.trim(),
    fonteUrl: e.fonteUrl.trim(),
    criadoEm: anterior?.criadoEm ?? agora,
    atualizadoEm: agora,
  }
  await db.reclassificacoesManuais.put(manual)
  await registrarAuditoria('reclassificacoesManuais', ncm, anterior ? 'atualizar' : 'criar', anterior, manual)
  return { ok: true, manual }
}

/** Remove a reclassificação manual de um NCM (volta à regra geral). */
export async function removerReclassificacaoManual(codigo: unknown): Promise<void> {
  const c = norm(codigo)
  if (c.length !== 8) return
  const antes = await buscarReclassificacaoManual(c)
  await db.reclassificacoesManuais.delete(c)
  await registrarAuditoria('reclassificacoesManuais', c, 'excluir', antes, null)
}

/** Opção de classificação existente no sistema (auxílio do modal). */
export interface OpcaoClassificacaoExistente {
  id: string
  cst: string
  cClassTrib: string
  nome: string
  descricao: string
  pRedIBS: number | null
  pRedCBS: number | null
  lcRef: string | null
  anexo: string | null
  urlLegislacao: string | null
}

/** Lista as classificações existentes (tabela cClassTrib + referência) para o modal. */
export async function listarClassificacoesExistentes(limite = 500): Promise<OpcaoClassificacaoExistente[]> {
  const [ccts, refs, csts] = await Promise.all([
    db.cstClassTrib.limit(limite).toArray().catch((): Promise<TabelaCstClassTrib[]> => Promise.resolve([])),
    db.referencia.limit(limite).toArray().catch(() => []),
    db.cst.limit(limite).toArray().catch((): Promise<TabelaCst[]> => Promise.resolve([])),
  ])
  const refPorId = new Map(refs.map((r) => [r.id, r]))
  const cstDesc = new Map(csts.map((c) => [c.codigo, c.descricao]))
  return ccts
    .map((c) => {
      const ref = refPorId.get(c.id)
      const nome = c.nome || c.descricao || ref?.descricao || `${c.cst} × ${c.cClassTrib}`
      return {
        id: c.id,
        cst: c.cst,
        cClassTrib: c.cClassTrib,
        nome,
        descricao: `${c.cst} · ${c.cClassTrib} — ${nome}${cstDesc.get(c.cst) ? ` (CST: ${cstDesc.get(c.cst)})` : ''}`,
        pRedIBS: c.pRedIBS ?? ref?.pRedIBS ?? 0,
        pRedCBS: c.pRedCBS ?? ref?.pRedCBS ?? 0,
        lcRef: c.lcRef || c.lcRedacao || null,
        anexo: ref?.anexo ?? null,
        urlLegislacao: ref?.urlLegislacao ?? null,
      }
    })
    .sort((a, b) => a.cst.localeCompare(b.cst) || a.cClassTrib.localeCompare(b.cClassTrib))
}
