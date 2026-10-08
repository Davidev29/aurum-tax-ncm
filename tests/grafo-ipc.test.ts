/**
 * GRAFO-02 — Runtime direto no processo principal (`ia:grafo`).
 *
 *   (a) sem `.lbug` → `{ ok:false, fallback:'lexical' }` (fail-closed);
 *   (b) com o grafo real, "carne bovina" acha NCM 02... (02102000 + similares)
 *       com caminho auditável;
 *   (c) expansão 2-hops retorna CCT + Anexo (+ Artigo quando curado);
 *   (d) consulta quente <50ms (ou <500ms em CI);
 *   (e) overlay nasce vazio e corrompido recupera (base intacta).
 *
 * Sem worker LLM: o `main.ts` chama `grafoConsultar` direto (sem fork).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error — módulo CJS do Electron (sem tipos; importado pelo runtime)
import * as grafo from '@/../electron/ia/grafo-service.cjs'
const ENV_GRAFO = process.env.AURUM_GRAFO_DIR
const ENV_USERDATA = process.env.AURUM_GRAFO_USERDATA

let tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}

beforeEach(() => {
  grafo._limparCache()
  delete process.env.AURUM_GRAFO_DIR
  delete process.env.AURUM_GRAFO_USERDATA
})

afterEach(() => {
  grafo._limparCache()
  if (ENV_GRAFO === undefined) delete process.env.AURUM_GRAFO_DIR
  else process.env.AURUM_GRAFO_DIR = ENV_GRAFO
  if (ENV_USERDATA === undefined) delete process.env.AURUM_GRAFO_USERDATA
  else process.env.AURUM_GRAFO_USERDATA = ENV_USERDATA
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
  tmpDirs = []
})

describe('grafo-ipc — fallback sem .lbug', () => {
  it('(a) diretório vazio → { ok:false, fallback:lexical } e NUNCA throw', async () => {
    const vazio = mkTmp('aurum-grafo-vazio-')
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, { dirGrafo: vazio })
    expect(r.ok).toBe(false)
    expect(r.fallback).toBe('lexical')
  })

  it('(a2) AURUM_GRAFO_DIR vazio contamina inclusive o caminho direto do main', async () => {
    const vazio = mkTmp('aurum-grafo-vazio-')
    process.env.AURUM_GRAFO_DIR = vazio
    grafo._limparCache()
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(r.ok).toBe(false)
    expect(r.fallback).toBe('lexical')
  })

  it('(a3) texto vazio é resposta honesta vazia, sem throw', async () => {
    // Serviço direto: texto sem tokens → ok:true com 0 candidatos (o
    // chamador segue no lexical). A guarda fail-closed de texto vazio
    // (`ok:false` + `fallback:'lexical'`) mora no canal `ia:grafo` do main.
    const r = await grafo.grafoConsultar({ texto: '   ' }, {})
    expect(r.ok === true ? r.candidatos : r.fallback).toBeDefined()
    const v = await grafo.grafoConsultar({ texto: '' }, {})
    expect(v.ok).toBe(true)
    expect(v.candidatos).toEqual([])
  })
})

describe('grafo-ipc — consulta real (FTS + 2-hops)', () => {
  it('(b) "carne bovina" acha NCM 02 com caminho auditável', async () => {
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(r.ok).toBe(true)
    expect(r.modo).toBe('json-fallback')
    expect(r.candidatos.length).toBeGreaterThan(0)
    const cods = r.candidatos.map((c: { codigo: string }) => c.codigo)
    // Seed principal: carnes da espécie bovina; todos os seeds são do cap. 02.
    expect(cods).toContain('02102000')
    for (const c of r.candidatos) {
      expect(c.codigo.replace(/\D/g, '')).toMatch(/^02/)
      expect(Array.isArray(c.caminho)).toBe(true)
      expect(c.caminho[0]).toBe(`NCM:${c.codigo}`)
    }
    expect(typeof r.cypher).toBe('string')
    expect(r.cypher).toContain('MATCH')
    expect(typeof r.tempoMs).toBe('number')
  })

  it('(c) 2-hops retorna CCT + Anexo (+ Artigo curado)', async () => {
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(r.ok).toBe(true)
    const top = r.candidatos[0]
    expect(top.caminho).toContain('CCT:200003')
    expect(top.caminho).toContain('Anexo:I')
    expect(top.caminho).toContain('ArtigoLC214:125')
    expect(r.caminhos.length).toBeGreaterThan(0)
    expect(r.caminhos[0]).toEqual(top.caminho)
    expect(r.cypher).toContain('TEM_CLASSIFICACAO')
    expect(r.cypher).toContain('02102000')
  })

  it('(d) consulta quente <50ms local (<500ms em CI)', async () => {
    await grafo.grafoConsultar({ texto: 'aquecimento', k: 5 }, {})
    const limite = process.env.CI ? 500 : 50
    // Mediana de 5 amostras: a consulta quente é estável (~20ms); a mediana
    // absorve pausas pontuais de GC/CPU sob carga paralela sem mascarar
    // regressão real (uma mediana estourada = degradação sistemática).
    const amostras: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
      expect(r.ok).toBe(true)
      expect(r.candidatos.length).toBeGreaterThan(0)
      amostras.push(r.tempoMs)
    }
    amostras.sort((a, b) => a - b)
    expect(amostras[Math.floor(amostras.length / 2)]).toBeLessThan(limite)
  })
})

describe('grafo-ipc — overlay de aprendizado (GRAFO-08)', () => {
  it('(e) nasce vazio com checksum; corrompido → backup + recria vazio', async () => {
    const dir = mkTmp('aurum-overlay-')
    const n1 = grafo.abrirOverlay(dir)
    expect(n1.ok).toBe(true)
    expect(n1.novo).toBe(true)
    expect(n1.doc).toMatchObject({ versao: 1, arestas: [] })
    expect(typeof n1.doc.checksum).toBe('string')
    const emDisco = JSON.parse(fs.readFileSync(path.join(dir, 'aprendizado.json'), 'utf8'))
    expect(emDisco.checksum).toBe(n1.doc.checksum)

    fs.writeFileSync(path.join(dir, 'aprendizado.json'), 'lixo{{{corrompido')
    const n2 = grafo.abrirOverlay(dir)
    expect(n2.ok).toBe(true)
    expect(n2.recuperado).toBe(true)
    expect(n2.doc).toMatchObject({ versao: 1, arestas: [] })
    expect(typeof n2.backup).toBe('string')
    expect(fs.existsSync(n2.backup)).toBe(true)
  })

  it('(e2) base intacta após corrupção do overlay (re-query bit-idêntica)', async () => {
    const antes = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(antes.ok).toBe(true)
    const dir = mkTmp('aurum-overlay-')
    fs.writeFileSync(path.join(dir, 'aprendizado.json'), 'lixo')
    grafo.abrirOverlay(dir)
    grafo._limparCache()
    const depois = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(depois.ok).toBe(true)
    expect(depois.candidatos.map((c: { codigo: string }) => c.codigo)).toEqual(
      antes.candidatos.map((c: { codigo: string }) => c.codigo),
    )
  })
})
