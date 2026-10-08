/**
 * Upgrade v2 — segregação: splits extremos, anexos, empresa nova, payback e veredito.
 *
 * Cobre a PARTE 5 da spec: split 0/50/100, mesmo anexo × anexos diferentes,
 * empresa nova em início de atividade, payback com/sem custos, empate técnico.
 */
import { describe, expect, it } from 'vitest';
import { calcularConvencional } from '@/simples/calculo';
import { simularCenarioDividido } from '@/simples-projection/cenario-dividido';
import { distribuirRTB12, validarRTB12, periodoReferencia } from '@/simples-projection/baseline';
import { analisarRetorno } from '@/simples-projection/analise-retorno';
import type { MesReceita } from '@/simples-projection/types';

const HIST: MesReceita[] = Array.from({ length: 12 }, (_, i) => ({
  mes: `2025-${String(i + 1).padStart(2, '0')}`,
  receita: 100_000,
}));

function total(n: number, valor = 120_000, inicio = '2026-01'): MesReceita[] {
  const [a, m] = inicio.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a!, m! - 1 + i, 1));
    return { mes: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, receita: valor };
  });
}

describe('segregação v2 — splits extremos', () => {
  it('split 0% = tudo na mãe (DAS dividido == DAS mãe, nova zerada)', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(3),
      percentualNova: 0,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    for (const l of r.serieMensal) {
      expect(l.receitaNova).toBe(0);
      expect(l.dasNova).toBe(0);
      expect(l.receitaMae).toBe(l.receitaTotal);
    }
  });

  it('split 100% = tudo na nova', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(3),
      percentualNova: 1,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    for (const l of r.serieMensal) {
      expect(l.receitaMae).toBe(0);
      expect(l.dasMae).toBe(0);
      expect(l.receitaNova).toBe(l.receitaTotal);
    }
  });

  it('split 50% fatiamento exato mês a mês', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(2, 100_000),
      percentualNova: 0.5,
      mae: { anexoId: 'I', folha12: 0, historico12: HIST },
      nova: { anexoId: 'I', folha12: 0, historico12: [] },
    });
    expect(r.serieMensal[0]!.receitaMae).toBe(50_000);
    expect(r.serieMensal[0]!.receitaNova).toBe(50_000);
  });
});

describe('segregação v2 — anexos', () => {
  it('mesmo anexo: DAS confere com motor direto', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(2),
      percentualNova: 0.4,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    for (const l of r.serieMensal) {
      expect(l.dasMae).toBe(calcularConvencional({ anexoId: 'III', rbt12: l.rbt12Mae, receitaMes: l.receitaMae }).das);
      expect(l.dasNova).toBe(calcularConvencional({ anexoId: 'III', rbt12: l.rbt12Nova, receitaMes: l.receitaNova }).das);
    }
  });

  it('anexos diferentes: cada empresa usa sua própria tabela', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(2),
      percentualNova: 0.4,
      mae: { anexoId: 'I', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    for (const l of r.serieMensal) {
      expect(l.dasMae).toBe(calcularConvencional({ anexoId: 'I', rbt12: l.rbt12Mae, receitaMes: l.receitaMae }).das);
      expect(l.dasNova).toBe(calcularConvencional({ anexoId: 'III', rbt12: l.rbt12Nova, receitaMes: l.receitaNova }).das);
    }
    expect(r.metadados.anexoMae).toBe('I');
    expect(r.metadados.anexoNova).toBe('III');
  });
});

describe('segregação v2 — empresa nova, payback e veredito', () => {
  it('nova em início de atividade: RBT12 = média × 12 no 1º mês', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(1, 120_000),
      percentualNova: 0.3,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [], mesesAtividade: 0 },
    });
    // Nova recebe 36k no mês → 1º mês sem histórico: 36k × 12.
    expect(r.serieMensal[0]!.rbt12Nova).toBe(36_000 * 12);
    expect(r.alertas.map((a) => a.codigo)).toContain('EMPRESA_NOVA_REGRA_MEDIA');
  });

  it('payback sem custos: virada e payback consistentes', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(6),
      percentualNova: 0.3,
      mae: { anexoId: 'I', folha12: 0, historico12: HIST },
      nova: { anexoId: 'I', folha12: 0, historico12: [] },
      custoMensalNova: 0,
    });
    // economia = bruta quando sem custo
    for (const l of r.serieMensal) {
      expect(l.economiaMes).toBeCloseTo((l.economiaBrutaMes ?? 0) - (l.custoMes ?? 0), 2);
    }
    if (r.payback.mesVirada) {
      const idx = r.serieMensal.findIndex((l) => l.mes === r.payback.mesVirada);
      expect(r.serieMensal[idx]!.economiaMes).toBeGreaterThan(0);
    }
    expect(r.payback.veredito).toMatch(/compensa|nao-compensa|empate-tecnico/);
  });

  it('payback com custos: custo inicial cai todo no mês 1', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(3),
      percentualNova: 0.5,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
      custoMensalNova: 1000,
      custoInicialNova: 5000,
    });
    expect(r.serieMensal[0]!.custoMes).toBe(6000);
    expect(r.serieMensal[1]!.custoMes).toBe(1000);
  });

  it('empate técnico quando |economia| ≤ margem', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(3, 50_000),
      percentualNova: 0.5,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
      margemEmpate: 10_000_000,
    });
    expect(r.payback.veredito).toBe('empate-tecnico');
    const ret = analisarRetorno(r.serieMensal, 0, 10_000_000);
    expect(ret.status).toBe('empate-tecnico');
  });
});

describe('baseline RTB12', () => {
  it('distribuição igual soma exata + validações', () => {
    const meses = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const dist = distribuirRTB12(1_200_000, meses, 'igual');
    expect(dist.reduce((a, r) => a + r.receita, 0)).toBeCloseTo(1_200_000, 2);
    expect(dist).toHaveLength(12);
    expect(() => distribuirRTB12(0, meses)).toThrow(/RTB12/i);
    const v = validarRTB12(dist.map((d) => ({ mes: d.mes, receita: d.receita })));
    expect(v.total).toBeCloseTo(1_200_000, 2);
    expect(periodoReferencia(dist)).toContain('→');
  });
});

describe('segregação v2 — composição intra-empresa (LC 123 art. 18)', () => {
  it('DAS segregado = soma das chamadas por anexo com RBT12 total', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(2, 100_000),
      percentualNova: 0,
      mae: {
        anexoId: 'I',
        folha12: 0,
        historico12: HIST,
        composicao: [
          { anexoId: 'I', percentual: 0.6 },
          { anexoId: 'III', percentual: 0.4 },
        ],
      },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    const l = r.serieMensal[0]!;
    const pI = calcularConvencional({ anexoId: 'I', rbt12: l.rbt12Mae, receitaMes: 60_000 });
    const pIII = calcularConvencional({ anexoId: 'III', rbt12: l.rbt12Mae, receitaMes: 40_000 });
    expect(l.dasMae).toBeCloseTo(pI.das + pIII.das, 2);
    expect(l.detalheMae).toHaveLength(2);
    expect(r.metadados.composicaoMae).toHaveLength(2);
  });

  it('sem composição o comportamento mono-anexo é idêntico ao anterior', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(1, 100_000),
      percentualNova: 0,
      mae: { anexoId: 'I', folha12: 0, historico12: HIST },
      nova: { anexoId: 'I', folha12: 0, historico12: [] },
    });
    const l = r.serieMensal[0]!;
    expect(l.dasMae).toBe(calcularConvencional({ anexoId: 'I', rbt12: l.rbt12Mae, receitaMes: 100_000 }).das);
    expect(l.detalheMae).toBeUndefined();
  });

  it('composição inválida lança erro explícito', () => {
    expect(() =>
      simularCenarioDividido({
        mesInicio: '2026-01',
        receitaTotalMensal: total(1),
        percentualNova: 0.5,
        mae: { anexoId: 'I', folha12: 0, historico12: HIST, composicao: [] },
        nova: { anexoId: 'I', folha12: 0, historico12: [] },
      }),
    ).toThrow(/composicao/i);
  });

  it('mãe jovem usa RBT12 proporcional mesmo com 12 linhas de histórico', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(1, 120_000),
      percentualNova: 0,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST, mesesAtividade: 5 },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    // Soma dos últimos 5 do HIST (100k cada) / 5 × 12 = 1,2M — sem diluição por 12.
    expect(r.serieMensal[0]!.rbt12Mae).toBe(1_200_000);
  });

  it('III puro dispensa Fator R (sem diagnóstico, sem alerta, sem encargos)', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(2, 100_000),
      percentualNova: 0.5,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST, dispensarFatorR: true },
      nova: { anexoId: 'III', folha12: 0, historico12: [], dispensarFatorR: true },
    });
    expect(r.analiseFatorR!.linhas.every((l) => !l.mae.aplicaFatorR && !l.nova.aplicaFatorR)).toBe(true);
    expect(r.analiseFatorR!.linhas[0]!.mae.dispensa).toBe('iii-puro');
    expect(r.alertas.some((a) => a.codigo === 'FATOR_R_TROCA_ANEXO')).toBe(false);
  });

  it('III sujeito (default) mantém o diagnóstico', () => {
    const r = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: total(1, 100_000),
      percentualNova: 0,
      mae: { anexoId: 'III', folha12: 0, historico12: HIST },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    expect(r.analiseFatorR!.linhas[0]!.mae.aplicaFatorR).toBe(true);
    expect(r.analiseFatorR!.linhas[0]!.mae.dispensa).toBeUndefined();
  });
});
