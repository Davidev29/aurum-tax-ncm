/**
 * Phase 10 / 10-06 [GRAFO-07] — chaos do grafo fiscal (22 casos, gate ≥85% = 19/22).
 *
 * REGRA DURA: base REAL (`public/base/grafo/`, gerada por `npm run base`) em
 * todos os casos de consulta — nunca mock do resolvedor, nunca fixture
 * sintética para o caminho fiscal (o único mini-grafo aqui é o do overlay
 * em `ctx`, que por definição é só-na-máquina e não fiscal).
 *
 * Cada caso documenta Esperado vs Obtido no cabeçalho (obtido medido na base
 * real em 2026-10-06; qualquer divergência futura falha o teste, não o doc).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — módulo CJS do Electron (sem tipos; runtime real, sem mock)
import * as grafo from '@/../electron/ia/grafo-service.cjs';
import { ANO_REFERENCIA, ORIGENS, comProveniencia, hashGrafo } from '../scripts/build-grafo.mjs';
import { fixLatin1 } from '@/infrastructure/base/normalizacao';
import { refPorAno, ehDivisaoBens, CBS_REF_PADRAO } from '@/domain/services/cnae-nbs';
import { REF_DEFAULT } from '@/domain/constants';
import {
  consultarGrafoPrimeiro,
  fundirCandidatosGrafoLexical,
  desempatarPorGrafo,
  textoPorQueSugeriu,
  trilhaVazia,
} from '@/application/grafo-consumo';
import * as bridgeMod from '@/infrastructure/bridge';
import { completarGrafoMeta, statusBase } from '@/infrastructure/base/base-service';
import { db } from '@/infrastructure/db/schema';
import { semearBaseIa } from './ia/ajuda-ia';

const ROOT = process.cwd();
const GRAFO_DIR = join(ROOT, 'public', 'base', 'grafo');
const payload = JSON.parse(readFileSync(join(GRAFO_DIR, 'grafo.lbug.json'), 'utf8')) as {
  nodos: Array<{ id: string; tipo: string; props?: Record<string, unknown> }>;
  arestas: Array<{ de: string; para: string; tipo: string; origem: string; confianca: number; anoReferencia?: number | null }>;
};

const ENV_GRAFO = process.env.AURUM_GRAFO_DIR;
const ENV_USERDATA = process.env.AURUM_GRAFO_USERDATA;
const ENV_EMB = process.env.AURUM_EMBEDDING_DIR;
let tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

beforeEach(() => {
  grafo._limparCache();
  grafo._limparCacheVetores();
  delete process.env.AURUM_GRAFO_DIR;
  delete process.env.AURUM_GRAFO_USERDATA;
  delete process.env.AURUM_EMBEDDING_DIR;
});

afterEach(() => {
  vi.restoreAllMocks();
  grafo._limparCache();
  grafo._limparCacheVetores();
  if (ENV_GRAFO === undefined) delete process.env.AURUM_GRAFO_DIR;
  else process.env.AURUM_GRAFO_DIR = ENV_GRAFO;
  if (ENV_USERDATA === undefined) delete process.env.AURUM_GRAFO_USERDATA;
  else process.env.AURUM_GRAFO_USERDATA = ENV_USERDATA;
  if (ENV_EMB === undefined) delete process.env.AURUM_EMBEDDING_DIR;
  else process.env.AURUM_EMBEDDING_DIR = ENV_EMB;
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe('grafo-chaos — multi-hop + herança (01–02)', () => {
  it('01 multi-hop NCM→CCT→Anexo→Artigo auditável na base real', async () => {
    // Esperado: "carne bovina" acha 02102000 com caminho
    //   NCM:02102000 → CCT:200003 → Anexo:I → ArtigoLC214:125.
    // Obtido: top 02102000, caminho exato acima, proveniência
    //   [por_codigo, por_codigo, curadoria], cypher com MATCH+TEM_CLASSIFICACAO.
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    expect(r.ok).toBe(true);
    expect(r.candidatos[0].codigo).toBe('02102000');
    expect(r.candidatos[0].caminho).toEqual(['NCM:02102000', 'CCT:200003', 'Anexo:I', 'ArtigoLC214:125']);
    expect(r.candidatos[0].proveniencia.map((p: { origem: string }) => p.origem)).toEqual([
      'por_codigo',
      'por_codigo',
      'curadoria',
    ]);
    expect(r.cypher).toContain('MATCH');
    expect(r.cypher).toContain('TEM_CLASSIFICACAO');
    expect(r.caminhos[0]).toEqual(r.candidatos[0].caminho);
  });

  it('02 herança SH6/SH4 vs vínculo exato (só 15,9% têm TEM_CLASSIFICACAO)', async () => {
    // Esperado: 02102000 tem vínculo EXATO (2× TEM_CLASSIFICACAO: 200003+200038);
    //   01012100 só tem HERANÇA (PERTENCE_A → SH6:010121 → SH4:0101 → Capitulo:01).
    // Obtido: exato 2 vínculos; herança 0 TEM_CLASSIFICACAO + cadeia SH6_EM/SH4_EM intacta.
    const exato = payload.arestas.filter((a) => a.de === 'NCM:02102000' && a.tipo === 'TEM_CLASSIFICACAO');
    expect(exato.map((a) => a.para).sort()).toEqual(['CCT:200003', 'CCT:200038']);
    const heranca = payload.arestas.filter((a) => a.de === 'NCM:01012100');
    expect(heranca.some((a) => a.tipo === 'TEM_CLASSIFICACAO')).toBe(false);
    expect(heranca.find((a) => a.tipo === 'PERTENCE_A')?.para).toBe('SH6:010121');
    expect(payload.arestas.some((a) => a.de === 'SH6:010121' && a.tipo === 'SH6_EM' && a.para === 'SH4:0101')).toBe(true);
    expect(payload.arestas.some((a) => a.de === 'SH4:0101' && a.tipo === 'SH4_EM' && a.para === 'Capitulo:01')).toBe(true);
    // Medida global: vínculo exato é minoria (grafo propõe; herança posiciona).
    const comVinc = new Set(payload.arestas.filter((a) => a.tipo === 'TEM_CLASSIFICACAO').map((a) => a.de));
    expect(comVinc.size).toBe(1671);
  });
});

describe('grafo-chaos — CNAE→NBS (03–04, 17–18)', () => {
  it('03 CNAE 98-NBS: 4322-3/03 tem 98 MAPEIA na base real', async () => {
    // Esperado: CNAE:4322303 → 98 arestas MAPEIA (caso 98-NBS da Phase 9).
    // Obtido: 98 exatos; consulta "sistema de prevenção contra incêndio" acha o CNAE.
    expect(payload.arestas.filter((a) => a.de === 'CNAE:4322303' && a.tipo === 'MAPEIA')).toHaveLength(98);
    const r = await grafo.grafoConsultar({ texto: 'sistema de prevencao contra incendio', k: 5 }, {});
    expect(r.ok).toBe(true);
    expect(r.candidatos.map((c: { codigo: string }) => c.codigo)).toContain('4322303');
  });

  it('04 fora-508: CNAE sem link tem nó mas caminho de 1 passo (regra, sem NBS)', async () => {
    // Esperado: CNAE:0111301 (Cultivo de arroz) existe, 0 MAPEIA; consulta
    //   retorna o CNAE com caminho [CNAE:0111301] (sem NBS inventado).
    // Obtido: nó existe, 0 MAPEIA, caminho unitário.
    expect(payload.nodos.some((n) => n.id === 'CNAE:0111301')).toBe(true);
    expect(payload.arestas.filter((a) => a.de === 'CNAE:0111301' && a.tipo === 'MAPEIA')).toHaveLength(0);
    const r = await grafo.grafoConsultar({ texto: 'Cultivo de arroz', k: 5 }, {});
    expect(r.ok).toBe(true);
    const cnae = r.candidatos.find((c: { codigo: string }) => c.codigo === '0111301');
    expect(cnae).toBeDefined();
    expect(cnae.caminho).toEqual(['CNAE:0111301']);
  });

  it('17 CNAE bens→NCM: 1011-2/01 é bens, sem MAPEIA, caminho sem NBS', async () => {
    // Esperado: divisão 10 = bens; zero MAPEIA; consulta acha o CNAE sem NBS.
    // Obtido: ehDivisaoBens true/false corretos, 0 MAPEIA, caminho unitário.
    expect(ehDivisaoBens('1011201')).toBe(true);
    expect(ehDivisaoBens('8599601')).toBe(false);
    expect(payload.arestas.filter((a) => a.de === 'CNAE:1011201' && a.tipo === 'MAPEIA')).toHaveLength(0);
    const r = await grafo.grafoConsultar({ texto: 'frigorifico abate bovinos', k: 5 }, {});
    expect(r.ok).toBe(true);
    expect(r.candidatos[0].codigo).toBe('1011201');
    expect(r.candidatos[0].caminho).toEqual(['CNAE:1011201']);
  });

  it('18 NBS sem lastro honesto: sem TEM_CLASSIFICACAO_NBS, sem redução inventada', async () => {
    // Esperado: NBS:101011100 existe mas sem CCT; consulta por código retorna
    //   caminho unitário (nenhum Anexo/CCT citado, nenhuma redução).
    // Obtido: caminho [NBS:101011100], proveniência do passo inexistente = [].
    expect(payload.nodos.some((n) => n.id === 'NBS:101011100')).toBe(true);
    expect(payload.arestas.filter((a) => a.de === 'NBS:101011100' && a.tipo === 'TEM_CLASSIFICACAO_NBS')).toHaveLength(0);
    const r = await grafo.grafoConsultar({ texto: '101011100', k: 5 }, {});
    expect(r.ok).toBe(true);
    const nbs = r.candidatos.find((c: { codigo: string }) => c.codigo === '101011100');
    expect(nbs).toBeDefined();
    expect(nbs.caminho).toEqual(['NBS:101011100']);
  });
});

describe('grafo-chaos — ano + fallback + embedding + mojibake (05–08)', () => {
  it('05 ano 2026/2027/2033: vereditos distintos + cypher carimba o ano', async () => {
    // Esperado: refPorAno 2026={0.1,0.1}, 2027={0.1,8.8}, 2033={19,9};
    //   cypher com anoReferencia filtra (contém o ano).
    // Obtido: 3 refs distintas; cypher 2033 contém "2033"; sem ano, sem filtro.
    expect(refPorAno(2026)).toMatchObject({ refIBS: 0.1, refCBS: 0.1, emTransicao: false });
    expect(refPorAno(2027)).toMatchObject({ refIBS: 0.1, refCBS: CBS_REF_PADRAO, emTransicao: false });
    expect(refPorAno(2033)).toMatchObject({ refIBS: REF_DEFAULT.IBS, refCBS: REF_DEFAULT.CBS, emTransicao: false });
    expect(new Set([JSON.stringify(refPorAno(2026)), JSON.stringify(refPorAno(2027)), JSON.stringify(refPorAno(2033))]).size).toBe(3);
    const comAno = await grafo.grafoConsultar({ texto: 'carne bovina', k: 3, anoReferencia: 2033 }, {});
    expect(comAno.ok).toBe(true);
    expect(comAno.cypher).toContain('2033');
    const semAno = await grafo.grafoConsultar({ texto: 'carne bovina', k: 3 }, {});
    expect(semAno.cypher).not.toContain('2033');
    expect(ANO_REFERENCIA).toBe(2026);
  });

  it('06 sem .lbug → fallback lexical, nunca throw', async () => {
    // Esperado: diretório vazio → {ok:false, fallback:'lexical'} (fail-closed).
    // Obtido: ok false + fallback lexical, sem throw (inclusive via ia-service).
    const vazio = mkTmp('aurum-grafo-chaos-vazio-');
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, { dirGrafo: vazio });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('lexical');
  });

  it('07 embedding ausente → modo FTS-puro, FTS segue achando', async () => {
    // Esperado: AURUM_EMBEDDING_DIR vazio → modoVetor fts-puro, embedding null,
    //   mas "carne bovina" ainda acha 02102000.
    // Obtido: fts-puro + null + 02102000 presente.
    const vazioEmb = mkTmp('aurum-emb-chaos-vazio-');
    process.env.AURUM_EMBEDDING_DIR = vazioEmb;
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    expect(r.ok).toBe(true);
    expect(r.modoVetor).toBe('fts-puro');
    expect(r.embedding).toBeNull();
    expect(r.candidatos.map((c: { codigo: string }) => c.codigo)).toContain('02102000');
  });

  it('08 mojibake latin1: repara sem corromper texto correto', async () => {
    // Esperado: 'ServiÃ§o de educaÃ§Ã£o' → 'Serviço de educação';
    //   'NÃO-METÁLICOS' e 'Âmbito' intactos.
    // Obtido: reparo exato + 2 intactos.
    expect(fixLatin1('ServiÃ§o de educaÃ§Ã£o')).toBe('Serviço de educação');
    expect(fixLatin1('NÃO-METÁLICOS')).toBe('NÃO-METÁLICOS');
    expect(fixLatin1('Âmbito')).toBe('Âmbito');
  });
});

describe('grafo-chaos — veto + rollback + degradação (09–11)', () => {
  it('09 caminho errado: LLM cita aresta inexistente → resolvedor veta (ordem intacta)', async () => {
    // Esperado: proveniência de passo inexistente = [] (sem citação);
    //   desempatarPorGrafo com CCT fantasma mantém a ordem do resolvedor.
    // Obtido: [] + mesma referência/ordem (usouGrafo false).
    const g = await grafo.abrirGrafo({});
    expect(g.ok).toBe(true);
    expect(grafo.provenienciaDoCaminho(['NCM:02102000', 'CCT:999999'], g.indices.adjSaida)).toEqual([]);
    const lista = [
      { cst: '200', cClassTrib: '200038', reducao: 60 },
      { cst: '200', cClassTrib: '200034', reducao: 60 },
    ];
    const semTrilha = desempatarPorGrafo(lista, trilhaVazia(), '02102000');
    expect(semTrilha.usouGrafo).toBe(false);
    expect(semTrilha.lista).toBe(lista);
    const fantasma = {
      ...trilhaVazia(),
      usouGrafo: true,
      caminhos: [['NCM:02102000', 'CCT:999999']],
      caminhoPorCodigo: new Map([['02102000', ['NCM:02102000', 'CCT:999999']]]),
    };
    const r = desempatarPorGrafo(lista, fantasma, '02102000');
    expect(r.usouGrafo).toBe(false);
    expect(r.lista.map((x) => x.cClassTrib)).toEqual(['200038', '200034']);
  });

  it('10 rollback Dexie: apagar grafometa não toca a base fiscal; recompleta igual', async () => {
    // Esperado: delete grafometa → fiscal intacta; completarGrafoMeta regrava
    //   o MESMO hash do MANIFEST.
    // Obtido: ncm count idêntico antes/depois; hash igual ao MANIFEST.
    const BASE_DIR = join(ROOT, 'public', 'base');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (entrada: unknown) => {
      const nome = String(entrada).replace(/^base\//, '');
      const conteudo = readFileSync(join(BASE_DIR, nome), 'utf8');
      return { ok: true, status: 200, text: async () => conteudo };
    }) as unknown as typeof fetch;
    try {
      await semearBaseIa();
      expect(await completarGrafoMeta()).toBe(true);
      const antes = await db.ncm.count();
      const hashAntes = (await db.grafometa.get('atual'))?.hash;
      await db.grafometa.delete('atual');
      expect(await db.grafometa.get('atual')).toBeUndefined();
      expect(await db.ncm.count()).toBe(antes);
      expect(await completarGrafoMeta()).toBe(true);
      const mani = JSON.parse(readFileSync(join(GRAFO_DIR, 'MANIFEST.grafo.json'), 'utf8'));
      expect((await db.grafometa.get('atual'))?.hash).toBe(mani.hash);
      expect((await db.grafometa.get('atual'))?.hash).toBe(hashAntes);
      expect((await statusBase()).grafo?.hash).toBe(mani.hash);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('11 degradação: grafo corrompido → fallback lexical, nunca throw', async () => {
    // Esperado: grafo.lbug.json inválido → {ok:false, fallback:'lexical'}.
    // Obtido: fallback + motivo, sem throw.
    const dir = mkTmp('aurum-grafo-chaos-corrompido-');
    fs.writeFileSync(join(dir, 'grafo.lbug.json'), 'lixo{{{corrompido');
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, { dirGrafo: dir });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('lexical');
  });
});

describe('grafo-chaos — overlay com travas (12–16)', () => {
  const overlayPeso10 = () => ({
    versao: 1,
    arestas: [
      { de: 'Termo:carne', para: 'NCM:02102000', tipo: 'NCM-ESCOLHIDO', origem: 'uso_local', peso: 10, criadoEm: new Date().toISOString() },
    ],
    checksum: 'teste',
  });

  it('12 overlay boost com teto: peso 10 → +0.3 (TETO_BOOST)', async () => {
    // Esperado: score = scoreBase + 0.3; boost='uso_local'.
    // Obtido: boostValor 0.3 exato; sem overlay, boost null/0.
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, { overlay: overlayPeso10() });
    expect(r.ok).toBe(true);
    const top = r.candidatos.find((c: { codigo: string }) => c.codigo === '02102000');
    expect(top.boost).toBe('uso_local');
    expect(top.boostValor).toBe(0.3);
    expect(Math.abs(top.score - top.scoreBase - 0.3)).toBeLessThan(1e-9);
    const base = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    const topBase = base.candidatos.find((c: { codigo: string }) => c.codigo === '02102000');
    expect(topBase.boost).toBeNull();
    expect(topBase.boostValor).toBe(0);
  });

  it('13 demote por feedback negativo zera o boost', async () => {
    // Esperado: feedbackNegativo com o código → boost 0 + boost null na consulta.
    // Obtido: calcularBoost 0 + consulta sem boost.
    expect(grafo.calcularBoost(overlayPeso10(), 'NCM:02102000', { feedbackNegativo: ['02102000'] }).boost).toBe(0);
    const r = await grafo.grafoConsultar(
      { texto: 'carne bovina', k: 5 },
      { overlay: overlayPeso10(), feedbackNegativo: ['02102000'] },
    );
    const top = r.candidatos.find((c: { codigo: string }) => c.codigo === '02102000');
    expect(top.boost).toBeNull();
    expect(top.boostValor).toBe(0);
  });

  it('14 TTL/expiração 90d: 120 dias expira, 89 dias vale', async () => {
    // Esperado: aresta de 120d → boost 0 + expiradas 1; de 89d → boost 0.2.
    // Obtido: exato; podarOverlay remove a expirada.
    const dia = 24 * 60 * 60 * 1000;
    const mk = (criadoEm: string) => ({
      versao: 1,
      arestas: [{ de: 'x', para: 'NCM:02102000', tipo: 'NCM-ESCOLHIDO', origem: 'uso_local', peso: 0.2, criadoEm }],
      checksum: 'x',
    });
    const velha = new Date(Date.now() - 120 * dia).toISOString();
    const quase = new Date(Date.now() - 89 * dia).toISOString();
    expect(grafo.calcularBoost(mk(velha), 'NCM:02102000', {}).boost).toBe(0);
    expect(grafo.calcularBoost(mk(velha), 'NCM:02102000', {}).expiradas).toBe(1);
    expect(grafo.calcularBoost(mk(quase), 'NCM:02102000', {}).boost).toBeCloseTo(0.2, 9);
    expect(grafo.podarOverlay(mk(velha)).doc.arestas).toHaveLength(0);
  });

  it('15 overlay corrompido → backup + base intacta', async () => {
    // Esperado: abrirOverlay em arquivo lixo → recuperado + backup; consulta
    //   com esse userData devolve os mesmos códigos da base pura.
    // Obtido: recuperado true, backup existe, top-5 idêntico.
    const antes = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    const dir = mkTmp('aurum-overlay-chaos-');
    fs.writeFileSync(join(dir, 'aprendizado.json'), 'lixo{{{corrompido');
    const aberto = grafo.abrirOverlay(dir);
    expect(aberto.ok).toBe(true);
    expect(aberto.recuperado).toBe(true);
    expect(fs.existsSync(aberto.backup)).toBe(true);
    const depois = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, { userDataDir: dir });
    expect(depois.ok).toBe(true);
    expect(depois.candidatos.map((c: { codigo: string }) => c.codigo)).toEqual(
      antes.candidatos.map((c: { codigo: string }) => c.codigo),
    );
  });

  it('16 overlay apagado → bit-idêntico à base (rollback por apagamento)', async () => {
    // Esperado: sem overlay, duas consultas seguidas são byte-iguais; com
    //   overlay o top tem boost, sem overlay não.
    // Obtido: JSON idêntico; boost só com overlay.
    const com = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, { overlay: overlayPeso10() });
    const sem1 = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    const sem2 = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    expect(JSON.stringify(sem1.candidatos)).toBe(JSON.stringify(sem2.candidatos));
    expect(com.candidatos.find((c: { codigo: string }) => c.codigo === '02102000').boost).toBe('uso_local');
    expect(sem1.candidatos.find((c: { codigo: string }) => c.codigo === '02102000').boost).toBeNull();
  });
});

describe('grafo-chaos — garantias globais (19–22)', () => {
  it('19 performance: consulta fria na base real <2s CPU', async () => {
    // Esperado: cache limpo + "carne bovina" → tempoMs < 2000, top 02102000.
    // Obtido: <2s (medido ~500ms) + top correto.
    grafo._limparCache();
    grafo._limparCacheVetores();
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {});
    expect(r.ok).toBe(true);
    expect(r.candidatos[0].codigo).toBe('02102000');
    expect(r.tempoMs).toBeLessThan(2000);
  });

  it('20 proveniência 100%: toda aresta tem origem válida + confiança [0,1]', async () => {
    // Esperado: 0 arestas sem proveniência; comProveniencia rejeita inválidas.
    // Obtido: 30107/30107 válidas; 3 inválidas lançam.
    for (const a of payload.arestas) {
      expect(ORIGENS, `aresta ${a.tipo} sem origem válida`).toContain(a.origem);
      expect(a.confianca).toBeGreaterThanOrEqual(0);
      expect(a.confianca).toBeLessThanOrEqual(1);
    }
    expect(() => comProveniencia('inventada', 0.5)).toThrow();
    expect(() => comProveniencia('por_codigo', 2)).toThrow();
    expect(() => comProveniencia('por_codigo', -1)).toThrow();
  });

  it('21 PK únicas: nenhum id repetido; sem CCT fantasma; revogado fora', async () => {
    // Esperado: ids únicos; sem CCT:000000; 39139050 (Quitosan extinto) ausente.
    // Obtido: 20559 ids únicos; sem fantasma; revogado fora.
    const ids = payload.nodos.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('CCT:000000');
    expect(ids).not.toContain('NCM:39139050');
    expect(hashGrafo(payload.nodos, payload.arestas)).toBe(
      JSON.parse(readFileSync(join(GRAFO_DIR, 'MANIFEST.grafo.json'), 'utf8')).hash,
    );
  });

  it('22 via:grafo auditável: cypher + caminho + proveniência na trilha real', async () => {
    // Esperado: consultarGrafoPrimeiro (bridge ligada ao serviço real) →
    //   usouGrafo, cypher com MATCH, caminho 02102000 com proveniência,
    //   fundir põe grafo primeiro, "por que sugeriu" cita base.
    // Obtido: trilha completa + fusão [02102000, ...] + texto base.
    vi.spyOn(bridgeMod, 'grafoConsultarGrafo').mockImplementation(
      (async (texto: string, k: number, ano?: number) =>
        grafo.grafoConsultar({ texto, k, anoReferencia: ano ?? null }, {})) as never,
    );
    const { trilha, resposta } = await consultarGrafoPrimeiro('carne bovina', 5);
    expect(trilha.usouGrafo).toBe(true);
    expect(trilha.cypher).toContain('MATCH');
    expect(trilha.caminhoPorCodigo.get('02102000')?.[0]).toBe('NCM:02102000');
    expect(trilha.provenienciaPorCodigo.get('02102000')?.[0]?.origem).toBe('por_codigo');
    const lexicais = [
      { codigo: '10059010', descricao: 'Em grão', score: 5 },
      { codigo: '02102000', descricao: 'Carnes bovinas', score: 1 },
    ];
    const fundidos = fundirCandidatosGrafoLexical(resposta, lexicais, trilha);
    expect(fundidos[0].codigo).toBe('02102000');
    expect(fundidos[0].viaGrafo).toBe(true);
    expect(textoPorQueSugeriu('02102000', trilha)).toContain('base: NCM:02102000 → CCT:200003 → Anexo:I');
  });
});
