/**
 * Componentes da **Consulta de CNAEs** (Phase 9 / 09-03).
 *
 * Reuso, não reinvenção:
 * - `FaixaCnae` + `BlocoConferenciaReforma` vêm de `ui/servicos.tsx`
 *   (cabeçalho CNAE + conferência com a tabela da Reforma);
 * - `MolduraAurumAI` (destaque da NBS mais provável) e
 *   `BarraConfiancaAurumAI` (teto de confiança da matriz CNAE, 0–1 legítimo)
 *   vêm de `ui/aurum-ai.tsx`;
 * - `FaixaTributaria` dá o herói fiscal de cada veredito.
 *
 * Nota honesta: `CartaoEnxuto` NÃO é reutilizado aqui — ele apresenta
 * `Classificacao` do vínculo NBS, enquanto o painel do CNAE apresenta
 * `VereditoNbs` (resolvedor + precificação anual). Forçar o reuso
 * misturaria os dois domínios. O mesmo vale para o score de plausibilidade
 * do ranking (escala própria, não 0–1): ele é exibido como número, nunca
 * como barra de confiança.
 */
import { useState, type ReactElement } from 'react'
import type { AtividadeCnae } from '@/application/consultar-por-cnpj'
import type { ConsultaCnae } from '@/application/consultar-por-cnae'
import type { CnaeAnexo } from '@/domain/entities'
import { tetoConfiancaCnae } from '@/domain/services/cnae'
import { round2 } from '@/domain/services/calculo'
import type {
  ItemRankingNbs,
  VereditoNbs,
} from '@/domain/services/cnae-nbs'
import { fmtMoeda } from '@/domain/services/format'
import { FaixaTributaria } from './faixa-tributaria'
import { BlocoConferenciaReforma, FaixaCnae } from './servicos'
import { BarraConfiancaAurumAI, MolduraAurumAI } from './aurum-ai'

/* ------------------------------------------------- bloco de regras (sempre) --- */

/**
 * Bloco Regras — renderizado para TODO CNAE com regra: anexo do Simples,
 * situação, Fator R, vedação textual e o teto de confiança da matriz.
 * Nunca vazio: `regrasDoCnae` garante os fallbacks (invariante A).
 */
export function BlocoRegrasCnae({ consulta }: { consulta: ConsultaCnae }): ReactElement {
  const regra = consulta.regra
  if (regra.estado !== 'ok') {
    return (
      <div
        className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
        role="status"
      >
        {regra.mensagem} Classifique no modo manual com o contador.
      </div>
    )
  }
  // `FaixaCnae` lê só `cnaeTabela/codigoFormatado/descricao/principal` —
  // o adaptador carrega a regra (Anexo Simples + Situação + Fator R).
  const cnaeTabela: CnaeAnexo = {
    codigo7: regra.cnae7,
    codigoFormatado: regra.codigoFormatado,
    descricao: regra.descricao,
    situacao: regra.situacao,
    anexos: regra.anexoSimples,
    fatorR: regra.fatorR,
  }
  const atividade = {
    cnae7: regra.cnae7,
    codigoFormatado: regra.codigoFormatado,
    descricao: regra.descricao,
    principal: false,
    cnaeTabela,
  } as AtividadeCnae
  return (
    <div className="space-y-3">
      <FaixaCnae atividade={atividade} />
      <div className="flex flex-wrap items-center gap-2">
        <BarraConfiancaAurumAI valor={tetoConfiancaCnae(regra.situacao)} compact />
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          teto da matriz CNAE
        </span>
      </div>
      {regra.fatorR ? (
        <p className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-200">
          <strong>Fator R:</strong> Anexo Simples III ou V conforme a folha de salários
          (28% do faturamento nos últimos 12 meses, incluindo pró-labore).
        </p>
      ) : null}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Vedação — Situação {regra.situacao}
        </div>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">
          {regra.vedacaoTextual.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      </div>
      <BlocoConferenciaReforma hipoteses={consulta.hipoteses} coerencia={consulta.coerencia} />
    </div>
  )
}

/* ------------------------------------------------- cartão da NBS (veredito) --- */

/** Selo do ano de referência — a precificação muda conforme o ano. */
export function SeloAnoReferencia({
  ano,
  emTransicao,
}: {
  ano: number
  emTransicao: boolean
}): ReactElement {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
        emTransicao
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
          : 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200'
      }`}
      title={
        emTransicao
          ? 'Ano em transição (valores 2033, confirmar operação)'
          : 'Ano de referência da precificação'
      }
    >
      ref. {ano}
      {emTransicao ? ' · em transição' : ''}
    </span>
  )
}

/**
 * Cartão de UM veredito NBS: faixa tributária, CST/cClassTrib, reduções,
 * precificação no ano de referência e badges de benefício/lastro.
 * Com `destaque`, ganha a `MolduraAurumAI` (NBS mais provável / escolhida).
 */
export function CartaoCnaeNbs({
  veredito,
  destaque = false,
  plausibilidade,
}: {
  veredito: VereditoNbs
  destaque?: boolean
  plausibilidade?: number
}): ReactElement {
  const corpo = (
    <div className="space-y-2">
      <FaixaTributaria
        redIBS={veredito.reducaoIBS}
        redCBS={veredito.reducaoCBS}
        anexo={veredito.anexoLC214}
        baseLegal={veredito.baseLegal}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
          {veredito.nbsFormatado}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300" title={veredito.descricao ?? ''}>
          {veredito.descricao || '—'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
        {veredito.temBeneficio ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
            com benefício
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            tributação integral
          </span>
        )}
        {veredito.semLastro ? (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
            title="Sem vínculo oficial no resolvedor — redução 0, nunca inventada"
          >
            sem-lastro-reforma
          </span>
        ) : null}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {veredito.cst}/{veredito.cClassTrib}
        </span>
        <SeloAnoReferencia ano={veredito.anoReferencia} emTransicao={veredito.emTransicao} />
        {typeof plausibilidade === 'number' ? (
          <span
            className="rounded-full bg-brand-100 px-2 py-0.5 text-brand-700 dark:bg-brand-950/60 dark:text-brand-200"
            title="Score de plausibilidade do ranking (escala própria do motor)"
          >
            plausibilidade {plausibilidade.toLocaleString('pt-BR')}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-950/40">
          <dt className="text-[10px] font-bold uppercase text-slate-400">IBS</dt>
          <dd className="font-mono font-bold">{fmtMoeda(veredito.calculo.vIBS)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-950/40">
          <dt className="text-[10px] font-bold uppercase text-slate-400">CBS</dt>
          <dd className="font-mono font-bold">{fmtMoeda(veredito.calculo.vCBS)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-950/40">
          <dt className="text-[10px] font-bold uppercase text-slate-400">Tributos</dt>
          <dd className="font-mono font-bold">{fmtMoeda(veredito.calculo.total)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-950/40">
          <dt className="text-[10px] font-bold uppercase text-slate-400">Red. IBS/CBS</dt>
          <dd className="font-mono font-bold">
            {veredito.reducaoIBS.toLocaleString('pt-BR')}%/
            {veredito.reducaoCBS.toLocaleString('pt-BR')}%
          </dd>
        </div>
      </dl>
      {veredito.baseLegal ? (
        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={veredito.baseLegal}>
          {veredito.baseLegal}
        </p>
      ) : null}
    </div>
  )
  if (!destaque) return corpo
  return (
    <MolduraAurumAI detalhe="destacou a NBS mais provável do CNAE">{corpo}</MolduraAurumAI>
  )
}

/* ------------------------------------------------- linha + seletor do ranking --- */

/** Linha compacta do ranking: NBS + benefício + plausibilidade. */
export function LinhaNbsBeneficio({
  veredito,
  item,
  ativa,
  onEscolher,
}: {
  veredito: VereditoNbs
  item: ItemRankingNbs | null
  ativa: boolean
  onEscolher?: () => void
}): ReactElement {
  return (
    <li
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-xs transition ${
        ativa ? 'bg-brand-50 font-bold dark:bg-brand-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-950/40'
      }`}
    >
      <span className="font-mono font-black text-brand-700 dark:text-aurum-200">
        {veredito.nbsFormatado}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300" title={veredito.descricao ?? ''}>
        {veredito.descricao || '—'}
      </span>
      {veredito.temBeneficio ? (
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          −{Math.max(veredito.reducaoIBS, veredito.reducaoCBS).toLocaleString('pt-BR')}%
        </span>
      ) : (
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          integral
        </span>
      )}
      {item ? (
        <span className="font-mono text-[10px] text-slate-400" title="Plausibilidade no ranking">
          {item.score.toLocaleString('pt-BR')}
        </span>
      ) : null}
      {onEscolher ? (
        <button
          type="button"
          className="rounded-lg px-1.5 py-0.5 text-[11px] font-black text-brand-700 hover:bg-brand-100 dark:text-aurum-200 dark:hover:bg-brand-900/40"
          aria-pressed={ativa}
          title="Fixar esta NBS como a escolhida"
          onClick={onEscolher}
        >
          {ativa ? '● escolhida' : '○ escolher'}
        </button>
      ) : null}
    </li>
  )
}

/**
 * UX de escolha quando o ranking é ambíguo: grupo de radios que fixa
 * `nbsEscolhida` (o painel recalcula o destaque a partir dela).
 */
export function SeletorNbsAmbigua({
  ranking,
  porNbs,
  ativa,
  onEscolher,
}: {
  ranking: ItemRankingNbs[]
  porNbs: Map<string, VereditoNbs>
  ativa: string | null
  onEscolher: (nbs: string) => void
}): ReactElement | null {
  if (ranking.length <= 1) return null
  return (
    <fieldset className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-aurum-900 dark:bg-brand-950/20">
      <legend className="px-1 text-[11px] font-black uppercase tracking-wide text-brand-700 dark:text-aurum-200">
        Múltiplas NBS plausíveis — escolha a aplicável
      </legend>
      <div className="max-h-56 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Escolher NBS">
        {ranking.map((item) => {
          const v = porNbs.get(item.nbs)
          if (!v) return null
          const marcado = (ativa ?? ranking[0]?.nbs) === item.nbs
          return (
            <label
              key={item.nbs}
              className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
                marcado ? 'bg-brand-100 font-bold dark:bg-brand-900/40' : 'hover:bg-white/60 dark:hover:bg-black/20'
              }`}
            >
              <input
                type="radio"
                name="nbs-escolhida"
                value={item.nbs}
                checked={marcado}
                onChange={() => onEscolher(item.nbs)}
                className="accent-brand-600"
              />
              <span className="font-mono font-black">{v.nbsFormatado}</span>
              <span className="min-w-0 flex-1 truncate" title={v.descricao ?? ''}>
                {v.descricao || '—'}
              </span>
              {v.temBeneficio ? (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                  benefício
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        A escolha fixa a NBS em destaque acima — confirme com o contador antes de escriturar.
      </p>
    </fieldset>
  )
}

/* ------------------------------------------------- bloco único de NBS --- */

/** Percentual pt-BR (`7.6` → `7,6%`). */
function fmtPct(n: number): string {
  return `${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
}

/**
 * Texto pt-BR (`1.000,50`) → número; `null` se inválido. Aceita ponto ou
 * vírgula como decimal quando não há ambiguidade.
 */
function numeroBr(v: string): number | null {
  const t = String(v ?? '').trim()
  if (!t) return null
  const limpo = t.replace(/\s+/g, '')
  const norm = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
  const n = Number(norm)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Memória de cálculo do veredito: mostra QUAL base foi usada, a alíquota de
 * referência do ano, a redução aplicada, a alíquota efetiva e cada passo da
 * fórmula — com base editável para projetar outra operação (proporcional).
 */
function MemoriaCalculoNbs({
  veredito,
  rotuloRef,
}: {
  veredito: VereditoNbs
  rotuloRef: string
}): ReactElement {
  const c = veredito.calculo
  const [baseTxt, setBaseTxt] = useState<string>('100')
  const digitada = numeroBr(baseTxt)
  const baseInvalida = baseTxt.trim() !== '' && digitada === null
  const base = digitada ?? c.base
  const fator = c.base > 0 ? base / c.base : 1
  const vIBS = round2(c.vIBS * fator)
  const vCBS = round2(c.vCBS * fator)
  const total = round2(vIBS + vCBS)
  const carga = base > 0 ? (total / base) * 100 : 0
  const temReducao = c.redIBS > 0 || c.redCBS > 0
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          🧮 Memória de cálculo
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
          Base da operação R$
          <input
            value={baseTxt}
            onChange={(e) => setBaseTxt(e.target.value)}
            inputMode="decimal"
            aria-label="Base da operação em reais para simulação proporcional"
            className={`w-24 rounded-lg border px-1.5 py-0.5 text-right font-mono text-xs ${
              baseInvalida
                ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
                : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
            }`}
          />
        </label>
      </div>
      {baseInvalida ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-300">
          Base inválida — mostrando os valores da base padrão ({fmtMoeda(c.base)}).
        </p>
      ) : null}
      <ol className="mt-2 space-y-1 font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-200">
        <li>
          <span className="font-black text-slate-400">base</span> = {fmtMoeda(base)}
          {digitada !== null && Math.abs(base - c.base) > 0.004 ? (
            <span className="text-slate-400"> (simulação — padrão {fmtMoeda(c.base)})</span>
          ) : (
            <span className="text-slate-400"> (operação hipotética de {fmtMoeda(c.base)})</span>
          )}
        </li>
        <li>
          <span className="font-black text-slate-400">ref. {rotuloRef}</span> → IBS {fmtPct(c.refIBS)} · CBS{' '}
          {fmtPct(c.refCBS)}
        </li>
        <li>
          <span className="font-black text-slate-400">redução</span> →{' '}
          {temReducao ? (
            <>IBS {fmtPct(c.redIBS)} · CBS {fmtPct(c.redCBS)}</>
          ) : (
            <>sem redução — alíquota cheia</>
          )}
        </li>
        <li>
          <span className="font-black text-slate-400">alíquota efetiva</span> = ref × (1 − redução) → IBS{' '}
          {fmtPct(c.aliqIBS)} · CBS {fmtPct(c.aliqCBS)}
        </li>
        <li>
          <span className="font-black text-slate-400">IBS</span> = {fmtMoeda(base)} × {fmtPct(c.aliqIBS)}{' '}
          = <strong>{fmtMoeda(vIBS)}</strong>
        </li>
        <li>
          <span className="font-black text-slate-400">CBS</span> = {fmtMoeda(base)} × {fmtPct(c.aliqCBS)}{' '}
          = <strong>{fmtMoeda(vCBS)}</strong>
        </li>
        <li>
          <span className="font-black text-slate-400">total</span> = {fmtMoeda(vIBS)} + {fmtMoeda(vCBS)} ={' '}
          <strong>{fmtMoeda(total)}</strong> <span className="text-slate-400">(carga {fmtPct(carga)})</span>
        </li>
      </ol>
    </div>
  )
}

/**
 * Bloco ÚNICO de NBS vinculadas ao CNAE: uma lista só, sem cartões
 * duplicados. Itens COM benefício ganham destaque (fundo emerald suave +
 * faixa tributária + valores); itens SEM benefício aparecem como linha
 * normal. Tocar/clicar numa linha expande os detalhes (acordeão de item
 * único). Descrições sempre com quebra de linha — nunca `truncate` com
 * estouro horizontal.
 */
export function BlocoUnicoNbs({
  consulta,
  ativa,
  onEscolher,
}: {
  consulta: ConsultaCnae
  /** NBS expandida (em geral `nbsEscolhida ?? maisProvavel`). */
  ativa: string | null
  onEscolher: (nbs: string) => void
}): ReactElement | null {
  const porNbs = new Map(consulta.vereditos.map((v) => [v.nbs, v] as const))
  const itens = consulta.ranking
    .map((item) => ({ item, veredito: porNbs.get(item.nbs) ?? null }))
    .filter((r): r is { item: ItemRankingNbs; veredito: VereditoNbs } => r.veredito !== null)
    .sort((a, b) => {
      const ben = Number(b.veredito.temBeneficio) - Number(a.veredito.temBeneficio)
      if (ben !== 0) return ben
      return b.item.score - a.item.score
    })
  if (!itens.length) return null
  const comBeneficio = itens.filter((r) => r.veredito.temBeneficio).length
  return (
    <section
      aria-label={`NBS vinculadas ao CNAE (${itens.length})`}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          NBS vinculadas ({itens.length.toLocaleString('pt-BR')})
        </h4>
        {comBeneficio > 0 ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
            {comBeneficio.toLocaleString('pt-BR')} com benefício
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            tributação integral
          </span>
        )}
        <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">toque numa linha para ver os valores</span>
      </div>
      <ul className="scroll-elegante max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {itens.map(({ item, veredito: v }) => {
          const expandida = (ativa ?? consulta.maisProvavel) === v.nbs
          const ben = v.temBeneficio
          const reducaoMax = Math.max(v.reducaoIBS, v.reducaoCBS)
          return (
            <li
              key={v.nbs}
              className={ben ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : undefined}
            >
              <button
                type="button"
                onClick={() => onEscolher(v.nbs)}
                aria-expanded={expandida}
                title={expandida ? 'Recolher detalhes' : 'Expandir detalhes desta NBS'}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                  expandida
                    ? ben
                      ? 'bg-emerald-100/70 dark:bg-emerald-900/30'
                      : 'bg-brand-50 dark:bg-brand-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                    expandida
                      ? 'bg-brand-600 text-white'
                      : ben
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                  aria-hidden="true"
                >
                  {expandida ? '−' : '+'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-base font-black text-brand-700 dark:text-aurum-200">
                      {v.nbsFormatado}
                    </span>
                    {ben ? (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-black text-white">
                        −{reducaoMax.toLocaleString('pt-BR')}% benefício
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        integral
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block whitespace-normal break-words text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-200">
                    {v.descricao || '—'}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                      {v.cst}/{v.cClassTrib}
                    </span>
                    {v.anexoLC214 ? <span>Anexo LC 214 {v.anexoLC214}</span> : null}
                    <span title="Plausibilidade no ranking">plaus. {item.score.toLocaleString('pt-BR')}</span>
                  </span>
                </span>
              </button>
              {expandida ? (
                <div className="space-y-4 px-4 pb-5 pl-12">
                  <div className="py-4">
                    <FaixaTributaria
                      redIBS={v.reducaoIBS}
                      redCBS={v.reducaoCBS}
                      anexo={v.anexoLC214}
                      baseLegal={v.baseLegal}
                    />
                  </div>
                  <MemoriaCalculoNbs
                    veredito={v}
                    rotuloRef={`${consulta.anoReferencia}${consulta.emTransicao ? ' (transição, valores 2033)' : ''}`}
                  />
                  {v.baseLegal ? (
                    <p className="whitespace-normal break-words text-xs text-slate-500 dark:text-slate-400">
                      {v.baseLegal}
                    </p>
                  ) : null}
                  {v.semLastro ? (
                    <p
                      className="whitespace-normal break-words text-xs text-amber-700 dark:text-amber-300"
                      title="Sem vínculo oficial no resolvedor — redução 0, nunca inventada"
                    >
                      sem-lastro-reforma — confirme com o contador antes de escriturar.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
