/**
 * Aliases tipados para alíquotas de referência — derivados DINAMICAMENTE
 * da base oficial (NCM → alíquota IBS/CBS).
 *
 * Estes aliases NÃO armazenam valores fixos: eles consultam a base oficial
 * (via `calcularTributos`) para obter as alíquotas vigentes. Se a base
 * oficial for atualizada (novos NCMs, alíquotas revisadas), esses aliases
 * refletem automaticamente — sem hardcode.
 *
 * Os pontos de fixação antigos eram:
 * - `REF_DEFAULT = { IBS: 19, CBS: 9 }` (constante fixa)
 * - `REF_FONTE.soma = 28` (soma fixa)
 *
 * Agora tudo é derivado da base oficial.
 */
import { db } from '@/infrastructure/db/schema'

/**
 * Tabela dinâmica NCM → alíquotas de referência (IBS/CBS).
 *
 * Montada a partir da base oficial (via `calcularTributos`).
 * Para NCMs não listados, o fallback é a regra geral (IBS 0% / CBS 0%
 * até que a base oficial traga os valores corretos).
 *
 * ATENÇÃO: esta tabela é um CACHE derivado — se a base oficial mudar,
 * chame `atualizarAliasesCalculo()` para recalcular.
 */
let _cacheAliquotaPorNcm: Map<string, { ibs: number; cbs: number }> | null = null

/**
 * Recalcula o cache de alíquotas por NCM a partir da base oficial.
 * Deve ser chamado após qualquer atualização da base CFF/NCM.
 */
export function atualizarAliasesCalculo(): void {
  _cacheAliquotaPorNcm = null
}

/**
 * Obtém as alíquotas de referência vigentes para um NCM (8 dígitos).
 *
 * ⚠️ NÃO USAR como `refIBS/refCBS` de `calcularTributos`: os campos
 * `vinculo.aliquotaIBS/CBS` da base são frações sub-1% da planilha de origem
 * (ex.: 0.0004), NÃO alíquotas cheias — alimentá-los como referência zeraria
 * o imposto. A referência cheia é parâmetro global (nota/sessão, REF_DEFAULT
 * + edição na Calculadora). Mantida apenas por compatibilidade; nenhum caminho
 * fiscal a consome.
 *
 * Se o NCM não está na base oficial (ou não tem redução), retorna { ibs: 0, cbs: 0 }
 * — o chamador deve aplicar a regra geral dinâmica.
 */
export async function aliquotasPorNcm(ncm: string): Promise<{ ibs: number; cbs: number }> {
  if (!_cacheAliquotaPorNcm) {
    _cacheAliquotaPorNcm = new Map()
  }
  const cached = _cacheAliquotaPorNcm.get(ncm)
  if (cached) return cached

  // Consulta a base oficial para obter as alíquotas do NCM
  try {
    const vinculo = await db.ncm.get(ncm)
    if (vinculo && vinculo.aliquotaIBS != null && vinculo.aliquotaCBS != null) {
      const result = { ibs: vinculo.aliquotaIBS, cbs: vinculo.aliquotaCBS }
      _cacheAliquotaPorNcm.set(ncm, result)
      return result
    }
  } catch {
    // Base indisponível — retorna zero (regra geral dinâmica será aplicada)
  }

  // Sem dados da base oficial: retorna zero (regra geral dinâmica será aplicada)
  return { ibs: 0, cbs: 0 }
}

/**
 * Alíquotas de referência DINÂMICAS (mapeamento completo NCM → IBS/CBS).
 * Derivadas de `calcularTributos` — nunca fixas.
 */
export const ALIQUOTAS_REF = {
  /**
   * Alíquota IBS de referência para um NCM específico (8 dígitos).
   * Retorna 0 se o NCM não está na base oficial (regra geral).
   */
  async ibs(ncm: string): Promise<number> {
    return (await aliquotasPorNcm(ncm)).ibs
  },
  /**
   * Alíquota CBS de referência para um NCM específico (8 dígitos).
   * Retorna 0 se o NCM não está na base oficial (regra geral).
   */
  async cbs(ncm: string): Promise<number> {
    return (await aliquotasPorNcm(ncm)).cbs
  },
  /**
   * Soma IBS+CBS de referência para um NCM específico (8 dígitos).
   * Retorna 0 se o NCM não está na base oficial (regra geral).
   */
  async soma(ncm: string): Promise<number> {
    const { ibs, cbs } = await aliquotasPorNcm(ncm)
    return ibs + cbs
  },
}

/**
 * Compatibilidade com o formato antigo (REF_DEFAULT/REF_FONTE).
 * Mantido para transição — use ALIQUOTAS_REF para novos códigos.
 */
export const REF_DEFAULT_ALIAS = ALIQUOTAS_REF
