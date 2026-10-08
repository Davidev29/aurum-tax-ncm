/**
 * Cliente de **consulta CNPJ** com cadeia de provedores e fallback automático.
 *
 * Primário `brasilapi.com.br/api/cnpj/v1/{cnpj}`; fallbacks gratuitos sem
 * token: CNPJá Open → ReceitaWS → CNPJ.ws pública (auditoria: nenhum exige
 * cadastro e todos devolvem razão/CNAEs/situação/Simples).
 *
 * Por que o fallback existe (achados da auditoria, Oct/2026):
 * - browsers tratam `User-Agent` como *forbidden header* e o removem em
 *   silêncio — e o WAF da BrasilAPI devolve **403 sem ele**. O header é
 *   enviado mesmo assim (vale no Node/Electron-main), mas o renderer não
 *   pode contar com ele;
 * - BrasilAPI oscila (`500`/`AxiosError 503` frequentes) e os CNPJs de
 *   exemplo do app já caíram nela;
 * - ReceitaWS/CNPJ.ws não enviam `Access-Control-Allow-Origin` (só
 *   BrasilAPI e CNPJá liberam `*`): no renderer o `fetch` deles falha na
 *   hora (CORS) e a cadeia simplesmente avança — sem travar, sem 12 s.
 *
 * Robustez:
 * - valida o CNPJ (DV local) antes de qualquer rede;
 * - timeout com `AbortController` (12 s) por tentativa;
 * - `try/catch` classificado por tentativa: `nao-encontrado`/`limite`
 *   trocam de provedor na hora; `timeout`/`rede`/5xx retentam 1× (400 ms)
 *   antes de avançar; `400` com DV válido também avança (validadores
 *   divergem entre bases);
 * - erro final agregado em pt-BR (diz quais bases falharam e por quê);
 * - cache em memória por execução (lote com CNPJ repetido não refaz fetch);
 * - nunca lança em lote — o chamador recebe `{ ok, motivo }` por item.
 */
import { norm } from '@/domain/services/format'
import { mensagemCnpjInvalido, validarCnpj } from '@/domain/services/cnpj'

/** Base que respondeu (cadeia de fallback — auditoria Oct/2026). */
export type FonteCnpj = 'brasilapi' | 'cnpja' | 'receitaws' | 'cnpjws'

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
  /** Qual base respondeu (útil para auditoria/frescor na UI). */
  fonte?: FonteCnpj
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
const URL_CNPJA = 'https://open.cnpja.com/office'
const URL_RECEITA_WS = 'https://receitaws.com.br/v1/cnpj'
const URL_CNPJ_WS = 'https://publica.cnpj.ws/cnpj'
const TIMEOUT_MS = 12000

/**
 * `Accept` é permitido no browser; `User-Agent` é *forbidden header* (o
 * browser remove em silêncio) mas vale no Node/Electron-main — por isso é
 * enviado, sem depender dele (a cadeia de fallback assume no renderer).
 */
const HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'AurumTax/1.0',
}

/** Tentativas por provedor (só `timeout`/`rede`/transitório — ver abaixo). */
const TENTATIVAS_POR_PROVEDOR = 2
/** Pausa entre as 2 tentativas do mesmo provedor (curta p/ não estourar UI). */
const PAUSA_RETRY_MS = 400

const cache = new Map<string, DadosCnpjBrasilApi>()

const txt = (v: unknown): string => String(v ?? '').trim()

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------- mappers dos fallbacks --- */

/** Navegação segura em JSON de provedor (`unknown` → `unknown`). */
const campo = (o: unknown, ...chaves: string[]): unknown => {
  let cur: unknown = o
  for (const k of chaves) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

const primeiro = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)
const emLista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * CNAE em qualquer shape dos provedores: ReceitaWS `code: "85.50-3-01"`,
 * BrasilAPI número `8550301`, CNPJ.ws `id: "9430800"`, CNPJá número `600001`
 * (zero à esquerda via `padStart`).
 */
const codigoCnaeFlex = (item: unknown): string | null =>
  digitos7(campo(item, 'code') ?? campo(item, 'codigo') ?? campo(item, 'id'))

const descCnaeFlex = (item: unknown): string =>
  txt(campo(item, 'text') ?? campo(item, 'descricao') ?? campo(item, 'description'))

const secundariosFlex = (v: unknown): { codigo: string; descricao: string }[] =>
  emLista(v)
    .map((s) => ({ codigo: codigoCnaeFlex(s), descricao: descCnaeFlex(s) }))
    .filter((s): s is { codigo: string; descricao: string } => s.codigo !== null)

/** `simples` da CNPJ.ws (nullable; objeto `{simples:"Sim"/"Não"}` ou boolean). */
const simplesWs = (v: unknown): boolean | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return boolOuNulo(o['optante'] ?? o['optant'] ?? o['simples'] ?? o['opcao'])
  }
  return boolOuNulo(v)
}

/** ReceitaWS pública (`receitaws.com.br/v1/cnpj/{cnpj}`) — sem token, 3 req/min. */
export function mapearRespostaReceitaWS(r: unknown): DadosCnpjBrasilApi | null {
  const razaoSocial = txt(campo(r, 'nome'))
  if (!razaoSocial) return null
  const principal = primeiro(campo(r, 'atividade_principal'))
  return {
    cnpj: '',
    razaoSocial,
    fantasia: txt(campo(r, 'fantasia')),
    endereco: [txt(campo(r, 'logradouro')), txt(campo(r, 'numero')), txt(campo(r, 'complemento')), txt(campo(r, 'bairro'))]
      .filter(Boolean)
      .join(', '),
    cidade: txt(campo(r, 'municipio')),
    uf: txt(campo(r, 'uf')).toUpperCase().slice(0, 2),
    cep: norm(campo(r, 'cep')),
    telefone: (txt(campo(r, 'telefone')).split('/')[0] ?? '').trim(),
    email: txt(campo(r, 'email')),
    cnaePrincipal: codigoCnaeFlex(principal),
    cnaePrincipalDescricao: descCnaeFlex(principal) || null,
    cnaesSecundarios: secundariosFlex(campo(r, 'atividades_secundarias')),
    porte: txt(campo(r, 'porte')) || null,
    situacao: txt(campo(r, 'situacao')) || null,
    opcaoSimples: boolOuNulo(campo(r, 'simples', 'optante')),
  }
}

/** CNPJ.ws pública (`publica.cnpj.ws/cnpj/{cnpj}`) — sem token, 3 req/min. */
export function mapearRespostaCnpjWs(w: unknown): DadosCnpjBrasilApi | null {
  const razaoSocial = txt(campo(w, 'razao_social'))
  if (!razaoSocial) return null
  const est = campo(w, 'estabelecimento')
  const principal = campo(est, 'atividade_principal')
  const ddd = txt(campo(est, 'ddd1')) || txt(campo(est, 'ddd2'))
  const tel = txt(campo(est, 'telefone1')) || txt(campo(est, 'telefone2'))
  return {
    cnpj: '',
    razaoSocial,
    fantasia: txt(campo(est, 'nome_fantasia')),
    endereco: [
      [txt(campo(est, 'tipo_logradouro')), txt(campo(est, 'logradouro'))].filter(Boolean).join(' '),
      txt(campo(est, 'numero')),
      txt(campo(est, 'complemento')),
      txt(campo(est, 'bairro')),
    ]
      .filter(Boolean)
      .join(', '),
    cidade: txt(campo(est, 'cidade', 'nome')),
    uf: txt(campo(est, 'estado', 'sigla')).toUpperCase().slice(0, 2),
    cep: norm(campo(est, 'cep')),
    telefone: [ddd, tel].filter(Boolean).join(' '),
    email: txt(campo(est, 'email')),
    cnaePrincipal: codigoCnaeFlex(principal),
    cnaePrincipalDescricao: descCnaeFlex(principal) || null,
    cnaesSecundarios: secundariosFlex(campo(est, 'atividades_secundarias')),
    porte: txt(campo(w, 'porte', 'descricao')) || null,
    situacao: txt(campo(est, 'situacao_cadastral')) || null,
    opcaoSimples: simplesWs(campo(w, 'simples')),
  }
}

/** CNPJá Open (`open.cnpja.com/office/{cnpj}`) — sem token, ~5 req/min, CORS `*`. */
export function mapearRespostaCnpja(a: unknown): DadosCnpjBrasilApi | null {
  const company = campo(a, 'company')
  const razaoSocial = txt(campo(company, 'name'))
  if (!razaoSocial) return null
  const addr = campo(a, 'address')
  const fone0 = primeiro(campo(a, 'phones'))
  const mail0 = primeiro(campo(a, 'emails'))
  const principal = campo(a, 'mainActivity')
  return {
    cnpj: '',
    razaoSocial,
    fantasia: txt(campo(a, 'alias')),
    endereco: [txt(campo(addr, 'street')), txt(campo(addr, 'number')), txt(campo(addr, 'details')), txt(campo(addr, 'district'))]
      .filter(Boolean)
      .join(', '),
    cidade: txt(campo(addr, 'city')),
    uf: txt(campo(addr, 'state')).toUpperCase().slice(0, 2),
    cep: norm(campo(addr, 'zip')),
    telefone: [txt(campo(fone0, 'area')), txt(campo(fone0, 'number'))].filter(Boolean).join(' '),
    email: txt(campo(mail0, 'address')),
    cnaePrincipal: codigoCnaeFlex(principal),
    cnaePrincipalDescricao: descCnaeFlex(principal) || null,
    cnaesSecundarios: secundariosFlex(campo(a, 'sideActivities')),
    porte: txt(campo(company, 'size', 'acronym')) || txt(campo(company, 'size', 'text')) || null,
    situacao: txt(campo(a, 'status', 'text')) || null,
    opcaoSimples: boolOuNulo(campo(company, 'simples', 'optant')),
  }
}

/* ------------------------------------------------------ cadeia try/catch --- */

/** Classificação da falha de UMA tentativa — decide retry, troca ou parada. */
type ClasseFalha = 'nao-encontrado' | 'limite' | 'timeout' | 'transitorio' | 'rede'

/** Falha de um provedor: carrega classe + rótulo para o erro agregado final. */
class FalhaProvedor extends Error {
  constructor(
    readonly provedor: FonteCnpj,
    readonly rotulo: string,
    readonly classe: ClasseFalha,
    detalhe: string,
  ) {
    super(detalhe)
  }
}

interface ProvedorCnpj {
  id: FonteCnpj
  rotulo: string
  url: (cnpj: string) => string
  mapear: (json: unknown) => DadosCnpjBrasilApi | null
}

/**
 * Ordem (auditoria Oct/2026): BrasilAPI (schema nativo, CORS `*`) → CNPJá
 * (CORS `*`, sem UA, teto 5/min) → ReceitaWS → CNPJ.ws (sem CORS: só
 * alcançam via Node/Electron-main; no renderer falham na hora e a cadeia
 * avança sem custo de timeout).
 */
const PROVEDORES: ProvedorCnpj[] = [
  { id: 'brasilapi', rotulo: 'BrasilAPI', url: (c) => `${BASE}/${c}`, mapear: (j) => mapearRespostaBrasilApi(j as RespostaBrasilApi) },
  { id: 'cnpja', rotulo: 'CNPJá', url: (c) => `${URL_CNPJA}/${c}`, mapear: mapearRespostaCnpja },
  { id: 'receitaws', rotulo: 'ReceitaWS', url: (c) => `${URL_RECEITA_WS}/${c}`, mapear: mapearRespostaReceitaWS },
  { id: 'cnpjws', rotulo: 'CNPJ.ws', url: (c) => `${URL_CNPJ_WS}/${c}`, mapear: mapearRespostaCnpjWs },
]

/**
 * UMA tentativa contra UM provedor. Nunca retorna `null`: sucesso devolve o
 * dado (com `fonte` + `cnpj` da consulta), qualquer falha lança
 * `FalhaProvedor` classificada.
 */
async function consultarProvedorUmaVez(
  p: ProvedorCnpj,
  cnpj: string,
  fetchFn: typeof fetch,
): Promise<DadosCnpjBrasilApi> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resposta: Response
  try {
    resposta = await fetchFn(p.url(cnpj), { signal: ctrl.signal, headers: { ...HEADERS } })
  } catch (e) {
    throw new FalhaProvedor(
      p.id,
      p.rotulo,
      e instanceof DOMException && e.name === 'AbortError' ? 'timeout' : 'rede',
      e instanceof DOMException && e.name === 'AbortError' ? 'timeout de 12 s' : 'sem conexão (rede/CORS bloqueado)',
    )
  } finally {
    clearTimeout(timer)
  }

  if (resposta.status === 404) throw new FalhaProvedor(p.id, p.rotulo, 'nao-encontrado', 'não encontrado')
  if (resposta.status === 429) throw new FalhaProvedor(p.id, p.rotulo, 'limite', 'limite de consultas')
  // 400 com DV local válido = validador da base divergindo → outra base pode aceitar.
  // 403 no browser = UA removido (WAF) → retry local só gastaria tempo; a cadeia avança.
  if (resposta.status === 400 || resposta.status === 403 || !resposta.ok) {
    throw new FalhaProvedor(p.id, p.rotulo, 'transitorio', `HTTP ${resposta.status}`)
  }

  let json: unknown
  try {
    json = await resposta.json()
  } catch {
    throw new FalhaProvedor(p.id, p.rotulo, 'transitorio', 'resposta inválida')
  }
  const dados = p.mapear(json)
  if (!dados || !dados.razaoSocial) {
    throw new FalhaProvedor(p.id, p.rotulo, 'transitorio', 'resposta sem razão social')
  }
  return { ...dados, cnpj, fonte: p.id }
}

/** Erro final quando todos os provedores falharam — pt-BR com o resumo. */
function erroAgregado(falhas: FalhaProvedor[]): Error {
  const rotulos = PROVEDORES.map((p) => p.rotulo).join(', ')
  const todas = (c: ClasseFalha): boolean => falhas.length > 0 && falhas.every((f) => f.classe === c)
  if (todas('nao-encontrado')) {
    return new Error(`CNPJ não encontrado nas bases consultadas (${rotulos}). Confira os dígitos e tente de novo.`)
  }
  if (todas('limite')) {
    return new Error(`Limite de consultas atingido em todas as bases (${rotulos}). Aguarde um minuto e tente de novo.`)
  }
  if (falhas.length > 0 && falhas.every((f) => f.classe === 'timeout' || f.classe === 'rede')) {
    return new Error('As bases de CNPJ não responderam (timeout de 12 s por tentativa). Verifique a internet e tente de novo.')
  }
  const resumo = falhas.map((f) => `${f.rotulo}: ${f.message}`).join('; ')
  return new Error(`Consulta de CNPJ falhou em todas as bases (${resumo}). Tente de novo em instantes.`)
}

const digitos7 = (v: unknown): string | null => {
  // A API devolve CNAE como número (`8550301`) — `String(111301)` perde o
  // zero à esquerda, então completa com `padStart(7, '0')` antes de validar.
  const bruto = v === null || v === undefined ? '' : String(v).trim()
  if (!bruto) return null
  const d = bruto.replace(/\D+/g, '')
  if (!d) return null
  const p = d.length < 7 ? d.padStart(7, '0') : d
  return p.length === 7 ? p : null
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
 * Busca um CNPJ na cadeia de provedores (BrasilAPI → CNPJá → ReceitaWS →
 * CNPJ.ws). Lança `Error` em pt-BR — o UI transforma em toast e o lote em
 * linha de erro.
 *
 * Fluxo do `try/catch` por provedor:
 * 1. `nao-encontrado` (404) ou `limite` (429) → troca de provedor NA HORA
 *    (outra base pode ter o dado; rate-limit é por base);
 * 2. `timeout`/`rede`/transitório (403/5xx/resposta ruim) → 1 retry curto
 *    (400 ms) no mesmo provedor, depois avança;
 * 3. esgotados os 4 → `erroAgregado` (diz quais bases e por quê).
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

  const falhas: FalhaProvedor[] = []
  for (const p of PROVEDORES) {
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PROVEDOR; tentativa++) {
      try {
        const dados = await consultarProvedorUmaVez(p, cnpj, fetchFn)
        cache.set(cnpj, dados)
        return dados
      } catch (e) {
        if (!(e instanceof FalhaProvedor)) throw e
        if (e.classe === 'nao-encontrado' || e.classe === 'limite') {
          falhas.push(e)
          break
        }
        if (tentativa < TENTATIVAS_POR_PROVEDOR) {
          await dormir(PAUSA_RETRY_MS)
          continue
        }
        falhas.push(e)
      }
    }
  }
  throw erroAgregado(falhas)
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
