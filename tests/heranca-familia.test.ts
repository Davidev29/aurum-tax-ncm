/**
 * Herança por família — regras puras + resolvedor com IndexedDB.
 *
 * Invariantes:
 * - herança só sem vínculo exato, com unanimidade dos irmãos + limiares;
 * - condicional (destinação/adquirente) nunca herda sozinho → hipótese;
 * - seção sozinha nunca decide; capítulo só nos 7 curados;
 * - exato e manual sempre vencem a herança.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  decidirHeranca,
  ehCondicional,
  EXCECOES_FAMILIA,
  LIMIAR_HERANCA,
  regraDoCapitulo,
  REGRAS_CAPITULO,
} from '@/domain/services/regras-hierarquicas'
import { montarClassificacaoHerdada, observacaoHerancaFamilia } from '@/domain/services/classificacao'
import {
  buscarVinculosPorPrefixo,
  invalidarCacheBuscaTexto,
  resolverClassificacoes,
  resolverPorFamilia,
  resolverPorPrefixo,
  vigentesNoPrefixo,
} from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

describe('regras-hierarquicas (puras)', () => {
  it('7 capítulos curados, todos 200/200038 Anexo IX', () => {
    expect(REGRAS_CAPITULO.map((r) => r.capitulo).sort()).toEqual(['07', '10', '11', '12', '15', '25', '31'])
    for (const r of REGRAS_CAPITULO) {
      expect(r.cst).toBe('200')
      expect(r.cClassTrib).toBe('200038')
      expect(r.anexo).toBe('9')
    }
  })
  it('capítulo misto (06) e parcial (23) fora da curadoria', () => {
    expect(regraDoCapitulo('06')).toBeNull()
    expect(regraDoCapitulo('23')).toBeNull()
    expect(regraDoCapitulo('07')?.cClassTrib).toBe('200038')
  })
  it('condicionais conhecidos nunca herdam sozinhos', () => {
    expect(ehCondicional('200002')).toBe(true)
    expect(ehCondicional('200005')).toBe(true)
    expect(ehCondicional('200038')).toBe(false)
    expect(ehCondicional('200003')).toBe(false)
  })
  it('exceções de família cadastradas (sal, cozido, destinação, vivo)', () => {
    const ids = EXCECOES_FAMILIA.map((e) => e.id)
    expect(ids).toContain('sal-adicionado')
    expect(ids).toContain('produto-cozido')
    expect(ids).toContain('destinacao-condicional')
  })
  it('decidirHeranca: unanimidade + limiares por nível', () => {
    // SH6 230990 real: 7 irmãos, cobertura 7/8 → herda (alta: só falta o consultado).
    expect(decidirHeranca({ nivel: 'subposicao', irmaosVinculados: 7, vigentesNoPrefixo: 8, unanime: true, condicional: false }))
      .toMatchObject({ tipo: 'herdar', confianca: 'alta' })
    // SH6 parcial acima do limiar → herda média.
    expect(decidirHeranca({ nivel: 'subposicao', irmaosVinculados: 3, vigentesNoPrefixo: 5, unanime: true, condicional: false }))
      .toMatchObject({ tipo: 'herdar', confianca: 'media' })
    // Caso 2933 (1 irmão em 253): sem herança, sem hipótese — regra geral.
    expect(decidirHeranca({ nivel: 'subposicao', irmaosVinculados: 1, vigentesNoPrefixo: 253, unanime: true, condicional: false }).tipo)
      .toBe('negar')
    // Lastro parcial fraco (1/2): hipótese, não herança.
    expect(decidirHeranca({ nivel: 'subposicao', irmaosVinculados: 1, vigentesNoPrefixo: 2, unanime: true, condicional: false }).tipo)
      .toBe('hipotese')
    // Divergente: nega mesmo com lastro.
    expect(decidirHeranca({ nivel: 'posicao', irmaosVinculados: 5, vigentesNoPrefixo: 6, unanime: false, condicional: false }).tipo)
      .toBe('negar')
    // Condicional unânime com lastro total: hipótese, nunca herança.
    expect(decidirHeranca({ nivel: 'subposicao', irmaosVinculados: 7, vigentesNoPrefixo: 8, unanime: true, condicional: true }).tipo)
      .toBe('hipotese')
    // Limiares publicados (contrato auditável).
    expect(LIMIAR_HERANCA.subposicao).toMatchObject({ minIrmaos: 2, coberturaMin: 0.6 })
    expect(LIMIAR_HERANCA.posicao).toMatchObject({ minIrmaos: 3, coberturaMin: 0.75 })
  })
  it('montarClassificacaoHerdada carimba origem sem inventar redução', () => {
    const vinculo = {
      id: 'x', codigo: '07133311', codigoFormatado: '0713.33.11', cst: '200', cClassTrib: '200038',
      baseLegal: 'Art. 138', reducao: 60, aliquotaIBS: null, aliquotaCBS: null, descricao: 'Insumo', documentos: 'NFE',
    }
    const ctx = { cstDetalhes: null, cstClassTribDetalhes: null, referencia: null }
    const cl = montarClassificacaoHerdada('07133319', vinculo, ctx, {
      nivel: 'subposicao', prefixo: '071333', irmaosVinculados: 3, vigentesNoPrefixo: 4,
      origem: 'familia-SH6', confianca: 'media', aConfirmar: true,
    })
    expect(cl.codigo).toBe('07133319')
    expect(cl.cst).toBe('200')
    expect(cl.regraGeral).toBe(false)
    expect(cl.heranca?.prefixo).toBe('071333')
    expect(cl.baseLegal).toMatch(/herdado por família/)
  })
  it('observacaoHerancaFamilia: âmbar a confirmar, verde cobertura total', () => {
    const amb = observacaoHerancaFamilia({ nivel: 'subposicao', prefixo: '071333', irmaosVinculados: 3, vigentesNoPrefixo: 5, origem: 'familia-SH6', confianca: 'media', aConfirmar: true })
    expect(amb?.cor).toBe('amber')
    const ok = observacaoHerancaFamilia({ nivel: 'subposicao', prefixo: '071333', irmaosVinculados: 7, vigentesNoPrefixo: 8, origem: 'familia-SH6', confianca: 'alta', aConfirmar: false })
    expect(ok?.cor).toBe('emerald')
    expect(observacaoHerancaFamilia(null)).toBeNull()
  })
})

/* ---------------- resolvedor com base semeada ------------------------------ */

const NOMEN = [
  // Família SH6 071333: 4 vigentes (3 com vínculo 200/200038 + 1 sem).
  { codigo: '07', codigoOriginal: '07', descricao: 'Produtos hortícolas.', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '0713', codigoOriginal: '0713', descricao: 'Legumes de vagem, secos.', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '071333', codigoOriginal: '071333', descricao: 'Feijão comum.', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '07133311', codigoOriginal: '0713.33.11', descricao: 'Preto', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '07133319', codigoOriginal: '0713.33.19', descricao: 'Outros pretos', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '07133321', codigoOriginal: '0713.33.21', descricao: 'Carioca', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '07133329', codigoOriginal: '0713.33.29', descricao: 'Outros cariocas', dataInicio: null, dataFim: null, ato: 'A' },
  // Família divergente SH6 090121 (cafés): 2 vínculos com ccts diferentes.
  { codigo: '09012100', codigoOriginal: '0901.21.00', descricao: 'Café torrado A', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '09012110', codigoOriginal: '0901.21.10', descricao: 'Café torrado B', dataInicio: null, dataFim: null, ato: 'A' },
  { codigo: '09012190', codigoOriginal: '0901.21.90', descricao: 'Café torrado C (sem vínculo)', dataInicio: null, dataFim: null, ato: 'A' },
]

const vinc = (codigo: string, cst: string, cClassTrib: string) => ({
  id: `${codigo}|${cst}|${cClassTrib}`,
  codigo,
  codigoFormatado: codigo,
  cst,
  cClassTrib,
  baseLegal: `Base ${cClassTrib}`,
  reducao: 60,
  aliquotaIBS: null,
  aliquotaCBS: null,
  descricao: `Vínculo ${cClassTrib}`,
  documentos: 'NFE',
})

async function semear() {
  await db.ncmNomenclatura.clear()
  await db.ncm.clear()
  await db.cst.clear()
  await db.cstClassTrib.clear()
  await db.referencia.clear()
  await db.reclassificacoesManuais.clear()
  invalidarCacheBuscaTexto()
  await db.ncmNomenclatura.bulkPut(NOMEN)
  await db.cst.put({
    codigo: '200', descricao: 'Alíquota reduzida', indIBSCBS: true, indIBSCBSMono: false,
    indReducao: true, indDiferimento: false, indTransferenciaCredito: false,
    docs: { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false },
  })
  await db.cst.put({
    codigo: '000', descricao: 'Tributação integral', indIBSCBS: true, indIBSCBSMono: false,
    indReducao: false, indDiferimento: false, indTransferenciaCredito: true,
    docs: { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false },
  })
  const docs = { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false }
  await db.cstClassTrib.bulkPut([
    {
      id: '200|200038', cst: '200', cClassTrib: '200038', nome: 'Insumos (Anexo IX)', descricao: 'Insumos Anexo IX',
      lcRedacao: 'Art. 138', lcRef: 'Art. 138', tipoAliquota: 'Padrão', pRedIBS: 60, pRedCBS: 60,
      indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0, indMonoDif: 0,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
    {
      id: '200|200003', cst: '200', cClassTrib: '200003', nome: 'Cesta básica (Anexo I)', descricao: 'Cesta Anexo I',
      lcRedacao: 'Art. 125', lcRef: 'Art. 125', tipoAliquota: 'Padrão', pRedIBS: 100, pRedCBS: 100,
      indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0, indMonoDif: 0,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
  ])
  await db.referencia.bulkPut([
    {
      id: '200|200038', cst: '200', cstDescricao: 'Alíquota reduzida', cClassTrib: '200038', descricao: 'Insumos Anexo IX',
      pRedIBS: 60, pRedCBS: 60, tipoAliquota: 'Padrão', anexo: '9',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art138',
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
      monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs,
    },
    {
      id: '200|200003', cst: '200', cstDescricao: 'Alíquota reduzida', cClassTrib: '200003', descricao: 'Cesta Anexo I',
      pRedIBS: 100, pRedCBS: 100, tipoAliquota: 'Padrão', anexo: '1',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art125',
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
      monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs,
    },
  ])
  await db.ncm.bulkPut([
    vinc('07133311', '200', '200038'),
    vinc('07133321', '200', '200038'),
    vinc('07133329', '200', '200038'),
    vinc('09012100', '200', '200038'),
    vinc('09012110', '200', '200003'),
  ])
}

describe('resolverPorFamilia (com base)', () => {
  beforeEach(semear)

  it('NCM sem vínculo exato herda da SH6 unânime (07133319 → 200/200038)', async () => {
    const r = await resolverClassificacoes('07133319')
    expect(r.regraGeral).toBe(false)
    expect(r.lista[0]?.cst).toBe('200')
    expect(r.lista[0]?.cClassTrib).toBe('200038')
    expect(r.heranca?.prefixo).toBe('071333')
    expect(r.heranca?.origem).toBe('familia-SH6')
  })

  it('vínculo exato continua vencendo a herança', async () => {
    const r = await resolverClassificacoes('07133311')
    expect(r.regraGeral).toBe(false)
    expect(r.heranca ?? null).toBeNull()
    expect(r.lista[0]?.codigo).toBe('07133311')
  })

  it('família divergente (090121) não herda — regra geral + sem hipótese unânime', async () => {
    const r = await resolverClassificacoes('09012190')
    expect(r.regraGeral).toBe(true)
    expect(r.lista[0]?.heranca ?? null).toBeNull()
  })

  it('resolverPorFamilia direto: herdado SH6 com trilha de origem', async () => {
    const r = await resolverPorFamilia('07133319')
    expect(r?.classificacao?.cClassTrib).toBe('200038')
    expect(r?.classificacao?.heranca?.origem).toBe('familia-SH6')
  })

  it('resolverPorPrefixo classifica entrada truncada (0713) pela família', async () => {
    const r = await resolverPorPrefixo('0713')
    expect(r?.nivel).toBe('posicao')
    expect(r?.unanime).toBe(true)
    expect(r?.cClassTrib).toBe('200038')
    expect(r && r.totalFilhos).toBeGreaterThan(0)
  })

  it('buscarVinculosPorPrefixo + vigentesNoPrefixo com lastro', async () => {
    expect((await buscarVinculosPorPrefixo('071333')).length).toBe(3)
    expect((await vigentesNoPrefixo('071333')).length).toBe(4)
  })
})
