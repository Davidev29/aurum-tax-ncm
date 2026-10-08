/**
 * Tela **Consulta NCM** — busca unificada com **resposta automática única**.
 *
 * Um único input orquestra 3 frentes em paralelo (fan-out por intenção):
 * - dígitos (≥2) → **Base oficial · número** (`sugerirNomenclatura` +
 *   `resolverClassificacoes` quando 8 dígitos);
 * - texto (≥2 chars) → **Base oficial · por nome** (`buscarNomenclaturaPorTexto`);
 * - frase expressiva → **✨ busca automática · resposta** (`classificarPorDescricao` /
 *   fallback `classificarComIA`).
 *
 * Para não confundir, há UM protagonista por intenção (preferindo a busca no
 * texto): entrada numérica exata ancora no painel oficial; entrada textual
 * mostra a resposta automática em destaque (borda animada ouro) e rebaixa as
 * listas oficiais para alternativas compactas/colapsáveis. Escolher qualquer
 * resultado ancora no painel oficial (0/1/N + regra geral).
 *
 * Regras preservadas da v1:
 * - NCM precisa de exatamente 8 dígitos (`avisoInvalido`);
 * - 0 vínculos → cartão de **tributação integral** (regra geral);
 * - N > 1 → aviso âmbar "possui N classificações possíveis";
 * - "Salvar como produto" abre o modal da página, nunca escreve direto;
 * - "Adicionar à calculadora" abre o **modal de cálculo**.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import { fmtConfiancaAurumAI, nivelDeConfianca } from '@/domain/aurum-ai'
import { fmtMoeda, fmtNcm, MASK, norm } from '@/domain/services/format'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'
import { normalizarBusca, tokensRelevantes } from '@/domain/services/busca-texto'
import { ModalSalvarClass } from '@/modais/pagina'
import { ModalReclassificacao } from '@/modais/reclassificacao'
import { useBase } from '@/store/base'
import { useConsulta } from '@/store/consulta'
import { toast, useUi } from '@/store/ui'
import { type BloqueioSistema } from '@/ui/cartoes'
import { CartaoEnxuto, CartaoForaDeEscopo } from '@/ui/consulta-enxuta'
import { BarraConfiancaAurumAI, CarregandoAurumAI, IconeAurumPremium, MolduraAurumAI, StatusAurumAI } from '@/ui/aurum-ai'
import {
  BotaoDetalhePremium,
  ModalAuditoriaIA,
  ModalNcmsAnalisados,
  ModalRaciocinioIA,
  ModalSimulacaoIA,
} from '@/ui/consulta-premium'
import { Btn, Painel, Texto, Vazio } from '@/ui/kit'
import { Entrada, Revelar } from '@/ui/motion'
import {
  SecaoCarregando,
  SkeletonCartaoClassificacao,
  SkeletonListaSugestoes,
} from '@/ui/skeleton'
import { SUGGEST_LIMITS } from '@/domain/constants'
import type { ResultadoBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import {
  buscarNomenclaturaPorTexto,
  resolverPorPrefixo,
  sugerirNomenclatura,
} from '@/infrastructure/base/classificacao-repo'
import { VALOR_BASE_IA } from '@/infrastructure/ia/classificacao-ia-repo'
import { bloqueiosParaCcts } from '@/application/cff-sync'

/** Fan-out leve (prefixo + nome): ~350 ms — sugestão acompanha a digitação. */
const DEBOUNCE_RAPIDO = 350
/** Predição assistiva (RAG + lexical + grafo): ~900 ms após parar de digitar. */
const DEBOUNCE_DESCRICAO = 900
/** Dropdown instantâneo sob o input: ~220 ms, só leitura (não commita store). */
const DEBOUNCE_QUICK = 220

export function Consulta() {
  const codigo = useConsulta((s) => s.codigo)
  const consultar = useConsulta((s) => s.consultar)
  const limpar = useConsulta((s) => s.limpar)
  const buscarSugestoes = useConsulta((s) => s.buscarSugestoes)
  const sugestoes = useConsulta((s) => s.sugestoes)
  const resultados = useConsulta((s) => s.resultados)
  const nomenclatura = useConsulta((s) => s.nomenclatura)
  const regraGeral = useConsulta((s) => s.regraGeral)
  const avisoInvalido = useConsulta((s) => s.avisoInvalido)
  const carregando = useConsulta((s) => s.carregando)

  const entradaStore = useConsulta((s) => s.entrada)
  const setEntradaStore = useConsulta((s) => s.setEntrada)
  /**
   * Input local reativo: o texto aparece na hora (0 ms visual) e só commita
   * para a store + fan-out após 3 s parado. Sem isso, cada tecla publicava no
   * Zustand global → re-render de ~20 subscriptions + Dexie/RAG na main thread
   * → sensação de "trava/engole letra".
   */
  const [entrada, setEntradaLocal] = useState(entradaStore)
  const ultimoCommit = useRef(entradaStore)
  const consultarUnificada = useConsulta((s) => s.consultarUnificada)
  const escolherUnificada = useConsulta((s) => s.escolherUnificada)
  const buscarTexto = useConsulta((s) => s.buscarTexto)
  const resultadosTexto = useConsulta((s) => s.resultadosTexto)
  const buscandoTexto = useConsulta((s) => s.buscandoTexto)

  const descricao = useConsulta((s) => s.descricao)
  const destinacao = useConsulta((s) => s.destinacao)
  const setDestinacao = useConsulta((s) => s.setDestinacao)
  const composicao = useConsulta((s) => s.composicao)
  const setComposicao = useConsulta((s) => s.setComposicao)
  const usoDescricao = useConsulta((s) => s.usoDescricao)
  const setUsoDescricao = useConsulta((s) => s.setUsoDescricao)
  const sugestao = useConsulta((s) => s.sugestao)
  const classificando = useConsulta((s) => s.classificandoDescricao)
  const classificarDescricao = useConsulta((s) => s.classificarDescricao)
  const codigoIaAtual = useConsulta((s) => s.codigoIa)
  /** Camada IA (06-06): `ia` = fallback acionou; `deterministico` = primário venceu sem worker. */
  const via = useConsulta((s) => s.via)

  const abrirCalc = useUi((s) => s.abrirCalc)
  const nomenclaturaBase = useBase((s) => s.status?.nomenclatura ?? 0)
  const basePronta = useBase((s) => s.pronta)

  const [paraSalvar, setParaSalvar] = useState<Classificacao | null>(null)
  const prefillSalvar = useConsulta((s) => s.prefillSalvar)
  const setPrefillSalvar = useConsulta((s) => s.setPrefillSalvar)
  const [reclassificando, setReclassificando] = useState(false)
  const [bloqueios, setBloqueios] = useState<Record<string, BloqueioSistema[]>>({})
  const [ativoTexto, setAtivoTexto] = useState(-1)
  const listaTextoRef = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  // Dropdown instantâneo (texto ou número): leitura direta, sem commitar store.
  const [quickNum, setQuickNum] = useState<{ codigo: string; codigoOriginal: string; descricao: string; dataFim?: string | null }[]>([])
  const [quickTxt, setQuickTxt] = useState<ResultadoBuscaTexto[]>([])
  const [quickFam, setQuickFam] = useState<{ prefixo: string; totalVigentes: number; unanime: boolean; cst: string | null; cClassTrib: string | null } | null>(null)
  const [quickAtivo, setQuickAtivo] = useState(-1)
  const [quickAberto, setQuickAberto] = useState(false)
  const quickSeq = useRef(0)
  const wrapBuscaRef = useRef<HTMLDivElement>(null)

  const intencao = useMemo(() => detectarIntencaoConsulta(entrada), [entrada])
  const mostrarExata = intencao.deveBuscarExato
  const mostrarNome = intencao.deveBuscarNome
  const mostrarDescricao = intencao.deveBuscarDescricao || classificando || !!sugestao

  // Compat: fluxos legados (Produtos → Ver/Editar) chegam via `codigo`.
  // Espelha no input único uma vez por navegação (escreve local + store).
  const codigoJaEspelhado = useRef('')
  useEffect(() => {
    const dig = norm(codigo)
    if (dig.length === 8 && dig !== norm(codigoJaEspelhado.current) && norm(entrada) !== dig) {
      codigoJaEspelhado.current = codigo
      const fmt = MASK.ncm(codigo)
      ultimoCommit.current = fmt
      setEntradaStore(fmt)
      setEntradaLocal(fmt)
    }
  }, [codigo, entrada, setEntradaStore])

  // Espelho externo → local (limpar, escolherUnificada, navegar): quando a
  // store muda por outra via que não o commit debounced, reflete no input.
  useEffect(() => {
    if (entradaStore !== ultimoCommit.current && entradaStore !== entrada) {
      ultimoCommit.current = entradaStore
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntradaLocal(entradaStore)
    }
  }, [entradaStore, entrada])

  // Fan-out com duplo debounce curto: leve (~350 ms: prefixo/nome/exato) e
  // pesado (~900 ms: predição RAG + lexical + grafo). O input visual continua
  // instantâneo (estado local); só a BUSCA espera após a última tecla.
  // Enter/Buscar força imediato. Campo é BUSCA, não escolha: esvaziar o input
  // limpa a tela na hora (invalida fan-outs pendentes) e aguarda a nova consulta.
  useEffect(() => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    const atual = entrada
    if (!atual.trim()) {
      ultimoCommit.current = ''
      setEntradaStore('')
      setAtivoTexto(-1)
      // `consultarUnificada('')` limpa resultados/sugestões/IA E invalida
      // workers em voo (seq++), então nenhum resultado velho repopula a tela.
      void consultarUnificada('')
      return
    }
    const inten = detectarIntencaoConsulta(atual)
    const t1 = window.setTimeout(() => {
      ultimoCommit.current = atual
      setEntradaStore(atual)
      if (inten.deveBuscarExato && !inten.deveClassificarExato) void buscarSugestoes(inten.digitos)
      if (inten.deveClassificarExato) void consultar(inten.digitos)
      if (inten.deveBuscarNome) void buscarTexto(atual)
    }, DEBOUNCE_RAPIDO)
    timers.current.push(t1)
    if (inten.deveBuscarDescricao) {
      const t2 = window.setTimeout(() => {
        void classificarDescricao({ descricao: atual, destinacao, composicao, uso: usoDescricao })
      }, DEBOUNCE_DESCRICAO)
      timers.current.push(t2)
    }
    return () => {
      for (const t of timers.current) window.clearTimeout(t)
      timers.current = []
    }
    // Contexto de refino (destinação/composição/uso) entra no debounce da
    // predição; demais deps são estáveis (store actions).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada, destinacao, composicao, usoDescricao])

  // Dropdown instantâneo: a cada tecla (texto OU número) sugere sem commitar.
  // Número → prefixo oficial + evidência de família (unanimidade, vigentes);
  // texto → top-8 por nome. Só leitura: Enter continua pesquisando.
  useEffect(() => {
    const atual = entrada.trim()
    if (atual.length < 2) {
      setQuickNum([])
      setQuickTxt([])
      setQuickFam(null)
      setQuickAberto(false)
      setQuickAtivo(-1)
      return
    }
    const seq = ++quickSeq.current
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const inten = detectarIntencaoConsulta(atual)
          let nums: typeof quickNum = []
          let txts: typeof quickTxt = []
          let fam: typeof quickFam = null
          if (inten.deveBuscarExato && inten.digitos.length >= 2) {
            try {
              nums = (await sugerirNomenclatura(inten.digitos, 8)) as typeof quickNum
            } catch {
              nums = []
            }
            // Evidência de família: prefixo 2–7 dígitos agrega filhos/vigência.
            if (inten.digitos.length >= 2 && inten.digitos.length <= 7) {
              try {
                const r = await resolverPorPrefixo(inten.digitos)
                if (r && seq === quickSeq.current) {
                  fam = {
                    prefixo: r.prefixo,
                    totalVigentes: r.totalVigentes,
                    unanime: r.unanime,
                    cst: r.cst,
                    cClassTrib: r.cClassTrib,
                  }
                }
              } catch {
                fam = null
              }
            }
          }
          if (inten.deveBuscarNome) {
            try {
              txts = await buscarNomenclaturaPorTexto(atual, 8)
            } catch {
              txts = []
            }
          }
          if (seq !== quickSeq.current) return
          setQuickNum(nums)
          setQuickTxt(txts)
          setQuickFam(fam)
          setQuickAberto(nums.length > 0 || txts.length > 0 || fam != null)
          setQuickAtivo(-1)
        } catch {
          /* dropdown nunca quebra a digitação */
        }
      })()
    }, DEBOUNCE_QUICK)
    return () => window.clearTimeout(t)
  }, [entrada])

  // Fecha o dropdown ao clicar fora do campo.
  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      if (wrapBuscaRef.current && !wrapBuscaRef.current.contains(e.target as Node)) {
        setQuickAberto(false)
      }
    }
    document.addEventListener('mousedown', aoClicar)
    return () => document.removeEventListener('mousedown', aoClicar)
  }, [])

  // Permitido × negado por DFe (tabela CFF local) para os cClassTribs exibidos.
  useEffect(() => {
    const ccts = [...new Set(resultados.map((r) => r.classificacao.cClassTrib).filter(Boolean))]
    if (!ccts.length) {
      setBloqueios({})
      return
    }
    let vivo = true
    void bloqueiosParaCcts(ccts)
      .then((m) => {
        if (vivo) setBloqueios(m)
      })
      .catch(() => {
        if (vivo) setBloqueios({})
      })
    return () => {
      vivo = false
    }
  }, [resultados])

  const limparTudo = (anunciar = true) => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    ultimoCommit.current = ''
    setEntradaLocal('')
    setAtivoTexto(-1)
    setQuickNum([])
    setQuickTxt([])
    setQuickFam(null)
    setQuickAberto(false)
    setQuickAtivo(-1)
    limpar()
    if (anunciar) toast('Consulta limpa.', 'warn')
    window.requestAnimationFrame(() => document.getElementById('busca-unificada')?.focus())
  }

  const submeter = () => {
    // Entrada vazia = tela limpa aguardando a nova consulta (sem buscar vazio).
    if (!entrada.trim()) {
      limparTudo(false)
      return
    }
    // Nova busca invalida qualquer destaque anterior: nada fica "marcado"
    // sem o usuário escolher explicitamente (clique).
    setAtivoTexto(-1)
    setQuickAberto(false)
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    ultimoCommit.current = entrada
    setEntradaStore(entrada)
    void consultarUnificada(entrada)
  }
  const aoEscolher = (c: string) => {
    const fmt = c
    ultimoCommit.current = fmt
    setEntradaLocal(fmt)
    setQuickAberto(false)
    void escolherUnificada(c)
  }
  const aoEscolherTexto = (c: string) => {
    const fmt = c
    ultimoCommit.current = fmt
    setEntradaLocal(fmt)
    setQuickAberto(false)
    void escolherUnificada(c)
  }

  // Itens unificados do dropdown (família + números + textos) para ↑↓/Enter.
  const quickItens: { codigo: string; rotulo: string }[] = [
    ...(quickFam && quickFam.unanime && quickFam.cst
      ? [{ codigo: `fam:${quickFam.prefixo}`, rotulo: `Família ${quickFam.prefixo}` }]
      : []),
    ...quickNum.map((n) => ({ codigo: n.codigo, rotulo: n.codigoOriginal })),
    ...quickTxt.filter((r) => !quickNum.some((n) => n.codigo === r.codigo)).map((r) => ({ codigo: r.codigo, rotulo: r.codigo })),
  ]
  const escolherQuick = (codigo: string) => {
    if (codigo.startsWith('fam:')) {
      // Família: pesquisa o prefixo (o painel oficial agrega filhos/hipótese).
      submeter()
      return
    }
    aoEscolher(codigo)
  }

  const aoTecla = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Dropdown aberto + item destacado = escolhe; senão pesquisa o texto.
      if (quickAberto && quickAtivo >= 0 && quickItens[quickAtivo]) {
        e.preventDefault()
        escolherQuick(quickItens[quickAtivo].codigo)
        return
      }
      e.preventDefault()
      submeter()
    } else if (e.key === 'ArrowDown' && (quickAberto ? quickItens.length : resultadosTexto.length)) {
      e.preventDefault()
      if (quickAberto && quickItens.length) {
        setQuickAtivo((a) => Math.min(a + 1, quickItens.length - 1))
      } else {
        setAtivoTexto((a) => Math.min(a + 1, resultadosTexto.length - 1))
      }
    } else if (e.key === 'ArrowUp' && (quickAberto ? quickItens.length : resultadosTexto.length)) {
      e.preventDefault()
      if (quickAberto && quickItens.length) {
        setQuickAtivo((a) => (a <= 0 ? -1 : a - 1))
      } else {
        setAtivoTexto((a) => (a <= 0 ? -1 : a - 1))
      }
    } else if (e.key === 'Escape') {
      if (quickAberto) {
        e.preventDefault()
        setQuickAberto(false)
        setQuickAtivo(-1)
        return
      }
      e.preventDefault()
      limparTudo()
    }
  }

  // Sem seleção automática: a lista nova chega sem nada "marcado".
  // Só a navegação por teclado (↑↓) destaca — Enter nunca escolhe sozinho.
  useEffect(() => {
    setAtivoTexto(-1)
  }, [resultadosTexto])

  // Rolagem só para navegação explícita por teclado (ativo >= 0).
  // Hover não move o scroll — antes isso "puxava" a tela enquanto digitava.
  useEffect(() => {
    if (ativoTexto < 0) return
    listaTextoRef.current
      ?.querySelector(`[data-indice="${ativoTexto}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [ativoTexto])

  const exatoPronto = intencao.deveClassificarExato && resultados.length > 0
  const algumaCarga = carregando || buscandoTexto || classificando
  // Texto atual ainda não pesquisado (usuário digitando a 2ª busca):
  // a lista visível é da busca anterior — Enter pesquisa o texto novo.
  const digitandoNovaBusca =
    entrada.trim() !== entradaStore.trim() &&
    (resultadosTexto.length > 0 || sugestoes.length > 0 || resultados.length > 0)

  /**
   * Protagonista da resposta (evita os 4 blocos empilhados que confundiam):
   * - número exato → o painel oficial reina; a busca vira coadjuvante colapsada;
   * - texto/frase → a ✨ busca automática responde primeiro (borda animada ouro); a
   *   base oficial aparece abaixo como alternativa compacta.
   */
  const ehExatoNumerico = intencao.deveClassificarExato
  const prioridadeIA = !ehExatoNumerico && mostrarDescricao
  // Painel oficial ancorado a partir da busca (ex.: "Classificar oficialmente"):
  // mantém a borda animada para deixar claro que foi a busca que classificou.
  const digitosEntrada = norm(entrada)
  const origemIAOficial =
    digitosEntrada.length === 8 &&
    (digitosEntrada === norm(codigoIaAtual ?? '') ||
      (sugestao?.ncm_provavel ? digitosEntrada === norm(sugestao.ncm_provavel) : false))

  return (
    <div className="mx-auto max-w-5xl">
      <Entrada>
      <Painel>
        <div className="p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">🔍</span> Consulta por NCM
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Digite o NCM, o nome do produto ou descreva com suas palavras — a ✨ busca automática
            responde primeiro no texto; o número exato valida na base oficial abaixo.
            Sugestões aparecem enquanto digita (↑↓ navega, Enter escolhe ou pesquisa).
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <div ref={wrapBuscaRef} className="field-wrap min-w-[220px] flex-1">
              <span className="field-icon">🔍</span>
              <Texto
                grande
                id="busca-unificada"
                autoComplete="off"
                spellCheck={false}
                placeholder="0201.10.00 · queijo mozarela · jacaré vivo · ovo de codorna…"
                value={entrada}
                onChange={(e) => {
                  setEntradaLocal(e.target.value)
                  // Nova digitação nunca herda destaque da busca anterior.
                  setAtivoTexto(-1)
                  setQuickAberto(true)
                }}
                onFocus={() => {
                  if (quickNum.length || quickTxt.length || quickFam) setQuickAberto(true)
                }}
                onKeyDown={aoTecla}
                role="combobox"
                aria-expanded={quickAberto}
                aria-controls="sugestoes-instantaneas"
                aria-activedescendant={quickAtivo >= 0 ? `quick-item-${quickAtivo}` : undefined}
                aria-label="Busca unificada: NCM, nome do produto ou descrição. Sugestões enquanto digita, Enter pesquisa."
              />
              {quickAberto && (quickNum.length > 0 || quickTxt.length > 0 || quickFam) ? (
                <div id="sugestoes-instantaneas" role="listbox" aria-label="Sugestões instantâneas" className="sugg sugg--glass">
                  {quickFam ? (
                    <div className="sugg-familia" title={quickFam.unanime ? `Família unânime ${quickFam.cst}/${quickFam.cClassTrib}` : 'Família com enquadramentos divergentes'}>
                      <span aria-hidden="true">🧬</span>
                      <span>
                        Família {quickFam.prefixo} · {quickFam.totalVigentes} vigente(s)
                        {quickFam.unanime && quickFam.cst ? (
                          <> · <strong className="font-mono">{quickFam.cst}/{quickFam.cClassTrib}</strong> unânime</>
                        ) : (
                          <> · enquadramentos divergentes</>
                        )}
                      </span>
                    </div>
                  ) : null}
                  {quickNum.map((n, i) => {
                    const idx = (quickFam?.unanime && quickFam.cst ? 1 : 0) + i
                    return (
                      <button
                        key={`qn-${n.codigo}`}
                        id={`quick-item-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={idx === quickAtivo}
                        className={`sugg-item${idx === quickAtivo ? ' is-active' : ''}`}
                        onMouseEnter={() => setQuickAtivo(idx)}
                        onClick={() => escolherQuick(n.codigo)}
                        title={`Classificar ${n.codigoOriginal} oficialmente`}
                      >
                        <span className="font-mono text-xs font-black text-brand-700 dark:text-aurum-200">{fmtNcm(n.codigo)}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{n.descricao}</span>
                        <span className="sugg-selo">🔢 número</span>
                      </button>
                    )
                  })}
                  {quickTxt
                    .filter((r) => !quickNum.some((n) => n.codigo === r.codigo))
                    .map((r, j) => {
                      const idx = (quickFam?.unanime && quickFam.cst ? 1 : 0) + quickNum.length + j
                      return (
                        <button
                          key={`qt-${r.codigo}`}
                          id={`quick-item-${idx}`}
                          type="button"
                          role="option"
                          aria-selected={idx === quickAtivo}
                          className={`sugg-item${idx === quickAtivo ? ' is-active' : ''}`}
                          onMouseEnter={() => setQuickAtivo(idx)}
                          onClick={() => escolherQuick(r.codigo)}
                          title={`Classificar ${fmtNcm(r.codigo)} oficialmente`}
                        >
                          <span className="font-mono text-xs font-black text-brand-700 dark:text-aurum-200">{fmtNcm(r.codigo)}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                            <Destacar texto={r.descricao} termo={entrada} />
                          </span>
                          <span className="sugg-selo">📝 nome</span>
                        </button>
                      )
                    })}
                  <div className="sugg-dica">↑↓ navega · Enter escolhe ou pesquisa · clique classifica oficialmente</div>
                </div>
              ) : null}
            </div>
            <Btn variante="primary" onClick={submeter}>
              Buscar
            </Btn>
            <Btn onClick={() => limparTudo()}>
              Limpar
            </Btn>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              role="status"
              aria-live="polite"
            >
              {intencao.rotulo}
            </span>
            {classificando ? (
              <span className="flex items-center gap-1.5 font-semibold text-brand-600 dark:text-aurum-200" role="status" aria-live="polite">
                <IconeAurumPremium tamanho="sm" />
                Buscando…
                <span className="aurum-ai-pensando-pontos" aria-hidden="true">
                  <span className="aurum-ai-pensando-ponto" />
                  <span className="aurum-ai-pensando-ponto" />
                  <span className="aurum-ai-pensando-ponto" />
                </span>
              </span>
            ) : algumaCarga ? (
              <span className="flex items-center gap-1.5 font-semibold text-brand-600 dark:text-aurum-200">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                Processando…
              </span>
            ) : null}
            {exatoPronto && nomenclatura ? (
              <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">
                {nomenclatura.codigoOriginal} — {nomenclatura.descricao}
              </span>
            ) : null}
            {digitandoNovaBusca && !algumaCarga && !classificando ? (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                role="status"
                aria-live="polite"
                title="A lista abaixo é da busca anterior — pressione Enter ou Buscar para pesquisar o texto atual"
              >
                ⌨️ digitando… Enter pesquisa “{entrada.trim().slice(0, 40)}”
              </span>
            ) : null}
          </div>

          <details id="refino-predicao" className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            <summary className="cursor-pointer font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <IconeAurumPremium tamanho="sm" /> Refinar resposta (destinação, composição, uso — opcional)
              </span>
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="field-wrap">
                <Texto
                  id="refino-destinacao"
                  autoComplete="off"
                  placeholder="Destinação (opcional): abate, plantio…"
                  value={destinacao}
                  onChange={(e) => setDestinacao(e.target.value)}
                  aria-label="Destinação do produto"
                />
              </div>
              <div className="field-wrap">
                <Texto
                  autoComplete="off"
                  placeholder="Composição (opcional): teor de sal…"
                  value={composicao}
                  onChange={(e) => setComposicao(e.target.value)}
                  aria-label="Composição do produto"
                />
              </div>
              <div className="field-wrap">
                <Texto
                  autoComplete="off"
                  placeholder="Uso (opcional): ração, consumo…"
                  value={usoDescricao}
                  onChange={(e) => setUsoDescricao(e.target.value)}
                  aria-label="Uso do produto"
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Btn
                tam="sm"
                variante="primary"
                disabled={!entrada.trim()}
                carregando={classificando}
                onClick={() => void classificarDescricao({ descricao: entrada, destinacao, composicao, uso: usoDescricao })}
              >
                <span className="inline-flex items-center gap-1.5">
                  <IconeAurumPremium tamanho="sm" /> Classificar descrição
                </span>
              </Btn>
              <span className="text-[11px]">A busca reavalia sozinha 3 s após parar de digitar; o botão força com o refino atual.</span>
            </div>
          </details>
        </div>
      </Painel>
      </Entrada>

      {!entrada.trim() ? (
        <Entrada className="mt-6">
          <Vazio
            icone="🔍"
            titulo="Busque por número, nome ou descrição"
            texto="Ex.: 0201.10.00 (valida na base oficial) · queijo mozarela (a ✨ busca automática responde primeiro) · boi vivo Nelore para reprodução (o sistema cruza descrição + vigência)."
          />
        </Entrada>
      ) : (
        <Revelar className="mt-6 space-y-4">
          {/* UMA resposta protagonista por vez — resto colapsado. */}
          {prioridadeIA ? (
            <section aria-label="Resposta automática" className="space-y-3">
              <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                  <IconeAurumPremium tamanho="sm" /> Resposta automática
                </span>
                {via === 'deterministico' ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black normal-case text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    determinístico
                  </span>
                ) : null}
                {classificando ? (
                  <StatusAurumAI estado="processando">
                    <span className="font-semibold normal-case text-brand-600 dark:text-aurum-200">
                      analisando…
                    </span>
                  </StatusAurumAI>
                ) : null}
              </h3>
              {classificando && !sugestao && via !== 'ia' && via !== 'grafo' && via !== 'grafo+ia' ? (
                <CarregandoAurumAI entrada={entrada} />
              ) : (
                <SecaoRespostaIA entrada={entrada} bloqueios={bloqueios} onSalvar={setParaSalvar} onAddCalc={abrirCalc} />
              )}
            </section>
          ) : null}

          {/* Painel oficial (0/1/N) — herói no número exato (sem cabeçalho duplicado acima). */}
          {mostrarExata && intencao.deveClassificarExato ? (
            <section aria-label="Classificação oficial pela base" className="space-y-3">
              {carregando ? (
                <SecaoCarregando titulo="Classificando NCM…">
                  <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
                    <SkeletonListaSugestoes linhas={3} />
                  </div>
                  <SkeletonCartaoClassificacao />
                </SecaoCarregando>
              ) : (
                <PainelExato
                  avisoInvalido={avisoInvalido}
                  resultados={resultados}
                  nomenclatura={nomenclatura}
                  regraGeral={regraGeral}
                  bloqueios={bloqueios}
                  destaqueIA={origemIAOficial}
                  onSalvar={setParaSalvar}
                  onAddCalc={(cl) => abrirCalc({ tipo: 'classificacao', classificacao: cl })}
                  onReclassificar={() => setReclassificando(true)}
                />
              )}
            </section>
          ) : null}

          {/* Outras correspondências: UMA seção colapsada (número + nome). */}
          {(mostrarExata && !intencao.deveClassificarExato) || mostrarNome ? (
            <details className="rounded-xl border border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              <summary className="cursor-pointer font-bold">
                🔎 Outras correspondências na base oficial
                {sugestoes.length || resultadosTexto.length ? ` (${sugestoes.length + resultadosTexto.length})` : ''}
              </summary>
              <div className="mt-2 space-y-2">
                {mostrarExata && !intencao.deveClassificarExato ? (
                  <ListaSugestaoNcm
                    sugestoes={sugestoes}
                    texto={intencao.digitos}
                    baseVazia={nomenclaturaBase === 0}
                    carregandoBase={!basePronta}
                    onEscolher={aoEscolher}
                  />
                ) : null}
                {mostrarNome ? (
                  buscandoTexto && !resultadosTexto.length ? (
                    <SecaoCarregando titulo="Buscando por nome…">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
                        <SkeletonListaSugestoes linhas={5} comSelo />
                      </div>
                    </SecaoCarregando>
                  ) : (
                    <ListaResultadoTexto
                      resultados={resultadosTexto}
                      buscando={buscandoTexto}
                      termo={entrada}
                      baseVazia={nomenclaturaBase === 0}
                      carregandoBase={!basePronta}
                      ativo={ativoTexto}
                      listaRef={listaTextoRef}
                      onEscolher={aoEscolherTexto}
                    />
                  )
                ) : null}
              </div>
            </details>
          ) : null}

          {/* Número exato digitado junto de texto: a busca vira coadjuvante colapsada. */}
          {!prioridadeIA && mostrarDescricao ? (
            <details className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-xs text-slate-600 dark:border-violet-900 dark:bg-violet-950/20 dark:text-slate-300">
              <summary className="cursor-pointer font-bold">
                <span className="inline-flex items-center gap-1.5">
                  <IconeAurumPremium tamanho="sm" /> Ver resposta automática para este texto
                </span>
              </summary>
              <div className="mt-2">
                {classificando && !sugestao && via !== 'ia' && via !== 'grafo' && via !== 'grafo+ia' ? (
                  <CarregandoAurumAI entrada={entrada} />
                ) : (
                  <SecaoRespostaIA entrada={entrada} bloqueios={bloqueios} onSalvar={setParaSalvar} onAddCalc={abrirCalc} />
                )}
              </div>
            </details>
          ) : null}

          {!mostrarExata && !mostrarNome && !mostrarDescricao ? (
            <Vazio
              icone="⌨️"
              titulo="Continue digitando para ver a resposta"
              texto="Com 2+ dígitos validamos o número · com letras, a ✨ busca automática responde primeiro · a base oficial confirma abaixo."
            />
          ) : null}
        </Revelar>
      )}

      <ModalSalvarClass
        aberto={paraSalvar !== null}
        classificacao={paraSalvar}
        inicial={prefillSalvar}
        onFechar={() => {
          setParaSalvar(null)
          setPrefillSalvar(null)
        }}
      />
      {reclassificando && norm(codigo).length === 8 ? (
        <ModalReclassificacao
          aberto={reclassificando}
          ncm={codigo}
          nomenclatura={nomenclatura}
          onFechar={() => setReclassificando(false)}
          onSalvo={() => void consultar()}
        />
      ) : null}
      {/* Leitura fantasma para `descricao` (compat com testes/atalhos legados). */}
      <span className="hidden" data-testid="descricao-legada">
        {descricao}
      </span>
    </div>
  )
}

/* --------------------------------------------- painel oficial (0/1/N) -- */

function PainelExato({
  avisoInvalido,
  resultados,
  nomenclatura,
  regraGeral,
  bloqueios,
  destaqueIA = false,
  onSalvar,
  onAddCalc,
  onReclassificar,
}: {
  avisoInvalido: boolean
  resultados: ReturnType<typeof useConsulta.getState>['resultados']
  nomenclatura: ReturnType<typeof useConsulta.getState>['nomenclatura']
  regraGeral: boolean
  bloqueios: Record<string, BloqueioSistema[]>
  /** Borda animada ouro: este painel foi ancorado a partir do resultado automático. */
  destaqueIA?: boolean
  onSalvar: (c: Classificacao) => void
  onAddCalc: (cl: Classificacao) => void
  onReclassificar: () => void
}) {
  if (avisoInvalido && !resultados.length) {
    return (
      <Painel className="p-8 text-center">
        <div className="text-3xl">⌨️</div>
        <div className="mt-2 text-sm font-semibold">Informe um NCM de 8 dígitos.</div>
      </Painel>
    )
  }
  if (!resultados.length) {
    return (
      <Vazio
        icone="🔍"
        titulo="Nenhum NCM exato ainda"
        texto="Complete os 8 dígitos para classificar — enquanto isso, use as sugestões de prefixo acima."
      />
    )
  }
  return (
    <>
      {!regraGeral && resultados.length > 1 ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>⚡ {resultados.length} classificações possíveis</strong> para este NCM — compare abaixo.
        </p>
      ) : null}

      <div className="space-y-3">
        {regraGeral ? (
          <CartaoEnxuto
            cl={resultados[0].classificacao}
            nomenclatura={nomenclatura}
            bloqueios={bloqueios[resultados[0].classificacao.cClassTrib] ?? null}
            destaqueIA={destaqueIA}
            onSalvar={(cl) => onSalvar(cl)}
            onAddCalc={onAddCalc}
            onReclassificar={onReclassificar}
          />
        ) : (
          resultados.map((r) => (
            <CartaoEnxuto
              key={r.__uid}
              cl={r.classificacao}
              nomenclatura={nomenclatura}
              bloqueios={bloqueios[r.classificacao.cClassTrib] ?? null}
              destaqueIA={destaqueIA}
              onSalvar={(cl) => onSalvar(cl)}
              onAddCalc={onAddCalc}
              onReclassificar={r.manual ? onReclassificar : undefined}
            />
          ))
        )}
      </div>
    </>
  )
}

/* ------------------------------ resposta única automática (herói) -- */

/**
 * **✨ Resposta automática**: UM bloco protagonista que funde a predição
 * assistiva (`sugestao`) e a decisão validada do fallback (`via === 'ia'`).
 * A decisão validada tem precedência; a predição aparece quando o
 * determinístico venceu sem seletor. Tudo dentro da `MolduraAurumAI` (borda
 * animada ouro) para deixar claro que **foi a busca automática que classificou**.
 */
function SecaoRespostaIA({
  entrada,
  bloqueios,
  onSalvar,
  onAddCalc,
}: {
  entrada: string
  bloqueios: Record<string, BloqueioSistema[]>
  onSalvar: (c: Classificacao) => void
  onAddCalc: ReturnType<typeof useUi.getState>['abrirCalc']
}) {
  const sugestao = useConsulta((s) => s.sugestao)
  const classificando = useConsulta((s) => s.classificandoDescricao)
  const usarSugestao = useConsulta((s) => s.usarSugestao)
  const via = useConsulta((s) => s.via)
  const escolher = useConsulta((s) => s.escolherUnificada)

  const jsonPedido = sugestao
    ? {
        ncm_provavel: sugestao.ncm_provavel,
        descricao_ncm: sugestao.descricao_ncm,
        excecao_enquadravel: sugestao.excecao_enquadravel,
        tipo_excecao: sugestao.tipo_excecao,
        justificativa: sugestao.justificativa,
        confianca: sugestao.confianca,
        alternativas: sugestao.alternativas,
      }
    : null

  const corConfianca =
    sugestao?.confianca === 'alta'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
      : sugestao?.confianca === 'media'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200'

  // Barreira anti-alucinação na UI: fora de escopo exibe SÓ o cartão de
  // recusa fixa — sem NCM, sem cálculo, sem candidatos, sem trilha expandida.
  if (sugestao?.foraDeEscopo) {
    return (
      <MolduraAurumAI detalhe="recusa de escopo · sem consulta à base">
        <CartaoForaDeEscopo mensagem={sugestao.justificativa} />
      </MolduraAurumAI>
    )
  }

  // Decisão validada do fallback tem precedência sobre a predição simples.
  // Phase 10-05: `ia` + `grafo` + `grafo+ia` exibem a decisão validada.
  if (via === 'ia' || via === 'grafo' || via === 'grafo+ia') {
    return (
      <div className="space-y-2">
        {classificando ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-brand-600 dark:text-aurum-200">
            <span className="aurum-ai-pensando-pontos" aria-hidden="true">
              <span className="aurum-ai-pensando-ponto" />
              <span className="aurum-ai-pensando-ponto" />
              <span className="aurum-ai-pensando-ponto" />
            </span>
            Reavaliando…
          </div>
        ) : null}
        <MolduraAurumAI detalhe="decisão validada pela base oficial">
          <RespostaIaValidada onSalvar={onSalvar} onAddCalc={onAddCalc} bloqueios={bloqueios} />
        </MolduraAurumAI>
      </div>
    )
  }

  if (classificando && sugestao) {
    // Troca de frase com resultado anterior visível: mostra o anterior +
    // indicador de reprocessamento (sem piscar vazio).
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-brand-600 dark:text-aurum-200">
          <span className="aurum-ai-pensando-pontos" aria-hidden="true">
            <span className="aurum-ai-pensando-ponto" />
            <span className="aurum-ai-pensando-ponto" />
            <span className="aurum-ai-pensando-ponto" />
          </span>
          Refinando resposta para “{entrada.trim()}”…
        </div>
        <MolduraAurumAI detalhe="predição assistiva · reavaliando">
          <ConteudoSugestao
            sugestao={sugestao}
            jsonPedido={jsonPedido}
            corConfianca={corConfianca}
            onUsar={() => {
              void usarSugestao()
              toast('NCM sugerido enviado para classificação oficial.', 'ok')
            }}
            onEscolherAlternativa={(codigo) => void escolher(codigo)}
          />
        </MolduraAurumAI>
      </div>
    )
  }

  if (!sugestao) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        Descreva com mais contexto (ex.: “vivo”, “para plantio”, “com sal”) para a busca automática{' '}
        sugerir o NCM — sempre ancorada na nomenclatura vigente.
      </div>
    )
  }

  return (
    <MolduraAurumAI detalhe="predição assistiva · ancorada na base oficial">
      <ConteudoSugestao
        sugestao={sugestao}
        jsonPedido={jsonPedido}
        corConfianca={corConfianca}
        onUsar={() => {
          void usarSugestao()
          toast('NCM sugerido enviado para classificação oficial.', 'ok')
        }}
        onEscolherAlternativa={(codigo) => void escolher(codigo)}
      />
    </MolduraAurumAI>
  )
}

function ConteudoSugestao({
  sugestao,
  jsonPedido,
  corConfianca,
  onUsar,
  onEscolherAlternativa,
}: {
  sugestao: NonNullable<ReturnType<typeof useConsulta.getState>['sugestao']>
  jsonPedido: Record<string, unknown> | null
  corConfianca: string
  onUsar: () => void
  /** Classifica direto uma alternativa (toque fino: sem voltar ao topo). */
  onEscolherAlternativa?: (codigo: string) => void
}) {
  const [modal, setModal] = useState<'ncms' | 'raciocinio' | null>(null)
  const abrirRefino = () => {
    document.getElementById('refino-predicao')?.setAttribute('open', '')
    window.requestAnimationFrame(() => document.getElementById('refino-destinacao')?.focus())
    toast('Complete o refino — a IA reavalia automaticamente.', 'warn')
  }
  const alternativas = sugestao.alternativas.slice(0, 8)
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      {/* Herói comportado: NCM + confiança + 1 justificativa curta + CTA primário. */}
      <div className="flex flex-wrap items-center gap-2">
        {sugestao.ncm_provavel ? (
          <span className="consulta-hero-ncm text-brand-700 dark:text-aurum-200">
            {sugestao.ncm_provavel}
          </span>
        ) : (
          <span className="text-sm font-bold text-slate-500">Sem sugestão segura</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${corConfianca}`}>
          {sugestao.confianca}
        </span>
        {sugestao.excecao_enquadravel && sugestao.tipo_excecao ? (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800 dark:bg-violet-950/60 dark:text-violet-200" title={sugestao.tipo_excecao}>
            ⚡ benefício{sugestao.anexo ? ` · Anexo ${sugestao.anexo}` : ''}
          </span>
        ) : null}
        {sugestao.anexo && !(sugestao.excecao_enquadravel && sugestao.tipo_excecao) ? (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={`Anexo oficial ${sugestao.anexo} — ver classificação oficial`}>
            Anexo {sugestao.anexo}
          </span>
        ) : null}
      </div>

      <p className="consulta-justificativa-clamp text-slate-600 dark:text-slate-300" title={sugestao.justificativa}>
        {sugestao.justificativa}
      </p>

      {sugestao.ncm_provavel ? (
        <div className="flex flex-wrap gap-2">
          <Btn variante="primary" tam="sm" onClick={onUsar}>
            Classificar {sugestao.ncm_provavel} oficialmente
          </Btn>
        </div>
      ) : null}

      {/* Excesso em botões premium → modais glass padrão. */}
      <div className="aurum-ai-acoes" role="group" aria-label="Explorar resposta da IA">
        {alternativas.length ? (
          <BotaoDetalhePremium
            icone="🔎"
            rotulo="NCMs analisados"
            contagem={alternativas.length}
            variante="ia"
            titulo="Ver as hipóteses confrontadas — a preferida ganha selo + linha espectro"
            onClick={() => setModal('ncms')}
          />
        ) : null}
        <BotaoDetalhePremium
          icone="🧠"
          rotulo="Por que este NCM?"
          titulo="Raciocínio auditável + JSON — abre em modal glass"
          onClick={() => setModal('raciocinio')}
        />
      </div>

      {sugestao.perguntasComplementares.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>❓ Para refinar:</strong>{' '}
          <button type="button" onClick={abrirRefino} className="font-semibold underline" title="Abrir o refino para responder — a IA reavalia sozinha">
            {sugestao.perguntasComplementares[0].length > 90 ? `${sugestao.perguntasComplementares[0].slice(0, 90)}…` : sugestao.perguntasComplementares[0]}
          </button>
        </div>
      ) : null}

      <ModalNcmsAnalisados
        aberto={modal === 'ncms'}
        onFechar={() => setModal(null)}
        itens={[
          ...(sugestao.ncm_provavel
            ? [{ codigo: sugestao.ncm_provavel, titulo: sugestao.ncm_provavel, subtitulo: sugestao.descricao_ncm || 'Hipótese preferida' }]
            : []),
          ...alternativas
            .filter((a) => a !== sugestao.ncm_provavel)
            .map((a) => ({ codigo: a, titulo: a, subtitulo: 'Hipótese confrontada' })),
        ]}
        codigoPreferido={sugestao.ncm_provavel}
        subtitulo={`A busca automática confrontou ${alternativas.length + (sugestao.ncm_provavel ? 1 : 0)} hipótese(s) — a preferida está com selo + linha espectro.`}
        onEscolher={(codigo) => onEscolherAlternativa?.(codigo)}
      />
      <ModalRaciocinioIA
        aberto={modal === 'raciocinio'}
        onFechar={() => setModal(null)}
        justificativa={sugestao.justificativa}
        trilha={sugestao.trilha}
        json={jsonPedido}
        perguntas={sugestao.perguntasComplementares}
        onRefinar={abrirRefino}
      />
    </div>
  )
}

/* --------------------------------- resultado automático (fallback 06-06) -- */

/**
 * Conteúdo da decisão validada do fallback (`via === 'ia'`): herói comportado
 * DENTRO da `MolduraAurumAI` — barra de confiança + veredito compacto + cartão
 * enxuto + CTA primário. Excesso (NCMs analisados, simulação, auditoria) em
 * botões premium → modais glass padrão.
 */
function RespostaIaValidada({
  onSalvar,
  onAddCalc,
  bloqueios,
}: {
  onSalvar: (c: Classificacao) => void
  onAddCalc: ReturnType<typeof useUi.getState>['abrirCalc']
  bloqueios: Record<string, BloqueioSistema[]>
}) {
  const candidatos = useConsulta((s) => s.candidatosIa)
  const decisao = useConsulta((s) => s.decisaoIa)
  const nomenclaturaIa = useConsulta((s) => s.nomenclaturaIa)
  const calculo = useConsulta((s) => s.calculoIa)
  const codigoIa = useConsulta((s) => s.codigoIa)
  const confianca = useConsulta((s) => s.confiancaIa)
  const veredito = useConsulta((s) => s.vereditoIa)
  const fontes = useConsulta((s) => s.fontesIa)
  const feedbackEnviado = useConsulta((s) => s.feedbackIaEnviado)
  const usarSugestaoIa = useConsulta((s) => s.usarSugestaoIa)
  const feedbackNegativo = useConsulta((s) => s.feedbackIaNegativo)
  const escolher = useConsulta((s) => s.escolherUnificada)
  const via = useConsulta((s) => s.via)
  const grafoCypher = useConsulta((s) => s.grafoCypherIa)
  const caminhoGrafo = useConsulta((s) => s.caminhoGrafoIa)
  const provenienciaGrafo = useConsulta((s) => s.provenienciaGrafoIa)
  const boostGrafo = useConsulta((s) => s.boostGrafoIa)
  const boostValorGrafo = useConsulta((s) => s.boostValorGrafoIa)
  const [modal, setModal] = useState<'ncms' | 'simulacao' | 'auditoria' | null>(null)

  const top = candidatos.slice(0, 8)
  const nivel = nivelDeConfianca(confianca)

  return (
    <div
      className="space-y-2"
      role="status"
      aria-live="polite"
      aria-label={`Resultado automático · confiança ${nivel} ${fmtConfiancaAurumAI(confianca)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <BarraConfiancaAurumAI valor={confianca} compact />
        {via === 'grafo' || via === 'grafo+ia' ? (
          <span
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            title="Resposta com caminho do grafo fiscal local (multi-hop auditável) — o resolvedor validou o código."
            role="status"
            aria-label={via === 'grafo+ia' ? 'via:grafo+ia' : 'via:grafo'}
          >
            {via === 'grafo+ia' ? 'via:grafo+ia' : 'via:grafo'}
          </span>
        ) : null}
      </div>
      {caminhoGrafo?.length && provenienciaGrafo?.length ? (
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400" title="Base oficial + seu uso local (overlay só reordena)">
          <strong>Por que sugeriu:</strong> base: {caminhoGrafo.join(' → ')}
          {boostGrafo === 'uso_local' && Number(boostValorGrafo) > 0 ? (
            <span className="font-mono font-bold"> + seu uso (boost: uso_local +{Number(boostValorGrafo)})</span>
          ) : null}
        </p>
      ) : null}

      {codigoIa && decisao ? (
        <>
          {veredito && veredito.exigeVerificacao ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <strong>Hipótese a verificar:</strong> {veredito.mensagemHipotese ?? 'condição legal a comprovar antes de escriturar.'}
            </p>
          ) : null}
          <CartaoEnxuto
            cl={decisao}
            nomenclatura={nomenclaturaIa}
            bloqueios={bloqueios[decisao.cClassTrib] ?? null}
            onSalvar={(cl) => onSalvar(cl)}
            onAddCalc={(cl) => onAddCalc({ tipo: 'classificacao', classificacao: cl })}
          />

          <div className="flex flex-wrap gap-2">
            <Btn
              variante="primary"
              tam="sm"
              onClick={() => {
                void usarSugestaoIa()
                toast('Resultado enviado para classificação oficial.', 'ok')
              }}
            >
              Classificar {fmtNcm(codigoIa)} oficialmente
            </Btn>
            <Btn
              tam="sm"
              disabled={feedbackEnviado}
              onClick={() => {
                void feedbackNegativo()
                toast('Obrigado — registramos que não era esse NCM.', 'warn')
              }}
            >
              {feedbackEnviado ? '✓ Feedback registrado' : '👎 Não é esse'}
            </Btn>
          </div>

          <div className="aurum-ai-acoes" role="group" aria-label="Explorar decisão da IA">
            {top.length ? (
              <BotaoDetalhePremium
                icone="🔎"
                rotulo="NCMs analisados"
                contagem={top.length}
                variante="ia"
                titulo="Ver as pistas avaliadas — a referência preferida ganha selo + linha espectro"
                onClick={() => setModal('ncms')}
              />
            ) : null}
            {calculo ? (
              <BotaoDetalhePremium
                icone="🧮"
                rotulo="Simulação"
                titulo={`Simulação exemplificativa sobre ${fmtMoeda(VALOR_BASE_IA)} — abre em modal glass`}
                onClick={() => setModal('simulacao')}
              />
            ) : null}
            <BotaoDetalhePremium
              icone="📚"
              rotulo="Bases e auditoria"
              titulo="Fontes lidas + trilha de auditoria — abre em modal glass"
              onClick={() => setModal('auditoria')}
            />
          </div>

          <ModalNcmsAnalisados
            aberto={modal === 'ncms'}
            onFechar={() => setModal(null)}
            itens={top.map((c) => ({
              codigo: c.codigo,
              titulo: fmtNcm(c.codigo),
              subtitulo: c.descricao,
            }))}
            codigoPreferido={codigoIa}
            subtitulo={`A busca automática avaliou ${top.length} pista(s) — “${fmtNcm(codigoIa)}” foi a referência preferida (selo + linha espectro).`}
            onEscolher={(codigo) => void escolher(codigo)}
          />
          <ModalSimulacaoIA
            aberto={modal === 'simulacao'}
            onFechar={() => setModal(null)}
            titulo={`Simulação exemplificativa (${fmtMoeda(VALOR_BASE_IA)})`}
            nota={veredito?.exigeVerificacao ? 'Cálculo com a redução vigente (0% — alíquota cheia). A hipótese NÃO foi aplicada.' : undefined}
          >
            {calculo ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">IBS</div>
                  <div className="font-mono font-bold">{fmtMoeda(calculo.vIBS)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">CBS</div>
                  <div className="font-mono font-bold">{fmtMoeda(calculo.vCBS)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Tributos</div>
                  <div className="font-mono font-bold">{fmtMoeda(calculo.total)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Total c/ tributos</div>
                  <div className="font-mono font-bold">{fmtMoeda(calculo.base + calculo.total)}</div>
                </div>
              </div>
            ) : null}
          </ModalSimulacaoIA>
          <ModalAuditoriaIA
            aberto={modal === 'auditoria'}
            onFechar={() => setModal(null)}
            fontes={fontes}
            nota={`Decisão validada pelo resolvedor oficial; cálculo sobre ${fmtMoeda(VALOR_BASE_IA)} — trilha em \`audit_log\` + \`logs/consultas-ia.jsonl\`.`}
            extra={
              grafoCypher || caminhoGrafo?.length ? (
                <div className="space-y-2">
                  {caminhoGrafo?.length && provenienciaGrafo?.length ? (
                    <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-3 dark:bg-slate-950/40">
                      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Trilha do grafo ({via === 'grafo+ia' ? 'via:grafo+ia' : 'via:grafo'})</div>
                      <p className="mt-1 font-mono text-[11px]">{caminhoGrafo.join(' → ')}</p>
                      <ul className="mt-1 space-y-1 font-mono text-[11px] text-slate-500">
                        {provenienciaGrafo!.map((p, i) => (
                          <li key={i}>
                            {p.de} —[{p.tipo}/{p.origem} conf {p.confianca}
                            {p.anoReferencia ? ` ano ${p.anoReferencia}` : ''}]→ {p.para}
                          </li>
                        ))}
                      </ul>
                      {boostGrafo === 'uso_local' ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Boost de uso local: <span className="font-mono font-bold">uso_local +{Number(boostValorGrafo) || 0}</span> (teto 0.3, TTL 90d — só reordena).
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-slate-500">Relatório cita: {caminhoGrafo.join(' → ')}</p>
                    </div>
                  ) : null}
                  {grafoCypher ? (
                    <details className="rounded-xl border border-slate-200 bg-slate-950 p-3 dark:border-slate-800" open>
                      <summary className="cursor-pointer text-[11px] font-bold text-slate-300">Cypher executado</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-emerald-100">
                        {grafoCypher}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : undefined
            }
          />
        </>
      ) : (
        <>
          {top.length ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <strong>
                Encontradas {top.length} correspondência(s) na base oficial — confira a melhor pista abaixo.
              </strong>{' '}
              Para cravar o NCM, descreva com 1–2 detalhes (material, uso, estado) ou toque numa pista para
              classificar oficialmente.
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn
                  tam="sm"
                  disabled={feedbackEnviado}
                  onClick={() => {
                    void feedbackNegativo()
                    toast('Obrigado — registramos a ausência de decisão.', 'warn')
                  }}
                >
                  {feedbackEnviado ? '✓ Feedback registrado' : '👎 Não é esse'}
                </Btn>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <strong>Sem decisão segura — melhor refinar do que chutar.</strong>{' '}
              Não encontrei nenhuma referência na base oficial para essa descrição. Para acertar:
              1) descreva o produto com 1–2 detalhes (material, uso, estado);
              2) ou use a busca por nome com sinônimos do vocabulário oficial.
              <div className="mt-2">
                <Btn
                  tam="sm"
                  disabled={feedbackEnviado}
                  onClick={() => {
                    void feedbackNegativo()
                    toast('Obrigado — registramos a ausência de decisão.', 'warn')
                  }}
                >
                  {feedbackEnviado ? '✓ Feedback registrado' : '👎 Não é esse'}
                </Btn>
              </div>
            </div>
          )}
          {veredito ? (
            <details className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-2.5 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
              <summary className="cursor-pointer font-bold">
                🔎 Melhor pista (não é uma decisão)
              </summary>
              <p className="mt-1 leading-relaxed">{veredito.mensagemVigente}</p>
            </details>
          ) : null}
          {top.length ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="px-1 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  🔎 Correspondências na base oficial ({top.length}) — clique para classificar
                </div>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {top.slice(0, 8).map((c) => (
                    <button
                      key={c.codigo}
                      type="button"
                      onClick={() => void escolher(c.codigo)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-brand-50 dark:hover:bg-slate-800"
                      title={`Classificar ${fmtNcm(c.codigo)} oficialmente`}
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs font-bold text-brand-700 dark:text-aurum-200">
                          {fmtNcm(c.codigo)}
                        </span>
                        <span className="ml-2 truncate text-xs text-slate-600 dark:text-slate-300">
                          {c.descricao}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        oficial
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="aurum-ai-acoes" role="group" aria-label="Pistas avaliadas">
                <BotaoDetalhePremium
                  icone="🔎"
                  rotulo="Pistas avaliadas"
                  contagem={top.length}
                  variante="ia"
                  titulo="Ver as pistas avaliadas em modal glass"
                  onClick={() => setModal('ncms')}
                />
              </div>
            </div>
          ) : null}
          <ModalNcmsAnalisados
            aberto={modal === 'ncms'}
            onFechar={() => setModal(null)}
            itens={top.map((c) => ({ codigo: c.codigo, titulo: fmtNcm(c.codigo), subtitulo: c.descricao }))}
            codigoPreferido={codigoIa}
            subtitulo={
              top.length
                ? `A busca automática avaliou ${top.length} correspondência(s) da base oficial — toque para classificar oficialmente.`
                : `Nenhuma correspondência na base oficial para essa descrição.`
            }
            onEscolher={(codigo) => void escolher(codigo)}
          />
          <ModalAuditoriaIA
            aberto={modal === 'auditoria'}
            onFechar={() => setModal(null)}
            fontes={fontes}
            nota={`Sem decisão segura — trilha em \`audit_log\` + \`logs/consultas-ia.jsonl\`.`}
          />
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- sugestões -- */

function ListaSugestaoNcm({
  sugestoes,
  texto,
  baseVazia,
  carregandoBase,
  onEscolher,
}: {
  sugestoes: { codigo: string; codigoOriginal: string; descricao: string; dataFim?: string | null }[]
  texto: string
  baseVazia: boolean
  carregandoBase: boolean
  onEscolher: (codigo: string) => void
}) {
  const digitos = norm(texto)

  if (digitos.length < 2) {
    return (
      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        {carregandoBase ? (
          <>Carregando tabelas NCM… as sugestões aparecem em instantes.</>
        ) : baseVazia ? (
          <>
            As tabelas NCM vêm embutidas no programa — atualize o programa
            (Configurações ⚙ → 🔄 Atualização) para receber a vigência mais recente.
          </>
        ) : (
          'Digite pelo menos 2 dígitos para ver as sugestões…'
        )}
      </div>
    )
  }

  if (carregandoBase && !sugestoes.length) {
    return (
      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Carregando tabelas NCM…
        </div>
      </div>
    )
  }

  const visiveis = sugestoes.slice(0, SUGGEST_LIMITS.consulta)
  const restantes = sugestoes.length - visiveis.length

  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
      {sugestoes.length ? (
        <>
          {visiveis.map((n) => (
            <button
              key={n.codigo}
              type="button"
              className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-brand-900/30"
              onClick={() => onEscolher(n.codigo)}
            >
              <span className="whitespace-nowrap font-mono font-bold text-brand-700 dark:text-aurum-200">
                {n.codigoOriginal}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                {n.descricao}
              </span>
              {n.dataFim ? (
                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-800 dark:bg-red-950/60 dark:text-red-200" title={`Extinto em ${n.dataFim}`}>
                  ⛔ {n.dataFim}
                </span>
              ) : null}
            </button>
          ))}
          {restantes > 0 ? (
            <div className="px-3 py-1 text-[10px] text-slate-400">
              + {restantes} sugestões…
            </div>
          ) : null}
        </>
      ) : (
        <div className="px-3 py-2 text-xs text-slate-500">
          Nenhuma sugestão para &quot;{digitos}&quot;.
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------- busca por texto -- */

/** Destaca as palavras que casam com o termo (insensível a acento/caixa). */
function Destacar({ texto, termo }: { texto: string; termo: string }) {
  const tokens = tokensRelevantes(termo)
  if (!tokens.length) return <>{texto}</>
  const palavras = texto.split(/(\s+)/)
  return (
    <>
      {palavras.map((p, i) => {
        if (!p.trim()) return <span key={i}>{p}</span>
        const np = normalizarBusca(p)
        const hit = np.length >= 2 && tokens.some((t) => np.includes(t))
        return hit ? (
          <mark
            key={i}
            className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </>
  )
}

function ListaResultadoTexto({
  resultados,
  buscando,
  termo,
  baseVazia,
  carregandoBase,
  ativo,
  listaRef,
  onEscolher,
}: {
  resultados: ResultadoBuscaTexto[]
  buscando: boolean
  termo: string
  baseVazia: boolean
  carregandoBase: boolean
  ativo: number
  listaRef: React.RefObject<HTMLDivElement | null>
  onEscolher: (codigo: string) => void
}) {
  if (carregandoBase && baseVazia) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Carregando tabelas NCM…
        </div>
      </div>
    )
  }
  if (baseVazia) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        As tabelas NCM vêm embutidas no programa — atualize o programa
        (Configurações ⚙ → 🔄 Atualização) para receber a vigência mais recente.
      </div>
    )
  }
  if (termo.trim().length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        Digite pelo menos 2 letras — a busca é por texto livre; escolher um NCM é só por clique.
      </div>
    )
  }
  return (
    <div
      ref={listaRef}
      className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40"
      role="listbox"
      aria-label="Resultados da busca por nome"
    >
      {buscando && !resultados.length ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Buscando…
        </div>
      ) : resultados.length ? (
        <>
          <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {resultados.length} resultado{resultados.length > 1 ? 's' : ''} — clique para classificar · Enter pesquisa o texto atual
          </div>
          {resultados.map((n, i) => (
            <button
              key={n.codigo}
              type="button"
              role="option"
              aria-selected={i === ativo}
              data-indice={i}
              onClick={() => onEscolher(n.codigo)}
              className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition ${
                i === ativo ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-brand-50 dark:hover:bg-brand-900/30'
              }`}
            >
              <span className="whitespace-nowrap font-mono font-bold text-brand-700 dark:text-aurum-200">
                {n.codigoOriginal}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-700 dark:text-slate-200">
                  <Destacar texto={n.descricao} termo={termo} />
                </span>
                {n.caminho.length ? (
                  <span className="block truncate text-[10px] text-slate-400">
                    {n.caminho.join(' › ')}
                  </span>
                ) : null}
              </span>
              {n.totalClassificacoes > 0 ? (
                <span
                  className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                  title={`${n.totalClassificacoes} classificação(ões) na Reforma`}
                >
                  {n.totalClassificacoes} class.
                </span>
              ) : (
                <span
                  className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  title="Sem vínculo específico — cai na tributação integral"
                >
                  regra geral
                </span>
              )}
              {n.dataFim ? (
                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-800 dark:bg-red-950/60 dark:text-red-200" title={`Extinto em ${n.dataFim}`}>
                  ⛔
                </span>
              ) : null}
            </button>
          ))}
        </>
      ) : (
        <div className="px-3 py-2 text-xs text-slate-500">
          Nenhum NCM para &quot;{termo.trim()}&quot;. Tente um sinônimo (ex.: &quot;frango&quot; em vez de
          &quot;galeto&quot;).
        </div>
      )}
    </div>
  )
}
