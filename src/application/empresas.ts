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
}

export async function listarEmpresas(): Promise<Empresa[]> {
  const lista = await db.empresas.toArray()
  return lista.sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'))
}

/** Busca por CNPJ normalizado (índice `cnpj` da v5; fallback linear na v4). */
export async function buscarEmpresaPorCnpj(cnpjBruto: string): Promise<Empresa | null> {
  const cnpj = norm(cnpjBruto)
  if (cnpj.length !== 14) return null
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
  endereco?: string
  cidade?: string
  uf?: string
  cep?: string
  telefone?: string
  email?: string
}

const limpo = (v: unknown): string => String(v ?? '').trim()

/** Preenche só os campos vazios — nunca apaga dado já cadastrado. */
export function mesclarEmpresa(base: Empresa, patch: Partial<Empresa>): Empresa {
  const out = { ...base }
  const chaves: (keyof Empresa)[] = [
    'razaoSocial', 'fantasia', 'ie', 'im', 'regimeTributario', 'endereco',
    'cidade', 'uf', 'cep', 'telefone', 'email',
  ]
  for (const k of chaves) {
    const novo = limpo(patch[k])
    if (novo && !limpo(out[k])) (out[k] as string) = novo
  }
  return out
}

/**
 * Cadastra uma empresa — **idempotente por CNPJ**.
 * - com CNPJ de 14 dígitos já existente: completa os campos vazios e devolve
 *   o registro (`atualizada: true`), sem duplicar;
 * - sem CNPJ: exige razão social (fluxo manual legado).
 */
export async function cadastrarEmpresa(dados: DadosCadastroEmpresa): Promise<ResultadoEmpresa> {
  const razaoSocial = limpo(dados.razaoSocial)
  const cnpjDigitos = norm(dados.cnpj)
  const cnpj = cnpjDigitos.length === 14 ? cnpjDigitos : limpo(dados.cnpj)

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
      return { ok: true, empresa: mesclada, atualizada: true }
    }
    if (!razaoSocial) return { ok: false, motivo: 'Informe a razão social.' }
    const empresa: Empresa = {
      razaoSocial,
      cnpj: cnpjDigitos,
      fantasia: limpo(dados.fantasia),
      ie: limpo(dados.ie),
      im: limpo(dados.im),
      endereco: limpo(dados.endereco),
      cidade: limpo(dados.cidade),
      uf: limpo(dados.uf),
      cep: limpo(dados.cep),
      telefone: limpo(dados.telefone),
      email: limpo(dados.email),
      criadoEm: new Date().toISOString(),
    }
    const id = await db.empresas.add(empresa)
    empresa.id = id
    return { ok: true, empresa }
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
 */
export async function cadastrarEmpresaPorCnpj(
  cnpjBruto: string,
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoEmpresa> {
  const dados = await buscarCnpj(cnpjBruto, fetchFn)
  return cadastrarEmpresa(dadosDaBrasilApi(dados))
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

export async function excluirEmpresa(id: number): Promise<void> {
  await db.empresas.delete(id)
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
    const cnpj = norm((item as Empresa).cnpj)
    if (cnpj.length === 14 && (await buscarEmpresaPorCnpj(cnpj))) {
      const existente = (await buscarEmpresaPorCnpj(cnpj))!
      await db.empresas.put(mesclarEmpresa(existente, item as Empresa))
    } else {
      await db.empresas.add(item as Empresa)
    }
  }
  return { total: lote.length }
}

/** Baixa o modelo CSV de empresas (paridade com a v1). */
export function normalizarCnpjDeImportacao(v: unknown): string {
  return norm(v).length === 14 ? fmtCnpj(v) : String(v ?? '').trim()
}
