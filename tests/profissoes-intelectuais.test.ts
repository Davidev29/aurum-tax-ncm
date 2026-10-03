/**
 * Profissões intelectuais (art. 127/202, 200/200052, −30%) — contabilista,
 * contador, advogado, engenheiro e as demais 14 profissões.
 *
 * Fato legal: a base da Reforma TEM o benefício (200/200052), mas NENHUM NBS
 * está vinculado a ele. O contrato honesto da busca por descrição:
 * - nbs_provavel continua null (sem NBS — sem invenção);
 * - hipótese 200052 aparece como preditiva informativa COM contexto
 *   personalizado (condição do conselho, aplica/não-aplica);
 * - a justificativa LIDERA com a hipótese (nunca "sem benefício");
 * - `91271` (código interno de regime) jamais é exibido como anexo da LC.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'
import { sugerirPreditivoServicos } from '@/domain/services/preditivo-servicos'
import { descricaoHipotese } from '@/domain/services/verificacao-servicos'
import { grupoDoCct } from '@/domain/constants/contexto-nbs'

const noop = () => undefined

const REF_200052 = {
  'Código da Situação Tributária': '200',
  'Descrição da Situação Tributária': 'Alíquota reduzida',
  'Código da Classificação Tributária': '200052',
  'Descrição do Código da Classificação Tributária': 'Prestação de serviços das seguintes profissões intelectuais de natureza científica, literária ou artística, submetidas à fiscalização por conselho profissional: administradores, advogados, arquitetos e urbanistas, assistentes sociais, bibliotecários, biólogos, contabilistas, economistas, economistas domésticos, profissionais de educação física, engenheiros e agrônomos, estatísticos, médicos veterinários e zootecnistas, museólogos, químicos, profissionais de relações públicas, técnicos industriais e técnicos agrícolas, observado o art. 127 da Lei Complementar nº 214, de 2025.',
  'Percentual Redução IBS': 30,
  'Percentual Redução CBS': 30,
  'Tipo de Alíquota': '2 - Padrão',
  'Número do Anexo': '91271',
  'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art127',
  'Exige Tributação': 'Sim',
  'Redução BC CST': 'Não',
  'Redução de Alíquota': 'Sim',
  'Transferência de Crédito': 'Não',
  Diferimento: 'Não',
  Monofásica: 'Não',
  'Crédito Presumido IBS Zona Franca de Manaus': 'Não',
  'Ajuste de Competência': 'Não',
  'Tributação Regular': 'Não',
  'Crédito Presumido': 'Não',
  'Estorno de Crédito': 'Não',
  'Tributação Monofásica Normal': 'Não',
  'Tributação Monofásica sujeita a retenção': 'Não',
  'Tributação Monofásica retida anteriormente': 'Não',
  'Tributação Monofásica de Combustível com diferimento': 'Não',
  NFe: 'Não',
  NFCe: 'Não',
  CTe: 'Não',
  'CTe OS': 'Não',
  BPe: 'Não',
  'BPe TM': 'Não',
  NF3e: 'Não',
  NFCom: 'Não',
  NFSe: 'Sim',
}

async function semear() {
  await db.nbs.clear().catch(() => undefined)
  await db.referencia.clear().catch(() => undefined)
  await db.cst.clear().catch(() => undefined)
  await db.cstClassTrib.clear().catch(() => undefined)
  await importarBase([REF_200052], 'classificacao_tributaria.json', noop)
}

describe('profissões retornam a hipótese 200/200052 (não vazio)', () => {
  it.each([
    'advogado',
    'advogados',
    'contador',
    'contabilista',
    'engenheiro',
    'administrador',
    'arquiteto',
  ])('"%s" sugere a hipótese com contexto', async (descricao) => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao })
    // Sem NBS vinculado: sem invenção de código...
    expect(s.nbs_provavel).toBeNull()
    // ...mas COM hipótese informativa e contexto personalizado.
    const hips = (s.sugestoesPreditivas ?? []).filter((p) => p.tipo === 'hipotese-cct')
    expect(hips.length).toBeGreaterThan(0)
    expect(hips[0].cClassTrib).toBe('200052')
    expect(hips[0].reducaoIBS).toBe(30)
    expect(hips[0].apenasInformativo).toBe(true)
    expect(hips[0].titulo).toMatch(/art\. 127/)
    expect(hips[0].contexto?.grupo).toBe('PROF-30')
    expect(hips[0].contexto?.condicoes.join(' ')).toMatch(/conselho/i)
  })

  it('justificativa lidera com a hipótese (sem contradição "sem benefício")', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'contador' })
    expect(s.justificativa).toMatch(/hipótese de benefício/i)
    expect(s.justificativa).toMatch(/200052/)
    expect(s.justificativa).not.toMatch(/não há NBS\/benefício mapeado/)
    expect(s.tipo_excecao).toMatch(/200052/)
  })

  it('preditivo direto ancora no grupo PROF-30', async () => {
    await semear()
    const lista = await sugerirPreditivoServicos('engenheiro civil')
    expect(lista.length).toBeGreaterThan(0)
    expect(lista[0].cClassTrib).toBe('200052')
    expect(lista[0].contexto?.grupo).toBe('PROF-30')
  })
})

describe('grupo e anexo da hipótese', () => {
  it('200052 mapeia para PROF-30', () => {
    expect(grupoDoCct('200052')).toBe('PROF-30')
    expect(grupoDoCct('200028')).toBe('EDU')
    expect(grupoDoCct('999999')).toBeNull()
  })

  it('91271 nunca é exibido como anexo da LC 214', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'advogado' })
    const texto = `${s.justificativa} ${(s.sugestoesPreditivas ?? []).map((p) => `${p.titulo} ${p.anexo ?? ''}`).join(' ')}`
    expect(texto).not.toMatch(/91271/)
    expect(
      descricaoHipotese({
        cst: '200',
        cClassTrib: '200052',
        reducaoIBS: 30,
        reducaoCBS: 30,
        anexo: '91271',
        descricao: 'x',
        baseLegal: 'Art. 127',
        urlLegislacao: null,
        temNbs: false,
        cobertura: 1,
        origem: 'texto',
      }),
    ).toBe('200/200052 — redução de 30% — Art. 127')
  })
})
