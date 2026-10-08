/**
 * Tela **Consulta de CNAEs** (Phase 9 / 09-03 — UX busca única).
 *
 * Um único input filtra por número (`XXXX-X/XX`, 7 dígitos, prefixo) ou por
 * descrição, com sugestões ao digitar (dropdown elegante + teclado ↑↓/Enter/Esc).
 * Clicar numa sugestão — ou acertar o código exato + Enter — abre abaixo o card
 * de detalhes: nome, Anexo do Simples Nacional, situação, Fator R, NBS
 * vinculadas e precificação da Reforma no ano de referência.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ANOS_REFERENCIA_CNAE,
  useCnaes,
  type SugestaoCnae,
} from '@/store/consulta-cnaes'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import { toast, useUi } from '@/store/ui'
import { Btn, Painel, Texto, Vazio, useDebounce } from '@/ui/kit'
import { Entrada, Revelar } from '@/ui/motion'
import {
  BlocoRegrasCnae,
  BlocoUnicoNbs,
  SeloAnoReferencia,
} from '@/ui/cnaes'
import { corSituacaoCnae } from '@/domain/services/cnae'

/** Destaca o trecho que casou com o termo (sem quebrar acentos). */
function Destacado({ texto, termo }: { texto: string; termo: string }) {
  const t = (texto ?? '').trim()
  const q = (termo ?? '').trim()
  if (!t || !q) return <>{t || '—'}</>
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const tn = norm(t)
  const qn = norm(q.length > 24 ? q.slice(0, 24) : q)
  // Tenta primeiro o termo inteiro; senão, o primeiro token com 2+ letras.
  const candidatos = [qn, ...qn.split(/\s+/).filter((w) => w.length >= 2)]
  for (const c of candidatos) {
    if (!c) continue
    const idx = tn.indexOf(c)
    if (idx < 0) continue
    const antes = t.slice(0, idx)
    const meio = t.slice(idx, idx + c.length)
    const depois = t.slice(idx + c.length)
    return (
      <>
        {antes}
        <mark className="rounded bg-brand-100 px-0.5 font-bold text-brand-800 dark:bg-brand-900/50 dark:text-brand-100">
          {meio}
        </mark>
        {depois}
      </>
    )
  }
  return <>{t}</>
}

/** Pílula de situação com a cor do domínio. */
function PinoSituacao({ situacao }: { situacao: string }) {
  const cor = corSituacaoCnae(situacao as 'Permitido' | 'Permitido com ressalvas' | 'Depende da atividade')
  const classe =
    cor === 'emerald'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
      : cor === 'amber'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
        : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`pill ${classe}`} title={`Situação: ${situacao}`}>
      {situacao}
    </span>
  )
}

export function ConsultaCnaes() {
  const lista = useCnaes((s) => s.lista)
  const carregandoLista = useCnaes((s) => s.carregandoLista)
  const carregarLista = useCnaes((s) => s.carregarLista)
  const sugestoes = useCnaes((s) => s.sugestoes)
  const sugerirCnae = useCnaes((s) => s.sugerirCnae)
  const consulta = useCnaes((s) => s.consulta)
  const consultando = useCnaes((s) => s.consultando)
  const erroConsulta = useCnaes((s) => s.erroConsulta)
  const consultarCnae = useCnaes((s) => s.consultarCnae)
  const anoReferencia = useCnaes((s) => s.anoReferencia)
  const setAnoReferencia = useCnaes((s) => s.setAnoReferencia)
  const nbsEscolhida = useCnaes((s) => s.nbsEscolhida)
  const setNbsEscolhida = useCnaes((s) => s.setNbsEscolhida)
  const trocarView = useUi((s) => s.trocarView)

  const [texto, setTexto] = useState('')
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const [foco, setFoco] = useState(false)
  const caixaRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const focarInput = () =>
    caixaRef.current?.querySelector<HTMLInputElement>('#busca-cnae-unica')?.focus()

  const porCodigo = useMemo(() => new Map(lista.map((l) => [l.cnae7, l] as const)), [lista])

  useEffect(() => {
    void carregarLista()
  }, [carregarLista])

  // Menu nativo (Ctrl+E): exporta o resumo da consulta ativa em JSON.
  useEffect(
    () =>
      registrarExportador('cnaes', () => {
        const c = useCnaes.getState().consulta
        if (!c) {
          toast('Consulte um CNAE antes de exportar.', 'warn')
          return
        }
        try {
          const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `consulta-cnae-${c.regra.cnae7}-ref${c.anoReferencia}.json`
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
          toast('Consulta de CNAE exportada.', 'ok')
        } catch {
          toast('Falha ao exportar a consulta.', 'err')
        }
      }),
    [],
  )

  // Fecha o dropdown ao clicar fora, ao rolar o conteúdo ou ao redimensionar.
  // Sem isso o dropdown ficava aberto flutuando sobre os cards enquanto o
  // usuário rolava a resposta (bug "sugestão persistente sobreposta").
  useEffect(() => {
    if (!aberto) return
    const aoClicar = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false)
    }
    const aoRolar = (e: Event) => {
      if (caixaRef.current?.contains(e.target as Node)) return
      setAberto(false)
    }
    document.addEventListener('mousedown', aoClicar)
    document.getElementById('conteudo')?.addEventListener('scroll', aoRolar, { passive: true })
    window.addEventListener('scroll', aoRolar, true)
    window.addEventListener('resize', aoRolar)
    return () => {
      document.removeEventListener('mousedown', aoClicar)
      document.getElementById('conteudo')?.removeEventListener('scroll', aoRolar)
      window.removeEventListener('scroll', aoRolar, true)
      window.removeEventListener('resize', aoRolar)
    }
  }, [aberto])

  const pedirSugestoes = useDebounce((t: string) => {
    void sugerirCnae(t)
  }, 120)

  const escolher = (s: SugestaoCnae) => {
    setTexto(`${s.codigoFormatado} — ${s.descricao}`)
    setAberto(false)
    setFoco(false)
    caixaRef.current?.querySelector<HTMLInputElement>('#busca-cnae-unica')?.blur()
    void consultarCnae(s.cnae7).then(() => {
      window.requestAnimationFrame(() =>
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      )
    })
  }

  /** Enter: match exato (7 dígitos / código formatado) vence; senão, sugestão ativa. */
  const submeter = () => {
    const t = texto.trim()
    if (!t) return
    const digitos = t.replace(/\D+/g, '')
    const exato = (digitos.length === 7 && porCodigo.get(digitos)) || null
    if (exato) {
      escolher({ cnae7: exato.cnae7, codigoFormatado: exato.codigoFormatado, descricao: exato.descricao })
      return
    }
    const listaAtual = useCnaes.getState().sugestoes
    const alvo = listaAtual[Math.min(Math.max(0, ativo), Math.max(0, listaAtual.length - 1))] ?? listaAtual[0]
    if (alvo) {
      escolher(alvo)
      return
    }
    toast(`Nenhum CNAE para "${t.length > 40 ? `${t.slice(0, 40)}…` : t}". Ajuste o número ou a descrição.`, 'warn')
  }

  const limpar = () => {
    setTexto('')
    setAberto(false)
    setAtivo(0)
    useCnaes.getState().limpar()
    focarInput()
  }

  const aoTecla = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && sugestoes.length) {
      e.preventDefault()
      setAberto(true)
      setAtivo((a) => (a + 1) % sugestoes.length)
    } else if (e.key === 'ArrowUp' && sugestoes.length) {
      e.preventDefault()
      setAberto(true)
      setAtivo((a) => (a - 1 + sugestoes.length) % sugestoes.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submeter()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (aberto) setAberto(false)
      else limpar()
    }
  }

  const mostrarDropdown = (aberto || foco) && texto.trim().length > 0
  const estadoNbs = consulta?.estadoNbs ?? null

  const detalhe: ReactNode = (() => {
    if (consultando) {
      return (
        <div className="animate-pulse space-y-2" aria-label="Consultando CNAE">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      )
    }
    if (erroConsulta) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-bold">Falha ao consultar o CNAE</div>
          <p className="mt-1">{erroConsulta}</p>
        </div>
      )
    }
    if (!consulta) {
      return (
        <Vazio
          icone="🏭"
          titulo="Busque por número ou descrição"
          texto={`Ex.: 6201-5/01 ou "desenvolvimento de programas" · ${lista.length.toLocaleString('pt-BR')} CNAEs na base. Comece a digitar e escolha uma sugestão — o card completo abre aqui.`}
        />
      )
    }
    if (consulta.regra.estado !== 'ok') {
      return (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-center text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          <strong>CNAE não encontrado.</strong> {consulta.regra.mensagem} Classifique no modo manual com o contador.
        </div>
      )
    }
    const regra = consulta.regra
    const linha = porCodigo.get(regra.cnae7)
    return (
      <div className="space-y-4">
        {/* Herói: nome + código + Anexo do Simples em destaque */}
        <div className="overflow-hidden rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50 via-white to-cyan-50/60 dark:border-aurum-900 dark:from-brand-950/40 dark:via-slate-950 dark:to-cyan-950/30">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
                  {regra.codigoFormatado}
                </span>
                <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
                {consulta.estadoNbs === 'mapeado' ? (
                  <span
                    className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                    title="NBS vinculadas via caminho do grafo CNAE→NBS→CCT (multi-hop auditável). O resolvedor validou cada NBS."
                    role="status"
                  >
                    via:grafo · {consulta.vereditos.length.toLocaleString('pt-BR')} NBS
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
                {regra.descricao}
              </p>
              <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">{consulta.resumo}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span
                  className="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-black text-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-200"
                  title="Anexo do Simples Nacional (LC 123/2006) — elegibilidade + Fator R"
                >
                  📑 {regra.rotuloAnexo}
                </span>
                <PinoSituacao situacao={regra.situacao} />
                {regra.fatorR ? (
                  <span
                    className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-black text-violet-900 dark:bg-violet-950/60 dark:text-violet-200"
                    title="Fator R: Anexo III ou V conforme a folha ≥ 28% do faturamento (12 meses)"
                  >
                    Fator R
                  </span>
                ) : null}
                {linha?.ehBens ? (
                  <span className="pill bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300" title="Atividade de bens — NBS não se aplica">bens → NCM</span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1" role="group" aria-label="Ano de referência">
                {ANOS_REFERENCIA_CNAE.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={anoReferencia === a}
                    title={a === 2033 ? 'Regime pleno' : a === 2027 ? 'CBS plena + IBS em teste' : 'Ano-teste LC 214'}
                    className={`rounded-lg px-2 py-1 font-mono text-xs font-black transition ${
                      anoReferencia === a
                        ? 'bg-brand-600 text-white shadow-pop'
                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                    onClick={() => void setAnoReferencia(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={limpar}
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                ✕ limpar
              </button>
            </div>
          </div>
        </div>

        <BlocoRegrasCnae consulta={consulta} />

        {estadoNbs === 'bens→NCM' ? (
          <div
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
            role="status"
          >
            <span className="text-lg">📦</span>
            <p className="min-w-[200px] flex-1">
              <strong>Sem NBS aplicável — atividade de bens (ver NCM).</strong> NBS cobre só serviços;
              classifique o produto na Consulta NCM.{' '}
              <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
            </p>
            <Btn variante="primary" tam="sm" onClick={() => trocarView('consulta')}>
              Ir à Consulta NCM
            </Btn>
          </div>
        ) : null}
        {estadoNbs === 'sem-mapeamento-NBS' ? (
          <div
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            <strong>Sem mapeamento NBS</strong> para este CNAE na base atual — a regra do Simples acima vale
            integralmente; o enriquecimento Reforma segue o fallback.{' '}
            <SeloAnoReferencia ano={consulta.anoReferencia} emTransicao={consulta.emTransicao} />
          </div>
        ) : null}
        {estadoNbs === 'mapeado' && consulta ? (
          <BlocoUnicoNbs
            consulta={consulta}
            ativa={nbsEscolhida ?? consulta.maisProvavel}
            onEscolher={(nbs) => setNbsEscolhida(nbs)}
          />
        ) : null}
      </div>
    )
  })()

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Busca acima dos detalhes: o dropdown absoluto precisa vencer a
          seção seguinte no empilhamento (ambas usam motion/transform).
          FIX: isolate + z-50 (antes z-30 empatava com header e misturava). */}
      <Entrada className="relative isolate z-50">
        <Painel>
          <div className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <span className="text-lg">🏭</span> Consulta de CNAEs
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {lista.length.toLocaleString('pt-BR')} CNAEs · digite o número ou a descrição — o card completo
              (Anexo do Simples + NBS + Reforma) abre aqui embaixo
            </p>

            {/* Input único */}
            <div ref={caixaRef} className="relative mt-4">
              <div className="field-wrap">
                <span className="field-icon" aria-hidden="true">🔍</span>
                <Texto
                  grande
                  id="busca-cnae-unica"
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-expanded={mostrarDropdown && sugestoes.length > 0}
                  aria-controls="sugestoes-cnae"
                  aria-activedescendant={sugestoes.length ? `cnae-opt-${ativo}` : undefined}
                  placeholder="6201-5/01 · 0161 · pulverização · desenvolvimento de programas…"
                  value={texto}
                  onChange={(e) => {
                    const v = e.target.value
                    setTexto(v)
                    setAtivo(0)
                    setAberto(true)
                    pedirSugestoes(v)
                  }}
                  onFocus={() => {
                    setFoco(true)
                    if (texto.trim()) {
                      setAberto(true)
                      void sugerirCnae(texto)
                    }
                  }}
                  onBlur={() => setFoco(false)}
                  onKeyDown={aoTecla}
                  aria-label="Buscar CNAE por número ou descrição. Setas navegam, Enter seleciona, Esc limpa."
                  className="pr-20"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                  {carregandoLista || consultando ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-label="Carregando" />
                  ) : texto ? (
                    <button
                      type="button"
                      onClick={limpar}
                      aria-label="Limpar busca"
                      className="pointer-events-auto grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    >
                      ✕
                    </button>
                  ) : null}
                </span>
              </div>

              {/* Dropdown de sugestões — FIX: z-50 opaco, nunca atrás do card */}
              {mostrarDropdown && sugestoes.length > 0 ? (
                <div
                  id="sugestoes-cnae"
                  role="listbox"
                  aria-label="Sugestões de CNAE"
                  className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900"
                >
                  <ul className="scroll-elegante max-h-80 overflow-y-auto p-1.5">
                    {sugestoes.map((s, i) => {
                      const linha = porCodigo.get(s.cnae7)
                      return (
                        <li key={s.cnae7}>
                          <button
                            id={`cnae-opt-${i}`}
                            type="button"
                            role="option"
                            aria-selected={i === ativo}
                            onMouseEnter={() => setAtivo(i)}
                            onClick={() => escolher(s)}
                            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                              i === ativo
                                ? 'bg-brand-600 text-white shadow-pop'
                                : 'hover:bg-brand-50 dark:hover:bg-slate-800'
                            }`}
                            title={`${s.codigoFormatado} — ${s.descricao}`}
                          >
                            <span className={`shrink-0 font-mono text-sm font-black ${i === ativo ? 'text-white' : 'text-brand-700 dark:text-aurum-200'}`}>
                              {s.codigoFormatado}
                            </span>
                            <span className={`min-w-0 flex-1 text-[13px] leading-snug line-clamp-2 ${i === ativo ? 'text-white/95' : 'text-slate-600 dark:text-slate-300'}`}>
                              <Destacado texto={s.descricao} termo={texto} />
                            </span>
                            {linha ? (
                              <span className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black sm:inline ${i === ativo ? 'bg-white/20 text-white' : 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200'}`}>
                                {linha.anexoSimples.length ? `Anexo ${linha.anexoSimples.join('/')}` : 's/anexo'}
                              </span>
                            ) : null}
                            {linha && linha.totalNbs > 0 ? (
                              <span className={`shrink-0 font-mono text-[10px] ${i === ativo ? 'text-white/80' : 'text-slate-400'}`}>
                                {linha.totalNbs} NBS
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400 dark:border-slate-800">
                    ↑↓ navegar · Enter abrir detalhes · Esc fechar · {sugestoes.length} sugestão(ões)
                  </p>
                </div>
              ) : null}
              {mostrarDropdown && !sugestoes.length && texto.trim().length >= 2 && !carregandoLista ? (
                <div className="absolute inset-x-0 top-full z-50 mt-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-pop dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Nenhum CNAE para “{texto.trim().slice(0, 40)}” — tente o número (ex.: 6201-5/01) ou outra palavra da atividade.
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn variante="primary" tam="sm" carregando={consultando} onClick={submeter} disabled={!texto.trim()}>
                Abrir detalhes
              </Btn>
              <Btn tam="sm" onClick={limpar} disabled={!texto && !consulta}>
                Limpar
              </Btn>
              <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-slate-400 sm:flex" aria-hidden="true">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono dark:border-slate-700 dark:bg-slate-800">Enter</kbd>
                abre o match exato ou a 1ª sugestão
              </span>
            </div>
          </div>
        </Painel>
      </Entrada>

      <Revelar className="relative isolate z-0">
        <div ref={cardRef} className="scroll-mt-24">
          <Painel className="p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-lg" aria-hidden="true">📋</span>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Detalhes do CNAE
              </h3>
            </div>
            {detalhe}
          </Painel>
        </div>
      </Revelar>
    </div>
  )
}
