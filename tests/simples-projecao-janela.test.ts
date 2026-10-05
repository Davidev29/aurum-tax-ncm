/**
 * simples-projection — motor de janela RBT12 (Etapa 3).
 * Segue o padrão `tests/simples-calculo.test.ts` (vitest, sem I/O).
 */
import { describe, expect, it } from 'vitest';
import { projetarRBT12Rolling } from '@/simples-projection/janela-rbt12';
import type { MesReceita } from '@/simples-projection/types';

function serie(meses: string[], valor: number | number[]): MesReceita[] {
  return meses.map((mes, i) => ({
    mes,
    receita: Array.isArray(valor) ? valor[i]! : valor,
  }));
}

const HIST_12 = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
];

describe('projecao RBT12 rolling', () => {
  it('regime cheio estável: 12x100k + 3x100k => RBT12 sempre 1.2M', () => {
    const r = projetarRBT12Rolling({
      mesInicio: '2026-01',
      historico12: serie(HIST_12, 100_000),
      projecaoMensal: serie(['2026-01', '2026-02', '2026-03'], 100_000),
    });
    expect(r).toHaveLength(3);
    for (const item of r) expect(item.rbt12).toBe(1_200_000);
    expect(r[0]!.mesSaindo).toBeNull();
    expect(r[0]!.mesEntrando).toBe('2025-12');
  });

  it('janela desliza: novo mês entra, mais antigo sai; nunca inclui o próprio mês', () => {
    const historico = serie(HIST_12, [10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 200_000]);
    const r = projetarRBT12Rolling({
      mesInicio: '2026-01',
      historico12: historico,
      projecaoMensal: serie(['2026-01', '2026-02'], [50_000, 50_000]),
    });
    // jan: soma histórico = 11*10k + 200k = 310k (receita jan 50k fora)
    expect(r[0]!.rbt12).toBe(310_000);
    // fev: sai 2025-01 (10k), entra 2026-01 (50k) => 310k -10k +50k = 350k
    expect(r[1]!.rbt12).toBe(350_000);
    expect(r[1]!.mesSaindo).toBe('2025-01');
    expect(r[1]!.mesEntrando).toBe('2026-01');
  });

  it('empresa nova (3 meses): RBT12 = média × 12', () => {
    const r = projetarRBT12Rolling({
      mesInicio: '2026-01',
      historico12: serie(['2025-10', '2025-11', '2025-12'], [60_000, 90_000, 120_000]),
      projecaoMensal: serie(['2026-01'], [100_000]),
      mesesAtividade: 3,
    });
    expect(r[0]!.empresaNova).toBe(true);
    // (60+90+120)/3*12 = 1.08M (receita jan fora da soma)
    expect(r[0]!.rbt12).toBeCloseTo(1_080_000, 2);
  });

  it('empresa no 1º mês sem histórico: RBT12 = receita × 12', () => {
    const r = projetarRBT12Rolling({
      mesInicio: '2026-01',
      historico12: [],
      projecaoMensal: serie(['2026-01'], [40_000]),
      mesesAtividade: 0,
    });
    expect(r[0]!.rbt12).toBe(480_000);
    expect(r[0]!.empresaNova).toBe(true);
  });

  it('transição nova→cheia: após 12 meses usa soma rolante', () => {
    const r = projetarRBT12Rolling({
      mesInicio: '2026-01',
      historico12: serie(['2025-12'], [100_000]),
      projecaoMensal: serie(['2026-01', '2026-02'], [100_000, 100_000]),
      mesesAtividade: 11,
    });
    // jan (11 meses): (100k/11)*12 ≈ 109090.91
    expect(r[0]!.empresaNova).toBe(true);
    expect(r[0]!.rbt12).toBeCloseTo(109090.91, 2);
    // fev (12 meses): regime cheio, soma dos ANTERIORES = 2025-12 + 2026-01 = 200k
    // (receita de fev nunca entra no próprio RBT12).
    expect(r[1]!.empresaNova).toBeUndefined();
    expect(r[1]!.rbt12).toBe(200_000);
  });

  it('erros explícitos: mesInicio, série vazia, histórico > 12, valor negativo', () => {
    expect(() =>
      projetarRBT12Rolling({ mesInicio: 'jan/26', historico12: [], projecaoMensal: serie(['2026-01'], 10) }),
    ).toThrow(/mesInicio/i);
    expect(() =>
      projetarRBT12Rolling({ mesInicio: '2026-01', historico12: serie(HIST_12, 10), projecaoMensal: [] }),
    ).toThrow(/vazia/i);
    expect(() =>
      projetarRBT12Rolling({
        mesInicio: '2026-01',
        historico12: serie([...HIST_12, '2025-13'].slice(0, 13), 10),
        projecaoMensal: serie(['2026-01'], 10),
      }),
    ).toThrow();
    expect(() =>
      projetarRBT12Rolling({
        mesInicio: '2026-01',
        historico12: [{ mes: '2025-12', receita: -5 }],
        projecaoMensal: serie(['2026-01'], 10),
      }),
    ).toThrow(/receita inválida/i);
    expect(() =>
      projetarRBT12Rolling({
        mesInicio: '2026-01',
        historico12: serie(HIST_12, 10),
        projecaoMensal: serie(['2026-02'], 10),
      }),
    ).toThrow(/diverge de mesInicio/i);
  });
});
