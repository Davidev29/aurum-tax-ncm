/**
 * Alíquotas de referência IBS/CBS (LC 214/2025) — compartilhadas pelo app.
 *
 * Carregadas da tabela viva `public/base/parametros.json` no boot (via
 * `obterAliquotasRefDinamica()`, uma vez por sessão — o serviço tem cache
 * interno); se a tabela não puder ser lida, vale a estimativa embarcada
 * 19/11,3 (`REF_DEFAULT`) com `fonte: 'fallback'`.
 *
 * Override do usuário (Configurações → Alíquotas, persistido em `meta` do
 * SQLite) TEM PRECEDÊNCIA sobre a tabela embutida enquanto existir. É ele
 * que garante que o app acompanhe atos futuros da LC 214/2025 sem rebuild —
 * esta é a "longevidade" do software embutida na configuração.
 */
import { create } from 'zustand'
import { obterAliquotasRefDinamica, invalidarCacheAliquotas } from '@/domain/services/referencia-service'
import { REF_DEFAULT } from '@/domain/constants'
import {
  lerAliquotasUsuario,
  salvarAliquotasUsuario,
  restaurarAliquotasUsuario,
} from '@/infrastructure/db/override-referencia'
import { invalidarCacheParametros } from '@/domain/constants/parametros'

export type FonteReferencia = 'parametros' | 'fallback' | 'usuario'

export interface TaxasReferenciaState {
  rateIBS: number
  rateCBS: number
  /** `parametros` = tabela viva; `fallback` = estimativa embarcada; `usuario` = override. */
  fonte: FonteReferencia
  /** Ato/proveniência informada ao usuário. */
  ato: string
  setRate: (tributo: 'IBS' | 'CBS', valor: number) => void
}

export const useReferencia = create<TaxasReferenciaState>((set) => ({
  rateIBS: REF_DEFAULT.IBS,
  rateCBS: REF_DEFAULT.CBS,
  fonte: 'fallback',
  ato: 'LC 214/2025 — estimativa embarcada (confirmar o ato vigente)',
  setRate: (tributo, valor) =>
    set(tributo === 'IBS' ? { rateIBS: valor } : { rateCBS: valor }),
}))

/** Aplica um conjunto de alíquotas à sessão (usado pelo boot e pelas ações de salvar). */
export function aplicarReferencia(ref: { refIBS: number; refCBS: number; fonte: FonteReferencia; ato: string }): void {
  useReferencia.setState({
    rateIBS: ref.refIBS,
    rateCBS: ref.refCBS,
    fonte: ref.fonte,
    ato: ref.ato,
  })
}

/** Recarrega da fonte "padrão" (tabela embutida → espelho), ignorando o override. */
export async function aplicarReferenciaPadrao(): Promise<void> {
  invalidarCacheAliquotas()
  invalidarCacheParametros()
  const ref = await obterAliquotasRefDinamica()
  aplicarReferencia({ refIBS: ref.refIBS, refCBS: ref.refCBS, fonte: ref.fonte, ato: ref.ato })
}

/** Salva override do usuário, aplicando na sessão e invalidando caches. */
export async function salvarAliquotasReferencia(args: { refIBS: number; refCBS: number }): Promise<void> {
  const gravado = await salvarAliquotasUsuario(args)
  invalidarCacheAliquotas()
  invalidarCacheParametros()
  aplicarReferencia({
    refIBS: gravado.refIBS,
    refCBS: gravado.refCBS,
    fonte: 'usuario',
    ato: gravado.ato,
  })
}

/** Restaura o padrão (apagando o override do usuário). */
export async function restaurarAliquotasReferenciaPadrao(): Promise<void> {
  await restaurarAliquotasUsuario()
  await aplicarReferenciaPadrao()
}

void (async () => {
  const [dinamica, usuario] = await Promise.allSettled([
    obterAliquotasRefDinamica(),
    lerAliquotasUsuario(),
  ])
  const ovr = usuario.status === 'fulfilled' ? usuario.value : null
  if (ovr) {
    aplicarReferencia({ refIBS: ovr.refIBS, refCBS: ovr.refCBS, fonte: 'usuario', ato: ovr.ato })
    return
  }
  const ref = dinamica.status === 'fulfilled' ? dinamica.value : null
  if (ref) {
    aplicarReferencia({ refIBS: ref.refIBS, refCBS: ref.refCBS, fonte: ref.fonte, ato: ref.ato })
  }
})()
