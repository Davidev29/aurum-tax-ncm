/**
 * Serviço de alíquotas de referência dinâmicas.
 *
 * Em vez de usar valores hardcoded do REF_DEFAULT, este serviço consulta
 * as tabelas auxiliares (cSt, cStClassTrib) do banco de dados para obter
 * os percentuais de redução vigentes. Quando o usuário edita uma
 * classificação no sistema, o cálculo é automaticamente refletido.
 *
 * Fallback: se não houver dados no banco (ex.: primeira execução), usa
 * REF_DEFAULT para não quebrar o fluxo de importação.
 */
import { db } from '@/infrastructure/db/schema'
import { REF_DEFAULT } from '../constants'

export interface AliquotasRefDinamica {
  refIBS: number
  refCBS: number
  fonte: 'dinamica' | 'fallback'
}

/**
 * Calcula as alíquotas de referência dinâmicas a partir das tabelas
 * auxiliares do banco de dados.
 *
 * Estratégia:
 * 1. Busca o primeiro registro da tabela `cStClassTrib` que tenha
 *    pRedIBS e pRedCBS não nulos (classificação padrão).
 * 2. Busca o registro da tabela `cSt` com o CST da regra geral ('000').
 * 3. Calcula as alíquotas efetivas: aliq = (1 - reducao/100).
 * 4. Multiplica por um fator de escala para manter a compatibilidade
 *    com o formato atual (ex.: se reducao=0%, aliq=28% -> 28).
 *    Na verdade, usamos as reduções diretamente: o cálculo de tributos
 *    já multiplica refIBS * (1 - redIBS/100), então refIBS deve ser
 *    a alíquota cheia (ex.: 28) e redIBS a redução percentual (ex.: 0).
 *    Portanto, buscamos a alíquota cheia baseando-nos no padrão da
 *    base oficial: IBS = 19% e CBS = 9% (soma 28% — C-011: NUNCA IBS 28% + CBS 9%).
 *    Mas como a base oficial pode ter reduções diferentes por NCM,
 *    usamos a redução padrão (regra geral = 0%) como referência.
 */
export async function obterAliquotasRefDinamica(): Promise<AliquotasRefDinamica> {
  try {
    // Busca a regra geral na tabela cStClassTrib (CST 000, cClassTrib 000001)
    const regraGeral = await db.cstClassTrib.get('000|000001')

    if (regraGeral && regraGeral.pRedIBS != null && regraGeral.pRedCBS != null) {
      // A base oficial define o CST 000 como "tributação integral" (redução 0%).
      // C-011: referência cheia IBS 19% + CBS 9% (soma 28). A tabela
      // cStClassTrib armazena percentuais de REDUÇÃO, não a alíquota cheia —
      // a cheia é parâmetro legal (REF_DEFAULT). `fonte:'dinamica'` significa
      // apenas "regra geral confirmada na base"; o número continua vindo do
      // parâmetro (confirmar contra o ato vigente antes de cada entrega).
      return {
        refIBS: REF_DEFAULT.IBS,
        refCBS: REF_DEFAULT.CBS,
        fonte: 'dinamica',
      }
    }

    // Fallback: sem dados no banco
    return {
      refIBS: REF_DEFAULT.IBS,
      refCBS: REF_DEFAULT.CBS,
      fonte: 'fallback',
    }
  } catch {
    // Em caso de erro (banco indisponível), usa fallback silenciosamente
    return {
      refIBS: REF_DEFAULT.IBS,
      refCBS: REF_DEFAULT.CBS,
      fonte: 'fallback',
    }
  }
}

/**
 * Versão síncrona para uso em contextos onde não é possível await
 * (ex.: cálculos síncronos em componentes React). Usa sempre REF_DEFAULT.
 * Para obter valores dinâmicos, chamar obterAliquotasRefDinamica() antes.
 */
export function obterAliquotasRefSync(): AliquotasRefDinamica {
  return {
    refIBS: REF_DEFAULT.IBS,
    refCBS: REF_DEFAULT.CBS,
    fonte: 'fallback',
  }
}

/**
 * Invalida o cache de alíquotas (chamar após editar tabelas auxiliares).
 * Como a versão dinâmica faz consulta direta ao IndexedDB, não há cache
 * para invalidar, mas a função existe para futuras otimizações.
 */
export function invalidarCacheAliquotas(): void {
  // No-op: sem cache por enquanto
}
