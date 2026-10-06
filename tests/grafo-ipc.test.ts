/**
 * GRAFO-02 — Runtime no worker + IPC (`ia:grafo`).
 *
 *   (a) sem `.lbug` → `{ ok:false, fallback:'lexical' }` (fail-closed);
 *   (b) com o grafo real, "carne bovina" acha NCM 02... (02102000 + similares)
 *       com caminho auditável;
 *   (c) expansão 2-hops retorna CCT + Anexo (+ Artigo quando curado);
 *   (d) consulta quente <50ms (ou <500ms em CI);
 *   (e) overlay nasce vazio e corrompido recupera (base intacta);
 *   (f) worker `ia-worker.cjs` responde ao comando `grafo` via fork;
 *   (g) `ia-service.grafoConsultarViaGrafo` sem worker cai no direto (main).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error — módulo CJS do Electron (sem tipos; importado pelo runtime)
import * as grafo from '@/../electron/ia/grafo-service.cjs'
// @ts-expect-error — módulo CJS do Electron (sem tipos; importado pelo runtime)
import * as iaService from '@/../electron/ia/ia-service.cjs'

const ROOT = process.cwd()
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

  it('(a2) AURUM_GRAFO_DIR vazio contamina inclusive o caminho via ia-service', async () => {
    const vazio = mkTmp('aurum-grafo-vazio-')
    process.env.AURUM_GRAFO_DIR = vazio
    const r = await iaService.grafoConsultarViaGrafo({ texto: 'carne bovina', k: 5 })
    expect(r.ok).toBe(false)
    expect(r.fallback).toBe('lexical')
  })

  it('(a3) texto vazio também é fail-closed, sem throw', async () => {
    const r = await grafo.grafoConsultar({ texto: '   ' }, {})
    expect(r.ok === true ? r.candidatos : r.fallback).toBeDefined()
    const v = await iaService.grafoConsultarViaGrafo({ texto: '' })
    expect(v.ok).toBe(false)
    expect(v.fallback).toBe('lexical')
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
    const r = await grafo.grafoConsultar({ texto: 'carne bovina', k: 5 }, {})
    expect(r.ok).toBe(true)
    expect(r.tempoMs).toBeLessThan(limite)
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

describe('grafo-ipc — worker + ia-service', () => {
  function forkWorker(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const filho = fork(path.join(ROOT, 'electron', 'ia', 'ia-worker.cjs'), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      const timer = setTimeout(() => {
        try { filho.kill() } catch { /* ignora */ }
        reject(new Error('timeout esperando "pronto" do worker'))
      }, 15000)
      filho.once('message', (msg: unknown) => {
        const m = (msg ?? {}) as { cmd?: string }
        if (m.cmd === 'pronto') {
          clearTimeout(timer)
          resolve(filho)
        }
      })
      filho.once('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }

  function rpcFilho(filho: ChildProcess, cmd: string, carga: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9)
      const timer = setTimeout(() => {
        filho.off('message', aoMsg)
        reject(new Error(`timeout no comando "${cmd}"`))
      }, 15000)
      const aoMsg = (msg: unknown) => {
        const m = (msg ?? {}) as { id?: number }
        if (m.id === id) {
          clearTimeout(timer)
          filho.off('message', aoMsg)
          resolve(m as Record<string, unknown>)
        }
      }
      filho.on('message', aoMsg)
      filho.send({ id, cmd, ...carga })
    })
  }

  it('(f) worker responde ao comando `grafo` com candidatos + caminho', async () => {
    const filho = await forkWorker()
    try {
      const init = await rpcFilho(filho, 'init', { mock: true })
      expect(init.ok).toBe(true)
      const r = await rpcFilho(filho, 'grafo', { texto: 'carne bovina', k: 3 })
      expect(r.ok).toBe(true)
      const cands = r.candidatos as { codigo: string; caminho: string[] }[]
      expect(Array.isArray(cands) && cands.length).toBeGreaterThan(0)
      expect(cands[0].codigo.replace(/\D/g, '')).toMatch(/^02/)
      expect(cands[0].caminho.length).toBeGreaterThanOrEqual(3)
    } finally {
      try { filho.send({ id: -1, cmd: 'encerrar' }) } catch { /* ignora */ }
      setTimeout(() => { try { filho.kill() } catch { /* ignora */ } }, 500)
    }
  }, 30000)

  it('(g) ia-service sem worker cai no direto e acha o grafo real', async () => {
    const r = await iaService.grafoConsultarViaGrafo({ texto: 'carne bovina', k: 3 })
    expect(r.ok).toBe(true)
    expect(r.candidatos[0].codigo.replace(/\D/g, '')).toMatch(/^02/)
  })
})
