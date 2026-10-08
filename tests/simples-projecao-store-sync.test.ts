/**
 * Sincronia automática dos steps: digitar total distribui sem clique,
 * global replica sem clique, histórico acompanha mesInicio, manual ↔
 * automático sem perda, edição manual de mês vira modo mensal.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useProjecaoDividida } from '@/simples-projection/store';

const CTX = {
  cnpj: '11222333000181',
  empresaNome: 'Empresa Teste',
  opcaoSimples: true,
  cnaeEscolhido: '6201500',
  anexoSugerido: 'III' as const,
  rbt12: 1_200_000,
  receitaMes: 100_000,
  folha12: 0,
};

beforeEach(() => {
  useProjecaoDividida.getState().abrir(CTX);
});

describe('steps automáticos — RTB12', () => {
  it('digitar rtb12Total distribui nos 12 meses sem botão', () => {
    useProjecaoDividida.getState().set({ rtb12Total: 600_000 });
    const s = useProjecaoDividida.getState();
    expect(s.historicoMae12).toHaveLength(12);
    const soma = s.historicoMae12.reduce((a, r) => a + r.receita, 0);
    expect(soma).toBeCloseTo(600_000, 2);
  });

  it('trocar a curva redistribui o total atual', () => {
    const antes = useProjecaoDividida.getState().historicoMae12.map((r) => r.receita);
    useProjecaoDividida.getState().set({ curvaDistribuicao: 'crescente' });
    const depois = useProjecaoDividida.getState().historicoMae12.map((r) => r.receita);
    expect(depois).not.toEqual(antes);
    const soma = depois.reduce((a, v) => a + v, 0);
    expect(soma).toBeCloseTo(1_200_000, 2);
  });

  it('editar mês manual atualiza o total (sem perda ao alternar modos)', () => {
    const primeiro = useProjecaoDividida.getState().historicoMae12[0]!;
    useProjecaoDividida.getState().setHistoricoMaeMes(primeiro.mes, 50_000);
    const s = useProjecaoDividida.getState();
    const soma = s.historicoMae12.reduce((a, r) => a + r.receita, 0);
    expect(s.rtb12Total).toBeCloseTo(soma, 2);
  });

  it('mesInicio novo realinha o histórico (sem meses estranhos)', () => {
    useProjecaoDividida.getState().set({ mesInicio: '2026-05' });
    const s = useProjecaoDividida.getState();
    expect(s.historicoMae12).toHaveLength(12);
    expect(s.historicoMae12[0]!.mes).toBe('2025-05');
    expect(s.historicoMae12[11]!.mes).toBe('2026-04');
  });
});

describe('steps automáticos — projeção', () => {
  it('digitar receitaGlobal replica nos meses sem botão', () => {
    useProjecaoDividida.getState().set({ modoReceita: 'global', receitaGlobal: 80_000 });
    const s = useProjecaoDividida.getState();
    expect(s.receitaTotalMensal).toHaveLength(12);
    expect(s.receitaTotalMensal.every((r) => r.receita === 80_000)).toBe(true);
  });

  it('editar mês manual vira modo mensal (global não sobrescreve)', () => {
    useProjecaoDividida.getState().set({ modoReceita: 'global', receitaGlobal: 80_000 });
    const alvo = useProjecaoDividida.getState().receitaTotalMensal[0]!;
    useProjecaoDividida.getState().setReceitaMes(alvo.mes, 10_000);
    const s = useProjecaoDividida.getState();
    expect(s.modoReceita).toBe('mensal');
    expect(s.receitaTotalMensal.find((r) => r.mes === alvo.mes)!.receita).toBe(10_000);
  });

  it('puxarMediaHistorico preenche a projeção com a média', () => {
    useProjecaoDividida.getState().set({ rtb12Total: 600_000 });
    useProjecaoDividida.getState().puxarMediaHistorico();
    const s = useProjecaoDividida.getState();
    expect(s.receitaTotalMensal.every((r) => r.receita === 50_000)).toBe(true);
    expect(s.receitaGlobal).toBe(50_000);
  });

  it('abrir com receita zerada usa a média do RBT12 (steps nunca vazios)', () => {
    useProjecaoDividida.getState().abrir({ ...CTX, receitaMes: 0 });
    const s = useProjecaoDividida.getState();
    expect(s.receitaTotalMensal.every((r) => r.receita === 100_000)).toBe(true);
  });

  it('início padrão é a competência em curso (mês atual dinâmico)', () => {
    const d = new Date();
    const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    useProjecaoDividida.getState().abrir(CTX);
    expect(useProjecaoDividida.getState().mesInicio).toBe(esperado);
  });

  it('editar mês distribuído vira modo manual (protege ajuste fino)', () => {
    useProjecaoDividida.getState().set({ modoRTB12: 'automatico', rtb12Total: 600_000 });
    const primeiro = useProjecaoDividida.getState().historicoMae12[0]!;
    useProjecaoDividida.getState().setHistoricoMaeMes(primeiro.mes, 1_000);
    const s = useProjecaoDividida.getState();
    expect(s.modoRTB12).toBe('manual');
    expect(s.historicoMae12.find((r) => r.mes === primeiro.mes)!.receita).toBe(1_000);
  });

  it('receita do mês atual semeia a projeção intocada', () => {
    useProjecaoDividida.getState().set({ receitaMesAtual: 77_000 });
    const s = useProjecaoDividida.getState();
    expect(s.receitaTotalMensal.every((r) => r.receita === 77_000)).toBe(true);
    expect(s.projecaoSuja).toBe(false);
  });

  it('semeadura não sobrescreve projeção editada', () => {
    const alvo = useProjecaoDividida.getState().receitaTotalMensal[0]!;
    useProjecaoDividida.getState().setReceitaMes(alvo.mes, 11_000);
    useProjecaoDividida.getState().set({ receitaMesAtual: 99_000 });
    const s = useProjecaoDividida.getState();
    expect(s.projecaoSuja).toBe(true);
    expect(s.receitaTotalMensal.find((r) => r.mes === alvo.mes)!.receita).toBe(11_000);
  });

  it('usarReceitaAtualComoBase preserva o histórico digitado', () => {
    const primeiro = useProjecaoDividida.getState().historicoMae12[0]!;
    useProjecaoDividida.getState().setHistoricoMaeMes(primeiro.mes, 7_000);
    useProjecaoDividida.getState().usarReceitaAtualComoBase();
    const s = useProjecaoDividida.getState();
    expect(s.historicoMae12.find((r) => r.mes === primeiro.mes)!.receita).toBe(7_000);
  });
});
