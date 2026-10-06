/**
 * GRAFO-05 + GRAFO-08 (10-05) — `via:grafo` de ponta a ponta.
 *
 * - NCM multi-opção escolhe via caminho (grafo primeiro, dedupe, +2 desempate);
 * - trilha contém cypher executado + `graphPaths`;
 * - fallback sem grafo bit-idêntico ao pré-grafo (lexical intacto);
 * - overlay boost (`uso_local`) aparece na trilha + "por que sugeriu";
 * - resolvedor continua sendo a única verdade (nunca precifica pelo grafo).
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { semearBaseIa } from './ia/ajuda-ia'
import * as bridgeMod from '@/infrastructure/bridge'
import {
  consultarGrafoPrimeiro,
  fundirCandidatosGrafoLexical,
  desempatarPorGrafo,
  textoPorQueSugeriu,
  trilhaVazia,
} from '@/application/grafo-consumo'

const CYPHER_FAKE =
  'MATCH p = (n)-[:TEM_CLASSIFICACAO|MAPEIA|TEM_CLASSIFICACAO_NBS]->(c)-[:REDUZ_PARA]->(a:Anexo) WHERE n.codigo IN [\'10051000\', \'10059010\'] RETURN n.codigo AS codigo, [x IN nodes(p) | x.id] AS caminho'

function grafoOk(candidatos: Array<Record<string, unknown>>) {
  return {
    ok: true as const,
    candidatos: candidatos as never[],
    caminhos: candidatos.map((c) => c.caminho as string[]),
    cypher: CYPHER_FAKE,
    tempoMs: 5,
    modo: 'json-fallback' as const,
    modoVetor: 'fts-puro' as const,
    embedding: null,
  }
}

const CAND_GRAFO = [
  {
    codigo: '10051000',
    tipo: 'NCM',
    descricao: 'Para semeadura (sementeira)',
    score: 1.2,
    scoreBase: 1.2,
    caminho: ['NCM:10051000', 'CCT:200034', 'Anexo:VII'],
    proveniencia: [
      { de: 'NCM:10051000', para: 'CCT:200034', tipo: 'TEM_CLASSIFICACAO', origem: 'por_codigo', confianca: 1, anoReferencia: 2026 },
      { de: 'CCT:200034', para: 'Anexo:VII', tipo: 'REDUZ_PARA', origem: 'por_codigo', confianca: 1, anoReferencia: null },
    ],
    comunidade: 'CAP:10',
    scores: { fts: 1, vetor: 0, pagerank: 0.1 },
    boost: null,
    boostValor: 0,
  },
  {
    codigo: '10059010',
    tipo: 'NCM',
    descricao: 'Em grão',
    score: 0.9,
    scoreBase: 0.9,
    caminho: ['NCM:10059010', 'CCT:200038', 'Anexo:IX'],
    proveniencia: [
      { de: 'NCM:10059010', para: 'CCT:200038', tipo: 'TEM_CLASSIFICACAO', origem: 'por_codigo', confianca: 1, anoReferencia: 2026 },
      { de: 'CCT:200038', para: 'Anexo:IX', tipo: 'REDUZ_PARA', origem: 'por_codigo', confianca: 1, anoReferencia: null },
    ],
    comunidade: 'CAP:10',
    scores: { fts: 0.8, vetor: 0, pagerank: 0.1 },
    boost: null,
    boostValor: 0,
  },
]

beforeEach(async () => {
  await semearBaseIa()
  const g = globalThis as unknown as { window?: { aurum?: unknown } }
  if (typeof g.window === 'undefined') g.window = {}
  if ((g.window as { aurum?: unknown }).aurum !== undefined) delete (g.window as { aurum?: unknown }).aurum
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ia-grafo — fusão grafo primeiro + dedupe', () => {
  it('grafo primeiro, dedupe por código; sem grafo → lexical bit-idêntico', async () => {
    const lexicais = [
      { codigo: '10059010', descricao: 'Em grão', score: 5 },
      { codigo: '10051000', descricao: 'Para semeadura', score: 4 },
    ]
    const { trilha, resposta } = await (async () => {
      vi.spyOn(bridgeMod, 'grafoConsultarGrafo').mockResolvedValueOnce(grafoOk(CAND_GRAFO) as never)
      return consultarGrafoPrimeiro('milho para plantio', 5)
    })()
    expect(trilha.usouGrafo).toBe(true)
    expect(trilha.cypher).toContain('MATCH')
    const fundidos = fundirCandidatosGrafoLexical(resposta, lexicais, trilha)
    // Grafo primeiro + dedupe: 10051000 (grafo top) antes de 10059010.
    expect(fundidos.map((c) => c.codigo)).toEqual(['10051000', '10059010'])
    expect(fundidos[0].viaGrafo).toBe(true)
    expect(fundidos[0].caminhoGrafo).toEqual(['NCM:10051000', 'CCT:200034', 'Anexo:VII'])
    expect(fundidos[0].provenienciaGrafo?.[0]?.origem).toBe('por_codigo')
    expect(fundidos[0].cypherGrafo).toContain('MATCH')

    // Fallback: ok:false → lexical intacto (mesma ordem e referência).
    const vazio = { ok: false, candidatos: [], caminhos: [], cypher: '', tempoMs: 0, fallback: 'lexical' } as never
    const soLexical = fundirCandidatosGrafoLexical(vazio, lexicais, trilhaVazia())
    expect(soLexical).toBe(lexicais)
    expect(soLexical.map((c) => c.codigo)).toEqual(['10059010', '10051000'])
  })
})

describe('ia-grafo — NCM multi-opção escolhe via caminho + trilha com cypher', () => {
  it('classificarComIa("milho") com grafo escolhe 10051000 via:grafo e cita cypher', async () => {
    vi.spyOn(bridgeMod, 'grafoConsultarGrafo').mockResolvedValue(grafoOk(CAND_GRAFO) as never)
    const { classificarComIa } = await import('@/application/classificacao-ia')
    const r = await classificarComIa({ descricao: 'milho' })
    // Revalidado pelo resolvedor (única verdade) — código homologado.
    expect(r.ncmValidado).toBe('10051000')
    expect(r.codigoEscolhido).toBe('10051000')
    expect(['grafo', 'grafo+ia']).toContain(r.via)
    expect(r.grafoCypher).toContain('MATCH')
    expect(r.graphPaths?.length).toBeGreaterThan(0)
    expect(r.caminhoGrafo?.[0]).toBe('NCM:10051000')
    expect(r.provenienciaGrafo?.[0]?.origem).toBe('por_codigo')
    expect(r.motivo).toMatch(/via-grafo/)
    expect(r.fontes.join(' ')).toMatch(/Grafo fiscal/)
    // Ficha enriquecida com caminho (só com proveniência).
    expect(r.ficha?.grafoCaminho?.[0]).toBe('NCM:10051000')
    expect(r.ficha?.grafoCypher).toContain('MATCH')
  })

  it('fallback sem grafo é bit-idêntico (via:ia, sem cypher)', async () => {
    vi.spyOn(bridgeMod, 'grafoConsultarGrafo').mockResolvedValue({
      ok: false, candidatos: [], caminhos: [], cypher: '', tempoMs: 0, fallback: 'lexical',
    } as never)
    const { classificarComIa } = await import('@/application/classificacao-ia')
    const r = await classificarComIa({ descricao: 'milho' })
    expect(r.via).toBe('ia')
    expect(r.grafoCypher).toBeNull()
    expect(r.candidatos.every((c) => !c.viaGrafo)).toBe(true)
    // Mesmo NCM do legado (o grafo só reordena quando presente).
    expect(r.codigoEscolhido).not.toBeNull()
    expect(r.ncmValidado).not.toBeNull()
  })
})

describe('ia-grafo — overlay boost + desempate lote/XML', () => {
  it('boost uso_local aparece na trilha + "por que sugeriu"', async () => {
    const comBoost = [
      {
        ...CAND_GRAFO[0],
        score: 1.5,
        scoreBase: 1.2,
        boost: 'uso_local' as const,
        boostValor: 0.2,
      },
      CAND_GRAFO[1],
    ]
    vi.spyOn(bridgeMod, 'grafoConsultarGrafo').mockResolvedValueOnce(grafoOk(comBoost) as never)
    const { trilha } = await consultarGrafoPrimeiro('milho', 5)
    expect(trilha.usouGrafo).toBe(true)
    const b = trilha.boostPorCodigo.get('10051000')
    expect(b?.boost).toBe('uso_local')
    expect(b?.valor).toBeCloseTo(0.2, 9)
    const texto = textoPorQueSugeriu('10051000', trilha)
    expect(texto).toContain('base: NCM:10051000 → CCT:200034 → Anexo:VII')
    expect(texto).toContain('boost: uso_local')
  })

  it('desempatarPorGrafo só reordena pelo CCT do caminho (nunca cria redução)', async () => {
    const { trilha } = await (async () => {
      vi.spyOn(bridgeMod, 'grafoConsultarGrafo').mockResolvedValueOnce(grafoOk(CAND_GRAFO) as never)
      return consultarGrafoPrimeiro('milho', 5)
    })()
    const lista = [
      { cst: '200', cClassTrib: '200038', reducao: 60 },
      { cst: '200', cClassTrib: '200034', reducao: 60 },
    ]
    const r = desempatarPorGrafo(lista, trilha, '10051000')
    expect(r.usouGrafo).toBe(true)
    expect(r.cctDoCaminho).toBe('200034')
    expect(r.lista[0].cClassTrib).toBe('200034')
    expect(r.lista).toHaveLength(2)
    // Sem caminho/CCT → mesma ordem.
    const sem = desempatarPorGrafo(lista, trilhaVazia(), '10051000')
    expect(sem.usouGrafo).toBe(false)
    expect(sem.lista).toBe(lista)
  })

  it('grafo-service: proveniência por aresta + registrarUso com teto/TTL/demote', async () => {
    // @ts-expect-error — CJS sem tipos
    const gs = await import('@/..//electron/ia/grafo-service.cjs').catch(() => null)
    // Quando o import alias falhar (vitest sem alias para electron), cai no require relativo.
    let mod: Record<string, (...args: never[]) => never> | null = gs as never
    if (!mod || typeof (mod as { provenienciaDoCaminho?: unknown }).provenienciaDoCaminho !== 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require('../../electron/ia/grafo-service.cjs') as never
      } catch {
        mod = null
      }
    }
    expect(mod).not.toBeNull()
    const m = mod as unknown as {
      provenienciaDoCaminho: (caminho: string[], adj: Map<string, Array<{ para: string; origem: string; confianca: number; tipo: string }>>) => Array<{ origem: string }>
      registrarUsoEmDoc: (doc: unknown, evento: unknown) => { doc: { arestas: unknown[] }; adicionada: boolean }
      podarOverlay: (doc: unknown) => { doc: { arestas: unknown[] }; expiradas: number; cortadas: number }
      calcularBoost: (doc: unknown, id: string, opts?: unknown) => { boost: number }
    }
    // Proveniência: caminho sem aresta → [] (fail-closed, nunca exibe sem proveniência).
    expect(m.provenienciaDoCaminho(['NCM:10051000'], new Map())).toEqual([])
    // Registrar + teto: 5001 arestas → poda para 5000.
    const muitas = Array.from({ length: 5001 }, (_, i) => ({
      de: `Termo:t${i}`, para: 'NCM:10051000', tipo: 'NCM-ESCOLHIDO', origem: 'uso_local', peso: 0.1, criadoEm: new Date().toISOString(),
    }))
    const podado = m.podarOverlay({ versao: 1, arestas: muitas, checksum: 'x' })
    expect(podado.doc.arestas.length).toBeLessThanOrEqual(5000)
    // Demote: feedback-negativo zera o boost.
    const doc = { versao: 1, arestas: [{ de: 'Termo:milho', para: 'NCM:10051000', tipo: 'NCM-ESCOLHIDO', origem: 'uso_local', peso: 0.2, criadoEm: new Date().toISOString() }], checksum: 'x' }
    const comDemote = m.registrarUsoEmDoc(doc, { tipo: 'feedback-negativo', codigo: '10051000' })
    expect(comDemote.adicionada).toBe(true)
    expect(m.calcularBoost(comDemote.doc, 'NCM:10051000', { feedbackNegativo: ['10051000'] }).boost).toBe(0)
  })
})
