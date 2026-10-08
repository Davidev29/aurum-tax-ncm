/**
 * Tela **Calculadora Tributária** (SPEC §7).
 *
 * Duas colunas: à esquerda a busca de produtos salvos + a lista de itens com
 * quantidade/valor editáveis; à direita o resumo do cálculo, as alíquotas de
 * referência e a dica de uso.
 *
 * Regras preservadas da v1:
 * - reduções **congeladas na adição** do item (SPEC D10);
 * - alíquotas de referência daqui são as mesmas usadas pelo simulador rápido
 *   dos cartões — os relatórios, não (correção do `[BUG] L973`);
 * - "Salvar no produto" atualiza só qtd/val dos itens com produto e **cadastra
 *   os manuais** (R7.9–R7.13).
 */
import { useEffect, useRef, useState } from 'react'
import { REF_DEFAULT, REF_FONTE, SUGGEST_LIMITS } from '@/domain/constants'
import type { NomenclaturaNcm } from '@/domain/entities'
import {
  fmtCarga,
  fmtMoeda,
  fmtNcm,
  fmtNum,
  fmtPct,
  formatarMoedaInput,
  norm,
  parseMoeda,
  parseQtd,
} from '@/domain/services/format'
import { sugerirNomenclatura } from '@/infrastructure/base/classificacao-repo'
import { ModalCalcCustom } from '@/modais/pagina'
import {
  baseDoItem,
  calculoDoItem,
  resumoDaCalculadora,
  useCalculadora,
  type ItemCalc,
} from '@/store/calculadora'
import { useProdutos, type ProdutoLinha } from '@/store/produtos'
import { confirmar } from '@/store/dialogo'
import { toast } from '@/store/ui'
import { Btn, IconeBadge, Painel, Texto, useAcaoTatil } from '@/ui/kit'
import { Entrada, Secao } from '@/ui/motion'

/* ------------------------------------------------------------- alíquotas --- */

/**
 * Campo de alíquota com texto local: o valor digitado só vira número no store
 * quando é parseável (`"17."` não vira `17` no meio da digitação).
 */
function CampoTaxa({ tributo }: { tributo: 'IBS' | 'CBS' }) {
  const valor = useCalculadora((s) => (tributo === 'IBS' ? s.rateIBS : s.rateCBS))
  const setRate = useCalculadora((s) => s.setRate)
  const [texto, setTexto] = useState(() => String(valor))

  useEffect(() => {
    setTexto((atual) => (numero(atual) === valor ? atual : String(valor)))
  }, [valor])

  const numero = (t: string): number => Number(t.replace(',', '.')) || 0
  const aplicar = (t: string) => {
    setTexto(t)
    setRate(tributo, numero(t))
  }

  return (
    <div className="calc-kpi">
      <span className="field-label">{tributo} (%)</span>
      <div className="flex items-baseline gap-0.5">
        <Texto
          type="number"
          step="0.01"
          min={0}
          max={100}
          mono
          className="num-input min-w-0 flex-1 border-0 bg-transparent p-0 text-2xl font-black focus:shadow-none"
          value={texto}
          aria-label={`Alíquota de referência ${tributo} em porcento`}
          onChange={(e) => aplicar(e.target.value.replace(/[^\d.,]/g, ''))}
        />
        <span aria-hidden="true" className="shrink-0 font-mono text-sm font-bold text-slate-400">%</span>
      </div>
      <input
        type="range"
        min={0}
        max={30}
        step={0.05}
        value={Math.min(30, numero(texto))}
        onChange={(e) => aplicar(e.target.value)}
        className="calc-range mt-1"
        aria-label={`Ajuste fino ${tributo}`}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- itens --- */

function ItemLinha({ item, indice }: { item: ItemCalc; indice: number }) {
  const rateIBS = useCalculadora((s) => s.rateIBS)
  const rateCBS = useCalculadora((s) => s.rateCBS)
  const editar = useCalculadora((s) => s.editar)
  const remover = useCalculadora((s) => s.remover)

  const [qtd, setQtd] = useState(() => fmtNum(item.quantidade))
  const [valor, setValor] = useState(() =>
    item.valorUnitario ? formatarMoedaInput(item.valorUnitario) : '',
  )

  // Só ressincroniza quando o store mudou por fora (ex.: "Salvar no produto").
  useEffect(() => {
    setQtd((atual) => (parseQtd(atual) === item.quantidade ? atual : fmtNum(item.quantidade)))
  }, [item.quantidade])
  useEffect(() => {
    setValor((atual) =>
      parseMoeda(atual) === item.valorUnitario
        ? atual
        : item.valorUnitario
          ? formatarMoedaInput(item.valorUnitario)
          : '',
    )
  }, [item.valorUnitario])

  // Debounce de 350 ms dos campos de item (v1: só grava depois da pausa).
  const timerAplicar = useRef<number>(0)
  const aplicar = (campo: 'quantidade' | 'valorUnitario', texto: string) => {
    window.clearTimeout(timerAplicar.current)
    timerAplicar.current = window.setTimeout(() => editar(item.uid, campo, texto), 350)
  }
  useEffect(() => () => window.clearTimeout(timerAplicar.current), [])

  const c = calculoDoItem(item, rateIBS, rateCBS)
  const base = baseDoItem(item)
  const aliqZerada = c.aliqIBS < 0.005 && c.aliqCBS < 0.005
  const temReducao = (Number(item.redIBS) || 0) > 0 || (Number(item.redCBS) || 0) > 0
  const tom = item.regraGeral ? 'calc-item--geral' : aliqZerada ? 'calc-item--zero' : 'calc-item--cheia'
  const totalTributos = c.total
  const pctIBS = totalTributos > 0 ? (c.vIBS / totalTributos) * 100 : 50

  return (
    <div className={`panel calc-item ${tom} p-4 pl-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-700 font-mono text-[10px] font-black text-white dark:bg-aurum-500 dark:text-brand-950">
              {indice + 1}
            </span>
            <span className="font-mono text-sm font-black tracking-tight text-brand-700 dark:text-aurum-200">
              {fmtNcm(item.ncm) || item.ncm}
            </span>
            {item.regraGeral ? (
              <span className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                regra geral · cheia
              </span>
            ) : aliqZerada ? (
              <span className="pill bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                Alíquota zero
              </span>
            ) : (
              <span
                className="pill bg-brand-100 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200"
                title={temReducao ? 'Redução de alíquota IBS / CBS aplicada sobre a referência' : 'Sem redução — alíquota cheia de referência'}
              >
                {temReducao ? `Redução: −${fmtPct(item.redIBS)} / −${fmtPct(item.redCBS)}` : 'Redução: —'}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-sm font-bold">{item.nome || '(sem nome)'}</div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            CST {item.cst} · {item.cClassTrib}
          </div>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
          title="Remover item"
          aria-label={`Remover ${item.nome || `item ${indice + 1}`}`}
          onClick={() => remover(item.uid)}
        >
          ✕
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <label className="block rounded-xl border border-[var(--line)] bg-slate-50/70 px-3 py-2 dark:bg-slate-950/40">
          <span className="field-label !mb-1">Qtd</span>
          <Texto
            mono
            mask="qtd"
            className="border-0 bg-transparent p-0 font-bold num-input"
            inputMode="decimal"
            value={qtd}
            aria-label="Quantidade do item"
            onChange={(e) => {
              setQtd(e.target.value)
              aplicar('quantidade', e.target.value)
            }}
          />
        </label>
        <label className="block rounded-xl border border-[var(--line)] bg-slate-50/70 px-3 py-2 dark:bg-slate-950/40">
          <span className="field-label !mb-1">Valor unit. R$</span>
          <Texto
            mono
            mask="moeda"
            className="border-0 bg-transparent p-0 font-bold num-input"
            inputMode="decimal"
            value={valor}
            aria-label="Valor unitário do item"
            onChange={(e) => {
              setValor(e.target.value)
              aplicar('valorUnitario', e.target.value)
            }}
          />
        </label>
      </div>

      <div className="mt-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950/40">
        <div className="calc-bar" aria-hidden="true">
          <span className="calc-bar-ibs" style={{ width: `${pctIBS}%` }} />
          <span className="calc-bar-cbs" style={{ width: `${100 - pctIBS}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            Base <strong className="font-mono text-slate-700 dark:text-slate-200">{fmtMoeda(base)}</strong>
            {temReducao ? (
              <span className="ml-2 font-mono" title="Alíquota efetiva já com redução; BC = valor cheio">
                IBS {fmtCarga(c.aliqIBS)} · CBS {fmtCarga(c.aliqCBS)}
              </span>
            ) : null}
          </span>
          <span className="font-mono text-base font-black text-emerald-700 dark:text-emerald-400">
            {fmtMoeda(c.total)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
          <span className="inline-flex flex-wrap gap-x-2">
            <span>Valor do IBS: {fmtMoeda(c.vIBS)}</span>
            <span>Valor da CBS: {fmtMoeda(c.vCBS)}</span>
          </span>
          <span>carga {fmtCarga(c.carga)}</span>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- busca ----- */

/** Busca combinada: produtos salvos + NCM direto (SPEC R7.6). */
function BuscaCalculadora({
  onProduto,
  onNcm,
}: {
  onProduto: (p: ProdutoLinha) => void
  onNcm: (codigo: string) => void
}) {
  const produtos = useProdutos((s) => s.cache)
  const [texto, setTexto] = useState('')
  const [focado, setFocado] = useState(false)
  const [prodSug, setProdSug] = useState<ProdutoLinha[]>([])
  const [nomSug, setNomSug] = useState<NomenclaturaNcm[]>([])

  useEffect(() => {
    if (!focado || !texto.trim()) {
      setProdSug([])
      setNomSug([])
      return
    }
    const t = window.setTimeout(() => void executar(texto), 180)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, focado, produtos])

  async function executar(q: string) {
    const alvo = q.trim().toLowerCase()
    const encontrados = produtos
      .filter((p) => `${p.codigo} ${p.nome} ${p.ncm}`.toLowerCase().includes(alvo))
      .slice(0, SUGGEST_LIMITS.calcProdutos)
    const digits = norm(q)
    const nomenclaturas =
      digits.length >= 2 ? await sugerirNomenclatura(digits, SUGGEST_LIMITS.calcNcm) : []
    setProdSug(encontrados)
    setNomSug(nomenclaturas)
  }

  const aberto = focado && texto.trim().length > 0
  const vazio = aberto && !prodSug.length && !nomSug.length
  const caixaRef = useRef<HTMLDivElement>(null)

  // Fecha ao rolar o conteúdo/redimensionar: sem isso o dropdown ficava aberto
  // flutuando sobre os itens da calculadora (mesmo bug das Consultas).
  useEffect(() => {
    if (!aberto) return
    const aoRolar = (e: Event) => {
      if (caixaRef.current?.contains(e.target as Node)) return
      setFocado(false)
    }
    document.getElementById('conteudo')?.addEventListener('scroll', aoRolar, { passive: true })
    window.addEventListener('scroll', aoRolar, true)
    window.addEventListener('resize', aoRolar)
    return () => {
      document.getElementById('conteudo')?.removeEventListener('scroll', aoRolar)
      window.removeEventListener('scroll', aoRolar, true)
      window.removeEventListener('resize', aoRolar)
    }
  }, [aberto])

  return (
    <div ref={caixaRef} className={`relative isolate ${aberto ? 'z-40' : ''}`}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="field-wrap flex-1">
          <span className="field-icon">🔍</span>
          <Texto
            type="search"
            autoComplete="off"
            placeholder="Buscar produto salvo (SKU, nome, NCM)…"
            className="field-lg"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onFocus={() => setFocado(true)}
            onBlur={() => window.setTimeout(() => setFocado(false), 150)}
          />
        </div>
        <Btn
          className="shrink-0"
          onClick={() => onNcm('')}
          title="Classificar um NCM manualmente"
        >
          ➕ NCM manual
        </Btn>
      </div>

      {vazio ? (
        <div className="sugg">
          <div className="px-3 py-3 text-xs text-slate-500">
            Nenhum produto ou NCM encontrado.
          </div>
        </div>
      ) : aberto ? (
        <div className="sugg">
          {prodSug.length ? (
            <>
              <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-950/60">
                Produtos salvos
              </div>
              {prodSug.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="sugg-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onProduto(p)
                    setTexto('')
                  }}
                >
                  <span className="pill mt-0.5 shrink-0 bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                    📦
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">
                        {p.codigo}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="font-mono text-[10px] text-slate-500">{fmtNcm(p.ncm)}</span>
                    </span>
                    <span className="block truncate text-slate-700 dark:text-slate-300">
                      {p.nome}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      CST {p.cstReforma} ·{' '}
                      {(Number(p.redIBS) || 0) > 0 || (Number(p.redCBS) || 0) > 0
                        ? `Redução: ${fmtPct(p.redIBS)} / ${fmtPct(p.redCBS)}`
                        : 'Redução: sem redução'}
                    </span>
                  </span>
                </button>
              ))}
            </>
          ) : null}
          {nomSug.length ? (
            <>
              <div className="border-b border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-950/60">
                NCM direto
              </div>
              {nomSug.map((n) => (
                <button
                  key={n.codigo}
                  type="button"
                  className="sugg-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onNcm(n.codigo)
                    setTexto('')
                  }}
                >
                  <span className="pill mt-0.5 shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    🔍
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono font-bold text-brand-700 dark:text-aurum-200">
                      {n.codigoOriginal}
                    </span>
                    <span className="block truncate text-slate-600 dark:text-slate-300">
                      {n.descricao || ''}
                    </span>
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- página --- */

export function Calculadora() {
  const itens = useCalculadora((s) => s.itens)
  const rateIBS = useCalculadora((s) => s.rateIBS)
  const rateCBS = useCalculadora((s) => s.rateCBS)
  const adicionarProduto = useCalculadora((s) => s.adicionarProduto)
  const limpar = useCalculadora((s) => s.limpar)
  const salvarNoProdutos = useCalculadora((s) => s.salvarNoProdutos)
  const revalidarItens = useCalculadora((s) => s.revalidarItens)
  const [revalidando, setRevalidando] = useState(false)
  // Giro no botão de ação (grava os itens no cadastro de produtos).
  const acaoSalvar = useAcaoTatil(salvarNoProdutos)

  const [modalAberto, setModalAberto] = useState(false)
  const [ncmInicial, setNcmInicial] = useState('')

  const r = resumoDaCalculadora(itens, rateIBS, rateCBS)
  const pctCarga = fmtCarga(r.carga)
  const temReducao = itens.some((it) => (Number(it.redIBS) || 0) > 0 || (Number(it.redCBS) || 0) > 0)
  // A coluna de resumo (hero + alíquotas) só existe após o primeiro
  // "Adicionar à calculadora" — antes disso a grade tem 1 coluna.
  const temItens = itens.length > 0

  const abrirCustom = (codigo: string) => {
    setNcmInicial(codigo)
    setModalAberto(true)
  }

  const confirmarLimpar = () => {
    if (!itens.length) return
    void (async () => {
      const ok = await confirmar(
        'Limpar calculadora?',
        'Limpar todos os itens da calculadora?',
        { icone: '🗑', confirmar: 'Limpar', perigo: true },
      )
      if (!ok) return
      limpar()
      toast('Calculadora limpa.', 'warn')
    })()
  }

  // Atalho do menu nativo (Electron) — abre o modal de item manual.
  useEffect(() => {
    const abrir = () => abrirCustom('')
    window.addEventListener('aurum:item-manual', abrir)
    return () => window.removeEventListener('aurum:item-manual', abrir)
  }, [])

  return (
    <div className={`grid grid-cols-1 gap-6 transition-all duration-500 ease-out ${temItens ? 'lg:grid-cols-[minmax(0,1fr)_390px]' : ''}`}>
      <div className="min-w-0 space-y-6">
        <Entrada>
        {/* FIX sobreposição: Painel da busca nunca pode ter overflow-hidden —
            cortava o dropdown .sugg na borda inferior. Arredondamento fica
            nos blocos internos (header/steps), não no container da busca. */}
        <Painel className="overflow-visible">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-5">
            <IconeBadge nome="calculadora" tom="brand" tamanho="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-black tracking-tight">
                Calculadora Tributária
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Simule IBS/CBS com reduções congeladas por item · LC 214/2025
              </p>
            </div>
            <span className="pill bg-brand-100 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">
              LC 214/2025
            </span>
          </div>
          <div className="flex flex-wrap gap-4 border-b border-[var(--line)] bg-slate-50/60 px-5 py-3 dark:bg-slate-950/40">
            {['Buscar', 'Ajustar', 'Conferir'].map((passo, i) => (
              <span key={passo} className="calc-step text-slate-500">
                <span className="calc-step-dot">{i + 1}</span> {passo}
                {i < 2 ? <span className="ml-2 text-slate-300">›</span> : null}
              </span>
            ))}
            <span className="ml-auto font-mono text-[11px] text-slate-400">
              {r.itens ? `${r.itens} ${r.itens === 1 ? 'item' : 'itens'}` : 'vazia'}
            </span>
          </div>

          <div className="p-5">
            <BuscaCalculadora
              onProduto={(p) => {
                adicionarProduto(p)
                toast('Produto adicionado.', 'ok')
              }}
              onNcm={(codigo) => abrirCustom(codigo)}
            />

            <div className="mt-5 space-y-3">
              {itens.length ? (
                itens.map((it, i) => <ItemLinha key={it.uid} item={it} indice={i} />)
              ) : (
                <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line)] bg-slate-50/50 px-6 py-10 text-center dark:bg-slate-950/30">
                  <IconeBadge nome="calculadora" tom="brand" tamanho="lg" />
                  <div className="mt-3 text-sm font-bold">Monte sua simulação em 3 passos</div>
                  <div className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                    1 · Busque um produto salvo ou informe um NCM manual.
                    2 · Ajuste quantidade e valor unitário.
                    3 · Adicione à calculadora — o resumo (Valor do IBS / Valor da CBS) aparece aqui ao lado.
                  </div>
                </div>
              )}
            </div>
          </div>
        </Painel>
        </Entrada>
      </div>

      {temItens ? (
      <aside className="calc-aside-enter space-y-4 lg:sticky lg:top-4 lg:h-fit" aria-live="polite">
        <div className="calc-hero overflow-hidden rounded-2xl">
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-center justify-between">
              <span className="calc-hero-rotulo">Total geral · operação + tributos</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                {r.itens ? `${r.itens} ${r.itens === 1 ? 'item' : 'itens'}` : '—'}
              </span>
            </div>
            <div className="calc-hero-valor mt-1 break-all text-3xl leading-none tabular-nums xl:text-4xl text-white" aria-live="polite" title={fmtMoeda(r.total)}>
              {fmtMoeda(r.total)}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-white/75">
              <span>Tributos {fmtMoeda(r.tributos)}</span>
              <span className="rounded-full bg-aurum-400/25 px-2 py-0.5 font-mono font-bold text-aurum-200">
                carga {pctCarga}
              </span>
            </div>
            <div className="calc-bar mt-3 !bg-white/20" aria-hidden="true">
              <span className="calc-bar-ibs !bg-gradient-to-r !from-white/90 !to-white/60" style={{ width: `${r.tributos > 0 ? (r.ibs / r.tributos) * 100 : 50}%` }} />
              <span className="calc-bar-cbs" style={{ width: `${r.tributos > 0 ? (r.cbs / r.tributos) * 100 : 50}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between gap-2 font-mono text-[10px] text-white/65">
              <span>■ Valor do IBS: {fmtMoeda(r.ibs)}</span>
              <span>■ Valor da CBS: {fmtMoeda(r.cbs)}</span>
            </div>
          </div>

          <div className="space-y-2 bg-white px-5 py-4 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <LinhaResumo rotulo="Base das operações (BC)" valor={fmtMoeda(r.base)} />
            {temReducao ? (
              <p className="-mt-1 text-[10px] text-slate-400">
                BC = valor cheio · alíquotas já com redução por item.
              </p>
            ) : null}
            <LinhaResumo rotulo="Valor do IBS" valor={fmtMoeda(r.ibs)} destaque />
            <LinhaResumo rotulo="Valor da CBS" valor={fmtMoeda(r.cbs)} destaque />
          </div>

          <div className="flex flex-wrap gap-2 bg-white px-4 pb-4 dark:bg-slate-900">
            <Btn className="flex-1" onClick={confirmarLimpar}>
              Limpar
            </Btn>
            <Btn
              className="flex-1"
              carregando={revalidando}
              title="Re-resolve cada item no motor único (preserva sua escolha quando ainda válida)"
              onClick={() => {
                if (!itens.length || revalidando) return
                setRevalidando(true)
                void revalidarItens()
                  .then((n) =>
                    toast(
                      n ? `🔄 ${n} item(ns) atualizado(s) pela regra vigente.` : '✓ Itens conferem com a regra vigente.',
                      n ? 'warn' : 'ok',
                    ),
                  )
                  .finally(() => setRevalidando(false))
              }}
            >
              {revalidando ? 'Revalidando…' : '🔄 Revalidar'}
            </Btn>
            <Btn
              variante="primary"
              className="flex-[2]"
              carregando={acaoSalvar.carregando}
              onClick={acaoSalvar.executar}
            >
              {acaoSalvar.carregando ? 'Salvando…' : 'Salvar no produto'}
            </Btn>
          </div>
        </div>

        <Secao>
        <Painel>
          <div className="border-b border-[var(--line)] px-5 py-3">
            <h3 className="calc-step text-slate-500">
              <span className="calc-step-dot">%</span> Alíquotas de referência
              <span className="ml-auto font-sans text-[10px] font-normal normal-case text-slate-400">
                arraste ou digite
              </span>
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            <CampoTaxa tributo="IBS" />
            <CampoTaxa tributo="CBS" />
          </div>
          <p
            className="px-5 pb-4 text-[10px] leading-relaxed text-slate-400"
            title={REF_FONTE.fonte}
          >
            Padrão IBS {REF_DEFAULT.IBS}% · CBS {REF_DEFAULT.CBS}% — {REF_FONTE.fonte}.
          </p>
        </Painel>
        </Secao>

        <Secao atraso={0.05}>
        <div className="rounded-2xl border border-[var(--line)] bg-slate-50/70 p-4 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
          <div className="calc-step mb-1.5 text-slate-500"><span className="calc-step-dot">i</span> Como ler este cálculo</div>
          <span className="font-bold">Alíquota já com redução.</span> Red. 100% ⇒ alíquota zero.
          BC = valor cheio da operação. Carga = tributos ÷ operação. Barra do hero: azul = IBS, dourado = CBS.
        </div>
        </Secao>
      </aside>
      ) : null}

      <ModalCalcCustom
        aberto={modalAberto}
        ncmInicial={ncmInicial}
        onFechar={() => setModalAberto(false)}
      />
    </div>
  )
}

function LinhaResumo({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string
  valor: string
  destaque?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={`text-xs ${destaque ? 'text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}
      >
        {rotulo}
      </span>
      <span
        className={`font-mono font-semibold ${destaque ? 'text-brand-700 dark:text-aurum-200' : ''}`}
      >
        {valor}
      </span>
    </div>
  )
}
