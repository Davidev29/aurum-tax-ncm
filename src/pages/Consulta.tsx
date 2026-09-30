/**
 * Tela **Consulta NCM** — busca unificada (SPEC §5, revisão input único).
 *
 * Um único input orquestra 3 workers em paralelo (fan-out por intenção):
 * - dígitos (≥2) → seção **Exata · via número** (`sugerirNomenclatura` +
 *   `resolverClassificacoes` quando 8 dígitos);
 * - texto (≥2 chars) → seção **Por nome** (`buscarNomenclaturaPorTexto`);
 * - frase expressiva → seção **Predição assistiva** (`classificarPorDescricao`).
 *
 * Cada seção tem skeleton próprio enquanto seu worker resolve — sensação de
 * processamento contínuo, sem "piscar" vazio. Escolher qualquer resultado
 * ancora no painel oficial (0/1/N + regra geral).
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
import { MASK, norm } from '@/domain/services/format'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'
import { normalizarBusca, tokenizarBusca } from '@/domain/services/busca-texto'
import { ModalSalvarClass } from '@/modais/pagina'
import { ModalReclassificacao } from '@/modais/reclassificacao'
import { useBase } from '@/store/base'
import { useConsulta } from '@/store/consulta'
import { toast, useUi } from '@/store/ui'
import { CartaoClassificacao, CartaoTributacaoIntegral, type BloqueioSistema } from '@/ui/cartoes'
import { Btn, Painel, Texto, Vazio } from '@/ui/kit'
import {
  SecaoCarregando,
  SkeletonCartaoClassificacao,
  SkeletonListaSugestoes,
  SkeletonPredicao,
} from '@/ui/skeleton'
import { SUGGEST_LIMITS } from '@/domain/constants'
import type { ResultadoBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { bloqueiosParaCcts } from '@/application/cff-sync'

/** Debounce do fan-out leve (prefixo NCM + nome) — paridade com os 150 ms da v1. */
const DEBOUNCE_RAPIDO = 150
/** Debounce da predição assistiva (worker mais caro — evita disparo a cada tecla). */
const DEBOUNCE_DESCRICAO = 600

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

  const entrada = useConsulta((s) => s.entrada)
  const setEntrada = useConsulta((s) => s.setEntrada)
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

  const abrirCalc = useUi((s) => s.abrirCalc)
  const nomenclaturaBase = useBase((s) => s.status?.nomenclatura ?? 0)
  const basePronta = useBase((s) => s.pronta)

  const [paraSalvar, setParaSalvar] = useState<Classificacao | null>(null)
  const prefillSalvar = useConsulta((s) => s.prefillSalvar)
  const setPrefillSalvar = useConsulta((s) => s.setPrefillSalvar)
  const [reclassificando, setReclassificando] = useState(false)
  const [bloqueios, setBloqueios] = useState<Record<string, BloqueioSistema[]>>({})
  const [ativoTexto, setAtivoTexto] = useState(0)
  const listaTextoRef = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])

  const intencao = useMemo(() => detectarIntencaoConsulta(entrada), [entrada])
  const mostrarExata = intencao.deveBuscarExato
  const mostrarNome = intencao.deveBuscarNome
  const mostrarDescricao = intencao.deveBuscarDescricao || classificando || !!sugestao

  // Compat: fluxos legados (Produtos → Ver/Editar) chegam via `codigo`.
  // Espelha no input único uma vez por navegação.
  const codigoJaEspelhado = useRef('')
  useEffect(() => {
    const dig = norm(codigo)
    if (dig.length === 8 && dig !== norm(codigoJaEspelhado.current) && norm(entrada) !== dig) {
      codigoJaEspelhado.current = codigo
      setEntrada(MASK.ncm(codigo))
    }
  }, [codigo, entrada, setEntrada])

  // Fan-out com duplo debounce: leve (150 ms) para prefixo/nome/exato,
  // pesado (600 ms) para a predição assistiva.
  useEffect(() => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    setAtivoTexto(0)
    const atual = entrada
    if (!atual.trim()) return
    const inten = detectarIntencaoConsulta(atual)
    const t1 = window.setTimeout(() => {
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

  const submeter = () => void consultarUnificada(entrada)
  const aoEscolher = (c: string) => void escolherUnificada(c)
  const aoEscolherTexto = (c: string) => void escolherUnificada(c)

  const aoTecla = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Com resultados por nome, Enter classifica o item ativo; senão, fan-out total.
      if (mostrarNome && resultadosTexto.length) {
        e.preventDefault()
        const alvo = resultadosTexto[Math.min(ativoTexto, resultadosTexto.length - 1)]
        if (alvo) aoEscolherTexto(alvo.codigo)
      } else {
        submeter()
      }
    } else if (e.key === 'ArrowDown' && resultadosTexto.length) {
      e.preventDefault()
      setAtivoTexto((a) => Math.min(a + 1, resultadosTexto.length - 1))
    } else if (e.key === 'ArrowUp' && resultadosTexto.length) {
      e.preventDefault()
      setAtivoTexto((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Escape') {
      limpar()
      toast('Consulta limpa.', 'warn')
    }
  }

  useEffect(() => {
    listaTextoRef.current
      ?.querySelector(`[data-indice="${ativoTexto}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [ativoTexto])

  const exatoPronto = intencao.deveClassificarExato && resultados.length > 0
  const algumaCarga = carregando || buscandoTexto || classificando

  return (
    <div className="mx-auto max-w-5xl">
      <Painel>
        <div className="p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">🔍</span> Consulta por NCM
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Digite o NCM, o nome do produto ou descreva com suas palavras — o sistema roteia
            automaticamente e mostra cada fonte em sua seção.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="field-wrap min-w-[220px] flex-1">
              <span className="field-icon">🔍</span>
              <Texto
                grande
                autoComplete="off"
                placeholder="0201.10.00 · queijo mozarela · boi vivo Nelore para reprodução…"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
                onKeyDown={aoTecla}
                aria-label="Busca unificada: NCM, nome do produto ou descrição"
              />
            </div>
            <Btn variante="primary" onClick={submeter}>
              Buscar
            </Btn>
            <Btn
              onClick={() => {
                limpar()
                toast('Consulta limpa.', 'warn')
              }}
            >
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
            {algumaCarga ? (
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
          </div>

          <details className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            <summary className="cursor-pointer font-semibold">
              Refinar predição (destinação, composição, uso — opcional)
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="field-wrap">
                <Texto
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
          </details>
        </div>
      </Painel>

      {!entrada.trim() ? (
        <div className="mt-6">
          <Vazio
            icone="🔍"
            titulo="Busque por número, nome ou descrição"
            texto="Ex.: 0201.10.00 (exato) · queijo mozarela (nome) · boi vivo Nelore para reprodução (predição assistiva). A base oficial da Reforma (LC 214/2025) retorna 0, 1 ou várias classificações por NCM."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {mostrarExata ? (
            <section aria-label="Resultado exato via número" className="space-y-3">
              <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">
                  🔢 Exato · via número
                </span>
                {carregando ? <span>Classificando…</span> : null}
              </h3>
              {carregando ? (
                <SecaoCarregando titulo="Classificando NCM…">
                  <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
                    <SkeletonListaSugestoes linhas={3} />
                  </div>
                  <SkeletonCartaoClassificacao />
                </SecaoCarregando>
              ) : intencao.deveClassificarExato ? (
                <PainelExato
                  avisoInvalido={avisoInvalido}
                  resultados={resultados}
                  nomenclatura={nomenclatura}
                  regraGeral={regraGeral}
                  bloqueios={bloqueios}
                  onSalvar={setParaSalvar}
                  onAddCalc={abrirCalc}
                  onReclassificar={() => setReclassificando(true)}
                />
              ) : (
                <ListaSugestaoNcm
                  sugestoes={sugestoes}
                  texto={intencao.digitos}
                  baseVazia={nomenclaturaBase === 0}
                  carregandoBase={!basePronta}
                  onEscolher={aoEscolher}
                />
              )}
            </section>
          ) : null}

          {mostrarNome ? (
            <section aria-label="Resultados por nome do produto" className="space-y-3">
              <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                  📝 Por nome do produto
                </span>
                {buscandoTexto ? <span>Buscando…</span> : null}
              </h3>
              {buscandoTexto && !resultadosTexto.length ? (
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
                  onAtivo={setAtivoTexto}
                  onEscolher={aoEscolherTexto}
                />
              )}
            </section>
          ) : null}

          {mostrarDescricao ? (
            <section aria-label="Predição assistiva por descrição" className="space-y-3">
              <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                  ✨ Predição assistiva · por descrição
                </span>
                {classificando ? <span>Analisando…</span> : null}
              </h3>
              {classificando && !sugestao ? (
                <SecaoCarregando titulo="Prevendo NCM…">
                  <SkeletonPredicao />
                </SecaoCarregando>
              ) : (
                <SecaoPredicao entrada={entrada} />
              )}
            </section>
          ) : null}

          {!mostrarExata && !mostrarNome && !mostrarDescricao ? (
            <Vazio
              icone="⌨️"
              titulo="Continue digitando para ver as seções"
              texto="Com 2+ dígitos mostramos o exato · com letras, o nome · com frase expressiva, a predição assistiva."
            />
          ) : null}
        </div>
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
  onSalvar,
  onAddCalc,
  onReclassificar,
}: {
  avisoInvalido: boolean
  resultados: ReturnType<typeof useConsulta.getState>['resultados']
  nomenclatura: ReturnType<typeof useConsulta.getState>['nomenclatura']
  regraGeral: boolean
  bloqueios: Record<string, BloqueioSistema[]>
  onSalvar: (c: Classificacao) => void
  onAddCalc: ReturnType<typeof useUi.getState>['abrirCalc']
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
      {nomenclatura ? (
        <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-aurum-200">
            <span>NCM {nomenclatura.codigoOriginal}</span>
            {nomenclatura.dataFim ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-950/60 dark:text-red-200">
                ⛔ Extinto em {nomenclatura.dataFim}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                ✓ Vigente
              </span>
            )}
          </div>
          <div className="mt-1 text-sm font-semibold text-brand-900 dark:text-brand-100">
            {nomenclatura.descricao}
          </div>
          {nomenclatura.ato ? (
            <div className="mt-1 text-[10px] text-brand-700 dark:text-brand-300">
              📎 {nomenclatura.ato}
              {nomenclatura.dataInicio ? ` · desde ${nomenclatura.dataInicio}` : ''}
              {nomenclatura.dataFim ? ` · até ${nomenclatura.dataFim}${nomenclatura.atoFim ? ` · ${nomenclatura.atoFim}` : ''}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}

      {!regraGeral && resultados.length > 1 ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>⚡ Este NCM possui {resultados.length} classificações possíveis.</strong>{' '}
          Compare as opções abaixo.
        </div>
      ) : null}

      <div className="space-y-4">
        {regraGeral ? (
          <CartaoTributacaoIntegral
            cl={resultados[0].classificacao}
            nomenclatura={nomenclatura}
            bloqueios={bloqueios[resultados[0].classificacao.cClassTrib] ?? null}
            onSalvar={() => onSalvar(resultados[0].classificacao)}
            onAddCalc={() => onAddCalc({ tipo: 'classificacao', classificacao: resultados[0].classificacao })}
            onReclassificar={onReclassificar}
          />
        ) : (
          resultados.map((r, i) => (
            <CartaoClassificacao
              key={r.__uid}
              cl={r.classificacao}
              indice={i}
              total={resultados.length}
              nomenclatura={nomenclatura}
              bloqueios={bloqueios[r.classificacao.cClassTrib] ?? null}
              onSalvar={() => onSalvar(r.classificacao)}
              onAddCalc={() => onAddCalc({ tipo: 'classificacao', classificacao: r.classificacao })}
              onReclassificar={r.manual ? onReclassificar : undefined}
            />
          ))
        )}
      </div>
    </>
  )
}

/* --------------------------------------- predição assistiva (seção) -- */

/**
 * Seção **✨ Predição assistiva**: exibe o JSON ancorado da
 * `classificarPorDescricao` e ancora no painel oficial via `usarSugestao`.
 */
function SecaoPredicao({ entrada }: { entrada: string }) {
  const sugestao = useConsulta((s) => s.sugestao)
  const classificando = useConsulta((s) => s.classificandoDescricao)
  const usarSugestao = useConsulta((s) => s.usarSugestao)

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

  if (classificando && sugestao) {
    // Troca de frase com resultado anterior visível: mostra o anterior +
    // indicador de reprocessamento (sem piscar vazio).
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          Refinando predição para “{entrada.trim()}”…
        </div>
        <ConteudoSugestao
          sugestao={sugestao}
          jsonPedido={jsonPedido}
          corConfianca={corConfianca}
          onUsar={() => {
            void usarSugestao()
            toast('NCM sugerido enviado para classificação oficial.', 'ok')
          }}
        />
      </div>
    )
  }

  if (!sugestao) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        Descreva com mais contexto (ex.: “vivo”, “para plantio”, “com sal”) para a predição
        assistiva sugerir o NCM — sempre ancorada na nomenclatura vigente.
      </div>
    )
  }

  return (
    <ConteudoSugestao
      sugestao={sugestao}
      jsonPedido={jsonPedido}
      corConfianca={corConfianca}
      onUsar={() => {
        void usarSugestao()
        toast('NCM sugerido enviado para classificação oficial.', 'ok')
      }}
    />
  )
}

function ConteudoSugestao({
  sugestao,
  jsonPedido,
  corConfianca,
  onUsar,
}: {
  sugestao: NonNullable<ReturnType<typeof useConsulta.getState>['sugestao']>
  jsonPedido: Record<string, unknown> | null
  corConfianca: string
  onUsar: () => void
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2">
        {sugestao.ncm_provavel ? (
          <span className="font-mono text-sm font-black text-brand-700 dark:text-aurum-200">
            {sugestao.ncm_provavel}
          </span>
        ) : (
          <span className="text-sm font-bold text-slate-500">Sem sugestão segura</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${corConfianca}`}>
          confiança {sugestao.confianca}
        </span>
        {sugestao.excecao_enquadravel ? (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
            ⚡ {sugestao.tipo_excecao}
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            sem exceção enquadrável
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{sugestao.justificativa}</p>

      {sugestao.descricao_ncm ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Descrição oficial: <strong>{sugestao.descricao_ncm}</strong>
          {sugestao.cst && sugestao.cClassTrib ? (
            <> · vínculo oficial {sugestao.cst}/{sugestao.cClassTrib}</>
          ) : (
            <> · sem vínculo — tributação integral (regra geral)</>
          )}
        </p>
      ) : null}

      {sugestao.alternativas.length ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Alternativas: <span className="font-mono">{sugestao.alternativas.join(' · ')}</span>
        </p>
      ) : null}

      {sugestao.ncm_provavel ? (
        <Btn variante="primary" tam="sm" onClick={onUsar}>
          Classificar {sugestao.ncm_provavel} oficialmente
        </Btn>
      ) : null}

      {sugestao.perguntasComplementares.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>❓ Para refinar:</strong>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {sugestao.perguntasComplementares.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="text-[11px] text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer font-semibold">Ver raciocínio (etapas) e JSON</summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          {sugestao.trilha.map((t, i) => (
            <li key={i}>
              <strong>{t.etapa}:</strong> {t.detalhe}
            </li>
          ))}
        </ol>
        {jsonPedido ? (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[10px] leading-relaxed text-emerald-100 dark:bg-black">
            {JSON.stringify(jsonPedido, null, 2)}
          </pre>
        ) : null}
      </details>

      <p className="text-[10px] text-slate-400">
        Sugestão assistiva ancorada na nomenclatura vigente + vínculos da LC 214/2025. A classificação fiscal
        vale pelo painel oficial — use “Classificar oficialmente”.
      </p>
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
  const tokens = tokenizarBusca(termo)
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
  onAtivo,
  onEscolher,
}: {
  resultados: ResultadoBuscaTexto[]
  buscando: boolean
  termo: string
  baseVazia: boolean
  carregandoBase: boolean
  ativo: number
  listaRef: React.RefObject<HTMLDivElement | null>
  onAtivo: (n: number) => void
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
        Digite pelo menos 2 letras — use ↑ ↓ para navegar e Enter para classificar.
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
            {resultados.length} resultado{resultados.length > 1 ? 's' : ''} — clique ou Enter para classificar
          </div>
          {resultados.map((n, i) => (
            <button
              key={n.codigo}
              type="button"
              role="option"
              aria-selected={i === ativo}
              data-indice={i}
              onMouseEnter={() => onAtivo(i)}
              onFocus={() => onAtivo(i)}
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
