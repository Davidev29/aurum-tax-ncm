/**
 * Seletor de tributação para o Anexo IX condicional (art. 138, §2º).
 *
 * Situações do Anexo IX sem diferimento efetivo (caso típico: CST 200 /
 * cClassTrib 200038, redução de 60%) ganham UMA SEGUNDA opção de tributação:
 * o diferimento na operação — redução de 100% por conta do diferimento,
 * ou seja, simulação com alíquota 0% de IBS/CBS (CST 515).
 *
 * A escolha é sempre do usuário, por operação: o padrão é a tributação
 * normal (redução oficial); ao clicar no diferimento, todo o cartão passa a
 * simular com a classificação virtual diferida (faixa, avisos, simulador,
 * salvar e calculadora).
 *
 * Apresentação pura: nenhuma regra fiscal é decidida aqui — a hipótese vem
 * de `classificacaoDiferimentoAnexoIX` (domínio).
 */
import { useEffect, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import {
  classificacaoDiferimentoAnexoIX,
  temOpcaoDiferimento,
  type OpcaoTributacaoChave,
} from '@/domain/services/calculo'
import { fmtPct } from '@/domain/services/format'

/**
 * Estado da opção de tributação de um cartão.
 *
 * Devolve a classificação ATIVA (original ou virtual diferida) para o cartão
 * decorar — faixa, CST/cClassTrib, observações, simulador, salvar e
 * calculadora consomem `ativa` em vez do `cl` cru. Troca de NCM reseta para
 * a tributação normal.
 */
export function useOpcaoTributacao(cl: Classificacao | null | undefined): {
  opcao: OpcaoTributacaoChave
  setOpcao: (o: OpcaoTributacaoChave) => void
  /** Classificação ativa (a simular/salvar). */
  ativa: Classificacao | null
  /** Hipótese diferida (null quando o NCM não é Anexo IX condicional). */
  diferida: Classificacao | null
  temDiferimento: boolean
} {
  const temDiferimento = temOpcaoDiferimento(cl)
  const [opcao, setOpcao] = useState<OpcaoTributacaoChave>('normal')

  // Troca de enquadramento: volta ao padrão vigente (tributação normal).
  useEffect(() => {
    setOpcao('normal')
  }, [cl?.id])

  if (!cl) return { opcao, setOpcao, ativa: null, diferida: null, temDiferimento: false }
  if (!temDiferimento) return { opcao: 'normal', setOpcao, ativa: cl, diferida: null, temDiferimento: false }
  const diferida = classificacaoDiferimentoAnexoIX(cl)
  return { opcao, setOpcao, ativa: opcao === 'diferimento' ? diferida : cl, diferida, temDiferimento: true }
}

/**
 * Duas opções de tributação (radio): normal × diferimento na operação.
 * Renderiza `null` fora do Anexo IX condicional.
 */
export function SeletorTributacao({
  cl,
  opcao,
  onChange,
}: {
  cl: Classificacao
  opcao: OpcaoTributacaoChave
  onChange: (o: OpcaoTributacaoChave) => void
}) {
  if (!temOpcaoDiferimento(cl)) return null
  const redIBS = Number(cl.resumo?.percentualReducaoIBS ?? 0)
  const redCBS = Number(cl.resumo?.percentualReducaoCBS ?? 0)
  const rotuloNormal =
    redIBS > 0 || redCBS > 0
      ? `Tributação com redução ${fmtPct(redIBS)} / ${fmtPct(redCBS)}`
      : 'Tributação integral (alíquota cheia)'

  const base =
    'flex w-full items-start gap-2.5 rounded-xl border-2 p-2.5 text-left transition cursor-pointer'
  return (
    <div
      className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/20"
      role="radiogroup"
      aria-label="Opção de tributação: normal ou com diferimento na operação"
    >
      <div className="px-1 pb-1.5 text-[10px] font-black uppercase tracking-wider text-violet-700 dark:text-violet-300">
        ⏳ Opção de tributação — verifique a operação
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <button
          type="button"
          role="radio"
          aria-checked={opcao === 'normal'}
          onClick={() => onChange('normal')}
          className={`${base} ${
            opcao === 'normal'
              ? 'border-brand-500 bg-white shadow-card dark:border-aurum-500 dark:bg-slate-900'
              : 'border-transparent bg-white/60 hover:border-brand-300 dark:bg-slate-900/60'
          }`}
          title={`Simula com a redução oficial (${fmtPct(redIBS)} IBS / ${fmtPct(redCBS)} CBS)`}
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 font-mono text-[10px] font-black ${
              opcao === 'normal'
                ? 'border-brand-600 bg-brand-600 text-white dark:border-aurum-400 dark:bg-aurum-400 dark:text-brand-950'
                : 'border-slate-300 text-transparent'
            }`}
          >
            ✓
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold leading-snug">{rotuloNormal}</span>
            <span className="mt-0.5 block font-mono text-[10px] text-slate-500 dark:text-slate-400">
              CST {cl.cst || '—'} · {cl.cClassTrib || '—'}
            </span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={opcao === 'diferimento'}
          onClick={() => onChange('diferimento')}
          className={`${base} ${
            opcao === 'diferimento'
              ? 'border-violet-500 bg-white shadow-card dark:border-violet-400 dark:bg-slate-900'
              : 'border-transparent bg-white/60 hover:border-violet-300 dark:bg-slate-900/60'
          }`}
          title="Simula com alíquota 0% de IBS/CBS por conta do diferimento (art. 138, §2º)"
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 font-mono text-[10px] font-black ${
              opcao === 'diferimento'
                ? 'border-violet-600 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-500'
                : 'border-slate-300 text-transparent'
            }`}
          >
            ✓
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold leading-snug">⏳ Diferimento na operação — alíquota 0%</span>
            <span className="mt-0.5 block font-mono text-[10px] text-slate-500 dark:text-slate-400">
              CST 515 · 515001 · IBS 0% / CBS 0%
            </span>
          </span>
        </button>
      </div>
      <p className="px-1 pt-1.5 text-[10px] leading-relaxed text-violet-700/80 dark:text-violet-300/80">
        {opcao === 'diferimento'
          ? 'Simulando COM diferimento: recolhimento adiado (art. 138, §2º) — só vale se a operação se enquadrar (regime regular, produtor rural qualificado ou importação).'
          : 'O diferimento do art. 138, §2º depende da operação concreta — se a sua se enquadrar, clique em diferimento para simular com alíquota zero.'}
      </p>
    </div>
  )
}
