/**
 * UI do grafo fiscal (Phase 10-05 / GRAFO-05 + GRAFO-08).
 *
 * - `BadgeViaGrafo`: selo `via:grafo` / `via:grafo+ia` (Consulta NCM, Serviços, CNAEs);
 * - `ModalTrilhaGrafo`: trilha auditável (cypher executado + caminho + proveniência + boost `uso_local`);
 * - `PorQueSugeriu`: linha `base + seu uso` (com `boost: uso_local`).
 *
 * O caminho NUNCA é exibido sem proveniência (fail-closed: sem proveniência,
 * o modal mostra aviso em vez do caminho).
 */
import { useState } from 'react'
import { Modal } from './kit'
import { NOME_IA } from '@/domain/aurum-ai'

export type ProvenienciaTrilha = {
  de: string
  para: string
  tipo: string
  origem: string
  confianca: number
  anoReferencia?: number | null
}

export function BadgeViaGrafo({ via }: { via: string | null | undefined }) {
  if (via !== 'grafo' && via !== 'grafo+ia') return null
  const rotulo = via === 'grafo+ia' ? 'via:grafo+ia' : 'via:grafo'
  return (
    <span
      className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
      title={`Resposta com caminho do grafo fiscal local (multi-hop auditável) — o resolvedor validou o código. ${NOME_IA} propôs, a base oficial decidiu.`}
      role="status"
      aria-label={rotulo}
    >
      {rotulo}
    </span>
  )
}

export function PorQueSugeriu({
  caminho,
  boost,
  boostValor,
}: {
  caminho?: string[] | null
  boost?: 'uso_local' | null
  boostValor?: number
}) {
  if (!caminho?.length) return null
  return (
    <p
      className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
      title="Base oficial + seu uso local (overlay só-na-máquina, só reordena — nunca cria redução)"
    >
      <strong>Por que sugeriu:</strong> base: {caminho.join(' → ')}
      {boost === 'uso_local' && Number(boostValor) > 0 ? (
        <span className="font-mono font-bold"> + seu uso (boost: uso_local +{Number(boostValor)})</span>
      ) : null}
    </p>
  )
}

export function BotaoTrilhaGrafo({
  cypher,
  caminho,
  proveniencia,
  boost,
  boostValor,
}: {
  cypher?: string | null
  caminho?: string[] | null
  proveniencia?: ProvenienciaTrilha[] | null
  boost?: 'uso_local' | null
  boostValor?: number
}) {
  const [aberto, setAberto] = useState(false)
  if (!cypher && !caminho?.length) return null
  return (
    <>
      <button
        type="button"
        className="btn-detalhe-premium btn-detalhe-premium--ia"
        title="Ver cypher executado + caminho + proveniência + boost"
        onClick={() => setAberto(true)}
      >
        <span aria-hidden="true">🕸️</span>
        <span>Trilha do grafo</span>
      </button>
      <ModalTrilhaGrafo
        aberto={aberto}
        onFechar={() => setAberto(false)}
        cypher={cypher}
        caminho={caminho}
        proveniencia={proveniencia}
        boost={boost}
        boostValor={boostValor}
      />
    </>
  )
}

export function ModalTrilhaGrafo({
  aberto,
  onFechar,
  cypher,
  caminho,
  proveniencia,
  boost,
  boostValor,
}: {
  aberto: boolean
  onFechar: () => void
  cypher?: string | null
  caminho?: string[] | null
  proveniencia?: ProvenienciaTrilha[] | null
  boost?: 'uso_local' | null
  boostValor?: number
}) {
  const temProveniencia = Array.isArray(proveniencia) && proveniencia.length > 0
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="🕸️ Trilha do grafo — caminho auditável"
      subtitulo="Cypher executado + caminho multi-hop + proveniência por aresta + boost de uso local."
      largura="max-w-2xl"
    >
      <div className="space-y-3 text-xs leading-relaxed">
        {caminho?.length ? (
          temProveniencia ? (
            <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-3 dark:bg-slate-950/40">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Caminho</div>
              <p className="mt-1 font-mono text-[11px]">{caminho.join(' → ')}</p>
              <div className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Proveniência por aresta</div>
              <ul className="mt-1 space-y-1 font-mono text-[11px]">
                {proveniencia!.map((p, i) => (
                  <li key={i}>
                    {p.de} —[{p.tipo}/{p.origem} conf {p.confianca}
                    {p.anoReferencia ? ` ano ${p.anoReferencia}` : ''}]→ {p.para}
                  </li>
                ))}
              </ul>
              <PorQueSugeriu caminho={caminho} boost={boost} boostValor={boostValor} />
            </div>
          ) : (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Caminho sem proveniência — não exibido por segurança (fail-closed). O código continua validado pelo
              resolvedor; a trilha completa está em `audit_log` + `logs/consultas-ia.jsonl`.
            </p>
          )
        ) : (
          <p className="text-slate-500">Sem caminho nesta resposta (fallback lexical).</p>
        )}
        {cypher ? (
          <details className="rounded-xl border border-slate-200 bg-slate-950 p-3 dark:border-slate-800" open>
            <summary className="cursor-pointer text-[11px] font-bold text-slate-300">Cypher executado</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-emerald-100">
              {cypher}
            </pre>
          </details>
        ) : null}
        {boost === 'uso_local' ? (
          <p className="text-[11px] text-slate-500">
            Boost de uso local aplicado: <span className="font-mono font-bold">uso_local +{Number(boostValor) || 0}</span>{' '}
            (teto 0.3, TTL 90d — só reordena, nunca cria redução).
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
