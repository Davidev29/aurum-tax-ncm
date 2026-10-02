/**
 * QA do gate IA — conhecidos + ambíguos + inválidos (Phase 6 / 06-09, IA-09).
 *
 * Ambiente node (sem Electron): `window.aurum` está ausente, então o gate usa
 * o seletor mock local (`mock: true`) — o stub abaixo documenta/garante essa
 * ausência explícita. Em produção (worker vivo) o mesmo gate passa por
 * `window.aurum.ia.classificar` + `resolverClassificacoes`.
 *
 * Regras:
 * - conhecidos → código esperado (só dígitos) + via correta;
 * - ambíguos/inválidos → NÃO SEI (sem código, sem decisão, sem cálculo).
 *
 * RAG proativo: descrições reais com 1–2 termos sem correspondente oficial
 * ("premium", "holandesa", "pet food") DECIDEM quando o núcleo do produto é
 * claro (ração para cães/gatos, bovino reprodutor) — com confiança media e
 * carimbo do resolvedor. NÃO SEI fica só para o verdadeiramente ambíguo
 * (termo único genérico, gibberish, vazio).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { classificarComIA } from '@/infrastructure/ia/classificacao-ia-repo'
import { semearBaseIa, soDigitos } from './ajuda-ia'

interface CasoConhecido {
  descricao: string
  ncm: string
  via: 'deterministico' | 'ia'
}

const CONHECIDOS: CasoConhecido[] = [
  // F1-F5 do dossiê (docs/diagnostico-fase-5.md §2) + variações.
  { descricao: 'Semente de milho híbrido para plantio', ncm: '10051000', via: 'deterministico' },
  { descricao: 'milho para semeadura', ncm: '10051000', via: 'deterministico' },
  { descricao: 'semente de milho para plantio', ncm: '10051000', via: 'deterministico' },
  { descricao: 'sementes de milho hibrido', ncm: '10051000', via: 'deterministico' },
  { descricao: 'milho hibrido para semeadura', ncm: '10051000', via: 'deterministico' },
  { descricao: 'sementeira de milho', ncm: '10051000', via: 'deterministico' },
  { descricao: 'Milho em grão para consumo', ncm: '10059010', via: 'deterministico' },
  { descricao: 'milho em grao', ncm: '10059010', via: 'deterministico' },
  { descricao: 'grão de milho para consumo', ncm: '10059010', via: 'deterministico' },
  { descricao: 'milho em grao a granel', ncm: '10059010', via: 'deterministico' },
  { descricao: 'milho amarelo em grão', ncm: '10059010', via: 'deterministico' },
  { descricao: 'saca de milho em grão', ncm: '10059010', via: 'deterministico' },
  { descricao: 'Alimentos para cães ou gatos acondicionados para venda a retalho', ncm: '23091000', via: 'deterministico' },
  { descricao: 'ração para cães', ncm: '23091000', via: 'deterministico' },
  { descricao: 'ração para gatos', ncm: '23091000', via: 'deterministico' },
  { descricao: 'alimento para cão venda retalho', ncm: '23091000', via: 'deterministico' },
  { descricao: 'cães ou gatos', ncm: '23091000', via: 'deterministico' },
  { descricao: 'acondicionados para venda a retalho', ncm: '23091000', via: 'deterministico' },
  { descricao: 'alimentos para animais retalho', ncm: '23091000', via: 'deterministico' },
  { descricao: 'Boi vivo da raça Nelore para reprodução', ncm: '01022919', via: 'deterministico' },
  { descricao: 'bovino vivo para reprodução', ncm: '01022919', via: 'deterministico' },
  { descricao: 'boi nelore reprodutor vivo', ncm: '01022919', via: 'deterministico' },
  { descricao: 'bovinos domésticos outros', ncm: '01022919', via: 'deterministico' },
  // D1-D5 do dossiê (§3): fallback IA com carimbo do resolvedor.
  { descricao: 'reprodução', ncm: '01022919', via: 'ia' },
  { descricao: 'gatos', ncm: '23091000', via: 'ia' },
  { descricao: 'grão', ncm: '10059010', via: 'ia' },
  { descricao: 'semeadura', ncm: '10051000', via: 'ia' },
  { descricao: 'retalho', ncm: '23091000', via: 'ia' },
  { descricao: 'para semeadura', ncm: '10051000', via: 'ia' },
  { descricao: 'em grão', ncm: '10059010', via: 'ia' },
  // RAG proativo: núcleo claro + ruído sem correspondente oficial.
  { descricao: 'pet food cães gatos retalho', ncm: '23091000', via: 'deterministico' },
  { descricao: 'ração seca para gatos castrados', ncm: '23091000', via: 'ia' },
  { descricao: 'ração premium para cães adultos', ncm: '23091000', via: 'ia' },
  { descricao: 'vaca holandesa viva para reprodução', ncm: '01022919', via: 'deterministico' },
  { descricao: 'touro brahman vivo reprodutor', ncm: '01022919', via: 'deterministico' },
  { descricao: 'Ração para cães com adição de sal', ncm: '23091000', via: 'ia' },
]

const AMBIGUOS = [
  'milho', // candidatos empatados → similaridade-insuficiente
  'bovina', // overlap abaixo do corte 0,2
  'coisa', // insuficiente, 0 candidatos
  'nave espacial alienígena interestelar', // 0 candidatos
  'sal', // termo único curto/genérico — pede contexto
  'ovo', // idem: pode ser alimento, ração ou insumo
]

const INVALIDOS = [
  '', // vazio
  'x', // 1 letra
  '12345', // só números
  '😀🚀', // emoji
  'asdfgh qwerty zzz', // gibberish (I1 do dossiê §4)
]

beforeAll(() => {
  // Mock explícito da ausência do Electron em node: garante que o gate cai
  // no seletor mock local (fora do Electron `bridge.ia` é ausente).
  const g = globalThis as unknown as { window?: { aurum?: unknown } }
  if (typeof g.window === 'undefined') g.window = {}
  if (g.window.aurum !== undefined) delete g.window.aurum
})

describe('classificacao-ia: conhecidos', () => {
  beforeEach(semearBaseIa)

  it.each(CONHECIDOS.map((c) => [c.descricao, c] as const))('%s', async (_rotulo, caso) => {
    let usouWorker = false
    const r = await classificarComIA(caso.descricao, { aoWorker: (u) => { usouWorker = u } })
    expect(soDigitos(r.codigoEscolhido)).toBe(caso.ncm)
    expect(r.via).toBe(caso.via)
    expect(usouWorker).toBe(caso.via === 'ia')
    // Toda decisão válida tem carimbo do resolvedor + cálculo sobre R$ 1.000.
    expect(r.decisao).not.toBeNull()
    expect(r.nomenclatura?.codigo).toBe(caso.ncm)
    expect(r.calculo).not.toBeNull()
    if (caso.via === 'deterministico') {
      expect(r.candidatos).toHaveLength(0)
      expect(r.mock).toBe(false)
    } else {
      expect(r.candidatos.length).toBeGreaterThan(0)
      expect(r.mock).toBe(true)
    }
  })
})

describe('classificacao-ia: ambíguos NÃO SEI', () => {
  beforeEach(semearBaseIa)

  it.each(AMBIGUOS)('%s', async (descricao) => {
    const r = await classificarComIA(descricao)
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
    expect(r.nomenclatura).toBeNull()
    expect(r.calculo).toBeNull()
  })
})

describe('classificacao-ia: inválidos NÃO SEI (5)', () => {
  beforeEach(semearBaseIa)

  it.each(INVALIDOS)('%j', async (descricao) => {
    const r = await classificarComIA(descricao)
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
    expect(r.nomenclatura).toBeNull()
    expect(r.calculo).toBeNull()
  })
})
