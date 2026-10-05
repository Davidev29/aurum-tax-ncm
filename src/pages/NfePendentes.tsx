/**
 * Banner **Contribuinte novo** — XML de CNPJ ainda sem cadastro.
 *
 * As notas ficam estacionadas como órfãs (invisíveis à empresa ativa) até o
 * cadastro. Um clique cadastra via BrasilAPI (fallback com o nome do XML) e
 * adota as notas automaticamente, recalculando o motor (saldo/débito).
 */
import { useState } from 'react'
import { fmtCnpj } from '@/domain/services/format'
import { useNfe } from '@/store/nfe'
import { Btn, Painel } from '@/ui/kit'

const ROTULO_PAPEL: Record<string, string> = {
  emitente: 'emitente',
  destinatario: 'destinatário',
  ambos: 'emitente + destinatário',
}

export function BannerContribuintesNovos() {
  const pendentes = useNfe((s) => s.pendentes)
  const cadastrar = useNfe((s) => s.cadastrarPendente)
  const cadastrando = useNfe((s) => s.cadastrandoCnpj)
  const resumo = useNfe((s) => s.ultimoResumo)
  const [aberto, setAberto] = useState(true)

  if (!pendentes.length) return null
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
        title={`${pendentes.length} contribuinte(s) sem cadastro`}
      >
        ⚠ {pendentes.length} contribuinte(s) sem cadastro — mostrar
      </button>
    )
  }

  const redir = resumo?.redirecionadas ?? 0
  const orfas = resumo?.orfas ?? 0

  return (
    <Painel className="overflow-hidden border-amber-200 bg-amber-50/70 p-0 dark:border-amber-900 dark:bg-amber-950/25">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-lg dark:bg-amber-900/60">
          🏢
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-black tracking-tight">
            Contribuinte novo detectado — cadastre para adotar as notas
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {pendentes.length} CNPJ(s) sem cadastro
            {orfas > 0 ? ` · ${orfas} nota(s) estacionada(s)` : ''}
            {redir > 0 ? ` · ${redir} nota(s) foram ao cadastro correto` : ''} — a empresa
            ativa <strong>não enxerga</strong> notas que não são do perfil dela.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          title="Recolher"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2 border-t border-amber-200/70 px-4 py-3 dark:border-amber-900/60">
        {pendentes.slice(0, 5).map((p) => {
          const busy = cadastrando === p.cnpj
          return (
            <div
              key={p.cnpj}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/70 bg-white/80 px-3 py-2 dark:border-amber-900/50 dark:bg-slate-900/60"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold" title={p.nome}>
                  {p.nome}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  {fmtCnpj(p.cnpj)} · {p.qtd} nota(s) · {ROTULO_PAPEL[p.papel] ?? p.papel}
                </div>
              </div>
              <Btn
                tam="sm"
                variante="primary"
                carregando={busy}
                disabled={cadastrando !== null && !busy}
                onClick={() => void cadastrar(p.cnpj)}
                title="Busca na BrasilAPI e adota as notas automaticamente"
              >
                {busy ? 'Cadastrando…' : '✓ Cadastrar via BrasilAPI'}
              </Btn>
            </div>
          )
        })}
        {pendentes.length > 5 ? (
          <p className="text-[11px] text-slate-400">+ {pendentes.length - 5} contribuinte(s) na fila.</p>
        ) : null}
        <p className="text-[10px] leading-relaxed text-slate-400">
          Sem internet? O cadastro usa o nome do XML e adota as notas do mesmo jeito.
        </p>
      </div>
    </Painel>
  )
}
