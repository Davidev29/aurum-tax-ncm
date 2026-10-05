/**
 * Phase 9 / 09-05 — chat IA: regra p/ 1.090, NBS só com link.
 *
 * Cobre o plano 09-05 §5 (rev. 2):
 * - detector: `cnae + (nbs|beneficio|reforma|anexo|vedado|fatorR)` antes do
 *   `generico`, sem quebrar `__COMPARAR_*__` nem intenções existentes
 *   (vocab-s03: pedido dos códigos DA atividade continua NBS);
 * - tools: `consultarCnaeNbs` em `PLANO_TOOL_CALLING` + `toolParaIntencao` +
 *   `REGISTRO_FERRAMENTAS` + `ferramentasParaIntencao` + `executarFerramenta`
 *   (dynamic import, sem rede);
 * - chat: `responderCnae` (bloco Regras sempre + bloco NBS condicional +
 *   botão `Abrir Consulta de CNAEs`); caminho CNPJ (`responderCnpj` por
 *   atividade, `responderSimples` com CNAE no contexto) anexa
 *   `NBS: N (M com benefício, ref. <ano>)` ou a faixa de bens.
 *
 * PROIBIÇÕES verificadas aqui: nunca inventar NBS/benefício sem lastro;
 * nunca alterar números do DAS; nunca tocar fora do chat.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { detectarIntencaoChat, extrairCnae } from '@/domain/services/detector-chat'
import { PLANO_TOOL_CALLING, toolParaIntencao } from '@/application/aurum-ai-tools'
import {
  executarFerramenta,
  ferramentasParaIntencao,
} from '@/application/aurum-ai-registro-ferramentas'
import { responderChat } from '@/application/aurum-ai-chat'
import { blocoNbsDoCnae, extrairAnoReferenciaCnae } from '@/application/aurum-ai-chat'
import { consultarPorCnae } from '@/application/consultar-por-cnae'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'

const noop = () => undefined

const REFERENCIA = [
  {
    'Código da Situação Tributária': '200',
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': '200028',
    'Descrição do Código da Classificação Tributária': 'Fornecimento dos serviços de educação (Anexo II)',
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '2',
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art129',
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
  },
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 60, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
  { NBS: '125011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 60, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços culturais do Anexo II.' },
]

const CNAE_VIVO = [
  { CNAE: '0161-0/01', 'Descrição oficial': 'Serviço de pulverização e controle de pragas agrícolas', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '1011-2/01', 'Descrição oficial': 'Frigorífico — abate de bovinos', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
  { CNAE: '6201-5/01', 'Descrição oficial': 'Desenvolvimento de programas de computador sob encomenda', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '8511-2/00', 'Descrição oficial': 'Educação infantil — creche', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '4322-3/03', 'Descrição oficial': 'Instalações de sistema de prevenção contra incêndio', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
]

/** 5 NBS sintéticas (ranking resumido: destaque + top 3 + resto 2). */
const NBS_4322 = ['300000001', '300000002', '300000003', '300000004', '300000005']

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
  await db.cnaeNbs.bulkAdd([
    { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' },
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '122011100', fonte: 'por_codigo' },
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '125011100', fonte: 'por_codigo' },
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '122011200', fonte: 'por_codigo' },
    ...NBS_4322.map((nbs) => ({ cnae7: '4322303', cnae: '4322-3/03', nbs, fonte: 'por_codigo' as const })),
  ])
  // CNPJ em cache (TTL 30d): caminho CNPJ do chat sem I/O de rede.
  await db.consultasCnpj.put({
    cnpj: '11222333000181',
    razaoSocial: 'Escola Teste LTDA',
    fantasia: 'Escola Teste',
    porte: null,
    situacao: 'ATIVA',
    opcaoSimples: true,
    cnaePrincipal: '8511200',
    cnaesSecundarios: ['0161001'],
    quando: new Date().toISOString(),
  })
}

beforeEach(async () => {
  const { limparCacheVereditosNbs } = await import('@/domain/services/cnae-nbs')
  limparCacheVereditosNbs()
  await Promise.all([
    db.cnae.clear().catch(() => undefined),
    db.cnaeNbs.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.classificacoesConsolidadas.clear().catch(() => undefined),
    db.consultasCnpj.clear().catch(() => undefined),
    db.table('audit_log').clear().catch(() => undefined),
  ])
  await semear()
})

/* ------------------------------------------------------- detector 09-05 --- */

describe('detector 09-05 — cnae + (nbs|beneficio|reforma|anexo|vedado|fatorR)', () => {
  it('CNAE + NBS/benefícios com código → cnae (antes de generico/nbs)', () => {
    const a = detectarIntencaoChat('CNAE 0161-0/01 quais NBS e benefícios?')
    expect(a.intencao).toBe('cnae')
    expect(a.cnae).toBe('0161001')
  })

  it('anexo + NBS do CNAE com código → cnae', () => {
    expect(detectarIntencaoChat('qual anexo e NBS do CNAE 6201-5/01?').intencao).toBe('cnae')
  })

  it('pergunta sobre o próprio CNAE sem código → cnae (pede o código ou herda)', () => {
    expect(detectarIntencaoChat('meu cnae tem benefício na reforma?').intencao).toBe('cnae')
    expect(detectarIntencaoChat('esse cnae é vedado no simples?').intencao).toBe('cnae')
  })

  it('preserva NBS: pedir OS códigos da atividade continua nbs (vocab-s03)', () => {
    expect(detectarIntencaoChat('me diz o cnae e o nbs para curso de idioma?').intencao).toBe('nbs')
    expect(detectarIntencaoChat('qual atividade e o cnae para aula de yoga?').intencao).toBe('nbs')
  })

  it('preserva Simples: RBT/receita com menção a cnae continua simples', () => {
    expect(
      detectarIntencaoChat('Anexo III, RBT12 500 mil, receita 40 mil pro meu cnae').intencao,
    ).toBe('simples')
  })

  it('__COMPARAR_*__ intactos (nunca viram cnae)', () => {
    expect(
      detectarIntencaoChat('__COMPARAR_ANEXOS__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO_ATUAL=III').intencao,
    ).not.toBe('cnae')
    expect(
      detectarIntencaoChat('__COMPARAR_HIBRIDO__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO=III DESPESA=0').intencao,
    ).not.toBe('cnae')
  })

  it('extrairCnae com lastro nbs|beneficio (além de cnae|anexo)', () => {
    expect(extrairCnae('quais NBS do 0161001?')).toBe('0161001')
    expect(extrairCnae('benefícios do cnae 0161001?')).toBe('0161001')
    expect(extrairCnae('CNAE 6201-5/01 qual anexo?')).toBe('6201501')
    // Sem lastro, 7 dígitos isolados continuam sem extrair (não é CEST).
    expect(extrairCnae('0161001')).toBeNull()
  })

  it('extrairAnoReferenciaCnae: 2026/2027/2033 ou null (padrão 2033)', () => {
    expect(extrairAnoReferenciaCnae('CNAE 0161-0/01 quais NBS em 2027?')).toBe(2027)
    expect(extrairAnoReferenciaCnae('CNAE 0161-0/01 quais NBS e benefícios?')).toBeNull()
  })
})

/* ------------------------------------------------------- tools 09-05 --- */

describe('tools 09-05 — consultarCnaeNbs', () => {
  it("toolParaIntencao('cnae') → consultarCnaeNbs", () => {
    expect(toolParaIntencao('cnae')).toBe('consultarCnaeNbs')
  })

  it('PLANO_TOOL_CALLING documenta inputs cnae+anoReferencia e guardrails honestos', () => {
    const spec = PLANO_TOOL_CALLING.find((s) => s.tool === 'consultarCnaeNbs')
    expect(spec).toBeDefined()
    expect(spec?.inputs.join(' ')).toContain('cnae')
    expect(spec?.inputs.join(' ')).toContain('anoReferencia')
    expect(spec?.guardrail).toMatch(/sem-mapeamento/i)
    expect(spec?.guardrail).toMatch(/nunca inventar/i)
    expect(spec?.escreveNoSistema).toBe(false)
  })

  it("ferramentasParaIntencao('cnae') inclui consultarCnaeNbs", () => {
    expect(ferramentasParaIntencao('cnae')).toContain('consultarCnaeNbs')
  })

  it('executarFerramenta consultarCnaeNbs: 0161-0/01 → 1 veredito com ano (sem rede)', async () => {
    const r = await executarFerramenta('consultarCnaeNbs', { cnae: '0161-0/01' })
    expect(r.ok).toBe(true)
    const dados = r.dados as { estadoNbs: string; vereditos: { nbs: string; anoReferencia: number }[]; anoReferencia: number }
    expect(dados.estadoNbs).toBe('mapeado')
    expect(dados.vereditos).toHaveLength(1)
    expect(dados.vereditos[0].nbs).toBe('118032100')
    expect(dados.vereditos[0].anoReferencia).toBe(2033)
  })

  it('executarFerramenta consultarCnaeNbs sem cnae → erro honesto', async () => {
    const r = await executarFerramenta('consultarCnaeNbs', {})
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('cnae-ausente')
  })
})

/* ------------------------------------------------------- chat 09-05 --- */

describe('chat 09-05 — responderCnae (regra sempre, NBS só com link)', () => {
  it('CNAE 0161-0/01 quais NBS e benefícios? cita NBS + ano + botão CNAEs', async () => {
    const r = await responderChat('CNAE 0161-0/01 quais NBS e benefícios?')
    expect(r.tipoCodigo).toBe('cnae')
    expect(r.exato).toBe(true)
    expect(r.texto).toContain('118.032.100')
    expect(r.texto).toContain('ref. 2033')
    expect(r.texto).toMatch(/Anexo Simples/)
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.botoes?.some((b) => b.acao === 'navegar' && b.alvo === 'cnaes')).toBe(true)
  }, 30000)

  it('bens → regra + faixa bens→NCM, sem NBS inventado', async () => {
    const r = await responderChat('CNAE 1011-2/01 qual anexo e NBS?')
    expect(r.tipoCodigo).toBe('cnae')
    expect(r.texto).toMatch(/Anexo Simples II/)
    expect(r.texto).toMatch(/bens/)
    expect(r.texto).toMatch(/NCM/)
    expect(r.texto).not.toMatch(/NBS \d/)
  }, 30000)

  it('fora dos 508 → regra completa + sem-mapeamento honesto, sem NBS inventado', async () => {
    const r = await responderChat('CNAE 6201-5/01 quais NBS e benefícios?')
    expect(r.tipoCodigo).toBe('cnae')
    expect(r.texto).toMatch(/Anexo Simples III/)
    expect(r.texto).toMatch(/sem mapeamento/i)
    expect(r.texto).not.toMatch(/NBS \d/)
  }, 30000)

  it('ano citado na pergunta aparece no bloco NBS', async () => {
    const r = await responderChat('CNAE 0161-0/01 quais NBS em 2027?')
    expect(r.texto).toContain('118.032.100')
    expect(r.texto).toContain('ref. 2027')
  }, 30000)

  it('educação com benefício do resolvedor: redução + ano, sem chute', async () => {
    const r = await responderChat('CNAE 8511-2/00 quais NBS e benefícios?')
    expect(r.texto).toContain('122.011.100')
    expect(r.texto).toMatch(/reduç/)
    expect(r.texto).toContain('ref. 2033')
  }, 30000)

  it('ranking resumido: destaque + top 3 + resto honesto', async () => {
    const r = await responderChat('CNAE 4322-3/03 quais NBS e benefícios?')
    expect(r.texto).toMatch(/NBS vinculadas \(5,/)
    expect(r.texto).toContain('ref. 2033')
    expect(r.texto).toContain('…e mais 2 NBS')
  }, 30000)

  it('CNAE inexistente continua funil (do que se trata)', async () => {
    const r = await responderChat('CNAE 9999-9/99 qual anexo?')
    expect(r.texto).toMatch(/Do que se trata/i)
  }, 30000)

  it('blocoNbsDoCnae puro: 3 estados com ano, sem inventar', async () => {
    const mapeado = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(blocoNbsDoCnae(mapeado)).toContain('118.032.100')
    expect(blocoNbsDoCnae(mapeado)).toContain('ref. 2033')
    const bens = await consultarPorCnae('1011-2/01', { anoReferencia: 2033 })
    expect(blocoNbsDoCnae(bens)).toMatch(/bens.*NCM/)
    expect(blocoNbsDoCnae(bens)).not.toMatch(/NBS \d/)
    const sem = await consultarPorCnae('6201-5/01', { anoReferencia: 2033 })
    expect(blocoNbsDoCnae(sem)).toMatch(/sem mapeamento/i)
    expect(blocoNbsDoCnae(sem)).not.toMatch(/NBS \d/)
  }, 30000)
})

/* ------------------------------------------------------- caminho CNPJ 09-05 --- */

describe('chat 09-05 — caminho CNPJ anexa NBS com ano (sem rede, sem tocar no DAS)', () => {
  it('responderCnpj (cache, sem rede): NBS por atividade com benefício e ano', async () => {
    const r = await responderChat('Quais atividades o CNPJ 11.222.333/0001-81 tem?')
    expect(r.texto).toMatch(/Atividades \(2\)/)
    // Educação: 3 NBS (2 com benefício de 60% do resolvedor, ref. 2033).
    expect(r.texto).toContain('NBS: 3 (2 com benefício, ref. 2033)')
    // Pulverização: 1 NBS sem lastro (regra geral) — honesto, sem benefício.
    expect(r.texto).toContain('NBS: 1 (0 com benefício, ref. 2033)')
  }, 60000)

  it('responderSimples com CNAE no contexto: DAS intacto + linha NBS', async () => {
    const historico = [
      { papel: 'user' as const, texto: 'CNAE 0161-0/01 qual anexo?' },
      { papel: 'assistant' as const, texto: 'CNAE 0161-0/01 — Anexo Simples III.' },
    ]
    const r = await responderChat(
      'Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil',
      historico,
    )
    expect(r.texto).toContain('DAS')
    expect(r.texto).toContain('NBS: 1 (0 com benefício, ref. 2033)')
  }, 30000)
})
