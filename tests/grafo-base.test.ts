/**
 * GRAFO-01 — build do grafo fiscal: dedupe, PK única, proveniência,
 * revogado filtrado e rebuild idempotente.
 *
 * Núcleo puro de `scripts/build-grafo.mjs` + integridade dos artefatos
 * versionados em `public/base/grafo/` (gerados por `npm run base`).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANO_REFERENCIA,
  GRAFO_VERSAO,
  ORIGENS,
  buildGrafo,
  comProveniencia,
  construirGrafo,
  dedupePorChave,
  ehRevogadoNomenclatura,
  hashGrafo,
  normalizarAnexo,
} from '../scripts/build-grafo.mjs';
import { completarGrafoMeta, semearBaseEmbutida, statusBase } from '@/infrastructure/base/base-service';
import { db } from '@/infrastructure/db/schema';

const ROOT = process.cwd();
const GRAFO_DIR = join(ROOT, 'public', 'base', 'grafo');

/** Fixture mínima exercendo o caminho NCM→CCT→Anexo→Artigo + CNAE→NBS. */
function fixture(): any {
  return {
    nomenclatura: {
      itens: [
        { codigo: '02011000', descricao: 'Carne bovina fresca', dataInicio: '01/04/2022', dataFim: null },
        { codigo: '02011000', descricao: 'Carne bovina fresca (duplicada)', dataInicio: '01/04/2022', dataFim: null },
        { codigo: '39139050', descricao: 'Quitosan extinto', dataInicio: '01/04/2022', dataFim: '30/09/2026' },
      ],
    },
    reforma: {
      ncm: [{ codigo: '02011000', cst: '200', cClassTrib: '200003' }],
      nbs: [{ codigo: '122011100', cst: '200', cClassTrib: '200028', descricao: 'Serviços de educação' }],
    },
    referencia: {
      itens: [
        { cst: '200', cClassTrib: '200003', descricao: 'Redução cesta', pRedIBS: 100, pRedCBS: 100, anexo: '1' },
        { cst: '200', cClassTrib: '200028', descricao: 'Educação', pRedIBS: 60, pRedCBS: 60, anexo: '2' },
      ],
    },
    cnae: { itens: [{ codigo7: '8599601', descricao: 'Ensino instrumental' }] },
    cnaeNbs: {
      links: [
        { cnae7: '8599601', nbs: '122011100', fonte: 'por_codigo' },
        { cnae7: '8599601', nbs: '122011100', fonte: 'por_codigo' },
      ],
      lcNbs: [],
    },
    conhecimento: {
      sinonimos: { 'carne bovina': 'bovina' },
      pins: [{ ncm: '02011000', termos: ['picanha'] }],
      pesoSinonimo: 0.85,
      artigos: [{ numero: '125', titulo: 'Art. 125 — Cesta básica', anexo: 'I' }],
    },
  };
}

describe('grafo-base — núcleo puro', () => {
  it('dedupe: NCM duplicado vira um nó; link duplicado vira uma aresta', () => {
    const { nodos, arestas } = construirGrafo(fixture());
    expect(nodos.filter((n) => n.id === 'NCM:02011000')).toHaveLength(1);
    expect(arestas.filter((a) => a.tipo === 'MAPEIA')).toHaveLength(1);
  });

  it('dedupePorChave preserva a primeira ocorrência e conta repetidos', () => {
    const { unicos, duplicados } = dedupePorChave<{ c: string; v: number }>(
      [{ c: 'a', v: 1 }, { c: 'a', v: 2 }, { c: 'b', v: 3 }],
      (x) => x.c,
    );
    expect(unicos).toHaveLength(2);
    expect(unicos[0].v).toBe(1);
    expect(duplicados).toBe(1);
  });

  it('PK única: nenhum id de nó se repete', () => {
    const { nodos } = construirGrafo(fixture());
    const ids = nodos.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('proveniência: toda aresta tem origem válida + confiança [0,1]', () => {
    const { arestas } = construirGrafo(fixture());
    expect(arestas.length).toBeGreaterThan(0);
    for (const a of arestas) {
      expect(ORIGENS, `aresta ${a.tipo} sem origem válida`).toContain(a.origem);
      expect(a.confianca).toBeGreaterThanOrEqual(0);
      expect(a.confianca).toBeLessThanOrEqual(1);
    }
  });

  it('proveniência: TEM_CLASSIFICACAO/MAPEIA carregam anoReferencia; caminho fiscal completo existe', () => {
    const { arestas } = construirGrafo(fixture());
    const tipos = new Set(arestas.map((a) => a.tipo));
    for (const t of ['PERTENCE_A', 'TEM_CLASSIFICACAO', 'REDUZ_PARA', 'FUNDAMENTA_EM', 'MAPEIA', 'SINONIMO_DE']) {
      expect(tipos, `falta relação ${t}`).toContain(t);
    }
    for (const a of arestas.filter((x) => ['TEM_CLASSIFICACAO', 'MAPEIA'].includes(x.tipo))) {
      expect(a.anoReferencia).toBe(ANO_REFERENCIA);
    }
    // Caminho auditável NCM→CCT→Anexo→Artigo no fixture.
    const t1 = arestas.find((a) => a.de === 'NCM:02011000' && a.tipo === 'TEM_CLASSIFICACAO');
    expect(t1?.para).toBe('CCT:200003');
    const t2 = arestas.find((a) => a.de === 'CCT:200003' && a.tipo === 'REDUZ_PARA');
    expect(t2?.para).toBe('Anexo:I');
    const t3 = arestas.find((a) => a.de === 'Anexo:I' && a.tipo === 'FUNDAMENTA_EM');
    expect(t3?.para).toBe('ArtigoLC214:125');
  });

  it('comProveniencia é fail-closed: origem/confiança inválida lança', () => {
    expect(() => comProveniencia('inventada', 0.5)).toThrow();
    expect(() => comProveniencia('por_codigo', 2)).toThrow();
    expect(() => comProveniencia('por_codigo', -1)).toThrow();
    expect(comProveniencia('por_codigo', 1)).toMatchObject({ origem: 'por_codigo', confianca: 1 });
  });

  it('revogado filtrado: item com dataFim nunca vira nó NCM', () => {
    expect(ehRevogadoNomenclatura({ dataFim: '30/09/2026' })).toBe(true);
    expect(ehRevogadoNomenclatura({ dataFim: null })).toBe(false);
    expect(ehRevogadoNomenclatura({})).toBe(false);
    const { nodos, relatorio } = construirGrafo(fixture());
    expect(nodos.some((n) => n.id === 'NCM:39139050')).toBe(false);
    expect(relatorio.revogadosFiltrados).toBe(1);
  });

  it('normalizarAnexo: "1"→"I", "9"→"IX", código 5 dígitos intacto', () => {
    expect(normalizarAnexo('1')).toBe('I');
    expect(normalizarAnexo('9')).toBe('IX');
    expect(normalizarAnexo('90111')).toBe('90111');
  });

  it('sem CCT fantasma: referência sem cClassTrib não cria nó `CCT:000000`', () => {
    const f = fixture();
    f.referencia.itens.push({ cst: '000', descricao: 'sem código' });
    const { nodos } = construirGrafo(f);
    expect(nodos.some((n) => n.id === 'CCT:000000')).toBe(false);
  });

  it('rebuild idempotente: mesma entrada → mesmos bytes → mesmo hash', () => {
    const f = fixture();
    const a = construirGrafo(f);
    const b = construirGrafo(JSON.parse(JSON.stringify(f)));
    expect(hashGrafo(a.nodos, a.arestas)).toBe(hashGrafo(b.nodos, b.arestas));
    expect(JSON.stringify(a.nodos)).toBe(JSON.stringify(b.nodos));
    expect(JSON.stringify(a.arestas)).toBe(JSON.stringify(b.arestas));
  });
});

describe('grafo-base — artefatos versionados', () => {
  it('public/base/grafo/ contém .lbug + espelho .json + MANIFEST.grafo', () => {
    for (const f of ['grafo.lbug', 'grafo.lbug.json', 'MANIFEST.grafo.json']) {
      expect(existsSync(join(GRAFO_DIR, f)), `${f} ausente — rode npm run base`).toBe(true);
    }
  });

  it('MANIFEST.grafo íntegro: hash recomputado do payload + contadores', () => {
    const m = JSON.parse(readFileSync(join(GRAFO_DIR, 'MANIFEST.grafo.json'), 'utf8'));
    expect(m.versao).toBe(GRAFO_VERSAO);
    expect(m.embedding).toBe('ausente');
    expect(m.nodos).toBeGreaterThan(1000);
    expect(m.arestas).toBeGreaterThan(1000);
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    const payload = JSON.parse(readFileSync(join(GRAFO_DIR, 'grafo.lbug.json'), 'utf8'));
    expect(hashGrafo(payload.nodos, payload.arestas)).toBe(m.hash);
    expect(payload.nodos.length).toBe(m.nodos);
    expect(payload.arestas.length).toBe(m.arestas);
    // PK única também na base real.
    const ids = payload.nodos.map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Revogado real (Quitosan 3913.90.50, extinto Res Gecex 926/2026) fora do grafo.
    expect(ids).not.toContain('NCM:39139050');
  });

  it('rebuild com hash inalterado é ignorado (skipped)', async () => {
    const r1 = await buildGrafo();
    const r2 = await buildGrafo();
    expect(r2.skipped).toBe(true);
    expect(r2.hash).toBe(r1.hash);
  }, 60_000);
});

describe('grafo-base — Dexie grafometa + statusBase', () => {
  it('semear grava o carimbo em grafometa; statusBase expõe grafo; sem clear fiscal', async () => {
    const BASE_DIR = join(ROOT, 'public', 'base');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (entrada: unknown) => {
      const nome = String(entrada).replace(/^base\//, '');
      const conteudo = readFileSync(join(BASE_DIR, nome), 'utf8');
      return { ok: true, status: 200, text: async () => conteudo };
    }) as unknown as typeof fetch;

    try {
      const esperado = JSON.parse(readFileSync(join(GRAFO_DIR, 'MANIFEST.grafo.json'), 'utf8'));
      const status = await semearBaseEmbutida(() => {}, true);
      // Carimbo fiel ao MANIFEST.grafo.json.
      expect(status.grafo).toMatchObject({
        nodos: esperado.nodos,
        arestas: esperado.arestas,
        hash: esperado.hash,
        versao: esperado.versao,
      });
      const registro = await db.grafometa.get('atual');
      expect(registro).toMatchObject({ id: 'atual', hash: esperado.hash });
      // Stores fiscais intactas (reseed sem clear indevido).
      expect(status.ncm).toBeGreaterThan(2000);
      expect(status.nomenclatura).toBeGreaterThan(15000);
      expect(status.cnae).toBe(1090);
      // Caminho rápido (sem forçar): top-up mantém o carimbo.
      expect(await completarGrafoMeta()).toBe(true);
      const status2 = await statusBase();
      expect(status2.grafo?.hash).toBe(esperado.hash);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 120_000);
});
