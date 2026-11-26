/**
 * Simples Nacional — página isolada (sem impacto na Consulta NCM).
 *
 * Refatoração completa (docs/PROPOSTA-REFATORACAO-SIMPLES-NACIONAL.md):
 * - lógica derivada em `cena.ts` (uma única fonte, sem React);
 * - fluxo em `useWizardSimples` (timer com cleanup), relatório e export em hooks;
 * - wizard em componentes + resultado em 5 blocos (Veredito → Memória →
 *   Composição → Cenários → Ações);
 * - Fator R obrigatório: folha 12m validada na entrada e no `calcular()`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ANEXO_LABEL, SUBLIMITE, type AnexoSimplesId } from './tabelas'
import {
  creditoDaDespesa,
  etapa1Pronta,
  normalizarListaAnexosSimples,
  preverAnexoFatorR,
  sublimiteEstourado,
  useSimples,
  type DespesaSimples,
} from './store'
import { somaParcelas } from './segregacao-receita'
import { validarFolhaObrigatoria } from '@/domain/simples/validacao'
import { montarCenaSimples } from './cena'
import type { ResultadoConvencional } from './calculo'
import { useWizardSimples } from './hooks/useWizardSimples'
import { useRelatorioAnalitico } from './hooks/useRelatorioAnalitico'
import { useExportacaoSimples } from './hooks/useExportacaoSimples'
import { anexoEfetivoParcela } from './segregacao-receita'
import { tributoSTDoAnexo } from './segregacao-st'
import { DasModal } from './DasModal'
import { InsightsModal } from './InsightsModal'
import { useProjecaoDividida } from '@/simples-projection/store'
import { ModalDivisao as ModalDivisaoView } from '@/simples-projection/ModalDivisao'
import { fmtCnpj, fmtMoeda } from '@/domain/services/format'
import { rotuloAnexoSimples } from '@/domain/services/cnae'
import { Btn, IconeBadge, Painel, Selecao, Texto } from '@/ui/kit'
import { Entrada } from '@/ui/motion'
import { useUi } from '@/store/ui'
import {
  CampoMoeda,
  DespesaValor,
  EtapaValores,
  Passo,
  ResultadoSimples,
  SeletorRegraCredito,
  Stepper,
  SubCard,
} from './components'
import { Secao } from '@/ui/motion'

const ANEXOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V']

export function SimplesNacional() {
  const s = useSimples()
  const [dasAberto, setDasAberto] = useState(false)
  const [insightsAberto, setInsightsAberto] = useState(false)
  const ctaRef = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (s.modo) setForcarLista(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.modo])

  // Guarda pura da folha — mesma usada pelo `calcular()` na store.
  const validacaoFolha = useMemo(() => {
    const op = s.modo === 'cnpj' ? s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) : undefined
    return validarFolhaObrigatoria({
      folha12: s.folha12,
      folhaInformada: s.folhaInformada,
      semFolhaConfirmado: s.semFolhaConfirmado,
      rbt12: s.rbt12,
      anexos: s.modo === 'cnpj' ? (op?.anexos ?? []) : [s.anexoId],
      cnaeFatorR: Boolean(op?.exigeFatorR || op?.tabela?.fatorR),
      sujeitaFatorR: s.sujeitaFatorR,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.folha12, s.folhaInformada, s.semFolhaConfirmado, s.rbt12, s.modo, s.opcoes, s.cnaeEscolhido, s.anexoId, s.sujeitaFatorR])

  const previsaoFR = useMemo(
    () => (s.rbt12 > 0 ? preverAnexoFatorR(s.rbt12, s.folha12) : null),
    [s.rbt12, s.folha12]
  )
  const estouradoPasso1 = sublimiteEstourado(s)
  const segSoma = somaParcelas(s.segParcelas.map((p) => ({ valor: p.valor })))
  const segExcesso = s.segAtivo && segSoma > s.receitaMes + 0.01
  const segValida = !s.segAtivo || (s.segParcelas.filter((p) => p.valor > 0).length > 0 && !segExcesso)
  const valoresOk = s.rbt12 > 0 && s.receitaMes > 0 && validacaoFolha.ok

  // O wizard recebe um `podeVisualizar` que NÃO depende do próprio `gerando`
  // (ele já bloqueia internamente) — evita ciclo com `montarCenaSimples`.
  const wizard = useWizardSimples({
    podeVisualizar: etapa1Pronta(s) && valoresOk && segValida,
    valoresOk,
    segExcesso,
    segSoma,
    receitaMes: s.receitaMes,
    estourado: estouradoPasso1,
    compararHibrido: s.compararHibrido,
    resultadoVisivel: s.relatorioVisivel && !!s.convencional,
    onCalcular: () => s.calcular(),
    onCompararHibrido: (v) => s.set({ compararHibrido: v }),
    onLimpar: () => s.limpar(),
  })
  const { etapa, gerando, forcarLista, setForcarLista, reparticaoAberta, setReparticaoAberta } = wizard

  const cena = useMemo(() => montarCenaSimples(s, gerando), [s, gerando])
  const relatorio = useRelatorioAnalitico(s, cena.segResultado, !!cena.mostrando)
  const exportacao = useExportacaoSimples({
    s,
    convExib: (cena.convExib ?? s.convencional) as ResultadoConvencional,
    hibExib: cena.hibExib,
    dasBruto: cena.dasBruto,
    dasExib: cena.dasExib,
    stResumo: cena.stResumo,
    segResultado: cena.segResultado,
  })

  const cnaeAtivo = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null
  const anexosSugeridosCnpj = useMemo(
    () => (s.modo === 'cnpj' && cnaeAtivo ? normalizarListaAnexosSimples(cnaeAtivo.anexos) : []),
    [s.modo, cnaeAtivo]
  )
  const mostrarListaCnae = s.modo === 'cnpj' && s.opcoes.length > 0 && (!s.cnaeEscolhido || forcarLista)
  const mostrarCnaeFocado = s.modo === 'cnpj' && cnaeAtivo && !mostrarListaCnae

  const aoEscolherAnexo = (a: AnexoSimplesId) => {
    s.setAnexo(a)
    wizard.rolarPara(ctaRef)
  }
  const aoEscolherCnae = (cnae7: string) => {
    s.escolherCnae(cnae7)
    setForcarLista(false)
    wizard.rolarPara(ctaRef)
  }
  const aoTrocarAtividade = () => {
    setForcarLista(true)
    wizard.rolarPara(listaRef)
  }
  const editarDespesa = (id: string, patch: Partial<DespesaSimples>) => {
    s.setDespesas(s.despesas.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }
  const abrirDivisao = () => {
    useProjecaoDividida.getState().abrir({
      cnpj: s.cnpj,
      empresaNome: s.empresaNome,
      opcaoSimples: s.opcaoSimples,
      cnaeEscolhido: s.cnaeEscolhido,
      anexoSugerido: s.anexoId,
      rbt12: s.rbt12,
      receitaMes: s.receitaMes,
      folha12: s.folha12,
    })
  }

  return (
    <div className="simples-escopo mx-auto w-full max-w-[1400px]">
      <div className="min-w-0 space-y-3">
        <Entrada>
          <Painel className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
              <IconeBadge nome="calculadora" tom="brand" tamanho="sm" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-extrabold tracking-tight">Simples Nacional</h1>
                <p className="truncate text-[13px] text-slate-600 dark:text-slate-300">
                  LC 123/2006 + Reforma (CBS/IBS) · 2027–2028
                </p>
              </div>
            </div>

            {etapa !== 3 ? (
              <div className="flex gap-1.5 border-b border-[var(--line)] bg-slate-50/60 px-3 py-2 dark:bg-slate-950/40">
                {(['manual', 'cnpj'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { if (s.modo !== m) { s.set({ modo: m }); wizard.setEtapa(1) } }}
                    aria-pressed={s.modo === m}
                    className={`btn btn-press h-12 flex-1 !py-1.5 text-sm font-bold transition-all duration-200 ${s.modo === m ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {m === 'manual' ? 'Manual · Anexo' : 'Automático · CNPJ'}
                  </button>
                ))}
              </div>
            ) : null}

            <Stepper etapa={etapa} onIr={wizard.irPara} podeIr3={!!cena.mostrando} carregando={gerando} />

            {etapa !== 3 ? (
              <div className="space-y-5 p-6 sm:p-8" key={`${s.modo}-${etapa}`}>
                {etapa === 1 ? (
                  <EtapaValores
                    s={s}
                    valoresOk={valoresOk}
                    estourado={estouradoPasso1}
                    validacao={validacaoFolha}
                    previsaoFR={previsaoFR}
                    onRbt12={(v) => { s.set({ rbt12: v }); s.tocarEntrada() }}
                    onReceita={(v) => { s.set({ receitaMes: v }); s.tocarEntrada() }}
                    onFolha={(v) => { s.set({ folha12: v, folhaInformada: v > 0 }); s.tocarEntrada() }}
                    onSujeita={(v) => { s.set({ sujeitaFatorR: v }); s.tocarEntrada() }}
                    onContinuar={wizard.continuar1}
                  />
                ) : (
                  <>
                    {valoresOk ? (
                      <Secao>
                        <section className="scroll-mt-24 space-y-2.5 border-t border-[var(--line)] pt-3">
                          <Passo n="2" titulo={s.modo === 'manual' ? 'Anexo' : 'Atividade (CNPJ)'} desc="Individual no mesmo anexo ou segregado por anexo." feito={!!cena.mostrando} />

                          {s.modo === 'manual' ? (
                            <div>
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                                {ANEXOS.map((a) => (
                                  <button
                                    key={a}
                                    type="button"
                                    onClick={() => aoEscolherAnexo(a)}
                                    aria-pressed={s.anexoId === a && s.escolheuAnexo}
                                    className={`rounded-lg border px-2 py-2.5 text-left transition-all duration-200 btn-press min-h-[88px] ${
                                      s.anexoId === a && s.escolheuAnexo
                                        ? 'simples-anexo-ativo simples-anexo-' + a
                                        : 'simples-anexo-' + a + ' border-[var(--line)] hover:scale-[1.01] active:scale-[0.99]'
                                    }`}
                                  >
                                    <span className={`block font-mono text-sm font-black ${s.anexoId === a && s.escolheuAnexo ? 'text-white' : 'text-brand-700 dark:text-aurum-200'}`}>{a}</span>
                                    <span className={`block truncate text-[13px] ${s.anexoId === a && s.escolheuAnexo ? 'text-white/85' : 'text-slate-600 dark:text-slate-300'}`}>
                                      {a === 'I' ? 'Comércio' : a === 'II' ? 'Indústria' : a === 'III' ? 'Serviços' : a === 'IV' ? 'S/ CPP' : 'Fator R'}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              {s.escolheuAnexo ? (
                                <p className="mt-1 animate-fade-up truncate text-[13px] text-emerald-600">{ANEXO_LABEL[s.anexoId]} ✓</p>
                              ) : null}
                            </div>
                          ) : (
                            <div className="space-y-2 rounded-xl border border-[var(--line)] bg-slate-50/50 p-3 dark:bg-slate-950/30">
                              <div className="flex flex-row items-end gap-2">
                                <div className="min-w-0 flex-1">
                                  <span className="field-label">CNPJ</span>
                                  <Texto mono mask="cnpj" placeholder="00.000.000/0000-00" value={s.cnpj} onChange={(e) => s.set({ cnpj: e.target.value })} className="h-12 text-base" />
                                </div>
                                <div className="shrink-0 pb-px">
                                  <Btn variante="primary" carregando={s.buscandoCnpj} onClick={() => void s.buscarPorCnpj()} className="h-12 whitespace-nowrap px-4">
                                    {s.buscandoCnpj ? 'Buscando…' : 'Buscar'}
                                  </Btn>
                                </div>
                              </div>
                              {s.empresaNome ? (
                                <div className="animate-fade-up truncate text-[13px]">
                                  <strong>{s.empresaNome}</strong> <span className="font-mono text-slate-600">{fmtCnpj(s.cnpj)}</span>
                                  {s.opcaoSimples == null ? null : s.opcaoSimples ? (
                                    <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[13px] font-bold text-emerald-800">Simples optante</span>
                                  ) : (
                                    <span className="rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800">Não optante</span>
                                  )}
                                </div>
                              ) : null}

                              {mostrarListaCnae ? (
                                <div ref={listaRef as React.RefObject<HTMLDivElement>} className="animate-fade-up scroll-mt-24 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="field-label">Qual atividade usar? · {s.opcoes.length}</span>
                                    <span className="hidden text-[13px] text-slate-600 sm:block">Toque para focar e liberar os cálculos</span>
                                  </div>
                                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                                    {s.opcoes.map((o) => {
                                      const anexosNorm = normalizarListaAnexosSimples(o.anexos)
                                      const ehDuplo = anexosNorm.includes('III') && anexosNorm.includes('V')
                                      return (
                                        <button
                                          key={o.cnae7}
                                          type="button"
                                          onClick={() => aoEscolherCnae(o.cnae7)}
                                          aria-pressed={s.cnaeEscolhido === o.cnae7}
                                          className="btn-press flex w-full items-start gap-2 rounded-lg border border-[var(--line)] bg-white p-2 text-left transition-all duration-200 hover:border-aurum-500 dark:bg-slate-900"
                                        >
                                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-transparent"><span className="text-[13px]">✓</span></span>
                                          <span className="min-w-0 flex-1">
                                            <span className="flex flex-wrap items-center gap-1">
                                              <span className="font-mono text-[13px] font-black">{o.codigoFormatado}</span>
                                              {o.principal ? <span className="rounded-full bg-brand-100 px-1.5 py-px text-[13px] font-bold text-brand-700">principal</span> : null}
                                              {anexosNorm.length ? (
                                                <span className="rounded-full bg-slate-100 px-1.5 py-px text-[13px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosNorm)}</span>
                                              ) : (
                                                <span className="rounded-full bg-red-100 px-1.5 py-px text-[13px] font-bold text-red-700">s/ anexo</span>
                                              )}
                                              {ehDuplo ? (
                                                <span className="rounded-full bg-sky-100 px-1.5 py-px text-[13px] font-bold text-sky-800">III × V</span>
                                              ) : o.exigeFatorR ? (
                                                <span className="rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800">Fator R</span>
                                              ) : null}
                                            </span>
                                            <span className="mt-0.5 block truncate text-[13px] text-slate-600 dark:text-slate-300" title={o.descricao}>{o.descricao}</span>
                                          </span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              {mostrarCnaeFocado ? (
                                <div className="animate-pop-in space-y-2" key={cnaeAtivo!.cnae7}>
                                  <div className="flex items-start gap-2 rounded-xl border border-brand-700/70 bg-brand-50/60 p-2.5 shadow-card dark:bg-brand-950/25">
                                    <span className="grid h-5 w-5 shrink-0 animate-pop-in place-items-center rounded-full bg-brand-700 text-[13px] font-black text-white">✓</span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1">
                                        <span className="font-mono text-[13px] font-black">{cnaeAtivo!.codigoFormatado}</span>
                                        {cnaeAtivo!.principal ? <span className="rounded-full bg-brand-100 px-1.5 py-px text-[13px] font-bold text-brand-700">principal</span> : null}
                                        <span className="rounded-full bg-slate-100 px-1.5 py-px text-[13px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(normalizarListaAnexosSimples(cnaeAtivo!.anexos)) || 's/ anexo'}</span>
                                        <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[13px] font-bold text-emerald-800">em simulação</span>
                                      </div>
                                      <p className="mt-0.5 truncate text-[13px] text-slate-600 dark:text-slate-300" title={cnaeAtivo!.descricao}>{cnaeAtivo!.descricao}</p>
                                    </div>
                                  </div>
                                  {cnaeAtivo!.estadoNbs === 'bens→NCM' ? (
                                    <div className="rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[13px] text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200" role="note">
                                      <p className="font-bold">Sem NBS — atividade de bens (ver NCM)</p>
                                      <Btn tam="sm" onClick={() => useUi.getState().trocarView('consulta')}>Ir à Consulta NCM</Btn>
                                    </div>
                                  ) : cnaeAtivo!.estadoNbs === 'mapeado' && cnaeAtivo!.nbsLista.length ? (
                                    <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 text-[13px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                                      <summary className="cursor-pointer font-bold">NBS: {cnaeAtivo!.nbsLista.length} ({cnaeAtivo!.nbsComBeneficio} c/ benefício) — informativo</summary>
                                      <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto pr-1">
                                        {cnaeAtivo!.nbsLista.map((v) => (
                                          <li key={v.nbs} className="flex items-center gap-1.5 text-[13px]">
                                            <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{v.nbsFormatado}</span>
                                            <span className="min-w-0 flex-1 truncate" title={v.descricao ?? ''}>{v.descricao ?? '—'}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  ) : null}
                                  <div className="flex flex-wrap gap-1.5">
                                    <Btn tam="sm" onClick={aoTrocarAtividade}>Trocar atividade</Btn>
                                    <Btn tam="sm" variante="primary" onClick={abrirDivisao}>✂ Dividir faturamento</Btn>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}

                          {etapa1Pronta(s) ? (
                            <>
                              <SubCard
                                titulo="Segregação de receita"
                                aside={s.segAtivo ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-px text-[13px] font-bold text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                                    {s.segParcelas.filter((p) => p.valor > 0).length} parcela(s)
                                    {cena.segResultado?.temST ? ` · ST ${cena.segResultado.tributosST.join('+')}` : ''}
                                  </span>
                                ) : undefined}
                              >
                                {!s.segAtivo ? (
                                  <button
                                    type="button"
                                    onClick={() => { s.set({ segAtivo: true, segParcelas: [{ id: `g${Date.now()}`, anexoId: s.anexoId, valor: 0, st: false }] }); s.tocarEntrada() }}
                                    className="btn btn-press btn-soft flex w-full items-center justify-center gap-2 !border-dashed"
                                  >
                                    ＋ Segregar receita
                                  </button>
                                ) : (
                                  <div className="animate-fade-up space-y-2">
                                    <p className="text-[13px] leading-relaxed text-slate-600">
                                      Informe o valor de cada parcela — no <strong>mesmo anexo</strong> ou em <strong>outro</strong>.
                                      Cada linha usa a <strong>RBT12 total</strong> ({fmtMoeda(s.rbt12)}) na tabela do seu anexo;
                                      marque <strong>ST</strong> quando o ICMS/ISS da parcela já foi recolhido por substituição.
                                    </p>
                                    {s.segParcelas.map((p, i) => {
                                      const anexoEfetivoUI = anexoEfetivoParcela(p.anexoId, s.rbt12, s.folha12).anexo
                                      const rotuloST = tributoSTDoAnexo(anexoEfetivoUI) === 'ICMS' ? 'ST ICMS' : 'ST ISS'
                                      return (
                                        <div key={p.id} className="rounded-xl border border-[var(--line)] bg-white p-2 dark:bg-slate-900">
                                          <div className="mb-1.5 flex items-center gap-2">
                                            <span className="text-[13px] font-black tracking-wide">Atividade {i + 1}</span>
                                            {p.anexoId === 'V' ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[13px] font-bold text-amber-800" title="Anexo V: o Fator R decide (folha ÷ RBT12 ≥ 28% → III)">Fator R</span> : null}
                                          </div>
                                          <div className="flex items-end gap-2">
                                            <label className="block w-28 shrink-0">
                                              <span className="field-label">Anexo</span>
                                              <Selecao
                                                value={p.anexoId}
                                                onChange={(e) => {
                                                  const anexoId = e.target.value as AnexoSimplesId
                                                  s.set({ segParcelas: s.segParcelas.map((x) => (x.id === p.id ? { ...x, anexoId } : x)) })
                                                  s.tocarEntrada()
                                                }}
                                              >
                                                {ANEXOS.map((a) => <option key={a} value={a}>Anexo {a}{anexosSugeridosCnpj.includes(a) ? ' ★' : ''}</option>)}
                                              </Selecao>
                                            </label>
                                            <div className="min-w-0 flex-1">
                                              <CampoMoeda
                                                rotulo={`Receita · Anexo ${p.anexoId}`}
                                                valor={p.valor}
                                                onValor={(v) => {
                                                  s.set({ segParcelas: s.segParcelas.map((x) => (x.id === p.id ? { ...x, valor: Math.max(0, v) } : x)) })
                                                  s.tocarEntrada()
                                                }}
                                              />
                                            </div>
                                            <button
                                              type="button"
                                              disabled={s.segParcelas.length <= 1}
                                              aria-label={s.segParcelas.length <= 1 ? 'Mínimo 1 parcela' : `Remover parcela ${i + 1}`}
                                              onClick={() => { s.set({ segParcelas: s.segParcelas.filter((x) => x.id !== p.id) }); s.tocarEntrada() }}
                                              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--line)] text-slate-600 transition hover:border-red-500 hover:text-red-500 disabled:opacity-30 dark:text-slate-300"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                          <label className="mt-1.5 flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-bold text-slate-600 dark:text-slate-300" title={`${rotuloST}: o ICMS/ISS desta parcela sai da guia`}>
                                            <input
                                              type="checkbox"
                                              className="h-4 w-4 shrink-0 accent-amber-600"
                                              checked={p.st}
                                              onChange={(e) => {
                                                s.set({ segParcelas: s.segParcelas.map((x) => (x.id === p.id ? { ...x, st: e.target.checked } : x)) })
                                                s.tocarEntrada()
                                              }}
                                            />
                                            {rotuloST} — substituição tributária nesta parcela
                                          </label>
                                        </div>
                                      )
                                    })}
                                    <div className={`rounded-xl px-2.5 py-1.5 font-mono text-[13px] tabular-nums ${segExcesso ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
                                      Segregado {fmtMoeda(segSoma)} de {fmtMoeda(s.receitaMes)}
                                      {segExcesso
                                        ? ` · ultrapassa ${fmtMoeda(segSoma - s.receitaMes)} — reduza`
                                        : cena.segResto > 0
                                          ? ` · restante ${fmtMoeda(cena.segResto)} no Anexo ${cena.segRestoAnexo} ✓`
                                          : ' · tudo segregado ✓'}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-slate-50/60 px-2.5 py-1.5 text-[13px] dark:bg-slate-950/40">
                                      <span className="text-slate-600 dark:text-slate-300">
                                        Fator R da folha compartilhada: {cena.previsaoFR?.definido
                                          ? `${(cena.previsaoFR.indice * 100).toFixed(2)}% → Anexo ${cena.previsaoFR.anexo}`
                                          : 'aguardando folha na etapa 1'}
                                      </span>
                                      <button type="button" onClick={() => wizard.irPara(1)} className="min-h-11 font-bold text-brand-700 underline dark:text-aurum-200">
                                        Editar folha
                                      </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {s.segParcelas.length < 5 ? (
                                        <Btn tam="sm" onClick={() => { s.set({ segParcelas: [...s.segParcelas, { id: `g${Date.now()}`, anexoId: s.anexoId, valor: 0, st: false }] }); s.tocarEntrada() }}>+ Parcela</Btn>
                                      ) : null}
                                      <button type="button" onClick={() => { s.set({ segAtivo: false, segParcelas: [] }); s.tocarEntrada() }} className="min-h-11 text-[13px] font-bold text-red-600 hover:underline">Remover segregação</button>
                                    </div>
                                  </div>
                                )}
                              </SubCard>

                              <details className="rounded-xl border border-dashed border-[var(--line)] px-3 py-2">
                                <summary className="min-h-11 cursor-pointer text-[13px] font-bold">
                                  Avançado — sublimite e regime híbrido
                                  {s.compararHibrido || estouradoPasso1 ? <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-px text-[13px] text-brand-700">ativo</span> : null}
                                </summary>
                                <div className="mt-2 space-y-2">
                                  <p className={`rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${estouradoPasso1 ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300'}`}>
                                    {estouradoPasso1
                                      ? `Sublimite estourado automaticamente (RBT12 ${fmtMoeda(s.rbt12)} > ${fmtMoeda(SUBLIMITE)}). Aqui se informa só a alíquota de fora.`
                                      : `Dentro do sublimite (${fmtMoeda(SUBLIMITE)}) — apuração automática pelo RBT12.`}
                                  </p>
                                  {estouradoPasso1 && (cena.mostraRefICMS || cena.mostraRefISS) ? (
                                    <div className="animate-fade-up space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
                                      <span className="field-label">Fora da guia (sublimite) — alíquota de referência</span>
                                      {cena.mostraRefICMS ? (
                                        <div>
                                          <span className="field-label">ICMS fora da guia (%)</span>
                                          <Texto
                                            type="number" step="0.01" min={0} max={30} mono className="field num-input h-12 text-base"
                                            value={s.aliqRefICMS != null ? String((s.aliqRefICMS * 100).toFixed(2)) : cena.previaConv ? String((cena.previaConv.aliquotasFora.icms * 100).toFixed(2)) : ''}
                                            onChange={(e) => { const t = e.target.value.replace(',', '.'); const v = t === '' ? null : Number(t) / 100; s.set({ aliqRefICMS: v == null || !(v >= 0) ? null : v }); s.tocarEntrada() }}
                                          />
                                          <button type="button" className="min-h-11 text-[13px] font-bold underline" onClick={() => { s.set({ aliqRefICMS: null }); s.tocarEntrada() }}>restaurar auto</button>
                                        </div>
                                      ) : null}
                                      {cena.mostraRefISS ? (
                                        <div>
                                          <span className="field-label">ISS fora da guia (%)</span>
                                          <Texto
                                            type="number" step="0.01" min={0} max={30} mono className="field num-input h-12 text-base"
                                            value={s.aliqRefISS != null ? String((s.aliqRefISS * 100).toFixed(2)) : cena.previaConv ? String((cena.previaConv.aliquotasFora.iss * 100).toFixed(2)) : ''}
                                            onChange={(e) => { const t = e.target.value.replace(',', '.'); const v = t === '' ? null : Number(t) / 100; s.set({ aliqRefISS: v == null || !(v >= 0) ? null : v }); s.tocarEntrada() }}
                                          />
                                          <button type="button" className="min-h-11 text-[13px] font-bold underline" onClick={() => { s.set({ aliqRefISS: null }); s.tocarEntrada() }}>restaurar auto</button>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-bold">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 accent-brand-700"
                                      checked={s.compararHibrido}
                                      onChange={(e) => { s.set({ compararHibrido: e.target.checked }); s.tocarEntrada() }}
                                    />
                                    Comparar com o regime híbrido?
                                  </label>
                                  {s.compararHibrido ? (
                                    <div className="animate-fade-up space-y-2">
                                      <div>
                                        <span className="field-label">CBS referência (%)</span>
                                        <Texto
                                          type="number" step="0.01" min={0} max={30} mono className="field num-input h-12 text-base"
                                          value={String((s.cbsRef * 100).toFixed(2))}
                                          onChange={(e) => { const v = Number(e.target.value.replace(',', '.')) || 0; s.set({ cbsRef: v / 100 }); s.tocarEntrada() }}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <span className="field-label">Despesas (crédito CBS)</span>
                                        <div className="hidden overflow-x-auto rounded-2xl border-2 border-[var(--line)] sm:block">
                                          <table className="tbl tbl-compacta simples-tabela w-full min-w-[504px]">
                                            <thead>
                                              <tr className="border-b border-[var(--line)] text-left text-[13px] uppercase tracking-wide text-slate-600">
                                                <th className="px-2 py-1 font-bold">Despesa · crédito</th>
                                                <th className="w-[154px] px-2 py-1 text-right font-bold">Valor (R$/mês)</th>
                                                <th className="w-[154px] px-2 py-1 font-bold">Regra de crédito</th>
                                                <th className="w-8" />
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {s.despesas.map((dd) => {
                                                const cred = creditoDaDespesa(dd, s.cbsRef)
                                                return (
                                                  <tr key={dd.id} className="border-t border-[var(--line)] first:border-0">
                                                    <td className="max-w-[168px] px-2">
                                                      <span className="block truncate text-[13px] font-semibold" title={dd.rotulo}>{dd.rotulo}</span>
                                                      <span className="font-mono text-[13px] text-emerald-600 dark:text-emerald-400">{fmtMoeda(cred)} crédito</span>
                                                    </td>
                                                    <td className="w-[154px] px-2 text-right"><DespesaValor valor={dd.valor} onValor={(v) => editarDespesa(dd.id, { valor: v })} /></td>
                                                    <td className="w-[154px] px-2"><SeletorRegraCredito valor={dd.regra} onChange={(v) => editarDespesa(dd.id, { regra: v })} /></td>
                                                    <td className="w-8 text-center">
                                                      <button type="button" aria-label={`Remover ${dd.rotulo}`} onClick={() => s.setDespesas(s.despesas.filter((x) => x.id !== dd.id))} className="min-h-11 w-11 text-slate-500 transition hover:text-red-500 dark:text-slate-300">✕</button>
                                                    </td>
                                                  </tr>
                                                )
                                              })}
                                            </tbody>
                                            <tfoot>
                                              <tr className="border-t-2 border-[var(--line)]">
                                                <td className="px-2 font-bold">Total</td>
                                                <td className="w-[154px] px-2 text-right font-mono font-black tabular-nums">{fmtMoeda(s.despesas.reduce((a, d) => a + d.valor, 0))}</td>
                                                <td className="w-[154px] px-2 font-mono text-[13px] font-black tabular-nums text-emerald-700 dark:text-emerald-300">{fmtMoeda(s.despesas.reduce((a, d) => a + creditoDaDespesa(d, s.cbsRef), 0))} crédito</td>
                                                <td className="w-8" />
                                              </tr>
                                            </tfoot>
                                          </table>
                                        </div>
                                        <div className="space-y-2 sm:hidden">
                                          {s.despesas.map((dd) => (
                                            <div key={dd.id} className="rounded-xl border border-[var(--line)] p-2.5">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                  <p className="truncate text-[13px] font-semibold" title={dd.rotulo}>{dd.rotulo}</p>
                                                  <p className="font-mono text-[13px] text-emerald-600 dark:text-emerald-400">{fmtMoeda(creditoDaDespesa(dd, s.cbsRef))} crédito</p>
                                                </div>
                                                <button type="button" aria-label={`Remover ${dd.rotulo}`} onClick={() => s.setDespesas(s.despesas.filter((x) => x.id !== dd.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:text-red-500 dark:text-slate-300">✕</button>
                                              </div>
                                              <div className="mt-2 flex items-center justify-between gap-2">
                                                <DespesaValor valor={dd.valor} onValor={(v) => editarDespesa(dd.id, { valor: v })} />
                                                <SeletorRegraCredito valor={dd.regra} onChange={(v) => editarDespesa(dd.id, { regra: v })} />
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        <Btn tam="sm" onClick={() => s.setDespesas([...s.despesas, { id: `s${Date.now()}`, rotulo: 'Outra despesa', valor: 0, regra: 'integral' }])}>+ Despesa</Btn>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </details>

                              <div ref={ctaRef} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-white/95 p-3 shadow-pop backdrop-blur sm:static sm:bg-slate-50/50 sm:shadow-none sm:backdrop-blur-0 dark:bg-slate-900/95 dark:sm:bg-slate-950/30">
                                <Btn tam="sm" onClick={() => wizard.irPara(1)}>← Dados</Btn>
                                <Btn tam="sm" variante="primary" carregando={gerando} onClick={wizard.visualizar}>
                                  {gerando ? 'Calculando…' : '✦ Ver resultado'}
                                </Btn>
                              </div>
                            </>
                          ) : (
                            <p className="rounded-xl border border-dashed border-[var(--line)] bg-slate-50/50 px-3 py-2.5 text-center text-[13px] text-slate-600 dark:bg-slate-950/30">
                              {s.modo === 'manual'
                                ? '↑ Escolha um Anexo acima para liberar segregação e cálculo.'
                                : s.opcoes.length === 0
                                  ? '↑ Busque o CNPJ — escolha 1 atividade para liberar o restante.'
                                  : '↑ Escolha 1 atividade — as demais somem.'}
                            </p>
                          )}
                        </section>
                      </Secao>
                    ) : (
                      <p className="rounded-xl border border-dashed border-[var(--line)] bg-slate-50/50 px-3 py-2.5 text-center text-[13px] text-slate-600 dark:bg-slate-950/30">
                        ↑ Informe RBT12, receita e folha 12m acima para liberar o anexo.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {etapa === 3 ? (
              gerando && !cena.mostrando ? (
                <div className="animate-slide-in m-4 space-y-2 overflow-hidden rounded-2xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900" aria-busy="true">
                  <p className="text-[13px] font-black">busca automática calculando…</p>
                  <div className="skeleton h-10 w-2/3" />
                  <div className="skeleton h-10 w-full" />
                  <div className="skeleton h-10 w-full" />
                </div>
              ) : cena.mostrando && cena.convExib ? (
                <div className="p-4 sm:p-6">
                  <ResultadoSimples
                    s={s}
                    cena={cena}
                    validacao={validacaoFolha}
                    reparticaoAberta={reparticaoAberta}
                    setReparticaoAberta={setReparticaoAberta}
                    relatorioDisponivel={!!relatorio.relatorio}
                    onEditar={() => wizard.irPara(1)}
                    onDas={() => setDasAberto(true)}
                    onInsights={() => setInsightsAberto(true)}
                    onPdf={() => void relatorio.pdf.executar()}
                    pdfCarregando={relatorio.pdf.carregando}
                    onCsv={exportacao.csv}
                    onJson={exportacao.json}
                    onDividir={abrirDivisao}
                    onReiniciar={wizard.reiniciar}
                  />
                </div>
              ) : null
            ) : null}
          </Painel>
        </Entrada>
      </div>

      <DasModal aberto={dasAberto} onFechar={() => setDasAberto(false)} dados={cena.dadosDas} />
      {relatorio.relatorio ? (
        <InsightsModal report={relatorio.relatorio} insights={relatorio.insights} aberto={insightsAberto} onFechar={() => setInsightsAberto(false)} />
      ) : null}
      <ModalDivisaoView />
    </div>
  )
}
