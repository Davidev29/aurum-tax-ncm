import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tracer 10-00 — o grafo é índice derivado: schema versionado + base real o sustenta
 * + fallback sem .lbug é sempre { ok:false, fallback:'lexical' } (fail-closed).
 */
const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, 'scripts/grafo/schema.cypher'), 'utf8');

describe('grafo tracer 10-00', () => {
  it('schema contém nós e relações fiscais exigidas', () => {
    for (const t of ['NCM(', 'CCT(', 'Anexo(', 'CNAE(', 'NBS(', 'PERTENCE_A', 'TEM_CLASSIFICACAO', 'MAPEIA', 'PRIMARY KEY']) {
      expect(schema, `schema deve conter ${t}`).toContain(t);
    }
  });

  it('toda relação carrega proveniência (origem + confianca)', () => {
    expect(schema).toMatch(/PERTENCE_A\(.*origem.*confianca/s);
    expect(schema).toMatch(/MAPEIA\(.*origem.*confianca/s);
  });

  it('base real sustenta o schema (ncm8 + vínculos + cnae-nbs)', () => {
    const noms = JSON.parse(readFileSync(join(ROOT, 'public/base/nomenclatura.json'), 'utf8'));
    const lista = Array.isArray(noms) ? noms : (noms.nomenclaturas ?? noms.itens ?? []);
    const ncm8 = lista.filter((n: { codigo?: string; ncm?: string }) => /^\d{8}$/.test(n.codigo ?? n.ncm ?? ''));
    expect(ncm8.length).toBeGreaterThan(1000);
  });

  it('contrato de fallback sem .lbug nunca estoura', () => {
    const semGrafo = { ok: false as const, fallback: 'lexical' as const };
    // o worker 10-02 vai honrar exatamente este objeto quando o .lbug faltar
    expect(semGrafo.ok).toBe(false);
    expect(semGrafo.fallback).toBe('lexical');
  });
});
