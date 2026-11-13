/**
 * Alíquotas de referência IBS/CBS (LC 214/2025) — compartilhadas pelo app.
 *
 * Carregadas da tabela viva `public/base/parametros.json` no boot (via
 * `obterAliquotasRefDinamica()`, uma vez por sessão — o serviço tem cache
 * interno); se a tabela não puder ser lida, vale a estimativa embarcada
 * 19/9 (`REF_DEFAULT`) com `fonte: 'fallback'`.
 *
 * Antes da v1.2 essas alíquotas moravam no store da (removida) Calcula-
 * dora; passaram para cá para manter os relatórios/simuladores alimentados
 * pela mesma fonte, sem a tela obsoleta.
 */
import { create } from 'zustand'
import { obterAliquotasRefDinamica } from '@/domain/services/referencia-service'
import { REF_DEFAULT } from '@/domain/constants'

export interface TaxasReferenciaState {
  rateIBS: number
  rateCBS: number
  /** `parametros` = tabela viva; `fallback` = estimativa embarcada. */
  fonte: 'parametros' | 'fallback'
}

export const useReferencia = create<TaxasReferenciaState>(() => ({
  rateIBS: REF_DEFAULT.IBS,
  rateCBS: REF_DEFAULT.CBS,
  fonte: 'fallback',
}))

void obterAliquotasRefDinamica().then((ref) => {
  useReferencia.setState({
    rateIBS: ref.refIBS,
    rateCBS: ref.refCBS,
    fonte: ref.fonte,
  })
})
