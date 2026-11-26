/**
 * Caracterização da cena derivada do `SimplesNacional` (page.tsx:415-577).
 * Os valores esperados são sempre comparados com o próprio resultado da
 * store/cálculo — o objetivo é travar que `montarCenaSimples` reproduz
 * exatamente as expressões extraídas do componente.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { montarCenaSimples } from '@/simples/cena';
import { useSimples } from '@/simples/store';

function resetar(): void {
  useSimples.getState().limpar();
  useSimples.setState({
    modo: 'manual',
    anexoId: 'I',
    escolheuAnexo: true,
    rbt12: 0,
    receitaMes: 0,
    folha12: 0,
    folhaInformada: false,
    semFolhaConfirmado: true, // folha zerada confirmada: guarda da store aceita o cálculo
    sujeitaFatorR: true,
    rba: 0,
    usarRba: false,
    cbsRef: 0.088,
    aliqRefICMS: null,
    aliqRefISS: null,
    despesas: [],
    compararHibrido: false,
    cnpj: '',
    empresaNome: '',
    opcoes: [],
    cnaeEscolhido: '',
    relatorioVisivel: false,
    convencional: null,
    hibrido: null,
    debitosCBS: 0,
    creditosCBS: 0,
    segAtivo: false,
    segParcelas: [],
  });
}

beforeEach(resetar);

describe('montarCenaSimples — caracterização de page.tsx:415-577', () => {
  it('1. manual sem segregação, dentro do sublimite', () => {
    useSimples.setState({
      anexoId: 'I',
      escolheuAnexo: true,
      rbt12: 360_000,
      receitaMes: 30_000,
      folha12: 0,
    });
    useSimples.getState().calcular();
    const s = useSimples.getState();
    const c = montarCenaSimples(s);

    expect(c.pronta1).toBe(true);
    expect(c.valoresOk).toBe(true);
    expect(c.estouradoPasso1).toBe(false);
    expect(c.comFolha).toBe(false);
    expect(c.segTemFatorR).toBe(false);
    expect(c.precisaFolha).toBe(false);
    expect(c.previsaoFR).toBeNull();
    expect(c.fr).toBeNull();
    expect(c.segSoma).toBeCloseTo(0, 10);
    expect(c.segExcesso).toBe(false);
    expect(c.segValida).toBe(true);
    expect(c.segRestoAnexo).toBe('I');
    expect(c.segResto).toBeCloseTo(0, 10);
    expect(c.segResultado).toBeNull();
    expect(c.convBase).toBe(s.convencional);
    expect(c.convExib).toBe(c.convBase);
    expect(c.dasExib).toBeCloseTo(s.convencional!.dasGuia, 10);
    expect(c.cargaTotalExib).toBeCloseTo(s.convencional!.cargaTotal, 10);
    expect(c.repExib).toBe(s.convencional!.reparticaoGuia);
    expect(c.dasBruto).toBeCloseTo(s.convencional!.dasGuia, 10);
    expect(c.repBrutaExib).toBe(s.convencional!.reparticaoGuia);
    expect(c.deducaoSTPorTributo).toEqual({});
    expect(c.infoSTPorTributo).toEqual({});
    expect(c.stResumo).toBeNull();
    expect(c.hibExib).toBeNull();
    expect(c.anexosEfetivosRefs).toEqual(['I']);
    expect(c.mostraRefICMS).toBe(false);
    expect(c.mostraRefISS).toBe(false);
    expect(c.previaConv).toBeNull();
    expect(c.podeVisualizar).toBe(true);
    expect(c.mostrando).toBe(s.convencional);
    expect(c.reparticao).toBe(c.repExib);
    expect(c.reparticaoItens).toContain('IRPJ');
    expect(c.reparticaoItens).toContain('CBS');
    expect(c.dadosDas).not.toBeNull();
    expect(c.dadosDas!.total).toBeCloseTo(c.dasExib, 10);

    // A flag local `gerando` do componente interfere apenas em `podeVisualizar`.
    expect(montarCenaSimples(s, true).podeVisualizar).toBe(false);
  });

  it('2. segregação com ST (ICMS) e restante automático', () => {
    useSimples.setState({
      anexoId: 'I',
      escolheuAnexo: true,
      rbt12: 600_000,
      receitaMes: 50_000,
      folha12: 0,
      segAtivo: true,
      segParcelas: [
        { id: 'p1', anexoId: 'I', valor: 20_000, st: true },
        { id: 'p2', anexoId: 'III', valor: 10_000, st: false },
      ],
    });
    useSimples.getState().calcular();
    const s = useSimples.getState();
    const c = montarCenaSimples(s);

    expect(c.segSoma).toBeCloseTo(30_000, 10);
    expect(c.segResto).toBeCloseTo(20_000, 10);
    expect(c.segRestoAnexo).toBe('I');
    expect(c.segExcesso).toBe(false);
    expect(c.segValida).toBe(true);
    expect(c.segResultado).not.toBeNull();
    expect(c.segResultado!.temST).toBe(true);
    expect(c.segResultado!.tributosST).toEqual(['ICMS']);
    expect(c.segResultado!.parcelas).toHaveLength(3);
    expect(c.convBase).not.toBe(s.convencional);
    expect(c.convBase!.anexoId).toBe(s.convencional!.anexoId);
    expect(c.dasExib).toBeCloseTo(c.segResultado!.dasGuia, 10);
    expect(c.cargaTotalExib).toBeCloseTo(c.convBase!.cargaTotal, 10);
    expect(c.dasBruto).toBeCloseTo(s.convencional!.dasGuia, 10);

    expect(c.deducaoSTPorTributo.ICMS).toBeGreaterThan(0);
    expect(c.infoSTPorTributo.ICMS).toContain('Anexo I');
    expect(c.stResumo).not.toBeNull();
    expect(c.stResumo!.tributo).toBe('ICMS');
    expect(c.stResumo!.valorST).toBeCloseTo(20_000, 10);
    expect(c.stResumo!.deducao).toBeCloseTo(c.deducaoSTPorTributo.ICMS!, 10);
    expect(c.repBrutaExib).toBe(c.segResultado!.reparticaoBrutaGuia);
    expect(c.reparticao).toBe(c.convBase!.reparticaoGuia);
    expect(c.reparticaoItens).toContain('IRPJ');
    expect(c.dadosDas!.observacoes).toContain('Segregado');
    expect(c.dadosDas!.observacoes).toContain('ST ICMS');
    expect(c.anexosEfetivosRefs).toEqual(['I', 'III']);
    expect(c.podeVisualizar).toBe(true);
  });

  it('3. Anexo V com folha >= 28% redirecionando para III', () => {
    useSimples.setState({
      anexoId: 'V',
      escolheuAnexo: true,
      rbt12: 400_000,
      receitaMes: 40_000,
      folha12: 150_000,
    });
    useSimples.getState().calcular();
    const s = useSimples.getState();
    const c = montarCenaSimples(s);

    expect(c.comFolha).toBe(true);
    expect(c.precisaFolha).toBe(true);
    expect(c.previsaoFR!.definido).toBe(true);
    expect(c.previsaoFR!.anexo).toBe('III');
    expect(c.previsaoFR!.indice).toBeCloseTo(0.375, 10);
    expect(c.fr!.anexo).toBe('III');
    expect(c.fr!.indice).toBeCloseTo(0.375, 10);
    expect(s.convencional!.anexoId).toBe('III');
    expect(c.convBase!.anexoId).toBe('III');
    expect(c.anexosEfetivosRefs).toEqual(['III']);
    expect(c.dasExib).toBeCloseTo(c.convBase!.dasGuia, 10);
    expect(c.podeVisualizar).toBe(true);
  });

  it('4. sublimite estourado com híbrido', () => {
    useSimples.setState({
      anexoId: 'III',
      escolheuAnexo: true,
      rbt12: 4_000_000,
      receitaMes: 100_000,
      folha12: 0,
    });
    useSimples.getState().calcular();
    const s = useSimples.getState();
    const c = montarCenaSimples(s);

    expect(c.estouradoPasso1).toBe(true);
    expect(c.convBase!.excedeSublimite).toBe(true);
    expect(c.convBase!.cenario).toBe(s.convencional!.cenario);
    expect(c.hibExib).not.toBeNull();
    expect(c.hibExib!.total).toBeCloseTo(s.hibrido!.total, 10);
    expect(c.dasExib).toBeCloseTo(c.convBase!.dasGuia, 10);
    expect(c.cargaTotalExib).toBeCloseTo(c.convBase!.cargaTotal, 10);
    expect(c.dasExib).toBeLessThan(c.cargaTotalExib);
    expect(c.dasBruto).toBeCloseTo(s.convencional!.dasGuia, 10);
    expect(c.repExib!.ISS).toBeCloseTo(0, 10);
    expect(c.repExib!.IBS).toBeCloseTo(0, 10);
    expect(c.reparticaoItens).not.toContain('ISS');
    expect(c.reparticaoItens).not.toContain('IBS');
    expect(c.previsaoFR).toBeNull();
    expect(c.previaConv).not.toBeNull();
    expect(c.previaConv!.anexoId).toBe('III');
    expect(c.anexosEfetivosRefs).toEqual(['III']);
    expect(c.mostraRefICMS).toBe(false);
    expect(c.mostraRefISS).toBe(true);
    expect(c.podeVisualizar).toBe(true);
    expect(c.dadosDas!.total).toBeCloseTo(c.dasExib, 10);
  });
});
