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
import type { ReactElement } from 'react'
import type { AtividadeCnae } from '@/application/consultar-por-cnpj'
import type { ConsultaCnae } from '@/application/consultar-por-cnae'
import type { CnaeAnexo } from '@/domain/entities'
import { tetoConfiancaCnae } from '@/domain/services/cnae'
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
