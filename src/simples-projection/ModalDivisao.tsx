/**
 * Simples Projection — modal "Simular dividir faturamento" (camada ADITIVA).
 *
 * Aberto SOMENTE via CNPJ na tela do Simples (`page.tsx`): o botão só existe
 * quando `modo === 'cnpj' && empresaNome && cnaeEscolhido`. Herda o cenário
 * real do cliente (anexo, RBT12, receita, folha) e deixa editar tudo.
 *
 * Reativo: `relatorio` é `useMemo(simularCenarioDividido)` — slider, receitas
 * e custos redesenham faixa, alíquota, DAS e payback instantaneamente.
 */
import { useMemo } from 'react';
import type { AnexoSimplesId } from '@/simples/tabelas';
import { fmtCnpj, fmtMoeda, parseMoeda } from '@/domain/services/format';
import { Btn, Modal, Pill, Selecao, Texto } from '@/ui/kit';
import { toast } from '@/store/ui';
import { simularCenarioDividido } from './cenario-dividido';
import { useProjecaoDividida } from './store';
import { ResultadoDividido } from './ResultadoDividido';
import { exportarProjecaoCSV, exportarProjecaoJSON } from './export';

const ANEXOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];

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

  return (
    <Modal
      aberto={s.aberto}
      onFechar={() => s.fechar()}
      titulo="Simular dividir faturamento em duas empresas"
      subtitulo={ctx ? `${ctx.empresaNome} · ${fmtCnpj(ctx.cnpj)} · CNAE ${ctx.cnaeEscolhido} · cenário real herdado do Simples` : 'Cenário real do cliente'}
      largura="max-w-4xl"
      rodape={
        <>
          <Btn onClick={() => s.fechar()}>Fechar</Btn>
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
      }
    >
      <div className="space-y-6">
        {ctx ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] bg-slate-50/60 px-4 py-3 text-xs dark:bg-slate-950/40">
            <strong>{ctx.empresaNome}</strong>
            <span className="font-mono text-slate-500">{fmtCnpj(ctx.cnpj)}</span>
            <Pill cor="brand">Anexo mãe {s.anexoMae}</Pill>
            <span className="text-slate-500">RBT12 {fmtMoeda(ctx.rbt12)} · receita {fmtMoeda(ctx.receitaMes)}/mês</span>
          </div>
        ) : null}

        {/* Receitas */}
        <section className="space-y-3">
          <h3 className="text-sm font-black tracking-tight">1 · Receita 12 meses + projeção mês a mês</h3>
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
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {s.historicoMae12.map((r) => (
                <CampoValor key={r.mes} rotulo={r.mes} valor={r.receita} onValor={(v) => s.setHistoricoMaeMes(r.mes, v)} />
              ))}
            </div>
          </details>
        </section>

        {/* Divisão + custos */}
        <section className="space-y-3">
          <h3 className="text-sm font-black tracking-tight">2 · Divisão + custos agregados da nova empresa</h3>
          <div className="rounded-2xl border border-[var(--line)] p-4">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>Percentual da nova empresa</span>
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
            <p className="mt-1 text-[11px] text-slate-400">Arraste e veja os gráficos e a tabela recalcularem na hora (faixa, alíquota, DAS, payback).</p>
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
            <CampoValor rotulo="Folha 12m — mãe (Fator R)" valor={s.folha12Mae} onValor={(v) => s.set({ folha12Mae: v })} />
            <CampoValor rotulo="Folha 12m — nova (Fator R)" valor={s.folha12Nova} onValor={(v) => s.set({ folha12Nova: v })} />
            <CampoValor rotulo="Custo mensal da nova (contábil + fixos)" valor={s.custoMensalNova} onValor={(v) => s.set({ custoMensalNova: v })} dica="Entra no payback: economia = DAS unificado − (DAS mãe + DAS nova) − custo." />
            <label className="block">
              <span className="field-label">Meses de atividade da nova (0 = abre agora)</span>
              <Texto mono inputMode="numeric" value={String(s.mesesAtividadeNova)} onChange={(e) => s.set({ mesesAtividadeNova: Math.max(0, Math.min(12, Number(e.target.value.replace(/\D+/g, '')) || 0)) })} />
            </label>
          </div>
        </section>

        {/* Resultado reativo */}
        <section className="space-y-3">
          <h3 className="text-sm font-black tracking-tight">3 · Resultado reativo — paga mais ou menos?</h3>
          {relatorio ? (
            <ResultadoDividido relatorio={relatorio} custoMensalNova={s.custoMensalNova} />
          ) : (
            <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-xs text-slate-400">
              Informe receitas válidas para gerar a projeção (RBT12 deslizante + motor oficial do Simples).
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
