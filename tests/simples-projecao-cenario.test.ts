/**
 * simples-projection — orquestrador dividido (Etapa 4).
 * Integração: prova que o cenário consome o motor existente sem alterá-lo.
 */
import { describe, expect, it } from 'vitest';
import { calcularConvencional } from '@/simples/calculo';
import { simularCenarioDividido } from '@/simples-projection/cenario-dividido';
import type { MesReceita } from '@/simples-projection/types';

const HIST_MAE: MesReceita[] = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
].map((mes) => ({ mes, receita: 100_000 }));

function total3(): MesReceita[] {
  return [{ mes: '2026-01', receita: 120_000 }, { mes: '2026-02', receita: 120_000 }, { mes: '2026-03', receita: 120_000 }];
}

describe('cenario dividido — integração com motor existente', () => {
  it('DAS de cada linha confere com calcularConvencional direto (mesmo RBT12/receita)', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total3(),
      percentualNova: 0.3,
      mae: { anexoId: 'III', folha12: 400_000, historico12: HIST_MAE },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
      custoMensalNova: 0,
    });
    expect(r.serieMensal).toHaveLength(3);
    // Referência: janela rolante do TOTAL sobre histórico da mãe.
    // jan 1.20M, fev 1.22M (sai 100k entra 120k), mar 1.24M.
    const rbt12RefEsperado = [1_200_000, 1_220_000, 1_240_000];
    for (let i = 0; i < r.serieMensal.length; i++) {
      const linha = r.serieMensal[i]!;
      const diretoMae = calcularConvencional({ anexoId: 'III', rbt12: linha.rbt12Mae, receitaMes: linha.receitaMae });
      const diretoNova = calcularConvencional({ anexoId: 'III', rbt12: linha.rbt12Nova, receitaMes: linha.receitaNova });
      const diretoRef = calcularConvencional({ anexoId: 'III', rbt12: rbt12RefEsperado[i]!, receitaMes: linha.receitaTotal });
      expect(linha.dasMae).toBe(diretoMae.das);
      expect(linha.dasNova).toBe(diretoNova.das);
      expect(linha.faixaMae).toBe(diretoMae.faixa);
      // Referência usa janela rolante do total (estável em 1.2M neste fixture).
      expect(linha.dasUnificadoReferencia).toBe(diretoRef.das);
      expect(linha.economiaMes).toBeCloseTo(diretoRef.das - (diretoMae.das + diretoNova.das), 2);
    }
    // Janela deslizante coerente: mãe estável, nova em regime proporcional no 1º mês.
    expect(r.serieMensal[0]!.rbt12Mae).toBe(1_200_000);
    expect(r.serieMensal[0]!.rbt12Nova).toBe(36_000 * 12);
    expect(r.metadados.horizonteMeses).toBe(3);
    expect(r.insightsSugeridos).toEqual([]);
  });

  it('payback: primeira vez que o acumulado cruza zero, com custo mensal', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total3(),
      percentualNova: 0.3,
      mae: { anexoId: 'I', folha12: 0, historico12: HIST_MAE },
      nova: { anexoId: 'I', folha12: 0, historico12: [] },
      custoMensalNova: 50_000,
    });
    // Com custo alto, nenhum payback no horizonte curto.
    let acumulado = 0;
    let esperadoMes: string | null = null;
    for (const linha of r.serieMensal) {
      acumulado = Math.round((acumulado + linha.economiaMes) * 100) / 100;
      expect(linha.economiaAcumulada).toBeCloseTo(acumulado, 2);
      if (esperadoMes === null && acumulado > 0) esperadoMes = linha.mes;
    }
    expect(r.payback.mes).toBe(esperadoMes);
    expect(r.economiaTotal).toBeCloseTo(acumulado, 2);
  });

  it('alertas: sublimite, empresa nova e consolidação presentes quando aplicável', () => {
    const histAlto: MesReceita[] = HIST_MAE.map((m) => ({ ...m, receita: 320_000 }));
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total3(),
      percentualNova: 0.5,
      mae: { anexoId: 'III', folha12: 0, historico12: histAlto },
      nova: { anexoId: 'V', folha12: 0, historico12: [] },
    });
    const codigos = r.alertas.map((a) => a.codigo);
    expect(codigos).toContain('SUBLIMITE_3_6M');
    expect(codigos).toContain('EMPRESA_NOVA_REGRA_MEDIA');
    expect(codigos).toContain('CONSOLIDACAO_RECEITA_GRUPO');
  });

  it('validações explícitas: percentual fora de [0,1] e anexo inválido', () => {
    expect(() =>
      simularCenarioDividido({
        mesInicio: '2026-01',
        receitaTotalMensal: total3(),
        percentualNova: 1.5,
        mae: { anexoId: 'III', folha12: 0, historico12: HIST_MAE },
        nova: { anexoId: 'III', folha12: 0, historico12: [] },
      }),
    ).toThrow(/percentualNova/i);
    expect(() =>
      simularCenarioDividido({
        mesInicio: '2026-01',
        receitaTotalMensal: total3(),
        percentualNova: 0.3,
        mae: { anexoId: 'X' as never, folha12: 0, historico12: HIST_MAE },
        nova: { anexoId: 'III', folha12: 0, historico12: [] },
      }),
    ).toThrow(/anexoId/i);
  });
});
