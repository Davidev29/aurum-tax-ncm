import { describe, expect, it } from 'vitest';
import { calcularConvencional } from '@/simples/calculo';
import { anexoEfetivoParcela, calcularSegregado, pseudoConvDoSegregado, somaParcelas } from '@/simples/segregacao-receita';
import { calcularST } from '@/simples/segregacao-st';
import { csvSimples } from '@/simples/export';
import { montarDadosDas } from '@/simples/DasModal';

describe('segregacao por anexo', () => {
  it('cada parcela usa a RBT12 total na sua tabela e o DAS soma', () => {
    const rbt12 = 704423.8;
    const a = calcularConvencional({ anexoId: 'I', rbt12, receitaMes: 2000 });
    const b = calcularConvencional({ anexoId: 'III', rbt12, receitaMes: 2686.01 });
    const seg = calcularSegregado(rbt12, [
      { anexoId: 'I', receitaMes: 2000 },
      { anexoId: 'III', receitaMes: 2686.01 },
    ]);
    expect(seg.receitaMes).toBeCloseTo(4686.01, 2);
    expect(seg.das).toBeCloseTo(a.das + b.das, 2);
    expect(seg.parcelas[0].faixa).toBe(a.faixa);
    expect(seg.parcelas[1].aliquotaEfetiva).toBeCloseTo(b.aliquotaEfetiva, 8);
    expect(seg.reparticao.ICMS + seg.reparticao.ISS).toBeCloseTo(
      a.reparticao.ICMS + a.reparticao.IPI + b.reparticao.ISS + b.reparticao.IPI, 2,
    );
    expect(seg.anexos).toEqual(['I', 'III']);
  });

  it('aliquota media = DAS / receita e somaParcelas valida o fechamento', () => {
    const seg = calcularSegregado(500000, [
      { anexoId: 'I', receitaMes: 6000 },
      { anexoId: 'V', receitaMes: 4000 },
    ]);
    expect(seg.aliquotaMedia).toBeCloseTo(seg.das / 10000, 8);
    expect(somaParcelas([{ valor: 6000 }, { valor: 4000 }])).toBe(10000);
  });

  it('fail-closed sem base', () => {
    expect(() => calcularSegregado(0, [{ anexoId: 'I', receitaMes: 100 }])).toThrow();
    expect(() => calcularSegregado(100000, [])).toThrow();
    expect(() => calcularSegregado(100000, [{ anexoId: 'I', receitaMes: 0 }])).toThrow();
  });

  it('ST proporcional sobre o total segregado e guia com valores finais', () => {
    const seg = calcularSegregado(500000, [
      { anexoId: 'I', receitaMes: 6000 },
      { anexoId: 'III', receitaMes: 4000 },
    ]);
    const base = calcularConvencional({ anexoId: 'I', rbt12: 500000, receitaMes: 10000 });
    const pseudo = pseudoConvDoSegregado(seg, base);
    const st = calcularST(pseudo, 10000, 5000, 'ISS');
    expect(st.deducao).toBeCloseTo((seg.reparticao.ISS * 5000) / 10000, 1);
    expect(st.dasFinal).toBeCloseTo(seg.das - st.deducao, 2);
    const dados = montarDadosDas(st.convAjustado, {
      modo: 'manual', empresaNome: '', cnpj: '', cnae: '', rbt12: 500000, receitaMes: 10000,
      st: { tributo: 'ISS', valorST: 5000, deducao: st.deducao },
      seg: { anexos: ['I', 'III'], temResto: false, redir: [] },
    });
    expect(dados.total).toBeCloseTo(st.dasFinal, 2);
    expect(dados.observacoes).toContain('Segregado I + III');
  });

  it('checkbox ST no mesmo anexo: deduz o ICMS integral da parcela', () => {
    const rbt12 = 500000;
    const receita = 10000;
    const bruto = calcularConvencional({ anexoId: 'I', rbt12, receitaMes: receita });
    const seg = calcularSegregado(rbt12, [{ anexoId: 'I', receitaMes: receita, st: true }]);
    expect(seg.temST).toBe(true);
    expect(seg.tributosST).toEqual(['ICMS']);
    expect(seg.parcelas[0].deducaoST).toBeCloseTo(bruto.reparticao.ICMS, 2);
    expect(seg.das).toBeCloseTo(bruto.das - bruto.reparticao.ICMS, 2);
    expect(seg.dasBruto).toBeCloseTo(bruto.das, 2);
    expect(seg.deducaoST).toBeCloseTo(bruto.reparticao.ICMS, 2);
  });

  it('ST por parcela isolada equivale ao proporcional global', () => {
    const rbt12 = 704423.8;
    const receita = 4686.01;
    const conv = calcularConvencional({ anexoId: 'III', rbt12, receitaMes: receita });
    const global = calcularST(conv, receita, receita / 2, 'ISS');
    const seg = calcularSegregado(rbt12, [
      { anexoId: 'III', receitaMes: receita / 2, st: true },
      { anexoId: 'III', receitaMes: receita / 2 },
    ]);
    // tolerância de 1 décimo: isolar a metade ST em parcela própria
    // introduz ±R$ 0,01 de arredondamento duplo vs. proporcional global
    expect(seg.das).toBeCloseTo(global.dasFinal, 1);
    expect(seg.deducaoST).toBeCloseTo(global.deducao, 1);
  });

  it('misto: ST numa parcela, outra sem — bruto menos final fecha a diferenca', () => {
    const seg = calcularSegregado(500000, [
      { anexoId: 'I', receitaMes: 6000, st: true },
      { anexoId: 'III', receitaMes: 4000 },
    ]);
    const brutoI = calcularConvencional({ anexoId: 'I', rbt12: 500000, receitaMes: 6000 });
    expect(seg.dasBruto).toBeCloseTo(seg.parcelas[0].dasBruto + seg.parcelas[1].dasBruto, 2);
    expect(seg.das).toBeCloseTo(seg.dasBruto - brutoI.reparticao.ICMS, 2);
    expect(seg.parcelas[1].deducaoST).toBe(0);
    expect(seg.tributosST).toEqual(['ICMS']);
    // riscado por tributo: bruta menos final = deducao
    expect(seg.reparticaoBruta.ICMS - seg.reparticao.ICMS).toBeCloseTo(seg.deducaoST, 2);
    expect(seg.reparticaoBruta.ISS).toBeCloseTo(seg.reparticao.ISS, 2);
  });

  it('restante automatico: parcial segrega, resto calcula no anexo efetivo', () => {    const rbt12 = 704882.16;
    const receita = 134882.16;
    const segValor = 4686.01;
    const resto = Math.round((receita - segValor) * 100) / 100;
    const seg = calcularSegregado(rbt12, [
      { anexoId: 'III', receitaMes: segValor, st: true },
      { anexoId: 'III', receitaMes: resto, resto: true },
    ]);
    const convSeg = calcularConvencional({ anexoId: 'III', rbt12, receitaMes: segValor });
    const convResto = calcularConvencional({ anexoId: 'III', rbt12, receitaMes: resto });
    expect(seg.receitaMes).toBeCloseTo(receita, 2);
    expect(seg.parcelas[1].resto).toBe(true);
    expect(seg.parcelas[1].das).toBeCloseTo(convResto.das, 2);
    expect(seg.das).toBeCloseTo(convSeg.das - convSeg.reparticao.ISS + convResto.das, 1);
    // bruto normal (tudo no III) menos final = diferenca exibida
    const bruto = calcularConvencional({ anexoId: 'III', rbt12, receitaMes: receita });
    expect(seg.dasBruto).toBeCloseTo(bruto.das, 1);
    expect(bruto.das - seg.das).toBeGreaterThan(0);
  });

  it('Fator R compartilhado: V com folha >= 28% calcula como III', () => {
    const rbt12 = 704423.80;
    const folha = 233998.14; // 33,22% → III
    expect(anexoEfetivoParcela('V', rbt12, folha)).toEqual({ anexo: 'III', redirecionado: true });
    expect(anexoEfetivoParcela('V', rbt12, 0).redirecionado).toBe(false);
    expect(anexoEfetivoParcela('V', rbt12, 100000).anexo).toBe('V');
    expect(anexoEfetivoParcela('III', rbt12, folha).redirecionado).toBe(false);
    const seg = calcularSegregado(rbt12, [{ anexoId: 'V', receitaMes: 20703.75 }], rbt12, folha);
    const direto = calcularConvencional({ anexoId: 'III', rbt12, receitaMes: 20703.75 });
    expect(seg.parcelas[0].anexoCalculado).toBe('III');
    expect(seg.parcelas[0].das).toBe(direto.das);
    expect(seg.anexos).toEqual(['III']);
  });

  it('ST em parcela V redirecionada deduz ISS (do III), nao ICMS', () => {
    const seg = calcularSegregado(704423.80, [{ anexoId: 'V', receitaMes: 109928.41, st: true }], 704423.80, 233998.14);
    const d = seg.parcelas[0];
    expect(d.tributoST).toBe('ISS');
    const direto = calcularConvencional({ anexoId: 'III', rbt12: 704423.80, receitaMes: 109928.41 });
    expect(d.dasBruto).toBe(direto.das);
    expect(d.deducaoST).toBeCloseTo(direto.reparticao.ISS, 2);
    expect(d.das).toBeCloseTo(direto.das - direto.reparticao.ISS, 2);
  });

  it('cenario do print: V+V+III com folha 33,22% totaliza ~R$ 10.751', () => {    const seg = calcularSegregado(704423.80, [
      { anexoId: 'V', receitaMes: 20703.75 },
      { anexoId: 'V', receitaMes: 109928.41, st: true },
      { anexoId: 'III', receitaMes: 4250, st: true },
    ], 704423.80, 233998.14);
    // cada parcela confere com o cálculo direto no III (RBT12 total)
    const p1 = calcularConvencional({ anexoId: 'III', rbt12: 704423.80, receitaMes: 20703.75 });
    const p2 = calcularConvencional({ anexoId: 'III', rbt12: 704423.80, receitaMes: 109928.41 });
    const p3 = calcularConvencional({ anexoId: 'III', rbt12: 704423.80, receitaMes: 4250 });
    expect(seg.parcelas[0].das).toBe(p1.das);
    expect(seg.parcelas[1].das).toBeCloseTo(p2.das - p2.reparticao.ISS, 2);
    expect(seg.parcelas[2].das).toBeCloseTo(p3.das - p3.reparticao.ISS, 2);
    expect(seg.das).toBeCloseTo(p1.das + (p2.das - p2.reparticao.ISS) + (p3.das - p3.reparticao.ISS), 1);
    // reconcilia com a planilha do usuário (R$ 10.751,07 ± cascata de centavos)
    expect(seg.das).toBeCloseTo(10751.07, 0);
    expect(seg.dasBruto).toBeCloseTo(14831.41, 1);
  });

  it('pseudoConv coerente no multi-anexo (nada herdado da base além de anexo/cenário)', () => {
    const seg = calcularSegregado(500000, [
      { anexoId: 'I', receitaMes: 6000 },
      { anexoId: 'III', receitaMes: 4000 },
    ]);
    const base = calcularConvencional({ anexoId: 'I', rbt12: 500000, receitaMes: 10000 });
    const pseudo = pseudoConvDoSegregado(seg, base);
    expect(pseudo.das).toBe(seg.das);
    expect(pseudo.cbsDentroDAS).toBe(seg.cbsDentroDAS);
    // CBS efetiva fecha com o próprio cbsDentroDAS (antes: 103,14 vs 127,34)
    expect(pseudo.aliquotaEfetivaCBS * 10000).toBeCloseTo(pseudo.cbsDentroDAS, 1);
    expect(pseudo.aliquotaEfetivaCBSFinal).toBe(pseudo.aliquotaEfetivaCBS);
    // ISS do mix aparece (antes: zerado com ISS 129,64 no mix)
    expect(pseudo.reparticao.ISS).toBeGreaterThan(0);
    expect(pseudo.aliquotaISSFinal * 10000).toBeCloseTo(pseudo.reparticao.ISS, 1);
    expect(pseudo.aliquotaEfetiva).toBeCloseTo(seg.das / 10000, 8);
  });

  it('sublimite rateado: soma dos excedentes fecha com o cálculo único', () => {
    const unico = calcularConvencional({ anexoId: 'I', rbt12: 4000000, receitaMes: 500000, rba: 4000000 });
    const seg = calcularSegregado(4000000, [
      { anexoId: 'I', receitaMes: 250000 },
      { anexoId: 'I', receitaMes: 250000 },
    ], 4000000);
    // excesso único 400k rateado 200k+200k (antes: 250k+250k = 500k, erro −81,65)
    expect(seg.receitaExcedente).toBeCloseTo(400000, 2);
    expect(seg.receitaNaoExcedente).toBeCloseTo(100000, 2);
    expect(seg.das).toBeCloseTo(unico.das, 0);
    const pseudo = pseudoConvDoSegregado(seg, unico);
    expect(pseudo.detalhes.receitaExcedente).toBeCloseTo(400000, 2);
    expect(pseudo.detalhes.receitaNaoExcedente).toBeCloseTo(100000, 2);
  });

  it('resto guarda o anexo escolhido (p/ badge V→III)', () => {
    const seg = calcularSegregado(704423.80, [
      { anexoId: 'V', receitaMes: 4686.01 },
      { anexoId: 'V', receitaMes: 130196.15, resto: true, escolhido: 'V' },
    ], 704423.80, 233998.14);
    const resto = seg.parcelas.find((d) => d.resto)!;
    expect(resto.escolhido).toBe('V');
    expect(resto.anexoCalculado).toBe('III');
  });

  it('stDetalhe agrega base e dedução por tributo', () => {    const seg = calcularSegregado(500000, [
      { anexoId: 'I', receitaMes: 6000, st: true },
      { anexoId: 'III', receitaMes: 4000, st: true },
    ]);
    expect(seg.stDetalhe).toHaveLength(2);
    const icms = seg.stDetalhe.find((d) => d.tributo === 'ICMS')!;
    const iss = seg.stDetalhe.find((d) => d.tributo === 'ISS')!;
    expect(icms.valorST).toBe(6000);
    expect(iss.valorST).toBe(4000);
    expect(icms.deducao + iss.deducao).toBeCloseTo(seg.deducaoST, 2);
  });

  it('CSV: segregado vs referência com rótulos distintos (+ ST por tributo)', () => {
    const seg = calcularSegregado(500000, [
      { anexoId: 'I', receitaMes: 6000, st: true },
      { anexoId: 'III', receitaMes: 4000 },
    ]);
    const base = calcularConvencional({ anexoId: 'I', rbt12: 500000, receitaMes: 10000 });
    const csv = csvSimples({
      anexoId: 'I', rbt12: 500000, receitaMes: 10000, folha12: 0, rba: 500000, cbsRef: 0.088,
      conv: pseudoConvDoSegregado(seg, base), hib: null, debitosCBS: 0, creditosCBS: 0,
      dasReferencia: base.das,
      st: { ativo: true, tributo: 'ICMS', valorST: 6000, deducao: seg.deducaoST, detalhe: '', detalhePorTributo: seg.stDetalhe.map((d) => ({ tributo: d.tributo, valorST: d.valorST, deducao: d.deducao })), dasIntegral: seg.dasBruto, dasFinal: seg.das },
      seg: { ativo: true, anexos: seg.anexos, dasBruto: seg.dasBruto, parcelas: seg.parcelas.map((d) => ({ anexoId: d.anexoId, anexoCalculado: d.anexoCalculado, escolhido: d.escolhido, receitaMes: d.receitaMes, faixa: d.faixa, aliquotaEfetiva: d.aliquotaEfetiva, das: d.das, dasBruto: d.dasBruto, st: d.st, tributoST: d.tributoST, deducaoST: d.deducaoST, resto: d.resto })) },
    });
    expect(csv).toContain('DAS segregado (guia)');
    expect(csv).toContain('DAS convencional (anexo único, referência)');
    expect(csv).toContain('Dedução ST (ICMS)');
    expect(csv).toContain('DAS final (guia)');
  });
});
