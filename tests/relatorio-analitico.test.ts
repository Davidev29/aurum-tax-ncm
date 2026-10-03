/**
 * Relatório Analítico e Inteligente — testes de conformidade com a SPEC v1.0.
 * - Motor reproduz a planilha centavo a centavo (golden vectors).
 * - Fator r gap determinístico.
 * - Matriz III×V SOMENTE em CNPJ dual; senão, duelo Conv × Hib do anexo em foco.
 * - IA read-only: fallback só cita números do JSON; validador rejeita invenção.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularFatorRDetalhado,
  coletarNumerosPermitidos,
  orquestrarRelatorio,
  type RelatorioInput,
} from '@/simples/relatorio-analitico';
import {
  extrairNumerosDoTexto,
  gerarInsightsFallback,
  validarInsights,
} from '@/simples/ia-insights';

function inputBase(over: Partial<RelatorioInput> = {}): RelatorioInput {
  return {
    empresa: { origem: 'CNPJ_API', razaoSocial: 'Empresa Teste Ltda', cnpj: '12345678000195' },
    competencia: '2027-05',
    exercicioReferencia: 2027,
    rbt12: 850_000,
    rba: 200_000,
    receitaMes: 95_000,
    folha12: 180_000,
    cbsRef: 0.088,
    despesas: [
      { rotulo: 'Aluguel (30% da alíquota)', valor: 1500, regra: 'integral' },
      { rotulo: 'Energia elétrica', valor: 300, regra: 'integral' },
    ],
    contexto: { modo: 'cnpj', anexoSelecionado: 'V', anexosElegiveis: ['III', 'V'] },
    ...over,
  };
}

describe('relatório analítico — motor determinístico', () => {
  it('orquestra 10 cenários (5 anexos × 2 regimes)', () => {
    const r = orquestrarRelatorio(inputBase());
    expect(r.cenarios).toHaveLength(10);
    expect(r.cenarios.map((c) => c.scenarioId)).toEqual(
      expect.arrayContaining(['III_CONV', 'V_CONV', 'III_HIB', 'V_HIB', 'I_CONV', 'I_HIB', 'II_CONV', 'II_HIB', 'IV_CONV', 'IV_HIB']),
    );
    expect(r.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('golden: Anexo I RBT12 3,8MM receita 200k reproduz Dashboard (conv 25987,83)', () => {
    const r = orquestrarRelatorio(
      inputBase({ rbt12: 3_800_000, rba: 50_000, receitaMes: 200_000, folha12: 0 }),
    );
    const iConv = r.cenarios.find((c) => c.scenarioId === 'I_CONV')!;
    // Dashboard.txt:62 — DAS 25987.8352631579
    expect(iConv.totalPagar).toBeCloseTo(25987.83, 1);
    expect(iConv.cbsDentroDas).toBeCloseTo(6091.37, 1);
    const iHib = r.cenarios.find((c) => c.scenarioId === 'I_HIB')!;
    // Híbrido maior neste perfil (convencional vence)
    expect(iHib.totalPagar).toBeGreaterThan(iConv.totalPagar);
    expect(r.comparativo.tabelaOutrosAnexos.find((l) => l.anexo === 'I')?.vencedor).toBe('CONV');
  });

  it('CNPJ dual III/V exibe matriz e veredito III_CONV (serviços RBT12 850k)', () => {
    const r = orquestrarRelatorio(inputBase());
    expect(r.contexto.mostrarMatrizIIIV).toBe(true);
    const iii = r.cenarios.find((c) => c.scenarioId === 'III_CONV')!;
    const v = r.cenarios.find((c) => c.scenarioId === 'V_CONV')!;
    expect(iii.totalPagar).toBeLessThan(v.totalPagar);
    expect(r.comparativo.menorCargaScenarioId).toBe('III_CONV');
    const d = r.comparativo.matrizDeltas.find((x) => x.de === 'V_CONV' && x.para === 'III_CONV')!;
    expect(d.deltaRs).toBeCloseTo(iii.totalPagar - v.totalPagar, 2);
  });

  it('CNPJ anexo único (I) NÃO exibe matriz: duelo Conv × Hib do Anexo I', () => {
    const r = orquestrarRelatorio(
      inputBase({ contexto: { modo: 'cnpj', anexoSelecionado: 'I', anexosElegiveis: ['I'] } }),
    );
    expect(r.contexto.mostrarMatrizIIIV).toBe(false);
    expect(r.contexto.mostrarFatorR).toBe(false);
    expect(r.dueloFoco.anexo).toBe('I');
    expect(r.comparativo.menorCargaScenarioId).toBe('I_CONV');
    expect(r.dueloFoco.vencedor).toBe('CONV');
  });

  it('manual NUNCA exibe matriz III×V (mesmo com folha)', () => {
    const r = orquestrarRelatorio(
      inputBase({
        empresa: { origem: 'MANUAL', razaoSocial: 'Contribuinte — cálculo manual', cnpj: null },
        contexto: { modo: 'manual', anexoSelecionado: 'V', anexosElegiveis: ['V'] },
      }),
    );
    expect(r.contexto.mostrarMatrizIIIV).toBe(false);
    expect(r.dueloFoco.anexo).toBe('V');
  });

  it('memória do híbrido fecha: DAS − CBS = reduzido; débitos − créditos = CBS; soma = total', () => {
    const r = orquestrarRelatorio(inputBase());
    for (const ax of ['I', 'III', 'V'] as const) {
      const m = r.memoriaHibrido[ax];
      expect(m.dasReduzido).toBeCloseTo(m.dasTotal - (m.cbsDentroDas ?? 0), 1);
      const somaCred = m.creditosPorDespesa.reduce((a, x) => a + x.credito, 0);
      expect(m.creditosCbs).toBeCloseTo(somaCred, 1);
      expect(m.cbsARecolher).toBeCloseTo(Math.max(0, m.debitosCbs - m.creditosCbs), 1);
      expect(m.totalHibrido).toBeCloseTo(m.dasReduzido + m.cbsARecolher, 1);
    }
  });

  it('fator r gap: 180k/850k → 21,18% gap 58k mensal 4833,33', () => {
    const f = calcularFatorRDetalhado(180_000, 850_000);
    expect(f.valor).toBeCloseTo(0.2118, 4);
    expect(f.enquadrado).toBe(false);
    expect(f.folhaMinimaIII).toBeCloseTo(238_000, 2);
    expect(f.gapFolha).toBeCloseTo(58_000, 2);
    expect(f.gapMensalProlabore).toBeCloseTo(4833.33, 2);
  });

  it('fator r enquadrado >= 28% e sem dados → insuficiente', () => {
    expect(calcularFatorRDetalhado(300_000, 1_000_000).enquadrado).toBe(true);
    expect(calcularFatorRDetalhado(0, 850_000).dadosSuficientes).toBe(false);
    expect(calcularFatorRDetalhado(100_000, 0).valor).toBe(0);
  });
});

describe('relatório analítico — IA read-only', () => {
  it('fallback dual só cita números do JSON canônico', () => {
    const r = orquestrarRelatorio(inputBase());
    const insights = gerarInsightsFallback(r);
    expect(insights.length).toBeGreaterThan(0);
    const permitidos = coletarNumerosPermitidos(r);
    for (const ins of insights) {
      for (const v of ins.valoresCitados) {
        expect(permitidos.some((p) => Math.abs(p - v) <= 0.011)).toBe(true);
      }
      for (const n of extrairNumerosDoTexto(ins.texto)) {
        expect(permitidos.some((p) => Math.abs(p - n) <= 0.011)).toBe(true);
      }
    }
    expect(validarInsights(r, insights).filtrados.length).toBe(insights.length);
  });

  it('fallback foco único só cita números do JSON e explica o duelo', () => {
    const r = orquestrarRelatorio(
      inputBase({ contexto: { modo: 'cnpj', anexoSelecionado: 'I', anexosElegiveis: ['I'] } }),
    );
    const insights = gerarInsightsFallback(r);
    expect(insights.length).toBe(3);
    expect(insights[0].titulo).toMatch(/Anexo I/);
    const permitidos = coletarNumerosPermitidos(r);
    for (const ins of insights) {
      for (const n of extrairNumerosDoTexto(ins.texto)) {
        expect(permitidos.some((p) => Math.abs(p - n) <= 0.011)).toBe(true);
      }
    }
    expect(validarInsights(r, insights).filtrados.length).toBe(insights.length);
  });

  it('validador REJEITA número inventado (alucinação)', () => {
    const r = orquestrarRelatorio(inputBase());
    const v = validarInsights(r, [
      {
        insightId: 'ins_fake',
        titulo: 'Fake',
        texto: 'Sua economia é de R$ 999.999,99 no mês.',
        nivel: 'INFO',
        cenariosRef: ['III_CONV'],
        valoresCitados: [999999.99],
      },
    ]);
    expect(v.filtrados).toHaveLength(0);
    expect(v.erros.join(' ')).toMatch(/inventado/);
  });

  it('validador REJEITA padrão de cálculo no texto', () => {
    const r = orquestrarRelatorio(inputBase());
    const iii = r.cenarios.find((c) => c.scenarioId === 'III_CONV')!;
    const v = validarInsights(r, [
      {
        insightId: 'ins_calc',
        titulo: 'Cálculo indevido',
        texto: `O total é = R$ ${iii.totalPagar.toFixed(2).replace('.', ',')} recalculado.`,
        nivel: 'INFO',
        cenariosRef: ['III_CONV'],
        valoresCitados: [iii.totalPagar],
      },
    ]);
    expect(v.filtrados).toHaveLength(0);
  });
});
