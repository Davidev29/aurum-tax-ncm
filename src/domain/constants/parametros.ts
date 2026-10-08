/**
 * Parâmetros das alíquotas de referência (IBS/CBS) — tabela editável.
 *
 * Fonte viva: `public/base/parametros.json` (lida em runtime por
 * `carregarParametrosRef()` + `referencia-service.ts`). Este módulo é o
 * ESPELHO embarcado no bundle (fallback offline quando o fetch falha).
 *
 * ESTIMATIVA, não fato: `refIBS 19 / refCBS 9 (soma 28)` DEVEM ser
 * confrontados com o ato vigente (LC 214/2025 e regulamentação) antes de
 * cada entrega fiscal. A UI exibe o banner de fallback sempre que a tabela
 * não pôde ser lida (ver `BANNER_REF_FALLBACK` em `referencia-service.ts`).
 */
export interface ParametrosReferencia {
  schema: number
  tipo: string
  vigenciaInicio: string | null
  vigenciaFim: string | null
  ato: string
  refIBS: number
  refCBS: number
  soma: number
  fonteUrl: string
  shaFonte: string | null
}

/** Espelho embarcado de `public/base/parametros.json` (fallback offline). */
export const PARAMETROS_REF: ParametrosReferencia = {
  schema: 1,
  tipo: 'parametros-referencia',
  vigenciaInicio: '2027-01-01',
  vigenciaFim: null,
  ato: 'LC 214/2025 — alíquotas de referência (estimativa; confirmar ato vigente antes de cada entrega)',
  refIBS: 19,
  refCBS: 9,
  soma: 28,
  fonteUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
  shaFonte: null,
} as const

/** Nome do arquivo da tabela viva dentro de `public/base/`. */
export const PARAMETROS_ARQUIVO = 'parametros.json'

/** Caminho da tabela viva para `fetch` direto (fora do bridge). */
export const PARAMETROS_URL = `base/${PARAMETROS_ARQUIVO}`

let _cache: ParametrosReferencia | null = null

/** Valida o JSON da tabela; retorna `null` quando o conteúdo não presta. */
export function validarParametrosRef(j: unknown): ParametrosReferencia | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const refIBS = Number(o.refIBS)
  const refCBS = Number(o.refCBS)
  const soma = Number(o.soma)
  if (!Number.isFinite(refIBS) || refIBS < 0 || refIBS > 100) return null
  if (!Number.isFinite(refCBS) || refCBS < 0 || refCBS > 100) return null
  if (!Number.isFinite(soma) || Math.abs(soma - (refIBS + refCBS)) > 0.001) return null
  return {
    schema: Number(o.schema) || 1,
    tipo: String(o.tipo ?? 'parametros-referencia'),
    vigenciaInicio: typeof o.vigenciaInicio === 'string' ? o.vigenciaInicio : null,
    vigenciaFim: typeof o.vigenciaFim === 'string' ? o.vigenciaFim : null,
    ato: String(o.ato ?? PARAMETROS_REF.ato),
    refIBS,
    refCBS,
    soma,
    fonteUrl: String(o.fonteUrl ?? PARAMETROS_REF.fonteUrl),
    shaFonte: typeof o.shaFonte === 'string' ? o.shaFonte : null,
  }
}

/**
 * Lê a tabela viva (`public/base/parametros.json`, via `bridge.lerArquivoBase`
 * quando disponível, senão `fetch` direto). Com cache em memória; em falha
 * ou conteúdo inválido, devolve o espelho embarcado (`PARAMETROS_REF`) com
 * `fonte: 'fallback'` — o chamador deve exibir `BANNER_REF_FALLBACK`.
 */
export async function carregarParametrosRef(): Promise<{
  params: ParametrosReferencia
  fonte: 'parametros' | 'fallback'
}> {
  if (_cache) return { params: _cache, fonte: 'parametros' }
  try {
    const { lerArquivoBase } = await import('@/infrastructure/bridge')
    const texto = await lerArquivoBase(PARAMETROS_ARQUIVO)
    const ok = validarParametrosRef(JSON.parse(texto))
    if (ok) {
      _cache = ok
      return { params: ok, fonte: 'parametros' }
    }
  } catch {
    // sem bridge (testes/SSR) — tenta fetch direto abaixo
  }
  try {
    const r = await fetch(PARAMETROS_URL, { cache: 'no-cache' })
    if (r.ok) {
      const ok = validarParametrosRef(await r.json())
      if (ok) {
        _cache = ok
        return { params: ok, fonte: 'parametros' }
      }
    }
  } catch {
    // rede indisponível (offline/Electron sem servidor) — fallback abaixo
  }
  return { params: PARAMETROS_REF, fonte: 'fallback' }
}

/** Invalida o cache da tabela (chamar após editar `parametros.json`). */
export function invalidarCacheParametros(): void {
  _cache = null
}
