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
  MASK,
  fmtCarga,
  fmtMoeda,
  fmtNcm,
  fmtNum,
  fmtPct,
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
import { Btn, Painel, Texto, Vazio } from '@/ui/kit'

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

  return (
    <label className="block">
      <span className="field-label">{tributo} (%)</span>
      <Texto
        type="number"
        step="0.01"
        min={0}
        max={100}
        mono
        className="num-input"
        value={texto}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '')
          setTexto(t)
          setRate(tributo, numero(t))
        }}
      />
    </label>
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
    MASK.moeda(String(Math.round((item.valorUnitario || 0) * 100))),
  )

  // Só ressincroniza quando o store mudou por fora (ex.: "Salvar no produto").
  useEffect(() => {
    setQtd((atual) => (parseQtd(atual) === item.quantidade ? atual : fmtNum(item.quantidade)))
  }, [item.quantidade])
  useEffect(() => {
    setValor((atual) =>
      parseMoeda(atual) === item.valorUnitario
        ? atual
        : MASK.moeda(String(Math.round((item.valorUnitario || 0) * 100))),
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

  return (
    <div className="panel card-hover p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              #{indice + 1}
            </span>
            <span className="font-mono text-xs font-bold text-brand-700 dark:text-aurum-200">
              {fmtNcm(item.ncm) || item.ncm}
            </span>
            {item.regraGeral ? (
              <span className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                regra geral
              </span>
            ) : aliqZerada ? (
              <span className="pill bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                Alíquota zero
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-sm font-semibold">{item.nome || '(sem nome)'}</div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            CST {item.cst} · {item.cClassTrib}
            {temReducao ? ` · −${fmtPct(item.redIBS)} / −${fmtPct(item.redCBS)}` : ' · alíquota cheia'}
          </div>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
          title="Remover"
          onClick={() => remover(item.uid)}
        >
          🗑
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label">Qtd</span>
          <Texto
            mono
            mask="qtd"
            className="field-sm num-input"
            inputMode="decimal"
            value={qtd}
            onChange={(e) => {
              setQtd(e.target.value)
              aplicar('quantidade', e.target.value)
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">Valor unit.</span>
          <Texto
            mono
            mask="moeda"
            className="field-sm num-input"
            inputMode="decimal"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              aplicar('valorUnitario', e.target.value)
            }}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] dark:bg-slate-950/40">
        <span className="text-slate-500">
          Op. <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{fmtMoeda(base)}</span>
        </span>
        {temReducao ? (
          <span className="text-slate-500">
            Alíq.{' '}
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-200" title="Alíquota de referência já com a redução aplicada; BC = valor cheio da operação">
              {`${c.aliqIBS.toFixed(2).replace('.', ',')}% / ${c.aliqCBS.toFixed(2).replace('.', ',')}%`}
            </span>
          </span>
        ) : null}
        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
          {fmtMoeda(c.total)}
        </span>
      </div>
      <div className="mt-1 text-right font-mono text-[10px] text-slate-400">
        IBS {fmtMoeda(c.vIBS)} · CBS {fmtMoeda(c.vCBS)} · carga {fmtCarga(c.carga)}
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

  return (
    <div className="relative">
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
                        ? `red. ${fmtPct(p.redIBS)} / ${fmtPct(p.redCBS)}`
                        : 'alíquota cheia'}
                    </span>
                  </span>
                </button>
              ))}
            </>
          ) : null}
          {nomSug.length ? (
            <>
              <div className="sticky top-0 z-10 border-b border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-950/60">
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

  const [modalAberto, setModalAberto] = useState(false)
  const [ncmInicial, setNcmInicial] = useState('')

  const r = resumoDaCalculadora(itens, rateIBS, rateCBS)
  const pctCarga = fmtCarga(r.carga)
  const temReducao = itens.some((it) => (Number(it.redIBS) || 0) > 0 || (Number(it.redCBS) || 0) > 0)

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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        <Painel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <span className="text-lg">🧮</span> Calculadora Tributária
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Adicione produtos salvos e simule IBS/CBS.
              </p>
            </div>
            <span className="pill bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              LC 214/2025
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
                <Vazio
                  icone="🧮"
                  titulo="Nenhum item adicionado"
                  texto="Use a busca acima para adicionar produtos cadastrados ou itens manuais por NCM."
                />
              )}
            </div>
          </div>
        </Painel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:h-fit">
        <Painel className="overflow-hidden">
          <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-5 py-4 dark:border-slate-800 dark:from-brand-950/40 dark:to-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <span>📊</span> Resumo do cálculo
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {r.itens
                ? `${r.itens} ${r.itens === 1 ? 'item' : 'itens'} · Carga efetiva ${pctCarga}`
                : '—'}
            </p>
          </div>

          <div className="space-y-2 p-5 text-sm">
            <LinhaResumo rotulo="Operação (BC)" valor={fmtMoeda(r.base)} />
            {temReducao ? (
              <p className="-mt-1 text-[10px] text-slate-400">
                BC = valor cheio · alíquotas já com redução.
              </p>
            ) : null}
            <LinhaResumo rotulo="IBS" valor={fmtMoeda(r.ibs)} destaque />
            <LinhaResumo rotulo="CBS" valor={fmtMoeda(r.cbs)} destaque />
            <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3 dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wide">Total tributos</span>
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {fmtMoeda(r.tributos)}
              </span>
            </div>
            <div className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 p-3 text-white shadow-pop">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide opacity-90">Total geral</span>
                <span className="font-mono text-lg font-black">{fmtMoeda(r.total)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] opacity-90">
                <span>Carga efetiva</span>
                <span className="font-mono">{pctCarga}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
            <Btn className="flex-1" onClick={confirmarLimpar}>
              🗑 Limpar
            </Btn>
            <Btn variante="primary" className="flex-1" onClick={() => void salvarNoProdutos()}>
              💾 Salvar no produto
            </Btn>
          </div>
        </Painel>

        <Painel>
          <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <span>⚙</span> Alíquotas de referência
              <span className="ml-auto text-[10px] font-normal normal-case text-slate-400">
                editável
              </span>
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5">
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

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          <span className="font-bold">💡 Alíquota já com redução.</span> Red. 100% ⇒ alíquota zero.
          BC = valor cheio da operação. Carga = tributos ÷ operação.
        </div>
      </aside>

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
