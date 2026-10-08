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
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
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

export interface TributacaoAnteriorFluxo {
  cfopEntrada?: string
  cfopSaida?: string
  cstIcmsEntrada?: string
  cstIcmsSaida?: string
  pisEntrada?: string
  pisSaida?: string
  cofinsEntrada?: string
  cofinsSaida?: string
}

export interface EntradaProduto extends TributacaoAnteriorFluxo {
  empresaId: number | null
  codigo: string
  nome: string
  ncm: string
  /** Legado: quando os fluxos vêm vazios, o único preenche ambos. */
  cfop?: string
  cstIcms?: string
  pis?: string
  cofins?: string
  quantidade?: number
  valorUnitario?: number
  classificacao: Classificacao
}

/** Normaliza entrada/saída: legado preenche ambos; tudo vira string limpa. */
export function normalizarFluxo(e: Pick<EntradaProduto, keyof TributacaoAnteriorFluxo | 'cfop' | 'cstIcms' | 'pis' | 'cofins'>): Required<TributacaoAnteriorFluxo> {
  const limpa = (v: unknown): string => String(v ?? '').trim()
  const legado = {
    cfop: limpa((e as EntradaProduto).cfop),
    cstIcms: limpa((e as EntradaProduto).cstIcms),
    pis: limpa((e as EntradaProduto).pis),
    cofins: limpa((e as EntradaProduto).cofins),
  }
  return {
    cfopEntrada: limpa(e.cfopEntrada) || legado.cfop,
    cfopSaida: limpa(e.cfopSaida) || legado.cfop,
    cstIcmsEntrada: limpa(e.cstIcmsEntrada) || legado.cstIcms,
    cstIcmsSaida: limpa(e.cstIcmsSaida) || legado.cstIcms,
    pisEntrada: limpa(e.pisEntrada) || legado.pis,
    pisSaida: limpa(e.pisSaida) || legado.pis,
    cofinsEntrada: limpa(e.cofinsEntrada) || legado.cofins,
    cofinsSaida: limpa(e.cofinsSaida) || legado.cofins,
  }
}

/** Distribui um CFOP único para o fluxo certo pelo 1º dígito (1/2/3→entrada, 5/6/7→saída). */
export function distribuirCfopUnico(cfop: string): { cfopEntrada: string; cfopSaida: string } {
  const v = String(cfop ?? '').trim()
  const d = v.replace(/\D/g, '')[0]
  if (['1', '2', '3'].includes(d)) return { cfopEntrada: v, cfopSaida: '' }
  if (['5', '6', '7'].includes(d)) return { cfopEntrada: '', cfopSaida: v }
  return { cfopEntrada: v, cfopSaida: v }
}

/** Texto resumido do regime anterior (entrada × saída) para listagens. */
export function rotuloTributacaoAnterior(p: Pick<Produto, 'cfop' | 'cstIcms' | 'pis' | 'cofins'> & Partial<TributacaoAnteriorFluxo>): string {
  const f = normalizarFluxo(p as EntradaProduto)
  const ent = [f.cfopEntrada, f.cstIcmsEntrada, f.pisEntrada, f.cofinsEntrada].filter(Boolean).join('/')
  const sai = [f.cfopSaida, f.cstIcmsSaida, f.pisSaida, f.cofinsSaida].filter(Boolean).join('/')
  if (ent && sai) return `E:${ent} · S:${sai}`
  return ent || sai || [p.cfop, p.cstIcms, p.pis, p.cofins].filter(Boolean).join('/') || '—'
}

export type ResultadoSalvar =
  | { ok: true; status: 'criado' | 'atualizado'; produto: Produto; revalidada: boolean }
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
  const dig = norm(f.ncm)
  if (dig.length === 9) return 'NBS (9 dígitos) é só para serviços. Aqui é só produto: informe um NCM de 8 dígitos.'
  if (dig.length !== 8) return 'NCM deve ter 8 dígitos.'
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
 * Re-resolve o NCM no motor único, preservando a escolha (CST × cClassTrib)
 * quando ela continua válida; senão devolve a 1ª da lista vigente.
 * É o que impede gravar tributação divergente da Consulta para o mesmo NCM
 * (ex.: item da calculadora congelado antes de uma mudança de base).
 * A manual do usuário é devolvida pelo próprio resolvedor — nunca substituída.
 */
export async function reresolverClassificacao(
  ncm: string,
  escolha: { cst: string; cClassTrib: string },
): Promise<Classificacao | null> {
  try {
    const r = await resolverClassificacoes(ncm)
    if (!r.lista.length) return null
    return r.lista.find((c) => c.cst === escolha.cst && c.cClassTrib === escolha.cClassTrib) ?? r.lista[0]
  } catch {
    return null
  }
}

/**
 * Salva um produto com **upsert por SKU**.
 *
 * @param editarId quando informado, atualiza esse registro (modo edição);
 * @param forcar   sobrescreve um SKU já existente sem pedir confirmação.
 * @param reresolver quando `true`, a classificação é re-resolvida no motor
 * antes de gravar (caminho da calculadora, cujos valores são congelados na
 * adição). A escolha original é preservada se ainda válida; o retorno
 * indica `revalidada: true` quando a vigente diferiu.
 */
export async function salvarProduto(
  e: EntradaProduto,
  opts: { editarId?: number | null; forcar?: boolean; reresolver?: boolean } = {},
): Promise<ResultadoSalvar> {
  const erro = validar(e)
  if (erro) return { ok: false, motivo: erro }

  // Validação multiagente (sintaxe + auxiliar + coerência + reforma-imutável
  // + SKU): bloqueios impedem a escrita; avisos só sinalizam.
  try {
    const { validarProdutoMultiagente, primeiroBloqueio } = await import('@/domain/services/validacao-produto')
    const v = await validarProdutoMultiagente(e)
    if (!v.ok) return { ok: false, motivo: primeiroBloqueio(v) ?? 'Dados inválidos.' }
  } catch {
    /* validador indisponível: segue com a validação básica acima */
  }

  let cl = e.classificacao
  let revalidada = false
  if (opts.reresolver) {
    const viva = await reresolverClassificacao(e.ncm, { cst: cl.cst, cClassTrib: cl.cClassTrib })
    if (viva && (viva.cst !== cl.cst || viva.cClassTrib !== cl.cClassTrib || viva.regraGeral !== cl.regraGeral)) {
      cl = viva
      revalidada = true
    } else if (viva) {
      cl = viva
    }
  }

  const agora = new Date().toISOString()
  const ncm = norm(e.ncm)
  const snapshot = snapshotDe(cl)
  const fluxo = normalizarFluxo(e)

  const base: Omit<Produto, 'id' | 'criadoEm'> = {
    empresaId: e.empresaId,
    codigo: e.codigo.trim(),
    nome: e.nome.trim(),
    ncm,
    // Legado: primeiro valor disponível (compat com telas/relatórios antigos).
    cfop: fluxo.cfopEntrada || fluxo.cfopSaida || e.cfop || '',
    cstIcms: fluxo.cstIcmsEntrada || fluxo.cstIcmsSaida || e.cstIcms || '',
    pis: fluxo.pisEntrada || fluxo.pisSaida || e.pis || '',
    cofins: fluxo.cofinsEntrada || fluxo.cofinsSaida || e.cofins || '',
    ...fluxo,
    quantidade: Number(e.quantidade ?? 0),
    valorUnitario: Number(e.valorUnitario ?? 0),
    cstReforma: cl.cst,
    cClassTrib: cl.cClassTrib,
    regraGeral: cl.regraGeral,
    classificacaoManual: cl.manual != null,
    classificacaoSnapshot: snapshot,
    baseLegal: cl.baseLegal,
    atualizadoEm: agora,
  }

  if (opts.editarId != null) {
    const anterior = await db.produtos.get(opts.editarId)
    if (!anterior) return { ok: false, motivo: 'Produto não encontrado para edição.' }
    const produto: Produto = { ...anterior, ...base, id: opts.editarId, criadoEm: anterior.criadoEm ?? agora }
    await db.produtos.put(produto)
    return { ok: true, status: 'atualizado', produto, revalidada }
  }

  const existente = await produtoPorSku(e.empresaId, base.codigo)
  if (existente && !opts.forcar) {
    return { ok: false, motivo: `Já existe o SKU "${base.codigo}" nesta empresa.`, existente }
  }
  if (existente) {
    const produto: Produto = { ...existente, ...base, id: existente.id, criadoEm: existente.criadoEm ?? agora }
    await db.produtos.put(produto)
    return { ok: true, status: 'atualizado', produto, revalidada }
  }

  const produto: Produto = { ...base, criadoEm: agora }
  const id = await db.produtos.add(produto)
  produto.id = id
  return { ok: true, status: 'criado', produto, revalidada }
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

export interface ItemLoteGravavel extends Partial<TributacaoAnteriorFluxo> {
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
    const fluxo = normalizarFluxo(it as EntradaProduto)
    const comum: Omit<Produto, 'id' | 'criadoEm' | 'atualizadoEm'> = {
      empresaId,
      codigo,
      nome: it.nome?.trim() || codigo,
      ncm: norm(it.ncm),
      cfop: fluxo.cfopEntrada || fluxo.cfopSaida || it.cfop || '',
      cstIcms: fluxo.cstIcmsEntrada || fluxo.cstIcmsSaida || it.cstIcms || '',
      pis: fluxo.pisEntrada || fluxo.pisSaida || it.pis || '',
      cofins: fluxo.cofinsEntrada || fluxo.cofinsSaida || it.cofins || '',
      ...fluxo,
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
export interface FormularioProduto extends Partial<TributacaoAnteriorFluxo> {
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
    cfopEntrada: (form.cfopEntrada as string | undefined) ?? '',
    cfopSaida: (form.cfopSaida as string | undefined) ?? '',
    cstIcmsEntrada: (form.cstIcmsEntrada as string | undefined) ?? '',
    cstIcmsSaida: (form.cstIcmsSaida as string | undefined) ?? '',
    pisEntrada: (form.pisEntrada as string | undefined) ?? '',
    pisSaida: (form.pisSaida as string | undefined) ?? '',
    cofinsEntrada: (form.cofinsEntrada as string | undefined) ?? '',
    cofinsSaida: (form.cofinsSaida as string | undefined) ?? '',
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
    // A flag vem do motor no momento da gravação — nunca recomputada aqui.
    // (A heurística antiga `cst === '000'` marcava como "regra geral" até
    // vínculo oficial de tributação integral com CST 000, divergindo da
    // tela Produtos para o mesmo NCM.)
    regraGeral: p.regraGeral,
    quantidade: Number(p.quantidade) || 1,
    valorUnitario: Number(p.valorUnitario) || 0,
    baseLegal: p.baseLegal ?? '',
  }
}

export { fmtNcm }
