/**
 * Confronto amigável **Na nota × Pela legislação**.
 *
 * Quando o enquadramento/valores do emitente diferem do que o sistema
 * encontrou pela legislação, isso NÃO é um erro — é só duas leituras
 * diferentes da mesma operação. Por isso a apresentação evita vermelho,
 * "⚠" e a palavra "divergente": mostra um comparativo neutro em tom
 * informativo (brand/slate) com um ícone animado (balança) que abre um
 * balão explicando a diferença em linguagem simples.
 */
import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { fmtMoeda } from '@/domain/services/format'
import { divergenciaXmlSistema } from '@/infrastructure/nfe/credito'
import { BotaoVerLegislacao } from '@/ui/cartoes'
import type { ResultadoItemNfe } from '@/infrastructure/nfe/tipos'

/** Balança em SVG inline — símbolo de "comparar dois lados". */
function IconeBalanca({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v18M8 21h8M12 5 5 7m7-2 7 2" />
      <path d="M5 7 2.8 13a2.4 2.4 0 0 0 4.4 0L5 7Z" />
      <path d="m19 7-2.2 6a2.4 2.4 0 0 0 4.4 0L19 7Z" />
    </svg>
  )
}

/**
 * Botão-ícone com microanimação contínua (balanço suave da balança) para
 * sinalizar "aqui tem algo para comparar". Respeita `prefers-reduced-motion`.
 */
function BotaoBalanca({
  aberto,
  onAlternar,
  balaoId,
}: {
  aberto: boolean
  onAlternar: () => void
  balaoId: string
}) {
  const reduzir = useReducedMotion() ?? false
  return (
    <motion.button
      type="button"
      onClick={onAlternar}
      aria-expanded={aberto}
      aria-controls={balaoId}
      title={aberto ? 'Fechar explicação' : 'Entender a diferença'}
      aria-label={aberto ? 'Fechar explicação da diferença' : 'Entender a diferença entre a nota e o sistema'}
      animate={reduzir ? undefined : { rotate: [0, -7, 7, 0], scale: [1, 1.08, 1] }}
      transition={reduzir ? undefined : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.9 }}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-pop"
    >
      <IconeBalanca className="h-5 w-5" />
    </motion.button>
  )
}

/** Texto explicativo da diferença, montado a partir dos dados reais do item.
 *
 * Separa os dois níveis para mostrar ciência do que houve:
 * - enquadramento (CST/cClassTrib): diferença **no item em si**;
 * - só valores, com o mesmo enquadramento: diferença nas **alíquotas-base de
 *   referência** usadas em cada cálculo (as do emitente na nota vs. as
 *   configuradas na importação), não no item.
 */
function BlocoExplicacao({ item }: { item: ResultadoItemNfe }) {
  const d = divergenciaXmlSistema(item)
  const destacado = (Number(item.vIbsItem) || 0) + (Number(item.vCbsItem) || 0)
  // Enquadramento único e oficial: o NCM tem uma só classificação na base
  // (sem ambiguidade, sem fallback da regra geral e sem reclassificação
  // manual) — então o sistema pode afirmar qual é o correto.
  const manual = item.manual || item.classificacao.manual != null
  const unicaOficial = item.opcoesClassificacao === 1 && !item.regraGeral && !manual
  const qtdOpcoes = Number(item.opcoesClassificacao ?? 0)
  const multipla = qtdOpcoes > 1
  const baseLegal = item.classificacao.baseLegal?.trim() ?? ''
  const urlLei =
    item.classificacao.resumo?.urlLegislacao ??
    item.classificacao.referencia?.urlLegislacao ??
    null
  return (
    <div className="space-y-2 text-[11px] leading-relaxed">
      <p className="font-bold">O que cada lado mostra:</p>
      {d.divergeEnquadramento ? (
        <div className="rounded-lg bg-white/70 p-2 dark:bg-slate-900/60">
          <p>
            🏷️ <strong>Enquadramento do item:</strong> na nota, CST {item.cstIbsCbs || '—'} ·
            cClassTrib {item.cClassTribIbsCbs || '—'}; pela legislação: CST{' '}
            {item.classificacao.cst} · cClassTrib {item.classificacao.cClassTrib} (base
            oficial{manual ? ' + sua reclassificação' : ''}). Aqui a diferença é no item
            em si.
          </p>
          {unicaOficial ? (
            <p className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-2 dark:border-emerald-800 dark:bg-emerald-950/30">
              O correto é: <strong>CST {item.classificacao.cst} · cClassTrib{' '}
              {item.classificacao.cClassTrib}</strong>
              {baseLegal ? (
                <span title={item.classificacao.baseLegal}> — sob {baseLegal.slice(0, 120)}{baseLegal.length > 120 ? '…' : ''}</span>
              ) : null}
              <br />
              <BotaoVerLegislacao
                url={urlLei}
                titulo={baseLegal || `CST ${item.classificacao.cst} · ${item.classificacao.cClassTrib}`}
                rotulo="Ver legislação na íntegra"
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-card transition hover:bg-brand-700"
              />
            </p>
          ) : multipla ? (
            <p className="mt-1">
              🔀 Para este item, pela legislação, {qtdOpcoes} opções foram identificadas —
              a aplicada aqui foi CST {item.classificacao.cst} ·{' '}
              {item.classificacao.cClassTrib}; confira se é a adequada ao caso.
            </p>
          ) : (
            <p className="mt-1">Confira qual enquadramento está correto antes de escriturar.</p>
          )}
        </div>
      ) : null}
      {d.divergeValores && !d.divergeEnquadramento ? (
        <p className="rounded-lg bg-white/70 p-2 dark:bg-slate-900/60">
          💰 <strong>Só os valores:</strong> o enquadramento é o mesmo dos dois lados, então
          a diferença ({fmtMoeda(destacado)} na nota × {fmtMoeda(item.totalTributos)} pela
          legislação) vem das <strong>alíquotas-base de referência</strong> usadas em cada
          cálculo — as que o emitente aplicou na nota vs. as configuradas na
          importação. Não é o item, é a base do cálculo.
        </p>
      ) : null}
      {d.divergeValores && d.divergeEnquadramento ? (
        <p className="rounded-lg bg-white/70 p-2 dark:bg-slate-900/60">
          💰 <strong>Valores:</strong> {fmtMoeda(destacado)} destacados na nota ×{' '}
          {fmtMoeda(item.totalTributos)} estimados pela legislação. Com enquadramentos
          diferentes os valores naturalmente diferem — e ainda pesam as alíquotas-base de
          referência de cada lado.
        </p>
      ) : null}
      <p className="text-slate-500 dark:text-slate-400">
        Compare as seções “Na nota” e “Pela legislação” abaixo para ver lado a lado.
      </p>
    </div>
  )
}

/**
 * Aviso de múltiplas opções: quando a legislação traz mais de um
 * enquadramento possível para o NCM, o sistema declara quantas opções
 * identificou — a aplicada é só uma delas e pede conferência.
 */
export function AvisoMultiplasOpcoes({ item }: { item: ResultadoItemNfe }) {
  const qtd = Number(item.opcoesClassificacao ?? 0)
  if (!(qtd > 1)) return null
  return (
    <p className="mt-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2 text-[11px] leading-relaxed text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">
      🔀 Para este item, pela legislação, {qtd} opções foram identificadas — a aplicada
      aqui foi CST {item.classificacao.cst} · {item.classificacao.cClassTrib}; confira se
      é a adequada ao caso.
    </p>
  )
}

/**
 * Faixa de confronto no topo do detalhe do item — comparativo neutro com
 * balão explicativo.
 */
export function FaixaConfrontoXml({ item }: { item: ResultadoItemNfe }) {
  const d = divergenciaXmlSistema(item)
  const [aberto, setAberto] = useState(false)
  const balaoId = useId()

  if (!d.temXml) {
    return (
      <>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-950/40">
          Sem IBS/CBS destacado neste item — abaixo só o cálculo pela legislação.
        </p>
        <AvisoMultiplasOpcoes item={item} />
      </>
    )
  }

  if (!d.diverge) {
    return (
      <>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          <span aria-hidden>✓</span>
          <span>Mesma leitura — o enquadramento do emitente confere com o da legislação.</span>
        </div>
        <AvisoMultiplasOpcoes item={item} />
      </>
    )
  }

  return (
    <>
    <div className="rounded-2xl border border-brand-200/70 bg-gradient-to-r from-brand-50/70 to-white p-3.5 dark:border-brand-900 dark:from-brand-950/30 dark:to-slate-900">
      <div className="flex items-start gap-3">
        <BotaoBalanca aberto={aberto} onAlternar={() => setAberto((v) => !v)} balaoId={balaoId} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-brand-800 dark:text-brand-200">
            Leitura diferente da nota
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Comparativo entre o destacado na nota e o cálculo pela legislação — toque na
            balança para entender.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/80 p-2 shadow-card dark:bg-slate-900/70">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                🧾 Na nota
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {item.cstIbsCbs || '—'} · {item.cClassTribIbsCbs || '—'}
              </div>
            </div>
            <div className="rounded-xl bg-white/80 p-2 shadow-card dark:bg-slate-900/70">
              <div className="text-[10px] font-black uppercase tracking-wide text-brand-500">
                🧮 Pela legislação
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] font-bold text-brand-700 dark:text-aurum-200">
                {item.classificacao.cst} · {item.classificacao.cClassTrib}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-controls={balaoId}
            className="mt-2 text-[11px] font-bold text-brand-600 hover:underline dark:text-aurum-200"
          >
            {aberto ? '▾ Fechar explicação' : '▸ Entender a diferença'}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {aberto ? (
          <motion.div
            key="balao"
            id={balaoId}
            role="dialog"
            aria-label="Explicação da diferença entre a nota e a legislação"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 0.9, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="relative mt-3 rounded-xl border border-brand-200/70 bg-brand-50/60 p-3 text-slate-600 dark:border-brand-900 dark:bg-brand-950/20 dark:text-slate-300">
              <span
                aria-hidden
                className="absolute -top-[7px] left-5 h-3 w-3 rotate-45 border-l border-t border-brand-200/70 bg-brand-50 dark:border-brand-900 dark:bg-brand-950"
              />
              <BlocoExplicacao item={item} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
    <AvisoMultiplasOpcoes item={item} />
    </>
  )
}
