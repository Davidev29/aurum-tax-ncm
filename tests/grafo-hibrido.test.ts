/**
 * GRAFO-03 + GRAFO-06 + parte GRAFO-08 (scoring) — Retrieval híbrido.
 *
 *   (a) "aula de inglês online" acha NBS via vetor onde o lexical falha
 *       (sintético: FTS-puro vazio × híbrido com NBS; real: FTS-puro sem
 *       NBS-educação × híbrido com NBS 122051900 + CNAE 8593700 auditável).
 *       O fallback hash é um saco esparso com ponte semântica curada
 *       (aula/inglês→educação/ensino/idioma); o modelo real (transformers.js,
 *       só no build) generaliza neuralmente — ver `gerar-embeddings.mjs`.
 *   (b) benchmark: consulta fria no grafo real <2s CPU;
 *   (c) sem embedding → `modoVetor:'fts-puro'`, FTS segue funcionando;
 *   (d) boost com teto: overlay peso 10 → `+0.3` (TETO_BOOST);
 *   (e) demote por `ia_feedback` negativo + TTL 90d zeram o boost.
 *
 * Hermético: o mini-grafo sintético (tmp) isola mecanismo; o real valida
 * ponta a ponta. NUNCA toca `%APPDATA%` (overlay via `ctx.overlay`).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error — módulo CJS do Electron (sem tipos; importado pelo runtime)
import * as grafo from '@/../electron/ia/grafo-service.cjs'
// @ts-expect-error — script ESM do build (sem tipos; exporta gerarVetores p/ testes)
import { gerarVetores } from '../scripts/gerar-embeddings.mjs'

const ENV_GRAFO = process.env.AURUM_GRAFO_DIR
const ENV_USERDATA = process.env.AURUM_GRAFO_USERDATA
const ENV_EMB = process.env.AURUM_EMBEDDING_DIR

let tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}

const NODOS_MINI = [
  { id: 'NBS:122051900', tipo: 'NBS', props: { codigo: '122051900', descricao: 'Serviços educacionais com treinamento' } },
  { id: 'CNAE:8593700', tipo: 'CNAE', props: { codigo: '8593700', descricao: 'Ensino idiomas' } },
  { id: 'CCT:200003', tipo: 'CCT', props: { codigo: '200003', descricao: 'Educacao' } },
  { id: 'Anexo:II', tipo: 'Anexo', props: { nome: 'II' } },
]
const ARESTAS_MINI = [
  { de: 'CNAE:8593700', para: 'NBS:122051900', tipo: 'MAPEIA' },
  { de: 'NBS:122051900', para: 'CCT:200003', tipo: 'TEM_CLASSIFICACAO_NBS' },
  { de: 'CCT:200003', para: 'Anexo:II', tipo: 'REDUZ_PARA' },
]

/** Mini-grafo + vetores hash em tmp; devolve `{ dirGrafo }` p/ `ctx`. */
function montarMiniGrafo(): string {
  const dir = mkTmp('aurum-grafo-hibrido-')
  fs.writeFileSync(
    path.join(dir, 'grafo.lbug.json'),
    JSON.stringify({ formato: 'grafo-portatil', versao: 'grafo-v1', nodos: NODOS_MINI, arestas: ARESTAS_MINI }),
  )
  const gv = gerarVetores(NODOS_MINI, ARESTAS_MINI, {})
  fs.writeFileSync(
    path.join(dir, 'vetores.json'),
    JSON.stringify({ formato: 'vetores-grafo-v1', modelo: 'hash-fallback', modeloAlvo: 'x', dim: 384, modo: 'hash-fallback', idf: gv.idf, vetores: gv.vetores }),
  )
  return dir
}

function overlayCom(arestas: object[]) {
  return { versao: 1, arestas, checksum: 'teste' }
}

beforeEach(() => {
  grafo._limparCache()
  grafo._limparCacheVetores()
  delete process.env.AURUM_GRAFO_DIR
  delete process.env.AURUM_GRAFO_USERDATA
  delete process.env.AURUM_EMBEDDING_DIR
})

afterEach(() => {
  grafo._limparCache()
  grafo._limparCacheVetores()
  if (ENV_GRAFO === undefined) delete process.env.AURUM_GRAFO_DIR
  else process.env.AURUM_GRAFO_DIR = ENV_GRAFO
  if (ENV_USERDATA === undefined) delete process.env.AURUM_GRAFO_USERDATA
  else process.env.AURUM_GRAFO_USERDATA = ENV_USERDATA
  if (ENV_EMB === undefined) delete process.env.AURUM_EMBEDDING_DIR
  else process.env.AURUM_EMBEDDING_DIR = ENV_EMB
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
  tmpDirs = []
})

describe('grafo-hibrido — (a) vetor onde o lexical falha', () => {
  it('sintético: FTS-puro vazio × híbrido acha o NBS via vetor', async () => {
    const dir = montarMiniGrafo()
    const fts = await grafo.grafoConsultar(
      { texto: 'aula de ingles online', k: 5, modoVetorForcado: 'fts-puro' },
      { dirGrafo: dir },
    )
    expect(fts.ok).toBe(true)
    expect(fts.modoVetor).toBe('fts-puro')
    expect(fts.candidatos).toEqual([])

    const hyb = await grafo.grafoConsultar({ texto: 'aula de ingles online', k: 5 }, { dirGrafo: dir })
    expect(hyb.ok).toBe(true)
    expect(hyb.modoVetor).toBe('hnsw')
    const cods = hyb.candidatos.map((c: { codigo: string }) => c.codigo)
    expect(cods).toContain('122051900')
    const nbs = hyb.candidatos.find((c: { codigo: string }) => c.codigo === '122051900')
    expect(nbs.scores.vetor).toBeGreaterThan(0)
    expect(nbs.scores.fts).toBe(0)
    expect(nbs.boost).toBeNull()
    expect(nbs.caminho).toEqual(['NBS:122051900', 'CCT:200003', 'Anexo:II'])
    expect(hyb.cypher).toContain('vetor=hnsw')
  })

  it('real: FTS-puro sem NBS-educação × híbrido com NBS + caminho CNAE→NBS', async () => {
    const fts = await grafo.grafoConsultar(
      { texto: 'aula de ingles online', k: 12, modoVetorForcado: 'fts-puro' },
      {},
    )
    expect(fts.ok).toBe(true)
    expect(fts.modoVetor).toBe('fts-puro')
    expect(fts.candidatos.filter((c: { tipo: string; codigo: string }) => c.tipo === 'NBS' && /^1220/.test(c.codigo))).toEqual([])

    const hyb = await grafo.grafoConsultar({ texto: 'aula de ingles online', k: 12 }, {})
    expect(hyb.ok).toBe(true)
    expect(hyb.modoVetor).toBe('hnsw')
    expect(hyb.embedding?.modo).toBe('hash-fallback')
    const cods = hyb.candidatos.map((c: { codigo: string }) => c.codigo)
    expect(cods).toContain('122051900')
    expect(cods).toContain('8593700')
    const cnae = hyb.candidatos.find((c: { codigo: string }) => c.codigo === '8593700')
    expect(cnae.scores.vetor).toBeGreaterThan(0)
    expect(cnae.caminho[0]).toBe('CNAE:8593700')
    expect(cnae.caminho.some((x: string) => x.startsWith('NBS:'))).toBe(true)
    for (const c of hyb.candidatos) {
      expect(c.scores).toMatchObject({ fts: expect.any(Number), vetor: expect.any(Number), pagerank: expect.any(Number) })
    }
  })
})

describe('grafo-hibrido — (b) benchmark + (c) FTS-puro', () => {
  it('(b) consulta fria no grafo real <2s CPU', async () => {
    grafo._limparCache()
    grafo._limparCacheVetores()
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(r.ok).toBe(true)
    expect(r.candidatos[0].codigo).toBe('02102000')
    expect(r.tempoMs).toBeLessThan(2000)
  })

  it('(c) sem embedding → modo FTS-puro, FTS segue funcionando', async () => {
    const vazioEmb = mkTmp('aurum-emb-vazio-')
    process.env.AURUM_EMBEDDING_DIR = vazioEmb // explícito = exclusivo
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(r.ok).toBe(true)
    expect(r.modoVetor).toBe('fts-puro')
    expect(r.embedding).toBeNull()
    expect(r.candidatos.map((c: { codigo: string }) => c.codigo)).toContain('02102000')
  })
})

describe('grafo-hibrido — (d) boost com teto + (e) demote/TTL', () => {
  const overlayPeso10 = () =>
    overlayCom([
      {
        de: 'CNAE:8593700',
        para: 'NBS:122051900',
        tipo: 'NCM-ESCOLHIDO',
        origem: 'uso_local',
        peso: 10,
        criadoEm: new Date().toISOString(),
      },
    ])

  it('(d) overlay peso 10 → boost capped em 0.3', async () => {
    const dir = montarMiniGrafo()
    const r = await grafo.grafoConsultar({ texto: 'aula de ingles online', k: 5 }, { dirGrafo: dir, overlay: overlayPeso10() })
    expect(r.ok).toBe(true)
    const nbs = r.candidatos.find((c: { codigo: string }) => c.codigo === '122051900')
    expect(nbs.boost).toBe('uso_local')
    expect(nbs.boostValor).toBe(0.3)
    expect(Math.abs(nbs.score - nbs.scoreBase - 0.3)).toBeLessThan(1e-9)
    // Sem overlay, o mesmo candidato não tem boost.
    const base = await grafo.grafoConsultar({ texto: 'aula de ingles online', k: 5 }, { dirGrafo: dir })
    const nbsBase = base.candidatos.find((c: { codigo: string }) => c.codigo === '122051900')
    expect(nbsBase.boost).toBeNull()
    expect(nbsBase.boostValor).toBe(0)
  })

  it('(e) demote por feedback negativo zera o boost', async () => {
    const dir = montarMiniGrafo()
    expect(grafo.calcularBoost(overlayPeso10(), 'NBS:122051900', { feedbackNegativo: ['122051900'] }).boost).toBe(0)
    const r = await grafo.grafoConsultar(
      { texto: 'aula de ingles online', k: 5 },
      { dirGrafo: dir, overlay: overlayPeso10(), feedbackNegativo: ['122051900'] },
    )
    const nbs = r.candidatos.find((c: { codigo: string }) => c.codigo === '122051900')
    expect(nbs.boost).toBeNull()
    expect(nbs.boostValor).toBe(0)
  })

  it('(e) TTL 90d: aresta de 120 dias expira; de 89 dias vale', async () => {
    const dia = 24 * 60 * 60 * 1000
    const velha = new Date(Date.now() - 120 * dia).toISOString()
    const quase = new Date(Date.now() - 89 * dia).toISOString()
    const mk = (criadoEm: string) =>
      overlayCom([{ de: 'x', para: 'NBS:122051900', tipo: 'NCM-ESCOLHIDO', origem: 'uso_local', peso: 0.2, criadoEm }])
    const expirada = grafo.calcularBoost(mk(velha), 'NBS:122051900', {})
    expect(expirada.boost).toBe(0)
    expect(expirada.expiradas).toBe(1)
    const vigente = grafo.calcularBoost(mk(quase), 'NBS:122051900', {})
    expect(vigente.boost).toBeCloseTo(0.2, 9)
  })
})
