/**
 * Tela **Consulta Serviços (NBS)** — Phase 7.
 *
 * Dois modos:
 * - **Manual**: input único (NBS 9 dígitos, nome do serviço ou descrição) com
 *   fan-out exato + nome + ✨ Aurum AI, e painel oficial 0/1/N;
 * - **Por CNPJ**: digita o CNPJ → BrasilAPI → 1 cartão elegante por CNAE com
 *   a tributação possível (NBS + CST/cClassTrib + alíquotas + confiança).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import { NOME_IA } from '@/domain/aurum-ai'
import { fmtCnpj, fmtNbs, MASK, norm } from '@/domain/services/format'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'
import { ModalSalvarClass } from '@/modais/pagina'
import { useServicos } from '@/store/consulta-servicos'
import { toast, useUi } from '@/store/ui'
import { CartaoEnxuto } from '@/ui/consulta-enxuta'
import {
  BarraConfiancaAurumAI,
  CarregandoAurumAI,
  IconeAurumPremium,
  MolduraAurumAI,
  SeloAurumAI,
  StatusAurumAI,
} from '@/ui/aurum-ai'
import { Btn, Painel, Texto, Vazio } from '@/ui/kit'
import { Entrada, Revelar } from '@/ui/motion'
import { CartaoCnae, DetalhesPerguntasServicos, FichaEmpresaCnpj, BlocoContextoNbs } from '@/ui/servicos'

const DEBOUNCE_MS = 3000

export function ConsultaServicos() {
  const modo = useServicos((s) => s.modo)
  const setModo = useServicos((s) => s.setModo)
  const entradaStore = useServicos((s) => s.entrada)
  const setEntradaStore = useServicos((s) => s.setEntrada)
  const consultarUnificada = useServicos((s) => s.consultarUnificada)
  const escolherUnificada = useServicos((s) => s.escolherUnificada)

  const [entrada, setEntradaLocal] = useState(entradaStore)
  const ultimoCommit = useRef(entradaStore)
  const timers = useRef<number[]>([])

  const resultados = useServicos((s) => s.resultados)
  const regraGeral = useServicos((s) => s.regraGeral)
  const avisoInvalido = useServicos((s) => s.avisoInvalido)
  const carregando = useServicos((s) => s.carregando)
  const sugestoes = useServicos((s) => s.sugestoes)
  const resultadosTexto = useServicos((s) => s.resultadosTexto)
  const buscandoTexto = useServicos((s) => s.buscandoTexto)

  const destinatario = useServicos((s) => s.destinatario)
  const setDestinatario = useServicos((s) => s.setDestinatario)
  const localPrestacaoValor = useServicos((s) => s.localPrestacao)
  const setLocalPrestacao = useServicos((s) => s.setLocalPrestacao)
  const usoServico = useServicos((s) => s.usoServico)
  const setUsoServico = useServicos((s) => s.setUsoServico)
  const sugestao = useServicos((s) => s.sugestao)
  const classificando = useServicos((s) => s.classificandoDescricao)
  const classificarDescricao = useServicos((s) => s.classificarDescricao)
  const via = useServicos((s) => s.via)
  const usarSugestaoIa = useServicos((s) => s.usarSugestaoIa)
  const codigoIa = useServicos((s) => s.codigoIa)
  const decisaoIa = useServicos((s) => s.decisaoIa)
  const confiancaIa = useServicos((s) => s.confiancaIa)
  const feedbackEnviado = useServicos((s) => s.feedbackIaEnviado)
  const feedbackNegativo = useServicos((s) => s.feedbackIaNegativo)

  const cnpjEntrada = useServicos((s) => s.cnpjEntrada)
  const setCnpjEntrada = useServicos((s) => s.setCnpjEntrada)
  const buscandoCnpj = useServicos((s) => s.buscandoCnpj)
  const vereditoEmpresa = useServicos((s) => s.vereditoEmpresa)
  const erroCnpj = useServicos((s) => s.erroCnpj)
  const consultarCnpj = useServicos((s) => s.consultarCnpj)

  const abrirCalc = useUi((s) => s.abrirCalc)
  const [paraSalvar, setParaSalvar] = useState<Classificacao | null>(null)

  const intencao = useMemo(() => detectarIntencaoConsulta(entrada, 'nbs'), [entrada])
  const mostrarExata = intencao.deveBuscarExato && norm(entrada).length !== 8
  const mostrarNome = intencao.deveBuscarNome
  const mostrarDescricao = intencao.deveBuscarDescricao || classificando || !!sugestao
  const ehExatoNbs = norm(entrada).length === 9 && !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(entrada)
  const prioridadeIA = !ehExatoNbs && mostrarDescricao

  useEffect(() => {
    if (entradaStore !== ultimoCommit.current && entradaStore !== entrada) {
      ultimoCommit.current = entradaStore
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntradaLocal(entradaStore)
    }
  }, [entradaStore, entrada])

  useEffect(() => {
    if (modo !== 'manual') return
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    const atual = entrada
    if (!atual.trim()) {
      ultimoCommit.current = ''
      setEntradaStore('')
      void consultarUnificada('')
      return
    }
    const t1 = window.setTimeout(() => {
      ultimoCommit.current = atual
      setEntradaStore(atual)
      void consultarUnificada(atual)
    }, DEBOUNCE_MS)
    timers.current.push(t1)
    return () => {
      for (const t of timers.current) window.clearTimeout(t)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada, modo, destinatario, usoServico])

  const limparTudo = (anunciar = true) => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    ultimoCommit.current = ''
    setEntradaLocal('')
    useServicos.getState().limpar()
    if (anunciar) toast('Consulta limpa.', 'warn')
  }

  const submeter = () => {
    if (!entrada.trim()) {
      limparTudo(false)
      return
    }
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    ultimoCommit.current = entrada
    setEntradaStore(entrada)
    void consultarUnificada(entrada)
  }

  const aoTecla = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submeter()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      limparTudo()
    }
  }

  const submeterCnpj = (forcar = false) => {
    void consultarCnpj(cnpjEntrada, forcar)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Entrada>
      <Painel>
        <div className="p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">🧾</span> Consulta de Serviços (NBS)
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Manual: digite o NBS (9 dígitos), o nome do serviço ou descreva com suas palavras. Por CNPJ:
            puxamos as atividades da empresa na Receita (BrasilAPI) e mostramos a tributação possível de cada uma.
          </p>

          <div className="mt-3 flex gap-2" role="tablist" aria-label="Modo de consulta de serviços">
            {(['manual', 'cnpj'] as const).map((m) => (
              <Btn
                key={m}
                tam="sm"
                variante={modo === m ? 'primary' : undefined}
                onClick={() => setModo(m)}
              >
                {m === 'manual' ? '🔍 Manual' : '🏢 Por CNPJ'}
              </Btn>
            ))}
          </div>

          {modo === 'manual' ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="field-wrap min-w-[220px] flex-1">
                  <span className="field-icon">🔍</span>
                  <Texto
                    grande
                    id="busca-servicos"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="122.011.100 · aula de inglês · fisioterapia domiciliar…"
                    value={entrada}
                    onChange={(e) => setEntradaLocal(e.target.value)}
                    onKeyDown={aoTecla}
                    aria-label="Busca de serviços: NBS, nome ou descrição. Enter pesquisa."
                  />
                </div>
                <Btn variante="primary" onClick={submeter}>
                  Buscar
                </Btn>
                <Btn onClick={() => limparTudo()}>Limpar</Btn>
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
                    {NOME_IA} pensando…
                  </span>
                ) : carregando || buscandoTexto ? (
                  <span className="flex items-center gap-1.5 font-semibold text-brand-600 dark:text-aurum-200">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                    Processando…
                  </span>
                ) : null}
              </div>

              <details className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    <IconeAurumPremium tamanho="sm" /> Refinar resposta da IA (tomador, local — opcional)
                  </span>
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="field-wrap">
                    <Texto autoComplete="off" placeholder="Tomador (opcional): empresa, exterior…" value={destinatario} onChange={(e) => setDestinatario(e.target.value)} aria-label="Tomador do serviço" />
                  </div>
                  <div className="field-wrap">
                    <Texto autoComplete="off" placeholder="Local (opcional): presencial, online…" value={localPrestacaoValor} onChange={(e) => setLocalPrestacao(e.target.value)} aria-label="Local da prestação" />
                  </div>
                  <div className="field-wrap">
                    <Texto autoComplete="off" placeholder="Uso (opcional): produção nacional…" value={usoServico} onChange={(e) => setUsoServico(e.target.value)} aria-label="Uso do serviço" />
                  </div>
                </div>
                <div className="mt-2">
                  <Btn tam="sm" variante="primary" disabled={!entrada.trim()} carregando={classificando} onClick={() => void classificarDescricao({ descricao: entrada, tomador: destinatario, local: localPrestacaoValor, uso: usoServico })}>
                    <span className="inline-flex items-center gap-1.5">
                      <IconeAurumPremium tamanho="sm" /> Perguntar à {NOME_IA}
                    </span>
                  </Btn>
                </div>
              </details>
            </>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <div className="field-wrap min-w-[220px] flex-1">
                <span className="field-icon">🏢</span>
                <Texto
                  grande
                  id="busca-cnpj-servicos"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="00.000.000/0000-00"
                  value={MASK.cnpj(cnpjEntrada)}
                  onChange={(e) => setCnpjEntrada(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submeterCnpj()
                    }
                  }}
                  aria-label="CNPJ da empresa para consulta automática"
                />
              </div>
              <Btn variante="primary" carregando={buscandoCnpj} onClick={() => submeterCnpj()}>
                Consultar
              </Btn>
              <Btn onClick={() => limparTudo()}>Limpar</Btn>
            </div>
          )}
        </div>
      </Painel>
      </Entrada>

      {modo === 'manual' ? (
        !entrada.trim() ? (
          <Entrada className="mt-6">
            <Vazio
              icone="🔍"
              titulo="Busque por código, nome ou descrição"
              texto="Ex.: 122.011.100 (valida na base oficial) · aula de inglês (a ✨ Aurum AI responde primeiro) · atendimento médico domiciliar."
            />
          </Entrada>
        ) : (
          <Revelar className="mt-6 space-y-4">
            {prioridadeIA ? (
              <section aria-label={`Resposta da ${NOME_IA}`} className="space-y-3">
                <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                    <IconeAurumPremium tamanho="sm" /> Resposta da {NOME_IA}
                  </span>
                  {via === 'deterministico' ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black normal-case text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      determinístico · sem worker
                    </span>
                  ) : null}
                  {classificando ? <StatusAurumAI estado="processando">analisando…</StatusAurumAI> : null}
                </h3>
                {classificando && !sugestao && via !== 'ia' && via !== 'grafo' && via !== 'grafo+ia' ? (
                  <CarregandoAurumAI entrada={entrada} />
                ) : sugestao?.foraDeEscopo ? (
                  <MolduraAurumAI detalhe="recusa de escopo · sem consulta à base">
                    <p className="text-xs text-slate-600 dark:text-slate-300">{sugestao.justificativa}</p>
                  </MolduraAurumAI>
                ) : sugestao ? (
                  <MolduraAurumAI detalhe="predição assistiva · ancorada na base oficial">
                    <SecaoSugestaoNbs />
                  </MolduraAurumAI>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
                    Descreva com mais contexto para a {NOME_IA} sugerir o NBS — sempre ancorada na base oficial.
                  </div>
                )}
                {(via === 'ia' || via === 'grafo' || via === 'grafo+ia') && decisaoIa ? (
                  <MolduraAurumAI detalhe="decisão validada pela base oficial">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <BarraConfiancaAurumAI valor={confiancaIa} compact />
                        {via === 'grafo' || via === 'grafo+ia' ? (
                          <span
                            className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                            title="Resposta com caminho do grafo fiscal local — o resolvedor validou o código."
                            role="status"
                            aria-label={via === 'grafo+ia' ? 'via:grafo+ia' : 'via:grafo'}
                          >
                            {via === 'grafo+ia' ? 'via:grafo+ia' : 'via:grafo'}
                          </span>
                        ) : null}
                      </div>
                      <BlocoTrilhaServicos />
                      <CartaoEnxuto
                        cl={decisaoIa}
                        nomenclatura={null}
                        onSalvar={(cl) => setParaSalvar(cl)}
                        onAddCalc={(cl) => abrirCalc({ tipo: 'classificacao', classificacao: cl })}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Btn
                          variante="primary"
                          tam="sm"
                          onClick={() => {
                            void usarSugestaoIa()
                            toast(`Sugestão da ${NOME_IA} enviada para classificação oficial.`, 'ok')
                          }}
                        >
                          Classificar {fmtNbs(codigoIa ?? '')} oficialmente
                        </Btn>
                        <Btn
                          tam="sm"
                          disabled={feedbackEnviado}
                          onClick={() => {
                            void feedbackNegativo()
                            toast('Obrigado — registramos que não era esse NBS.', 'warn')
                          }}
                        >
                          {feedbackEnviado ? '✓ Feedback registrado' : '👎 Não é esse'}
                        </Btn>
                      </div>
                    </div>
                  </MolduraAurumAI>
                ) : null}
              </section>
            ) : null}

            {mostrarExata && ehExatoNbs ? (
              <section aria-label="Classificação oficial do NBS" className="space-y-3">
                <h3 className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">
                    🔢 Exato · via número
                  </span>
                  {carregando ? <span>Classificando…</span> : null}
                </h3>
                {avisoInvalido && !resultados.length ? (
                  <Painel className="p-8 text-center">
                    <div className="text-3xl">⌨️</div>
                    <div className="mt-2 text-sm font-semibold">Informe um NBS de 9 dígitos.</div>
                  </Painel>
                ) : !resultados.length ? (
                  <Vazio icone="🔍" titulo="Nenhum NBS exato ainda" texto="Complete os 9 dígitos para classificar." />
                ) : (
                  <div className="space-y-3">
                    {!regraGeral && resultados.length > 1 ? (
                      <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        <strong>⚡ {resultados.length} classificações possíveis</strong> para este NBS — compare abaixo.
                      </p>
                    ) : null}
                    {resultados.map((r) => (
                      <CartaoEnxuto
                        key={r.__uid}
                        cl={r.classificacao}
                        nomenclatura={null}
                        onSalvar={(cl) => setParaSalvar(cl)}
                        onAddCalc={(cl) => abrirCalc({ tipo: 'classificacao', classificacao: cl })}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {(mostrarExata && !ehExatoNbs && norm(entrada).length >= 2) || mostrarNome ? (
              <details className="rounded-xl border border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                <summary className="cursor-pointer font-bold">
                  🔎 Outras correspondências na base oficial
                  {sugestoes.length || resultadosTexto.length ? ` (${sugestoes.length + resultadosTexto.length})` : ''}
                </summary>
                <div className="mt-2 space-y-1">
                  {sugestoes.map((s) => (
                    <button
                      key={s.codigo}
                      type="button"
                      onClick={() => void escolherUnificada(s.codigo)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-brand-50 dark:hover:bg-slate-800"
                    >
                      <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{fmtNbs(s.codigo)}</span>
                      <span className="min-w-0 flex-1 truncate">{s.titulo}</span>
                    </button>
                  ))}
                  {resultadosTexto.map((r) => (
                    <button
                      key={r.codigo}
                      type="button"
                      onClick={() => void escolherUnificada(r.codigo)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-brand-50 dark:hover:bg-slate-800"
                    >
                      <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{r.codigoFormatado}</span>
                      <span className="min-w-0 flex-1 truncate">{r.titulo}</span>
                    </button>
                  ))}
                  {!sugestoes.length && !resultadosTexto.length && !buscandoTexto ? (
                    <p className="px-2 py-1">Nenhuma correspondência para esta busca.</p>
                  ) : null}
                </div>
              </details>
            ) : null}

            {!prioridadeIA && mostrarDescricao && sugestao && !sugestao.foraDeEscopo ? (
              <details className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-xs text-slate-600 dark:border-violet-900 dark:bg-violet-950/20 dark:text-slate-300">
                <summary className="cursor-pointer font-bold">
                  <span className="inline-flex items-center gap-1.5">
                    <IconeAurumPremium tamanho="sm" /> Ver resposta da {NOME_IA} para este texto
                  </span>
                </summary>
                <div className="mt-2">
                  <MolduraAurumAI detalhe="predição assistiva · ancorada na base oficial">
                    <SecaoSugestaoNbs />
                  </MolduraAurumAI>
                </div>
              </details>
            ) : null}
          </Revelar>
        )
      ) : (
        <Revelar className="mt-6 space-y-4">
          {erroCnpj ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <strong>Não foi possível consultar:</strong> {erroCnpj}
            </div>
          ) : null}
          {!vereditoEmpresa && !buscandoCnpj && !erroCnpj ? (
            <Vazio
              icone="🏢"
              titulo="Digite o CNPJ para ver as atividades"
              texto="Buscamos os dados na Receita (BrasilAPI) e classificamos cada CNAE de serviço com a ✨ Aurum AI — sempre validado na base oficial."
            />
          ) : null}
          {buscandoCnpj && !vereditoEmpresa ? (
            <CarregandoAurumAI entrada={fmtCnpj(cnpjEntrada)} />
          ) : null}
          {vereditoEmpresa ? (
            <>
              <FichaEmpresaCnpj
                razaoSocial={vereditoEmpresa.razaoSocial}
                fantasia={vereditoEmpresa.fantasia}
                cnpj={vereditoEmpresa.cnpj}
                porte={vereditoEmpresa.porte}
                situacao={vereditoEmpresa.situacao}
                opcaoSimples={vereditoEmpresa.opcaoSimples}
                dataConsulta={vereditoEmpresa.dataConsulta}
                doCache={vereditoEmpresa.doCache}
                onAtualizar={() => void consultarCnpj(vereditoEmpresa.cnpj, true)}
                atualizando={buscandoCnpj}
                totalNbs={vereditoEmpresa.atividades.reduce((a, t) => a + (t.nbsLista?.length ?? 0), 0)}
                nbsComBeneficio={vereditoEmpresa.atividades.reduce((a, t) => a + (t.nbsComBeneficio ?? 0), 0)}
                anoReferencia={vereditoEmpresa.anoReferencia}
              />
              {vereditoEmpresa.opcaoSimples === true ? (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <strong>Simples Nacional:</strong> o enquadramento segue os Anexos do Simples (I–V) e o Fator R —
                  a tributação da Reforma abaixo é informativa para a transição. Confirme com o contador.
                </p>
              ) : null}
              <p className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                <strong>Resumo:</strong> {vereditoEmpresa.resumo.classificadas} atividade(s) classificada(s) ·{' '}
                {vereditoEmpresa.resumo.comBeneficio} com benefício · {vereditoEmpresa.resumo.tributacaoIntegral} em
                tributação integral · {vereditoEmpresa.resumo.manualObrigatorio} exigem modo manual ·{' '}
                {vereditoEmpresa.resumo.desconhecidas} fora da tabela · {vereditoEmpresa.resumo.falhas} falha(s).
              </p>
              <div className="space-y-3">
                {vereditoEmpresa.atividades.map((a) => (
                  <CartaoCnae
                    key={a.cnae7}
                    atividade={a}
                    onSalvar={setParaSalvar}
                    onAddCalc={(c) => abrirCalc({ tipo: 'classificacao', classificacao: c })}
                  />
                ))}
                {!vereditoEmpresa.atividades.length ? (
                  <Vazio icone="🏢" titulo="Sem atividades na Receita" texto="Este CNPJ não retornou CNAEs — confira o número e tente de novo." />
                ) : null}
              </div>
            </>
          ) : null}
        </Revelar>
      )}

      <ModalSalvarClass
        aberto={paraSalvar !== null}
        classificacao={paraSalvar}
        inicial={null}
        onFechar={() => setParaSalvar(null)}
      />
    </div>
  )
}

function SecaoSugestaoNbs() {
  const sugestao = useServicos((s) => s.sugestao)
  const usarSugestao = useServicos((s) => s.usarSugestao)
  const escolher = useServicos((s) => s.escolherUnificada)
  if (!sugestao) return null
  const preditivas = sugestao.sugestoesPreditivas ?? []
  const corConfianca =
    sugestao.confianca === 'alta'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
      : sugestao.confianca === 'media'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200'
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2">
        {sugestao.nbs_provavel ? (
          <span className="consulta-hero-ncm text-brand-700 dark:text-aurum-200">{sugestao.nbs_provavel}</span>
        ) : preditivas.some((p) => p.tipo === 'hipotese-cct') ? (
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">💡 Hipótese de benefício a verificar</span>
        ) : (
          <span className="text-sm font-bold text-slate-500">Sem sugestão segura</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${corConfianca}`}>{sugestao.confianca}</span>
        {sugestao.excecao_enquadravel ? (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
            ⚡ benefício
          </span>
        ) : null}
      </div>
      <p className="consulta-justificativa-clamp text-slate-600 dark:text-slate-300" title={sugestao.justificativa}>
        {sugestao.justificativa}
      </p>
      {sugestao.contextoNbs ? <BlocoContextoNbs contexto={sugestao.contextoNbs} /> : null}
      {sugestao.nbs_provavel ? (
        <div className="flex flex-wrap gap-2">
          <Btn
            variante="primary"
            tam="sm"
            onClick={() => {
              void usarSugestao()
              toast('NBS sugerido enviado para classificação oficial.', 'ok')
            }}
          >
            Classificar {sugestao.nbs_provavel} oficialmente
          </Btn>
        </div>
      ) : null}
      {preditivas.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="note" aria-label="Sugestões preditivas informativas">
          <p className="font-black">🔮 Sugestão preditiva — apenas informativa, NÃO é decisão final</p>
          <p className="mt-0.5 text-[11px] opacity-90">
            Pelos nomes/sinônimos do sistema há lastro nestas pistas. Confirme com o contador e classifique oficialmente antes de escriturar.
          </p>
          <ul className="mt-1.5 space-y-1">
            {preditivas.map((p) => (
              <li key={`${p.tipo}-${p.codigo}`} className="space-y-1 rounded-lg bg-white/60 px-2 py-1 dark:bg-black/20">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-black">{p.codigoFormatado}</span>
                  <span className="min-w-0 flex-1 truncate" title={p.titulo}>{p.titulo}</span>
                  <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-black dark:bg-amber-900/50">
                    {Math.round(p.cobertura * 100)}% termos
                  </span>
                  {p.tipo === 'nbs' ? (
                    <button
                      type="button"
                      onClick={() => void escolher(p.codigo)}
                      className="rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-black text-white hover:bg-amber-700"
                      title={`Classificar ${p.codigoFormatado} oficialmente (valida na base)`}
                    >
                      Classificar oficialmente
                    </button>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={p.baseLegal ?? 'Hipótese de benefício sem NBS direto — verificar Anexo/cct'}>
                      hipótese {p.cClassTrib}
                    </span>
                  )}
                </span>
                {p.contexto ? <BlocoContextoNbs contexto={p.contexto} compacto /> : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] opacity-75">
            {preditivas[0]?.termosCasados?.length ? `Termos que casaram: ${preditivas[0].termosCasados.join(', ')}` : ''}
            {preditivas[0]?.sinonimosUsados?.length ? ` · sinônimos: ${preditivas[0].sinonimosUsados.join(', ')}` : ''}
            {` · origem: ${preditivas[0]?.origem ?? '—'}`}
          </p>
        </div>
      ) : null}
      {sugestao.alternativas.length ? (
        <div className="flex flex-wrap gap-1.5">
          {sugestao.alternativas.slice(0, 5).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => void escolher(a)}
              className="rounded-full bg-slate-200 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600 hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300"
              title={`Classificar ${a} oficialmente`}
            >
              {a}
            </button>
          ))}
        </div>
      ) : null}
      <DetalhesPerguntasServicos itens={sugestao.perguntasComplementares} />
      {sugestao.cst && sugestao.cClassTrib && (
        <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
          CST {sugestao.cst} · cClassTrib {sugestao.cClassTrib}
          {sugestao.anexo ? ` · Anexo LC 214 ${sugestao.anexo}` : ''}
        </p>
      )}
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
        <SeloAurumAI variante="fantasma" />
      </div>
    </div>
  )
}

function BlocoTrilhaServicos() {
  const caminho = useServicos((s) => s.caminhoGrafoIa)
  const proveniencia = useServicos((s) => s.provenienciaGrafoIa)
  const cypher = useServicos((s) => s.grafoCypherIa)
  const boost = useServicos((s) => s.boostGrafoIa)
  const boostValor = useServicos((s) => s.boostValorGrafoIa)
  if (!caminho?.length || !proveniencia?.length) return null
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <strong>Por que sugeriu:</strong> base: {caminho.join(' → ')}
        {boost === 'uso_local' && Number(boostValor) > 0 ? (
          <span className="font-mono font-bold"> + seu uso (boost: uso_local +{Number(boostValor)})</span>
        ) : null}
      </p>
      <details className="rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
        <summary className="cursor-pointer text-[11px] font-bold">🕸️ Trilha do grafo (caminho + proveniência + cypher)</summary>
        <ul className="mt-1 space-y-1 font-mono text-[11px] text-slate-500">
          {proveniencia.map((p, i) => (
            <li key={i}>
              {p.de} —[{p.tipo}/{p.origem} conf {p.confianca}
              {p.anoReferencia ? ` ano ${p.anoReferencia}` : ''}]→ {p.para}
            </li>
          ))}
        </ul>
        {cypher ? (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-500">{cypher}</pre>
        ) : null}
        <p className="mt-1 text-[11px] text-slate-500">Relatório IA cita: {caminho.join(' → ')}</p>
      </details>
    </div>
  )
}
