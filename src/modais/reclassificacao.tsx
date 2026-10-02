/**
 * Modal **Reclassificar manualmente** (page-owned, como `ModalSalvarClass`).
 *
 * Aberto a partir do cartão de regra geral (NCM sem classificação específica)
 * ou do cartão manual (editar/remover a vigente). O usuário escolhe uma das
 * classificações existentes no sistema (auxílio), informa descrição + fonte +
 * link da legislação, e a escolha passa a valer para o NCM em TODAS as telas
 * (consulta, XML, SPED, lote, produtos, calculadora) — acima da base oficial,
 * sempre sinalizada como manual (responsabilidade do usuário, isentando o sistema).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NomenclaturaNcm } from '@/domain/entities'
import { fmtNcm, fmtPct, norm } from '@/domain/services/format'
import { propagarClassificacaoNcm } from '@/application/reclassificacao'
import {
  buscarReclassificacaoManual,
  listarClassificacoesExistentes,
  removerReclassificacaoManual,
  salvarReclassificacaoManual,
  type OpcaoClassificacaoExistente,
} from '@/infrastructure/base/reclassificacao-repo'
import { toast } from '@/store/ui'
import { AvisoManual } from '@/ui/cartoes'
import { Btn, Campo, Modal, Pill, Texto, Area } from '@/ui/kit'

/**
 * Lazy loading do dropdown: renderiza em lotes para não travar com centenas
 * de classificações, mas sempre permite alcançar TODOS os resultados
 * (scroll carrega mais — nunca corta em 8 nem pede para "refinar a busca").
 */
const LOTE_SUGESTOES = 30

/** Minúsculas, sem acento e sem `%` — assim "monofasica", "60%" e "60" alcançam o mesmo registro. */
function normalizarBusca(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/%/g, '')
}

/** Todo o texto pesquisável da opção: CST, cClassTrib, nome, reduções, anexo e base legal. */
function textoOpcao(o: OpcaoClassificacaoExistente): string {
  const reds = [o.pRedIBS ?? 0, o.pRedCBS ?? 0]
    .map((v) => {
      const n = Number(v) || 0
      return `${n} ${n.toFixed(0)} ${n.toFixed(2).replace('.', ',')} ${n.toFixed(2)}`
    })
    .join(' ')
  const anexo = o.anexo ? `anexo ${o.anexo}` : ''
  return normalizarBusca(
    `${o.cst} ${o.cClassTrib} ${o.nome} ${o.descricao} ${o.lcRef ?? ''} ${reds} ${anexo}`,
  )
}

export function ModalReclassificacao({
  aberto,
  ncm,
  nomenclatura,
  onFechar,
  onSalvo,
}: {
  aberto: boolean
  /** NCM de 8 dígitos (com ou sem máscara). */
  ncm: string
  nomenclatura: NomenclaturaNcm | null
  onFechar: () => void
  /** Chamado após salvar/excluir para a tela recarregar a classificação vigente. */
  onSalvo: () => void
}) {
  const codigo = norm(ncm)
  const [opcoes, setOpcoes] = useState<OpcaoClassificacaoExistente[]>([])
  const [carregando, setCarregando] = useState(false)
  const [busca, setBusca] = useState('')
  const [opcaoId, setOpcaoId] = useState('')
  const [focoBusca, setFocoBusca] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const [visiveis, setVisiveis] = useState(LOTE_SUGESTOES)
  const listaRef = useRef<HTMLDivElement>(null)
  const sentinelaRef = useRef<HTMLDivElement>(null)
  const [descricao, setDescricao] = useState('')
  const [fonteDescricao, setFonteDescricao] = useState('')
  const [fonteUrl, setFonteUrl] = useState('')
  const [temManual, setTemManual] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setBusca('')
    setOpcaoId('')
    setFocoBusca(false)
    setAtivo(0)
    setVisiveis(LOTE_SUGESTOES)
    setDescricao('')
    setFonteDescricao('')
    setFonteUrl('')
    setTemManual(false)
    setCarregando(true)
    void (async () => {
      try {
        const [lista, manual] = await Promise.all([
          listarClassificacoesExistentes(),
          buscarReclassificacaoManual(codigo),
        ])
        setOpcoes(lista)
        if (manual) {
          setTemManual(true)
          setOpcaoId(`${manual.cst}|${manual.cClassTrib}`)
          setBusca(`${manual.cst} · ${manual.cClassTrib}`)
          setDescricao(manual.descricao)
          setFonteDescricao(manual.fonteDescricao)
          setFonteUrl(manual.fonteUrl)
        }
      } catch (e) {
        toast(`Erro ao carregar classificações: ${e instanceof Error ? e.message : String(e)}`, 'err')
      } finally {
        setCarregando(false)
      }
    })()
  }, [aberto, codigo])

  /**
   * Todas as coincidências da pesquisa: cada termo digitado (CST, cClassTrib,
   * % de redução, anexo ou palavra do nome) precisa aparecer no registro —
   * assim "200", "60", "anexo 1" ou "220 mono" afunilam. Sem termo, retorna
   * TODAS as classificações (o lazy loading pagina na renderização).
   */
  const coincidencias = useMemo(() => {
    const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean)
    if (!termos.length) return opcoes
    return opcoes.filter((o) => {
      const base = textoOpcao(o)
      return termos.every((t) => base.includes(t))
    })
  }, [opcoes, busca])

  const totalFiltro = coincidencias.length
  /** Lote visível (lazy loading) — o scroll carrega o restante. */
  const previsoes = coincidencias.slice(0, visiveis)
  const temMais = totalFiltro > previsoes.length

  useEffect(() => {
    setAtivo(0)
    setVisiveis(LOTE_SUGESTOES)
    listaRef.current?.scrollTo({ top: 0 })
  }, [busca])

  /** Sentinela do lazy loading: ao entrar na viewport carrega o próximo lote. */
  useEffect(() => {
    const alvo = sentinelaRef.current
    const raiz = listaRef.current
    if (!alvo || !raiz || !temMais) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisiveis((v) => Math.min(v + LOTE_SUGESTOES, totalFiltro))
        }
      },
      { root: raiz, rootMargin: '80px' },
    )
    obs.observe(alvo)
    return () => obs.disconnect()
  }, [temMais, totalFiltro, previsoes.length])

  /** Fallback para navegadores sem IntersectionObserver no dropdown. */
  const aoRolarLista = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && temMais) {
      setVisiveis((v) => Math.min(v + LOTE_SUGESTOES, totalFiltro))
    }
  }

  const escolhida = useMemo(
    () => opcoes.find((o) => o.id === opcaoId) ?? null,
    [opcoes, opcaoId],
  )

  const dropdownAberto = focoBusca && !carregando && previsoes.length > 0

  const aoEscolherPrevisao = (o: OpcaoClassificacaoExistente) => {
    setOpcaoId(o.id)
    setBusca(`${o.cst} · ${o.cClassTrib}`)
    setFocoBusca(false)
  }

  /** Mantém o item ativo visível durante a navegação por teclado. */
  useEffect(() => {
    if (!dropdownAberto) return
    listaRef.current
      ?.querySelector(`[data-indice="${ativo}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [ativo, dropdownAberto])

  /**
   * Reaplica a classificação vigente no que já foi gravado com este NCM
   * (produtos + itens de XML). Retorna o texto de impacto para o toast.
   */
  const propagar = async (): Promise<string> => {
    const prop = await propagarClassificacaoNcm(codigo)
    // Atualiza as telas que leem do banco (melhor esforço — nunca quebra o salvamento).
    try {
      const { useProdutos } = await import('@/store/produtos')
      await useProdutos.getState().carregar().catch(() => undefined)
    } catch { /* sem cadastro — nada a recarregar */ }
    try {
      const { useNfe } = await import('@/store/nfe')
      const st = useNfe.getState()
      await st.carregar().catch(() => undefined)
      // A nota aberta guarda um snapshot — recarrega para exibir a vigente.
      const aberta = useNfe.getState().notaAberta
      if (aberta?.id != null) {
        const fresca = useNfe.getState().notas.find((x) => x.id === aberta.id) ?? null
        useNfe.setState({ notaAberta: fresca })
      }
    } catch { /* sem notas — nada a recarregar */ }
    const partes = []
    if (prop.produtos) partes.push(`${prop.produtos} produto(s)`)
    if (prop.itens) partes.push(`${prop.itens} item(ns) em ${prop.notas} nota(s)`)
    return partes.length ? ` — atualizados: ${partes.join(' · ')}.` : ''
  }

  const confirmar = async () => {
    if (!escolhida) return toast('Escolha uma das classificações existentes.', 'warn')
    setSalvando(true)
    try {
      const r = await salvarReclassificacaoManual({
        ncm: codigo,
        cst: escolhida.cst,
        cClassTrib: escolhida.cClassTrib,
        descricao,
        fonteDescricao,
        fonteUrl,
      })
      if (!r.ok) {
        toast(r.motivo, 'warn')
        return
      }
      const impacto = await propagar()
      toast(`Reclassificação manual salva — passa a valer nas importações${impacto}`, 'ok')
      onSalvo()
      onFechar()
    } catch (e) {
      toast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setSalvando(false)
    }
  }

  const excluir = async () => {
    setSalvando(true)
    try {
      await removerReclassificacaoManual(codigo)
      const impacto = await propagar()
      toast(`Reclassificação manual removida — voltou à classificação oficial${impacto}`, 'warn')
      onSalvo()
      onFechar()
    } catch (e) {
      toast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="✋ Reclassificar manualmente"
      subtitulo={`NCM ${fmtNcm(codigo)} · sua escolha vale em todas as telas, acima da base oficial`}
      largura="max-w-3xl"
      rodape={
        <>
          {temManual ? (
            <Btn variante="danger" carregando={salvando} onClick={() => void excluir()}>
              {salvando ? 'Removendo…' : '🗑 Remover manual'}
            </Btn>
          ) : null}
          <Btn onClick={onFechar}>Cancelar</Btn>
          <Btn variante="primary" carregando={salvando} disabled={carregando} onClick={() => void confirmar()}>
            {salvando ? 'Salvando…' : '✋ Salvar reclassificação'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-3 dark:bg-slate-950/40">
          <div className="flex flex-wrap items-center gap-2">
            <Pill cor="brand">NCM {fmtNcm(codigo)}</Pill>
            <span title="Nenhum vínculo oficial CST × cClassTrib — vale o fallback universal da LC 214/2025">
              <Pill cor="amber">⚠ Sem vínculo oficial — regra geral</Pill>
            </span>
          </div>
          {nomenclatura?.descricao ? (
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{nomenclatura.descricao}</div>
          ) : null}
        </div>

        <AvisoManual
          compact
          fonteDescricao={fonteDescricao || undefined}
          fonteUrl={fonteUrl || undefined}
        />

        <Campo
          label="Classificação (CST × cClassTrib)"
          obrigatorio
          dica={
            carregando
              ? 'Carregando classificações…'
              : busca.trim()
                ? `${totalFiltro} resultado${totalFiltro === 1 ? '' : 's'} para “${busca.trim()}” — role para carregar mais.`
                : `${totalFiltro} classificações disponíveis — digite para filtrar ou role para ver todas.`
          }
        >
          <div className="relative">
            <Texto
              value={busca}
              placeholder="Ex.: 200 …  000001 …  60 …  anexo 1 …  monofásica … (vazio lista tudo)"
              className="field-sm field-mono"
              autoComplete="off"
              onChange={(e) => {
                setBusca(e.target.value)
                if (!e.target.value.trim()) setOpcaoId('')
                setFocoBusca(true)
              }}
              onFocus={() => setFocoBusca(true)}
              onBlur={() => window.setTimeout(() => setFocoBusca(false), 150)}
              onKeyDown={(e) => {
                if (!dropdownAberto) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (ativo >= previsoes.length - 1 && temMais) {
                    setVisiveis((v) => Math.min(v + LOTE_SUGESTOES, totalFiltro))
                    setAtivo((a) => a + 1)
                  } else {
                    setAtivo((a) => (a + 1) % previsoes.length)
                  }
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setAtivo((a) => (a - 1 + previsoes.length) % previsoes.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const alvo = previsoes[ativo] ?? previsoes[0]
                  if (alvo) aoEscolherPrevisao(alvo)
                } else if (e.key === 'Escape') {
                  setFocoBusca(false)
                }
              }}
            />
            {dropdownAberto ? (
              <div ref={listaRef} className="sugg scroll-elegante" onScroll={aoRolarLista}>
                {previsoes.map((o, i) => (
                  <button
                    key={o.id}
                    type="button"
                    data-indice={i}
                    className={`sugg-item ${i === ativo ? 'is-active' : ''}`}
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => aoEscolherPrevisao(o)}
                  >
                    <span className="flex w-full items-center gap-2 text-left">
                      <span className="whitespace-nowrap font-mono text-xs font-bold text-brand-700 dark:text-aurum-200">
                        {o.cst} · {o.cClassTrib}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                        {o.nome}
                      </span>
                      <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">
                        −{fmtPct(o.pRedIBS ?? 0)} / −{fmtPct(o.pRedCBS ?? 0)}
                      </span>
                    </span>
                  </button>
                ))}
                {temMais ? (
                  <div ref={sentinelaRef} className="px-3 py-2">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
                      <span>
                        Mostrando {previsoes.length} de {totalFiltro} — role para carregar mais…
                      </span>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
                    </div>
                    <div className="mt-1.5 space-y-1" aria-hidden="true">
                      <div className="skeleton h-6" />
                      <div className="skeleton h-6 opacity-70" />
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-1.5 text-[10px] text-slate-400">
                    {totalFiltro} resultado{totalFiltro === 1 ? '' : 's'} — fim da lista.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </Campo>

        {!carregando && !coincidencias.length ? (
          <p className="-mt-2 text-[11px] text-slate-500">
            Nenhuma classificação para “{busca.trim()}” — tente só a CST ou parte do cClassTrib.
          </p>
        ) : null}

        {escolhida ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
            <div className="flex flex-wrap items-center gap-2">
              <Pill cor="emerald">✓ escolhida</Pill>
              <span className="font-mono text-sm font-black text-emerald-800 dark:text-emerald-200">
                CST {escolhida.cst} · {escolhida.cClassTrib}
              </span>
              <button
                type="button"
                className="ml-auto text-[11px] font-semibold text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
                onClick={() => {
                  setOpcaoId('')
                  setBusca('')
                }}
              >
                trocar
              </button>
            </div>
            <div className="mt-1 text-xs font-semibold">{escolhida.nome}</div>
            <div className="mt-1 font-mono text-[11px] text-slate-500">
              Redução IBS {fmtPct(escolhida.pRedIBS ?? 0)} · CBS {fmtPct(escolhida.pRedCBS ?? 0)}
              {escolhida.anexo ? ` · Anexo ${escolhida.anexo}` : ''}
            </div>
            {escolhida.lcRef ? (
              <div className="mt-1 text-[11px] text-slate-500">{escolhida.lcRef}</div>
            ) : null}
            {escolhida.urlLegislacao ? (
              <a href={escolhida.urlLegislacao} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-semibold text-brand-600 hover:underline dark:text-aurum-200">
                ↗ Ver referência oficial desta classificação
              </a>
            ) : null}
          </div>
        ) : null}

        <Campo label="Descrição / justificativa" obrigatorio dica="Explique o enquadramento que você está aplicando.">
          <Area
            rows={3}
            value={descricao}
            placeholder="Ex.: Enquadrado como … conforme art. … da LC 214/2025."
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Campo>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo label="De onde tirou a informação (fonte)" obrigatorio dica="Ex.: art. 128 da LC 214/2025, Solução de Consulta …">
            <Texto
              value={fonteDescricao}
              placeholder="Ex.: LC 214/2025, art. …"
              className="field-sm"
              onChange={(e) => setFonteDescricao(e.target.value)}
            />
          </Campo>
          <Campo label="Link da legislação / fonte" obrigatorio dica="Abre em nova aba para conferência.">
            <Texto
              value={fonteUrl}
              placeholder="https://…"
              inputMode="url"
              className="field-sm field-mono"
              onChange={(e) => setFonteUrl(e.target.value)}
            />
          </Campo>
        </div>

        {fonteUrl ? (
          <div className="text-xs">
            <a href={fonteUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline dark:text-aurum-200">
              ↗ Abrir o que está sendo informado na lei
            </a>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
