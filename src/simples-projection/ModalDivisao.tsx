/**
 * Simples Projection — modal "Simular dividir faturamento" em FLUXO ANIMADO (5 etapas).
 *
 * Etapas: 1 RTB12 → 2 Receita → 3 Divisão → 4 Custos & Fator R → 5 Resultado.
 * - Cabeçalho com período de referência (baseline mês atual = 09/setembro).
 * - Entrada RTB12 manual (mês a mês) ou automática (total distribuído por curva).
 * - Slider 0–100% com recálculo em tempo real + crossfade Empresa única ↔ Segregada.
 * - Transições 300–500ms ease-in-out via framer-motion; números animados;
 *   pulso/glow no payback (ver `SimuladorSegregacao.tsx`).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AnexoSimplesId } from '@/simples/tabelas';
import { fmtCnpj, fmtMoeda, parseMoeda } from '@/domain/services/format';
import { Btn, Modal, Pill, Selecao, Texto } from '@/ui/kit';
import { toast } from '@/store/ui';
import { simularCenarioDividido } from './cenario-dividido';
import type { ConfigEmpresaCenario } from './types';
import { periodoReferencia, validarRTB12, historico12Labels, rotuloPeriodo } from './baseline';
import { salvarRTB12 } from './persistencia';
import { useProjecaoDividida } from './store';
import { ControleSplit } from './ControleSplit';
import { SimuladorSegregacao } from './SimuladorSegregacao';
import { NumeroAnimado } from './NumeroAnimado';
import { exportarProjecaoCSV, exportarProjecaoJSON } from './export';

const ANEXOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];

const PASSOS = [
  { titulo: 'RTB12', instrucao: 'Total (automático, com 👁 de conferência) ou mês a mês (botão Preencher). RTB12 ≠ 0. A receita do mês em curso semeia a próxima tela.' },
  { titulo: 'Receita', instrucao: 'Projeção semeada pela tela anterior — ajuste livre mês a mês ou por valor global.' },
  { titulo: 'Divisão', instrucao: 'Slider 0–100%, anexos, folha (quando III/V) e segregação por anexo — tudo recalcula ao vivo.' },
  { titulo: 'Custos & Fator R', instrucao: 'Custo mensal + abertura + margem de empate. Folha 12m só quando o anexo usa Fator R.' },
  { titulo: 'Resultado', instrucao: 'Virada, payback e veredito — alterne Empresa única ↔ Segregada e passe o mouse nos meses.' },
] as const;

function rotuloMesCurto(mes: string): string {
  const [a, m] = mes.split('-');
  return `${m}/${String(a).slice(2)}`;
}

function CampoValor({ rotulo, valor, onValor, dica }: { rotulo: string; valor: number; onValor: (v: number) => void; dica?: string }) {
  return (
    <label className="block">
      <span className="field-label">{rotulo}</span>
      <Texto
        mono
        mask="moeda"
        inputMode="decimal"
        className="field num-input"
        placeholder="R$ 0,00"
        value={valor > 0 ? `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}
        onChange={(e) => onValor(parseMoeda(e.target.value))}
      />
      {dica ? <span className="mt-1 block text-[11px] text-slate-400">{dica}</span> : null}
    </label>
  );
}

function EditorComposicao({
  titulo,
  anexoPrincipal,
  extra,
  onChange,
}: {
  titulo: string;
  anexoPrincipal: AnexoSimplesId;
  extra: { anexoId: AnexoSimplesId; percentual: number } | null;
  onChange: (v: { anexoId: AnexoSimplesId; percentual: number } | null) => void;
}) {
  const opcoes = ANEXOS.filter((a) => a !== anexoPrincipal);
  if (!extra) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-[var(--line)] px-3 py-2 text-[11px]">
        <strong>{titulo}: 100% no Anexo {anexoPrincipal}</strong>
        <button
          type="button"
          onClick={() => onChange({ anexoId: opcoes[0] ?? 'I', percentual: 0.4 })}
          className="ml-auto rounded-full border border-[var(--line)] px-2.5 py-1 font-bold text-slate-500 transition-all duration-300 hover:border-brand-700 hover:text-brand-700"
        >
          + Receita em mais de um anexo
        </button>
      </div>
    );
  }
  const pct = Math.round(extra.percentual * 100);
  return (
    <div className="space-y-2 rounded-2xl border border-brand-700/30 bg-brand-50/40 px-3 py-2 dark:bg-brand-950/20">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
        <span>{titulo}: {100 - pct}% no Anexo {anexoPrincipal} + {pct}% no Anexo {extra.anexoId}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto rounded-full border border-[var(--line)] px-2.5 py-1 text-slate-500 transition-all duration-300 hover:border-red-600 hover:text-red-600"
        >
          Remover 2º anexo
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">2º anexo da {titulo.toLowerCase()}</span>
          <Selecao value={extra.anexoId} onChange={(e) => onChange({ anexoId: e.target.value as AnexoSimplesId, percentual: extra.percentual })}>
            {opcoes.map((a) => <option key={a} value={a}>Anexo {a}</option>)}
          </Selecao>
        </label>
        <label className="block">
          <span className="field-label">% da receita no Anexo {extra.anexoId}: {pct}%</span>
          <input
            type="range"
            min={1}
            max={99}
            step={1}
            value={pct}
            onChange={(e) => onChange({ anexoId: extra.anexoId, percentual: Number(e.target.value) / 100 })}
            className="mt-2 w-full accent-brand-700"
            aria-label={`Percentual no segundo anexo da ${titulo}`}
          />
        </label>
      </div>
      <p className="text-[10px] text-slate-500">A RBT12 total define a faixa em cada tabela; o DAS é a soma (LC 123/2006, art. 18).</p>
    </div>
  );
}

export function ModalDivisao() {
  const s = useProjecaoDividida();
  const [passo, setPasso] = useState(0);
  const [direcao, setDirecao] = useState(1);
  const [preencherAberto, setPreencherAberto] = useState(false);
  const [verDistribuicao, setVerDistribuicao] = useState(false);

  const historicoMeses = useMemo(() => historico12Labels(s.mesInicio), [s.mesInicio]);
  const validacao = useMemo(() => validarRTB12(s.historicoMae12), [s.historicoMae12]);
  const periodo = useMemo(() => periodoReferencia(s.historicoMae12), [s.historicoMae12]);

  // Garante 12 linhas de histórico alinhadas ao mesInicio.
  useEffect(() => {
    if (!s.aberto) return;
    if (s.historicoMae12.length === 12) return;
    const mapa = new Map(s.historicoMae12.map((r) => [r.mes, r.receita]));
    const serie = historicoMeses.map((mes) => ({ mes, receita: mapa.get(mes) ?? 0 }));
    s.set({ historicoMae12: serie });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.aberto, s.mesInicio]);

  // Steps automáticos: ao chegar na Receita (ou avançar da RTB12) com a
  // projeção intocada, semeia mês atual (senão média do histórico).
  // Só dispara com projeção limpa — nunca sobrescreve ajuste manual.
  useEffect(() => {
    if (!s.aberto || passo !== 1) return;
    s.semearProjecaoSeLimpa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.aberto, passo]);

  const relatorio = useMemo(() => {
    if (!s.aberto) return null;
    try {
      if (s.receitaTotalMensal.length === 0) return null;
      const compor = (
        anexo: typeof s.anexoMae,
        extra: typeof s.composicaoExtraMae,
      ): ConfigEmpresaCenario['composicao'] => {
        if (!extra || !(extra.percentual > 0) || extra.percentual >= 1 || extra.anexoId === anexo) return undefined;
        return [
          { anexoId: anexo, percentual: 1 - extra.percentual },
          { anexoId: extra.anexoId, percentual: extra.percentual },
        ];
      };
      return simularCenarioDividido({
        mesInicio: s.mesInicio,
        receitaTotalMensal: s.receitaTotalMensal.map((r) => ({ mes: r.mes, receita: Math.max(0, Number(r.receita) || 0) })),
        percentualNova: s.percentualNova,
        mae: {
          anexoId: s.anexoMae,
          folha12: Math.max(0, s.folha12Mae),
          historico12: s.historicoMae12,
          mesesAtividade: Math.max(0, Math.min(24, Math.round(s.mesesAtividadeMae))),
          composicao: compor(s.anexoMae, s.composicaoExtraMae),
          dispensarFatorR: !s.sujeitaFatorRMae,
        },
        nova: {
          anexoId: s.anexoNova,
          folha12: Math.max(0, s.folha12Nova),
          historico12: [],
          mesesAtividade: s.mesesAtividadeNova,
          composicao: compor(s.anexoNova, s.composicaoExtraNova),
          dispensarFatorR: !s.sujeitaFatorRNova,
        },
        custoMensalNova: Math.max(0, s.custoMensalNova),
        custoInicialNova: Math.max(0, s.custoInicialNova),
        margemEmpate: Math.max(0, s.margemEmpate),
      });
    } catch {
      return null;
    }
  }, [s.aberto, s.mesInicio, s.receitaTotalMensal, s.percentualNova, s.anexoMae, s.anexoNova, s.composicaoExtraMae, s.composicaoExtraNova, s.sujeitaFatorRMae, s.sujeitaFatorRNova, s.folha12Mae, s.folha12Nova, s.historicoMae12, s.mesesAtividadeMae, s.mesesAtividadeNova, s.custoMensalNova, s.custoInicialNova, s.margemEmpate]);

  if (!s.aberto) return null;
  const ctx = s.contexto;
  const temReceita = s.receitaTotalMensal.some((r) => (Number(r.receita) || 0) > 0);
  const receitaMedia = s.receitaTotalMensal.length
    ? s.receitaTotalMensal.reduce((a, r) => a + (Number(r.receita) || 0), 0) / s.receitaTotalMensal.length
    : 0;

  const irPara = (i: number) => {
    setDirecao(i > passo ? 1 : -1);
    const dest = Math.max(0, Math.min(PASSOS.length - 1, i));
    // Indo para a Receita com projeção intocada: semeia mês atual/média.
    if (dest === 1 && passo === 0) s.semearProjecaoSeLimpa();
    setPasso(dest);
  };
  const avancar = () => {
    if (passo === 0 && !(validacao.total > 0)) {
      toast('RTB12 zerada: informe receitas > 0 para continuar.', 'warn');
      return;
    }
    if (passo === 0) s.semearProjecaoSeLimpa();
    if (passo === 1 && !temReceita) {
      toast('Informe ao menos um mês de receita para continuar.', 'warn');
      return;
    }
    irPara(passo + 1);
  };

  const precisaFolhaMae = (s.anexoMae === 'III' || s.anexoMae === 'V') && s.sujeitaFatorRMae;
  const precisaFolhaNova = (s.anexoNova === 'III' || s.anexoNova === 'V') && s.sujeitaFatorRNova;
  const usaFatorRMae = s.anexoMae === 'III' || s.anexoMae === 'V';
  const usaFatorRNova = s.anexoNova === 'III' || s.anexoNova === 'V';
  const mediaHistorico = s.historicoMae12.length
    ? s.historicoMae12.reduce((a, r) => a + (Number(r.receita) || 0), 0) / s.historicoMae12.length
    : 0;

  return (
    <>
    <Modal
      aberto={s.aberto}
      onFechar={() => { setPasso(0); s.fechar(); }}
      titulo="Simular dividir faturamento em duas empresas"
      subtitulo={ctx ? `${ctx.empresaNome} · ${fmtCnpj(ctx.cnpj)} · CNAE ${ctx.cnaeEscolhido} · cenário real herdado do Simples` : 'Cenário real do cliente'}
      largura="max-w-7xl"
      rodape={
        <>
          <Btn onClick={() => { setPasso(0); s.fechar(); }}>Fechar</Btn>
          {passo > 0 ? <Btn onClick={() => irPara(passo - 1)}>← Voltar</Btn> : null}
          {passo < PASSOS.length - 1 ? (
            <Btn variante="primary" onClick={avancar}>Continuar →</Btn>
          ) : (
            <>
              <Btn onClick={() => { if (!relatorio) { toast('Ajuste as receitas para gerar a projeção.', 'warn'); return; } exportarProjecaoCSV(relatorio); }}>📄 CSV</Btn>
              <Btn variante="primary" onClick={() => { if (!relatorio) { toast('Ajuste as receitas para gerar a projeção.', 'warn'); return; } exportarProjecaoJSON(relatorio); toast('Projeção exportada.', 'ok'); }}>🧾 Exportar JSON</Btn>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {/* Cabeçalho de referência temporal + toggle única/segregada */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-slate-50/60 px-3 py-2 text-[11px] dark:bg-slate-950/40">
          <strong>Período de referência: {periodo}</strong>
          <span className="text-slate-500" title="RBT12(t) = soma das receitas de [t-12, t-1]. A competência em curso nunca compõe a própria RBT12.">
            · em curso {rotuloPeriodo(s.mesInicio)} (não compõe a RBT12) · janela [t-12, t-1]
          </span>
          {ctx ? <Pill cor="brand">Anexo mãe {s.anexoMae}</Pill> : null}
          <span className="ml-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-white p-0.5 dark:bg-slate-900" role="group" aria-label="Modo de comparação">
            {(['unica', 'segregada'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => s.set({ modoComparacao: m })}
                aria-pressed={s.modoComparacao === m}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-300 ease-in-out ${s.modoComparacao === m ? 'bg-brand-700 text-white shadow' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {m === 'unica' ? 'Empresa única' : 'Segregada'}
              </button>
            ))}
          </span>
        </div>

        {/* Stepper — etapa atual com borda em gradiente animado (padrão do sistema) */}
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" aria-label="Etapas da simulação">
          {PASSOS.map((p, i) => {
            const ativo = i === passo;
            const feito = i < passo;
            return (
              <li key={p.titulo}>
                <button
                  type="button"
                  onClick={() => irPara(i)}
                  aria-current={ativo ? 'step' : undefined}
                  style={ativo ? ({ '--cor-borda': '#be9433', '--cor-brilho': '#ead79e' } as CSSProperties) : undefined}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left transition-all duration-300 ease-in-out ${
                    ativo
                      ? 'borda-cintilante bg-brand-50 dark:bg-brand-950/30'
                      : feito
                        ? 'border-emerald-600/40 bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'border-[var(--line)] bg-white dark:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black ${ativo ? 'bg-brand-700 text-white' : feito ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {feito ? '✓' : i + 1}
                    </span>
                    <span className="text-[11px] font-black">{p.titulo}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 dark:bg-slate-950/40" role="note">
          <strong>Passo {passo + 1} · {PASSOS[passo]!.titulo}:</strong> {PASSOS[passo]!.instrucao}
        </p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={passo}
            initial={{ opacity: 0, x: 28 * direcao }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -22 * direcao }}
            transition={{ duration: 0.38, ease: 'easeInOut' }}
          >
            {passo === 0 ? (
              <section className="space-y-3">
                <p className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 dark:bg-slate-950/40">
                  Informe os 12 meses <strong>anteriores a {s.mesInicio}</strong> — a competência em curso nunca compõe a própria RBT12 (LC 123/2006, art. 18).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white p-0.5 dark:bg-slate-900" role="group" aria-label="Modo de entrada da RTB12">
                    {(['manual', 'automatico'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => s.set({ modoRTB12: m })}
                        aria-pressed={s.modoRTB12 === m}
                        className={`rounded-full px-3 py-1 text-[11px] font-bold transition-all duration-300 ${s.modoRTB12 === m ? 'bg-brand-700 text-white shadow' : 'text-slate-500'}`}
                      >
                        {m === 'manual' ? 'Manual (mês a mês)' : 'Automático (total)'}
                      </button>
                    ))}
                  </span>
                  {s.modoRTB12 === 'automatico' ? (
                    <Selecao value={s.curvaDistribuicao} onChange={(e) => s.set({ curvaDistribuicao: e.target.value as 'igual' | 'crescente' | 'sazonal' })}>
                      <option value="igual">Curva: igual</option>
                      <option value="crescente">Curva: crescente</option>
                      <option value="sazonal">Curva: sazonal</option>
                    </Selecao>
                  ) : (
                    <Btn tam="sm" variante="primary" onClick={() => setPreencherAberto(true)}>✏ Preencher valores mês a mês</Btn>
                  )}
                </div>

                {s.modoRTB12 === 'automatico' ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CampoValor rotulo="RTB12 total (12 meses)" valor={s.rtb12Total} onValor={(v) => s.set({ rtb12Total: v })} dica="Distribuído automaticamente nos 12 meses ao digitar." />
                    <div className="rounded-2xl border border-[var(--line)] p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <strong>Total distribuído</strong>
                        <span className="flex items-center gap-2">
                          <NumeroAnimado valor={validacao.total} formatar={(n) => fmtMoeda(n)} className="font-mono font-black tabular-nums" />
                          <button
                            type="button"
                            onClick={() => setVerDistribuicao((v) => !v)}
                            aria-pressed={verDistribuicao}
                            aria-label={verDistribuicao ? 'Ocultar distribuição mensal' : 'Ver como a RTB12 foi distribuída'}
                            title="Ver como a RTB12 foi distribuída"
                            className="grid h-7 w-7 place-items-center rounded-full border border-[var(--line)] text-sm transition-all duration-300 hover:border-brand-700"
                          >
                            {verDistribuicao ? '🙈' : '👁'}
                          </button>
                        </span>
                      </div>
                      <div className="mt-2 flex h-10 items-end gap-1" aria-hidden>
                        {s.historicoMae12.map((r) => {
                          const max = Math.max(1, ...s.historicoMae12.map((x) => x.receita));
                          return <motion.span key={r.mes} layout transition={{ duration: 0.4, ease: 'easeInOut' }} className="flex-1 rounded-sm bg-brand-700/70" style={{ height: `${Math.max(6, (r.receita / max) * 100)}%` }} />;
                        })}
                      </div>
                      <AnimatePresence initial={false}>
                        {verDistribuicao ? (
                          <motion.dl
                            key="dist"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.35, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 sm:grid-cols-3">
                              {s.historicoMae12.map((r) => (
                                <div key={r.mes} className="flex items-center justify-between gap-2 font-mono tabular-nums">
                                  <dt className="text-slate-500">{r.mes}</dt>
                                  <dd className="font-bold">{fmtMoeda(r.receita)}</dd>
                                </div>
                              ))}
                            </div>
                          </motion.dl>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] p-3 text-xs">
                    <strong>Total digitado</strong>
                    <NumeroAnimado valor={validacao.total} formatar={(n) => fmtMoeda(n)} className="font-mono font-black tabular-nums" />
                    <span className="text-slate-500">
                      · {s.historicoMae12.filter((r) => Number(r.receita) > 0).length}/12 meses preenchidos
                    </span>
                    <Btn tam="sm" onClick={() => setPreencherAberto(true)}>✏ Preencher / ajustar</Btn>
                  </div>
                )}

                <CampoValor
                  rotulo={`Receita da competência em curso (${s.mesInicio}) — base da projeção`}
                  valor={s.receitaMesAtual}
                  onValor={(v) => s.set({ receitaMesAtual: v })}
                  dica="Semeia a tela de Receita enquanto você não editá-la. Não entra na RBT12 deste mês — só na do mês seguinte."
                />
                {validacao.erros.map((e) => (
                  <p key={e} className={`rounded-xl px-3 py-2 text-[11px] ${validacao.total > 0 ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'}`} role="note">{e}</p>
                ))}
                {ctx?.cnpj ? (
                  <Btn tam="sm" onClick={() => { salvarRTB12(ctx.cnpj, s.mesInicio, s.historicoMae12); toast('RTB12 salva por CNPJ/período.', 'ok'); }}>💾 Salvar RTB12 deste CNPJ</Btn>
                ) : null}
              </section>
            ) : null}

            {passo === 1 ? (
              <section className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="field-label">Mês de início</span>
                    <Texto mono placeholder="2026-10" value={s.mesInicio} onChange={(e) => s.set({ mesInicio: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="field-label">Horizonte (meses)</span>
                    <Selecao value={String(s.horizonte)} onChange={(e) => s.set({ horizonte: Number(e.target.value) })}>
                      <option value="6">6 meses</option>
                      <option value="12">12 meses</option>
                      <option value="18">18 meses</option>
                      <option value="24">24 meses</option>
                    </Selecao>
                  </label>
                  <label className="block">
                    <span className="field-label">Entrada de receita</span>
                    <Selecao value={s.modoReceita} onChange={(e) => s.set({ modoReceita: e.target.value as 'mensal' | 'global' })}>
                      <option value="mensal">Mês a mês (cenário real)</option>
                      <option value="global">Valor global (replicar)</option>
                    </Selecao>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn tam="sm" onClick={() => s.usarReceitaAtualComoBase()}>↺ Usar receita atual como base</Btn>
                  <Btn tam="sm" onClick={() => s.puxarMediaHistorico()}>⇪ Puxar média do histórico ({fmtMoeda(mediaHistorico)}/mês)</Btn>
                  {s.modoReceita === 'global' ? <Btn tam="sm" variante="primary" onClick={() => s.distribuirGlobal()}>Reaplicar valor global nos meses</Btn> : null}
                </div>
                {s.modoReceita === 'global' ? (
                  <CampoValor rotulo="Receita global mensal (replicada)" valor={s.receitaGlobal} onValor={(v) => s.set({ receitaGlobal: v })} dica="Replicado automaticamente nos meses ao digitar — ajuste meses individuais vira modo mês a mês." />
                ) : null}
                <div className="overflow-x-auto rounded-2xl border border-[var(--line)]">
                  <table className="tbl tbl-compacta w-full min-w-[520px]">
                    <thead>
                      <tr>
                        <th scope="col">Mês</th>
                        <th scope="col" className="th-r">Receita total projetada</th>
                        <th scope="col" className="th-r">Mãe ({Math.round((1 - s.percentualNova) * 100)}%)</th>
                        <th scope="col" className="th-r">Nova ({Math.round(s.percentualNova * 100)}%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.receitaTotalMensal.map((r) => {
                        const nova = Math.round(r.receita * s.percentualNova * 100) / 100;
                        return (
                          <tr key={r.mes} className="border-t border-[var(--line)]">
                            <td className="font-bold">{rotuloMesCurto(r.mes)} <span className="font-mono text-[10px] text-slate-400">{r.mes}</span></td>
                            <td className="text-right">
                              <input className="field field-sm mono w-36 !py-1.5 text-right" inputMode="decimal" value={r.receita > 0 ? String(r.receita).replace('.', ',') : ''} placeholder="0" onChange={(e) => s.setReceitaMes(r.mes, parseMoeda(e.target.value))} />
                            </td>
                            <td className="num text-right font-mono">{fmtMoeda(r.receita - nova)}</td>
                            <td className="num text-right font-mono">{fmtMoeda(nova)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {passo === 2 ? (
              <section className="space-y-3">
                <div className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>Quanto da receita vai para a nova empresa?</span>
                    <NumeroAnimado valor={s.percentualNova * 100} formatar={(n) => `${Math.round(n)}%`} className="font-mono text-base tabular-nums" />
                  </div>
                  <input type="range" min={0} max={100} step={1} value={Math.round(s.percentualNova * 100)} onChange={(e) => s.set({ percentualNova: Number(e.target.value) / 100 })} className="mt-2 w-full accent-brand-700" aria-label="Percentual da nova empresa (0 a 100%)" />
                  <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>0% · tudo na mãe</span><span>50%</span><span>100% · tudo na nova</span></div>
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                    Média mensal: mãe <NumeroAnimado valor={receitaMedia * (1 - s.percentualNova)} formatar={(n) => fmtMoeda(n)} /> · nova <NumeroAnimado valor={receitaMedia * s.percentualNova} formatar={(n) => fmtMoeda(n)} />
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[35, 45, 50].map((p) => (
                      <button key={p} type="button" onClick={() => s.set({ percentualNova: p / 100 })} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all duration-300 ${Math.round(s.percentualNova * 100) === p ? 'border-brand-700 bg-brand-700 text-white' : 'border-[var(--line)] text-slate-500'}`}>{p}%</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Anexo da mãe</span>
                    <Selecao value={s.anexoMae} onChange={(e) => s.set({ anexoMae: e.target.value as AnexoSimplesId })}>
                      {ANEXOS.map((a) => <option key={a} value={a}>Anexo {a}</option>)}
                    </Selecao>
                  </label>
                  <label className="block">
                    <span className="field-label">Anexo da nova</span>
                    <Selecao value={s.anexoNova} onChange={(e) => s.set({ anexoNova: e.target.value as AnexoSimplesId })}>
                      {ANEXOS.map((a) => <option key={a} value={a}>Anexo {a}</option>)}
                    </Selecao>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de anexo">
                  <span className="text-[11px] text-slate-500">Cenários rápidos:</span>
                  {[['III', 'III'], ['III', 'V'], ['I', 'III'], ['IV', 'IV']].map(([m, n]) => (
                    <button key={`${m}${n}`} type="button" onClick={() => s.set({ anexoMae: m as AnexoSimplesId, anexoNova: n as AnexoSimplesId })} className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] font-bold text-slate-500 transition-all duration-300 hover:border-brand-700 hover:text-brand-700">Mãe {m} + Nova {n}</button>
                  ))}
                </div>
                {(precisaFolhaMae || precisaFolhaNova) ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {precisaFolhaMae ? (
                      <CampoValor rotulo="Folha 12m — mãe (exige Anexo III/V)" valor={s.folha12Mae} onValor={(v) => s.set({ folha12Mae: v })} dica="Fator R: folha ÷ RBT12 ≥ 28% → Anexo III." />
                    ) : null}
                    {precisaFolhaNova ? (
                      <CampoValor rotulo="Folha 12m — nova (exige Anexo III/V)" valor={s.folha12Nova} onValor={(v) => s.set({ folha12Nova: v })} dica="Nova sem folha começa abaixo de 28%." />
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-950/40">
                    Anexos I, II e IV não usam Fator R — folha dispensada nesta simulação.
                  </p>
                )}
                {(usaFatorRMae || usaFatorRNova) ? (
                  <div className="space-y-1.5 rounded-2xl border border-[var(--line)] px-3 py-2">
                    {usaFatorRMae ? (
                      <label className="flex cursor-pointer items-start gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={s.sujeitaFatorRMae}
                          onChange={(e) => s.set({ sujeitaFatorRMae: e.target.checked })}
                          className="mt-0.5 accent-brand-700"
                        />
                        <span>
                          <strong>Mãe sujeita ao Fator R</strong>
                          <span className="block text-slate-500">Desmarque se for Anexo III puro (atividade que nunca cai no V) — dispensa folha e diagnóstico.</span>
                        </span>
                      </label>
                    ) : null}
                    {usaFatorRNova ? (
                      <label className="flex cursor-pointer items-start gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={s.sujeitaFatorRNova}
                          onChange={(e) => s.set({ sujeitaFatorRNova: e.target.checked })}
                          className="mt-0.5 accent-brand-700"
                        />
                        <span>
                          <strong>Nova sujeita ao Fator R</strong>
                          <span className="block text-slate-500">Desmarque se for Anexo III puro (atividade que nunca cai no V) — dispensa folha e diagnóstico.</span>
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <EditorComposicao titulo="Mãe" anexoPrincipal={s.anexoMae} extra={s.composicaoExtraMae} onChange={(v) => s.set({ composicaoExtraMae: v })} />
                  <EditorComposicao titulo="Nova" anexoPrincipal={s.anexoNova} extra={s.composicaoExtraNova} onChange={(v) => s.set({ composicaoExtraNova: v })} />
                </div>
                {relatorio ? (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--line)] px-3 py-2">
                      <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">DAS unificado/mês (média)</span>
                      <NumeroAnimado valor={relatorio.serieMensal.reduce((a, l) => a + l.dasUnificadoReferencia, 0) / Math.max(1, relatorio.serieMensal.length)} formatar={(n) => fmtMoeda(n)} className="font-mono text-[15px] font-black tabular-nums" />
                    </div>
                    <div className="rounded-xl border border-[var(--line)] px-3 py-2">
                      <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">DAS dividido/mês (média)</span>
                      <NumeroAnimado valor={relatorio.serieMensal.reduce((a, l) => a + l.dasMae + l.dasNova, 0) / Math.max(1, relatorio.serieMensal.length)} formatar={(n) => fmtMoeda(n)} className="font-mono text-[15px] font-black tabular-nums" />
                    </div>
                    <div className="rounded-xl border border-[var(--line)] px-3 py-2">
                      <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">Economia líquida total</span>
                      <NumeroAnimado valor={relatorio.economiaTotal} formatar={(n) => fmtMoeda(n)} className={`font-mono text-[15px] font-black tabular-nums ${relatorio.economiaTotal >= 0 ? 'text-emerald-700' : 'text-red-600'}`} />
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {passo === 3 ? (
              <section className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <CampoValor rotulo="Custo mensal da nova" valor={s.custoMensalNova} onValor={(v) => s.set({ custoMensalNova: v })} dica="Contábil + fixos. Entra todo mês no payback líquido." />
                  <CampoValor rotulo="Custo de abertura (único)" valor={s.custoInicialNova} onValor={(v) => s.set({ custoInicialNova: v })} dica="Somado ao mês 1 (taxas, honorários)." />
                  <CampoValor rotulo="Margem de empate (R$)" valor={s.margemEmpate} onValor={(v) => s.set({ margemEmpate: v })} dica="|economia| ≤ margem ⇒ Empate técnico." />
                </div>
                {(precisaFolhaMae || precisaFolhaNova) ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {precisaFolhaMae ? (
                      <CampoValor rotulo="Folha 12m — mãe" valor={s.folha12Mae} onValor={(v) => s.set({ folha12Mae: v })} dica="Base do Fator R: folha ÷ RBT12 ≥ 28% → Anexo III." />
                    ) : null}
                    {precisaFolhaNova ? (
                      <CampoValor rotulo="Folha 12m — nova" valor={s.folha12Nova} onValor={(v) => s.set({ folha12Nova: v })} dica="Nova sem folha começa abaixo de 28%." />
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-950/40">
                    Nenhum anexo com Fator R neste cenário — folha dispensada.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Meses de atividade da mãe (12+ = regime cheio)</span>
                    <Texto mono inputMode="numeric" value={String(s.mesesAtividadeMae)} onChange={(e) => s.set({ mesesAtividadeMae: Math.max(0, Math.min(24, Number(e.target.value.replace(/\D+/g, '')) || 0)) })} />
                    <span className="mt-1 block text-[11px] text-slate-400">Mãe com menos de 12 meses usa RBT12 proporcional (média × 12).</span>
                  </label>
                  <label className="block">
                    <span className="field-label">Meses de atividade da nova (0 = abre agora)</span>
                    <Texto mono inputMode="numeric" value={String(s.mesesAtividadeNova)} onChange={(e) => s.set({ mesesAtividadeNova: Math.max(0, Math.min(12, Number(e.target.value.replace(/\D+/g, '')) || 0)) })} />
                    <span className="mt-1 block text-[11px] text-slate-400">Com menos de 12 meses, o RBT12 da nova é proporcional (média × 12).</span>
                  </label>
                </div>
              </section>
            ) : null}

            {passo === 4 ? (
              <section className="space-y-3">
                {relatorio ? (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={s.modoComparacao} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: 'easeInOut' }}>
                      {s.modoComparacao === 'unica' ? (
                        <div className="space-y-2 rounded-2xl border border-[var(--line)] bg-white p-4 dark:bg-slate-900">
                          <div className="text-xs font-black">Cenário atual — empresa única</div>
                          <p className="text-xs text-slate-500">Todo o faturamento na mãe (Anexo {relatorio.metadados.anexoMae}), sem custo de nova empresa.</p>
                          <div className="font-mono text-sm tabular-nums">DAS total no horizonte: <strong>{fmtMoeda(relatorio.serieMensal.reduce((a, l) => a + l.dasUnificadoReferencia, 0))}</strong></div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <ControleSplit />
                          <SimuladorSegregacao relatorio={relatorio} />
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-xs text-slate-400">Informe receitas válidas para gerar a projeção (RBT12 deslizante + motor oficial do Simples).</p>
                )}
              </section>
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* Faixa de meses com entrada/saída da janela (rastreabilidade) */}
        {relatorio && passo === 4 && s.modoComparacao === 'segregada' ? (
          <p className="px-1 text-[10px] leading-relaxed text-slate-400">
            RBT12(t) = soma [t-12, t-1] · nova com &lt; 12 meses usa média × 12 · alíquota efetiva = (RBT12 × nominal − dedução) ÷ RBT12 · economia = DAS único − (DAS mãe + DAS nova) − custos.
          </p>
        ) : null}
      </div>
    </Modal>
    {/* Modal-irmão de preenchimento manual (nunca aninhado): 12 competências */}
    <Modal
      aberto={preencherAberto}
      onFechar={() => setPreencherAberto(false)}
      titulo="Preencher RTB12 mês a mês"
      subtitulo={`12 meses anteriores a ${s.mesInicio} · total ${fmtMoeda(validacao.total)}`}
      largura="max-w-3xl"
      rodape={
        <>
          <Btn onClick={() => setPreencherAberto(false)}>Fechar</Btn>
          <Btn variante="primary" onClick={() => { setPreencherAberto(false); toast('RTB12 manual aplicada.', 'ok'); }}>
            Aplicar valores
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {s.historicoMae12.map((r) => (
          <CampoValor key={r.mes} rotulo={r.mes} valor={r.receita} onValor={(v) => s.setHistoricoMaeMes(r.mes, v)} />
        ))}
      </div>
      <p className="mt-2 rounded-xl bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 dark:bg-slate-950/40">
        Total: <strong className="font-mono tabular-nums">{fmtMoeda(validacao.total)}</strong> · editar aqui alterna para o modo manual e preserva os valores na tela principal.
      </p>
    </Modal>
    </>
  );
}
