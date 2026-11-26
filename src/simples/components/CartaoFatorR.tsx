/**
 * Simples Nacional — cartão didático do Fator R (obrigatório) e linha de
 * veredito no resultado. Toda matemática vem de `detalharFatorR`.
 */
import { detalharFatorR } from '@/domain/simples/nucleo'
import { fmtCarga, fmtMoeda } from '@/domain/services/format'
import { Icone, Pill } from '@/ui/kit'
import { CampoMoeda } from './CampoMoeda'

interface CartaoProps {
  rbt12: number
  folha12: number
  /** atividade sujeita ao Fator R (CNAE III/V e não dispensado) */
  aplicavel: boolean
  sujeitaFatorR: boolean
  onSujeitaChange: (v: boolean) => void
  onFolhaChange: (v: number) => void
}

export function CartaoFatorR({
  rbt12,
  folha12,
  aplicavel,
  sujeitaFatorR,
  onSujeitaChange,
  onFolhaChange,
}: CartaoProps) {
  const d = detalharFatorR(folha12, rbt12)
  const pct = d.valor * 100
  const enquadrado = d.enquadrado
  const beneficiado = aplicavel && sujeitaFatorR

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icone nome="calculadora" className="h-4 w-4 shrink-0 text-brand-700 dark:text-aurum-200" />
          <h4 className="text-xl font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            Folha 12m · Fator R <span className="align-middle text-[13px] font-bold text-red-600">(obrigatório)</span>
          </h4>
        </div>
        {dadosInsuficientes(rbt12, folha12) ? (
          <Pill cor="amber">aguardando folha</Pill>
        ) : !beneficiado ? (
          <Pill cor="slate">registrado · sem efeito no anexo</Pill>
        ) : (
          <Pill cor={enquadrado ? 'emerald' : 'amber'}>
            {enquadrado ? '✓ III · ≥ 28%' : '! V · < 28%'} · {fmtCarga(pct)}
          </Pill>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <CampoMoeda
          rotulo="Folha de salários 12m"
          valor={folha12}
          onValor={onFolhaChange}
          placeholder="R$ 0,00"
          dica="Salários + pró-labore dos últimos 12 meses. Usada no Fator R e registrada nos relatórios."
        />
        <div className="min-w-0 self-end">
          <div className="flex items-center justify-between gap-2 font-mono text-[13px] text-slate-600 dark:text-slate-300">
            <span>{fmtMoeda(folha12)} ÷ {fmtMoeda(rbt12)}</span>
            <strong className="font-black">{rbt12 > 0 && folha12 > 0 ? fmtCarga(pct) : '—'}</strong>
          </div>
          <div
            className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="meter"
            aria-label="Índice do Fator R"
            aria-valuemin={0}
            aria-valuemax={40}
            aria-valuenow={Number(pct.toFixed(2))}
            aria-valuetext={dadosInsuficientes(rbt12, folha12) ? 'aguardando folha' : `${pct.toFixed(2)}% — ${enquadrado ? 'Anexo III' : 'Anexo V'}`}
          >
            <span
              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${enquadrado ? 'bg-emerald-600' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, (pct / 40) * 100)}%` }}
            />
            <span className="absolute inset-y-0 w-0.5 bg-slate-900 dark:bg-white" style={{ left: '70%' }} aria-hidden="true" />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-slate-500">
            <span>0%</span><span>28%</span><span>40%</span>
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300" aria-live="polite">
        {!beneficiado ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <Icone nome="alerta" className="mt-px h-4 w-4 shrink-0" />
            <span>Folha registrada para conferência — nesta atividade o Fator R não altera a alíquota (só decide entre III e V).</span>
          </p>
        ) : dadosInsuficientes(rbt12, folha12) ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Icone nome="alerta" className="mt-px h-4 w-4 shrink-0" />
            <span>Informe a folha para concluir o cálculo. Sem ela não há enquadramento definitivo.</span>
          </p>
        ) : enquadrado ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Icone nome="trofeu" className="mt-px h-4 w-4 shrink-0" />
            <span>Enquadrado (≥ 28%) — sustenta o Anexo III. Folha mínima: {fmtMoeda(d.folhaMinimaIII)}.</span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Icone nome="alerta" className="mt-px h-4 w-4 shrink-0" />
            <span>
              Não é tributada pelo Anexo III — vai para o Anexo V. Faltam {fmtMoeda(d.gapFolha)} em 12 meses
              (≈ {fmtMoeda(d.gapMensalProlabore)}/mês de pró-labore) para 28%.
            </span>
          </p>
        )}
        <details className="rounded-lg border border-[var(--line)] px-2 py-1.5">
          <summary className="cursor-pointer font-bold">Entenda a regra</summary>
          <p className="mt-1">
            Fator R = folha dos últimos 12 meses ÷ RBT12. Com 28% ou mais, atividades sujeitas ficam no Anexo III;
            abaixo disso, no Anexo V. Acompanhe o índice todo mês — ele decide o enquadramento.
          </p>
        </details>
      </div>

      {aplicavel ? (
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-bold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-brand-700"
            checked={sujeitaFatorR}
            onChange={(e) => onSujeitaChange(e.target.checked)}
          />
          Atividade sujeita ao Fator R (desmarque se for Anexo III puro)
        </label>
      ) : null}
    </div>
  )
}

function dadosInsuficientes(rbt12: number, folha12: number): boolean {
  return !(rbt12 > 0 && folha12 > 0)
}

/** Linha única de veredito no topo do resultado — sem repetir o cartão. */
export function LinhaFatorR({
  rbt12,
  folha12,
  aplicavel,
}: {
  rbt12: number
  folha12: number
  aplicavel: boolean
}) {
  const d = detalharFatorR(folha12, rbt12)
  if (!aplicavel) {
    return (
      <p className="text-[13px] text-white/75">
        Fator R registrado — sem efeito no enquadramento desta atividade.
      </p>
    )
  }
  if (!d.dadosSuficientes) {
    return <p className="text-[13px] text-amber-200">Fator R não calculado: folha 12m obrigatória não informada.</p>
  }
  return (
    <details className="text-[13px] text-white/85">
      <summary className="cursor-pointer font-bold">
        Fator R {fmtCarga(d.valor * 100)} {d.enquadrado ? '≥' : '<'} 28% → Anexo {d.enquadrado ? 'III' : 'V'}
      </summary>
      <p className="mt-1 font-mono text-white/70">
        {fmtMoeda(folha12)} ÷ {fmtMoeda(rbt12)} = {fmtCarga(d.valor * 100)} · folha mínima {fmtMoeda(d.folhaMinimaIII)}
        {d.gapFolha > 0 ? ` · faltam ${fmtMoeda(d.gapFolha)}` : ''}
      </p>
    </details>
  )
}
