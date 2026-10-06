/**
 * simples-projection — pró-labore: INSS 11% + IRPF mensal 2026.
 * Valores-âncora conferidos contra os exemplos oficiais da Receita
 * (tabela Lei 15.191/2025 + redução Lei 15.270/2025).
 */
import { describe, expect, it } from 'vitest';
import {
  calcularCustoProLabore,
  calcularINSSProLabore,
  calcularIRPFMensal2026,
  DESCONTO_SIMPLIFICADO_MENSAL_2026,
  TETO_INSS_MENSAL_REF_2025,
} from '@/simples-projection/pro-labore';

describe('INSS do pró-labore (11%)', () => {
  it('11% do bruto dentro do teto', () => {
    const r = calcularINSSProLabore(4000);
    expect(r.inss).toBeCloseTo(440, 2);
    expect(r.tetoAplicado).toBe(false);
  });

  it('trava no teto do RGPS', () => {
    const r = calcularINSSProLabore(TETO_INSS_MENSAL_REF_2025 + 5000);
    expect(r.baseTributada).toBe(TETO_INSS_MENSAL_REF_2025);
    expect(r.inss).toBeCloseTo(TETO_INSS_MENSAL_REF_2025 * 0.11, 2);
    expect(r.tetoAplicado).toBe(true);
  });
});

describe('IRPF mensal 2026 (exemplos oficiais da Receita)', () => {
  it('exemplo 2: salário R$ 4.000 → imposto 114,76 zerado pela redução', () => {
    // Base 4000 − 607,20 = 3392,80 → 3ª faixa 15%: 3392,80×0,15 − 394,16 = 114,76.
    const r = calcularIRPFMensal2026(4000);
    expect(r.deducaoAplicada).toBe(DESCONTO_SIMPLIFICADO_MENSAL_2026);
    expect(r.impostoTabela).toBeCloseTo(114.76, 2);
    expect(r.irpf).toBe(0);
    expect(r.comReducaoLei15270).toBe(true);
  });

  it('exemplo 3: salário R$ 5.000 → imposto 312,89 zerado (limitado ao imposto)', () => {
    const r = calcularIRPFMensal2026(5000);
    expect(r.impostoTabela).toBeCloseTo(312.89, 2);
    expect(r.reducao).toBeCloseTo(312.89, 2);
    expect(r.irpf).toBe(0);
  });

  it('faixa de transição: R$ 6.000 com deduções legais → redução parcial', () => {
    // Com INSS 11% (660) como dedução legal: base 5340 → 5ª faixa.
    const r = calcularIRPFMensal2026(6000, { inss: 660, usarSimplificado: false });
    expect(r.impostoTabela).toBeCloseTo(5340 * 0.275 - 908.73, 2);
    expect(r.reducao).toBeCloseTo(978.62 - 0.133145 * 6000, 2);
    expect(r.irpf).toBeCloseTo(r.impostoTabela - r.reducao, 2);
    expect(r.irpf).toBeGreaterThan(0);
  });

  it('sem redução a partir de R$ 7.350', () => {
    const r = calcularIRPFMensal2026(7607.2);
    // Base 7607,20 − 607,20 = 7000 → 27,5%: 7000×0,275 − 908,73 = 1016,27.
    expect(r.impostoTabela).toBeCloseTo(1016.27, 2);
    expect(r.reducao).toBe(0);
    expect(r.irpf).toBeCloseTo(1016.27, 2);
  });

  it('isenção na 1ª faixa mesmo sem redução', () => {
    const r = calcularIRPFMensal2026(2000);
    expect(r.impostoTabela).toBe(0);
    expect(r.irpf).toBe(0);
  });
});

describe('custo total do pró-labore', () => {
  it('INSS + IRPF zerado até R$ 5.000 (com simplificado)', () => {
    const c = calcularCustoProLabore(4000);
    expect(c.inss).toBeCloseTo(440, 2);
    expect(c.irpf).toBe(0);
    expect(c.liquido).toBeCloseTo(3560, 2);
  });

  it('sinaliza CPP por fora quando há Anexo IV', () => {
    const c = calcularCustoProLabore(4000, { envolveAnexoIV: true });
    expect(c.cppPatronalPorFora).toBeCloseTo(800, 2);
    expect(c.custoTotal).toBeCloseTo(c.descontosPF + 800, 2);
  });

  it('sem CPP por fora nos demais anexos', () => {
    expect(calcularCustoProLabore(4000).cppPatronalPorFora).toBe(0);
  });
});
