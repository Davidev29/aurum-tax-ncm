/**
 * Cobertura de busca por descrição (serviços) — nunca volta vazia sem motivo.
 *
 * Contrato (pedido do usuário: "IA não sugere nada é inaceitável"):
 * - com benefício na base → NBS ancorado (nbs_provavel setado);
 * - sem benefício mas com setor → orientação setorial honesta + perguntas
 *   específicas + trilha com o setor (nunca "nada");
 * - sem lastro algum → pede contexto com perguntas (nunca inventa);
 * - fora de escopo real → recusa fixa;
 * - preditivas SEMPRE marcadas apenasInformativo (nunca decisão).
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'

const noop = () => undefined

function refRow(cst: string, cct: string, desc: string, anexo: string, art: string) {
  return {
    'Código da Situação Tributária': cst,
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': cct,
    'Descrição do Código da Classificação Tributária': desc,
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': anexo,
    'Url da Legislação': `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#${art}`,
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
    NFe: 'Sim',
    NFCe: 'Não',
    CTe: 'Não',
    'CTe OS': 'Não',
    BPe: 'Não',
    'BPe TM': 'Não',
    NF3e: 'Não',
    NFCom: 'Não',
    NFSe: 'Sim',
  }
}

const REFERENCIA = [
  refRow('200', '200028', 'Fornecimento dos serviços de educação (Anexo II)', '2', 'art129'),
  refRow('200', '200029', 'Fornecimento dos serviços de saúde humana (Anexo III)', '3', 'art130'),
  refRow('200', '200039', 'Fornecimento dos serviços e o licenciamento ou cessão dos direitos destinados às produções nacionais artísticas (Anexo X)', '10', 'art139'),
  refRow('200', '200043', 'Fornecimento à administração pública dos serviços e bens relativos à soberania (Anexo XI)', '11', 'art142'),
  refRow('200', '200044', 'Operações e prestações de serviços de segurança da informação e cibernética por sociedade com sócio brasileiro (Anexo XI)', '11', 'art142'),
]

function nbsRow(nbs: string, cct: string, base: string, desc: string) {
  return { NBS: nbs, CST: '200', CclassTrib: cct, 'Base Legal': base, Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': desc }
}

const NBS_BASE = [
  nbsRow('122011100', '200028', 'Fornecimento dos serviços de educação (Anexo II)', 'Serviços de educação do Anexo II, observado o art. 129.'),
  nbsRow('123011100', '200029', 'Fornecimento dos serviços de saúde humana (Anexo III)', 'Serviços de saúde ambulatorial e domiciliar, observado o art. 130.'),
  nbsRow('111031000', '200039', 'Fornecimento dos serviços e o licenciamento ou cessão dos direitos destinados às produções nacionais artísticas (Anexo X)', 'Espetáculos teatrais, circenses e de dança, shows musicais, desfiles carnavalescos, eventos acadêmicos, congressos, feiras, exposições, filmes, documentários, séries, novelas.'),
  nbsRow('115012000', '200043', 'Fornecimento à administração pública dos serviços e bens relativos à soberania (Anexo XI)', 'Serviços de segurança, administração pública, soberania, informação e cibernética.'),
  nbsRow('120013500', '200044', 'Operações e prestações de serviços de segurança da informação e cibernética por sociedade com sócio brasileiro (Anexo XI)', 'Segurança da informação e cibernética por sociedade com sócio brasileiro mínimo de vinte por cento.'),
]

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_BASE, 'NBS SERVIÇOS.json', noop)
}

beforeEach(async () => {
  await Promise.all([
    db.nbs.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
  ])
})

function trilhaTexto(s: { trilha: { etapa: string; detalhe: string }[] }) {
  return s.trilha.map((t) => `${t.etapa}: ${t.detalhe}`).join(' || ')
}

describe('com benefício → NBS ancorado', () => {
  it.each([
    ['aula de ingles online', '122.011.100'],
    ['formacao de condutores', '122.011.100'],
    ['autoescola', '122.011.100'],
    ['aula', '122.011.100'],
    ['curso de ingles', '122.011.100'],
    ['dentista', '123.011.100'],
    ['exame de sangue', '123.011.100'],
    ['consulta medica domiciliar', '123.011.100'],
    ['show', '111.031.000'],
    ['teatro', '111.031.000'],
    ['circo', '111.031.000'],
    ['cinema', '111.031.000'],
    ['festa de casamento', '111.031.000'],
    ['congresso', '111.031.000'],
    ['show de banda para festa de casamento', '111.031.000'],
    ['vigilancia patrimonial', '115.012.000'],
    ['firewall', '120.013.500'],
    ['teste de invasao', '120.013.500'],
  ])('"%s" ancora em %s', async (descricao, esperado) => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao })
    expect(s.nbs_provavel).toBe(esperado)
  })

  it('"seguranca" ancora em XI (soberania ou ciber)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'seguranca' })
    expect(s.nbs_provavel).toMatch(/115\.012\.000|120\.013\.500/)
  })

  it('"seguranca da informacao" ancora em XI (qualquer cct)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'seguranca da informacao' })
    expect(s.nbs_provavel).toMatch(/115\.012\.000|120\.013\.500/)
  })

  it('"teste de software" NÃO é fora de escopo (lastro de serviço)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'teste de software' })
    expect(s.foraDeEscopo).not.toBe(true)
    expect(trilhaTexto(s)).toMatch(/TI_SOFTWARE|CIBERSEGURANCA/)
  })

  it('palavra única conhecida sugere com confiança baixa (nunca alta sem contexto)', async () => {
    await semear()
    for (const d of ['show', 'dentista', 'autoescola', 'aula']) {
      const s = await classificarServicoPorDescricao({ descricao: d })
      expect(s.nbs_provavel).not.toBeNull()
      expect(s.confianca).toBe('baixa')
    }
  })
})

describe('sem benefício → orientação setorial honesta (nunca vazio)', () => {
  it.each([
    ['corte de cabelo', 'beleza'],
    ['manicure', 'beleza'],
    ['tatuagem', 'beleza'],
    ['spa', 'beleza'],
    ['quero cortar cabelo', 'beleza'],
    ['frete', 'transporte'],
    ['motoboy', 'transporte'],
    ['taxi', 'transporte'],
    ['diarista para limpeza de condominio', 'limpeza'],
    ['advogado', 'profission'],
    ['hotel barato', 'alimenta|turismo|hospedagem'],
    ['pintura de apartamento', 'constru'],
    ['reforma de apartamento com material incluso', 'constru'],
    ['marmita delivery', 'alimenta'],
    ['desenvolvimento de aplicativo para empresa', 'tecnologia'],
    ['petshop', null],
  ])('"%s" orienta sem inventar NBS', async (descricao, setor) => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao })
    expect(s.nbs_provavel).toBeNull()
    // Nunca "nada": justificativa útil + perguntas + trilha auditável.
    expect(s.justificativa.length).toBeGreaterThan(40)
    expect(s.perguntasComplementares.length).toBeGreaterThan(0)
    expect(s.trilha.length).toBeGreaterThan(0)
    if (setor) {
      const tudo = `${s.justificativa} || ${trilhaTexto(s)}`
      expect(tudo).toMatch(new RegExp(setor, 'i'))
    }
  })

  it('"consultoria contabil" NÃO sugere benefício errado (filtro juridiquês)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'consultoria contabil para empresa' })
    expect(s.nbs_provavel).toBeNull()
    expect(s.cClassTrib).not.toBe('200039')
    expect(s.perguntasComplementares.length).toBeGreaterThan(0)
  })
})

describe('negativas e escopo', () => {
  it('"nave espacial quantica" não inventa e não sugere pista sem lastro', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'nave espacial quantica' })
    expect(s.nbs_provavel).toBeNull()
    expect(s.sugestoesPreditivas ?? []).toHaveLength(0)
    expect(s.perguntasComplementares.length).toBeGreaterThan(0)
  })

  it('"receita de bolo" é fora de escopo', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'receita de bolo' })
    expect(s.foraDeEscopo).toBe(true)
    expect(s.nbs_provavel).toBeNull()
  })

  it('"teste" sozinho é fora de escopo (marcador sem lastro)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'teste' })
    expect(s.foraDeEscopo).toBe(true)
  })

  it('"oi" pede contexto (insuficiente com perguntas)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'oi' })
    expect(s.nbs_provavel).toBeNull()
    expect(s.perguntasComplementares.length).toBeGreaterThan(0)
  })
})

describe('preditivas nunca são decisão', () => {
  it('toda sugestão preditiva é apenas informativa', async () => {
    await semear()
    const consultas = [
      'corte de cabelo',
      'frete com destino ao exterior',
      'consulta medica domiciliar',
      'show de banda para festa de casamento',
      'nave espacial quantica',
    ]
    for (const descricao of consultas) {
      const s = await classificarServicoPorDescricao({ descricao })
      for (const p of s.sugestoesPreditivas ?? []) {
        expect(p.apenasInformativo).toBe(true)
        expect(p.aviso.length).toBeGreaterThan(10)
      }
    }
  })
})
