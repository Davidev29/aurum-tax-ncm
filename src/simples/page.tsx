/**
 * Simples Nacional — página isolada (novo recurso, sem impacto na Calculadora).
 *
 * Fluxo em etapas (sem scroll):
 * - Passo 1: escolher Anexo (manual) ou CNPJ → escolher 1 CNAE ("Qual usar?").
 *   Cálculos (Passo 2/3) ficam ocultos até essa escolha.
 * - Ao escolher o CNAE, as demais atividades colapsam e só o foco aparece,
 *   com botão "Trocar atividade" para simular com outra.
 * - Relatório lateral fica oculto até "Visualizar cálculo" (manual e auto).
 *   Durante o cálculo mostra skeleton; depois o resultado com slide-in.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ANEXO_LABEL, type AnexoSimplesId } from './tabelas';
import { fatorR } from './calculo';
import { orquestrarRelatorio } from './relatorio-analitico';
import { gerarInsightsFallback } from './ia-insights';
import { RelatorioAnalitico } from './RelatorioAnalitico';
import { exportarRelatorioAnaliticoCSV, exportarRelatorioAnaliticoJSON, exportarRelatorioAnaliticoPDF } from './export-relatorio-analitico';
import { creditoDaDespesa, envolveAnexoV, etapa1Pronta, normalizarListaAnexosSimples, preverAnexoFatorR, temDuploAnexoFatorR, useSimples, type DespesaSimples } from './store';
import { EMITENTE_PADRAO } from '@/domain/entities';
import { useSessao } from '@/store/sessao';
import { exportarSimplesCSV, exportarSimplesJSON } from './export';
import { BotaoReparticao, DasModal, montarDadosDas } from './DasModal';
import { fmtCarga, fmtCnpj, fmtMoeda, parseMoeda } from '@/domain/services/format';
import { rotuloAnexoSimples } from '@/domain/services/cnae';
import { Btn, IconeBadge, Painel, Selecao, Texto, useAcaoTatil } from '@/ui/kit';
import { toast } from '@/store/ui';

const ANEXOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];

function CampoMoeda({
  rotulo,
  valor,
  onValor,
  placeholder,
  dica,
}: {
  rotulo: string;
  valor: number;
  onValor: (v: number) => void;
  placeholder?: string;
  dica?: string;
}) {
  const [texto, setTexto] = useState(() => (valor > 0 ? `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''));
  useEffect(() => {
    if (valor === 0) setTexto('');
  }, [valor]);
  return (
    <label className="block">
      <span className="field-label">{rotulo}</span>
      <Texto
        mono
        mask="moeda"
        inputMode="decimal"
        className="field-lg num-input"
        placeholder={placeholder ?? 'R$ 0,00'}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          onValor(parseMoeda(e.target.value));
        }}
        onBlur={() => setTexto((t) => (parseMoeda(t) > 0 ? `R$ ${parseMoeda(t).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : t))}
      />
      {dica ? <span className="mt-1 block text-[11px] text-slate-400">{dica}</span> : null}
    </label>
  );
}

function Barra({ partes }: { partes: { rotulo: string; valor: number; classe: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  return (
    <div>
      <div className="calc-bar" aria-hidden="true">
        {partes.map((p) => (
          <span key={p.rotulo} className={p.classe} style={{ width: `${total > 0 ? (p.valor / total) * 100 : 0}%` }} title={`${p.rotulo}: ${fmtMoeda(p.valor)}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
        {partes.filter((p) => p.valor > 0).map((p) => (
          <span key={p.rotulo}>■ {p.rotulo}: {fmtMoeda(p.valor)}</span>
        ))}
      </div>
    </div>
  );
}

function Passo({ n, titulo, desc }: { n: string; titulo: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="calc-step-dot !h-7 !w-7 !text-xs">{n}</span>
      <span>
        <span className="block text-sm font-black tracking-tight">{titulo}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
    </div>
  );
}

export function SimplesNacional() {
  const s = useSimples();
  const [gerando, setGerando] = useState(false);
  const [dasAberto, setDasAberto] = useState(false);
  // Lista de CNAEs: aberta para perguntar "qual usar?"; fecha ao escolher.
  // `true` = usuário pediu para trocar / simular com outra atividade.
  const [forcarLista, setForcarLista] = useState(false);
  const passo2Ref = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const relatorioRef = useRef<HTMLElement>(null);

  // Trocar de modo sempre recomeça com a lista fechada / sem forçar.
  useEffect(() => {
    setForcarLista(false);
  }, [s.modo]);

  const pronta1 = etapa1Pronta(s);
  const comFolha = envolveAnexoV(s);
  const ehDuploAnexo = temDuploAnexoFatorR(s);
  const previsaoFR = useMemo(
    () => (comFolha ? preverAnexoFatorR(s.rbt12, s.folha12) : null),
    [comFolha, s.rbt12, s.folha12],
  );
  const dadosDas = useMemo(
    () =>
      s.convencional
        ? montarDadosDas(s.convencional, {
            modo: s.modo,
            empresaNome: s.empresaNome,
            cnpj: s.cnpj,
            cnae: s.cnaeEscolhido,
            rbt12: s.rbt12,
            receitaMes: s.receitaMes,
          })
        : null,
    [s.convencional, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.rbt12, s.receitaMes],
  );
  const fr = useMemo(
    () => (comFolha && s.rbt12 > 0 && s.folha12 > 0 ? fatorR(s.folha12, s.rbt12) : null),
    [comFolha, s.folha12, s.rbt12],
  );
  const podeVisualizar = pronta1 && s.rbt12 > 0 && s.receitaMes > 0 && !gerando;
  const mostrando = s.relatorioVisivel && s.convencional;
  // Relatório fica OCULTO até o usuário apertar Calcular (manual e automático).
  // Durante o "pensar" da Aurum AI mostra skeleton; antes disso, nada.
  const relatorioAtivo = Boolean(mostrando || gerando);
  // Relatório analítico: mesmos inputs, sem recálculo na IA/UI.
  // Matriz III×V só em CNPJ cujo CNAE tem dois anexos; senão, duelo Conv × Hib do anexo efetivo.
  const relatorioAnalitico = useMemo(
    () => {
      if (!mostrando || !s.convencional) return null;
      const opAtiva = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null;
      const elegiveis = s.modo === 'cnpj'
        ? normalizarListaAnexosSimples(opAtiva?.anexos ?? []).filter((a): a is AnexoSimplesId => ['I', 'II', 'III', 'IV', 'V'].includes(a))
        : [s.convencional.anexoId];
      return orquestrarRelatorio({
        empresa: {
          origem: s.modo === 'manual' ? 'MANUAL' : 'CNPJ_API',
          razaoSocial: s.modo === 'cnpj' && s.empresaNome ? s.empresaNome : 'Contribuinte — cálculo manual',
          cnpj: s.modo === 'cnpj' ? s.cnpj : null,
          cnaePrincipal: s.modo === 'cnpj' ? s.cnaeEscolhido || null : null,
          cnaesSecundarios: s.modo === 'cnpj' ? s.opcoes.filter((o) => o.cnae7 !== s.cnaeEscolhido).map((o) => o.cnae7) : [],
          regimeAtual: s.modo === 'cnpj' && s.opcaoSimples != null ? (s.opcaoSimples ? 'Optante do Simples' : 'Não optante (simulação)') : null,
        },
        competencia: new Date().toISOString().slice(0, 7),
        exercicioReferencia: new Date().getFullYear(),
        rbt12: s.rbt12,
        rba: s.usarRba ? s.rba : s.rbt12,
        receitaMes: s.receitaMes,
        folha12: s.folha12,
        cbsRef: s.cbsRef,
        despesas: s.despesas.map((d) => ({ rotulo: d.rotulo, valor: d.valor, regra: d.regra })),
        contexto: {
          modo: s.modo,
          anexoSelecionado: s.convencional.anexoId,
          anexosElegiveis: elegiveis.length > 0 ? elegiveis : [s.convencional.anexoId],
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mostrando, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.opcoes, s.rbt12, s.receitaMes, s.folha12, s.cbsRef, s.despesas, s.usarRba, s.rba, s.convencional],
  );
  const insightsAnaliticos = useMemo(
    () => (relatorioAnalitico ? gerarInsightsFallback(relatorioAnalitico) : []),
    [relatorioAnalitico],
  );
  const pdfAnalitico = useAcaoTatil(async () => {
    if (!relatorioAnalitico) {
      toast('Visualize o cálculo antes de exportar.', 'warn');
      return;
    }
    const emitente = useSessao.getState().emitente ?? EMITENTE_PADRAO;
    await exportarRelatorioAnaliticoPDF(relatorioAnalitico, insightsAnaliticos, emitente);
    toast('Relatório analítico em PDF gerado.', 'ok');
  });

  const cnaeAtivo = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null;
  const mostrarListaCnae = s.modo === 'cnpj' && s.opcoes.length > 0 && (!s.cnaeEscolhido || forcarLista);
  const mostrarCnaeFocado = s.modo === 'cnpj' && cnaeAtivo && !mostrarListaCnae;

  const rolarPara = (ref: React.RefObject<HTMLDivElement | HTMLElement | null>) => {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const aoEscolherAnexo = (a: AnexoSimplesId) => {
    s.setAnexo(a);
    rolarPara(passo2Ref);
  };

  const aoEscolherCnae = (cnae7: string) => {
    s.escolherCnae(cnae7);
    setForcarLista(false);
    rolarPara(passo2Ref);
  };

  const aoTrocarAtividade = () => {
    setForcarLista(true);
    rolarPara(listaRef);
  };

  const visualizar = () => {
    if (!podeVisualizar) {
      toast('Informe RBT12 e receita do mês.', 'warn');
      return;
    }
    setGerando(true);
    // Micro-interação Aurum AI: pensa antes de revelar. O aside já abre aqui
    // em modo skeleton, e o resultado entra com slide-in.
    window.requestAnimationFrame(() => {
      relatorioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    window.setTimeout(() => {
      s.calcular();
      setGerando(false);
      window.requestAnimationFrame(() => {
        relatorioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }, 750);
  };

  const payload = () =>
    s.convencional
      ? {
          anexoId: s.convencional.anexoId,
          rbt12: s.rbt12,
          receitaMes: s.receitaMes,
          folha12: s.folha12,
          rba: s.usarRba ? s.rba : s.rbt12,
          cbsRef: s.cbsRef,
          conv: s.convencional,
          hib: s.hibrido,
          debitosCBS: s.debitosCBS,
          creditosCBS: s.creditosCBS,
          empresa: s.empresaNome,
          cnae: s.cnaeEscolhido,
        }
      : null;

  const editarDespesa = (id: string, patch: Partial<DespesaSimples>) => {
    s.setDespesas(s.despesas.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  return (
    <>
    <div className={`grid grid-cols-1 gap-6 transition-all duration-500 ${relatorioAtivo ? 'lg:grid-cols-[minmax(0,1fr)_400px]' : ''}`}>
      <div className="min-w-0 space-y-6">
        <Painel className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-5">
            <IconeBadge nome="calculadora" tom="brand" tamanho="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-black tracking-tight">Simples Nacional</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                LC 123/2006 + Reforma (CBS/IBS) · vigência 2027–2028 · módulo isolado
              </p>
            </div>
            <span className="pill bg-brand-100 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">NOVO</span>
          </div>

          <div className="flex gap-2 border-b border-[var(--line)] bg-slate-50/60 px-5 py-3 dark:bg-slate-950/40">
            {(['manual', 'cnpj'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => s.set({ modo: m })}
                aria-pressed={s.modo === m}
                className={`btn btn-press flex-1 transition-all duration-200 ${s.modo === m ? 'btn-primary' : 'btn-ghost'}`}
              >
                {m === 'manual' ? '✋ Manual (escolher Anexo)' : '🏢 Automático (por CNPJ)'}
              </button>
            ))}
          </div>

          <div className="space-y-6 p-5" key={s.modo}>
            {/* PASSO 1 */}
            <section className="space-y-3">
              <Passo n="1" titulo={s.modo === 'manual' ? 'Qual Anexo você quer simular?' : 'Digite o CNPJ da empresa'} desc={s.modo === 'manual' ? 'Toque num Anexo para liberar o restante.' : 'Buscamos as atividades e você escolhe 1 para simular.'} />
              {s.modo === 'manual' ? (
                <div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {ANEXOS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => aoEscolherAnexo(a)}
                        aria-pressed={s.anexoId === a && s.escolheuAnexo}
                        className={`rounded-xl border px-3 py-2.5 text-left transition-all duration-200 btn-press ${
                          s.anexoId === a && s.escolheuAnexo
                            ? 'border-brand-700 bg-brand-700 text-white shadow-pop scale-[1.02]'
                            : 'border-[var(--line)] bg-white hover:border-aurum-500 hover:scale-[1.01] active:scale-[0.99] dark:bg-slate-900'
                        }`}
                      >
                        <span className={`block font-mono text-sm font-black ${s.anexoId === a && s.escolheuAnexo ? 'text-aurum-200' : 'text-brand-700 dark:text-aurum-200'}`}>{a}</span>
                        <span className={`block truncate text-[10px] ${s.anexoId === a && s.escolheuAnexo ? 'text-white/80' : 'text-slate-500'}`}>
                          {a === 'I' ? 'Comércio' : a === 'II' ? 'Indústria' : a === 'III' ? 'Serviços' : a === 'IV' ? 'S/ CPP' : 'Fator R'}
                        </span>
                      </button>
                    ))}
                  </div>
                  {s.escolheuAnexo ? (
                    <p className="mt-1.5 animate-fade-up text-[11px] text-emerald-600">{ANEXO_LABEL[s.anexoId]} selecionado ✓</p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-slate-50/50 p-4 dark:bg-slate-950/30">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="flex-1">
                      <span className="field-label">CNPJ</span>
                      <Texto mono mask="cnpj" placeholder="00.000.000/0000-00" value={s.cnpj} onChange={(e) => s.set({ cnpj: e.target.value })} />
                    </div>
                    <div className="flex items-end">
                      <Btn variante="primary" carregando={s.buscandoCnpj} onClick={() => void s.buscarPorCnpj()}>
                        {s.buscandoCnpj ? 'Buscando…' : '🔍 Buscar atividades'}
                      </Btn>
                    </div>
                  </div>
                  {s.empresaNome ? (
                    <div className="animate-fade-up text-xs">
                      <strong>{s.empresaNome}</strong> <span className="font-mono text-slate-500">{fmtCnpj(s.cnpj)}</span>{' '}
                      {s.opcaoSimples == null ? null : s.opcaoSimples ? (
                        <span className="pill bg-emerald-100 text-emerald-800">Simples optante</span>
                      ) : (
                        <span className="pill bg-amber-100 text-amber-800">Não optante (simulação)</span>
                      )}
                    </div>
                  ) : null}

                  {/* Pergunta qual CNAE usar — lista aberta só neste momento */}
                  {mostrarListaCnae ? (
                    <div ref={listaRef as React.RefObject<HTMLDivElement>} className="animate-fade-up scroll-mt-24 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="field-label">Qual atividade (CNAE) usar na consulta? · {s.opcoes.length} encontrada{s.opcoes.length === 1 ? '' : 's'}</span>
                        {s.opcoes.length > 4 ? (
                          <span className="text-[10px] text-slate-400">Toque numa atividade para focar e liberar os cálculos</span>
                        ) : null}
                      </div>
                      <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
                        {s.opcoes.map((o, i) => {
                          const anexosNorm = normalizarListaAnexosSimples(o.anexos);
                          const ehDuplo = anexosNorm.includes('III') && anexosNorm.includes('V');
                          return (
                          <button
                            key={o.cnae7}
                            type="button"
                            onClick={() => aoEscolherCnae(o.cnae7)}
                            aria-pressed={s.cnaeEscolhido === o.cnae7}
                            style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                            className="btn-press flex w-full animate-fade-up items-start gap-3 rounded-xl border border-[var(--line)] bg-white p-3 text-left transition-all duration-200 hover:-translate-y-px hover:border-aurum-500 hover:shadow-card active:translate-y-0 active:scale-[0.99] dark:bg-slate-900"
                          >
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-transparent transition-all duration-200">
                              <span className="text-[10px]">✓</span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs font-black">{o.codigoFormatado}</span>
                                {o.principal ? <span className="pill bg-brand-100 text-brand-700">principal</span> : null}
                                {anexosNorm.length ? (
                                  <span className="pill bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosNorm)}</span>
                                ) : (
                                  <span className="pill bg-red-100 text-red-700">sem anexo</span>
                                )}
                                {o.exigeFatorR ? <span className="pill bg-amber-100 text-amber-800">Fator R</span> : null}
                                {ehDuplo ? (
                                  <span className="pill bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">folha decide III × V</span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-slate-600 dark:text-slate-300">{o.descricao}</span>
                            </span>
                          </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-slate-400">Os cálculos ficam ocultos até você escolher — isso evita scroll com todas as atividades.</p>
                    </div>
                  ) : null}

                  {/* Atividade focada — demais ocultas + botão trocar */}
                  {mostrarCnaeFocado ? (
                    <div className="animate-pop-in space-y-2" key={cnaeAtivo!.cnae7}>
                      <div className="flex items-start gap-3 rounded-2xl border-2 border-brand-700/70 bg-brand-50/60 p-3 shadow-card dark:bg-brand-950/25">
                        <span className="grid h-6 w-6 shrink-0 animate-pop-in place-items-center rounded-full bg-brand-700 text-xs font-black text-white">✓</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-black">{cnaeAtivo!.codigoFormatado}</span>
                            {cnaeAtivo!.principal ? <span className="pill bg-brand-100 text-brand-700">principal</span> : null}
                            {(() => {
                              const anexosFoco = normalizarListaAnexosSimples(cnaeAtivo!.anexos);
                              return anexosFoco.length ? (
                              <span className="pill bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosFoco)}</span>
                            ) : (
                              <span className="pill bg-red-100 text-red-700">sem anexo</span>
                              );
                            })()}
                            {cnaeAtivo!.exigeFatorR ? <span className="pill bg-amber-100 text-amber-800">Fator R</span> : null}
                            <span className="pill bg-emerald-100 text-emerald-800">em simulação</span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">{cnaeAtivo!.descricao}</p>
                          {s.opcoes.length > 1 ? (
                            <p className="mt-0.5 text-[11px] text-slate-400">+ {s.opcoes.length - 1} outra{s.opcoes.length - 1 === 1 ? '' : 's'} atividade{s.opcoes.length - 1 === 1 ? '' : 's'} oculta{s.opcoes.length - 1 === 1 ? '' : 's'} para enxugar a tela</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Btn tam="sm" className="btn-press transition-all duration-200 hover:-translate-y-px active:translate-y-0" onClick={aoTrocarAtividade}>
                          🔄 Trocar atividade · simular com outra
                        </Btn>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {/* PASSO 2 — oculto até o passo 1 (sem scroll inicial) */}
            {pronta1 ? (
              <section ref={passo2Ref} className="animate-fade-up scroll-mt-24 space-y-4 border-t border-[var(--line)] pt-5">
                <Passo n="2" titulo="Informe os valores" desc="RBT12 e receita do mês. Folha só aparece para o Fator R (Anexo V)." />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <CampoMoeda rotulo="RBT12 — receita 12 meses" valor={s.rbt12} onValor={(v) => { s.set({ rbt12: v }); s.tocarEntrada(); }} dica="Soma dos últimos 12 meses (teto 4,8M)" />
                  <CampoMoeda rotulo="Receita do mês" valor={s.receitaMes} onValor={(v) => { s.set({ receitaMes: v }); s.tocarEntrada(); }} dica="Base do DAS deste PA" />
                </div>
                {comFolha ? (
                  <div className="animate-fade-up space-y-2">
                    <CampoMoeda
                      rotulo={ehDuploAnexo ? 'Folha de salários 12m (Fator R — decide III × V)' : 'Folha de salários 12m (Fator R)'}
                      valor={s.folha12}
                      onValor={(v) => { s.set({ folha12: v }); s.tocarEntrada(); }}
                      dica={fr ? `Fator R ${(fr.indice * 100).toFixed(2)}% → ${fr.anexo === 'III' ? 'Anexo III (≥ 28%)' : 'Anexo V (< 28%)'}` : 'Salários + pró-labore + FGTS dos últimos 12 meses'}
                    />
                    {previsaoFR ? (
                      previsaoFR.definido ? (
                        <p
                          role="status"
                          className={`animate-fade-up rounded-xl px-3 py-2 text-xs font-bold transition-all duration-300 ${
                            previsaoFR.anexo === 'III'
                              ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
                          }`}
                        >
                          Anexo utilizado: {previsaoFR.anexo === 'III' ? 'Anexo III' : 'Anexo V'} · Fator R {(previsaoFR.indice * 100).toFixed(2)}%{' '}
                          {previsaoFR.anexo === 'III' ? '≥ 28%' : '< 28%'} (automático pela folha)
                        </p>
                      ) : (
                        <p role="status" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Anexo provisório: Anexo V — informe RBT12 e folha para aplicar o Fator R (≥ 28% → III · &lt; 28% → V).
                        </p>
                      )
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    {s.modo === 'manual' && (s.anexoId === 'III' || s.anexoId === 'IV')
                      ? 'Anexo sem Fator R: folha dispensada.'
                      : 'Sem Anexo V envolvido: folha dispensada.'}
                  </p>
                )}

                <div className="rounded-2xl border border-[var(--line)] p-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={s.usarRba} onChange={(e) => { s.set({ usarRba: e.target.checked }); s.tocarEntrada(); }} />
                    RBA diferente do RBT12 (sublimite R$ 3,6M)
                  </label>
                  {s.usarRba ? (
                    <div className="mt-3 animate-fade-up">
                      <CampoMoeda rotulo="RBA — acumulada no ano" valor={s.rba} onValor={(v) => { s.set({ rba: v }); s.tocarEntrada(); }} dica="Excedente = MIN(receita, MAX(0, RBA − 3,6M))" />
                    </div>
                  ) : null}
                </div>

                {/* Comparar híbrido */}
                <div className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-700"
                      checked={s.compararHibrido}
                      onChange={(e) => { s.set({ compararHibrido: e.target.checked }); s.tocarEntrada(); }}
                    />
                    ⚖️ Comparar com o regime híbrido?
                  </label>
                  {!s.compararHibrido ? (
                    <p className="mt-1.5 text-[11px] text-slate-400">Ative para informar CBS de referência e despesas com crédito.</p>
                  ) : (
                    <div className="mt-3 animate-fade-up space-y-3">
                      <div>
                        <span className="field-label">Alíquota CBS referência (%)</span>
                        <Texto
                          type="number" step="0.01" min={0} max={30} mono className="field-lg num-input"
                          value={String((s.cbsRef * 100).toFixed(2))}
                          onChange={(e) => { const v = Number(e.target.value.replace(',', '.')) || 0; s.set({ cbsRef: v / 100 }); s.tocarEntrada(); }}
                        />
                        <span className="mt-1 block text-[11px] text-slate-400">Padrão 8,80% (Dashboard)</span>
                      </div>
                      <div className="space-y-2">
                        <span className="field-label">Despesas do mês (crédito CBS por item)</span>
                        {s.despesas.map((d) => {
                          const cred = creditoDaDespesa(d, s.cbsRef);
                          return (
                            <div key={d.id} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 transition-all duration-200 dark:bg-slate-900">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{d.rotulo}</span>
                                <input
                                  className="field field-sm mono w-28 !py-1.5 text-right"
                                  inputMode="decimal"
                                  value={d.valor > 0 ? String(d.valor).replace('.', ',') : ''}
                                  placeholder="0"
                                  onChange={(e) => editarDespesa(d.id, { valor: parseMoeda(e.target.value) })}
                                />
                                <Selecao className="!w-32 !py-1.5 text-xs" value={d.regra} onChange={(e) => editarDespesa(d.id, { regra: e.target.value as DespesaSimples['regra'] })}>
                                  <option value="integral">Integral</option>
                                  <option value="red30">Red. 30%</option>
                                  <option value="red60">Red. 60%</option>
                                  <option value="zero">Zero</option>
                                  <option value="semCredito">Sem crédito</option>
                                </Selecao>
                                <button type="button" className="btn-press text-slate-300 transition hover:scale-110 hover:text-red-500 active:scale-95" title="Remover" onClick={() => s.setDespesas(s.despesas.filter((x) => x.id !== d.id))}>✕</button>
                              </div>
                              <div className="mt-1 flex items-center justify-between font-mono text-[11px]">
                                <span className="text-slate-400">
                                  {/aluguel/i.test(d.rotulo) ? '30% da alíquota' : d.regra === 'integral' ? 'crédito integral' : d.regra === 'red30' ? '70% da alíquota' : d.regra === 'red60' ? '40% da alíquota' : 'sem crédito'}
                                </span>
                                <span className={`font-bold transition-all duration-300 ${cred > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300'}`}>
                                  → crédito {fmtMoeda(cred)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        <Btn tam="sm" onClick={() => s.setDespesas([...s.despesas, { id: `s${Date.now()}`, rotulo: 'Outra despesa', valor: 0, regra: 'integral' }])}>
                          ➕ Adicionar despesa
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>

                {/* PASSO 3 */}
                <div className="rounded-2xl bg-gradient-to-r from-brand-700 to-brand-600 p-4 text-white shadow-pop">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black">Passo 3 · Ver cálculo com a Aurum AI</div>
                      <div className="text-[11px] text-white/70">O relatório ao lado só aparece após este botão.</div>
                    </div>
                    <Btn
                      variante="primary"
                      className="btn-press !border-aurum-300 !bg-gradient-to-r !from-aurum-400 !to-aurum-500 !text-brand-950 transition-all duration-200 hover:brightness-110 active:scale-95 disabled:opacity-60"
                      carregando={gerando}
                      disabled={!podeVisualizar}
                      onClick={visualizar}
                    >
                      {gerando ? 'Aurum AI calculando…' : '✨ Visualizar cálculo'}
                    </Btn>
                  </div>
                  {gerando ? <div className="loading-bar mt-3 h-1.5 w-1/3 rounded-full bg-aurum-300/80" /> : null}
                </div>
              </section>
            ) : (
              <p className="rounded-2xl border border-dashed border-[var(--line)] bg-slate-50/50 px-4 py-3 text-center text-xs text-slate-400 dark:bg-slate-950/30">
                {s.modo === 'manual'
                  ? '↑ Escolha um Anexo acima para liberar os cálculos.'
                  : s.opcoes.length === 0
                    ? '↑ Busque o CNPJ para ver as atividades — os cálculos ficam ocultos até você escolher 1.'
                    : '↑ Escolha 1 atividade acima — as demais somem e os cálculos aparecem.'}
              </p>
            )}
          </div>
        </Painel>
      </div>

      {/* Relatório — OCULTO até Calcular (manual e automático). */}
      {relatorioAtivo ? (
        <aside ref={relatorioRef} className="scroll-mt-24 space-y-4 lg:sticky lg:top-4 lg:h-fit" aria-live="polite">
          {gerando && !mostrando ? (
            <div className="animate-slide-in overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
              <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
                <span className="grid h-9 w-9 animate-pulse-soft place-items-center rounded-xl bg-gradient-to-br from-brand-700 to-brand-600 text-white">✨</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black">Aurum AI está calculando…</div>
                  <div className="text-[11px] text-slate-500">Cruzando RBT12, faixa e repartição da planilha…</div>
                </div>
              </div>
              <div className="space-y-2.5 p-5">
                <div className="skeleton h-8 w-2/3" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-5/6" />
                <div className="skeleton h-16 w-full" />
                <div className="loading-bar h-1.5 w-1/2 rounded-full bg-gradient-to-r from-brand-700 via-aurum-400 to-emerald-500" />
              </div>
            </div>
          ) : mostrando ? (
            <div className="animate-slide-in space-y-4" key={`${s.convencional!.anexoId}-${s.convencional!.das}`}>
              <div className="calc-hero overflow-hidden rounded-2xl">
                <div className="px-5 pb-4 pt-5">
                  <div className="flex items-center justify-between">
                    <span className="calc-hero-rotulo">DAS · {ANEXO_LABEL[s.convencional!.anexoId]} · {s.convencional!.faixa}ª faixa</span>
                    <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                      {s.convencional!.cenario === 1 ? 'sem sublimite' : `sublimite cen. ${s.convencional!.cenario}`}
                    </span>
                  </div>
                  <div className="calc-hero-valor mt-1 text-[26px] leading-tight text-white">GUIA DAS: {fmtMoeda(s.convencional!.das)}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-white/75">
                    <span>CBS dentro {fmtMoeda(s.convencional!.cbsDentroDAS)}</span>
                    <span className="rounded-full bg-aurum-400/25 px-2 py-0.5 font-mono font-bold text-aurum-200">
                      efetiva {fmtCarga(s.convencional!.aliquotaEfetiva * 100)}
                    </span>
                  </div>
                  <div className="mt-3">
                    <Barra
                      partes={[
                        { rotulo: 'IRPJ', valor: s.convencional!.reparticao.IRPJ, classe: 'calc-bar-ibs' },
                        { rotulo: 'CSLL', valor: s.convencional!.reparticao.CSLL, classe: 'calc-bar-ibs' },
                        { rotulo: 'CBS', valor: s.convencional!.reparticao.CBS, classe: 'calc-bar-cbs' },
                        { rotulo: 'IBS', valor: s.convencional!.reparticao.IBS, classe: 'calc-bar-ibs' },
                        { rotulo: 'CPP', valor: s.convencional!.reparticao.CPP, classe: 'calc-bar-cbs' },
                        { rotulo: 'ICMS/IPI/ISS', valor: s.convencional!.reparticao.ICMS + s.convencional!.reparticao.IPI + s.convencional!.reparticao.ISS, classe: 'calc-bar-ibs' },
                      ]}
                    />
                  </div>
                </div>
                <div className="space-y-1.5 bg-white px-5 py-4 text-sm dark:bg-slate-900">
                  {(['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'] as const).map((t) => (
                    s.convencional!.reparticao[t] > 0 ? (
                      <div key={t} className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">{t}</span>
                        <span className="font-mono font-semibold">{fmtMoeda(s.convencional!.reparticao[t])}</span>
                      </div>
                    ) : null
                  ))}
                  {s.convencional!.excedenteISS > 0 ? (
                    <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      ISS travado em 5% (excedente {(s.convencional!.excedenteISS * 100).toFixed(4)}% redistribuído).
                    </p>
                  ) : null}
                  {s.convencional!.cenario !== 1 ? (
                    <p className="rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                      Sublimite cen. {s.convencional!.cenario} · não-excedente {fmtMoeda(s.convencional!.detalhes.receitaNaoExcedente)} · excedente {fmtMoeda(s.convencional!.detalhes.receitaExcedente)}.
                    </p>
                  ) : null}
                  {fr && comFolha ? (
                    <p className={`rounded-lg px-2 py-1.5 text-[11px] ${fr.anexo === 'III' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                      Fator R {(fr.indice * 100).toFixed(2)}% → {fr.anexo === 'III' ? 'Anexo III (≥ 28%)' : 'Anexo V (< 28%)'} · cálculo automático pela folha.
                    </p>
                  ) : comFolha ? (
                    <p className="rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Sem folha informada — cálculo provisório pelo Anexo V. Informe a folha para aplicar o Fator R (≥ 28% → III).
                    </p>
                  ) : null}
                  <div className="pt-1">
                    <BotaoReparticao onClick={() => setDasAberto(true)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 bg-white px-4 pb-4 dark:bg-slate-900">
                  <Btn className="flex-1" onClick={() => { s.limpar(); setForcarLista(false); toast('Simulação limpa.', 'warn'); }}>Limpar</Btn>
                  <Btn variante="primary" className="flex-[2]" carregando={pdfAnalitico.carregando} onClick={() => pdfAnalitico.executar()}>
                    {pdfAnalitico.carregando ? 'Gerando…' : '📕 PDF analítico'}
                  </Btn>
                </div>
              </div>

              {s.compararHibrido && s.hibrido ? (
                <Painel>
                  <div className="border-b border-[var(--line)] px-5 py-3">
                    <h3 className="calc-step text-slate-500"><span className="calc-step-dot">⚖</span> Convencional vs Híbrido</h3>
                  </div>
                  <div className="space-y-2 p-4 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">DAS convencional</span><strong className="font-mono">{fmtMoeda(s.convencional!.das)}</strong></div>
                    <div className="flex justify-between"><span className="text-slate-500">DAS reduzido (sem CBS)</span><strong className="font-mono">{fmtMoeda(s.hibrido.dasReduzido)}</strong></div>
                    <div className="flex justify-between"><span className="text-slate-500">CBS fora (débitos {fmtMoeda(s.debitosCBS)} − créditos {fmtMoeda(s.creditosCBS)})</span><strong className="font-mono">{fmtMoeda(s.hibrido.cbsFora)}</strong></div>
                    <div className="flex justify-between border-t border-[var(--line)] pt-2"><span className="font-bold">Total híbrido</span><strong className="font-mono">{fmtMoeda(s.hibrido.total)}</strong></div>
                    <div className={`rounded-xl px-3 py-2 text-center font-bold transition-all duration-300 ${
                      s.hibrido.melhor === 'hibrido' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : s.hibrido.melhor === 'convencional' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
                      : 'bg-slate-100 text-slate-600'}`}>
                      {s.hibrido.melhor === 'empate' ? 'Empate técnico' : s.hibrido.melhor === 'hibrido'
                        ? `Híbrido vence · economia ${fmtMoeda(Math.abs(s.hibrido.economiaVsConvencional))}`
                        : `Convencional vence · economia ${fmtMoeda(Math.abs(s.hibrido.economiaVsConvencional))}`}
                    </div>
                    {s.hibrido.saldoCredor > 0 ? (
                      <p className="text-[11px] text-slate-400">Saldo credor CBS {fmtMoeda(s.hibrido.saldoCredor)} acumula p/ o mês seguinte.</p>
                    ) : null}
                  </div>
                </Painel>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Btn tam="sm" className="flex-1" onClick={() => { const p = payload(); if (p) exportarSimplesCSV(p); }}>📄 CSV</Btn>
                <Btn tam="sm" className="flex-1" onClick={() => { const p = payload(); if (p) exportarSimplesJSON(p); }}>🧾 JSON</Btn>
                <Btn tam="sm" variante="primary" className="flex-1" carregando={pdfAnalitico.carregando} onClick={() => pdfAnalitico.executar()}>📕 PDF analítico</Btn>
              </div>
              <p className="px-1 text-[10px] leading-relaxed text-slate-400">
                Planilhas 2027–2028 · confirme com o contador. A partir de 2029 as porcentagens mudam.
              </p>
            </div>
          ) : null}
        </aside>
      ) : null}
      </div>

      {/* Módulo analítico premium: matriz 10 cenários + Fator r + IA read-only. */}
      {relatorioAnalitico ? (
        <Painel className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-black tracking-tight">Relatório Analítico e Inteligente</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {relatorioAnalitico.contexto.mostrarMatrizIIIV
                  ? 'Matriz III × V (CNPJ dual) · Convencional × Híbrido · Fator r · Insights IA em modo leitura'
                  : `Duelo Convencional × Híbrido · Anexo ${relatorioAnalitico.dueloFoco.anexo} · Memória do híbrido · Insights IA em modo leitura`}
              </p>
            </div>
            <span className="pill bg-brand-100 text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">EXECUTIVO</span>
          </div>
          <div className="space-y-6 p-5">
            <RelatorioAnalitico report={relatorioAnalitico} insights={insightsAnaliticos} />
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
              <Btn tam="sm" className="flex-1" onClick={() => exportarRelatorioAnaliticoCSV(relatorioAnalitico)}>📄 CSV analítico</Btn>
              <Btn tam="sm" className="flex-1" onClick={() => exportarRelatorioAnaliticoJSON(relatorioAnalitico, insightsAnaliticos)}>🧾 JSON canônico</Btn>
              <Btn tam="sm" variante="primary" className="flex-[2]" carregando={pdfAnalitico.carregando} onClick={() => pdfAnalitico.executar()}>
                {pdfAnalitico.carregando ? 'Gerando…' : '📕 PDF analítico premium'}
              </Btn>
            </div>
          </div>
        </Painel>
      ) : null}
      <DasModal aberto={dasAberto} onFechar={() => setDasAberto(false)} dados={dadosDas} />
    </>
  );
}
