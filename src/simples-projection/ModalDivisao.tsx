/**
 * Simples Projection — modal "Simular dividir faturamento" em WIZARD (4 passos).
 *
 * Aberto SOMENTE via CNPJ na tela do Simples (`page.tsx`): o botão só existe
 * quando `modo === 'cnpj' && empresaNome && cnaeEscolhido`. Herda o cenário
 * real do cliente (anexo, RBT12, receita, folha) e deixa editar tudo.
 *
 * Passos: 1 Receita → 2 Divisão → 3 Fator R → 4 Resultado. Cada passo tem
 * instrução curta (o que informar e por quê). Reativo: `relatorio` é
 * `useMemo(simularCenarioDividido)` — qualquer edição recalcula tudo.
 */
import { useMemo, useState } from 'react';
import type { AnexoSimplesId } from '@/simples/tabelas';
import { fmtCnpj, fmtMoeda, parseMoeda } from '@/domain/services/format';
import { Btn, Modal, Pill, Selecao, Texto } from '@/ui/kit';
import { toast } from '@/store/ui';
import { simularCenarioDividido } from './cenario-dividido';
import { useProjecaoDividida } from './store';
import { ResultadoDividido } from './ResultadoDividido';
import { exportarProjecaoCSV, exportarProjecaoJSON } from './export';

const ANEXOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];

const PASSOS = [
  { titulo: 'Receita', instrucao: 'Confira a receita total projetada mês a mês — é ela que será fatiada entre mãe e nova.' },
  { titulo: 'Divisão', instrucao: 'Defina quanto vai para a nova empresa, os anexos de cada uma e o custo de manter a nova.' },
  { titulo: 'Fator R', instrucao: 'Informe a folha 12m de cada empresa. Abaixo de 28%, o sistema sugere o pró-labore para voltar ao Anexo III.' },
  { titulo: 'Resultado', instrucao: 'Progressividade (RBT12p, faixa, alíquota), Fator R e tempo até o retorno — positivo ou só prejuízo.' },
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

export function ModalDivisao() {
  const s = useProjecaoDividida();
  const [passo, setPasso] = useState(0);

  const relatorio = useMemo(() => {
    if (!s.aberto) return null;
    try {
      if (s.receitaTotalMensal.length === 0) return null;
      return simularCenarioDividido({
        mesInicio: s.mesInicio,
        receitaTotalMensal: s.receitaTotalMensal.map((r) => ({ mes: r.mes, receita: Math.max(0, Number(r.receita) || 0) })),
        percentualNova: s.percentualNova,
        mae: { anexoId: s.anexoMae, folha12: Math.max(0, s.folha12Mae), historico12: s.historicoMae12 },
        nova: { anexoId: s.anexoNova, folha12: Math.max(0, s.folha12Nova), historico12: [], mesesAtividade: s.mesesAtividadeNova },
        custoMensalNova: Math.max(0, s.custoMensalNova),
      });
    } catch {
      return null;
    }
  }, [s.aberto, s.mesInicio, s.receitaTotalMensal, s.percentualNova, s.anexoMae, s.anexoNova, s.folha12Mae, s.folha12Nova, s.historicoMae12, s.mesesAtividadeNova, s.custoMensalNova]);

  if (!s.aberto) return null;
  const ctx = s.contexto;
  const temReceita = s.receitaTotalMensal.some((r) => (Number(r.receita) || 0) > 0);
  const receitaMedia = s.receitaTotalMensal.length
    ? s.receitaTotalMensal.reduce((a, r) => a + (Number(r.receita) || 0), 0) / s.receitaTotalMensal.length
    : 0;
  const frResumo = relatorio?.analiseFatorR?.resumo;

  const avancar = () => {
    if (passo === 0 && !temReceita) {
      toast('Informe ao menos um mês de receita para continuar.', 'warn');
      return;
    }
    setPasso((p) => Math.min(PASSOS.length - 1, p + 1));
  };

  return (
    <Modal
      aberto={s.aberto}
      onFechar={() => { setPasso(0); s.fechar(); }}
      titulo="Simular dividir faturamento em duas empresas"
      subtitulo={ctx ? `${ctx.empresaNome} · ${fmtCnpj(ctx.cnpj)} · CNAE ${ctx.cnaeEscolhido} · cenário real herdado do Simples` : 'Cenário real do cliente'}
      largura="max-w-4xl"
      rodape={
        <>
          <Btn onClick={() => { setPasso(0); s.fechar(); }}>Fechar</Btn>
          {passo > 0 ? <Btn onClick={() => setPasso((p) => p - 1)}>← Voltar</Btn> : null}
          {passo < PASSOS.length - 1 ? (
            <Btn variante="primary" onClick={avancar}>Continuar →</Btn>
          ) : (
            <>
              <Btn
                onClick={() => {
                  if (!relatorio) {
                    toast('Ajuste as receitas para gerar a projeção.', 'warn');
                    return;
                  }
                  exportarProjecaoCSV(relatorio);
                }}
              >
                📄 CSV
              </Btn>
              <Btn
                variante="primary"
                onClick={() => {
                  if (!relatorio) {
                    toast('Ajuste as receitas para gerar a projeção.', 'warn');
                    return;
                  }
                  exportarProjecaoJSON(relatorio);
                  toast('Projeção exportada.', 'ok');
                }}
              >
                🧾 Exportar JSON
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {ctx ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--line)] bg-slate-50/60 px-3 py-2 text-[11px] dark:bg-slate-950/40">
            <strong>{ctx.empresaNome}</strong>
            <span className="font-mono text-slate-500">{fmtCnpj(ctx.cnpj)}</span>
            <Pill cor="brand">Anexo mãe {s.anexoMae}</Pill>
            <span className="text-slate-500">RBT12 {fmtMoeda(ctx.rbt12)} · receita {fmtMoeda(ctx.receitaMes)}/mês</span>
          </div>
        ) : null}

        {/* Stepper */}
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Etapas da simulação">
          {PASSOS.map((p, i) => {
            const ativo = i === passo;
            const feito = i < passo;
            return (
              <li key={p.titulo}>
                <button
                  type="button"
                  onClick={() => {
                    if (i === 0 || temReceita || i < passo) setPasso(i);
                    else toast('Informe a receita antes de avançar.', 'warn');
                  }}
                  aria-current={ativo ? 'step' : undefined}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                    ativo
                      ? 'border-brand-700 bg-brand-50 dark:bg-brand-950/30'
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

        {passo === 0 ? (
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="field-label">Mês de início</span>
                <Texto mono placeholder="2026-01" value={s.mesInicio} onChange={(e) => s.set({ mesInicio: e.target.value })} />
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
              {s.modoReceita === 'global' ? (
                <Btn tam="sm" variante="primary" onClick={() => s.distribuirGlobal()}>Replicar valor global nos meses</Btn>
              ) : null}
            </div>

            {s.modoReceita === 'global' ? (
              <CampoValor rotulo="Receita global mensal (replicada)" valor={s.receitaGlobal} onValor={(v) => s.set({ receitaGlobal: v })} dica="O sistema distribui este valor mês a mês; depois você pode ajustar meses individuais." />
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
                          <input
                            className="field field-sm mono w-36 !py-1.5 text-right"
                            inputMode="decimal"
                            value={r.receita > 0 ? String(r.receita).replace('.', ',') : ''}
                            placeholder="0"
                            onChange={(e) => s.setReceitaMes(r.mes, parseMoeda(e.target.value))}
                          />
                        </td>
                        <td className="num text-right font-mono">{fmtMoeda(r.receita - nova)}</td>
                        <td className="num text-right font-mono">{fmtMoeda(nova)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <details className="rounded-2xl border border-[var(--line)] px-4 py-3 text-xs">
              <summary className="cursor-pointer font-bold">Histórico 12m da mãe (base do RBT12) — ajustar se o cenário real divergir</summary>
              <p className="mt-1 text-[11px] text-slate-500">O RBT12 de cada mês soma os 12 meses anteriores (nunca o mês atual). Ajuste aqui se o histórico real for diferente da média.</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {s.historicoMae12.map((r) => (
                  <CampoValor key={r.mes} rotulo={r.mes} valor={r.receita} onValor={(v) => s.setHistoricoMaeMes(r.mes, v)} />
                ))}
              </div>
            </details>
          </section>
        ) : null}

        {passo === 1 ? (
          <section className="space-y-3">
            <div className="rounded-2xl border border-[var(--line)] p-4">
              <div className="flex items-center justify-between text-xs font-bold">
                <span>Quanto da receita vai para a nova empresa?</span>
                <span className="font-mono text-base">{Math.round(s.percentualNova * 100)}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={95}
                step={5}
                value={Math.round(s.percentualNova * 100)}
                onChange={(e) => s.set({ percentualNova: Number(e.target.value) / 100 })}
                className="mt-2 w-full accent-brand-700"
                aria-label="Percentual da nova empresa"
              />
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                Média mensal: mãe {fmtMoeda(receitaMedia * (1 - s.percentualNova))} · nova {fmtMoeda(receitaMedia * s.percentualNova)}
              </p>
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
              <CampoValor rotulo="Custo mensal da nova (contábil + fixos)" valor={s.custoMensalNova} onValor={(v) => s.set({ custoMensalNova: v })} dica="Entra no retorno: economia = DAS unificado − (DAS mãe + DAS nova) − custo." />
              <label className="block">
                <span className="field-label">Meses de atividade da nova (0 = abre agora)</span>
                <Texto mono inputMode="numeric" value={String(s.mesesAtividadeNova)} onChange={(e) => s.set({ mesesAtividadeNova: Math.max(0, Math.min(12, Number(e.target.value.replace(/\D+/g, '')) || 0)) })} />
                <span className="mt-1 block text-[11px] text-slate-400">Com menos de 12 meses, o RBT12 da nova é proporcional (média × 12).</span>
              </label>
            </div>
          </section>
        ) : null}

        {passo === 2 ? (
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CampoValor rotulo="Folha 12m — mãe (salários + pró-labore + FGTS)" valor={s.folha12Mae} onValor={(v) => s.set({ folha12Mae: v })} dica="Base do Fator R da mãe: folha ÷ RBT12p ≥ 28% → Anexo III." />
              <CampoValor rotulo="Folha 12m — nova (salários + pró-labore + FGTS)" valor={s.folha12Nova} onValor={(v) => s.set({ folha12Nova: v })} dica="Nova sem folha começa abaixo de 28% — veja a sugestão de pró-labore." />
            </div>
            {frResumo && relatorio ? (
              <div className="space-y-2">
                {(['mae', 'nova'] as const).map((lado) => {
                  const ultimo = relatorio.analiseFatorR!.linhas[relatorio.analiseFatorR!.linhas.length - 1]?.[lado];
                  if (!ultimo) return null;
                  const mesesAbaixo = lado === 'mae' ? frResumo.mesesAbaixo28Mae : frResumo.mesesAbaixo28Nova;
                  const maior = lado === 'mae' ? frResumo.maiorDeficitMae : frResumo.maiorDeficitNova;
                  if (!ultimo.aplicaFatorR) {
                    return (
                      <p key={lado} className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {lado === 'mae' ? 'Mãe' : 'Nova'} no Anexo {ultimo.anexo}: sem Fator R — nada a ajustar aqui.
                      </p>
                    );
                  }
                  return (
                    <div key={lado} className={`rounded-xl border px-3 py-2 text-xs ${ultimo.atinge28 ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30' : 'border-amber-600/40 bg-amber-50 dark:bg-amber-950/30'}`}>
                      <strong>{lado === 'mae' ? 'Mãe' : 'Nova'}: {(ultimo.indice * 100).toFixed(2)}% {ultimo.atinge28 ? '≥ 28% ✓' : '< 28% — cai no V'}</strong>
                      <span className="ml-2 text-slate-500">{mesesAbaixo}/{relatorio.analiseFatorR!.linhas.length} meses abaixo de 28%</span>
                      {maior.valor > 0 && maior.mes ? (
                        <span className="mt-0.5 block font-mono tabular-nums">
                          Faltam {fmtMoeda(maior.valor)} na folha (pior mês {maior.mes}) → +{fmtMoeda(maior.valor / 12)}/mês de pró-labore. Detalhes no resultado.
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-emerald-700 dark:text-emerald-300">Folha suficiente no horizonte todo.</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-4 text-center text-xs text-slate-400">
                Volte ao passo 1 e informe receitas para ver o diagnóstico ao vivo.
              </p>
            )}
          </section>
        ) : null}

        {passo === 3 ? (
          <section className="space-y-3">
            {relatorio ? (
              <ResultadoDividido relatorio={relatorio} custoMensalNova={s.custoMensalNova} />
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-xs text-slate-400">
                Informe receitas válidas para gerar a projeção (RBT12 deslizante + motor oficial do Simples).
              </p>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
