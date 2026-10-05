/**
 * Phase 9 / 09-01 — base viva CNAE → NBS + tracer 09-00 (duplo).
 *
 * Cobre: `fixLatin1` (mojibake sintético + texto correto intacto), descarte do
 * tracking Google, dedupe `cnae7|nbs`, precedência oficial > qualclasstrib >
 * auxiliar, `nbsSemDescricao` e divergência de código (marca, NÃO consolida).
 *
 * Tracer 09-00:
 *   (a) `0161-0/01 → 1.1803.21.00` ingerido + template íntegro;
 *   (b) `1011-2/01` (bens, fora dos 508) com regra completa lida de `db.cnae`,
 *       sem NBS e sem erro.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  construirClassificacoesConsolidadas,
  normalizarCnaeNbs,
} from '../scripts/build-base.mjs'
import {
  escolherDescricaoConferida,
  fixLatin1,
  normalizarCnaeNbsLink,
  normalizarLcNbsRelation,
  normalizarTextoConferencia,
} from '@/infrastructure/base/normalizacao'
import { semearBaseEmbutida, statusBase } from '@/infrastructure/base/base-service'
import { db } from '@/infrastructure/db/schema'

/* ------------------------------------------------------------ fixtures --- */

const BASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'base',
)

const ler = (nome: string): Record<string, any> =>
  JSON.parse(readFileSync(path.join(BASE_DIR, nome), 'utf8')) as Record<string, any>

/** Ponte sintética mínima (nunca a fonte real — determinística). */
const PONTE_SINTETICA = {
  por_codigo: {
    '0161-0/01': {
      tipo: 'CNAE',
      descricao: 'Serviço de pulverização e controle de pragas agrícolas',
      vinculos: { CTN: ['07.13'], NBS: ['1.1803.21.00', '1.1803.21.00', '123'], CST: ['000'], cClassTrib: ['000001'] },
    },
    '9999-9/99': {
      tipo: 'CNAE',
      descricao: 'Código legado sem base oficial',
      vinculos: { CTN: [], NBS: ['1.1502.10.00'], CST: ['000'], cClassTrib: ['000001'] },
    },
  },
  respostas_de_rede: [
    {
      url: 'https://qualclasstrib.com.br/data/fallback-cnae-links.json',
      dados: [{ cnae: '0161-0/01', cnaed: 'Pulverização agrícola', lc: '07.13', lcd: 'Dedetização.', page: 1 }],
    },
    {
      url: 'https://qualclasstrib.com.br/data/fallback-relations.json',
      dados: [
        { lc: '07.13', lcd: 'Dedetização.', nbs: '1.1803.21.00', nbsd: 'Pulverização e controle de pragas', onerosa: 'S', exterior: 'N', indop: '020201', local: 'local do imóvel', cct: '000001', cctd: 'Tributação integral.' },
      ],
    },
    { url: 'https://ep1.adtrafficquality.google/getconfig/sodar?x=1', dados: { sodar_query_id: 'abc' } },
  ],
}

const REGRA_OFICIAL = (codigo7: string, codigoFormatado: string, descricao = 'Regra oficial do CNAE') => ({
  codigo7,
  codigoFormatado,
  descricao,
  situacao: 'Permitido',
  anexos: ['III'],
  fatorR: false,
})

/* ------------------------------------------------------ fixLatin1 --- */

describe('fixLatin1 (rede de segurança latin1)', () => {
  it('repara mojibake real `ServiÃ§o` → `Serviço`', () => {
    expect(fixLatin1('ServiÃ§o de pulverizaÃ§Ã£o')).toBe('Serviço de pulverização')
    expect(fixLatin1('AnÃ¡lise e desenvolvimento')).toBe('Análise e desenvolvimento')
  })

  it('não corrompe texto correto (fonte medida sem mojibake real)', () => {
    expect(fixLatin1('Serviço de pulverização e controle de pragas agrícolas')).toBe(
      'Serviço de pulverização e controle de pragas agrícolas',
    )
    expect(fixLatin1('ATIVIDADES DE APOIO A EXTRACAO DE MINERAIS NÃO-FERROSOS')).toBe(
      'ATIVIDADES DE APOIO A EXTRACAO DE MINERAIS NÃO-FERROSOS',
    )
    expect(fixLatin1('Âmbito de bolsas de mercadorias')).toBe('Âmbito de bolsas de mercadorias')
    expect(fixLatin1('APOIO À EXTRAÇÃO')).toBe('APOIO À EXTRAÇÃO')
    expect(fixLatin1('Cultivo de arroz')).toBe('Cultivo de arroz')
  })

  it('retorna `""` para não-string', () => {
    expect(fixLatin1(null)).toBe('')
    expect(fixLatin1(undefined)).toBe('')
  })
})

/* ------------------------------------------------------ links --- */

describe('normalizarCnaeNbsLink', () => {
  it('normaliza par válido `0161-0/01 → 1.1803.21.00`', () => {
    expect(normalizarCnaeNbsLink({ cnae: '0161-0/01', nbs: '1.1803.21.00' })).toEqual({
      cnae7: '0161001',
      cnae: '0161-0/01',
      nbs: '118032100',
      fonte: 'por_codigo',
    })
  })

  it('rejeita NBS fora de 9 dígitos e CNAE fora do padrão', () => {
    expect(normalizarCnaeNbsLink({ cnae: '0161-0/01', nbs: '12345678' })).toBeNull()
    expect(normalizarCnaeNbsLink({ cnae: 'ABC', nbs: '118032100' })).toBeNull()
    expect(normalizarCnaeNbsLink(null)).toBeNull()
    expect(normalizarCnaeNbsLink({ cnae: '0161-0/01' })).toBeNull()
  })

  it('é idempotente sobre o artefato já normalizado', () => {
    const link = { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' }
    expect(normalizarCnaeNbsLink(link)).toEqual(link)
  })
})

describe('normalizarLcNbsRelation', () => {
  it('normaliza relação válida com descrições', () => {
    expect(
      normalizarLcNbsRelation({
        lc: '07.13', lcd: 'Dedetização.', nbs: '1.1803.21.00',
        nbsd: 'Pulverização.', cct: '1', cctd: 'Integral.',
      }),
    ).toEqual({
      lc: '07.13', nbs: '118032100', cct: '000001',
      descricaoLc: 'Dedetização.', descricaoNbs: 'Pulverização.', descricaoCct: 'Integral.',
      onerosa: '', exterior: '', indop: '', local: '',
    })
  })

  it('preserva linhas sem NBS/cct com `""` (fidelidade, sem join)', () => {
    const rel = normalizarLcNbsRelation({ lc: '07.13', nbs: '', cct: '' })
    expect(rel).toMatchObject({ lc: '07.13', nbs: '', cct: '' })
    // Fidelidade total: só não-objeto é nulo (lc ausente vira `''`).
    expect(normalizarLcNbsRelation({ nbs: '118032100' })).toMatchObject({ lc: '', nbs: '118032100' })
    expect(normalizarLcNbsRelation(null)).toBeNull()
    expect(normalizarLcNbsRelation('x')).toBeNull()
  })
})

/* ------------------------------------------------------ ponte --- */

describe('normalizarCnaeNbs (fonte ponte)', () => {
  it('aplica dedupe, valida e descarta o tracking Google', () => {
    const r = normalizarCnaeNbs(PONTE_SINTETICA)
    // `1.1803.21.00` repetido + `123` inválido → 1 link; + 1 do legado.
    expect(r.links).toHaveLength(2)
    expect(r.links[0]).toMatchObject({ cnae7: '0161001', nbs: '118032100' })
    expect(r.duplicados).toBe(1)
    expect(r.invalidos).toBe(1)
    expect(r.descartadosRede).toBe(1)
    expect(r.cnaeLc).toHaveLength(1)
    expect(r.lcNbs).toHaveLength(1)
    expect(r.descricoesAuxiliares['0161001']).toBe('Pulverização agrícola')
    expect(r.paresTriangulados).toContain('0161001|118032100')
  })

  it('é idempotente sobre o artefato `cnae-nbs.json`', () => {
    const r = normalizarCnaeNbs(PONTE_SINTETICA)
    const re = normalizarCnaeNbs({ links: r.links, lcNbs: r.lcNbs })
    expect(re.links).toEqual(r.links)
    expect(re.lcNbs).toEqual(r.lcNbs)
  })
})

/* ------------------------------------------------------ precedência --- */

describe('precedência de descrição (oficial > qualclasstrib > auxiliar)', () => {
  it('oficial vence mesmo com texto divergente', () => {
    expect(escolherDescricaoConferida('Aparelhamento de placas', 'APARELHMANTO DE PLACAS', 'aux')).toEqual({
      descricao: 'Aparelhamento de placas',
      fonte: 'oficial',
    })
  })

  it('cai para qualclasstrib e depois auxiliar', () => {
    expect(escolherDescricaoConferida('', 'Ponte desc', 'aux')).toEqual({ descricao: 'Ponte desc', fonte: 'qualclasstrib' })
    expect(escolherDescricaoConferida('', '', 'aux desc')).toEqual({ descricao: 'aux desc', fonte: 'auxiliar' })
  })

  it('normalizarTextoConferencia ignora acento/caixa/pontuação', () => {
    expect(normalizarTextoConferencia('Gestão de ativos não-financeiros')).toBe(
      normalizarTextoConferencia('Gestão de ativos intangíveis não financeiros'.replace('intangíveis ', '')),
    )
  })
})

/* ------------------------------------------------------ consolidação --- */

describe('construirClassificacoesConsolidadas (conferência entre fontes)', () => {
  const mapaDescNbs = new Map([['118032100', { descricao: 'Pulverização e controle de pragas', fonte: 'qualclasstrib' as const }]])

  it('consolida código conferido com regra oficial + NBS vinculada', () => {
    const descPonte = PONTE_SINTETICA.por_codigo['0161-0/01'].descricao as string
    const { templates, conferencia } = construirClassificacoesConsolidadas({
      cnaeOficial: [REGRA_OFICIAL('0161001', '0161-0/01', descPonte)],
      porCodigo: PONTE_SINTETICA.por_codigo,
      descricoesAuxiliares: {},
      mapaDescNbs,
    })
    const tpl = templates.find((t: any) => t.cnae7 === '0161001')
    expect(tpl).toMatchObject({
      codigoFormatado: '0161-0/01',
      descricao: descPonte,
      fonteDescricao: 'oficial',
      situacao: 'Permitido',
      estadoNbs: 'mapeado',
      divergencia: null,
    })
    expect(tpl?.anexoSimples).toEqual(['III'])
    expect(tpl?.vedacoes.length).toBeGreaterThan(0)
    expect(tpl?.nbsVinculadas).toHaveLength(1)
    expect(tpl?.nbsVinculadas[0]).toMatchObject({ nbs: '118032100', semDescricao: false })
    expect(tpl?.beneficiosReforma).toEqual([])
    expect(conferencia).toMatchObject({ cnaesComRegras: 1, descricoesConferidas: 1 })
  })

  it('divergência de TEXTO consolida com a descrição oficial (precedência)', () => {
    const { templates } = construirClassificacoesConsolidadas({
      cnaeOficial: [REGRA_OFICIAL('0161001', '0161-0/01')],
      porCodigo: {
        '0161-0/01': { descricao: 'TEXTO DIVERGENTE DA PONTE', vinculos: { NBS: [] } },
      },
      descricoesAuxiliares: {},
      mapaDescNbs: new Map(),
    })
    const tpl = templates.find((t: any) => t.cnae7 === '0161001')
    expect(tpl?.descricao).toBe('Regra oficial do CNAE')
    expect(tpl?.divergencia).toMatchObject({ tipo: 'descricao-divergente' })
  })

  it('divergência de CÓDIGO marca e NÃO consolida regra oficial', () => {
    const { templates, conferencia } = construirClassificacoesConsolidadas({
      cnaeOficial: [REGRA_OFICIAL('0161001', '0161-0/01')],
      porCodigo: PONTE_SINTETICA.por_codigo,
      descricoesAuxiliares: {},
      mapaDescNbs,
    })
    const tpl = templates.find((t: any) => t.cnae7 === '9999999')
    expect(tpl).toMatchObject({
      codigoFormatado: '9999-9/99',
      fonteDescricao: 'qualclasstrib',
      anexoSimples: [],
      estadoNbs: 'divergencia',
    })
    expect(tpl?.divergencia).toMatchObject({ tipo: 'codigo-ausente-oficial' })
    // Links da ponte preservados mesmo sem regra oficial.
    expect(tpl?.nbsVinculadas).toHaveLength(1)
    expect(conferencia.codigosDivergentes).toBe(1)
  })

  it('NBS sem descrição em nenhuma fonte vira `nbsSemDescricao`', () => {
    const { templates, conferencia } = construirClassificacoesConsolidadas({
      cnaeOficial: [REGRA_OFICIAL('0161001', '0161-0/01')],
      porCodigo: {
        '0161-0/01': { descricao: 'Regra oficial do CNAE', vinculos: { NBS: ['9.9999.99.99'] } },
      },
      descricoesAuxiliares: {},
      mapaDescNbs: new Map(),
    })
    const tpl = templates.find((t: any) => t.cnae7 === '0161001')
    expect(tpl?.nbsVinculadas).toEqual([
      { nbs: '999999999', descricao: null, fonteDescricao: null, semDescricao: true },
    ])
    expect(conferencia.nbsSemDescricao).toBe(1)
  })
})

/* ------------------------------------------------------ artefatos --- */

describe('artefatos gerados por `npm run base` (integração)', () => {
  const manifest = ler('MANIFEST.json')
  const ponte = ler('cnae-nbs.json')
  const consolidado = ler('classificacoes-consolidadas.json')
  const est = manifest.estatisticas as Record<string, number>

  it('MANIFEST carrega os 8 stats da Phase 9 + proveniência', () => {
    expect(est).toMatchObject({
      cnaesComRegras: 1090,
      cnaesComNbs: 508,
      cnaeNbsLinks: 6641,
      nbsUnicas: 588,
      lcLinks: 677,
      lcNbs: 1739,
    })
    expect(est.descricoesConferidas + est.descricoesDivergentes).toBe(508)
    expect(typeof est.descricoesConferidas).toBe('number')
    expect(typeof est.nbsSemDescricao).toBe('number')
    expect(manifest.fontesVivas?.qualclasstrib).toMatchObject({
      origem: expect.stringContaining('qualclasstrib'),
      licenca: expect.any(String),
      capturaEm: expect.any(String),
      cadencia: expect.any(String),
      notaRede: expect.stringContaining('google'),
    })
  })

  it('não regrediu 1.090 CNAEs + 122 NBS', () => {
    expect(ler('cnae.json').itens).toHaveLength(1090)
    expect(ler('reforma.json').meta.totalNbs).toBe(122)
    expect(est.cnae).toBe(1090)
  })

  it('`cnae-nbs.json` tem 6.641 links únicos + 1.739 relações LC×NBS', () => {
    expect(ponte.links).toHaveLength(6641)
    expect(ponte.lcNbs).toHaveLength(1739)
    expect(new Set(ponte.links.map((l: { cnae7: string; nbs: string }) => `${l.cnae7}|${l.nbs}`))).toHaveLength(6641)
    expect(new Set(ponte.links.map((l: { cnae7: string }) => l.cnae7))).toHaveLength(508)
    expect(new Set(ponte.links.map((l: { nbs: string }) => l.nbs))).toHaveLength(588)
    expect(ponte.links.every((l: { nbs: string }) => /^\d{9}$/.test(l.nbs))).toBe(true)
  })

  it('tracking Google nunca virou dado (só auditoria no meta)', () => {
    // Dados (links + relações): nenhuma url/conteúdo de tracking.
    expect(JSON.stringify([...ponte.links, ...ponte.lcNbs])).not.toMatch(/google|adtrafficquality|sodar/i)
    expect(JSON.stringify(consolidado.itens)).not.toMatch(/google|adtrafficquality|sodar/i)
    // Auditoria: 1 resposta descartada, documentada no meta.
    expect(ponte.meta.respostasRedeDescartadas).toBe(1)
  })

  it('templates: 1.090 regras + 55 divergências sem regra consolidada', () => {
    expect(consolidado.itens).toHaveLength(1145)
    // Divergência de CÓDIGO: marcada, sem regra oficial consolidada.
    const divergentesCodigo = consolidado.itens.filter(
      (t: { divergencia: { tipo: string } | null }) => t.divergencia?.tipo === 'codigo-ausente-oficial',
    )
    expect(divergentesCodigo).toHaveLength(consolidado.meta.conferencia.codigosDivergentes)
    expect(divergentesCodigo.every((t: { anexoSimples: unknown[] }) => t.anexoSimples.length === 0)).toBe(true)
    expect(divergentesCodigo.every((t: { estadoNbs: string }) => t.estadoNbs === 'divergencia')).toBe(true)
    // Divergência de TEXTO: consolida com a oficial (precedência), mantém NBS.
    const divergentesTexto = consolidado.itens.filter(
      (t: { divergencia: { tipo: string } | null }) => t.divergencia?.tipo === 'descricao-divergente',
    )
    expect(divergentesTexto).toHaveLength(consolidado.meta.conferencia.textosDivergentes)
    expect(divergentesTexto.every((t: { fonteDescricao: string }) => t.fonteDescricao === 'oficial')).toBe(true)
    expect(divergentesTexto.every((t: { anexoSimples: unknown[] }) => t.anexoSimples.length > 0)).toBe(true)
    // Todo template tem vedação textual (invariante A: nenhum CNAE sem regra).
    expect(consolidado.itens.every((t: { vedacoes: unknown[] }) => t.vedacoes.length > 0)).toBe(true)
  })
})

/* ------------------------------------------------------ tracer 09-00 --- */

describe('tracer 09-00 (duplo, Dexie v13 semeada)', () => {
  it('(a) `0161-0/01 → 1.1803.21.00` ingerido + template íntegro; (b) bens com regra sem NBS', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (entrada: unknown) => {
      const nome = String(entrada).replace(/^base\//, '')
      const conteudo = readFileSync(path.join(BASE_DIR, nome), 'utf8')
      return { ok: true, status: 200, text: async () => conteudo }
    }) as unknown as typeof fetch

    try {
      const status = await semearBaseEmbutida(() => {}, true)

      // (a) link ingerido + template íntegro (regra + 1 NBS).
      const links = await db.cnaeNbs.where('[cnae7+nbs]').equals(['0161001', '118032100']).toArray()
      expect(links).toHaveLength(1)
      const tpl = await db.classificacoesConsolidadas.get('0161001')
      expect(tpl).toMatchObject({
        codigoFormatado: '0161-0/01',
        situacao: 'Permitido',
        estadoNbs: 'mapeado',
        divergencia: null,
      })
      expect(tpl?.anexoSimples.length).toBeGreaterThan(0)
      expect(tpl?.vedacoes.length).toBeGreaterThan(0)
      expect(tpl?.nbsVinculadas).toHaveLength(1)
      expect(tpl?.nbsVinculadas[0].nbs).toBe('118032100')

      // (b) CNAE de bens fora dos 508: regra completa de `db.cnae`, sem NBS.
      const regraBens = await db.cnae.get('1011201')
      expect(regraBens).toMatchObject({
        codigoFormatado: '1011-2/01',
        situacao: 'Permitido',
        anexos: ['II'],
        fatorR: false,
      })
      expect(regraBens?.descricao).toContain('Frigor')
      expect(await db.cnaeNbs.where('cnae7').equals('1011201').count()).toBe(0)
      const tplBens = await db.classificacoesConsolidadas.get('1011201')
      expect(tplBens).toMatchObject({ estadoNbs: 'sem-mapeamento', divergencia: null })
      expect(tplBens?.nbsVinculadas).toEqual([])
      expect(tplBens?.vedacoes.length).toBeGreaterThan(0)

      // Stores v13 povoadas sem `clear()` em `db.cnae`/`db.nbs` (intactas).
      expect(status).toMatchObject({ cnae: 1090, nbs: 122, cnaeNbs: 6641, lcNbs: 1739 })
      expect(status.classificacoesConsolidadas).toBe(1145)
      expect(status.resumoCnaeNbs).toBe('1.090 regras · 508 com NBS')
      const gravadas = await statusBase()
      expect(gravadas.resumoCnaeNbs).toBe('1.090 regras · 508 com NBS')
    } finally {
      globalThis.fetch = originalFetch
    }
  }, 120_000)
})
