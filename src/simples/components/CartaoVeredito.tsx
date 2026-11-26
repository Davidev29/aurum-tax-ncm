/**
 * Simples Nacional — bloco 1 do resultado: veredito com Fator R e DAS.
 * Um único número em destaque; o restante é evidência.
 */
import { ANEXO_LABEL } from '../tabelas'
import { fmtCarga, fmtMoeda } from '@/domain/services/format'
import { NumeroAnimado } from '@/simples-projection/NumeroAnimado'
import { Btn, Pill } from '@/ui/kit'
import type { CenaSimples } from '../types'
import { LinhaFatorR } from './CartaoFatorR'

interface Props {
  cena: CenaSimples
  rbt12: number
  folha12: number
  aplicavelFatorR: boolean
  onEditar: () => void
  onDas: () => void
}

export function CartaoVeredito({ cena, rbt12, folha12, aplicavelFatorR, onEditar, onDas }: Props) {
  const conv = cena.convExib!
  const rotulo = cena.segResultado
    ? `Segregado ${cena.segResultado.anexos.join(' + ')}`
    : `${ANEXO_LABEL[conv.anexoId]} · ${conv.faixa}ª faixa`

  return (
    <section className="calc-hero simples-hero relative z-0 isolate scroll-mt-4 overflow-hidden rounded-2xl" aria-labelledby="simples-veredito-titulo" role="status">
      <div className="px-4 pb-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="simples-veredito-titulo" className="calc-hero-rotulo truncate">{rotulo}{cena.stResumo ? ` · ST ${cena.stResumo.tributo}` : ''}</h2>
          <span className="flex shrink-0 items-center gap-1.5">
            <Pill cor="brand">{cena.convBase?.excedeSublimite ? 'Guia DAS' : 'DAS'}</Pill>
            <button
              type="button"
              onClick={onEditar}
              title="Voltar aos dados (o resultado é mantido até recalcular)"
              className="btn-press min-h-11 rounded-full border border-white/25 px-2 py-px text-[13px] font-bold text-white transition hover:bg-white/10"
            >
              ‹ Editar
            </button>
          </span>
        </div>

        <NumeroAnimado
          valor={cena.dasExib}
          formatar={(n) => `${cena.convBase?.excedeSublimite ? 'Guia DAS' : 'DAS'}: ${fmtMoeda(n)}`}
          className="calc-hero-valor mt-0.5 block truncate font-mono text-3xl font-black tabular-nums leading-tight text-white sm:text-4xl"
        />

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[13px] text-white/75">
          <span className="truncate">
            Alíquota efetiva {fmtCarga((cena.convBase!.aliquotaEfetivaGuia ?? cena.convBase!.aliquotaEfetiva) * 100)}
            {cena.convBase?.excedeSublimite ? ' (guia)' : ''}
          </span>
          {cena.convBase?.excedeSublimite ? (
            <span className="font-mono">Carga total {fmtMoeda(cena.cargaTotalExib)}</span>
          ) : null}
        </div>

        <div className="mt-1.5 border-t border-white/20 pt-1.5">
          <LinhaFatorR rbt12={rbt12} folha12={folha12} aplicavel={aplicavelFatorR} />
        </div>

        {cena.convBase?.excedeSublimite ? (
          <p className="mt-1 text-[13px] leading-relaxed text-white/75">
            Guia sem {cena.convExib!.tributosFora.join(' + ')} · fora {fmtMoeda(cena.convExib!.foraSublimite.total)}
          </p>
        ) : null}
        {cena.segResultado ? (
          <p className="mt-1 text-[13px] leading-relaxed text-white/60">
            Bruto {fmtMoeda(cena.segResultado.dasBrutoGuia)} − final {fmtMoeda(cena.dasExib)}
            {cena.stResumo ? ` (ST ${cena.stResumo.tributo})` : ''}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5 bg-white px-4 pb-4 dark:bg-slate-900">
        <Btn tam="sm" className="flex-1" onClick={onDas}>Ver guia DAS</Btn>
      </div>
    </section>
  )
}
