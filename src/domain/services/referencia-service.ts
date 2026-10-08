/**
 * Serviço de alíquotas de referência — lê a TABELA `public/base/parametros.json`.
 *
 * Dinâmico de verdade: os percentuais vêm da tabela viva (editável sem
 * rebuild), com espelho embarcado (`PARAMETROS_REF`) como fallback offline.
 * Quando a tabela não pôde ser lida, o chamador DEVE exibir
 * `BANNER_REF_FALLBACK` — a estimativa 19/9 nunca passa por valor confirmado.
 *
 * Fallback: usa o espelho embarcado para não quebrar o fluxo de importação.
 */
import { REF_DEFAULT } from '../constants'
import {
  PARAMETROS_REF,
  carregarParametrosRef,
  invalidarCacheParametros,
} from '../constants/parametros'

export interface AliquotasRefDinamica {
  refIBS: number
  refCBS: number
  /** `parametros` = tabela viva (ou espelho válido); `fallback` = estimativa — exibir banner. */
  fonte: 'parametros' | 'fallback'
  /** Ato declarado pela tabela (estimativa — confirmar antes de cada entrega). */
  ato: string
  vigenciaInicio: string | null
  vigenciaFim: string | null
}

/**
 * Banner obrigatório quando `fonte === 'fallback'`: a tabela de parâmetros
 * não pôde ser lida e o cálculo usa a estimativa embarcada.
 */
export const BANNER_REF_FALLBACK =
  'Alíquotas de referência (IBS 19% · CBS 9%) são ESTIMATIVA — tabela `parametros.json` indisponível. Confirmar contra o ato vigente (LC 214/2025 e regulamentação) antes de cada entrega fiscal.'

/**
 * Lê as alíquotas de referência da tabela viva `public/base/parametros.json`.
 * Em falha, devolve o espelho embarcado (`REF_DEFAULT`, mesma estimativa
 * 19/9) com `fonte: 'fallback'` — o chamador exibe `BANNER_REF_FALLBACK`.
 */
export async function obterAliquotasRefDinamica(): Promise<AliquotasRefDinamica> {
  try {
    const { params, fonte } = await carregarParametrosRef()
    return {
      refIBS: params.refIBS,
      refCBS: params.refCBS,
      fonte,
      ato: params.ato,
      vigenciaInicio: params.vigenciaInicio,
      vigenciaFim: params.vigenciaFim,
    }
  } catch {
    // Em caso de erro (tabela ilegível), usa fallback silenciosamente
    return {
      refIBS: REF_DEFAULT.IBS,
      refCBS: REF_DEFAULT.CBS,
      fonte: 'fallback',
      ato: PARAMETROS_REF.ato,
      vigenciaInicio: PARAMETROS_REF.vigenciaInicio,
      vigenciaFim: PARAMETROS_REF.vigenciaFim,
    }
  }
}

/**
 * Versão síncrona para uso em contextos onde não é possível await
 * (ex.: cálculos síncronos em componentes React). Usa o espelho embarcado
 * (`PARAMETROS_REF` === `REF_DEFAULT` 19/9, estimativa).
 * Para ler a tabela viva, chamar obterAliquotasRefDinamica() antes.
 */
export function obterAliquotasRefSync(): AliquotasRefDinamica {
  return {
    refIBS: REF_DEFAULT.IBS,
    refCBS: REF_DEFAULT.CBS,
    fonte: 'fallback',
    ato: PARAMETROS_REF.ato,
    vigenciaInicio: PARAMETROS_REF.vigenciaInicio,
    vigenciaFim: PARAMETROS_REF.vigenciaFim,
  }
}

/**
 * Invalida o cache de alíquotas (chamar após editar `parametros.json`
 * ou as tabelas auxiliares).
 */
export function invalidarCacheAliquotas(): void {
  invalidarCacheParametros()
}
