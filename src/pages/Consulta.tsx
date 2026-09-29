/**
 * Tela **Consulta NCM** (SPEC §5).
 *
 * Busca por NCM com sugestões da nomenclatura vigente e painel com **0/1/N**
 * classificações resolvidas pelo repositório (`resolverClassificacoes`).
 *
 * Além do NCM, a aba **texto** aceita o nome do produto ("queijo mozarela"):
 * a busca opera sobre o caminho hierárquico completo da nomenclatura, de modo
 * que itens como `0406.10.10` ("Mozarela") são achados por "queijo". Escolher
 * um resultado classifica o NCM imediatamente (mesmo painel do modo NCM).
 *
 * Regras preservadas da v1:
 * - NCM precisa de exatamente 8 dígitos (`avisoInvalido`);
 * - 0 vínculos → cartão de **tributação integral** (regra geral);
 * - N > 1 → aviso âmbar "possui N classificações possíveis";
 * - "Salvar como produto" abre o modal da página, nunca escreve direto;
 * - "Adicionar à calculadora" abre o **modal de cálculo** (qtd, valor e
 *   prévia) — a pesquisa não é interrompida por uma troca de tela.
 */
import { useEffect, useRef, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import { MASK, norm } from '@/domain/services/format'
import { normalizarBusca, tokenizarBusca } from '@/domain/services/busca-texto'
import { ModalSalvarClass } from '@/modais/pagina'
import { ModalReclassificacao } from '@/modais/reclassificacao'
import { useBase } from '@/store/base'
import { useConsulta } from '@/store/consulta'
import { toast, useUi } from '@/store/ui'
import { CartaoClassificacao, CartaoTributacaoIntegral, type BloqueioSistema } from '@/ui/cartoes'
import { Btn, Painel, Texto, Vazio } from '@/ui/kit'
import { SUGGEST_LIMITS } from '@/domain/constants'
import type { ResultadoBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { bloqueiosParaCcts } from '@/application/cff-sync'

/** Debounce das sugestões (paridade com os 150 ms da v1). */
const DEBOUNCE_SUGESTAO = 150

export function Consulta() {
  const codigo = useConsulta((s) => s.codigo)
  const setCodigo = useConsulta((s) => s.setCodigo)
  const consultar = useConsulta((s) => s.consultar)
  const limpar = useConsulta((s) => s.limpar)
  const buscarSugestoes = useConsulta((s) => s.buscarSugestoes)
  const sugestoes = useConsulta((s) => s.sugestoes)
  const resultados = useConsulta((s) => s.resultados)
  const nomenclatura = useConsulta((s) => s.nomenclatura)
  const regraGeral = useConsulta((s) => s.regraGeral)
  const avisoInvalido = useConsulta((s) => s.avisoInvalido)
  const carregando = useConsulta((s) => s.carregando)

  const modo = useConsulta((s) => s.modo)
  const setModo = useConsulta((s) => s.setModo)
  const buscaTexto = useConsulta((s) => s.buscaTexto)
  const setBuscaTexto = useConsulta((s) => s.setBuscaTexto)
  const buscarTexto = useConsulta((s) => s.buscarTexto)
  const escolherTexto = useConsulta((s) => s.escolherTexto)
  const resultadosTexto = useConsulta((s) => s.resultadosTexto)
  const buscandoTexto = useConsulta((s) => s.buscandoTexto)

  const abrirCalc = useUi((s) => s.abrirCalc)
  const nomenclaturaBase = useBase((s) => s.status?.nomenclatura ?? 0)

  const [paraSalvar, setParaSalvar] = useState<Classificacao | null>(null)
  const [reclassificando, setReclassificando] = useState(false)
  const [bloqueios, setBloqueios] = useState<Record<string, BloqueioSistema[]>>({})
  const [ativoTexto, setAtivoTexto] = useState(0)
  const listaTextoRef = useRef<HTMLDivElement>(null)

  // Sugestões com debounce (paridade com o `input` listener da v1).
  useEffect(() => {
    if (modo !== 'ncm') return
    const t = window.setTimeout(() => void buscarSugestoes(codigo), DEBOUNCE_SUGESTAO)
    return () => window.clearTimeout(t)
  }, [codigo, buscarSugestoes, modo])

  // Busca textual com debounce — fluida enquanto digita, sem Enter.
  useEffect(() => {
    if (modo !== 'texto') return
    setAtivoTexto(0)
    const t = window.setTimeout(() => void buscarTexto(buscaTexto), DEBOUNCE_SUGESTAO)
    return () => window.clearTimeout(t)
  }, [buscaTexto, buscarTexto, modo])

  // Permitido × negado por DFe (tabela CFF local) para os cClassTribs exibidos.
  // Sem cobertura local, os cartões não afirmam nada (sem selos).
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

  const submeter = () => void consultar()
  const aoEscolher = (c: string) => {
    setCodigo(MASK.ncm(c))
    void consultar(c)
  }
  const aoEscolherTexto = (c: string) => void escolherTexto(c)

  const aoTeclaTexto = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && resultadosTexto.length) {
      e.preventDefault()
      setAtivoTexto((a) => Math.min(a + 1, resultadosTexto.length - 1))
    } else if (e.key === 'ArrowUp' && resultadosTexto.length) {
      e.preventDefault()
      setAtivoTexto((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && resultadosTexto.length) {
      e.preventDefault()
      const alvo = resultadosTexto[Math.min(ativoTexto, resultadosTexto.length - 1)]
      if (alvo) aoEscolherTexto(alvo.codigo)
    } else if (e.key === 'Escape') {
      setBuscaTexto('')
      void buscarTexto('')
    }
  }

  // Mantém o item ativo visível durante a navegação por teclado.
  useEffect(() => {
    listaTextoRef.current
      ?.querySelector(`[data-indice="${ativoTexto}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [ativoTexto])

  const vazio = avisoInvalido && !resultados.length

  return (
    <div className="mx-auto max-w-5xl">
      <Painel>
        <div className="p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">🔍</span> Consulta por NCM
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {modo === 'ncm'
              ? 'Aceita 8 dígitos com ou sem pontuação. Sugestões aparecem automaticamente conforme você digita.'
              : 'Digite o nome do produto (ex.: queijo mozarela). A busca usa a descrição oficial completa da nomenclatura.'}
          </p>

          <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Modo de consulta">
            <button
              type="button"
              role="tab"
              aria-selected={modo === 'ncm'}
              onClick={() => setModo('ncm')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                modo === 'ncm'
                  ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-aurum-200'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              🔢 Por NCM
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modo === 'texto'}
              onClick={() => setModo('texto')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                modo === 'texto'
                  ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-aurum-200'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              📝 Por nome do produto
            </button>
          </div>

          {modo === 'ncm' ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="field-wrap min-w-[220px] flex-1">
                  <span className="field-icon">🔢</span>
                  <Texto
                    mask="ncm"
                    mono
                    grande
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder="0201.10.00"
                    value={codigo}
                    erro={avisoInvalido}
                    onChange={(e) => setCodigo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submeter()
                    }}
                  />
                </div>
                <Btn variante="primary" onClick={submeter}>
                  Classificar
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

              <ListaSugestaoNcm
                sugestoes={sugestoes}
                texto={codigo}
                baseVazia={nomenclaturaBase === 0}
                onEscolher={aoEscolher}
              />
            </>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="field-wrap min-w-[220px] flex-1">
                  <span className="field-icon">📝</span>
                  <Texto
                    grande
                    autoComplete="off"
                    placeholder="Ex.: queijo mozarela, carne bovina, parafuso…"
                    value={buscaTexto}
                    onChange={(e) => setBuscaTexto(e.target.value)}
                    onKeyDown={aoTeclaTexto}
                    aria-label="Buscar pelo nome do produto"
                  />
                </div>
                <Btn
                  onClick={() => {
                    setBuscaTexto('')
                    void buscarTexto('')
                    toast('Busca limpa.', 'warn')
                  }}
                >
                  Limpar
                </Btn>
              </div>

              <ListaResultadoTexto
                resultados={resultadosTexto}
                buscando={buscandoTexto}
                termo={buscaTexto}
                baseVazia={nomenclaturaBase === 0}
                ativo={ativoTexto}
                listaRef={listaTextoRef}
                onAtivo={setAtivoTexto}
                onEscolher={aoEscolherTexto}
              />
            </>
          )}
        </div>
      </Painel>

      <div className="mt-6 space-y-4">
        {carregando ? (
          <Painel className="p-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <div className="mt-3 text-sm text-slate-500">Classificando…</div>
          </Painel>
        ) : vazio ? (
          <Painel className="p-8 text-center">
            <div className="text-3xl">⌨️</div>
            <div className="mt-2 text-sm font-semibold">Informe um NCM de 8 dígitos.</div>
          </Painel>
        ) : resultados.length ? (
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
                  onSalvar={() => setParaSalvar(resultados[0].classificacao)}
                  onAddCalc={() => abrirCalc({ tipo: 'classificacao', classificacao: resultados[0].classificacao })}
                  onReclassificar={() => setReclassificando(true)}
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
                    onSalvar={() => setParaSalvar(r.classificacao)}
                    onAddCalc={() => abrirCalc({ tipo: 'classificacao', classificacao: r.classificacao })}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <Vazio
            icone="🔍"
            titulo={modo === 'texto' ? 'Busque pelo nome do produto acima' : 'Digite um NCM para classificar'}
            texto="A base oficial da Reforma (LC 214/2025) retorna 0, 1 ou várias classificações tributárias para cada NCM."
          />
        )}
      </div>

      <ModalSalvarClass
        aberto={paraSalvar !== null}
        classificacao={paraSalvar}
        onFechar={() => setParaSalvar(null)}
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
    </div>
  )
}

/* -------------------------------------------------------------- sugestões -- */

function ListaSugestaoNcm({
  sugestoes,
  texto,
  baseVazia,
  onEscolher,
}: {
  sugestoes: { codigo: string; codigoOriginal: string; descricao: string; dataFim?: string | null }[]
  texto: string
  baseVazia: boolean
  onEscolher: (codigo: string) => void
}) {
  const digitos = norm(texto)

  if (digitos.length < 2) {
    return (
      <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        {baseVazia ? (
          <>
            Importe a <strong>nomenclatura NCM</strong> (Configurações ⚙) ou cadastre em{' '}
            <strong>Tabelas auxiliares</strong>.
          </>
        ) : (
          'Digite pelo menos 2 dígitos para ver as sugestões…'
        )}
      </div>
    )
  }

  const visiveis = sugestoes.slice(0, SUGGEST_LIMITS.consulta)
  const restantes = sugestoes.length - visiveis.length

  return (
    <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
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
  ativo,
  listaRef,
  onAtivo,
  onEscolher,
}: {
  resultados: ResultadoBuscaTexto[]
  buscando: boolean
  termo: string
  baseVazia: boolean
  ativo: number
  listaRef: React.RefObject<HTMLDivElement | null>
  onAtivo: (n: number) => void
  onEscolher: (codigo: string) => void
}) {
  if (baseVazia) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        Importe a <strong>nomenclatura NCM</strong> (Configurações ⚙) ou cadastre em{' '}
        <strong>Tabelas auxiliares</strong>.
      </div>
    )
  }
  if (termo.trim().length < 2) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        Digite pelo menos 2 letras — use ↑ ↓ para navegar e Enter para classificar.
      </div>
    )
  }
  return (
    <div
      ref={listaRef}
      className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40"
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
