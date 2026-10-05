/**
 * Ambientes autônomos da Aurinha: 81 comportamentos, sorteio ponderado sem
 * repetição imediata e intervalos irregulares (vida natural, nunca mecânica).
 */
import { describe, expect, it } from 'vitest'
import {
  AMBIENTES,
  INTERVALO_AMBIENTE_MAX,
  INTERVALO_AMBIENTE_MIN,
  sortearAmbiente,
  sortearIntervaloAmbiente,
  sortearTagarelice,
  FRASES_TAGARELICE,
} from '@/store/pet-ambiente'

const ESPERADOS = [
  'espiar', 'espreguicar', 'bocejar', 'cocar', 'farejar-chao', 'polir-lupa',
  'girar', 'cochilar', 'dancar', 'chamar',
  'trotar', 'ronda', 'disparar', 'esgueirar', 'marchar', 'deslizar', 'meia-volta',
  'pulo-simples', 'pulo-duplo', 'pulo-girando', 'quicar', 'pulo-mortal',
  'cacar-moeda', 'comer', 'beber', 'cantar', 'espirrar', 'susto', 'aninhar', 'despertar',
  'lamber-beico', 'farejar-pote', 'tomar-cafe', 'lavar-rosto', 'sonhar',
  'cacar-borboleta', 'perseguir-luz', 'jogar-moeda', 'esconder',
  'carimbar', 'contar-moedas', 'mandar-beijo',
  // Pacote 3 — emoção
  'rir-alto', 'choramingar', 'orgulho', 'timidez', 'surpresa', 'meditar',
  'apaixonar', 'emburrar', 'alivio',
  // Pacote 3 — locomoção
  'galopar', 'saltitar', 'correr-leve', 'sonambular', 'escorregar', 'tropecar',
  'rodopiar', 'patrulha-lenta', 'zigue-zague',
  // Pacote 3 — ocioso natural
  'olhar-relogio', 'contar-estrelas', 'assobiar', 'ajeitar-oculos', 'farejar-ar',
  'lustrar-selo', 'anotar', 'dobrar-mapa', 'fazer-sombra',
  // Gaveta de documentos
  'consultar-gaveta', 'ler-livrinho',
  // Pacote 4 — braços com física
  'acenar-duplo', 'nadar-lontra', 'escavar', 'malabarismo', 'aplaudir',
  'focar-binoculo', 'carregar-caixa', 'apontar-achado', 'espreguicar-bracos',
  'abraco-quente',
]

describe('ambientes da Aurinha', () => {
  it('tem exatamente 81 comportamentos com ids únicos e durações sãs', () => {
    expect(AMBIENTES).toHaveLength(81)
    const ids = AMBIENTES.map((a) => a.id)
    expect(new Set(ids).size).toBe(81)
    for (const a of AMBIENTES) {
      expect(a.id).toMatch(/^[a-z-]+$/)
      expect(a.duracaoMs).toBeGreaterThanOrEqual(2000)
      expect(a.duracaoMs).toBeLessThanOrEqual(4000)
      expect(a.descricao.length).toBeGreaterThan(5)
    }
  })

  it('inclui os 81 catálogos esperados', () => {
    const ids = AMBIENTES.map((a) => a.id)
    for (const esperado of ESPERADOS) {
      expect(ids).toContain(esperado)
    }
  })

  it('não repete o anterior imediato', () => {
    for (let i = 0; i < 120; i++) {
      const anterior = AMBIENTES[i % AMBIENTES.length]!.id
      const sorteado = sortearAmbiente(anterior, () => (i % AMBIENTES.length) / AMBIENTES.length)
      expect(sorteado.id).not.toBe(anterior)
    }
    // Varredura fina no espaço ponderado também nunca repete.
    for (let i = 0; i < 200; i++) {
      const anterior = AMBIENTES[(i * 7) % AMBIENTES.length]!.id
      const sorteado = sortearAmbiente(anterior, () => (i * 0.6180339887) % 1)
      expect(sorteado.id).not.toBe(anterior)
    }
  })

  it('é determinístico com rand injetado', () => {
    const a = sortearAmbiente(null, () => 0)
    const b = sortearAmbiente(null, () => 0)
    expect(a.id).toBe(b.id)
    expect(a.id).toBe(AMBIENTES[0]!.id)
  })

  it('sorteia intervalos irregulares dentro da faixa 9–17 s', () => {
    expect(sortearIntervaloAmbiente(() => 0)).toBe(INTERVALO_AMBIENTE_MIN)
    expect(sortearIntervaloAmbiente(() => 0.9999)).toBeLessThanOrEqual(INTERVALO_AMBIENTE_MAX)
    const meio = sortearIntervaloAmbiente(() => 0.5)
    expect(meio).toBeGreaterThan(INTERVALO_AMBIENTE_MIN)
    expect(meio).toBeLessThan(INTERVALO_AMBIENTE_MAX)
  })

  it('tagarelice sorteia das frases conhecidas', () => {
    for (const r of [0, 0.2, 0.5, 0.9]) {
      expect(FRASES_TAGARELICE).toContain(sortearTagarelice(() => r))
    }
    expect(FRASES_TAGARELICE.length).toBeGreaterThanOrEqual(4)
  })

  it('pesos e categorias são válidos (raridade do sorteio)', () => {
    for (const a of AMBIENTES) {
      expect(a.peso ?? 2).toBeGreaterThanOrEqual(1)
      expect(a.peso ?? 2).toBeLessThanOrEqual(3)
      if (a.categoria) {
        expect(['vida', 'brincadeira', 'trabalho', 'social', 'base']).toContain(a.categoria)
      }
    }
    // Vida tem os comuns (comer/beber pedem repetição natural).
    const porId = new Map(AMBIENTES.map((a) => [a.id, a]))
    expect((porId.get('comer')!.peso ?? 0)).toBeGreaterThanOrEqual(3)
    expect((porId.get('beber')!.peso ?? 0)).toBeGreaterThanOrEqual(3)
    // Raros continuam raros.
    expect((porId.get('sonhar')!.peso ?? 9)).toBe(1)
    expect((porId.get('jogar-moeda')!.peso ?? 9)).toBe(1)
  })

  it('sorteio ponderado favorece comuns contra raros', () => {
    let comuns = 0
    let raros = 0
    for (let i = 0; i < 1000; i++) {
      const s = sortearAmbiente(null, () => (i * 0.6180339887) % 1)
      if (s.id === 'comer' || s.id === 'beber') comuns += 1
      if (s.id === 'sonhar' || s.id === 'jogar-moeda') raros += 1
    }
    expect(comuns).toBeGreaterThan(raros)
    expect(comuns).toBeGreaterThan(0)
  })
})
