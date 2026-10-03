/**
 * Cobertura ampla dos benefícios de serviços (fine-tuning v4) — todos os
 * casos com NFSE e redução/diferimento > 0 têm hipótese com contexto.
 *
 * Matriz coberta (cct → grupo): 011003, 200001, 200016, 200017, 200019,
 * 200020, 200021, 200025, 200026, 200027, 200037, 200040, 200041(+200042),
 * 200046, 200048, 200051, 515001 — além dos 6 grupos com NBS/histórico.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { sugerirPreditivoServicos } from '@/domain/services/preditivo-servicos'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'
import { grupoDoCct } from '@/domain/constants/contexto-nbs'
import { pinsHipotesesPorCnae } from '@/domain/services/verificacao-servicos'

const noop = () => undefined

function refRow(cst: string, cct: string, desc: string, anexo: string, redIBS: number, redCBS: number, url: string) {
  return {
    'Código da Situação Tributária': cst,
    'Descrição da Situação Tributária': 'x',
    'Código da Classificação Tributária': cct,
    'Descrição do Código da Classificação Tributária': desc,
    'Percentual Redução IBS': redIBS,
    'Percentual Redução CBS': redCBS,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': anexo,
    'Url da Legislação': url,
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

const U = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'

const REFERENCIA = [
  refRow('011', '011003', 'Intermediação de planos de assistência à saúde, observado o art. 240 da Lei Complementar nº 214, de 2025.', '92401', 60, 60, `${U}#art240`),
  refRow('200', '200001', 'Serviços de transporte de bens até as zonas de processamento de exportação e bens exportados a partir das zonas de processamento de exportação, observado o art. 103 da Lei Complementar n 214, de 2025.', '', 100, 100, `${U}#art103`),
  refRow('200', '200016', 'Prestação de serviços de pesquisa e desenvolvimento por Instituição Científica, Tecnológica e de Inovação (ICT) sem fins lucrativos para a administração pública direta, autarquias e fundações públicas ou para o contribuinte sujeito ao regime regular do IBS e da CBS, observado o disposto no art. 156 da Lei Complementar nº 214, de 2025.', '91561', 100, 100, `${U}#art156`),
  refRow('200', '200017', 'Operações relacionadas ao FGTS, considerando aquelas necessárias à aplicação da Lei nº 8.036, de 1990, realizadas pelo Conselho Curador ou Secretaria Executiva do FGTS, observado o art. 212 da Lei Complementar nº 214, de 2025.', '', 100, 100, `${U}#art212`),
  refRow('200', '200019', 'Importador dos serviços financeiros que seja contribuinte e tenha direito de apropriação de créditos na aquisição do mesmo serviço financeiro no País, observado o art. 231 da Lei Complementar nº 214, de 2025.', '', 100, 100, `${U}#art231`),
  refRow('200', '200020', 'Operação praticada por sociedades cooperativas optantes por regime específico do IBS e CBS, quando o associado destinar bem ou serviço à cooperativa de que participa, e a cooperativa fornecer bem ou serviço ao associado sujeito ao regime regular do IBS e da CBS, observado o art. 271 da Lei Complementar nº 214, de 2025.', '', 100, 100, `${U}#art271`),
  refRow('200', '200021', 'Serviços de transporte público coletivo de passageiros ferroviário e hidroviário urbanos, semiurbanos e metropolitanos, observado o art. 285 da Lei Complementar nº 214, de 2025.', '', 100, 100, `${U}#art285`),
  refRow('200', '200025', 'Fornecimento dos serviços de educação relacionados ao Programa Universidade para Todos (Prouni), instituído pela Lei nº 11.096, de 13 de janeiro de 2005, observado o art. 308 da Lei Complementar nº 214, de 2025.', '93081', 60, 100, `${U}#art308`),
  refRow('200', '200026', 'Locação de imóveis localizados nas zonas reabilitadas, pelo prazo de 5 (cinco) anos, contado da data de expedição do habite-se, e relacionados a projetos de reabilitação urbana de zonas históricas, observado o art. 158 da Lei Complementar nº 214, de 2025.', '91581', 80, 80, `${U}#art158`),
  refRow('200', '200027', 'Operações de locação, cessão onerosa e arrendamento de bens imóveis, observado o art. 261 da Lei Complementar nº 214, de 2025.', '92611', 70, 70, `${U}#art261`),
  refRow('200', '200028', 'Fornecimento dos serviços de educação relacionados no Anexo II da Lei Complementar nº 214, de 2025.', '2', 60, 60, `${U}#art129`),
  refRow('200', '200037', 'Fornecimento de serviços ambientais de conservação ou recuperação da vegetação nativa, em conformidade com a legislação específica, observado o art. 137 da Lei Complementar nº 214, de 2025.', '', 60, 60, `${U}#art137`),
  refRow('200', '200040', 'Fornec dos seguintes serv de comunic instit à admin púb direta, autarq e fund púb: serviços de páginas eletrônicas, redes sociais e relações com a imprensa, observado o art. 140 da Lei Complementar nº 214, de 2025.', '', 60, 60, `${U}#art140`),
  refRow('200', '200041', 'Operações relacionadas às seguintes atividades desportivas: fornecimento de serviço de educação desportiva e gestão e exploração do desporto por associações e clubes esportivos filiados, observado o art. 141 da Lei Complementar nº 214, de 2025.', '91411', 60, 60, `${U}#art141`),
  refRow('200', '200042', 'Operações relacionadas às seguintes atividades desportivas: gestão e exploração do desporto por associações e clubes esportivos filiados, observado o art. 141 da Lei Complementar nº 214, de 2025.', '', 60, 60, `${U}#art141`),
  refRow('200', '200046', 'Operações com bens imóveis, observado o art. 261 da Lei Complementar nº 214, de 2025.', '', 50, 50, `${U}#art261`),
  refRow('200', '200048', 'Hotelaria, Parques de Diversão e Parques Temáticos, observado o art. 281 da Lei Complementar nº 214, de 2025.', '92811', 40, 40, `${U}#art281`),
  refRow('200', '200051', 'Agências de Turismo, observado o art. 289 da Lei Complementar nº 214, de 2025.', '', 40, 40, `${U}#art289`),
  refRow('515', '515001', 'Operações, sujeitas a diferimento, com insumos agropecuários e aquícolas, observado o art. 138 da Lei Complementar nº 214, de 2025.', '9', 60, 60, `${U}#art138`),
]

async function semear() {
  await db.nbs.clear().catch(() => undefined)
  await db.referencia.clear().catch(() => undefined)
  await db.cst.clear().catch(() => undefined)
  await db.cstClassTrib.clear().catch(() => undefined)
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
}

async function cctsDe(descricao: string): Promise<string[]> {
  const s = await classificarServicoPorDescricao({ descricao })
  return (s.sugestoesPreditivas ?? []).map((p) => p.cClassTrib ?? '')
}

describe('cada benefício de serviço tem hipótese', () => {
  it.each([
    ['corretor de plano de saúde', '011003'],
    ['frete para zpe', '200001'],
    ['pesquisa científica', '200016'],
    ['fgts', '200017'],
    ['importação de serviço financeiro', '200019'],
    ['cooperativa', '200020'],
    ['metrô', '200021'],
    ['recuperação de mata nativa', '200037'],
    ['site para prefeitura', '200040'],
    ['hotel', '200048'],
    ['agência de viagens', '200051'],
    ['insumo agropecuário', '515001'],
  ])('"%s" → hipótese %s', async (descricao, cct) => {
    await semear()
    expect(await cctsDe(descricao)).toContain(cct)
  })

  it('"aluguel em zona histórica" prioriza 200026 sobre 200027', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'aluguel em zona histórica' })
    const cods = (s.sugestoesPreditivas ?? []).map((p) => p.cClassTrib)
    expect(cods).toContain('200026')
    expect(cods[0]).toBe('200026')
  })

  it('"faculdade prouni" prioriza 200025 sobre a educação geral', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'faculdade prouni' })
    const cods = (s.sugestoesPreditivas ?? []).map((p) => p.cClassTrib)
    expect(cods).toContain('200025')
    expect(cods[0]).toBe('200025')
  })

  it('"escolinha de futebol" → esporte federado', async () => {
    await semear()
    expect(await cctsDe('escolinha de futebol')).toContain('200041')
  })

  it('"operação com imóvel" inclui 200046', async () => {
    await semear()
    expect(await cctsDe('operação com imóvel')).toContain('200046')
  })
})

describe('contexto e rótulos das novas hipóteses', () => {
  it('hipótese carrega grupo, rótulo curto e condições', async () => {
    await semear()
    const lista = await sugerirPreditivoServicos('hotel resort')
    const h = lista.find((p) => p.cClassTrib === '200048')!
    expect(h).toBeDefined()
    expect(h.titulo).toMatch(/art\. 281/)
    expect(h.contexto?.grupo).toBe('HOTEL')
    expect(h.reducaoIBS).toBe(40)
  })

  it('anexo interno nunca vaza; Anexo IX vira romano', async () => {
    await semear()
    const l1 = await sugerirPreditivoServicos('faculdade prouni')
    expect(l1.find((p) => p.cClassTrib === '200025')?.anexo).toBeNull()
    const l2 = await sugerirPreditivoServicos('insumo agropecuário')
    expect(l2.find((p) => p.cClassTrib === '515001')?.anexo).toBe('IX')
  })

  it('grupoDoCct cobre os novos ccts (200042 cai em ESPORTE)', () => {
    expect(grupoDoCct('011003')).toBe('SAUDE-INTERM')
    expect(grupoDoCct('200001')).toBe('TRANSP-ZPE')
    expect(grupoDoCct('200042')).toBe('ESPORTE')
    expect(grupoDoCct('200048')).toBe('HOTEL')
    expect(grupoDoCct('200051')).toBe('TURISMO')
    expect(grupoDoCct('515001')).toBe('DIFER-INSUMO')
  })

  it('justificativa lidera com a hipótese (hotel)', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'hotel para viagem' })
    expect(s.nbs_provavel).toBeNull()
    expect(s.justificativa).toMatch(/hipótese de benefício/i)
    expect(s.tipo_excecao).toMatch(/200048/)
  })
})

describe('pins CNAE → hipóteses (fluxo CNPJ)', () => {
  it.each([
    ['6911701', ['200052']],
    ['6920601', ['200052']],
    ['7111100', ['200052']],
    ['5510801', ['200048']],
    ['7911200', ['200051']],
    ['9313100', ['200041', '200042']],
    ['8610101', ['200029']],
    ['8599601', ['200028', '200025']],
    ['6810201', ['200027', '200046']],
    ['9001901', ['200039']],
  ])('CNAE %s → %s', (cnae, ccts) => {
    expect(pinsHipotesesPorCnae(cnae)).toEqual(ccts)
  })
})
