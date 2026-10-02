/**
 * Performance do gate IA (Phase 6 / 06-09, IA-09).
 *
 * Tetos (modo mock, CPU comum):
 * - p95 de `classificarComIA` < 5s (lote de 25 misto determinístico/IA);
 * - RSS do processo < 500MB;
 * - índice lexical em `recursos-ia/indice-ncm/` < 200MB.
 */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { classificarComIA } from '@/infrastructure/ia/classificacao-ia-repo'
import { semearBaseIa } from './ajuda-ia'

const LOTE = [
  'Semente de milho híbrido para plantio',
  'milho para semeadura',
  'Milho em grão para consumo',
  'milho em grao',
  'Alimentos para cães ou gatos acondicionados para venda a retalho',
  'ração para cães',
  'Boi vivo da raça Nelore para reprodução',
  'bovino vivo para reprodução',
  'reprodução',
  'gatos',
  'grão',
  'semeadura',
  'retalho',
  'para semeadura',
  'em grão',
  'milho',
  'coisa',
  'asdfgh qwerty zzz',
  '',
  'x',
  'semente de milho para plantio',
  'saca de milho em grão',
  'alimento para cão venda retalho',
  'boi nelore reprodutor vivo',
  'nave espacial alienígena interestelar',
]

function percentil(amostra: number[], p: number): number {
  const xs = [...amostra].sort((a, b) => a - b)
  const i = Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)
  return xs[Math.max(0, i)]
}

describe('performance-ia', () => {
  beforeEach(semearBaseIa)

  it('p95 classificar < 5s (mock)', async () => {
    const tempos: number[] = []
    for (const d of LOTE) {
      const t0 = Date.now()
      await classificarComIA(d)
      tempos.push(Date.now() - t0)
    }
    expect(percentil(tempos, 95)).toBeLessThan(5000)
  }, 120000)

  it('RSS < 500MB', () => {
    const rssMB = process.memoryUsage().rss / (1024 * 1024)
    expect(rssMB).toBeLessThan(500)
  })

  it('índice lexical < 200MB', async () => {
    const caminho = join(process.cwd(), 'recursos-ia', 'indice-ncm', 'indice-lexical.json')
    const st = await stat(caminho)
    expect(st.size).toBeLessThan(200 * 1024 * 1024)
  })
})
