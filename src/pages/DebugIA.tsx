/**
 * DebugIA — tela de diagnóstico da IA offline (Phase 6 / IA-05, tracer 06-05).
 *
 * Atalho global: `Ctrl+Shift+D` (registrado no `Layout`). Exibe candidatos
 * RAG, decisão validada pelo resolvedor, `via` (`deterministico`|`ia`) e a
 * métrica parcial `taxa_uso_ia`.
 *
 * A UI renderiza imediatamente sem esperar o modelo: o status do worker é
 * consultado de forma assíncrona e o gate (`classificarComIa`) só chama o
 * worker no fallback — descrições fáceis nem acordam o worker.
 */
import { useCallback, useEffect, useState } from 'react'
import { NOME_IA, ROTULO_FALLBACK, fmtConfiancaAurumAI } from '@/domain/aurum-ai'
import { classificarComIa } from '@/application/classificacao-ia'
import { montarSistemaLivre, sanitizarLivre } from '@/application/aurum-ai-livre'
import { SeloAurumAI, BarraConfiancaAurumAI } from '@/ui/aurum-ai'
import { bridge, type StatusIaBridge } from '@/infrastructure/bridge'
import { db } from '@/infrastructure/db/schema'
import { taxaUsoIa, useIa, type DecisaoIa } from '@/store/ia'
import { useUi } from '@/store/ui'
import { Entrada, Secao } from '@/ui/motion'

function seloVia(via: DecisaoIa['via']) {
  return via === 'ia'
    ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
}

/** % de NÃO SEI no histórico (falha segura observada). */
export function taxaNaoSei(historico: DecisaoIa[]): number {
  if (!historico.length) return 0
  const n = historico.filter((h) => h.codigoEscolhido === 'NÃO SEI').length
  return Math.round((n / historico.length) * 1000) / 10
}

/**
 * Append best-effort em `logs/metricas-ia.jsonl` (observabilidade 06-09).
 * Só em ambiente Node (vitest/Electron-main); no renderer é no-op — nunca
 * quebra a UI.
 */
export async function anexarMetricaIaJsonl(entrada: Record<string, unknown>): Promise<void> {
  try {
    if (typeof process === 'undefined' || !process.versions?.node) return
    const fs = await import(/* @vite-ignore */ 'node:fs/promises')
    const path = await import(/* @vite-ignore */ 'node:path')
    const cwd = typeof process.cwd === 'function' ? process.cwd() : '.'
    const dir = path.join(cwd, 'logs')
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(path.join(dir, 'metricas-ia.jsonl'), `${JSON.stringify(entrada)}\n`, 'utf-8')
  } catch {
    /* métrica em disco é best-effort; o store + audit_log já cobrem a trilha */
  }
}

export function DebugIA() {
  const status = useIa((s) => s.status)
  const modo = useIa((s) => s.modo)
  const mock = useIa((s) => s.mock)
  const erro = useIa((s) => s.erro)
  const candidatos = useIa((s) => s.candidatos)
  const ultima = useIa((s) => s.ultimaDecisao)
  const historico = useIa((s) => s.historico)
  const total = useIa((s) => s.totalConsultas)
  const viaIa = useIa((s) => s.consultasIa)
  const setConexao = useIa((s) => s.setConexao)
  const registrar = useIa((s) => s.registrarDecisao)
  const toast = useUi((s) => s.toast)

  const [descricao, setDescricao] = useState('frango vivo para abate')
  const [ocupado, setOcupado] = useState(false)
  // IA-06 — teste livre com o seu GGUF (conversa direta, sem gate fiscal).
  const [perguntaLivre, setPerguntaLivre] = useState('Oi, tudo bem?')
  const [thinkLivre, setThinkLivre] = useState(false)
  const [brutoLivre, setBrutoLivre] = useState(() => {
    try { return localStorage.getItem('aurum_ia_teste_livre') === '1' } catch { return false }
  })
  const [respLivre, setRespLivre] = useState<{ texto: string; motivo: string; ms: number; barrada: boolean } | null>(null)
  const [ocupadoLivre, setOcupadoLivre] = useState(false)
  // Aceitação IA = decisões `via: ia` no histórico sem feedback "Não é esse"
  // (Dexie `ia_feedback`, best-effort). Rejeitada = mesmo par descrição+decisão.
  const [rejeitadas, setRejeitadas] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const fbs = await db.table('ia_feedback').toArray().catch(() => [])
        if (!vivo) return
        const chaves = new Set(fbs.map((f) => `${f.descricao}‖${f.decisao}`))
        setRejeitadas(historico.filter((h) => h.via === 'ia' && chaves.has(`${h.descricao}‖${h.codigoEscolhido}`)).length)
      } catch {
        if (vivo) setRejeitadas(0)
      }
    })()
    return () => { vivo = false }
  }, [historico])

  const atualizarStatus = useCallback(async () => {
    if (!bridge?.ia) {
      setConexao({ status: 'desligado', modo: 'desligado', mock: true, erro: 'Canal IA indisponível neste ambiente' })
      return
    }
    try {
      const s: StatusIaBridge = await bridge.ia.status()
      setConexao({
        status: s.pronto ? 'pronto' : 'erro',
        modo: s.modo,
        mock: s.mock,
        erro: s.erro,
      })
    } catch (e) {
      setConexao({
        status: 'erro',
        modo: 'desligado',
        mock: true,
        erro: e instanceof Error ? e.message : String(e),
      })
    }
  }, [setConexao])

  useEffect(() => {
    setConexao({ status: 'carregando', modo, mock, erro })
    void atualizarStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classificar = useCallback(async () => {
    const texto = descricao.trim()
    if (!texto || ocupado) return
    setOcupado(true)
    try {
      const r = await classificarComIa({ descricao: texto })
      const decisao: DecisaoIa = {
        descricao: texto,
        via: r.via,
        codigoEscolhido: r.codigoEscolhido ?? 'NÃO SEI',
        confiancaIa: r.confiancaIa,
        motivo: r.motivo,
        mock: r.mock,
        candidatos: r.candidatos,
        ncmValidado: r.ncmValidado,
        regraGeral: r.regraGeral,
        ms: r.ms,
        em: new Date().toISOString(),
      }
      registrar(decisao)
      // Snapshot de observabilidade (06-09): totais + taxas por inferência.
      const tot = total + 1
      const ia = viaIa + (decisao.via === 'ia' ? 1 : 0)
      const hist = [decisao, ...historico].slice(0, 20)
      void anexarMetricaIaJsonl({
        quando: decisao.em,
        descricao: texto,
        via: decisao.via,
        decisao: decisao.codigoEscolhido,
        totalConsultas: tot,
        consultasIa: ia,
        taxa_uso_ia: taxaUsoIa(tot, ia),
        taxa_nao_sei: taxaNaoSei(hist),
        mock: decisao.mock,
        ms: decisao.ms,
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setOcupado(false)
    }
  }, [descricao, ocupado, registrar, toast, total, viaIa, historico])

  const taxa = taxaUsoIa(total, viaIa)
  const viaDet = total - viaIa
  const taxaNS = taxaNaoSei(historico)
  const aceitacao = viaIa > 0 ? Math.round(((viaIa - Math.min(rejeitadas, viaIa)) / viaIa) * 1000) / 10 : 100

  const conversarLivreTeste = useCallback(async () => {
    const p = perguntaLivre.trim()
    if (!p || ocupadoLivre) return
    if (!bridge?.ia?.conversar) {
      toast('Canal ia:conversar indisponível — rode via Electron (npm run dev), não no navegador.', 'err')
      return
    }
    setOcupadoLivre(true)
    setRespLivre(null)
    const t0 = Date.now()
    try {
      try { localStorage.setItem('aurum_ia_teste_livre', brutoLivre ? '1' : '0') } catch { /* ignora */ }
      const r = await bridge.ia.conversar(p, {
        sistema: montarSistemaLivre(),
        historico: [],
        think: thinkLivre,
        maxTokens: thinkLivre ? 448 : 280,
        temperature: 0.6,
      })
      if (!r.ok) {
        setRespLivre({ texto: `ERRO: ${r.erro ?? 'sem modelo'} — verifique o *.gguf em recursos-ia/modelo/ e o status acima.`, motivo: 'erro', ms: Date.now() - t0, barrada: true })
        return
      }
      const cru = String(r.texto ?? '')
      const limpo = sanitizarLivre(cru)
      setRespLivre({
        texto: brutoLivre ? cru.slice(0, 1200) : (limpo ?? `BARRADA pela sanitização (fail-closed). Texto cru tinha ${cru.length} chars — ative "mostrar bruto" para ver. Início: "${cru.slice(0, 180)}"`),
        motivo: String(r.motivo ?? ''),
        ms: Date.now() - t0,
        barrada: !limpo,
      })
    } catch (e) {
      setRespLivre({ texto: `ERRO: ${e instanceof Error ? e.message : String(e)}`, motivo: 'excecao', ms: Date.now() - t0, barrada: true })
    } finally {
      setOcupadoLivre(false)
    }
  }, [perguntaLivre, ocupadoLivre, brutoLivre, thinkLivre, toast])

  return (
    <div className="space-y-4">
      <Entrada>
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-black">Worker {NOME_IA} (tracer 06-05)</h2>
          <SeloAurumAI variante="compacto" />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            status: {status} · {modo === 'modelo' ? 'modelo embutido ativo' : modo === 'erro' ? 'IA indisponível' : `modo: ${modo}`}
          </span>
          {erro ? <span className="text-[11px] text-red-500">{erro}</span> : null}
          <button type="button" className="btn btn-press btn-ghost btn-sm ml-auto" onClick={() => void atualizarStatus()}>
            Atualizar status
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void classificar()
            }}
            placeholder="Descrição livre do produto (ex.: frango vivo para abate)"
            className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500"
            aria-label="Descrição para classificar via gate IA"
          />
          <button
            type="button"
            className="btn btn-press btn-sm bg-brand-600 font-bold text-white hover:bg-brand-500 disabled:opacity-50"
            disabled={ocupado || !descricao.trim()}
            onClick={() => void classificar()}
          >
            {ocupado ? 'Classificando…' : 'Classificar (gate)'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Gate {NOME_IA}: determinístico primeiro — se `ncm_provavel` + confiança alta, o worker nem é chamado
          (`via: deterministico`). {ROTULO_FALLBACK} com ficha absoluta. Taxa de uso {NOME_IA} parcial: <strong>{taxa}%</strong> ({viaIa}/{total}, meta &lt;30%).
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-xs sm:grid-cols-5">
          <div><dt className="font-bold text-slate-500">Total consultas</dt><dd className="font-mono font-bold">{total}</dd></div>
          <div><dt className="font-bold text-slate-500">Via determinístico</dt><dd className="font-mono">{viaDet}</dd></div>
          <div><dt className="font-bold text-slate-500">Via IA</dt><dd className="font-mono">{viaIa}</dd></div>
          <div><dt className="font-bold text-slate-500">Aceitação IA</dt><dd className="font-mono">{aceitacao}%</dd></div>
          <div><dt className="font-bold text-slate-500">Taxa NÃO SEI</dt><dd className="font-mono">{taxaNS}%</dd></div>
        </dl>
      </section>
      </Entrada>

      <Entrada>
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-black">Conversa livre — teste com seu modelo (IA-06)</h2>
          <SeloAurumAI variante="compacto" />
          {!bridge?.ia?.conversar ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">sem Electron: rode npm run dev</span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Chama direto o GGUF atual (`recursos-ia/modelo/*.gguf` — qualquer modelo; ver perfil no status), sem gate fiscal. Desmarque “mostrar bruto” para ver o que passaria na sanitização do chat.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={perguntaLivre}
            onChange={(e) => setPerguntaLivre(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void conversarLivreTeste() }}
            placeholder="Oi, tudo bem?"
            className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-brand-500"
            aria-label="Pergunta livre para o modelo local"
          />
          <button
            type="button"
            className="btn btn-press btn-sm bg-brand-600 font-bold text-white hover:bg-brand-500 disabled:opacity-50"
            disabled={ocupadoLivre || !perguntaLivre.trim()}
            onClick={() => void conversarLivreTeste()}
          >
            {ocupadoLivre ? 'Pensando…' : 'Conversar'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={thinkLivre} onChange={(e) => setThinkLivre(e.target.checked)} />
            reasoning (think)
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={brutoLivre} onChange={(e) => setBrutoLivre(e.target.checked)} />
            mostrar bruto (sem sanitização)
          </label>
        </div>
        {respLivre ? (
          <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-xs">
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span className="font-mono">{respLivre.motivo}</span>
              <span className="font-mono">{respLivre.ms} ms</span>
              {respLivre.barrada && !brutoLivre ? <span className="font-bold text-amber-600">barrada no chat, ok no bruto</span> : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{respLivre.texto}</p>
          </div>
        ) : null}
      </section>
      </Entrada>

      {ultima ? (
        <Secao>
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black">Última decisão · Sugerido por {NOME_IA}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${seloVia(ultima.via)}`}>
              via: {ultima.via}
            </span>
            <BarraConfiancaAurumAI valor={ultima.confiancaIa} compact />
            <span className="ml-auto text-[11px] text-slate-400">{ultima.ms} ms</span>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            <div><dt className="font-bold text-slate-500">Descrição</dt><dd>{ultima.descricao}</dd></div>
            <div><dt className="font-bold text-slate-500">Escolha</dt><dd className="font-mono">{ultima.codigoEscolhido}</dd></div>
            <div><dt className="font-bold text-slate-500">Confiança {NOME_IA}</dt><dd>{fmtConfiancaAurumAI(ultima.confiancaIa)} · {ultima.motivo}</dd></div>
            <div>
              <dt className="font-bold text-slate-500">Validação (resolver)</dt>
              <dd className="font-mono">{ultima.ncmValidado ?? 'NÃO SEI — sem código'}</dd>
            </div>
          </dl>
          {candidatos.length ? (
            <table className="mt-3 w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 pr-2">NCM</th>
                  <th className="py-1 pr-2">Descrição (RAG)</th>
                  <th className="py-1">Score</th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((c) => (
                  <tr key={c.codigo} className="border-t border-[var(--line)]">
                    <td className="py-1 pr-2 font-mono font-bold">{c.codigo}</td>
                    <td className="py-1 pr-2">{c.descricao || '—'}</td>
                    <td className="py-1 font-mono">{c.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Sem candidatos — caminho determinístico direto.</p>
          )}
        </section>
        </Secao>
      ) : null}

      {historico.length ? (
        <Secao>
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 shadow-card">
          <h2 className="text-sm font-black">Histórico (últimas {historico.length})</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {historico.map((h, i) => (
              <li key={`${h.em}-${i}`} className="flex flex-wrap gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${seloVia(h.via)}`}>{h.via}</span>
                <span className="truncate">{h.descricao}</span>
                <span className="ml-auto font-mono">{h.codigoEscolhido}</span>
              </li>
            ))}
          </ul>
        </section>
        </Secao>
      ) : null}
    </div>
  )
}
