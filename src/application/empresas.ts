/**
 * Casos de uso de **empresas**.
 *
 * A sessão (empresa ativa) vive no `localStorage` sob `SESSION_KEY`, exatamente
 * como na v1, para que a seleção sobreviva ao reinício do app.
 *
 * Idempotência: o CNPJ normalizado (14 dígitos) é a chave natural — cadastrar
 * o mesmo CNPJ duas vezes **atualiza** o registro existente em vez de duplicar.
 * O banco ganha índice `cnpj` na v5 para essa busca ser O(1).
 */
import { SESSION_KEY } from '@/domain/constants'
import { fmtCnpj, norm } from '@/domain/services/format'
import type { Empresa } from '@/domain/entities'
import type { DbOp } from '@/infrastructure/db/db-protocolo'
import { executarOp, resolverDriver } from '@/infrastructure/db/motor'
import { db } from '@/infrastructure/db/schema'
import {
  buscarCnpj,
  buscarCnpjsEmLote,
  type DadosCnpjBrasilApi,
} from '@/infrastructure/receita/brasilapi'

export interface ResultadoEmpresa {
  ok: boolean
  motivo?: string
  empresa?: Empresa
  /** `true` quando o CNPJ já existia e foi atualizado (idempotência). */
  atualizada?: boolean
  /** Notas órfãs/quarentena adotadas automaticamente neste cadastro. */
  adotadas?: number
}

export async function listarEmpresas(): Promise<Empresa[]> {
  const lista = await db.empresas.toArray()
  return lista.sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'))
}

/** Busca por CNPJ normalizado (índice `cnpj` da v5; fallback linear na v4). */
export async function buscarEmpresaPorCnpj(cnpjBruto: string): Promise<Empresa | null> {
  // C-008 lateral: DV antes do lookup — CNPJ impossível nem chega ao banco
  const { ehCnpjValido } = await import('@/domain/services/cnpj')
  if (!ehCnpjValido(cnpjBruto)) return null
  const cnpj = norm(cnpjBruto)
  try {
    const achada = await db.empresas.where('cnpj').equals(cnpj).first()
    if (achada) return achada
  } catch {
    /* banco pré-v5 sem o índice — cai no scan abaixo */
  }
  const todas = await db.empresas.toArray()
  return todas.find((e) => norm(e.cnpj) === cnpj) ?? null
}

export interface DadosCadastroEmpresa {
  razaoSocial: string
  cnpj?: string
  fantasia?: string
  ie?: string
  im?: string
  regimeTributario?: 'simples' | 'mei' | 'normal'
  endereco?: string
  cidade?: string
  uf?: string
  cep?: string
  telefone?: string
  email?: string
  contadorTipo?: 'pf' | 'pj' | null
  contadorNome?: string | null
  contadorDoc?: string | null
  contadorCrc?: string | null
  contadorEmail?: string | null
  contadorTelefone?: string | null
}

const limpo = (v: unknown): string => String(v ?? '').trim()

/** Preenche só os campos vazios — nunca apaga dado já cadastrado. */
export function mesclarEmpresa(base: Empresa, patch: Partial<Empresa>): Empresa {
  const out = { ...base }
  const chaves: (keyof Empresa)[] = [
    'razaoSocial', 'fantasia', 'ie', 'im', 'regimeTributario', 'endereco',
    'cidade', 'uf', 'cep', 'telefone', 'email',
    'contadorTipo', 'contadorNome', 'contadorDoc', 'contadorCrc',
    'contadorEmail', 'contadorTelefone',
  ]
  for (const k of chaves) {
    const novo = limpo(patch[k] as unknown)
    if (novo && !limpo(out[k] as unknown)) (out[k] as string) = novo
  }
  return out
}

/**
 * Normaliza o bloco do contador antes de gravar: sem tipo ou sem
 * nome/documento, o bloco inteiro é limpo (campo condicional — não aparece
 * quando vazio). PJ com 14 dígitos e PF com 11 dígitos; outro tamanho é
 * recusado com motivo em pt-BR.
 */
export function normalizarContador(patch: Partial<Empresa>): { ok: boolean; motivo?: string; patch: Partial<Empresa> } {
  const tipo = (patch.contadorTipo ?? null) as 'pf' | 'pj' | null | undefined
  const nome = limpo(patch.contadorNome)
  const doc = norm(patch.contadorDoc)
  const crc = limpo(patch.contadorCrc)
  const email = limpo(patch.contadorEmail)
  const telefone = limpo(patch.contadorTelefone)
  const temAlgo = Boolean(tipo || nome || doc || crc || email || telefone)
  if (!temAlgo) {
    return { ok: true, patch: { contadorTipo: null, contadorNome: null, contadorDoc: null, contadorCrc: null, contadorEmail: null, contadorTelefone: null } }
  }
  if (tipo !== 'pf' && tipo !== 'pj') return { ok: false, motivo: 'Informe se o contador é pessoa física ou jurídica.', patch: {} }
  if (!nome) return { ok: false, motivo: 'Informe o nome do contador.', patch: {} }
  if (tipo === 'pf' && doc.length !== 11) return { ok: false, motivo: 'CPF do contador deve ter 11 dígitos.', patch: {} }
  if (tipo === 'pj' && doc.length !== 14) return { ok: false, motivo: 'CNPJ do contador deve ter 14 dígitos.', patch: {} }
  return {
    ok: true,
    patch: {
      contadorTipo: tipo,
      contadorNome: nome,
      contadorDoc: doc,
      contadorCrc: crc || null,
      contadorEmail: email || null,
      contadorTelefone: telefone || null,
    },
  }
}

/**
 * Cadastra uma empresa — **idempotente por CNPJ**.
 * - com CNPJ de 14 dígitos já existente: completa os campos vazios e devolve
 *   o registro (`atualizada: true`), sem duplicar;
 * - sem CNPJ: exige razão social (fluxo manual legado).
 *
 * Após gravar, adota automaticamente as notas órfãs/quarentena do CNPJ
 * (best-effort, nunca quebra o cadastro).
 */
export async function cadastrarEmpresa(dados: DadosCadastroEmpresa): Promise<ResultadoEmpresa> {
  const razaoSocial = limpo(dados.razaoSocial)
  const cnpjDigitos = norm(dados.cnpj)
  // Sem 14 dígitos não há CNPJ: cai no fluxo manual legado (`''`), em vez
  // de gravar texto arbitrário que a validação do banco recusa (D1).
  const cnpj = cnpjDigitos.length === 14 ? cnpjDigitos : ''

  if (cnpjDigitos.length === 14) {
    const existente = await buscarEmpresaPorCnpj(cnpjDigitos)
    if (existente) {
      const mesclada = mesclarEmpresa(existente, {
        razaoSocial: razaoSocial || undefined,
        fantasia: limpo(dados.fantasia) || undefined,
        ie: limpo(dados.ie) || undefined,
        im: limpo(dados.im) || undefined,
        endereco: limpo(dados.endereco) || undefined,
        cidade: limpo(dados.cidade) || undefined,
        uf: limpo(dados.uf) || undefined,
        cep: limpo(dados.cep) || undefined,
        telefone: limpo(dados.telefone) || undefined,
        email: limpo(dados.email) || undefined,
      })
      await db.empresas.put(mesclada)
      const ad = await adotarNotasBestEffort(mesclada)
      return { ok: true, empresa: mesclada, atualizada: true, adotadas: ad?.adotadas ?? 0 }
    }
    if (!razaoSocial) return { ok: false, motivo: 'Informe a razão social.' }
    const normCont = normalizarContador({
      contadorTipo: dados.contadorTipo ?? null,
      contadorNome: dados.contadorNome ?? null,
      contadorDoc: dados.contadorDoc ?? null,
      contadorCrc: dados.contadorCrc ?? null,
      contadorEmail: dados.contadorEmail ?? null,
      contadorTelefone: dados.contadorTelefone ?? null,
    })
    if (!normCont.ok) return { ok: false, motivo: normCont.motivo }
    const temContador = Boolean(dados.contadorTipo || limpo(dados.contadorNome) || norm(dados.contadorDoc))
    const empresa: Empresa = {
      razaoSocial,
      cnpj: cnpjDigitos,
      fantasia: limpo(dados.fantasia),
      ie: limpo(dados.ie),
      im: limpo(dados.im),
      regimeTributario: dados.regimeTributario,
      endereco: limpo(dados.endereco),
      cidade: limpo(dados.cidade),
      uf: limpo(dados.uf),
      cep: limpo(dados.cep),
      telefone: limpo(dados.telefone),
      email: limpo(dados.email),
      criadoEm: new Date().toISOString(),
      ...(temContador ? normCont.patch : {}),
    }
    const id = await db.empresas.add(empresa)
    empresa.id = id
    const ad = await adotarNotasBestEffort(empresa)
    return { ok: true, empresa, adotadas: ad?.adotadas ?? 0 }
  }

  if (!razaoSocial) return { ok: false, motivo: 'Informe a razão social.' }
  const empresa: Empresa = {
    razaoSocial,
    cnpj,
    fantasia: limpo(dados.fantasia),
    criadoEm: new Date().toISOString(),
  }
  const id = await db.empresas.add(empresa)
  empresa.id = id
  return { ok: true, empresa }
}

/**
 * Adoção best-effort após (re)cadastro — nunca lança.
 * Import dinâmico para não ciclar com `notas-xml` (que importa
 * `completarEmpresa` daqui).
 */
async function adotarNotasBestEffort(empresa: Empresa): Promise<{ adotadas: number } | null> {
  try {
    const mod = await import('./notas-xml')
    const r = await mod.adotarNotasParaEmpresa(empresa)
    return { adotadas: r.adotadas }
  } catch {
    return null
  }
}

/** Converte o retorno da BrasilAPI em patch de cadastro. */
export function dadosDaBrasilApi(d: DadosCnpjBrasilApi): DadosCadastroEmpresa {
  return {
    razaoSocial: d.razaoSocial,
    cnpj: d.cnpj,
    fantasia: d.fantasia,
    endereco: d.endereco,
    cidade: d.cidade,
    uf: d.uf,
    cep: d.cep,
    telefone: d.telefone,
    email: d.email,
  }
}

/**
 * Cadastra/atualiza **só pelo CNPJ** — busca na BrasilAPI e grava idempotente.
 * O chamador (modal) mostra o preview antes de confirmar; aqui só executa.
 * A adoção das notas do CNPJ acontece dentro de `cadastrarEmpresa`.
 */
export async function cadastrarEmpresaPorCnpj(
  cnpjBruto: string,
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoEmpresa> {
  const dados = await buscarCnpj(cnpjBruto, fetchFn)
  return cadastrarEmpresa(dadosDaBrasilApi(dados))
}

export interface ResultadoCadastroNota {
  ok: boolean
  motivo?: string
  empresa?: Empresa
  atualizada?: boolean
  /** De onde veio o nome/endereço do cadastro. */
  fonte?: 'brasilapi' | 'xml'
  /** Quantas notas órfãs/quarentena foram adotadas. */
  adotadas?: number
  aviso?: string
}

/**
 * Cadastro do novo cliente a partir do CNPJ encontrado nas notas.
 *
 * 1. tenta a BrasilAPI (razão social, endereço, contatos oficiais);
 * 2. se a rede/limite/404 falhar, usa o nome que veio no XML (fallback) —
 *    o contribuinte nunca fica sem cadastro por falta de internet;
 * 3. em ambos os casos, adota automaticamente as notas órfãs/quarentena
 *    do CNPJ para o cadastro criado.
 */
export async function cadastrarEmpresaAPartirDeNota(
  cnpjBruto: string,
  opts?: { nomeFallback?: string; fetchFn?: typeof fetch },
): Promise<ResultadoCadastroNota> {
  const cnpj = norm(cnpjBruto)
  if (cnpj.length !== 14) return { ok: false, motivo: 'CNPJ deve ter exatamente 14 dígitos.' }
  try {
    const dados = await buscarCnpj(cnpj, opts?.fetchFn ?? fetch)
    const r = await cadastrarEmpresa(dadosDaBrasilApi(dados))
    if (!r.ok) return { ok: false, motivo: r.motivo }
    return { ok: true, empresa: r.empresa, atualizada: r.atualizada, fonte: 'brasilapi', adotadas: r.adotadas ?? 0 }
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    const nome = (opts?.nomeFallback ?? '').trim() || `Contribuinte ${fmtCnpj(cnpj)}`
    try {
      const r = await cadastrarEmpresa({ razaoSocial: nome, cnpj })
      if (!r.ok) return { ok: false, motivo: r.motivo }
      return {
        ok: true,
        empresa: r.empresa,
        atualizada: r.atualizada,
        fonte: 'xml',
        adotadas: r.adotadas ?? 0,
        aviso: `BrasilAPI indisponível (${motivo}) — cadastro com o nome do XML.`,
      }
    } catch (e2) {
      return { ok: false, motivo: e2 instanceof Error ? e2.message : String(e2) }
    }
  }
}

export interface ResumoLoteCnpj {
  novas: number
  atualizadas: number
  erros: { cnpj: string; motivo: string }[]
}

/**
 * Lote de CNPJs (manual ou colado): busca na BrasilAPI com concorrência
 * limitada e grava idempotente. Nunca lança — erros viram linhas do resumo.
 */
export async function importarEmpresasPorCnpjs(
  cnpjs: string[],
  onProgress?: (feito: number, total: number) => void,
  fetchFn: typeof fetch = fetch,
): Promise<ResumoLoteCnpj> {
  const resumo: ResumoLoteCnpj = { novas: 0, atualizadas: 0, erros: [] }
  const itens = await buscarCnpjsEmLote(cnpjs, onProgress, fetchFn)
  for (const item of itens) {
    if (!item.ok || !item.dados) {
      resumo.erros.push({ cnpj: item.cnpj, motivo: item.motivo ?? 'Falha na busca.' })
      continue
    }
    try {
      const r = await cadastrarEmpresa(dadosDaBrasilApi(item.dados))
      if (!r.ok) resumo.erros.push({ cnpj: item.cnpj, motivo: r.motivo ?? 'Não foi possível gravar.' })
      else if (r.atualizada) resumo.atualizadas++
      else resumo.novas++
    } catch (e) {
      resumo.erros.push({ cnpj: item.cnpj, motivo: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumo
}

export interface VinculosEmpresa {
  produtos: number
  notas: number
}

/**
 * Conta os vínculos da empresa — produtos do catálogo + notas XML importadas.
 * Usado pelo modal de detalhes (conferência) e pela confirmação de exclusão.
 * Nunca lança: banco fechado/ausente conta como 0.
 */
export async function contarVinculosEmpresa(id: number): Promise<VinculosEmpresa> {
  const contar = async (tabela: 'produtos' | 'nfeNotas'): Promise<number> => {
    try {
      return await db.table(tabela).where('empresaId').equals(id).count()
    } catch {
      return 0
    }
  }
  const [produtos, notas] = await Promise.all([contar('produtos'), contar('nfeNotas')])
  return { produtos, notas }
}

/** Prévia dos produtos da empresa para o modal de detalhes (ordenados por SKU). */
export async function listarProdutosResumoEmpresa(
  id: number,
  limite = 8,
): Promise<Array<{ id?: number; codigo: string; nome: string; ncm: string }>> {
  try {
    const lista = await db.produtos.where('empresaId').equals(id).limit(limite).toArray()
    return lista
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'))
      .map((p) => ({ id: p.id, codigo: p.codigo, nome: p.nome, ncm: p.ncm }))
  } catch {
    return []
  }
}

/**
 * Exclui a empresa e tudo vinculado (produtos + notas XML) em **transação
 * real**: as 3 remoções vão num único `transacionar(ops)` — tudo ou nada.
 * Sem driver transacional (ou IPC com main antigo sem `db:transaction`),
 * fallback sequencial com **falhas contabilizadas e lançadas em pt-BR**
 * (nunca `.catch(()=>{})` silencioso — exclusão meia-boca não passa em
 * silêncio).
 */
export async function excluirEmpresa(id: number): Promise<VinculosEmpresa> {
  const vinculos = await contarVinculosEmpresa(id)
  const ops: DbOp[] = [
    { op: 'removerOnde', tabela: 'produtos', where: { tipo: 'equals', campo: 'empresaId', valor: id } },
    { op: 'removerOnde', tabela: 'nfeNotas', where: { tipo: 'equals', campo: 'empresaId', valor: id } },
    { op: 'remover', tabela: 'empresas', chave: id },
  ]
  const driver = resolverDriver()
  if (typeof driver.transacionar === 'function') {
    try {
      await driver.transacionar(ops)
      return vinculos
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Só o main antigo (sem canal transacional) cai no sequencial abaixo;
      // falha real de transação é lançada em pt-BR.
      if (!/sem-transacao/.test(msg)) {
        throw new Error(`Não foi possível excluir a empresa: ${msg}`)
      }
    }
  }
  const falhas: string[] = []
  for (const op of ops) {
    try {
      await executarOp(driver, op)
    } catch (e) {
      falhas.push(`${op.op}/${String(op.tabela ?? '?')}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (falhas.length) {
    throw new Error(
      `Não foi possível excluir a empresa por completo (${falhas.length} falha(s)): ${falhas.join('; ')}.`,
    )
  }
  return vinculos
}

/**
 * Completa o cadastro com dados vindos de SPED/XML (IE/IM/endereço…).
 * Best-effort e silencioso: nunca lança — o importador não pode quebrar por
 * causa de um enriquecimento. Só preenche campos vazios.
 */
export async function completarEmpresa(
  id: number,
  patch: Partial<Empresa>,
): Promise<boolean> {
  try {
    const atual = await db.empresas.get(id)
    if (!atual) return false
    const mesclada = mesclarEmpresa(atual, patch)
    const mudou = JSON.stringify(mesclada) !== JSON.stringify(atual)
    if (mudou) await db.empresas.put(mesclada)
    return mudou
  } catch {
    return false
  }
}

/**
 * Atualiza os dados cadastrais da empresa (edição pela tela de detalhes).
 * Diferente de `mesclarEmpresa` (só preenche vazios), aqui o usuário edita
 * de verdade: campos enviados sobrescrevem, `''`/`null` limpam opcionais.
 * CNPJ exige 14 dígitos válidos (DV); razão social é obrigatória.
 * O bloco do contador passa por `normalizarContador` (condicional).
 */
export async function atualizarEmpresa(
  id: number,
  patch: Partial<Empresa>,
): Promise<ResultadoEmpresa> {
  const atual = await db.empresas.get(id).catch(() => null)
  if (!atual) return { ok: false, motivo: 'Empresa não encontrada.' }
  const razaoSocial = patch.razaoSocial !== undefined ? limpo(patch.razaoSocial) : limpo(atual.razaoSocial)
  if (!razaoSocial) return { ok: false, motivo: 'Informe a razão social.' }
  if (patch.cnpj !== undefined) {
    const d = norm(patch.cnpj)
    if (d !== '' && d.length !== 14) return { ok: false, motivo: 'CNPJ deve ter exatamente 14 dígitos.' }
    if (d.length === 14) {
      const { ehCnpjValido } = await import('@/domain/services/cnpj')
      if (!ehCnpjValido(d)) return { ok: false, motivo: 'CNPJ inválido (dígitos verificadores não conferem).' }
      const outra = await buscarEmpresaPorCnpj(d).catch(() => null)
      if (outra && outra.id !== id) return { ok: false, motivo: 'Este CNPJ já pertence a outra empresa cadastrada.' }
    }
  }
  if (patch.regimeTributario !== undefined && patch.regimeTributario !== null) {
    if (!['simples', 'mei', 'normal'].includes(String(patch.regimeTributario))) {
      return { ok: false, motivo: 'Regime tributário inválido.' }
    }
  }
  const temContador = ['contadorTipo', 'contadorNome', 'contadorDoc', 'contadorCrc', 'contadorEmail', 'contadorTelefone'].some(
    (k) => (patch as Record<string, unknown>)[k] !== undefined,
  )
  let blocoContador: Partial<Empresa> = {}
  if (temContador) {
    const combinado: Partial<Empresa> = {
      contadorTipo: patch.contadorTipo !== undefined ? patch.contadorTipo : (atual.contadorTipo ?? null),
      contadorNome: patch.contadorNome !== undefined ? patch.contadorNome : (atual.contadorNome ?? null),
      contadorDoc: patch.contadorDoc !== undefined ? patch.contadorDoc : (atual.contadorDoc ?? null),
      contadorCrc: patch.contadorCrc !== undefined ? patch.contadorCrc : (atual.contadorCrc ?? null),
      contadorEmail: patch.contadorEmail !== undefined ? patch.contadorEmail : (atual.contadorEmail ?? null),
      contadorTelefone: patch.contadorTelefone !== undefined ? patch.contadorTelefone : (atual.contadorTelefone ?? null),
    }
    const normCont = normalizarContador(combinado)
    if (!normCont.ok) return { ok: false, motivo: normCont.motivo }
    blocoContador = normCont.patch
  }
  const proxima: Empresa = {
    ...atual,
    razaoSocial,
    cnpj: patch.cnpj !== undefined ? (norm(patch.cnpj).length === 14 ? norm(patch.cnpj) : '') : atual.cnpj,
    fantasia: patch.fantasia !== undefined ? limpo(patch.fantasia) : atual.fantasia,
    ie: patch.ie !== undefined ? limpo(patch.ie) : (atual.ie ?? ''),
    im: patch.im !== undefined ? limpo(patch.im) : (atual.im ?? ''),
    regimeTributario: (patch.regimeTributario !== undefined ? (patch.regimeTributario as Empresa['regimeTributario']) : atual.regimeTributario) as Empresa['regimeTributario'],
    endereco: patch.endereco !== undefined ? limpo(patch.endereco) : (atual.endereco ?? ''),
    cidade: patch.cidade !== undefined ? limpo(patch.cidade) : (atual.cidade ?? ''),
    uf: patch.uf !== undefined ? limpo(patch.uf).toUpperCase().slice(0, 2) : (atual.uf ?? ''),
    cep: patch.cep !== undefined ? norm(patch.cep) || limpo(patch.cep) : (atual.cep ?? ''),
    telefone: patch.telefone !== undefined ? limpo(patch.telefone) : (atual.telefone ?? ''),
    email: patch.email !== undefined ? limpo(patch.email) : (atual.email ?? ''),
    ...blocoContador,
  }
  // "Não identificado": grava NULL (limpa o regime anterior) em vez de
  // omitir a chave (omitir manteria o valor antigo no upsert).
  if (patch.regimeTributario === null || (patch.regimeTributario as unknown) === '') {
    (proxima as unknown as Record<string, unknown>).regimeTributario = null
  }
  await db.empresas.put(proxima)
  return { ok: true, empresa: proxima }
}

/* --------------------------------------------------------------- sessão --- */

export function empresaAtivaId(): number | null {
  const bruto = localStorage.getItem(SESSION_KEY)
  if (!bruto) return null
  const n = Number(bruto)
  return Number.isFinite(n) ? n : null
}

export function definirEmpresaAtiva(id: number | null): void {
  if (id === null) localStorage.removeItem(SESSION_KEY)
  else localStorage.setItem(SESSION_KEY, String(id))
}

/** Resolve a empresa ativa a partir do id da sessão (ou `null`). */
export async function empresaAtiva(): Promise<Empresa | null> {
  const id = empresaAtivaId()
  if (id === null) return null
  return (await db.empresas.get(id)) ?? null
}

/**
 * Importa empresas de CSV/XLSX (fluxo legado: razão social + CNPJ).
 * A confirmação é responsabilidade da camada de UI; aqui só validamos e gravamos.
 */
export async function importarEmpresas(file: File): Promise<{ total: number }> {
  // Import dinâmico: o parser de planilha (xlsx) só carrega ao importar.
  const { importarEmpresasDoArquivo } = await import('@/infrastructure/parsers/lote')
  const lote = await importarEmpresasDoArquivo(file)
  // Idempotente: quem já existe por CNPJ é mesclado, não duplicado.
  for (const item of lote) {
    // CSV traz CNPJ mascarado (`fmtCnpj` no parser): normaliza para dígitos
    // (ou `''` = linha manual) antes de gravar — o banco recusa máscara (D1).
    const digitos = norm((item as Empresa).cnpj)
    const normalizada = { ...(item as Empresa), cnpj: digitos.length === 14 ? digitos : '' } as Empresa
    const cnpj = normalizada.cnpj
    if (cnpj.length === 14 && (await buscarEmpresaPorCnpj(cnpj))) {
      const existente = (await buscarEmpresaPorCnpj(cnpj))!
      await db.empresas.put(mesclarEmpresa(existente, normalizada))
    } else {
      await db.empresas.add(normalizada)
    }
  }
  return { total: lote.length }
}

/** Baixa o modelo CSV de empresas (paridade com a v1). */
export function normalizarCnpjDeImportacao(v: unknown): string {
  return norm(v).length === 14 ? fmtCnpj(v) : String(v ?? '').trim()
}
