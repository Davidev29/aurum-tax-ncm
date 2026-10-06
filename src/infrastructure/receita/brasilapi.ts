/**
 * Cliente da **BrasilAPI** (`brasilapi.com.br/api/cnpj/v1/{cnpj}`) — fonte
 * pública para completar cadastros a partir de um único CNPJ.
 *
 * Robustez:
 * - valida o CNPJ (14 dígitos) antes de qualquer rede;
 * - timeout com `AbortController` (12 s);
 * - erros mapeados em pt-BR (CNPJ inválido, não encontrado, limite, rede);
 * - cache em memória por execução (lote com CNPJ repetido não refaz fetch);
 * - nunca lança em lote — o chamador recebe `{ ok, motivo }` por item.
 */
import { norm } from '@/domain/services/format'
import { mensagemCnpjInvalido, validarCnpj } from '@/domain/services/cnpj'

export interface DadosCnpjBrasilApi {
  cnpj: string
  razaoSocial: string
  fantasia: string
  endereco: string
  cidade: string
  uf: string
  cep: string
  telefone: string
  email: string
  /** Phase 7 — atividades (CNAE 7 dígitos). Ausentes quando a fonte não informa. */
  cnaePrincipal?: string | null
  cnaePrincipalDescricao?: string | null
  cnaesSecundarios?: { codigo: string; descricao: string }[]
  porte?: string | null
  situacao?: string | null
  opcaoSimples?: boolean | null
}

interface CnaeSecundarioApi {
  codigo?: unknown
  descricao?: unknown
}

interface RespostaBrasilApi {
  cnpj?: unknown
  razao_social?: unknown
  nome_fantasia?: unknown
  logradouro?: unknown
  numero?: unknown
  complemento?: unknown
  bairro?: unknown
  municipio?: unknown
  uf?: unknown
  cep?: unknown
  ddd_telefone_1?: unknown
  ddd_telefone_2?: unknown
  email?: unknown
  /** Phase 7 — CNAE (número 7 dígitos ou `XXXX-X/XX`) + descrição. */
  cnae_fiscal?: unknown
  cnae_fiscal_descricao?: unknown
  cnaes_secundarios?: unknown
  porte?: unknown
  descricao_situacao_cadastral?: unknown
  opcao_pelo_simples?: unknown
}

const BASE = 'https://brasilapi.com.br/api/cnpj/v1'
const TIMEOUT_MS = 12000

const cache = new Map<string, DadosCnpjBrasilApi>()

const txt = (v: unknown): string => String(v ?? '').trim()

const digitos7 = (v: unknown): string | null => {
  const d = norm(v)
  return d.length === 7 ? d : null
}

const boolOuNulo = (v: unknown): boolean | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['sim', 's', '1', 'true'].includes(s)) return true
  if (['não', 'nao', 'n', '0', 'false'].includes(s)) return false
  return null
}

/** Normaliza a resposta da BrasilAPI para o shape interno. */
export function mapearRespostaBrasilApi(res: RespostaBrasilApi): DadosCnpjBrasilApi {
  const partesEnd = [txt(res.logradouro), txt(res.numero), txt(res.complemento), txt(res.bairro)]
    .filter(Boolean)
    .join(', ')
  const fone = txt(res.ddd_telefone_1) || txt(res.ddd_telefone_2)
  const secundarios = Array.isArray(res.cnaes_secundarios) ? res.cnaes_secundarios : []
  const cnaesSecundarios = (secundarios as CnaeSecundarioApi[])
    .map((s) => ({ codigo: digitos7(s?.codigo), descricao: txt(s?.descricao) }))
    .filter((s): s is { codigo: string; descricao: string } => s.codigo !== null)
  return {
    cnpj: norm(res.cnpj),
    razaoSocial: txt(res.razao_social),
    fantasia: txt(res.nome_fantasia),
    endereco: partesEnd,
    cidade: txt(res.municipio),
    uf: txt(res.uf).toUpperCase().slice(0, 2),
    cep: norm(res.cep),
    telefone: fone,
    email: txt(res.email),
    cnaePrincipal: digitos7(res.cnae_fiscal),
    cnaePrincipalDescricao: txt(res.cnae_fiscal_descricao) || null,
    cnaesSecundarios,
    porte: txt(res.porte) || null,
    situacao: txt(res.descricao_situacao_cadastral) || null,
    opcaoSimples: boolOuNulo(res.opcao_pelo_simples),
  }
}

export type ErroCnpj =
  | { codigo: 'cnpj-invalido'; mensagem: string }
  | { codigo: 'nao-encontrado'; mensagem: string }
  | { codigo: 'limite'; mensagem: string }
  | { codigo: 'rede'; mensagem: string }

/**
 * Busca um CNPJ na BrasilAPI. Lança `Error` com mensagem em pt-BR —
 * o UI transforma em toast e o lote em linha de erro.
 */
export async function buscarCnpj(
  cnpjBruto: string,
  fetchFn: typeof fetch = fetch,
): Promise<DadosCnpjBrasilApi> {
  const validado = validarCnpj(cnpjBruto)
  if (!validado.ok) {
    throw new Error(mensagemCnpjInvalido(validado.motivo ?? 'cnpj-tamanho'))
  }
  const cnpj = validado.cnpj
  const hit = cache.get(cnpj)
  if (hit) return hit

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resposta: Response
  try {
    resposta = await fetchFn(`${BASE}/${cnpj}`, { signal: ctrl.signal })
  } catch (e) {
    throw new Error(
      e instanceof DOMException && e.name === 'AbortError'
        ? 'BrasilAPI demorou a responder (timeout de 12 s). Tente de novo.'
        : 'Sem conexão com a BrasilAPI. Verifique a internet e tente de novo.',
    )
  } finally {
    clearTimeout(timer)
  }

  if (resposta.status === 404) {
    throw new Error('CNPJ não encontrado na BrasilAPI.')
  }
  if (resposta.status === 400) {
    throw new Error('CNPJ inválido para a BrasilAPI.')
  }
  if (resposta.status === 429) {
    throw new Error('Limite da BrasilAPI atingido. Aguarde um minuto e tente de novo.')
  }
  if (!resposta.ok) {
    throw new Error(`BrasilAPI indisponível (HTTP ${resposta.status}). Tente de novo.`)
  }

  let json: RespostaBrasilApi
  try {
    json = (await resposta.json()) as RespostaBrasilApi
  } catch {
    throw new Error('Resposta inválida da BrasilAPI.')
  }
  const dados = mapearRespostaBrasilApi(json)
  if (!dados.razaoSocial) {
    throw new Error('BrasilAPI devolveu o CNPJ sem razão social.')
  }
  cache.set(cnpj, dados)
  return dados
}

/** Limpa o cache em memória (testes). */
export function limparCacheBrasilApi(): void {
  cache.clear()
}

export interface ItemLoteCnpj {
  cnpj: string
  ok: boolean
  dados?: DadosCnpjBrasilApi
  motivo?: string
}

/**
 * Lote de CNPJs com concorrência limitada (padrão 3 — respeita o rate limit
 * da API pública). Nunca lança: cada item carrega seu próprio resultado.
 * Leve: processa em ondas, sem carregar tudo na memória de uma vez.
 */
export async function buscarCnpjsEmLote(
  cnpjs: string[],
  onProgress?: (feito: number, total: number) => void,
  fetchFn: typeof fetch = fetch,
  concorrencia = 3,
): Promise<ItemLoteCnpj[]> {
  const unicos: string[] = []
  const vistos = new Set<string>()
  for (const bruto of cnpjs) {
    const c = norm(bruto)
    if (!c || vistos.has(c)) continue
    if (c.length === 14 && !ehCnpjValidoLocal(c)) {
      // DV inválido: erro por item sem gastar rede
      vistos.add(c)
      unicos.push(c)
      continue
    }
    vistos.add(c)
    unicos.push(c)
  }
  const resultados: ItemLoteCnpj[] = new Array(unicos.length)
  let feito = 0
  const onda = async (inicio: number): Promise<void> => {
    const fatia = unicos.slice(inicio, inicio + concorrencia)
    await Promise.all(
      fatia.map(async (cnpj, k) => {
        try {
          const dados = await buscarCnpj(cnpj, fetchFn)
          resultados[inicio + k] = { cnpj, ok: true, dados }
        } catch (e) {
          resultados[inicio + k] = {
            cnpj,
            ok: false,
            motivo: e instanceof Error ? e.message : String(e),
          }
        }
        feito++
        onProgress?.(feito, unicos.length)
      }),
    )
    if (inicio + concorrencia < unicos.length) await onda(inicio + concorrencia)
  }
  if (unicos.length) await onda(0)
  return resultados
}

/** Extrai CNPJs (14 dígitos) de texto livre — textarea, CSV, planilha colada. */
export function extrairCnpjsDeTexto(texto: string): string[] {
  // Token a token (nunca atravessa quebras): cada CNPJ mascarado vira 14
  // dígitos após `norm`; sequências longas deslizam janela de 14.
  // C-008 lateral: filtra DV antes de enfileirar (não gasta fetch/rate-limit com impossível).
  const out: string[] = []
  const vistos = new Set<string>()
  for (const token of String(texto ?? '').split(/[\s;,|]+/)) {
    const d = norm(token)
    if (d.length < 14) continue
    for (let i = 0; i + 14 <= d.length; i++) {
      const c = d.slice(i, i + 14)
      if (!vistos.has(c) && ehCnpjValidoLocal(c)) {
        vistos.add(c)
        out.push(c)
      }
    }
  }
  return out
}

/** DV local inline (evita ciclo de import com domain/services/cnpj). */
function ehCnpjValidoLocal(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calc = (base: string, pesos: number[]): number => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const d1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(`${d.slice(0, 12)}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d[12] === String(d1) && d[13] === String(d2)
}
