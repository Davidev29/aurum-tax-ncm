/**
 * Fator R obrigatório — guarda pura de domínio (PROPOSTA §3.2/§3.3).
 * Coleta obrigatória em I–V; cálculo efetivo só em atividade sujeita.
 */
import { describe, expect, it } from 'vitest';
import { fatorR } from '@/domain/simples/nucleo';
import {
  exigirFolha12,
  validarFolhaObrigatoria,
  type ParamsValidacaoFatorR,
} from '@/domain/simples/validacao';

const base: ParamsValidacaoFatorR = {
  rbt12: 300_000,
  folha12: 100_000,
  anexos: ['V'],
};

describe('validarFolhaObrigatoria — presença da folha', () => {
  it('null/undefined => folha12-ausente com mensagem pronta para toast', () => {
    for (const folha12 of [null, undefined]) {
      const r = validarFolhaObrigatoria({ ...base, folha12 });
      expect(r.ok).toBe(false);
      expect(r.codigo).toBe('folha12-ausente');
      expect(r.mensagem).toContain('folha de salários dos últimos 12 meses');
      expect(r.aplicavel).toBe(true);
    }
  });

  it('NaN, Infinity e negativo => folha12-invalida', () => {
    for (const folha12 of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const r = validarFolhaObrigatoria({ ...base, folha12 });
      expect(r.ok).toBe(false);
      expect(r.codigo).toBe('folha12-invalida');
      expect(r.mensagem).toContain('maior ou igual a zero');
    }
  });

  it('zero sem confirmação => ausente; com confirmação => ok', () => {
    const semConfirmar = validarFolhaObrigatoria({ ...base, folha12: 0 });
    expect(semConfirmar.ok).toBe(false);
    expect(semConfirmar.codigo).toBe('folha12-ausente');
    expect(semConfirmar.mensagem).toContain('Folha 12m zerada');

    const confirmada = validarFolhaObrigatoria({ ...base, folha12: 0, semFolhaConfirmado: true });
    expect(confirmada.ok).toBe(true);
    expect(confirmada.codigo).toBeUndefined();
  });

  it('folhaInformada=true também marca zero como informado (compatibilidade de flag)', () => {
    const r = validarFolhaObrigatoria({ ...base, folha12: 0, folhaInformada: true });
    expect(r.ok).toBe(true);
    expect(r.aplicavel).toBe(true);
  });

  it('folha > 0 conta como informada sem nenhuma flag', () => {
    expect(validarFolhaObrigatoria({ ...base, folhaInformada: false }).ok).toBe(true);
  });

  it('rbt12 <= 0, NaN ou ausente => rbt12-invalido', () => {
    for (const rbt12 of [0, -1, Number.NaN, null, undefined]) {
      const r = validarFolhaObrigatoria({ ...base, rbt12 });
      expect(r.ok).toBe(false);
      expect(r.codigo).toBe('rbt12-invalido');
      expect(r.mensagem).toContain('RBT12');
    }
  });
});

describe('validarFolhaObrigatoria — sujeição (aplicavel)', () => {
  it('Anexo I: folha é obrigatória mas não altera alíquota', () => {
    const r = validarFolhaObrigatoria({ ...base, anexos: ['I'] });
    expect(r.ok).toBe(true);
    expect(r.aplicavel).toBe(false);
    expect(r.origemNaoAplicavel).toBe('anexo-sem-fator-r');
    expect(r.mensagem).toContain('não altera a alíquota');
  });

  it('Anexo III puro com sujeitaFatorR:false => origem iii-puro', () => {
    const r = validarFolhaObrigatoria({ ...base, anexos: ['III'], sujeitaFatorR: false });
    expect(r.ok).toBe(true);
    expect(r.aplicavel).toBe(false);
    expect(r.origemNaoAplicavel).toBe('iii-puro');
    expect(r.mensagem).toContain('não altera o enquadramento');
  });

  it('III/V com sujeitaFatorR:false => nao-sujeito (registrado, sem efeito)', () => {
    const r = validarFolhaObrigatoria({ ...base, anexos: ['III', 'V'], sujeitaFatorR: false });
    expect(r.aplicavel).toBe(false);
    expect(r.origemNaoAplicavel).toBe('nao-sujeito');
    expect(r.mensagem).toContain('sem efeito');
  });

  it('CNAE com fatorR em anexo I é sujeito', () => {
    const r = validarFolhaObrigatoria({ ...base, anexos: ['I'], cnaeFatorR: true });
    expect(r.aplicavel).toBe(true);
    expect(r.origemNaoAplicavel).toBeUndefined();
  });

  it('aceita formatos legados de anexos', () => {
    expect(validarFolhaObrigatoria({ ...base, anexos: ['III / V'] }).aplicavel).toBe(true);
    expect(validarFolhaObrigatoria({ ...base, anexos: ['iii,v'] }).aplicavel).toBe(true);
    expect(validarFolhaObrigatoria({ ...base, anexos: ['II'] }).aplicavel).toBe(false);
  });
});

describe('fronteira 28% do Fator R', () => {
  it('exatamente 28% => III; um centavo abaixo => V', () => {
    const rbt12 = 300_000;
    const limite = fatorR(84_000, rbt12); // 28% de 300.000
    expect(limite.indice).toBeCloseTo(0.28, 10);
    expect(limite.anexo).toBe('III');
    expect(fatorR(83_999.99, rbt12).anexo).toBe('V');
  });

  it('a validação não bloqueia a fronteira e marca sujeição', () => {
    const r = validarFolhaObrigatoria({ ...base, folha12: 84_000, anexos: ['V'] });
    expect(r.ok).toBe(true);
    expect(r.aplicavel).toBe(true);
  });
});

describe('exigirFolha12', () => {
  it('lança Error com prefixo de código no padrão de exigirRbtReceita', () => {
    expect(() => exigirFolha12({ ...base, folha12: null })).toThrow(/^folha12-ausente:/);
    expect(() => exigirFolha12({ ...base, folha12: Number.NaN })).toThrow(/^folha12-invalida:/);
    expect(() => exigirFolha12({ ...base, rbt12: 0 })).toThrow(/^rbt12-invalido:/);
  });

  it('devolve o número normalizado quando a folha é válida', () => {
    expect(exigirFolha12({ ...base, folha12: 100_000 })).toBe(100_000);
    expect(exigirFolha12({ ...base, folha12: 0, semFolhaConfirmado: true })).toBe(0);
  });
});
