import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()

describe('fine-tuning NBS (30 serviços × 100 formas)', () => {
  it('finetuning-nbs.json existe com 3000 consultas válidas', () => {
    const p = join(RAIZ, 'recursos-ia', 'conhecimento', 'finetuning-nbs.json')
    expect(existsSync(p)).toBe(true)
    const arr = JSON.parse(readFileSync(p, 'utf8'))
    expect(arr.length).toBeGreaterThanOrEqual(3000)
    const textos: string[] = arr.map((r: { consulta: string }) => String(r.consulta).toLowerCase())
    expect(textos.some((t: string) => t.includes('aula de ingles'))).toBe(true)
    expect(textos.some((t: string) => t.includes('corte de cabelo'))).toBe(true)
    expect(textos.some((t: string) => t.includes('diaria de hotel'))).toBe(true)
    const nbss = new Set(arr.map((r: { nbs: string }) => String(r.nbs).replace(/\D+/g, '')))
    expect(nbss.size).toBeGreaterThanOrEqual(30)
    for (const r of arr.slice(0, 50)) {
      expect(String(r.nbs).replace(/\D+/g, '')).toMatch(/^\d{9}$/)
    }
  })
})

describe('fine-tuning CNAE (30 CNAEs × 100 formas)', () => {
  it('finetuning-cnae.json existe com 3000 consultas e anexos conferidos', () => {
    const p = join(RAIZ, 'recursos-ia', 'conhecimento', 'finetuning-cnae.json')
    expect(existsSync(p)).toBe(true)
    const arr = JSON.parse(readFileSync(p, 'utf8'))
    expect(arr.length).toBeGreaterThanOrEqual(3000)
    const cnaes = new Set(arr.map((r: { cnae: string }) => String(r.cnae).replace(/\D+/g, '')))
    expect(cnaes.size).toBeGreaterThanOrEqual(30)
    expect(cnaes.has('6201501')).toBe(true)
    expect(cnaes.has('4721102')).toBe(true)
    // Anexos conferidos contra a base viva.
    const base = JSON.parse(readFileSync(join(RAIZ, 'public', 'base', 'cnae.json'), 'utf8'))
    const porCodigo = new Map(
      (base.itens ?? []).map((r: { codigo7: string; anexos: string[] }) => [
        String(r.codigo7).replace(/\D+/g, ''),
        [...(r.anexos ?? [])].sort().join(','),
      ]),
    )
    for (const r of arr.slice(0, 60)) {
      const cod = String(r.cnae).replace(/\D+/g, '')
      expect(cod).toMatch(/^\d{7}$/)
      expect(porCodigo.get(cod)).toBe([...(r.anexos ?? [])].sort().join(','))
    }
  })
})

describe('grafo absorveu o fine-tuning', () => {
  it('Termo→NCM e Termo→NBS de curadoria existem no .lbug.json', () => {
    const g = JSON.parse(
      readFileSync(join(RAIZ, 'public', 'base', 'grafo', 'grafo.lbug.json'), 'utf8'),
    )
    const ncm = g.arestas.filter(
      (a: { tipo: string; origem: string }) => a.tipo === 'SINONIMO_DE' && a.origem === 'curadoria',
    )
    const nbs = g.arestas.filter(
      (a: { tipo: string; origem: string }) => a.tipo === 'SINONIMO_NBS' && a.origem === 'curadoria',
    )
    expect(nbs.length).toBeGreaterThan(0)
    const temFrango = ncm.some(
      (a: { de: string; para: string }) =>
        String(a.de).includes('frango vivo para abate') && a.para === 'NCM:01059400',
    )
    expect(temFrango).toBe(true)
    // Sem resíduo de andaime nos termos do fine-tuning.
    const sujos = ncm.filter((a: { de: string }) =>
      /qual (é|e|o)|código|codigo|como classifica|tem ncm|por favor| na reforma/i.test(
        String(a.de).replace(/^Termo:/, '').split(' ').slice(0, 4).join(' '),
      ),
    )
    expect(sujos.length).toBe(0)
  })
})
