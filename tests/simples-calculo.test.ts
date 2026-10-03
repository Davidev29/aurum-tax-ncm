/**
 * Simples Nacional — vetores da avaliação multiagente (agente Fledge Alpha).
 * Rigorosamente conforme as planilhas 2027–2028.
 */
import { describe, expect, it } from 'vitest';
import { ANEXOS_SIMPLES } from '@/simples/tabelas';
import {
  aliquotaEfetiva,
  calcularConvencional,
  calcularHibrido,
  debitoCBS,
  creditoCBS,
  faixaDoRBT12,
  fatorR,
  round2,
} from '@/simples/calculo';

describe('simples — vetores planilha', () => {
  it('EX1: Anexo I RBT12 250k receita 30k => DAS 1477.20', () => {
    const anexo = ANEXOS_SIMPLES.I;
    const faixa = faixaDoRBT12(anexo, 250_000)!;
    expect(faixa.faixa).toBe(2);
    const aliq = aliquotaEfetiva(250_000, faixa);
    expect(aliq).toBeCloseTo(0.04924, 6);
    const r = calcularConvencional({ anexoId: 'I', rbt12: 250_000, receitaMes: 30_000 });
    expect(r.das).toBeCloseTo(1477.2, 2);
    expect(r.reparticao.IRPJ).toBeCloseTo(81.25, 1);
    expect(r.reparticao.ICMS).toBeCloseTo(502.25, 1);
  });

  it('EX2: Anexo III RBT12 500k receita 60k => DAS 5983.20 sem trava ISS', () => {
    const r = calcularConvencional({ anexoId: 'III', rbt12: 500_000, receitaMes: 60_000 });
    expect(r.faixa).toBe(3);
    expect(r.aliquotaEfetiva).toBeCloseTo(0.09972, 5);
    expect(r.das).toBeCloseTo(5983.2, 1);
    expect(r.excedenteISS).toBe(0);
  });

  it('EX3: Fator R 100k/300k => III', () => {
    expect(fatorR(100_000, 300_000).anexo).toBe('III');
    expect(fatorR(80_000, 300_000).anexo).toBe('V');
  });

  it('EX4: sublimite cenário 4 soma componentes', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 3_700_000 });
    expect(r.cenario).toBe(4);
    expect(r.detalhes.receitaExcedente).toBe(100_000);
    expect(r.das).toBeGreaterThan(20_000);
  });

  it('EX5: híbrido Anexo I com créditos pequenos => convencional vence', () => {
    const conv = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 50_000 });
    const debitos = debitoCBS(200_000, 'cheia', 0.088);
    expect(debitos).toBeCloseTo(17600, 2);
    const cred = round2(creditoCBS(1500, 'integral', 0.088) * 0.3 + creditoCBS(300, 'integral', 0.088));
    expect(cred).toBeCloseTo(66, 1);
    const hib = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: cred });
    expect(hib.melhor).toBe('convencional');
  });

  it('RBT12 zero => DAS zero sem throw', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 0, receitaMes: 10_000 });
    expect(r.das).toBe(0);
  });
});
