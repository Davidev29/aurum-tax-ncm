/**
 * Sublimite estadual — guia DAS sem ICMS/ISS/IBS fora + referências manuais.
 *
 * Regra (LC 123/2006): acima de R$ 3,6M (RBT12 ou RBA), ICMS/ISS/IBS saem da
 * guia DAS. A guia (`dasGuia`) nunca contém esses tributos; a carga total
 * (`das`/`cargaTotal`) = guia + fora. O híbrido duela na base da guia.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularConvencional,
  calcularHibrido,
  debitoCBS,
  excedeSublimite,
  tributosForaSublimite,
} from '@/simples/calculo';

describe('sublimite — guia vs fora', () => {
  it('cenário 1: guia = total, fora zerado', () => {
    const c = calcularConvencional({ anexoId: 'I', rbt12: 500_000, receitaMes: 30_000 });
    expect(c.cenario).toBe(1);
    expect(c.excedeSublimite).toBe(false);
    expect(c.dasGuia).toBe(c.das);
    expect(c.foraSublimite.total).toBe(0);
    expect(c.tributosFora).toEqual([]);
  });

  it('cenário 2 (I): ICMS+IBS fora, guia sem eles', () => {
    const c = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 50_000 });
    expect(c.cenario).toBe(2);
    expect(c.excedeSublimite).toBe(true);
    expect(c.tributosFora).toEqual(['ICMS', 'IBS']);
    expect(c.foraSublimite.icms).toBeGreaterThan(0);
    expect(c.foraSublimite.ibs).toBeGreaterThan(0);
    expect(c.foraSublimite.iss).toBe(0);
    expect(c.dasGuia).toBeCloseTo(c.das - c.foraSublimite.total, 2);
    expect(c.reparticaoGuia.ICMS).toBe(0);
    expect(c.reparticaoGuia.IBS).toBe(0);
    expect(c.cbsDentroDAS).toBeGreaterThan(0);
    // CBS permanece na guia
    expect(c.reparticaoGuia.CBS).toBeGreaterThan(0);
  });

  it('cenário 4 (III): ISS+IBS fora, guia sem eles', () => {
    const c = calcularConvencional({ anexoId: 'III', rbt12: 3_800_000, receitaMes: 100_000, rba: 3_700_000 });
    expect(c.cenario).toBe(4);
    expect(c.tributosFora).toEqual(['ISS', 'IBS']);
    expect(c.foraSublimite.iss).toBeGreaterThan(0);
    expect(c.dasGuia).toBeCloseTo(c.das - c.foraSublimite.total, 2);
    expect(c.reparticaoGuia.ISS).toBe(0);
    expect(c.reparticaoGuia.IBS).toBe(0);
  });

  it('cenário 3 (I): RBT12 abaixo + RBA acima, ICMS fora sobre toda a receita', () => {
    const c = calcularConvencional({ anexoId: 'I', rbt12: 3_000_000, receitaMes: 100_000, rba: 3_700_000 });
    expect(c.cenario).toBe(3);
    expect(c.excedeSublimite).toBe(true);
    expect(c.foraSublimite.icms).toBeGreaterThan(0);
    expect(c.dasGuia + c.foraSublimite.total).toBeCloseTo(c.das, 2);
  });

  it('referência manual de ICMS troca o fora sem mudar a lógica da guia', () => {
    const auto = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 50_000 });
    const ref = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 50_000, aliqRefICMS: 0.18 });
    expect(ref.usouReferencia.icms).toBe(true);
    expect(ref.foraSublimite.icms).toBeCloseTo(200_000 * 0.18, 2);
    expect(ref.foraSublimite.icms).not.toBeCloseTo(auto.foraSublimite.icms, 2);
    // A guia não contém ICMS nos dois casos
    expect(ref.reparticaoGuia.ICMS).toBe(0);
    expect(ref.dasGuia + ref.foraSublimite.total).toBeCloseTo(ref.das, 2);
  });

  it('referência manual de ISS (III) vale sobre toda a receita', () => {
    const ref = calcularConvencional({ anexoId: 'III', rbt12: 3_800_000, receitaMes: 100_000, rba: 3_700_000, aliqRefISS: 0.05 });
    expect(ref.usouReferencia.iss).toBe(true);
    expect(ref.foraSublimite.iss).toBeCloseTo(100_000 * 0.05, 2);
  });

  it('referência de ICMS é ignorada em anexo de serviço (III)', () => {
    const c = calcularConvencional({ anexoId: 'III', rbt12: 3_800_000, receitaMes: 100_000, rba: 3_700_000, aliqRefICMS: 0.18 });
    expect(c.usouReferencia.icms).toBe(false);
    expect(c.foraSublimite.icms).toBe(0);
  });

  it('híbrido com sublimite duela na guia (fora não distorce)', () => {
    const conv = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 50_000 });
    const hib = calcularHibrido({ convencional: conv, debitosCBS: debitoCBS(200_000, 'cheia', 0.088), creditosCBS: 66 });
    // base da guia: reduzido = guia − CBS dentro
    expect(hib.dasReduzido).toBeCloseTo(conv.dasGuia - conv.cbsDentroDAS, 2);
    expect(hib.cargaTotal).toBeCloseTo(hib.total + conv.foraSublimite.total, 2);
    // economia compara guia × guia
    expect(hib.economiaVsConvencional).toBeCloseTo(conv.dasGuia - hib.total, 2);
    expect(hib.melhor).toBe('convencional');
  });

  it('tributos fora por anexo', () => {
    expect(tributosForaSublimite('I')).toEqual(['ICMS', 'IBS']);
    expect(tributosForaSublimite('II')).toEqual(['ICMS', 'IBS']);
    expect(tributosForaSublimite('III')).toEqual(['ISS', 'IBS']);
    expect(tributosForaSublimite('IV')).toEqual(['ISS', 'IBS']);
    expect(tributosForaSublimite('V')).toEqual(['ISS', 'IBS']);
  });

  it('excedeSublimite helper', () => {
    expect(excedeSublimite(3_600_000)).toBe(false);
    expect(excedeSublimite(3_600_000.01)).toBe(true);
    expect(excedeSublimite(1_000_000, 3_700_000)).toBe(true);
    expect(excedeSublimite(1_000_000, 1_000_000)).toBe(false);
  });
});
