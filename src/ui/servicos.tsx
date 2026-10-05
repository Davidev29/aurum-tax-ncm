/**
 * Cartões de Serviços (Phase 7) — CNAE + NBS no padrão do kit.
 *
 * Reuso total: `FaixaTributaria`, `CartaoEnxuto`, `MolduraAurumAI`,
 * `BarraConfiancaAurumAI`, `SeloAurumAI`, `BotaoDetalhePremium`,
 * `ModalNcmsAnalisados`, `ModalSimulacaoIA`, `ModalAuditoriaIA`, `Btn`.
 * Novo aqui: só o cabeçalho CNAE (`FaixaCnae`) e a composição (`CartaoCnae`).
 */
import { useState, type ReactElement } from 'react'
import type { Classificacao } from '@/domain/entities'
import { fmtCnpj, fmtMoeda } from '@/domain/services/format'
import { fmtNbs } from '@/domain/services/format'
import { corSituacaoCnae, rotuloAnexoSimples } from '@/domain/services/cnae'
import { descricaoHipotese } from '@/domain/services/verificacao-servicos'
import type { HipoteseLegal } from '@/domain/services/verificacao-servicos'
import type { AtividadeCnae } from '@/application/consultar-por-cnpj'
import { VALOR_BASE_IA } from '@/infrastructure/ia/classificacao-ia-repo'
import { NOME_IA, nivelDeConfianca } from '@/domain/aurum-ai'
import { useUi } from '@/store/ui'
import { Btn, Painel } from './kit'
import { FaixaTributaria } from './faixa-tributaria'
import { CartaoEnxuto, DetalhesEnxutos } from './consulta-enxuta'
import {
  BarraConfiancaAurumAI,
  MolduraAurumAI,
  SeloAurumAI,
} from './aurum-ai'
import {
  BotaoDetalhePremium,
  ModalAuditoriaIA,
  ModalNcmsAnalisados,
  ModalSimulacaoIA,
} from './consulta-premium'
import { PillAnexos } from './cartoes'

/* ------------------------------------------------- cabeçalho CNAE -- */

export function FaixaCnae({ atividade }: { atividade: AtividadeCnae }): ReactElement {
  const cnae = atividade.cnaeTabela
  const corSit = cnae ? corSituacaoCnae(cnae.situacao) : 'slate'
  const corClasse =
    corSit === 'emerald'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
      : corSit === 'amber'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
        : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
          {atividade.codigoFormatado}
        </span>
        <span className="text-sm text-slate-600 dark:text-slate-300">{atividade.descricao || '—'}</span>
        {atividade.principal ? (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-black text-brand-700 dark:bg-brand-950/60 dark:text-brand-200">
            Principal
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Secundário
          </span>
        )}
      </div>
      {cnae ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
          <span className={`rounded-full px-2 py-0.5 ${corClasse}`}>{cnae.situacao}</span>
          <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200">
            {rotuloAnexoSimples(cnae.anexos)}
          </span>
          {cnae.fatorR ? (
            <span
              className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200"
              title="Anexo Simples III ou V conforme a folha de salários (Fator R: 28% do faturamento)"
            >
              Fator R
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------- conferência Reforma -- */

export function BlocoConferenciaReforma({
  hipoteses,
  coerencia,
}: {
  hipoteses: HipoteseLegal[]
  coerencia: 'coerente' | 'divergente' | 'sem-base'
}): ReactElement | null {
  if (!hipoteses.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>🔎 Conferência com a tabela da Reforma</span>
        {coerencia === 'coerente' ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 normal-case text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
            decisão coerente com a lei
          </span>
        ) : coerencia === 'divergente' ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 normal-case text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
            divergente — conferir
          </span>
        ) : null}
      </div>
      <ul className="mt-2 space-y-1.5">
        {hipoteses.map((h) => (
          <li key={`${h.cst}|${h.cClassTrib}`} className="text-xs text-slate-600 dark:text-slate-300">
            <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">
              {h.cst}/{h.cClassTrib}
            </span>{' '}
            — {descricaoHipotese(h)}
            {!h.temNbs ? (
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                sem NBS mapeado
              </span>
            ) : null}
            <span className="block truncate text-[11px] text-slate-400" title={h.descricao}>
              {h.descricao}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-slate-400">
        Hipótese lida da tabela oficial — vale como verificação, não como enquadramento. Sem NBS
        vinculado na base atual, a decisão segue a regra geral até confirmação.
      </p>
    </div>
  )
}

/* ------------------------------------------------- contexto do NBS -- */

import { obterContextoNbs, type ContextoNbsView } from '@/domain/constants/contexto-nbs'

/**
 * Cartão do contexto personalizado do NBS (LC 214) — resumo, condições e
 * quando se aplica / não se aplica. Usado na descrição preditiva (sugestão
 * principal, preditivas e cartão CNAE). Só leitura: nunca altera o vínculo.
 */
export function BlocoContextoNbs({
  codigo,
  contexto,
  compacto,
}: {
  /** NBS 9 dígitos (busca o contexto) ou contexto já resolvido. */
  codigo?: string | null
  contexto?: ContextoNbsView | null
  compacto?: boolean
}): ReactElement | null {
  const ctx = contexto ?? (codigo ? obterContextoNbs(codigo) : null)
  if (!ctx) return null
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-2.5 text-xs text-slate-600 dark:border-violet-900 dark:bg-violet-950/20 dark:text-slate-300" aria-label={`Contexto ${ctx.tituloCurto}`}>
      <p className="font-black text-violet-900 dark:text-violet-200">
        📖 {ctx.tituloCurto} · <span className="font-mono">{ctx.artigo}</span> · −{ctx.reducaoIBS}% IBS/CBS
      </p>
      <p className="mt-1">{ctx.resumo}</p>
      {!compacto ? (
        <>
          <p className="mt-1.5 font-bold">Quando se aplica:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {ctx.quandoSeAplica.slice(0, 4).map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p className="mt-1.5 font-bold">Quando NÃO se aplica:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {ctx.quandoNaoSeAplica.slice(0, 3).map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p className="mt-1.5 font-bold">Condições:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {ctx.condicoes.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          {ctx.nota ? (
            <p className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              ⚠️ {ctx.nota}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------- Phase 9 / 09-04: regras + NBS -- */

/**
 * Bloco Regras compacto (09-04) — SEMPRE renderiza.
 * Prefere a camada 1 (`atividade.regras`); sem ela, usa `cnaeTabela`;
 * sem tabela, orienta o modo manual (nunca silêncio).
 */
export function BlocoRegrasCnae({ atividade }: { atividade: AtividadeCnae }): ReactElement {
  const r = atividade.regras
  if (r?.estado === 'ok') {
    return (
      <div
        className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/40"
        aria-label={`Regras do CNAE ${r.codigoFormatado}`}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
          <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">📋 Regras</span>
          <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200">
            {r.rotuloAnexo}
          </span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {r.situacao}
          </span>
          {r.fatorR ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
              Fator R
            </span>
          ) : null}
          <span
            className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            title="Ano de referência da Reforma (precificação IBS/CBS)"
          >
            ref. {atividade.anoReferencia}
          </span>
        </div>
        {r.vedacaoTextual.length ? (
          <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {r.vedacaoTextual[0]}
          </p>
        ) : null}
      </div>
    )
  }
  const t = atividade.cnaeTabela
  if (t) {
    return (
      <div
        className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/40"
        aria-label={`Regras do CNAE ${atividade.codigoFormatado}`}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
          <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">📋 Regras</span>
          <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200">
            {rotuloAnexoSimples(t.anexos)}
          </span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {t.situacao}
          </span>
          {t.fatorR ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
              Fator R
            </span>
          ) : null}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            ref. {atividade.anoReferencia}
          </span>
        </div>
      </div>
    )
  }
  return (
    <p
      className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
      aria-label={`Regras do CNAE ${atividade.codigoFormatado}`}
    >
      📋 Regras: CNAE fora da tabela viva — classifique no modo manual.
    </p>
  )
}

/**
 * Seção NBS colapsável (09-04): destaque do mais provável + ranking resumido
 * + lista completa com scroll (`max-h`) para os 98 itens. Bens → faixa
 * `sem NBS aplicável — atividade de bens (ver NCM)` + botão à Consulta NCM.
 */
export function SecaoNbsCnae({ atividade }: { atividade: AtividadeCnae }): ReactElement | null {
  const estado = atividade.estadoNbs
  const ano = atividade.anoReferencia
  if (estado === 'cnae-desconhecido') return null
  if (estado === 'bens→NCM') {
    return (
      <div
        className="space-y-2 rounded-xl border border-sky-300 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/40"
        role="note"
        aria-label={`CNAE ${atividade.codigoFormatado} sem NBS aplicável — atividade de bens`}
      >
        <p className="text-xs font-bold text-sky-900 dark:text-sky-200">
          🏭 sem NBS aplicável — atividade de bens (ver NCM)
        </p>
        <p className="text-[11px] text-sky-800/80 dark:text-sky-200/70">
          NBS cobre só serviços. Consulte o NCM do produto para a tributação da Reforma.
        </p>
        <Btn tam="sm" onClick={() => useUi.getState().trocarView('consulta')}>
          🔍 Ir à Consulta NCM
        </Btn>
      </div>
    )
  }
  if (estado === 'sem-mapeamento-NBS') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400"
        role="note"
        aria-label={`CNAE ${atividade.codigoFormatado} sem mapeamento NBS`}
      >
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          s/ mapeamento NBS
        </span>
        <span>
          Regra completa acima · fallback Phase 7 mantido · ref. {ano} (informativo)
        </span>
      </div>
    )
  }
  const lista = atividade.nbsLista ?? []
  if (!lista.length) return null
  const destaque = lista.find((v) => v.nbs === atividade.maisProvavel) ?? lista[0]
  const ordenados = [...lista].sort((a, b) => {
    if (a.nbs === atividade.maisProvavel) return -1
    if (b.nbs === atividade.maisProvavel) return 1
    if (a.temBeneficio !== b.temBeneficio) return a.temBeneficio ? -1 : 1
    return a.nbs.localeCompare(b.nbs)
  })
  const resumidos = ordenados.slice(0, 5)
  return (
    <details
      className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40"
      open={lista.length <= 3}
      aria-label={`NBS do CNAE ${atividade.codigoFormatado}`}
    >
      <summary className="cursor-pointer text-xs font-black text-slate-600 dark:text-slate-300">
        🧾 NBS disponíveis: {lista.length} ({atividade.nbsComBeneficio} com benefício, ref. {ano}) — ver lista
      </summary>
      <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 dark:border-emerald-800 dark:bg-emerald-950/40">
        <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          ★ Mais provável
        </p>
        <p className="mt-0.5 text-xs text-emerald-900 dark:text-emerald-200">
          <span className="font-mono font-black">{destaque.nbsFormatado}</span>
          {destaque.descricao ? <span className="ml-1.5">{destaque.descricao}</span> : null}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-black">
          {destaque.temBeneficio ? (
            <span className="rounded-full bg-emerald-200/70 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200">
              benefício Reforma
            </span>
          ) : (
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              sem benefício
            </span>
          )}
          {destaque.semLastro ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
              sem-lastro-reforma
            </span>
          ) : (
            <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200">
              {destaque.cst}/{destaque.cClassTrib}{destaque.anexoLC214 ? ` · Anexo LC 214 ${destaque.anexoLC214}` : ''}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            ref. {destaque.anoReferencia}
          </span>
        </div>
      </div>
      <ol className="mt-2 space-y-1">
        {resumidos.map((v) => (
          <li key={v.nbs} className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{v.nbsFormatado}</span>
            <span className="min-w-0 flex-1 truncate" title={v.descricao ?? ''}>{v.descricao ?? '—'}</span>
            {v.nbs === atividade.maisProvavel ? (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">★</span>
            ) : null}
            {v.temBeneficio ? (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">benefício</span>
            ) : null}
          </li>
        ))}
      </ol>
      {ordenados.length > resumidos.length ? (
        <>
          <p className="mt-2 text-[10px] font-black uppercase tracking-wide text-slate-400">
            Todos ({ordenados.length})
          </p>
          <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto pr-1">
            {ordenados.map((v) => (
              <li key={v.nbs} className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{v.nbsFormatado}</span>
                <span className="min-w-0 flex-1 truncate" title={v.descricao ?? ''}>{v.descricao ?? '—'}</span>
                {v.temBeneficio ? (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">benefício</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-2 text-[10px] text-slate-400">
        Informativo antes de qualquer cálculo — confirme com o contador antes de escriturar.
      </p>
    </details>
  )
}

/* ------------------------------------------------- cartão CNAE completo -- */

export function CartaoCnae({
  atividade,
  onSalvar,
  onAddCalc,
}: {
  atividade: AtividadeCnae
  onSalvar: (c: Classificacao) => void
  onAddCalc: (c: Classificacao) => void
}): ReactElement {
  const [modal, setModal] = useState<'ncms' | 'simulacao' | 'auditoria' | null>(null)
  const resultado = atividade.resultado
  const decisao = resultado?.decisao ?? null

  return (
    <article
      className="panel animate-fade-up space-y-3 p-4 sm:p-5"
      aria-label={`CNAE ${atividade.codigoFormatado} — ${atividade.descricao}`}
    >
      <FaixaCnae atividade={atividade} />

      <BlocoRegrasCnae atividade={atividade} />

      {atividade.estado === 'cnae-desconhecido' ? (
        <p className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          CNAE ausente da tabela viva — classifique no modo manual por descrição.
        </p>
      ) : null}
      {atividade.estado === 'manual-obrigatorio' ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>Situação “Depende da atividade”:</strong> a {NOME_IA} nunca ancora sozinha aqui. Use o
          modo manual com tomador e local para classificar. {atividade.motivoEstado}
        </p>
      ) : null}
      {atividade.estado === 'falha' ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <strong>Falha ao classificar:</strong> {atividade.motivoEstado ?? 'tente de novo.'}
        </p>
      ) : null}
      {atividade.estado === 'tributacao-integral' ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <FaixaTributaria redIBS={0} redCBS={0} anexo={null} baseLegal="LC 214/2025 — regra geral" />
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <strong>Tributação integral.</strong> {atividade.motivoEstado}
          </p>
          {(atividade.preditivas ?? []).length ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="note" aria-label="Sugestões preditivas informativas">
              <p className="font-black">🔮 Sugestão preditiva — apenas informativa, NÃO é decisão final</p>
              <ul className="mt-1.5 space-y-1">
                {(atividade.preditivas ?? []).map((p) => (
                  <li key={`${p.tipo}-${p.codigo}`} className="space-y-1 rounded-lg bg-white/60 px-2 py-1 dark:bg-black/20">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono font-black">{p.codigoFormatado}</span>
                      <span className="min-w-0 flex-1 truncate" title={p.titulo}>{p.titulo}</span>
                      <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-black dark:bg-amber-900/50">
                        {Math.round(p.cobertura * 100)}% termos
                      </span>
                    </span>
                    {p.tipo === 'nbs' ? <BlocoContextoNbs codigo={p.codigo} compacto /> : <BlocoContextoNbs contexto={p.contexto} compacto />}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] opacity-75">Confirme com o contador e classifique no modo manual antes de escriturar.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <BlocoConferenciaReforma hipoteses={atividade.hipoteses} coerencia={atividade.coerencia} />

      <SecaoNbsCnae atividade={atividade} />

      {decisao && resultado ? (
        <MolduraAurumAI detalhe={`classificou o NBS da atividade ${atividade.codigoFormatado}`}>
          <div className="flex flex-wrap items-center gap-2">
            <BarraConfiancaAurumAI valor={atividade.confiancaFinal} compact />
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              nível {nivelDeConfianca(atividade.confiancaFinal)}
            </span>
          </div>
          <div className="mt-2">
            <CartaoEnxuto
              cl={decisao}
              nomenclatura={null}
              onSalvar={(cl) => onSalvar(cl)}
              onAddCalc={(cl) => onAddCalc(cl)}
            />
          </div>
          {atividade.motivoEstado ? (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {atividade.motivoEstado}
            </p>
          ) : null}
          <div className="aurum-ai-acoes" role="group" aria-label="Explorar decisão da IA">
            {resultado.candidatos.length ? (
              <BotaoDetalhePremium
                icone="🔎"
                rotulo="NBSs analisados"
                contagem={Math.min(resultado.candidatos.length, 8)}
                variante="ia"
                titulo="Ver os NBS avaliados — abre em modal glass"
                onClick={() => setModal('ncms')}
              />
            ) : null}
            {resultado.calculo ? (
              <BotaoDetalhePremium
                icone="🧮"
                rotulo="Simulação"
                titulo={`Simulação sobre ${fmtMoeda(VALOR_BASE_IA)} — abre em modal glass`}
                onClick={() => setModal('simulacao')}
              />
            ) : null}
            <BotaoDetalhePremium
              icone="📚"
              rotulo="Bases e auditoria"
              titulo="Fontes lidas + motivo — abre em modal glass"
              onClick={() => setModal('auditoria')}
            />
          </div>
          <ModalNcmsAnalisados
            aberto={modal === 'ncms'}
            onFechar={() => setModal(null)}
            titulo="NBSs analisados pela Aurum AI"
            itens={resultado.candidatos.slice(0, 8).map((c) => ({
              codigo: c.codigo,
              titulo: fmtNbs(c.codigo),
              subtitulo: c.descricao,
            }))}
            codigoPreferido={resultado.codigoEscolhido}
            subtitulo={`A ${NOME_IA} avaliou ${resultado.candidatos.length} pista(s) para esta atividade.`}
          />
          <ModalSimulacaoIA
            aberto={modal === 'simulacao'}
            onFechar={() => setModal(null)}
            titulo={`Simulação exemplificativa (${fmtMoeda(VALOR_BASE_IA)})`}
          >
            {resultado.calculo ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">IBS</div>
                  <div className="font-mono font-bold">{fmtMoeda(resultado.calculo.vIBS)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">CBS</div>
                  <div className="font-mono font-bold">{fmtMoeda(resultado.calculo.vCBS)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Tributos</div>
                  <div className="font-mono font-bold">{fmtMoeda(resultado.calculo.total)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Carga</div>
                  <div className="font-mono font-bold">
                    {resultado.calculo.carga.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%
                  </div>
                </div>
              </div>
            ) : null}
          </ModalSimulacaoIA>
          <ModalAuditoriaIA
            aberto={modal === 'auditoria'}
            onFechar={() => setModal(null)}
            fontes={resultado.fontes}
            nota={`Motivo: ${resultado.motivo} · CNAE origem ${atividade.codigoFormatado}.`}
          />
        </MolduraAurumAI>
      ) : null}
    </article>
  )
}

/* ------------------------------------------------- ficha da empresa -- */

export function FichaEmpresaCnpj({
  razaoSocial,
  fantasia,
  cnpj,
  porte,
  situacao,
  opcaoSimples,
  dataConsulta,
  doCache,
  onAtualizar,
  atualizando,
  totalNbs,
  nbsComBeneficio,
  anoReferencia,
}: {
  razaoSocial: string
  fantasia: string
  cnpj: string
  porte: string | null
  situacao: string | null
  opcaoSimples: boolean | null
  dataConsulta: string
  doCache: boolean
  onAtualizar: () => void
  atualizando: boolean
  /** Contador NBS (09-04) — soma dos `nbsLista` das atividades. */
  totalNbs?: number
  /** Quantos NBS têm benefício da Reforma. */
  nbsComBeneficio?: number
  /** Ano de referência da precificação (default 2033). */
  anoReferencia?: number
}): ReactElement {
  return (
    <Painel className="p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-black">{razaoSocial || '—'}</span>
        {fantasia ? <span className="text-sm text-slate-500 dark:text-slate-400">{fantasia}</span> : null}
      </div>
      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
        CNPJ {fmtCnpj(cnpj)}
        {porte ? ` · Porte ${porte}` : ''}
        {situacao ? ` · ${situacao}` : ''}
        {opcaoSimples === true ? ' · Simples Nacional' : opcaoSimples === false ? ' · Fora do Simples' : ''}
      </p>
      {typeof totalNbs === 'number' ? (
        <p
          className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          aria-label={`NBS das atividades: ${totalNbs}`}
        >
          🧾 NBS: {totalNbs} ({nbsComBeneficio ?? 0} com benefício
          {typeof anoReferencia === 'number' ? `, ref. ${anoReferencia}` : ''})
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Dados da Receita via BrasilAPI em {dataConsulta.slice(0, 10)}
          {doCache ? ' (cache local)' : ''}.
        </span>
        <Btn tam="sm" carregando={atualizando} onClick={onAtualizar}>
          {atualizando ? 'Atualizando…' : '🔄 Atualizar'}
        </Btn>
      </div>
    </Painel>
  )
}

/* ------------------------------------------------- bloco fiscal NBS avulso -- */

/** Linha fiscal compacta para NBS já resolvido fora do CNAE (modo manual usa `CartaoEnxuto`). */
export function BlocoFiscalNbs({ cl }: { cl: Classificacao }): ReactElement {
  const r = cl.resumo
  const redIBS = Number(r.percentualReducaoIBS ?? 0)
  const redCBS = Number(r.percentualReducaoCBS ?? 0)
  return (
    <div className="space-y-2">
      <FaixaTributaria redIBS={redIBS} redCBS={redCBS} anexo={r.anexo} baseLegal={cl.baseLegal} />
      <PillAnexos codigo={cl.codigo} />
    </div>
  )
}

export function SeloServicosAurumAI(): ReactElement {
  return <SeloAurumAI variante="compacto" />
}

export function ResumoConfiancaServicos({ valor }: { valor: number }): ReactElement {
  return <BarraConfiancaAurumAI valor={valor} compact />
}

export function DetalhesPerguntasServicos({ itens }: { itens: string[] }): ReactElement | null {
  if (!itens.length) return null
  return (
    <DetalhesEnxutos titulo={`Para refinar (${itens.length})`}>
      <ul className="list-disc space-y-1 pl-4">
        {itens.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </DetalhesEnxutos>
  )
}
