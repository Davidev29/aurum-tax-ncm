import { describe, expect, it } from 'vitest';
import { detectarIntencaoChat, ehPedidoProjecaoDividida } from '@/domain/services/detector-chat';
import { extrairPercentualNova, reconstruirEstadoProjecao, responderProjecaoDividida } from '@/application/aurum-ai-projecao';
import { ferramentasParaIntencao } from '@/application/aurum-ai-registro-ferramentas';
import { toolParaIntencao } from '@/application/aurum-ai-tools';

describe('projecao dividida — caso reportado', () => {
  it('detecta pedido de projecao (nao cai em generico/ncm)', () => {
    expect(ehPedidoProjecaoDividida('consegue dividir o faturamento em duas empresas?')).toBe(true);
    expect(ehPedidoProjecaoDividida('voce sabe fazer uma comparação financeira pra mim saber se é melhor abrir uma nova empresa?')).toBe(true);
    expect(detectarIntencaoChat('consegue dividir o faturamento em duas empresas?').intencao).toBe('projecao');
  });

  it('roteamento de ferramentas inclui o motor', () => {
    expect(ferramentasParaIntencao('projecao')).toContain('simularCenarioDividido');
    expect(toolParaIntencao('projecao')).toBe('simularCenarioDividido');
  });

  it('extrai percentual da nova', () => {
    expect(extrairPercentualNova('30% na nova')).toBe(0.3);
    expect(extrairPercentualNova('meio a meio')).toBe(0.5);
  });

  it('sem numeros pergunta em vez de simular (nunca NCM)', () => {
    const r = responderProjecaoDividida('consegue dividir o faturamento em duas empresas?', []);
    expect(r.texto).toMatch(/Projeção mãe × nova/);
    expect(r.texto).not.toMatch(/NCM 7607|7607\.11/);
  });

  it('com numeros completos simula e da veredito', () => {
    const r = responderProjecaoDividida(
      'RBT12 1,2 milhão, receita 120 mil por mês, 30% na nova, mãe no III e nova no III',
      [],
    );
    expect(r.texto).toMatch(/veredito|Compensa|Não compensa|Empate/);
    expect(r.texto).toMatch(/Mês a mês/);
    expect(r.fontes.join(' ')).toMatch(/simples-projection/);
  });

  it('reconstrucao herda contexto da conversa', () => {
    const s = reconstruirEstadoProjecao('30% na nova, ambas no III', ['RBT12 1,2 milhão', 'receita 120 mil por mês']);
    expect(s.rbt12).toBe(1200000);
    expect(s.receitaMes).toBe(120000);
    expect(s.percentualNova).toBe(0.3);
    expect(s.anexoMae).toBe('III');
  });
});
