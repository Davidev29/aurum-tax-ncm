/**
 * Tela **XML Polida** — redesenho elegante da importação/análise de NF-e.
 *
 * Síntese do estudo multiagente (4 agentes):
 * - Agente 1 Layout: veredito primeiro, ação segundo, exploração em tabs, detalhe em overlay.
 * - Agente 2 Visual: escala 11/12/14/20/28, superfície calma, hero marinho + filete ouro, semântica fixa.
 * - Agente 3 Micro-interações: drag magnético + preview, giro tátil, copy-on-click, chips layoutId,
 *   expand spring, empty ilustrado, toast progressivo, focus ouro.
 * - Agente 4 Motion/DataViz: 0 canvas (CSS bars), count-up hero, cobertura com storytelling,
 *   tabs com AnimatePresence, stagger cap 0.36s, curva [0.22,0.9,0.3,1].
 *
 * Funcional: reutiliza stores/casos de uso existentes — nenhuma lógica fiscal duplicada.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CURVA, Entrada, Expansivel, Item, Lista, useMovimentoReduzido } from '@/ui/motion'
import { fmtCarga, fmtCnpj, fmtMoeda, fmtNcm, fmtNum } from '@/domain/services/format'
import { totaisNotas } from '@/application/notas-xml'
import {
  confrontoRegimes,
  distribuicaoPorAnexo,
  evolucaoMensal,
  resumoDivergencias,
  topCfop,
  topCstReforma,
  topNcm,
} from '@/application/nfe-insights'
import { apurarIbsCbs, type ApuracaoIbsCbs } from '@/infrastructure/nfe/apuracao'
import { classificarNatOp } from '@/infrastructure/nfe/cfop'
import type { NotaXml } from '@/infrastructure/nfe/tipos'
import { useSessao } from '@/store/sessao'
import { useNfe } from '@/store/nfe'
import { BannerContribuintesNovos } from './NfePendentes'
import { BlocoNaturezas } from './NfeNatureza'
import { toast, useUi } from '@/store/ui'
import { ModalConferenciaXml } from './NfeConferenciaProdutos'
import { useConferenciaXml } from '@/store/conferencia-xml'
import { CalendarioAnualModal } from './NfeCalendarioAnual'
import { SeloST, SeloSTNota } from '@/ui/cest'
import { Btn, IconeBadge, Modal, Painel, Pill } from '@/ui/kit'

type Aba = 'notas' | 'fornecedores' | 'produtos' | 'ncm' | 'insights'

/** Linha compacta da natureza na tabela polida (texto cheio no tooltip). */
function rotuloNaturezaPolida(natOp: string | null | undefined): string {
  const base = String(natOp ?? '').trim() || 'sem natureza'
  const classe = classificarNatOp(natOp)
  return classe === 'nao-venda' || classe === 'imobilizado' ? `${base} · sem crédito` : base
}

const ABAS: { id: Aba; rotulo: string; icone: 'nota' | 'fornecedor' | 'caixa' | 'lupa' | 'grafico' }[] = [
  { id: 'notas', rotulo: 'Notas', icone: 'nota' },
  { id: 'fornecedores', rotulo: 'Fornecedores', icone: 'fornecedor' },
  { id: 'produtos', rotulo: 'Produtos', icone: 'caixa' },
  { id: 'ncm', rotulo: 'NCM', icone: 'lupa' },
  { id: 'insights', rotulo: 'Insights', icone: 'grafico' },
]

/* ---------------------------------------------------------- count-up --- */

function useCountUp(alvo: number, duracao = 900): number {
  const reduzir = useMovimentoReduzido()
  const [valor, setValor] = useState(alvo)
  useEffect(() => {
    if (reduzir) {
      setValor(alvo)
      return
    }
    let raf = 0
    const inicio = performance.now()
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / Math.max(1, duracao))
      const e = 1 - Math.pow(1 - t, 3)
      setValor(alvo * e)
      if (t < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [alvo, duracao, reduzir])
  return valor
}

/* -------------------------------------------------------- barra viva --- */

/** Barra que reage a troca de filtro (animate, não one-shot). */
function BarraViva({ pct, className = '' }: { pct: number; className?: string }) {
  const reduzir = useMovimentoReduzido()
  const alvo = `${Math.max(4, Math.min(100, pct))}%`
  if (reduzir) return <div className={className} style={{ width: alvo }} />
  return (
    <motion.div
      className={className}
      initial={{ width: 0 }}
      animate={{ width: alvo }}
      transition={{ duration: 0.55, ease: [...CURVA] }}
    />
  )
}

/* --------------------------------------------------------- copy btn --- */

function Copiar({ texto, children, titulo }: { texto: string; children: React.ReactNode; titulo?: string }) {
  const [ok, setOk] = useState(false)
  const copiar = async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(texto)
      else throw new Error('sem clipboard')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = texto
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setOk(true)
    window.setTimeout(() => setOk(false), 1200)
  }
  return (
    <button
      type="button"
      onClick={copiar}
      title={titulo ?? 'Clique para copiar'}
      className="xml-focus-ouro group inline-flex min-w-0 items-center gap-1 rounded-md px-1 font-mono transition hover:bg-brand-50 dark:hover:bg-brand-950/40"
    >
      <span className="truncate">{children}</span>
      <span
        className={`shrink-0 text-[10px] transition-opacity ${ok ? 'text-emerald-600 opacity-100' : 'text-aurum-600 opacity-0 group-hover:opacity-100'}`}
        aria-hidden="true"
      >
        {ok ? '✓' : '⧉'}
      </span>
      <span className="sr-only">{ok ? 'copiado' : `copiar ${texto}`}</span>
    </button>
  )
}

/* --------------------------------------------------------------- tela --- */

export function NfeXmlPolida() {
  const ativa = useSessao((s) => s.ativa)
  const carregar = useNfe((s) => s.carregar)
  const [aba, setAba] = useState<Aba>('notas')

  useEffect(() => {
    void carregar()
  }, [ativa?.id, carregar])

  if (!ativa) return <SemEmpresaPolida />

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-8">
      <Entrada>
        <CabecalhoPolido />
      </Entrada>
      <Entrada atraso={0.05}>
        <HeroExecutivo />
      </Entrada>
      <Entrada atraso={0.08}>
        <BlocoNaturezasPolida />
      </Entrada>
      <Entrada atraso={0.1}>
        <ImportCompacta />
      </Entrada>
      <Entrada atraso={0.12}>
        <BannerContribuintesNovos />
      </Entrada>
      <Entrada atraso={0.14}>
        <TabsExploracao aba={aba} onTrocar={setAba} />
      </Entrada>
      <ModalConferenciaXml />
    </div>
  )
}

function CabecalhoPolido() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-600 dark:text-aurum-200">
          Notas fiscais · XML
        </p>
        <h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Visão executiva da Reforma</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Um veredito, três números e cinco abas — sem rolagem infinita, sem gráfico gêmeo.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill cor="brand">LC 214/2025 · IBS + CBS</Pill>
        <button
          type="button"
          title="Voltar para a tela clássica"
          onClick={() => {
            try {
              localStorage.setItem('xml-layout', 'classica')
            } catch { /* sem armazenamento */ }
            window.location.reload()
          }}
          className="xml-focus-ouro pill bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          ↩ Clássica
        </button>
      </div>
    </div>
  )
}

function SemEmpresaPolida() {
  const abrirModal = useUi((s) => s.abrirModal)
  return (
    <Painel className="mx-auto max-w-xl p-8 text-center">
      <motion.div
        animate={{ y: [-2, 2, -2] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        className="mx-auto grid h-14 w-14 place-items-center"
      >
        <IconeBadge nome="empresa" tom="brand" tamanho="lg" />
      </motion.div>
      <h2 className="mt-3 text-sm font-bold">Vincule uma empresa para começar</h2>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Cada XML é vinculado ao CNPJ ativo — entradas geram crédito, saídas geram débito.
      </p>
      <div className="mt-4">
        <Btn variante="primary" onClick={() => abrirModal('empresas')}>
          Escolher empresa
        </Btn>
      </div>
    </Painel>
  )
}

/* -------------------------------------------------- apuração única --- */

/**
 * Hero + Insights pediam `apurarIbsCbs(notas)` cada um — 2× o mesmo cálculo
 * sobre o mesmo array. Cache por referência: o 2º uso reaproveita o memo do
 * 1º (zustand entrega a mesma referência aos dois). `confrontoRegimes`,
 * `evolucaoMensal` e `resumoDivergencias` têm um único uso (AbaInsights) e
 * seguem com `useMemo` local.
 */
let cacheNotasAp: NotaXml[] | null = null
let cacheAp: ApuracaoIbsCbs | null = null

function apuracaoUnica(notas: NotaXml[]): ApuracaoIbsCbs {
  if (cacheNotasAp === notas && cacheAp) return cacheAp
  const ap = apurarIbsCbs(notas)
  cacheNotasAp = notas
  cacheAp = ap
  return ap
}

/* --------------------------------------------------------------- hero --- */

function HeroExecutivo() {
  const notas = useNfe((s) => s.notas)
  const ativa = useSessao((s) => s.ativa)
  const preparar = useConferenciaXml((s) => s.preparar)
  const preparando = useConferenciaXml((s) => s.preparando)
  const filtros = useNfe((s) => s.filtros)
  const tot = useMemo(() => totaisNotas(notas), [notas])
  const ap = useMemo(() => apuracaoUnica(notas), [notas])

  const cobertura = ap.debitoEfetivoTotal > 0 ? Math.min(100, (ap.creditoEfetivoTotal / ap.debitoEfetivoTotal) * 100) : 0
  const falta = Math.max(0, ap.debitoEfetivoTotal - ap.creditoEfetivoTotal)
  const saldoAnim = useCountUp(ap.resultado === 'a-pagar' ? ap.valorAPagar : ap.resultado === 'saldo-credor' ? ap.saldoCredor : ap.saldoTotal)
  const baseAnim = useCountUp(tot.base)
  const tribAnim = useCountUp(tot.trib)

  const faixa = cobertura < 50 ? 'baixa' : cobertura < 100 ? 'parcial' : 'total'
  const vereditoCor = ap.resultado === 'a-pagar' ? 'red' : ap.resultado === 'saldo-credor' ? 'emerald' : 'slate'
  const vereditoTxt =
    ap.resultado === 'a-pagar'
      ? 'A pagar'
      : ap.resultado === 'saldo-credor'
        ? 'Saldo credor'
        : ap.resultado === 'zerado'
          ? 'Zerado'
          : 'Sem movimento'

  const barraCor =
    faixa === 'baixa'
      ? 'bg-gradient-to-r from-red-500 to-amber-400'
      : faixa === 'parcial'
        ? 'bg-gradient-to-r from-brand-600 to-brand-400'
        : 'bg-gradient-to-r from-emerald-600 to-teal-400'

  const vincular = () => void preparar(notas, ativa?.id ?? null)

  // FIX sobreposição mobile: hero grudado ocupava 1/3 da tela e cobria
  // filtros/tabs. Sticky só em lg, com scroll-margin para âncoras.
  return (
    <div className="lg:sticky lg:top-0 lg:z-20 scroll-mt-24">
      <div className="calc-hero overflow-hidden rounded-2xl">
        <div className="h-0.5 bg-gradient-to-r from-aurum-400 via-aurum-200 to-transparent" />
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={ap.resultado}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  className={`pill ${vereditoCor === 'red' ? 'bg-red-100 text-red-700' : vereditoCor === 'emerald' ? 'bg-emerald-100 text-emerald-800' : 'bg-white/15 text-white/85'}`}
                >
                  {vereditoTxt.toUpperCase()}
                </motion.span>
              </AnimatePresence>
              <span className="text-[11px] text-white/70">
                {tot.qtd} nota(s) · {tot.entradas} entradas · {tot.saidas} saídas
                {' · '}
                {rotuloPeriodoApuracao(filtros.inicio, filtros.fim)}
              </span>
            </div>
            <div className="calc-hero-rotulo mt-3">
              {ap.resultado === 'a-pagar' ? 'Você vai pagar' : ap.resultado === 'saldo-credor' ? 'Você tem de crédito' : 'Saldo apurado'}
            </div>
            <div className="calc-hero-valor text-[28px] leading-none text-white" aria-live="polite">
              {fmtMoeda(saldoAnim)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-white/70">
              IBS {fmtMoeda(ap.resultado === 'a-pagar' ? Math.max(0, ap.saldoIBS) : ap.saldoIBS)} · CBS{' '}
              {fmtMoeda(ap.resultado === 'a-pagar' ? Math.max(0, ap.saldoCBS) : ap.saldoCBS)}
              {faixa === 'parcial' ? ` · faltam ${fmtMoeda(falta)} para zerar` : null}
            </div>
            <div className="mt-3">
              <div className="flex justify-between font-mono text-[11px] text-white/70">
                <span>
                  {faixa === 'baixa'
                    ? `Cobertura baixa — ${cobertura.toFixed(0)}%`
                    : faixa === 'parcial'
                      ? `Faltam ${fmtMoeda(falta)} para zerar`
                      : cobertura > 0
                        ? 'Cobertura total'
                        : 'Sem débitos no filtro'}
                </span>
                <span>
                  {fmtMoeda(ap.creditoEfetivoTotal)} / {fmtMoeda(ap.debitoEfetivoTotal)}
                </span>
              </div>
              <div className="calc-bar mt-1.5 bg-white/15" aria-hidden="true">
                <BarraViva pct={cobertura} className={`h-full rounded-full ${barraCor}`} />
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-white/60">
                Débito destacado {fmtMoeda(ap.debitoEfetivoTotal)} · esperado {fmtMoeda(ap.debitoInformativoTotal)} (nota−NCM {ap.divergenciaDebitoTotal >= 0 ? '+' : ''}{fmtMoeda(ap.divergenciaDebitoTotal)})
              </div>
              <div className="mt-1 font-mono text-[10px] text-white/60">
                Crédito efetivo (nota) {fmtMoeda(ap.creditoEfetivoTotal)} · Análise pelo NCM: {fmtMoeda(ap.creditoInformativoTotal)} (informativo — você decide)
              </div>
            </div>
          </div>

          <div className="grid w-full max-w-md grid-cols-3 gap-2.5 lg:w-80">
            <div className="rounded-xl border border-white/15 bg-white/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-aurum-200">Base</div>
              <div className="mt-0.5 font-mono text-[20px] font-extrabold tabular-nums text-white">{fmtMoeda(baseAnim)}</div>
              <div className="font-mono text-[11px] text-white/60">no filtro</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-aurum-200">IBS+CBS</div>
              <div className="mt-0.5 font-mono text-[20px] font-extrabold tabular-nums text-white">{fmtMoeda(tribAnim)}</div>
              <div className="font-mono text-[11px] text-white/60">estimado</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-aurum-200">Carga</div>
              <div className="mt-0.5 font-mono text-[20px] font-extrabold tabular-nums text-white">{fmtCarga(tot.carga)}</div>
              <div className="font-mono text-[11px] text-white/60">média</div>
            </div>
            <div className="col-span-3 flex flex-wrap gap-2">
              <Btn variante="primary" tam="sm" className="!border-aurum-400/60" onClick={() => document.getElementById('xml-polida-import')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                Importar XML
              </Btn>
              <Btn tam="sm" className="!bg-white/10 !text-white hover:!bg-white/15" onClick={vincular} carregando={preparando} title="Abre a conferência dos produtos (igual ao lote) antes de salvar">
                {preparando ? 'Conferindo…' : '📦 Conferir e vincular'}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------- naturezas (acima dos gráficos) --- */

function BlocoNaturezasPolida() {
  const notas = useNfe((s) => s.notas)
  return <BlocoNaturezas notas={notas} />
}

/* ------------------------------------------------------------- import --- */

function ImportCompacta() {
  const importar = useNfe((s) => s.importar)
  const processando = useNfe((s) => s.processando)
  const etapa = useNfe((s) => s.etapa)
  const resumo = useNfe((s) => s.ultimoResumo)
  const limparResumo = useNfe((s) => s.limparResumo)
  const inputRef = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)
  const [previa, setPrevia] = useState<{ nome: string; tam: string }[]>([])
  const reduzir = useMovimentoReduzido()

  // Auto-dismiss: o resumo (acerto ou erro) fica ~3s e some com fade.
  useEffect(() => {
    if (!resumo || processando) return
    const t = window.setTimeout(() => {
      limparResumo()
      setPrevia([])
    }, 3000)
    return () => window.clearTimeout(t)
  }, [resumo, processando, limparResumo])

  const enviar = (files: FileList | File[] | null) => {
    if (!files || files.length === 0 || processando) return
    const arr = [...files].filter((f) => /\.xml$/i.test(f.name)).slice(0, 5)
    setPrevia(arr.map((f) => ({ nome: f.name, tam: `${Math.max(1, Math.round(f.size / 1024))} KB` })))
    void importar(files)
  }

  return (
    <Painel className="overflow-hidden" >
      <div id="xml-polida-import" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-stretch">
        <motion.div
          role="button"
          tabIndex={0}
          onClick={() => !processando && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !processando) inputRef.current?.click()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!processando) setSobre(true)
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={(e) => {
            e.preventDefault()
            setSobre(false)
            enviar(e.dataTransfer.files)
          }}
          animate={sobre && !reduzir ? { scale: 1.015 } : { scale: 1 }}
          whileTap={processando || reduzir ? undefined : { scale: 0.985 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          aria-describedby="xml-import-dica"
          className={`flex flex-1 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 text-left transition-colors ${sobre
            ? 'border-brand-500 bg-brand-50/70 shadow-pop dark:bg-brand-950/30'
            : 'border-slate-300 bg-slate-50 hover:border-brand-500 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-950/40'
            } ${processando ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".xml"
            multiple
            onChange={(e) => {
              enviar(e.target.files)
              e.target.value = ''
            }}
          />
          <motion.span
            animate={sobre && !reduzir ? { scale: 1.15, y: -2 } : { scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          >
            <IconeBadge nome="nota" tom="brand" tamanho="md" />
          </motion.span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">
              Arraste os XMLs <span className="text-brand-600 dark:text-aurum-200">ou clique para escolher</span>
            </span>
            <span id="xml-import-dica" className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
              NF-e mod. 55 e NFC-e mod. 65 · chaves repetidas são ignoradas
            </span>
            {processando ? (
              <span className="mt-2 block">
                <span className="block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <span className="loading-bar block h-full w-1/4 rounded-full bg-gradient-to-r from-brand-700 via-aurum-400 to-emerald-500" />
                </span>
                <span className="mt-1 block text-[11px] text-slate-500" aria-live="polite">{etapa ?? 'Processando…'}</span>
              </span>
            ) : (
              <>
                {previa.length && !resumo ? (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {previa.map((p) => (
                      <span key={p.nome} className="pill bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={`${p.nome} · ${p.tam}`}>
                        {p.nome.length > 22 ? `${p.nome.slice(0, 20)}…` : p.nome} · {p.tam}
                      </span>
                    ))}
                  </span>
                ) : null}
                <AnimatePresence initial={false}>
                  {resumo ? (
                    <motion.span
                      key={`${resumo.novas}-${resumo.duplicadas}-${resumo.erros.length}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.3 }}
                      role={resumo.erros.length ? 'alert' : 'status'}
                      className={`mt-1 block text-[11px] font-semibold ${resumo.erros.length ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-400'}`}
                    >
                      {resumo.novas} nova(s){resumo.duplicadas ? ` · ${resumo.duplicadas} duplicada(s)` : ''}{(resumo.redirecionadas ?? 0) > 0 ? ` · ${resumo.redirecionadas} outro cadastro` : ''}{(resumo.orfas ?? 0) > 0 ? ` · ${resumo.orfas} contribuinte novo` : (resumo.quarentena ? ` · ${resumo.quarentena} quarentena` : '')}
                      {resumo.erros.length ? (
                        <span className="mt-1 block max-h-20 overflow-auto font-normal">
                          {resumo.erros.slice(0, 3).map((e, i) => (
                            <span key={`${e.arquivo}-${i}`} className="block break-words">
                              ❌ <strong>{e.arquivo}</strong>: {e.motivo}
                            </span>
                          ))}
                          {resumo.erros.length > 3 ? <span>… +{resumo.erros.length - 3} erro(s)</span> : null}
                        </span>
                      ) : null}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </>
            )}
          </span>
        </motion.div>

        <div className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:w-64">
          <TaxaCompacta tributo="IBS" />
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
          <TaxaCompacta tributo="CBS" />
        </div>
      </div>
    </Painel>
  )
}

function TaxaCompacta({ tributo }: { tributo: 'IBS' | 'CBS' }) {
  const valor = useNfe((s) => (tributo === 'IBS' ? s.refIBS : s.refCBS))
  const setRef = useNfe((s) => s.setRef)
  return (
    <label className="min-w-0 flex-1">
      <span className="field-label !mb-1">{tributo} ref.</span>
      <span className="flex items-baseline gap-0.5">
        <input
          type="number"
          step="0.01"
          min={0}
          max={100}
          value={valor}
          onChange={(e) => setRef(tributo, Number(e.target.value.replace(',', '.')) || 0)}
          aria-label={`Alíquota de referência ${tributo}`}
          className="w-full bg-transparent p-0 font-mono text-[20px] font-extrabold tabular-nums outline-none"
        />
        <span className="font-mono text-[11px] font-bold text-slate-400">%</span>
      </span>
    </label>
  )
}

/* --------------------------------------------------------------- tabs --- */

function TabsExploracao({ aba, onTrocar }: { aba: Aba; onTrocar: (a: Aba) => void }) {
  const notas = useNfe((s) => s.notas)
  const filtros = useNfe((s) => s.filtros)
  const setFiltros = useNfe((s) => s.setFiltros)
  const limparFiltros = useNfe((s) => s.limparFiltros)

  const ativos = [
    filtros.texto,
    filtros.fornecedor,
    filtros.cfop,
    filtros.cstIcms,
    filtros.cClassTrib,
    filtros.cstReforma,
    filtros.reducao,
    filtros.direcao !== 'todas' ? filtros.direcao : '',
    filtros.inicio || filtros.fim ? 'periodo' : '',
  ].filter(Boolean).length

  return (
    <Painel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 pt-3">
        <div role="tablist" aria-label="Exploração das notas" className="flex flex-1 flex-wrap gap-1">
          {ABAS.map((t) => {
            const ativo = aba === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={ativo}
                onClick={() => onTrocar(t.id)}
                className={`xml-focus-ouro relative rounded-lg px-3 py-2 text-[13px] font-bold transition-colors ${ativo ? 'text-brand-700 dark:text-aurum-200' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
              >
                <span className="flex items-center gap-1.5">
                  <IconeBadge nome={t.icone} tom={ativo ? 'brand' : 'slate'} tamanho="sm" />
                  {t.rotulo}
                </span>
                {ativo ? (
                  <motion.span
                    layoutId="tab-nfe-polida"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-aurum-500"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={notas.length}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.2, ease: [...CURVA] }}
              className="font-mono text-[11px] tabular-nums text-slate-500"
              aria-live="polite"
            >
              {notas.length} nota(s)
            </motion.span>
          </AnimatePresence>
          {ativos > 0 ? (
            <button type="button" onClick={() => limparFiltros()} className="xml-focus-ouro pill bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              {ativos} filtro(s) × limpar
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-b border-[var(--line)] bg-slate-50/60 px-4 py-2.5 dark:bg-slate-950/30">
        <FiltroBarra
          texto={filtros.texto}
          direcao={filtros.direcao}
          inicio={filtros.inicio}
          fim={filtros.fim}
          onTexto={(v) => setFiltros({ texto: v })}
          onDirecao={(v) => setFiltros({ direcao: v })}
          onPeriodo={(inicio, fim) => setFiltros({ inicio, fim })}
        />
      </div>

      <div className="p-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={aba}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [...CURVA] }}
          >
            {aba === 'notas' ? <AbaNotas /> : null}
            {aba === 'fornecedores' ? <AbaFornecedores /> : null}
            {aba === 'produtos' ? <AbaProdutos /> : null}
            {aba === 'ncm' ? <AbaNcm /> : null}
            {aba === 'insights' ? <AbaInsights /> : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </Painel>
  )
}

function FiltroBarra({
  texto,
  direcao,
  inicio,
  fim,
  onTexto,
  onDirecao,
  onPeriodo,
}: {
  texto: string
  direcao: 'todas' | 'entrada' | 'saida' | 'quarentena'
  inicio: string
  fim: string
  onTexto: (v: string) => void
  onDirecao: (v: 'todas' | 'entrada' | 'saida' | 'quarentena') => void
  onPeriodo: (inicio: string, fim: string) => void
}) {
  const opcoes = [
    { id: 'todas', rot: 'Todas' },
    { id: 'entrada', rot: 'Entradas' },
    { id: 'saida', rot: 'Saídas' },
    { id: 'quarentena', rot: 'Quarentena' },
  ] as const
  const comPeriodo = Boolean(inicio || fim)
  // Rascunho do período: digitar a data não refiltra sozinho — só aplica no
  // botão Filtrar (ou Enter).
  const [inicioRasc, setInicioRasc] = useState(inicio)
  const [fimRasc, setFimRasc] = useState(fim)
  useEffect(() => {
    setInicioRasc(inicio)
    setFimRasc(fim)
  }, [inicio, fim])
  const periodoPendente = inicioRasc !== inicio || fimRasc !== fim
  const aplicar = () => {
    if (periodoPendente) onPeriodo(inicioRasc, fimRasc)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar por emitente, número ou produto</span>
          <input
            value={texto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="Buscar emitente, número, chave ou produto…"
            className="field field-sm !rounded-full !py-2 pl-9"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
        </label>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] bg-white p-1 dark:bg-slate-900" role="group" aria-label="Direção">
          {opcoes.map((o) => {
            const ativo = direcao === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onDirecao(o.id)}
                aria-pressed={ativo}
                className={`xml-focus-ouro relative rounded-full px-3 py-1 text-[12px] font-bold ${ativo ? 'text-white' : 'text-slate-500'}`}
              >
                {ativo ? (
                  <motion.span layoutId="dir-nfe-polida" className="absolute inset-0 rounded-full bg-brand-700" transition={{ type: 'spring', stiffness: 450, damping: 32 }} />
                ) : null}
                <span className="relative">{o.rot}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
          <span className="font-bold">Período</span>
          <input
            type="date"
            value={inicioRasc}
            onChange={(e) => setInicioRasc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') aplicar()
            }}
            aria-label="Apurar desde"
            className="field field-sm !w-auto !rounded-full !py-1 font-mono"
          />
          <span aria-hidden="true">a</span>
          <input
            type="date"
            value={fimRasc}
            onChange={(e) => setFimRasc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') aplicar()
            }}
            aria-label="Apurar até"
            className="field field-sm !w-auto !rounded-full !py-1 font-mono"
          />
        </label>
        <Btn
          tam="sm"
          variante={periodoPendente ? 'primary' : 'ghost'}
          onClick={aplicar}
          disabled={!periodoPendente}
          title="Aplica o período digitado — digitar a data não filtra sozinho"
        >
          🔎 Filtrar
        </Btn>
        {periodoPendente ? (
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
            Período alterado — clique em Filtrar (ou Enter).
          </span>
        ) : comPeriodo ? (
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400" aria-live="polite">
            Apurando {rotuloPeriodoApuracao(inicio, fim)}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">Apurando todas as notas da empresa</span>
        )}
        {comPeriodo && !periodoPendente ? (
          <button
            type="button"
            onClick={() => onPeriodo('', '')}
            className="xml-focus-ouro pill bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
            title="Limpar período (apuração volta a todas as notas)"
          >
            ✕ limpar período
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- aba notas --- */

function AbaNotas() {
  const notas = useNfe((s) => s.notas)
  const abrirNota = useNfe((s) => s.abrirNota)
  const excluir = useNfe((s) => s.excluir)
  const notaAberta = useNfe((s) => s.notaAberta)
  const fecharNota = useNfe((s) => s.fecharNota)
  const [pag, setPag] = useState(0)
  const porPag = 12

  useEffect(() => setPag(0), [notas.length])

  const totalPag = Math.max(1, Math.ceil(notas.length / porPag))
  const visiveis = notas.slice(pag * porPag, pag * porPag + porPag)

  if (!notas.length) {
    return <AbaNotasVazia />
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <div className="max-h-[380px] overflow-auto">
          <table className="tbl tbl-compacta w-full">
            <thead>
              <tr>
                <th>Nota</th>
                <th>Emitente</th>
                <th className="th-r">Base</th>
                <th className="th-r">IBS+CBS</th>
                <th className="th-r">Ações</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {visiveis.map((n) => (
                  <motion.tr
                    key={n.chave || `${n.numero}-${n.emitCnpj}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="xml-focus-ouro cursor-pointer"
                    onClick={() => abrirNota(n)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') abrirNota(n)
                    }}
                    aria-label={`Ver itens da nota ${n.numero || n.chave.slice(-8)}`}
                  >
                    <td>
                      <div className="text-[13px] font-bold">Nº {n.numero || '—'} <span className="font-normal text-slate-400">s.{n.serie || '—'}</span></div>
                      <div className="font-mono text-[11px] text-slate-400">{String(n.dataEmissao || '').slice(0, 10)} · {n.direcao === 'entrada' ? 'Entrada' : n.direcao === 'saida' ? 'Saída' : 'Quarentena'}</div>
                      <div
                        className="mt-0.5 max-w-55 truncate text-[11px] text-slate-500 dark:text-slate-400"
                        title={n.natOp ? `Natureza da operação: ${n.natOp}` : 'Sem natureza informada no XML'}
                      >
                        🏷️ {rotuloNaturezaPolida(n.natOp)}
                      </div>
                      <SeloSTNota itens={n.itensAnalisados} />
                    </td>
                    <td className="max-w-[220px]">
                      <div className="truncate text-[13px] font-semibold" title={n.emitNome}>{n.emitNome}</div>
                      <Copiar texto={n.emitCnpj} titulo="Clique para copiar o CNPJ">
                        <span className="text-[11px] text-slate-500">{fmtCnpj(n.emitCnpj)}</span>
                      </Copiar>
                    </td>
                    <td className="text-right font-mono tabular-nums">{fmtMoeda(n.valorTotal)}</td>
                    <td className="text-right font-mono font-bold tabular-nums text-brand-700 dark:text-aurum-200">{fmtMoeda(n.totalTributos)}</td>
                    <td className="text-right">
                      <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <button type="button" title="Ver itens" onClick={() => abrirNota(n)} className="xml-focus-ouro rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">👁</button>
                        <button type="button" title="Excluir nota" onClick={() => void excluir(n)} className="xml-focus-ouro rounded-lg px-2 py-1 hover:bg-red-50 dark:hover:bg-red-950/40">🗑</button>
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="font-mono text-[11px] text-slate-400">Página {pag + 1} de {totalPag}</span>
        <div className="flex gap-1.5">
          <Btn tam="sm" disabled={pag === 0} onClick={() => setPag((p) => Math.max(0, p - 1))}>‹ Anterior</Btn>
          <Btn tam="sm" disabled={pag + 1 >= totalPag} onClick={() => setPag((p) => p + 1)}>Próxima ›</Btn>
        </div>
      </div>
      {notaAberta ? <ModalNotaPolida nota={notaAberta} onFechar={fecharNota} /> : null}
    </div>
  )
}

function ModalNotaPolida({ nota, onFechar }: { nota: NotaXml; onFechar: () => void }) {
  const classeNatPolida = classificarNatOp(nota.natOp)
  const corNatPolida = classeNatPolida === 'venda' ? 'emerald' : classeNatPolida === 'indefinida' ? 'red' : 'amber'
  return (
    <Modal aberto onFechar={onFechar} titulo={`Nota ${nota.numero || '—'} · ${nota.emitNome}`} subtitulo={`${String(nota.dataEmissao || '').slice(0, 10)} · ${fmtMoeda(nota.valorTotal)} · IBS+CBS ${fmtMoeda(nota.totalTributos)}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill cor={nota.direcao === 'entrada' ? 'brand' : nota.direcao === 'saida' ? 'emerald' : 'amber'}>
          {nota.direcao === 'entrada' ? 'Entrada · crédito' : nota.direcao === 'saida' ? 'Saída · débito' : 'Quarentena · fora da apuração'}
        </Pill>
        <SeloSTNota itens={nota.itensAnalisados} />
        <Copiar texto={nota.chave} titulo="Clique para copiar a chave de acesso">
          <span className="text-[11px] text-slate-500">Chave {nota.chave.slice(0, 12)}…{nota.chave.slice(-4)}</span>
        </Copiar>
      </div>
      <div
        className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-slate-50/70 px-3 py-2 dark:bg-slate-950/40"
        title={nota.natOp ? `Natureza como veio na capa do XML: ${nota.natOp}` : 'XML sem natureza da operação informada'}
      >
        <span aria-hidden>🏷️</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Natureza da operação · capa</div>
          <div className="truncate text-xs font-black" title={nota.natOp || undefined}>
            {nota.natOp || <span className="font-normal italic text-slate-400">sem natureza informada</span>}
          </div>
        </div>
        <Pill cor={corNatPolida}>
          {rotuloNaturezaPolida(nota.natOp)}
        </Pill>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <table className="tbl tbl-compacta">
          <thead>
            <tr>
              <th>Item / NCM</th>
              <th className="th-r">Qtd · Base</th>
              <th className="th-r">IBS+CBS</th>
            </tr>
          </thead>
          <tbody>
            {nota.itensAnalisados.map((it, i) => (
              <tr key={`${it.codProd}-${it.ncm}-${i}`}>
                <td className="max-w-[280px]">
                  <div className="truncate text-[13px] font-semibold" title={it.descricao}>{it.descricao || it.codProd}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Copiar texto={it.ncm} titulo="Clique para copiar o NCM">
                      <span className="text-[11px] text-slate-500">{fmtNcm(it.ncm)}</span>
                    </Copiar>
                    <Pill cor="slate">CST {it.classificacao?.cst || '—'}</Pill>
                    <Pill cor="brand">{it.classificacao?.cClassTrib || '—'}</Pill>
                    <SeloST cest={it.cest} />
                  </div>
                </td>
                <td className="text-right font-mono tabular-nums">{fmtNum(it.qtd)} · {fmtMoeda(it.vlTotal)}</td>
                <td className="text-right font-mono font-bold tabular-nums">{fmtMoeda(it.totalTributos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------- aba fornecedores --- */

function AbaFornecedores() {
  const ranking = useNfe((s) => s.ranking)
  const setFiltros = useNfe((s) => s.setFiltros)
  const [aberto, setAberto] = useState<string | null>(null)
  const max = ranking.reduce((m, r) => Math.max(m, r.creditoTotal), 0)

  if (!ranking.length) return <VazioPolido titulo="Sem entradas para ranquear" texto="Importe XMLs de compra de regime normal." />

  return (
    <Lista className="space-y-2" intervalo={0.05}>
      {ranking.slice(0, 8).map((r, i) => {
        const isAberto = aberto === r.cnpj
        return (
          <Item key={r.cnpj}>
            <motion.button
              layout
              type="button"
              onClick={() => setAberto(isAberto ? null : r.cnpj)}
              aria-expanded={isAberto}
              whileTap={{ scale: 0.985 }}
              transition={{ duration: 0.12 }}
              className={`xml-focus-ouro w-full rounded-xl border p-3 text-left transition-shadow hover:shadow-card ${isAberto ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/25' : 'border-[var(--line)] bg-white dark:bg-slate-900'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[11px] font-black text-slate-500 dark:bg-slate-800">{i + 1}</span>
                  <span className="truncate text-[13px] font-bold" title={`${r.nome} · ${fmtCnpj(r.cnpj)}`}>{r.nome}</span>
                  {r.simples ? <Pill cor="amber">Simples · sem crédito</Pill> : null}
                </span>
                <span className={`shrink-0 font-mono text-[14px] font-extrabold tabular-nums ${r.simples ? 'text-slate-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {fmtMoeda(r.creditoTotal)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <BarraViva pct={max > 0 ? (r.creditoTotal / max) * 100 : 0} className="h-full rounded-full bg-gradient-to-r from-brand-600 to-emerald-500" />
              </div>
              <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-slate-400">
                <span>{r.qtdNotas} nota(s) · {fmtMoeda(r.totalEntradas)}</span>
                <Copiar texto={r.cnpj} titulo="Clique para copiar o CNPJ">
                  <span>{fmtCnpj(r.cnpj)}</span>
                </Copiar>
              </div>
              <Expansivel aberto={isAberto}>
                <div className="mt-2.5 rounded-lg bg-slate-50 p-2.5 text-[12px] dark:bg-slate-950/50">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
                    <span>IBS <strong>{fmtMoeda(r.creditoIBS)}</strong></span>
                    <span>CBS <strong>{fmtMoeda(r.creditoCBS)}</strong></span>
                    <span>Ticket <strong>{fmtMoeda(r.qtdNotas > 0 ? r.totalEntradas / r.qtdNotas : 0)}</strong></span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Btn tam="sm" variante="primary" onClick={(e) => { e.stopPropagation(); setFiltros({ fornecedor: r.cnpj, direcao: 'entrada' }); toast(`Filtrado: ${r.nome}`, 'ok') }}>
                      Ver notas
                    </Btn>
                    {r.simples ? (
                      <span className="self-center text-[11px] text-amber-700 dark:text-amber-300">Valores estimados — Simples não transfere crédito.</span>
                    ) : null}
                  </div>
                </div>
              </Expansivel>
            </motion.button>
          </Item>
        )
      })}
    </Lista>
  )
}

/* ------------------------------------------------------- aba produtos --- */

function AbaProdutos() {
  const notas = useNfe((s) => s.notas)
  const dados = useMemo(() => {
    const agregar = (fluxo: 'entrada' | 'saida') => {
      const mapa = new Map<string, { nome: string; ncm: string; qtd: number; base: number; trib: number; ibs: number; cbs: number }>()
      for (const n of notas) {
        if (n.direcao !== fluxo) continue
        for (const it of n.itensAnalisados) {
          const chave = `${it.codProd}‖${it.ncm}`
          const atual = mapa.get(chave) ?? { nome: it.descricao || it.codProd, ncm: it.ncm, qtd: 0, base: 0, trib: 0, ibs: 0, cbs: 0 }
          atual.qtd += Number(it.qtd) || 0
          atual.base += Number(it.vlTotal) || 0
          atual.ibs += Number(it.ibs) || 0
          atual.cbs += Number(it.cbs) || 0
          atual.trib += Number(it.totalTributos) || 0
          mapa.set(chave, atual)
        }
      }
      return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, 5)
    }
    return { entradas: agregar('entrada'), saidas: agregar('saida') }
  }, [notas])

  if (!notas.length) return <VazioPolido titulo="Sem produtos no filtro" texto="Importe XMLs para ver o ranking." />

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <QuadroPolido titulo="Mais comprados" tom="emerald" lista={dados.entradas} vazio="Sem entradas no período." />
      <QuadroPolido titulo="Mais vendidos" tom="brand" lista={dados.saidas} vazio="Sem saídas no período." />
    </div>
  )
}

function QuadroPolido({
  titulo,
  tom,
  lista,
  vazio,
}: {
  titulo: string
  tom: 'emerald' | 'brand'
  lista: { nome: string; ncm: string; qtd: number; base: number; trib: number; ibs: number; cbs: number }[]
  vazio: string
}) {
  const max = lista.reduce((m, p) => Math.max(m, p.base), 0)
  const corValor = tom === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-brand-700 dark:text-aurum-200'
  if (!lista.length) return <VazioPolido titulo={titulo} texto={vazio} />
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
      <div className="border-b border-[var(--line)] px-3.5 py-2.5">
        <h3 className="flex items-center gap-2 text-[13px] font-bold">
          <IconeBadge nome="trofeu" tom={tom} tamanho="sm" /> {titulo}
        </h3>
      </div>
      <Lista className="space-y-1.5 p-2.5" intervalo={0.05}>
        {lista.map((p, i) => {
          const carga = p.base > 0 ? (p.trib / p.base) * 100 : 0
          return (
            <Item key={`${p.nome}-${p.ncm}-${i}`}>
              <div className="rounded-lg p-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-950/50" title={`${p.nome} · NCM ${fmtNcm(p.ncm)}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[10px] font-black text-slate-500 dark:bg-slate-800">{i + 1}</span>
                    <span className="truncate text-[13px] font-bold">{p.nome}</span>
                  </span>
                  <span className={`shrink-0 font-mono text-[14px] font-extrabold tabular-nums ${corValor}`}>{fmtMoeda(p.base)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <BarraViva pct={max > 0 ? (p.base / max) * 100 : 0} className={`h-full rounded-full ${tom === 'emerald' ? 'bg-gradient-to-r from-emerald-600 to-teal-400' : 'bg-gradient-to-r from-brand-600 to-brand-400'}`} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <Copiar texto={p.ncm} titulo="Clique para copiar o NCM">
                    <span className="text-[11px] text-slate-400">{fmtNcm(p.ncm)} · qtd {fmtNum(p.qtd)}</span>
                  </Copiar>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">IBS {fmtMoeda(p.ibs)} + CBS {fmtMoeda(p.cbs)} · <strong className={corValor}>{fmtCarga(carga)}</strong></span>
                </div>
              </div>
            </Item>
          )
        })}
      </Lista>
    </div>
  )
}

/* ------------------------------------------------------------ aba ncm --- */

function AbaNcm() {
  const notas = useNfe((s) => s.notas)
  const anexos = useMemo(() => distribuicaoPorAnexo(notas), [notas])
  const csts = useMemo(() => topCstReforma(notas, 6), [notas])
  const cfops = useMemo(() => topCfop(notas, 6), [notas])
  const ncms = useMemo(() => topNcm(notas, 8), [notas])

  if (!notas.length) return <VazioPolido titulo="Sem NCMs no filtro" texto="Importe XMLs para ver a distribuição." />

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <BlocoBarras titulo="Por benefício" linhas={anexos.map((a) => ({ rotulo: a.anexo === 'isento' ? 'Sem benefício' : `Anexo ${a.anexo}`, sub: `${a.itens} item(ns)`, base: a.base, trib: a.trib }))} />
      <BlocoBarras titulo="Por CST da Reforma" linhas={csts.map((c) => ({ rotulo: c.rotulo, sub: c.sub ?? '', base: c.base, trib: c.trib }))} />
      <BlocoBarras titulo="Por CFOP" linhas={cfops.map((c) => ({ rotulo: c.rotulo, sub: `${c.qtd} item(ns)`, base: c.base, trib: c.trib }))} />
      <BlocoBarras titulo="Top NCM por base" linhas={ncms.map((c) => ({ rotulo: fmtNcm(c.chave), sub: c.sub ?? '', base: c.base, trib: c.trib, copiar: c.chave }))} />
    </div>
  )
}

function BlocoBarras({
  titulo,
  linhas,
}: {
  titulo: string
  linhas: { rotulo: string; sub?: string; base: number; trib: number; copiar?: string }[]
}) {
  const max = linhas.reduce((m, l) => Math.max(m, l.base), 0)
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white dark:bg-slate-900">
      <div className="border-b border-[var(--line)] px-3.5 py-2.5">
        <h3 className="flex items-center gap-2 text-[13px] font-bold">
          <IconeBadge nome="rosca" tom="brand" tamanho="sm" /> {titulo}
        </h3>
      </div>
      <Lista className="space-y-2 p-3" intervalo={0.05}>
        {linhas.map((l, i) => (
          <Item key={`${l.rotulo}-${i}`}>
            <div>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate font-bold">
                  {l.copiar ? (
                    <Copiar texto={l.copiar} titulo="Clique para copiar o NCM"><span>{l.rotulo}</span></Copiar>
                  ) : (
                    l.rotulo
                  )}
                  {l.sub ? <span className="ml-1.5 font-mono text-[11px] font-normal text-slate-400">{l.sub}</span> : null}
                </span>
                <span className="shrink-0 font-mono font-extrabold tabular-nums">{fmtMoeda(l.base)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <BarraViva pct={max > 0 ? (l.base / max) * 100 : 0} className="h-full rounded-full bg-gradient-to-r from-brand-600 to-aurum-400" />
              </div>
              <div className="mt-0.5 text-right font-mono text-[11px] tabular-nums text-slate-400">IBS+CBS {fmtMoeda(l.trib)}</div>
            </div>
          </Item>
        ))}
      </Lista>
    </div>
  )
}

/* ------------------------------------------------------- aba insights --- */

function AbaInsights() {
  const notas = useNfe((s) => s.notas)
  const filtros = useNfe((s) => s.filtros)
  const ap = useMemo(() => apuracaoUnica(notas), [notas])
  const conf = useMemo(() => confrontoRegimes(notas), [notas])
  const evo = useMemo(() => evolucaoMensal(notas, 8), [notas])
  const div = useMemo(() => resumoDivergencias(notas), [notas])
  const [detalhe, setDetalhe] = useState(false)

  const maxEvo = evo.reduce((m, p) => Math.max(m, p.tribEntradas + p.tribSaidas), 0)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--line)] bg-white p-3.5 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-[13px] font-bold">
            <IconeBadge nome="calculadora" tom="brand" tamanho="sm" /> Antigo × Novo
          </h3>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            Apurando {rotuloPeriodoApuracao(filtros.inicio, filtros.fim)} · {notas.length} nota(s)
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950/50">
              <div className="text-[10px] font-bold uppercase text-slate-500">Regime antigo</div>
              <div className="font-mono text-[18px] font-extrabold tabular-nums">{fmtMoeda(conf.antigo)}</div>
              <div className="font-mono text-[11px] text-slate-400">ICMS {fmtMoeda(conf.icms)} + PIS/COFINS {fmtMoeda(conf.pisCofins)}</div>
            </div>
            <div className="rounded-lg bg-brand-50 p-2.5 dark:bg-brand-950/30">
              <div className="text-[10px] font-bold uppercase text-brand-600 dark:text-aurum-200">IBS + CBS</div>
              <div className="font-mono text-[18px] font-extrabold tabular-nums">{fmtMoeda(conf.novo)}</div>
              <div className="font-mono text-[11px] text-slate-500">IBS {fmtMoeda(conf.ibs)} + CBS {fmtMoeda(conf.cbs)}</div>
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
            Diferença de <strong className={conf.delta >= 0 ? 'text-red-600' : 'text-emerald-600'}>{fmtMoeda(conf.delta)}</strong>
            {conf.variacaoPct != null ? ` (${conf.variacaoPct >= 0 ? '+' : ''}${conf.variacaoPct.toFixed(1).replace('.', ',')}%)` : ''} no filtro atual.
          </p>
          <button type="button" onClick={() => setDetalhe((v) => !v)} className="xml-focus-ouro mt-1.5 text-[12px] font-bold text-brand-600 dark:text-aurum-200" aria-expanded={detalhe}>
            {detalhe ? '▾ Ocultar detalhamento LC 214' : '▸ Ver detalhamento LC 214'}
          </button>
          <Expansivel aberto={detalhe}>
            <table className="tbl tbl-compacta mt-2">
              <tbody>
                <tr><td>Débitos destacados — vendas que você emitiu ({ap.qtdSaidas})</td><td className="text-right font-mono">{fmtMoeda(ap.debitoEfetivoTotal)}</td></tr>
                <tr><td>Análise pelo NCM — débito esperado (informativo)</td><td className="text-right font-mono text-slate-500">{fmtMoeda(ap.debitoInformativoTotal)}</td></tr>
                <tr><td>Diferença débito nota − NCM (emissão correta?)</td><td className={`text-right font-mono font-bold ${ap.divergenciaDebitoTotal < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{ap.divergenciaDebitoTotal >= 0 ? '+' : ''}{fmtMoeda(ap.divergenciaDebitoTotal)}</td></tr>
                {ap.debitoSemEfeitoTotal > 0 ? <tr><td>Saídas fora de venda ({ap.qtdSaidasSemEfeito}) — fora do saldo</td><td className="text-right font-mono text-slate-500">{fmtMoeda(ap.debitoSemEfeitoTotal)}</td></tr> : null}
                <tr><td>(−) Créditos efetivos — notas que você recebeu ({ap.qtdEntradasEfetivas})</td><td className="text-right font-mono text-emerald-700">{fmtMoeda(ap.creditoEfetivoTotal)}</td></tr>
                <tr><td className="font-bold">(=) Saldo assistido</td><td className="text-right font-mono font-black">{fmtMoeda(ap.saldoTotal)}</td></tr>
                <tr><td>Análise pelo NCM — Pela reforma (informativo)</td><td className="text-right font-mono text-slate-500">{fmtMoeda(ap.creditoInformativoTotal)}</td></tr>
                <tr><td>Diferença nota − NCM (você decide)</td><td className={`text-right font-mono font-bold ${ap.divergenciaCreditoTotal < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{ap.divergenciaCreditoTotal >= 0 ? '+' : ''}{fmtMoeda(ap.divergenciaCreditoTotal)}</td></tr>
                {ap.bloqueadoTotal > 0 ? <tr><td>Bloqueados Simples/MEI ({ap.qtdEntradasBloqueadas})</td><td className="text-right font-mono text-amber-700">{fmtMoeda(ap.bloqueadoTotal)}</td></tr> : null}
                {ap.naoConfirmadoTotal > 0 ? <tr><td>Não confirmados ({ap.qtdEntradasNaoConfirmadas})</td><td className="text-right font-mono text-slate-500">{fmtMoeda(ap.naoConfirmadoTotal)}</td></tr> : null}
              </tbody>
            </table>
          </Expansivel>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-white p-3.5 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-[13px] font-bold">
            <IconeBadge nome="grafico" tom="emerald" tamanho="sm" /> Evolução mensal
          </h3>
          {!evo.length ? (
            <p className="py-4 text-center text-[12px] text-slate-400">Sem série temporal no filtro.</p>
          ) : (
            <Lista className="mt-2.5 space-y-2" intervalo={0.05}>
              {evo.map((p) => {
                const total = p.tribEntradas + p.tribSaidas
                return (
                  <Item key={p.mes}>
                    <div>
                      <div className="flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="font-mono font-bold text-slate-500">{p.rotulo}</span>
                        <span className="font-mono font-extrabold tabular-nums">{fmtMoeda(total)}</span>
                      </div>
                      <div className="calc-bar mt-1" aria-hidden="true">
                        <BarraViva pct={maxEvo > 0 ? (p.tribEntradas / maxEvo) * 100 : 0} className="calc-bar-ibs" />
                        <BarraViva pct={maxEvo > 0 ? (p.tribSaidas / maxEvo) * 100 : 0} className="calc-bar-cbs" />
                      </div>
                      <div className="mt-0.5 flex justify-between font-mono text-[11px] text-slate-400">
                        <span>Entr. {fmtMoeda(p.tribEntradas)}</span>
                        <span>Saídas {fmtMoeda(p.tribSaidas)}</span>
                      </div>
                    </div>
                  </Item>
                )
              })}
            </Lista>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-[12px] leading-relaxed dark:border-amber-900 dark:bg-amber-950/25 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <strong>Prontidão do XML:</strong> {div.comXml} de {div.totalItens} item(ns) destacam IBS/CBS · {div.divergentes} divergem do sistema
          {div.taxaConferencia != null ? ` · conferência ${div.taxaConferencia.toFixed(0)}%` : ''}.
        </div>
        <Btn tam="sm" onClick={() => toast('Filtre por divergência no detalhe da nota (em breve: filtro dedicado).', 'warn')}>
          Ver divergentes
        </Btn>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- vazio --- */

/** ISO `aaaa-mm-dd` → `dd/mm/aaaa` (rótulos de período da apuração). */
const fmtDataXml = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso

/** Rótulo do recorte temporal da apuração assistida (reage aos filtros). */
function rotuloPeriodoApuracao(inicio: string, fim: string): string {
  if (inicio && fim) return inicio === fim ? `em ${fmtDataXml(inicio)}` : `${fmtDataXml(inicio)} a ${fmtDataXml(fim)}`
  if (inicio) return `desde ${fmtDataXml(inicio)}`
  if (fim) return `até ${fmtDataXml(fim)}`
  return 'todas as notas da empresa'
}

function VazioPolido({ titulo, texto, children }: { titulo: string; texto?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center dark:border-slate-700 dark:bg-slate-950/30">
      <motion.div
        animate={{ y: [-2, 2, -2] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        className="mx-auto grid h-12 w-12 place-items-center"
      >
        <IconeBadge nome="pasta" tom="slate" tamanho="lg" />
      </motion.div>
      <div className="mt-2 text-[14px] font-bold">{titulo}</div>
      {texto ? <div className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-slate-500">{texto}</div> : null}
      {children ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  )
}

function AbaNotasVazia() {
  const [anualAberto, setAnualAberto] = useState(false)
  return (
    <>
      <VazioPolido
        titulo="Nenhuma nota neste filtro"
        texto="Pode não haver documentos neste mês. Abra o calendário anual: os meses com notas ficam com a borda cintilante."
      >
        <Btn variante="primary" tam="sm" onClick={() => setAnualAberto(true)}>
          📅 Abrir calendário anual
        </Btn>
      </VazioPolido>
      <CalendarioAnualModal aberto={anualAberto} onFechar={() => setAnualAberto(false)} />
    </>
  )
}
