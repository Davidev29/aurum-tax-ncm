/**
 * simples-projection — Fator R dividido + análise de retorno.
 * Prova o diagnóstico ≥/<28% (déficit e pró-labore sugerido) e a
 * classificação do retorno sem tocar o núcleo `src/simples/*`.
 */
import { describe, expect, it } from 'vitest';
import {
  analisarFatorRSerie,
  diagnosticarFatorREmpresa,
  folhaNecessaria28,
} from '@/simples-projection/fator-r-dividido';
import { analisarRetorno } from '@/simples-projection/analise-retorno';
import { simularCenarioDividido } from '@/simples-projection/cenario-dividido';
import type { MesReceita } from '@/simples-projection/types';

const HIST: MesReceita[] = Array.from({ length: 12 }, (_, i) => ({
  mes: `2025-${String(i + 1).padStart(2, '0')}`,
  receita: 100_000,
}));

describe('diagnóstico Fator R por empresa', () => {
  it('índice ≥ 28% → sem déficit', () => {
    // folha 400k ÷ RBT12 1,2M = 33,33% → Anexo III.
    const d = diagnosticarFatorREmpresa('mae', 'III', 400_000, 1_200_000);
    expect(d.indice).toBeCloseTo(1 / 3, 4);
    expect(d.atinge28).toBe(true);
    expect(d.anexoIndicado).toBe('III');
    expect(d.deficitFolha).toBe(0);
    expect(d.proLaboreMensalSugerido).toBe(0);
  });

  it('índice < 28% → déficit e pró-labore mensal = déficit ÷ 12', () => {
    // folha 200k ÷ 1,2M = 16,67% → Anexo V; precisa 336k − 200k = 136k.
    const d = diagnosticarFatorREmpresa('nova', 'V', 200_000, 1_200_000);
    expect(d.atinge28).toBe(false);
    expect(d.anexoIndicado).toBe('V');
    expect(d.deficitFolha).toBeCloseTo(136_000, 2);
    expect(d.proLaboreMensalSugerido).toBeCloseTo(136_000 / 12, 2);
    expect(folhaNecessaria28(1_200_000)).toBeCloseTo(336_000, 2);
  });

  it('anexo sem Fator R (I, II, IV) dispensa o diagnóstico', () => {
    const d = diagnosticarFatorREmpresa('mae', 'I', 0, 1_200_000);
    expect(d.aplicaFatorR).toBe(false);
    expect(d.deficitFolha).toBe(0);
  });
});

describe('análise Fator R na série dividida', () => {
  it('unificado usa folha somada contra o RBT12 de referência', () => {
    const a = analisarFatorRSerie(
      [{ mes: '2026-01', rbt12Mae: 840_000, rbt12Nova: 432_000, rbt12Ref: 1_200_000 }],
      { anexoMae: 'III', anexoNova: 'V', folha12Mae: 200_000, folha12Nova: 0 },
    );
    expect(a.linhas).toHaveLength(1);
    // Unificado: 200k ÷ 1,2M = 16,67% → déficit 136k.
    expect(a.linhas[0]!.unificado.deficitFolha).toBeCloseTo(136_000, 2);
    expect(a.resumo.mesesAbaixo28Unificado).toBe(1);
    expect(a.resumo.maiorDeficitUnificado).toMatchObject({ valor: 136_000 });
  });
});

describe('classificação do retorno', () => {
  const linha = (mes: string, economiaMes: number, economiaAcumulada: number) => ({
    mes,
    economiaMes,
    economiaAcumulada,
    receitaTotal: 100_000,
    dasUnificadoReferencia: 10_000,
    dasMae: 6_000,
    dasNova: 3_000,
  });

  it('lucro imediato quando o acumulado nunca zera', () => {
    const a = analisarRetorno(
      [linha('2026-01', 1000, 1000), linha('2026-02', 1000, 2000)],
      0,
    );
    expect(a.status).toBe('lucro-imediato');
    expect(a.mesesParaRetorno).toBe(1);
  });

  it('payback no horizonte quando cruza depois', () => {
    const a = analisarRetorno(
      [linha('2026-01', -500, -500), linha('2026-02', 800, 300)],
      0,
    );
    expect(a.status).toBe('payback-horizonte');
    expect(a.mesesParaRetorno).toBe(2);
    expect(a.mesPayback).toBe('2026-02');
  });

  it('sem-payback com meses positivos insuficientes', () => {
    const a = analisarRetorno(
      [linha('2026-01', -500, -500), linha('2026-02', 200, -300)],
      0,
    );
    expect(a.status).toBe('sem-payback');
    expect(a.mesesParaRetorno).toBeNull();
  });

  it('prejuízo quando nenhum mês é positivo', () => {
    const a = analisarRetorno(
      [linha('2026-01', -500, -500), linha('2026-02', -200, -700)],
      100,
    );
    expect(a.status).toBe('prejuizo');
    expect(a.totalCustos).toBe(200);
  });
});

describe('orquestrador acopla as análises', () => {
  it('relatório traz referência unificada + Fator R + retorno', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: [
        { mes: '2026-01', receita: 120_000 },
        { mes: '2026-02', receita: 120_000 },
      ],
      percentualNova: 0.3,
      mae: { anexoId: 'III', folha12: 400_000, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
      custoMensalNova: 1000,
    });
    const l0 = r.serieMensal[0]!;
    expect(l0.rbt12Ref).toBe(1_200_000);
    expect(l0.faixaRef).toBeGreaterThan(0);
    expect(l0.aliquotaNominalMae).toBeGreaterThan(0);
    expect(r.analiseFatorR?.linhas).toHaveLength(2);
    expect(r.analiseRetorno?.economiaTotal).toBe(r.economiaTotal);
    expect(r.metadados.folha12Mae).toBe(400_000);
  });
});
