/**
 * Casos de uso de **produtos**.
 *
 * ## O que muda em relação à v1
 * A v1 gravava sempre com `dbPut` sem `id` sobre uma store `autoIncrement`,
 * ou seja, **nunca fazia upsert por SKU**. Repetir "Salvar todos como produtos"
 * (lote ou SPED) duplicava o cadastro inteiro — ver `[BUG] L1237/L1684/L1810/L1026`.
 *
 * Aqui toda gravação passa por `upsertPorSku`: procura um registro com o mesmo
 * `codigo` **na mesma empresa** e, se encontrar, atualiza em vez de duplicar.
 * O comportamento é configurável (`forcar`) para que a tela possa perguntar ao
 * usuário antes de sobrescrever.
 */
import { fmtNcm, norm, parseMoeda, parseQtd, uid } from '@/domain/services/format'
import { REGRA_GERAL } from '@/domain/constants'
import type { Classificacao, ClassificacaoSnapshot, Produto } from '@/domain/entities'
import { db } from '@/infrastructure/db/schema'

/* --------------------------------------------------------------- mappers -- */

/**
 * Converte a classificação resolvida no snapshot congelado do produto
 * (paridade com o objeto `classificacaoSnapshot` da v1, SPEC D07).
 */
export function snapshotDe(cl: Classificacao): ClassificacaoSnapshot {
  const resumo = cl.resumo ?? null
  const det = cl.cstClassTribDetalhes ?? null
  return {
    codigo: cl.codigo,
    codigoFormatado: cl.codigoFormatado,
    cst: cl.cst,
    cClassTrib: cl.cClassTrib,
    descricao: cl.descricao,
    baseLegal: cl.baseLegal,
    pRedIBS: resumo?.percentualReducaoIBS ?? det?.pRedIBS ?? null,
    pRedCBS: resumo?.percentualReducaoCBS ?? det?.pRedCBS ?? null,
    anexo: resumo?.anexo ?? null,
    classificacao: resumo?.descricaoCClassTrib ?? cl.baseLegal ?? '',
    manual: cl.manual ?? null,
  }
}

export interface EntradaProduto {
  empresaId: number | null
  codigo: string
  nome: string
  ncm: string
  cfop?: string
  cstIcms?: string
  pis?: string
  cofins?: string
  quantidade?: number
  valorUnitario?: number
  classificacao: Classificacao
}

export type ResultadoSalvar =
  | { ok: true; status: 'criado' | 'atualizado'; produto: Produto }
  | { ok: false; motivo: string; existente?: Produto }

/* ------------------------------------------------------------- consultas --- */

/** Lista os produtos da empresa (ou todos quando `empresaId` é `null`). */
export async function listarProdutos(empresaId: number | null): Promise<Produto[]> {
  const lista = empresaId === null ? await db.produtos.toArray() : await db.produtos.where('empresaId').equals(empresaId).toArray()
  return lista.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'))
}

/**
 * Lista apenas os produtos **do escopo exato** — `null` devolve somente os
 * gravados sem empresa. Diferente de `listarProdutos`, que com `null` devolve
 * a base inteira para exibição.
 */
async function produtosNoEscopo(empresaId: number | null): Promise<Produto[]> {
  const lista = await listarProdutos(empresaId)
  return empresaId === null ? lista.filter((p) => (p.empresaId ?? null) === null) : lista
}

export async function buscarProduto(id: number): Promise<Produto | undefined> {
  return db.produtos.get(id)
}

/**
 * Procura o SKU **dentro da mesma empresa** — base do upsert.
 *
 * `empresaId === null` significa "sem empresa" e casa apenas com produtos
 * gravados sem empresa; nunca reaproveita um SKU de outra empresa (SPEC D12).
 */
export async function produtoPorSku(
  empresaId: number | null,
  codigo: string,
): Promise<Produto | undefined> {
  const alvo = await produtosNoEscopo(empresaId)
  return alvo.find((p) => p.codigo === codigo)
}

/* -------------------------------------------------------------- escrita ---- */

function validarForm(f: { codigo?: string; nome?: string; ncm?: string }): string | null {
  if (!f.codigo?.trim()) return 'Informe o SKU.'
  if (!f.nome?.trim()) return 'Informe o nome do produto.'
  if (norm(f.ncm).length !== 8) return 'NCM deve ter 8 dígitos.'
  return null
}

function validar(e: EntradaProduto): string | null {
  const erro = validarForm(e)
  if (erro) return erro
  if (!e.classificacao) return 'Escolha uma classificação na lateral.'
  return null
}

/**
 * Valida apenas os campos do formulário (SKU, nome e NCM) — na mesma ordem da
 * v1, para que a mensagem exibida ao usuário seja a primeira que falhar.
 */
export function validarFormularioProduto(f: {
  codigo?: string
  nome?: string
  ncm?: string
}): string | null {
  return validarForm(f)
}

/**
 * Salva um produto com **upsert por SKU**.
 *
 * @param editarId quando informado, atualiza esse registro (modo edição);
 * @param forcar   sobrescreve um SKU já existente sem pedir confirmação.
 */
export async function salvarProduto(
  e: EntradaProduto,
  opts: { editarId?: number | null; forcar?: boolean } = {},
): Promise<ResultadoSalvar> {
  const erro = validar(e)
  if (erro) return { ok: false, motivo: erro }

  const agora = new Date().toISOString()
  const ncm = norm(e.ncm)
  const snapshot = snapshotDe(e.classificacao)

  const base: Omit<Produto, 'id' | 'criadoEm'> = {
    empresaId: e.empresaId,
    codigo: e.codigo.trim(),
    nome: e.nome.trim(),
    ncm,
    cfop: e.cfop ?? '',
    cstIcms: e.cstIcms ?? '',
    pis: e.pis ?? '',
    cofins: e.cofins ?? '',
    quantidade: Number(e.quantidade ?? 0),
    valorUnitario: Number(e.valorUnitario ?? 0),
    cstReforma: e.classificacao.cst,
    cClassTrib: e.classificacao.cClassTrib,
    regraGeral: e.classificacao.regraGeral,
    classificacaoManual: e.classificacao.manual != null,
    classificacaoSnapshot: snapshot,
    baseLegal: e.classificacao.baseLegal,
    atualizadoEm: agora,
  }

  if (opts.editarId != null) {
    const anterior = await db.produtos.get(opts.editarId)
    if (!anterior) return { ok: false, motivo: 'Produto não encontrado para edição.' }
    const produto: Produto = { ...anterior, ...base, id: opts.editarId, criadoEm: anterior.criadoEm ?? agora }
    await db.produtos.put(produto)
    return { ok: true, status: 'atualizado', produto }
  }

  const existente = await produtoPorSku(e.empresaId, base.codigo)
  if (existente && !opts.forcar) {
    return { ok: false, motivo: `Já existe o SKU "${base.codigo}" nesta empresa.`, existente }
  }
  if (existente) {
    const produto: Produto = { ...existente, ...base, id: existente.id, criadoEm: existente.criadoEm ?? agora }
    await db.produtos.put(produto)
    return { ok: true, status: 'atualizado', produto }
  }

  const produto: Produto = { ...base, criadoEm: agora }
  const id = await db.produtos.add(produto)
  produto.id = id
  return { ok: true, status: 'criado', produto }
}

export async function excluirProduto(id: number): Promise<void> {
  await db.produtos.delete(id)
}

/**
 * Atualiza **apenas** quantidade/valor unitário de um produto existente
 * (é o que a calculadora faz ao salvar — SPEC R7.11).
 */
export async function atualizarValoresProduto(
  id: number,
  quantidade: number,
  valorUnitario: number,
): Promise<void> {
  const atual = await db.produtos.get(id)
  if (!atual) return
  await db.produtos.put({
    ...atual,
    quantidade,
    valorUnitario,
    atualizadoEm: new Date().toISOString(),
  })
}

/** Dados de um item manual da calculadora, prontos para virar produto. */
export interface ItemManualCalc {
  ncm: string
  nome: string
  cst: string
  cClassTrib: string
  descClass: string
  redIBS: number
  redCBS: number
  regraGeral: boolean
  baseLegal: string
  quantidade: number
  valorUnitario: number
}

/**
 * Monta a `Classificacao` sintética de um item manual — o snapshot gravado no
 * produto preserva as reduções congeladas do momento da simulação (SPEC R7.12).
 */
export function classificacaoDeItemManual(it: ItemManualCalc): Classificacao {
  const ncm = norm(it.ncm)
  return {
    id: `MANUAL|${ncm}`,
    codigo: ncm,
    codigoFormatado: fmtNcm(ncm),
    cst: it.cst || REGRA_GERAL.cst,
    cClassTrib: it.cClassTrib || REGRA_GERAL.cClassTrib,
    baseLegal: it.baseLegal,
    descricao: it.nome,
    vinculo: null,
    cstDetalhes: null,
    cstClassTribDetalhes: null,
    referencia: null,
    resumo: {
      descricaoCClassTrib: it.descClass,
      percentualReducaoIBS: it.redIBS,
      percentualReducaoCBS: it.redCBS,
      anexo: null,
      urlLegislacao: null,
      documentosHabilitados: null,
    },
    regraGeral: it.regraGeral,
  }
}

/* ------------------------------------------------------- gravações em lote -- */

export interface ItemLoteGravavel {
  codigo: string
  nome: string
  ncm: string
  cfop?: string
  cstIcms?: string
  pis?: string
  cofins?: string
  /** Opcional: quando conhecidos (SPED), gravados diretamente. */
  quantidade?: number
  valorUnitario?: number
  classificacao: Classificacao
}

export interface ContagemLote {
  salvos: number
  atualizados: number
  ignorados: number
}

/**
 * Grava uma lista de produtos **com upsert por SKU** — é a correção do bug de
 * duplicação: reexecutar a ação não cria linhas repetidas.
 *
 * Linhas sem SKU ou sem classificação são contadas como `ignorados`, como na v1.
 */
export async function salvarProdutosEmLote(
  itens: ItemLoteGravavel[],
  empresaId: number | null,
  onProgress?: (feito: number, total: number) => void,
): Promise<ContagemLote> {
  const existentes = await produtosNoEscopo(empresaId)
  const porSku = new Map(existentes.map((p) => [p.codigo, p]))
  const agora = new Date().toISOString()

  const contagem: ContagemLote = { salvos: 0, atualizados: 0, ignorados: 0 }
  const fila: Produto[] = []

  for (const it of itens) {
    const codigo = it.codigo?.trim()
    if (!codigo || !it.classificacao) {
      contagem.ignorados++
      continue
    }
    const snapshot = snapshotDe(it.classificacao)
    const comum: Omit<Produto, 'id' | 'criadoEm' | 'atualizadoEm'> = {
      empresaId,
      codigo,
      nome: it.nome?.trim() || codigo,
      ncm: norm(it.ncm),
      cfop: it.cfop ?? '',
      cstIcms: it.cstIcms ?? '',
      pis: it.pis ?? '',
      cofins: it.cofins ?? '',
      quantidade: it.quantidade ?? 0,
      valorUnitario: it.valorUnitario ?? 0,
      cstReforma: it.classificacao.cst,
      cClassTrib: it.classificacao.cClassTrib,
      regraGeral: it.classificacao.regraGeral,
      classificacaoManual: it.classificacao.manual != null,
      classificacaoSnapshot: snapshot,
      baseLegal: it.classificacao.baseLegal,
    }
    const anterior = porSku.get(codigo)
    if (anterior) {
      fila.push({ ...anterior, ...comum, id: anterior.id, criadoEm: anterior.criadoEm ?? agora, atualizadoEm: agora })
      contagem.atualizados++
    } else {
      const novo: Produto = { ...comum, criadoEm: agora, atualizadoEm: agora }
      fila.push(novo)
      contagem.salvos++
    }
    if (onProgress && contagem.salvos % 50 === 0) onProgress(fila.length, itens.length)
  }

  // Uma única transação: ou tudo entra, ou nada entra.
  await db.produtos.bulkPut(fila as never[])
  onProgress?.(fila.length, itens.length)
  return contagem
}

/* ----------------------------------------------------------- apresentação -- */

/** Linha enriquecida exibida na tabela de produtos (paridade com `produtoCompleto`). */
export type ProdutoLinha = Produto & {
  redIBS: number
  redCBS: number
  descClass: string
  empresaNome: string | null
  total: number
}

export function produtoLinha(p: Produto, empresas: Map<number, string>): ProdutoLinha {
  const c = p.classificacaoSnapshot ?? ({} as ClassificacaoSnapshot)
  return {
    ...p,
    redIBS: Number(c.pRedIBS ?? 0),
    redCBS: Number(c.pRedCBS ?? 0),
    descClass: c.classificacao || p.baseLegal || '—',
    empresaNome: p.empresaId != null ? empresas.get(p.empresaId) ?? `Empresa #${p.empresaId}` : null,
    total: Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0),
  }
}

/** Campos brutos do formulário de produto (texto, já com máscaras). */
export interface FormularioProduto {
  codigo: string
  nome: string
  ncm: string
  cfop?: string
  cstIcms?: string
  pis?: string
  cofins?: string
  qtd?: string
  valor?: string
}

/** Valores de formulário → `EntradaProduto` (máscaras da v1). */
export function entradaProdutoDeFormulario(
  form: FormularioProduto,
  classificacao: Classificacao,
  empresaId: number | null,
): EntradaProduto {
  return {
    empresaId,
    codigo: String(form.codigo ?? '').trim(),
    nome: String(form.nome ?? '').trim(),
    ncm: norm(form.ncm),
    cfop: form.cfop ?? '',
    cstIcms: form.cstIcms ?? '',
    pis: form.pis ?? '',
    cofins: form.cofins ?? '',
    quantidade: parseQtd(form.qtd ?? ''),
    valorUnitario: parseMoeda(form.valor ?? ''),
    classificacao,
  }
}

/** Converte um produto em item da calculadora, com a mesma forma da v1. */
export function produtoParaCalculadora(p: Produto) {
  const c = p.classificacaoSnapshot ?? ({} as ClassificacaoSnapshot)
  return {
    uid: uid(),
    origem: 'produto' as const,
    produtoId: p.id ?? null,
    codigo: p.codigo,
    nome: p.nome,
    ncm: p.ncm,
    cst: p.cstReforma,
    cClassTrib: p.cClassTrib,
    descClass: c.classificacao || p.baseLegal || '—',
    redIBS: Number(c.pRedIBS ?? 0),
    redCBS: Number(c.pRedCBS ?? 0),
    regraGeral: p.regraGeral || p.cstReforma === '000',
    quantidade: Number(p.quantidade) || 1,
    valorUnitario: Number(p.valorUnitario) || 0,
    baseLegal: p.baseLegal ?? '',
  }
}

export { fmtNcm }
