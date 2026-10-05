/**
 * simples-projection — adaptadores e ferramentas LLM (Etapa 5).
 */
import { describe, expect, it } from 'vitest';
import { prepararEntradaProjecao } from '@/simples-projection/entrada';
import {
  executarFerramentaProjecao,
  listarFerramentasProjecaoParaModelo,
  specsFerramentasProjecao,
} from '@/simples-projection/ferramentas';
import { emitirAlertasFiscais, montarRelatorioProjecao } from '@/simples-projection/relatorio';
import { simularCenarioDividido } from '@/simples-projection/cenario-dividido';

const HIST_MAE = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'].map((mes) => ({ mes, receita: 100_000 }));
const TOTAL = [
  { mes: '2026-01', receita: 120_000 },
  { mes: '2026-02', receita: 120_000 },
];

describe('entrada — prepararEntradaProjecao', () => {
  it('manual completo => ok com params prontos', async () => {
    const r = await prepararEntradaProjecao({
      mesInicio: '2026-01',
      historicoMae12: HIST_MAE,
      receitaTotalMensal: TOTAL,
      percentualNova: 0.3,
      anexoMae: 'III',
      anexoNova: 'V',
      folha12Mae: 400_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.percentualNova).toBe(0.3);
      expect(r.params.nova.historico12).toEqual([]);
    }
  });

  it('sem receita => erro explícito sem inventar (dados-insuficientes)', async () => {
    const r = await prepararEntradaProjecao({ mesInicio: '2026-01', percentualNova: 0.3, anexoMae: 'III', anexoNova: 'III' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe('dados-insuficientes');
      expect(r.instrucao).toMatch(/receitaTotalMensal|historicoMae12/);
    }
  });

  it('CNPJ com DV inválido => recusa sem rede', async () => {
    let rede = false;
    const r = await prepararEntradaProjecao(
      { mesInicio: '2026-01', cnpjReferencia: '11.222.333/0001-00' },
      { buscarCnpjFn: async () => { rede = true; return {}; } },
    );
    expect(r.ok).toBe(false);
    expect(rede).toBe(false);
    if (!r.ok) expect(r.erro).toBe('cnpj-invalido');
  });

  it('CNPJ válido mas sem receita manual => não inventa (mesmo com cadastro ok)', async () => {
    const r = await prepararEntradaProjecao(
      { mesInicio: '2026-01', cnpjReferencia: '11222333000181', percentualNova: 0.3, anexoMae: 'III', anexoNova: 'III' },
      { buscarCnpjFn: async () => ({ cnpj: '11222333000181', razaoSocial: 'Empresa Fake' }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.instrucao).toMatch(/receitaTotalMensal/);
  });
});

describe('relatorio — contrato de saída', () => {
  it('monta envelope com payback, economia e alertas; insights vazio', () => {
    const base = simularCenarioDividido({
      mesInicio: '2026-01',
      receitaTotalMensal: TOTAL,
      percentualNova: 0.3,
      mae: { anexoId: 'III', folha12: 400_000, historico12: HIST_MAE },
      nova: { anexoId: 'III', folha12: 0, historico12: [] },
    });
    const rel = montarRelatorioProjecao(base.serieMensal, {
      mesInicio: '2026-01',
      percentualNova: 0.3,
      anexoMae: 'III',
      anexoNova: 'III',
    });
    expect(rel.economiaTotal).toBe(base.economiaTotal);
    expect(rel.payback).toEqual(base.payback);
    expect(rel.insightsSugeridos).toEqual([]);
    expect(rel.alertas.some((a) => a.codigo === 'CONSOLIDACAO_RECEITA_GRUPO')).toBe(true);
    expect(emitirAlertasFiscais(base.serieMensal).length).toBeGreaterThan(0);
  });

  it('serie vazia => erro explícito', () => {
    expect(() => montarRelatorioProjecao([], { mesInicio: '2026-01', percentualNova: 0.3, anexoMae: 'III', anexoNova: 'III' })).toThrow(/vazia/);
  });
});

describe('ferramentas LLM — specs e dispatcher', () => {
  it('3 specs estáveis no padrão do projeto + schema OpenAI-compatível', () => {
    const specs = specsFerramentasProjecao();
    expect(specs.map((s) => s.nome)).toEqual(['projetarRBT12', 'simularCenarioDividido', 'prepararEntradaProjecao']);
    for (const s of specs) {
      expect(s.dominio).toBe('simples');
      expect(s.leitura).toBe(true);
      expect(s.guardrail.length).toBeGreaterThan(10);
    }
    const schemas = listarFerramentasProjecaoParaModelo();
    expect(schemas).toHaveLength(3);
    const sim = schemas.find((s) => s.name === 'simularCenarioDividido')!;
    expect(sim.parameters.required).toContain('receitaTotalMensal');
    expect(sim.parameters.type).toBe('object');
  });

  it('dispatcher executa simulação e retorna série coerente', async () => {
    const r = await executarFerramentaProjecao('simularCenarioDividido', {
      mesInicio: '2026-01',
      receitaTotalMensal: TOTAL,
      percentualNova: 0.3,
      anexoMae: 'III',
      anexoNova: 'III',
      historicoMae12: HIST_MAE,
      historicoNova12: [],
    } as never);
    expect(r.ok).toBe(true);
    const dados = r.dados as { serieMensal: unknown[]; payback: unknown; economiaTotal: number };
    expect(dados.serieMensal).toHaveLength(2);
  });

  it('dispatcher: projetarRBT12 puro + ferramenta desconhecida com erro limpo', async () => {
    const r = await executarFerramentaProjecao('projetarRBT12', {
      mesInicio: '2026-01',
      historico12: HIST_MAE,
      projecaoMensal: TOTAL,
    } as never);
    expect(r.ok).toBe(true);
    const err = await executarFerramentaProjecao('inexistente' as never, {});
    expect(err.ok).toBe(false);
    expect(err.erro).toMatch(/desconhecida/);
  });
});
