/**
 * Blocos de apresentação compartilhados pelas telas de **Consulta**,
 * **Classificação**, **Calculadora** e **SPED**.
 *
 * Nenhum componente aqui decide regra de negócio: eles apenas *decoram*
 * um `Classificacao`/`Observacao` já resolvido pelas camadas de domínio e
 * aplicação (Clean Code — apresentação pura).
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { urlLegislacaoComAncora } from '@/domain/legislacao'
import type {
  Classificacao,
  NomenclaturaNcm,
  Observacao,
} from '@/domain/entities'
import {
  badgeReducao,
  calcularTributos,
  observacoesDiferimento,
} from '@/domain/services/calculo'
import { chipCondicao, observacaoExtincaoNcm, observacaoIntegralFallback, observacaoVigenciaCct } from '@/domain/services/classificacao'
import { fmtMoeda, parseMoeda } from '@/domain/services/format'
import { useCalculadora } from '@/store/calculadora'
import { Pill, Texto, type CorPill } from './kit'
import { ModalLegislacao, type DestinoLegislacao } from './ModalLegislacao'

/* --------------------------------------------------------------- helpers -- */

const COR_BADGE: Record<string, CorPill> = { red: 'red', amber: 'amber', emerald: 'emerald' }

const RE_DOC = /^(NFe|NFCe|CTe|CTeOS|BPe|BPeTM|NF3e|NFCom|NFSe|NFAg|NFGas|BPeTA|NFSVIA|NFABI|DERE|DIR|DUIMP)$/i

function docsLigados(docs: unknown): string[] {
  if (!docs || typeof docs !== 'object') return []
  return Object.entries(docs as Record<string, unknown>)
    .filter(([k, v]) => RE_DOC.test(k) && (v === true || String(v).toLowerCase() === 'sim'))
    .map(([k]) => k)
}

/* --------------------------------------------------------------- chips ---- */

/** Chip Sim/Não/ausente usado nos cartões (SPEC `chipCondicao`). */
export function ChipCondicao({ rotulo, valor }: { rotulo: string; valor: unknown }) {
  const on = chipCondicao(valor)
  if (on === null) return null
  return (
    <Pill cor={on ? 'emerald' : 'slate'}>
      {on ? '✓' : '—'} {rotulo}
    </Pill>
  )
}

/** Documentos fiscais habilitados pela classificação. */
export function DocsHabilitados({ docs }: { docs: unknown }) {
  const ligados = docsLigados(docs)
  if (!ligados.length) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 self-center text-[10px] font-bold uppercase text-slate-500">Docs:</span>
      {ligados.map((k) => (
        <Pill cor="brand" key={k}>
          {k}
        </Pill>
      ))}
    </div>
  )
}

/** Selo de reclassificação manual — feita pelo usuário, não pelo sistema. */
export function PillManual() {
  return <Pill cor="amber">👤 Classificado por você</Pill>
}

/**
 * Aviso de NCM extinto ("negado" na tabela vigente).
 * O NCM saiu da TEC (Data_Fim preenchida) e passa a ser tributado por outro
 * código — o vínculo/regra geral abaixo é referência histórica, não vigente.
 */
export function AvisoNcmExtinto({ nomenclatura }: { nomenclatura: NomenclaturaNcm | null | undefined }) {
  const obs = observacaoExtincaoNcm(nomenclatura)
  if (!obs) return null
  return <ListaObservacoes itens={[obs]} />
}

/**
 * Aviso de vigência do cClassTrib (`dIniVig/dFimVig` da base CFF).
 * `null` quando vigente ou sem datas (caso comum atual).
 */
export function AvisoVigenciaCct({
  cct,
}: {
  cct: Pick<import('@/domain/entities').TabelaCstClassTrib, 'cClassTrib' | 'inicioVigencia' | 'fimVigencia'> | null | undefined
}) {
  const obs = observacaoVigenciaCct(cct)
  if (!obs) return null
  return <ListaObservacoes itens={[obs]} />
}

/**
 * Legenda do fallback integral multi-opção (cor `slate`, distinta).
 *
 * Exibida ACIMA do cartão de tributação integral anexado como última opção
 * de um NCM com 2+ enquadramentos oficiais: "Não se encaixa nessa
 * qualificação? Aplique a tributação integral".
 */
export function AvisoIntegralFallback({ cl }: { cl: Pick<Classificacao, 'integralFallback'> | null | undefined }) {
  const obs = observacaoIntegralFallback(cl)
  if (!obs) return null
  return <ListaObservacoes itens={[obs]} />
}

/**
 * Selo de anexos oficiais do código — só renderiza quando a tabela de anexos
 * cita o NCM (8 dígitos) ou o NBS (9 dígitos). Descoberta para abrir o
 * detalhe. Carrega sozinho do SQLite.
 */
export function PillAnexos({ ncm, codigo }: { ncm?: string; codigo?: string }) {
  const alvo = codigo ?? ncm ?? ''
  const [total, setTotal] = useState<number | null>(null)
  const [negado, setNegado] = useState(false)
  useEffect(() => {
    let vivo = true
    const cod = String(alvo ?? '').replace(/\D/g, '')
    const ehNbs = cod.length === 9
    if (cod.length !== 8 && !ehNbs) {
      setTotal(null)
      return
    }
    void (async () => {
      try {
        const { anexosDoCodigo } = await import('@/infrastructure/base/info-adicional')
        const linhas = await anexosDoCodigo(cod)
        if (!vivo) return
        setTotal(linhas.length || null)
        setNegado(linhas.some((l) => l.permissao === 'negado'))
      } catch {
        if (vivo) setTotal(null)
      }
    })()
    return () => {
      vivo = false
    }
  }, [alvo])
  if (!total) return null
  const codLimpo = String(alvo ?? '').replace(/\D/g, '')
  const rotulo = codLimpo.length === 9 ? 'NBS' : 'NCM'
  return (
    <span className="mt-2 flex flex-wrap gap-1.5" title={`${total} linha(s) da tabela oficial de anexos citam este ${rotulo} — veja em Detalhes fiscais`}>
      <Pill cor={negado ? 'red' : 'slate'}>
        {negado ? '⛔' : '📎'} {total} anexo{total > 1 ? 's' : ''}
      </Pill>
    </span>
  )
}

/** Bloqueio por sistema vindo da tabela CFF (`classificacaoProduto`). */
export interface BloqueioSistema {
  sistema: string
  permitido: boolean | null
  sincronizadoEm: string
}

/**
 * Selos permitido × negado por DFe (NFCom/NFAg/NF3e/NFGas).
 * Só renderiza quando há cobertura local; sistemas sem dados não afirmam nada.
 * Negado (`permitido === false`) vira selo vermelho — o cClassTrib não pode
 * ser usado naquele documento.
 */
export function SelosPorSistema({ bloqueios }: { bloqueios?: BloqueioSistema[] | null }) {
  if (!bloqueios?.length) return null
  const negados = bloqueios.filter((b) => b.permitido === false)
  const permitidos = bloqueios.filter((b) => b.permitido !== false)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 self-center text-[10px] font-bold uppercase text-slate-500">DFe:</span>
      {negados.map((b) => (
        <span key={b.sistema} title={`Negado em ${b.sistema} — tabela CFF de ${new Date(b.sincronizadoEm).toLocaleDateString('pt-BR')}`}>
          <Pill cor="red">⛔ {b.sistema}</Pill>
        </span>
      ))}
      {permitidos.map((b) => (
        <span key={b.sistema} title={`Permitido em ${b.sistema} — tabela CFF de ${new Date(b.sincronizadoEm).toLocaleDateString('pt-BR')}`}>
          <Pill cor="emerald">✓ {b.sistema}</Pill>
        </span>
      ))}
    </div>
  )
}

/** Aviso de isenção exibido sempre que a classificação veio do usuário. */
export function AvisoManual({
  fonteDescricao,
  fonteUrl,
  compact = false,
}: {
  fonteDescricao?: string | null
  fonteUrl?: string | null
  compact?: boolean
}) {
  return (
    <div
      className={`rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 ${compact ? 'p-2 text-[11px]' : 'p-3 text-xs'}`}
    >
      <div className="font-bold">👤 Classificação feita por você (manual) — responsabilidade sua, não do sistema</div>
      <div className="mt-1 leading-relaxed">
        Este enquadramento foi definido manualmente por você e o sistema apenas o aplicou —{' '}
        <strong>não foi o sistema que classificou</strong>.
        {fonteDescricao ? (
          <>
            {' '}Fonte informada: <strong>{fonteDescricao}</strong>.
          </>
        ) : null}
      </div>
      {fonteUrl ? (
        <a
          href={fonteUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 font-semibold underline"
        >
          ↗ Abrir fonte informada
        </a>
      ) : null}
    </div>
  )
}
/** Badges de redução IBS e CBS lado a lado. */
export function BadgesReducao({ redIBS, redCBS }: { redIBS: number; redCBS: number }) {
  return (
    <>
      {([redIBS, redCBS] as const).map((v, i) => {
        const b = badgeReducao(v)
        return (
          <Pill cor={COR_BADGE[b.cor] ?? 'slate'} key={i}>
            {b.rotulo}
          </Pill>
        )
      })}
    </>
  )
}

/** Observações legais (Art. 128/135/137/133/139) em cartões de aviso. */
export function ListaObservacoes({ itens }: { itens: Observacao[] }) {
  if (!itens.length) return null
  const borda = {
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100',
    slate: 'border-slate-200 bg-slate-50/70 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200',
    violet: 'border-violet-300 bg-violet-50/80 text-violet-950 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100',
    red: 'border-red-300 bg-red-50/80 text-red-950 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100',
  } as const
  return (
    <div className="space-y-3">
      {itens.map((o, i) => (
        <div key={i} className={`rounded-xl border p-3 text-xs ${borda[o.cor]}`}>
          <div className="font-bold">{o.titulo}</div>
          <div className="mt-1 leading-relaxed">{o.texto}</div>
          {o.adendo ? <div className="mt-2 leading-relaxed opacity-90">{o.adendo}</div> : null}
          {o.link ? (
            <BotaoVerLegislacao
              url={o.link}
              titulo={o.titulo}
              texto={o.texto}
              rotulo={o.rotuloLink ?? 'Visualizar legislação'}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

/**
 * Aviso de diferimento — diferimento efetivo (violeta) ou Anexo IX
 * condicional (âmbar, "verificar a operação"). Retorna `null` quando a
 * classificação não é diferida nem condicionalmente diferível.
 * Reutilizado em Produtos, SPED, NF-e e Lote.
 */
export function AvisoDiferimento({ cl }: { cl: Classificacao }) {
  const obs = observacoesDiferimento(cl)
  if (!obs.length) return null
  return <ListaObservacoes itens={obs} />
}

/**
 * Botão "Visualizar legislação" — abre o modal ancorado no artigo citado.
 *
 * Usado em todos os cartões (Consulta, SPED, NF-e). A URL final resolve a
 * âncora (`#artNNN`) a partir do título/referência, então o `iframe` do modal
 * já abre com `scroll` no trecho exato. O modal oferece "Abrir em nova aba"
 * para leitura integral.
 */
export function BotaoVerLegislacao({
  url,
  titulo,
  referencia,
  texto,
  rotulo = 'Visualizar legislação',
  className = 'mt-2 inline-flex items-center gap-1 font-semibold underline cursor-pointer',
}: {
  url?: string | null
  titulo?: string | null
  referencia?: string | null
  /** Trecho citado (ex.: texto da observação) — exibido com marca-texto no modal. */
  texto?: string | null
  rotulo?: string
  className?: string
}) {
  const [destino, setDestino] = useState<DestinoLegislacao | null>(null)
  if (!url) return null
  const final = urlLegislacaoComAncora(url, referencia ?? titulo ?? '') ?? url
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setDestino({ url: final, titulo: titulo || 'Legislação', texto: texto ?? null })}
        title={`${rotulo} — abre no trecho citado`}
      >
        📖 {rotulo}
      </button>
      <ModalLegislacao destino={destino} onFechar={() => setDestino(null)} />
    </>
  )
}

/* ------------------------------------------------------- simulador rápido -- */

/**
 * Simulador embutido nos cartões (SPEC R7.14).
 *
 * Usa **as alíquotas de referência da Calculadora** (paridade com a v1) —
 * os relatórios, por outro lado, usam `REF_DEFAULT` fixo (correção do
 * `[BUG] L973`).
 */
export function SimuladorRapido({ redIBS, redCBS }: { redIBS: number; redCBS: number }) {
  const rateIBS = useCalculadora((s) => s.rateIBS)
  const rateCBS = useCalculadora((s) => s.rateCBS)
  const [texto, setTexto] = useState('')

  const base = parseMoeda(texto)
  const c = calcularTributos(base, redIBS, redCBS, rateIBS, rateCBS)
  const carga = c.base > 0 ? c.carga : rateIBS + rateCBS
  const pct2 = (n: number) => n.toFixed(2).replace('.', ',')
  const temReducao = (Number(redIBS) || 0) > 0 || (Number(redCBS) || 0) > 0
  const zerada = temReducao && c.base > 0 && c.aliqIBS < 0.005 && c.aliqCBS < 0.005
  const aliqIguais = Math.abs(c.aliqIBS - c.aliqCBS) < 0.005
  const totalTributos = c.total
  const totalGeral = c.base + c.total
  const pctIBS = totalTributos > 0 ? (c.vIBS / totalTributos) * 100 : 50
  const ativo = c.base > 0

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)]">
      <div className="flex items-center gap-2 bg-gradient-to-r from-brand-50/90 to-white px-4 py-2.5 dark:from-brand-950/40 dark:to-slate-900">
        <span className="calc-step">
          <span className="calc-step-dot">R$</span> Simulador rápido
        </span>
        {zerada ? (
          <span className="pill ml-auto bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Alíquota zero
          </span>
        ) : temReducao ? (
          <span className="ml-auto font-mono text-[10px] text-slate-500" title="Alíquota de referência já com a redução aplicada; BC = valor cheio da operação">
            Alíq. {aliqIguais ? `${pct2(c.aliqIBS)}%` : `${pct2(c.aliqIBS)}% / ${pct2(c.aliqCBS)}%`}
          </span>
        ) : (
          <span className="ml-auto font-mono text-[10px] text-slate-400" title="Sem redução — alíquota cheia de referência">
            Alíq. cheia {pct2(rateIBS + rateCBS)}%
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <label className="block">
          <span className="field-label">Valor da operação (R$)</span>
          <Texto
            mask="moeda"
            inputMode="decimal"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="R$ 1.000,00"
            className="field-lg num-input field-mono"
            aria-label="Valor da operação para simular"
          />
          <span className="mt-1.5 block text-[10px] leading-relaxed text-slate-400">
            {ativo
              ? `Base ${fmtMoeda(c.base)} · carga ${pct2(carga)}% sobre a operação`
              : 'Digite um valor — o cálculo é instantâneo, sem salvar nada.'}
          </span>
        </label>
        <div className={`rounded-xl p-3 transition-colors ${ativo ? 'calc-hero' : 'bg-slate-50 dark:bg-slate-950/40 border border-dashed border-slate-300 dark:border-slate-700'}`}>
          {!ativo ? (
            <div className="grid h-full min-h-[5.5rem] place-items-center text-center text-[11px] text-slate-400">
              <span>◌ Aguardando valor<br />para estimar IBS/CBS</span>
            </div>
          ) : (
            <>
              <div className="calc-bar" aria-hidden="true">
                <span className="calc-bar-ibs" style={{ width: `${pctIBS}%` }} />
                <span className="calc-bar-cbs" style={{ width: `${100 - pctIBS}%` }} />
              </div>
              <div className="mt-2 space-y-1">
                <LinhaSim rotulo="Valor do IBS" taxa={pct2(c.aliqIBS)} valor={fmtMoeda(c.vIBS)} claro />
                <LinhaSim rotulo="Valor da CBS" taxa={pct2(c.aliqCBS)} valor={fmtMoeda(c.vCBS)} claro />
              </div>
              <div className="mt-2 flex items-end justify-between border-t border-white/20 pt-2">
                <span className="calc-hero-rotulo">Total operação + tributos</span>
                <span className="calc-hero-valor text-xl text-white">
                  {fmtMoeda(totalGeral)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-white/70">
                <span>Tributos {fmtMoeda(totalTributos)} · Carga efetiva</span>
                <span className="font-mono font-bold">{pct2(carga)}%</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function LinhaSim({ rotulo, taxa, valor, claro }: { rotulo: string; taxa: string; valor: string; claro?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className={claro ? 'text-white/75' : 'text-slate-600 dark:text-slate-400'}>
        {rotulo} <span className={claro ? 'text-white/50' : 'text-slate-400'}>({taxa}%)</span>
      </span>
      <span className={`font-mono font-bold ${claro ? 'text-white' : 'text-brand-700 dark:text-aurum-200'}`}>{valor}</span>
    </div>
  )
}

/* ----------------------------------------------------------- zona de arquivo */

/** Área de arrastar-e-soltar usada pelas telas de Lote e SPED. */
export function ZonaArquivo({
  onArquivo,
  accept,
  rotulo,
  dica,
  desabilitada,
  icone = '📄',
}: {
  onArquivo: (f: File) => void
  accept: string
  rotulo: string
  dica: string
  desabilitada?: boolean
  icone?: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSobre(false)
    if (desabilitada) return
    const f = e.dataTransfer.files?.[0]
    if (f) onArquivo(f)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !desabilitada && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !desabilitada) inputRef.current?.click()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!desabilitada) setSobre(true)
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={soltar}
      className={`group cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all disabled:cursor-not-allowed ${
        sobre
          ? 'border-brand-500 bg-brand-50/70'
          : 'border-slate-300 bg-slate-50 hover:border-brand-500 hover:bg-brand-50/50 dark:border-slate-700 dark:bg-slate-950/40'
      } ${desabilitada ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onArquivo(f)
          e.target.value = ''
        }}
      />
      <div className="mx-auto grid place-items-center transition-transform group-hover:scale-110">
        {typeof icone === 'string' ? (
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-2xl shadow-card dark:bg-slate-800">
            {icone}
          </span>
        ) : (
          icone
        )}
      </div>
      <p className="mt-3 text-sm font-semibold">
        {rotulo} <span className="text-brand-600 dark:text-aurum-200">clique para escolher</span>
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{dica}</p>
    </div>
  )
}

/* --------------------------------------------------------------- cartões --- */

/** Cartão de estatística usado nos painéis de SPED/base. */
export function CartaoStat({
  rotulo,
  valor,
  cor = '',
  sub,
}: {
  rotulo: string
  valor: ReactNode
  cor?: string
  sub?: string
}) {
  return (
    <div className="sped-summary-card panel p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className={`text-lg font-black ${cor}`}>{valor}</div>
      {sub ? <div className="text-[10px] text-slate-400">{sub}</div> : null}
    </div>
  )
}

