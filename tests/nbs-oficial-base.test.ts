/**
 * nbs-oficial-base.test.ts — invariantes dos artefatos NBS oficiais
 * (`public/base/nbs-nomenclatura.json` e `public/base/nbs-depara.json`).
 *
 * Estes artefatos são gerados por `npm run fontes:sync` + `npm run base`
 * (ver docs/fontes-oficiais-nbs.md). Os testes fixam invariantes estruturais
 * — não contam 3.239 por capricho: a contagem exata aparece no MANIFEST e em
 * `npm run verificar:pre`; aqui garantimos que o artefato embutido é íntegro.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const BASE = resolve(__dirname, '..', 'public', 'base')

type Artefato = { itens: Array<Record<string, any>>; meta?: Record<string, any> } & Record<string, any>

function ler(nome: string): Artefato {
  return JSON.parse(readFileSync(resolve(BASE, nome), 'utf8')) as Artefato
}

const PAI_LEN: Record<string, number> = { posicao: 3, subposicao1: 5, subposicao2: 6, item: 7, subitem: 8 }

describe('nbs-nomenclatura.json (NBS 2.00 oficial)', () => {
  const artefato = ler('nbs-nomenclatura.json')
  const itens = artefato.itens

  it('existe, é do tipo certo e tem escala oficial', () => {
    expect(artefato.tipo).toBe('nbs-nomenclatura')
    expect(artefato.meta?.norma ?? '').toContain('2.000')
    expect(itens.length).toBeGreaterThanOrEqual(3000)
    expect(artefato.meta?.versao).toBe('NBS_2.00')
  })

  it('tem exatamente a hierarquia esperada por nível', () => {
    const porNivel = new Map<string, number>()
    for (const i of itens) porNivel.set(String(i.nivel), (porNivel.get(String(i.nivel)) ?? 0) + 1)
    expect(porNivel.get('capitulo')).toBe(26)
    expect(porNivel.get('posicao')).toBe(146)
    expect(porNivel.get('subposicao1')).toBe(454)
    expect(porNivel.get('subposicao2')).toBe(802)
    expect(porNivel.get('item')).toBe(892)
    expect(porNivel.get('subitem')).toBe(919)
  })

  it('códigos (dígitos) são 9-chave únicos por nível e o dígito casa com o nível', () => {
    const vistos = new Set<string>()
    const lenPorNivel: Record<string, number> = { capitulo: 3, posicao: 5, subposicao1: 6, subposicao2: 7, item: 8, subitem: 9 }
    for (const i of itens) {
      expect(typeof i.codigo).toBe('string')
      expect(i.codigo).toMatch(/^\d+$/)
      expect(lenPorNivel[String(i.nivel)]).toBe(i.codigo.length)
      const chave = `${i.nivel}|${i.codigo}`
      expect(vistos.has(chave), `duplicado: ${chave}`).toBe(false)
      vistos.add(chave)
    }
  })

  it('todo pai existe no próprio conjunto (exceto capítulos) e aponta para nível anterior', () => {
    const codigos = new Set(itens.map((i) => i.codigo as string))
    for (const i of itens) {
      if (i.nivel === 'capitulo') {
        expect(i.pai).toBeNull()
        continue
      }
      expect(typeof i.pai).toBe('string')
      expect(i.pai!.length).toBe(PAI_LEN[String(i.nivel)])
      expect(codigos.has(i.pai!), `pai ausente para ${i.codigo} (pai=${i.pai})`).toBe(true)
    }
  })

  it('toda folha é subitem e tem pai curto correto', () => {
    const folhas = itens.filter((i) => i.folha)
    expect(folhas.length).toBe(919)
    expect(folhas.every((i) => i.nivel === 'subitem')).toBe(true)
  })

  it('descrição nunca vazia na saída (herança do ancestral) e descricaoOriginal coerente', () => {
    for (const i of itens) {
      expect(typeof i.descricao).toBe('string')
      expect(i.descricao.trim().length, `descrição vazia em ${i.codigo}`).toBeGreaterThan(0)
      if (i.descricaoOriginal == null) {
        expect(typeof i.descricaoOriginal).toBe('object') // null
      } else {
        expect(typeof i.descricaoOriginal).toBe('string')
      }
    }
  })

  it('cobre os códigos NBS usados pela Reforma (Anexo II + Anexo IX)', () => {
    const universo = new Set(itens.map((i) => i.codigo as string))
    // Amostra dos vínculos da Reforma (Anexo II) + 10 do Anexo IX — todos devem existir no oficial
    const reforma = JSON.parse(readFileSync(resolve(BASE, 'reforma.json'), 'utf8'))
    const nbs: string[] = (reforma.nbs ?? []).map((v: any) => String(v.codigo))
    expect(nbs.length).toBeGreaterThanOrEqual(122)
    for (const codigo of nbs) {
      expect(universo.has(codigo), `NBS ${codigo} dos vínculos ausente do oficial`).toBe(true)
    }
  })
})

describe('nbs-depara.json (NBS 1.1 ↔ 2.0 — correlação oficial)', () => {
  const artefato = ler('nbs-depara.json')
  const itens = artefato.itens

  it('existe, é do tipo certo e mantém a estrutura da fonte', () => {
    expect(artefato.tipo).toBe('nbs-depara')
    expect(typeof artefato.meta?.sha256Csv).toBe('string')
    expect(itens.length).toBeGreaterThanOrEqual(1300)
  })

  it('toda linha tem 1.1 ou 2.0 (ou ambas) e relação coerente', () => {
    for (const r of itens) {
      expect(r.nbs11 !== null || r.nbs20 !== null).toBe(true)
      expect(['mapeado', 'extinto', 'novo']).toContain(r.relacao)
      if (r.nbs11 && r.nbs20) {
        expect(r.relacao).toBe('mapeado')
        expect(r.identico).toBe(r.nbs11 === r.nbs20)
      }
      if (!r.nbs20) expect(r.relacao).toBe('extinto')
      if (!r.nbs11) expect(r.relacao).toBe('novo')
    }
  })

  it('mapeamentos 2.00 apontam para folhas válidas da NBS oficial (com 1 exceção conhecida, documentada)', () => {
    const oficial = ler('nbs-nomenclatura.json')
    const folhas = new Set(oficial.itens.map((i) => i.codigo as string))
    const faltantes = itens.filter((r) => r.nbs20 && !folhas.has(r.nbs20))
    // Exceção conhecida: 1.0105.21.00 não existe no painel oficial 2.00 atual
    // (inconsistência da própria planilha de correlação da MDIC — ver docs/nbs-avaliacao-2026-11.md §3.1-2)
    expect(faltantes.map((r) => r.nbs20)).toEqual(['101052100'])
  })

  it('mapeamento 1.1:122032000 → 2.0:122031000 (exemplo educativo da fonte)', () => {
    const hit = itens.find((r) => r.nbs11 === '122032000')
    expect(hit?.nbs20).toBe('122031000')
    expect(hit?.relacao).toBe('mapeado')
  })

  it('extintos e novos somam com os mapeados ao total', () => {
    const porRel = new Map<string, number>()
    for (const r of itens) porRel.set(String(r.relacao), (porRel.get(String(r.relacao)) ?? 0) + 1)
    expect((porRel.get('mapeado') ?? 0) + (porRel.get('extinto') ?? 0) + (porRel.get('novo') ?? 0)).toBe(itens.length)
  })
})
