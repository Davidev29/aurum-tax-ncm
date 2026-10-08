import { describe, expect, it } from 'vitest';
import { calcularConvencional } from '@/simples/calculo';
import { calcularST, resolverTributoST, tributoSTDoAnexo } from '@/simples/segregacao-st';
import { montarDadosDas } from '@/simples/DasModal';

describe('segregacao ST', () => {
  it('anexo I -> ICMS, III -> ISS, auto resolve', () => {
    expect(tributoSTDoAnexo('I')).toBe('ICMS');
    expect(tributoSTDoAnexo('II')).toBe('ICMS');
    expect(tributoSTDoAnexo('III')).toBe('ISS');
    expect(tributoSTDoAnexo('IV')).toBe('ISS');
    expect(tributoSTDoAnexo('V')).toBe('ISS');
    expect(resolverTributoST('III', 'auto')).toBe('ISS');
    expect(resolverTributoST('I', 'auto')).toBe('ICMS');
    expect(resolverTributoST('I', 'ISS')).toBe('ISS');
  });

  it('deducao proporcional: metade da receita com ST deduz metade do ISS', () => {
    const conv = calcularConvencional({ anexoId: 'III', rbt12: 704423.8, receitaMes: 4686.01 });
    expect(conv.das).toBeGreaterThan(0);
    expect(conv.reparticao.ISS).toBeGreaterThan(0);
    const st = calcularST(conv, 4686.01, 4686.01 / 2, 'ISS');
    expect(st.deducao).toBeCloseTo(conv.reparticao.ISS / 2, 1);
    expect(st.dasFinal).toBeCloseTo(conv.das - st.deducao, 2);
    expect(st.reparticaoFinal.ISS).toBeCloseTo(conv.reparticao.ISS - st.deducao, 2);
    expect(st.dasIntegral).toBe(conv.das);
  });

  it('ST total zera o tributo e a guia leva so o final', () => {
    const conv = calcularConvencional({ anexoId: 'I', rbt12: 500000, receitaMes: 10000 });
    const st = calcularST(conv, 10000, 10000, 'ICMS');
    expect(st.tributoFinal).toBe(0);
    expect(st.dasFinal).toBeCloseTo(conv.das - conv.reparticao.ICMS, 2);
    const dados = montarDadosDas(st.convAjustado, {
      modo: 'manual', empresaNome: '', cnpj: '', cnae: '', rbt12: 500000, receitaMes: 10000,
      st: { tributo: 'ICMS', valorST: 10000, deducao: st.deducao },
    });
    expect(dados.total).toBeCloseTo(st.dasFinal, 2);
    const icms = dados.itens.find((i) => i.codigo === '1007');
    // ICMS 100% ST: some da guia (valor final 0)
    expect(icms).toBeUndefined();
  });

  it('clamp: ST maior que receita trava na receita; ST zero nao deduz', () => {
    const conv = calcularConvencional({ anexoId: 'III', rbt12: 300000, receitaMes: 5000 });
    const a = calcularST(conv, 5000, 999999, 'ISS');
    expect(a.valorST).toBe(5000);
    expect(a.tributoFinal).toBe(0);
    const b = calcularST(conv, 5000, 0, 'ISS');
    expect(b.deducao).toBe(0);
    expect(b.dasFinal).toBe(conv.das);
  });
});
