/**
 * Blocos de apresentação compartilhados pelas telas de **Consulta**,
 * **Classificação**, **Calculadora** e **SPED**.
 *
 * Nenhum componente aqui decide regra de negócio: eles apenas *decoram*
 * um `Classificacao`/`Observacao` já resolvido pelas camadas de domínio e
 * aplicação (Clean Code — apresentação pura).
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ANEXO_LABELS } from '@/domain/constants/tributarios'
import { urlLegislacaoComAncora } from '@/domain/legislacao'
import type {
  Classificacao,
  NomenclaturaNcm,
  Observacao,
} from '@/domain/entities'
import {
  avisoInNatura,
  badgeReducao,
  calcularTributos,
  observacaoTipoAliquota,
  observacoesDiferimento,
  observacoesLegais,
} from '@/domain/services/calculo'
import { chipCondicao, isNcmExtinto, observacaoExtincaoNcm, observacaoVigenciaCct } from '@/domain/services/classificacao'
import { observacaoRevogacao } from '@/domain/services/revogacao'
import { fmtMoeda, fmtNcm, parseMoeda } from '@/domain/services/format'
import { useCalculadora } from '@/store/calculadora'
import { AnexoBadge, Btn, Pill, Texto, type CorPill } from './kit'
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

/** Selo de reclassificação manual — responsabilidade do usuário, isenta o sistema. */
export function PillManual() {
  return <Pill cor="amber">✋ Manual · usuário</Pill>
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
      <div className="font-bold">✋ Classificação manual — responsabilidade do usuário</div>
      <div className="mt-1 leading-relaxed">
        Esta classificação foi definida manualmente e <strong>isenta o sistema</strong> de
        responsabilidade sobre o enquadramento.
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
 * Aviso de diferimento (Anexo IX incluso) — mesmo padrão dos demais textos
 * informativos. Retorna `null` quando a classificação não é diferida.
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
  const carga = base > 0 ? c.carga : rateIBS + rateCBS
  const pct2 = (n: number) => n.toFixed(2).replace('.', ',')
  const temReducao = (Number(redIBS) || 0) > 0 || (Number(redCBS) || 0) > 0
  const zerada = temReducao && base > 0 && c.aliqIBS < 0.005 && c.aliqCBS < 0.005
  const aliqIguais = Math.abs(c.aliqIBS - c.aliqCBS) < 0.005

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">🧮</span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Simulador
        </h4>
        {zerada ? (
          <span className="pill ml-auto bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Alíquota zero
          </span>
        ) : temReducao ? (
          <span className="ml-auto font-mono text-[10px] text-slate-500" title="Alíquota de referência já com a redução aplicada; BC = valor cheio da operação">
            Alíq. {aliqIguais ? `${pct2(c.aliqIBS)}%` : `${pct2(c.aliqIBS)}% / ${pct2(c.aliqCBS)}%`}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Valor da operação (R$)</span>
          <Texto
            mask="moeda"
            inputMode="decimal"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="R$ 0,00"
            className="field-sm num-input field-mono"
          />
        </label>
        <div className="space-y-1 rounded-lg bg-white p-3 shadow-sm dark:bg-slate-900">
          <LinhaSim rotulo="IBS" taxa={pct2(c.aliqIBS)} valor={fmtMoeda(c.vIBS)} />
          <LinhaSim rotulo="CBS" taxa={pct2(c.aliqCBS)} valor={fmtMoeda(c.vCBS)} />
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-xs font-bold dark:border-slate-700">
            <span>Total</span>
            <span className="font-mono text-emerald-700 dark:text-emerald-400">
              {fmtMoeda(c.total)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>Carga efetiva</span>
            <span className="font-mono">{pct2(carga)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LinhaSim({ rotulo, taxa, valor }: { rotulo: string; taxa: string; valor: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-600 dark:text-slate-400">
        {rotulo} <span className="text-slate-400">({taxa}%)</span>
      </span>
      <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{valor}</span>
    </div>
  )
}

/* ----------------------------------------------------------- caixa de dados */

function Dado({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/40">
      <div className="text-[10px] font-bold uppercase text-slate-500">{rotulo}</div>
      <div className="font-mono text-sm font-bold">{valor}</div>
      {sub ? <div className="truncate text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  )
}

/* ------------------------------------------------- cartão: classificação --- */

export function CartaoClassificacao({
  cl,
  indice,
  total,
  compact = false,
  nomenclatura,
  bloqueios,
  onSalvar,
  onAddCalc,
}: {
  cl: Classificacao
  indice: number
  total: number
  compact?: boolean
  /** Nomenclatura vigente — quando extinta, exibe o aviso "negado". */
  nomenclatura?: NomenclaturaNcm | null
  /** Permitido × negado por DFe (tabela CFF local). Ausente = sem cobertura. */
  bloqueios?: BloqueioSistema[] | null
  onSalvar?: () => void
  onAddCalc?: () => void
}) {
  const r = cl.resumo
  const cct = cl.cstClassTribDetalhes
  const redIBS = Number(r.percentualReducaoIBS ?? cct?.pRedIBS ?? 0)
  const redCBS = Number(r.percentualReducaoCBS ?? cct?.pRedCBS ?? 0)
  const anexo = r.anexo ?? cl.referencia?.anexo ?? null
  const url = r.urlLegislacao ?? cl.referencia?.urlLegislacao ?? null
  const lc = cct?.lcRef || cl.baseLegal || ''
  const redacao = cct?.lcRedacao
  const ehManual = cl.manual != null
  const temVigenciaCct = Boolean(cct?.inicioVigencia || cct?.fimVigencia)
  // Textos informativos: diferimento SEMPRE primeiro (Anexo IX incluso).
  // Tipo uniforme/fixo substitui a fundamentação por faixa (o artigo da faixa
  // seria o do regime padrão — errado para CST 010/011). Prouni/misto precisa
  // das duas reduções (art. 308 só aparece com redCBS).
  const obsDiferimento = observacoesDiferimento(cl)
  const obsTipo = observacaoTipoAliquota(cct?.tipoAliquota)
  const obsLegais = observacoesLegais(cl.codigo, redIBS, redCBS)
  const obsRev = observacaoRevogacao(cl.revogado)
  const observacoes = [...(obsRev ? [obsRev] : []), ...obsDiferimento, ...(obsTipo ? [obsTipo] : obsLegais)]

  return (
    <div className="panel animate-fade-up card-hover p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill cor="slate">
          Opção {indice + 1}/{total}
        </Pill>
        {anexo ? <AnexoBadge anexo={anexo} /> : null}
        <BadgesReducao redIBS={redIBS} redCBS={redCBS} />
        {cl.regraGeral ? <Pill cor="amber">⚠ Regra geral</Pill> : null}
        {ehManual ? <PillManual /> : null}
        {isNcmExtinto(nomenclatura) ? <Pill cor="red">⛔ NCM extinto</Pill> : null}
        {cl.revogado ? <Pill cor="red">⛔ Revogado</Pill> : null}
        {temVigenciaCct ? <Pill cor="amber">⏳ Vigência cClassTrib</Pill> : null}
        {bloqueios?.some((b) => b.permitido === false) ? <Pill cor="red">⛔ Negado em DFe</Pill> : null}
      </div>

      {isNcmExtinto(nomenclatura) ? (
        <div className="mb-3">
          <AvisoNcmExtinto nomenclatura={nomenclatura} />
        </div>
      ) : null}

      {temVigenciaCct ? (
        <div className="mb-3">
          <AvisoVigenciaCct cct={cct} />
        </div>
      ) : null}

      {ehManual ? (
        <div className="mb-3">
          <AvisoManual fonteDescricao={cl.manual?.fonteDescricao} fonteUrl={cl.manual?.fonteUrl} />
        </div>
      ) : null}

      <div className="mb-3">
        <div className="font-mono text-2xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
          {cl.codigoFormatado || fmtNcm(cl.codigo)}
        </div>
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{cl.descricao || '—'}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Dado rotulo="CST" valor={cl.cst || '000'} sub={cl.cstDetalhes?.descricao} />
        <Dado rotulo="cClassTrib" valor={cl.cClassTrib || '000001'} />
        <div className="col-span-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/40">
          <div className="text-[10px] font-bold uppercase text-slate-500">Classificação</div>
          <div className="text-xs font-semibold">{r.descricaoCClassTrib || cl.baseLegal || '—'}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <ChipCondicao rotulo="Redução alíquota" valor={cl.referencia?.reducaoAliquota ?? cl.cstDetalhes?.indReducao} />
        <ChipCondicao rotulo="Redução BC" valor={cl.referencia?.reducaoBcCst ?? cct?.indRedutorBC} />
        <ChipCondicao rotulo="Monofásica" valor={cl.referencia?.monofasica ?? (cct?.indMono === 1 ? 1 : 0)} />
        <ChipCondicao rotulo="Crédito presumido" valor={cl.referencia?.creditoPresumido ?? (cct?.indCredPres === 1 ? 1 : 0)} />
      </div>

      <DocsHabilitados docs={r.documentosHabilitados ?? cl.referencia?.documentos} />

      {!compact ? <SelosPorSistema bloqueios={bloqueios} /> : null}

      {!compact ? (
        <div className="mt-3">
          <ListaObservacoes itens={observacoes} />
        </div>
      ) : null}

      {!compact ? <SimuladorRapido redIBS={redIBS} redCBS={redCBS} /> : null}

      {onSalvar || onAddCalc ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onSalvar ? (
            <Btn variante="primary" tam="sm" onClick={onSalvar}>
              💾 Salvar como produto
            </Btn>
          ) : null}
          {onAddCalc ? (
            <Btn tam="sm" onClick={onAddCalc}>
              🧮 Adicionar à calculadora
            </Btn>
          ) : null}
        </div>
      ) : null}

      {!compact && redacao ? (
        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/40">
          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300">
            📖 Redação legal — {lc || 'LC 214/2025'}
          </summary>
          <pre className="whitespace-pre-wrap border-t border-slate-200 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {redacao}
          </pre>
        </details>
      ) : null}

      {!compact && url ? (
        <div className="mt-3">
          <BotaoVerLegislacao
            url={url}
            titulo={lc ? `Redação legal — ${lc}` : 'Legislação — trecho citado'}
            referencia={lc}
            texto={redacao ?? r.descricaoCClassTrib ?? null}
            rotulo="Visualizar legislação no trecho citado"
            className="text-xs font-semibold text-brand-600 hover:underline dark:text-aurum-200 cursor-pointer"
          />
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------- cartão: tributação integral --- */

/**
 * Cartão "sem classificação específica" (regra geral).
 *
 * É o **único** lugar onde aparece o aviso *in natura* (Art. 137) — SPEC D04.
 */
export function CartaoTributacaoIntegral({
  cl,
  nomenclatura,
  bloqueios,
  onSalvar,
  onAddCalc,
  onReclassificar,
}: {
  cl: Classificacao
  nomenclatura: NomenclaturaNcm | null
  /** Permitido × negado por DFe (tabela CFF local). Ausente = sem cobertura. */
  bloqueios?: BloqueioSistema[] | null
  onSalvar?: () => void
  onAddCalc?: () => void
  /** Aberto somente quando não há classificação específica (caso regra geral). */
  onReclassificar?: () => void
}) {
  const cct = cl.cstClassTribDetalhes
  const cstDet = cl.cstDetalhes
  const aviso = avisoInNatura(cl.codigo)
  const codigo = nomenclatura?.codigoOriginal || nomenclatura?.codigo || cl.codigo
  const descricao = nomenclatura?.descricao || cl.descricao || 'NCM não localizado na nomenclatura vigente.'
  const docs = cstDet?.docs
  const temVigenciaCct = Boolean(cct?.inicioVigencia || cct?.fimVigencia)
  const obsRevIntegral = observacaoRevogacao(cl.revogado)
  const extinto = isNcmExtinto(nomenclatura)

  return (
    <div className="animate-fade-up overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-card dark:border-amber-800 dark:bg-slate-900">
      <div className="border-b border-amber-200 bg-gradient-to-r from-amber-50 to-white px-5 py-4 dark:border-amber-900 dark:from-amber-950/40 dark:to-slate-900">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Pill cor="amber">⚠ Sem classificação específica</Pill>
          <Pill cor="red">⚡ Alíquota cheia</Pill>
          {extinto ? <Pill cor="red">⛔ NCM extinto</Pill> : null}
          {cl.revogado ? <Pill cor="red">⛔ Revogado</Pill> : null}
          {temVigenciaCct ? <Pill cor="amber">⏳ Vigência cClassTrib</Pill> : null}
          {bloqueios?.some((b) => b.permitido === false) ? <Pill cor="red">⛔ Negado em DFe</Pill> : null}
        </div>
        <div className="font-mono text-2xl font-black tracking-tight">{fmtNcm(codigo)}</div>
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{descricao}</div>
        {nomenclatura?.ato ? (
          <div className="mt-1 text-[10px] text-slate-500">📎 {nomenclatura.ato}</div>
        ) : null}
      </div>

      <div className="space-y-4 p-5">
        {extinto ? <AvisoNcmExtinto nomenclatura={nomenclatura} /> : null}
        {obsRevIntegral ? <ListaObservacoes itens={[obsRevIntegral]} /> : null}
        {temVigenciaCct ? <AvisoVigenciaCct cct={cct} /> : null}
        {aviso ? (
          <div className="animate-fade-up rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-bold">
              <span className="text-base">🌿</span>
              <span>Atenção: Produto potencialmente &quot;in natura&quot;</span>
            </div>
            <p className="leading-relaxed">{aviso.texto}</p>
            {aviso.adendo ? (
              <p className="mt-2 leading-relaxed">{aviso.adendo}</p>
            ) : null}
            <BotaoVerLegislacao
              url={aviso.link}
              titulo={aviso.titulo}
              referencia={aviso.titulo}
              texto={aviso.texto}
              rotulo={aviso.rotuloLink ?? 'Visualizar legislação'}
              className="mt-2 inline-flex items-center gap-1 font-semibold text-amber-800 underline hover:text-amber-950 dark:text-amber-300 cursor-pointer"
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Dado rotulo="CST" valor={cstDet?.codigo || '000'} sub={cstDet?.descricao} />
          <Dado rotulo="cClassTrib" valor={cct?.cClassTrib || '000001'} />
          <div className="col-span-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/40">
            <div className="text-[10px] font-bold uppercase text-slate-500">Classificação</div>
            <div className="text-xs font-semibold">{cct?.nome || cct?.descricao || '—'}</div>
          </div>
        </div>

        <SimuladorRapido redIBS={0} redCBS={0} />

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="mb-1 font-bold">ℹ Regra geral da LC 214/2025</div>
          <div>
            Aplica-se <strong>tributação integral</strong>: alíquota cheia de IBS/CBS.
          </div>
        </div>

        <DocsHabilitados docs={docs} />

        <SelosPorSistema bloqueios={bloqueios} />

        {onSalvar || onAddCalc || onReclassificar ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {onSalvar ? (
              <Btn variante="primary" tam="sm" onClick={onSalvar}>
                💾 Salvar como produto (regra geral)
              </Btn>
            ) : null}
            {onAddCalc ? (
              <Btn tam="sm" onClick={onAddCalc}>
                🧮 Adicionar à calculadora
              </Btn>
            ) : null}
            {onReclassificar ? (
              <Btn variante="primary" tam="sm" onClick={onReclassificar}>
                ✋ Reclassificar manualmente
              </Btn>
            ) : null}
          </div>
        ) : null}
        {onReclassificar ? (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Sem enquadramento oficial para este NCM? Reclassifique com uma regra específica,
            informando a descrição e o link da legislação — a escolha passa a valer nas
            importações de XML, SPED e lote, sinalizada como manual (responsabilidade sua).
          </p>
        ) : null}
      </div>
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

/** Rótulo legível de um anexo derivado. */
export const rotuloAnexo = (anexo: string): string => ANEXO_LABELS[anexo] ?? ANEXO_LABELS.isento

/** Observações legais de um item (SPED) — reexportado para conveniência. */
export const observacoesDe = observacoesLegais
