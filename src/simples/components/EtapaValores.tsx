/**
 * Simples Nacional — etapa 1: base e enquadramento.
 * A folha 12m é obrigatória e mostra o veredito do Fator R ao vivo.
 */
import { SUBLIMITE } from '../tabelas'
import { fmtMoeda } from '@/domain/services/format'
import type { ResultadoValidacaoFatorR } from '@/domain/simples/validacao'
import type { PrevisaoFatorR } from '../store'
import type { SimplesState } from '../types'
import { Btn } from '@/ui/kit'
import { Entrada } from '@/ui/motion'
import { CampoMoeda } from './CampoMoeda'
import { CartaoFatorR } from './CartaoFatorR'
import { Passo } from './Passo'
import { SubCard } from './SubCard'

interface Props {
  s: SimplesState
  valoresOk: boolean
  estourado: boolean
  validacao: ResultadoValidacaoFatorR
  previsaoFR: PrevisaoFatorR | null
  onRbt12: (v: number) => void
  onReceita: (v: number) => void
  onFolha: (v: number) => void
  onSujeita: (v: boolean) => void
  onContinuar: () => void
}

export function EtapaValores({
  s, valoresOk, estourado, validacao, previsaoFR,
  onRbt12, onReceita, onFolha, onSujeita, onContinuar,
}: Props) {
  const contexto = s.modo === 'manual' ? `Anexo ${s.anexoId}` : s.cnaeEscolhido ? 'Atividade por CNPJ' : 'Manual / CNPJ'

  return (
    <Entrada atraso={0.05}>
      <section className="space-y-2" aria-labelledby="simples-etapa1-titulo">
        <Passo n="1" titulo="Base e enquadramento" desc="RBT12, receita e folha 12m — obrigatórias antes do anexo." feito={valoresOk} />
        <span id="simples-etapa1-titulo" className="sr-only">Base e enquadramento</span>

        <SubCard
          titulo="Receitas"
          aside={<span className="text-[13px] text-slate-600">{contexto}</span>}
        >
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <CampoMoeda
              rotulo="RBT12 — 12 meses"
              valor={s.rbt12}
              onValor={onRbt12}
              dica="Soma 12m (teto 4,8M)"
            />
            <CampoMoeda
              rotulo="Receita do mês"
              valor={s.receitaMes}
              onValor={onReceita}
              dica="Base do DAS"
            />
          </div>
        </SubCard>

        <CartaoFatorR
          rbt12={s.rbt12}
          folha12={s.folha12}
          aplicavel={validacao.aplicavel}
          sujeitaFatorR={s.sujeitaFatorR}
          onSujeitaChange={onSujeita}
          onFolhaChange={onFolha}
        />

        {!validacao.ok && s.rbt12 > 0 ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <span aria-hidden="true">!</span>
            <span>{validacao.mensagem}</span>
          </p>
        ) : null}

        <SubCard
          titulo="Sublimite estadual · R$ 3,6M"
          aside={s.rbt12 > 0 ? (
            <span className={`rounded-full px-2 py-px text-[13px] font-bold ${estourado ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>
              {estourado ? 'acima do sublimite' : 'dentro do sublimite'}
            </span>
          ) : <span className="text-[13px] text-slate-600">RBT12 define</span>}
        >
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            {estourado
              ? `RBT12 ${fmtMoeda(s.rbt12)} acima de ${fmtMoeda(SUBLIMITE)} (automático): ICMS/ISS/IBS saem da guia DAS e o híbrido é ativado sozinho.`
              : `Abaixo de ${fmtMoeda(SUBLIMITE)}: tudo dentro da guia DAS (automático pelo RBT12).`}
          </p>
        </SubCard>

        {previsaoFR?.definido && validacao.aplicavel ? (
          <p className="text-[13px] text-slate-600 dark:text-slate-300" aria-live="polite">
            Prévia do enquadramento: Anexo {previsaoFR.anexo} · {(previsaoFR.indice * 100).toFixed(2)}%
          </p>
        ) : null}

        <div className="flex justify-end pt-1">
          <Btn variante="primary" tam="sm" onClick={onContinuar}>
            Continuar →
          </Btn>
        </div>
      </section>
    </Entrada>
  )
}
