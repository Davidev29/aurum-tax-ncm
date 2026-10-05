/**
 * Regressão do print: "Tem algum ncm de danone?" → "só tem esse?" classificava
 * o andaime (NCM 8471.49.00) em vez de listar os enquadramentos do NCM
 * anterior (0403.20.00). Causas: `norm()` só-dígitos no re-ancoramento +
 * contexto que ignorava o código formatado da assistente.
 *
 * + Memória persistente e aprendizado contínuo (nome, confirmação/correção).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import { extrairContextoConversa } from '@/application/aurum-ai-tools'
import {
  ehPerguntaMemoria,
  extrairNomeDeTexto,
  extrairSinalAprendizado,
} from '@/application/aurum-ai-memoria'
import { db } from '@/infrastructure/db/schema'

const NCM_DANONE = '04032000'

const vinculo = (codigo: string, cst: string, cClassTrib: string) => ({
  id: `${codigo}|${cst}|${cClassTrib}`,
  codigo,
  codigoFormatado: codigo,
  cst,
  cClassTrib,
  baseLegal: `${cst}/${cClassTrib}`,
  reducao: null,
  aliquotaIBS: null,
  aliquotaCBS: null,
  descricao: '',
  documentos: '',
})

const cct = (cst: string, cClassTrib: string, pRed: number) => ({
  id: `${cst}|${cClassTrib}`,
  cst,
  cClassTrib,
  nome: `Classe ${cClassTrib}`,
  descricao: `Descrição ${cClassTrib}.`,
  lcRedacao: null,
  lcRef: 'Art. 999',
  tipoAliquota: 'Padrão',
  pRedIBS: pRed,
  pRedCBS: pRed,
  indRedutorBC: 0,
  indTribRegular: 0,
  indCredPres: 0,
  indMono: 0,
  indMonoReten: 0,
  indMonoRet: 0,
  indMonoDif: 0,
  creditoPara: null,
  inicioVigencia: null,
  fimVigencia: null,
  atualizadoEm: null,
})

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear(),
    db.ncmNomenclatura.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.reclassificacoesManuais.clear(),
    db.meta.clear(),
  ])
  try {
    localStorage.clear()
  } catch { /* shim */ }
  const { invalidarCacheBuscaTexto } = await import('@/infrastructure/base/classificacao-repo')
  invalidarCacheBuscaTexto()
  await db.cst.bulkPut([
    {
      codigo: '200', descricao: 'Alíquota reduzida', indIBSCBS: true, indIBSCBSMono: false,
      indReducao: true, indDiferimento: false, indTransferenciaCredito: false,
      docs: { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false },
    },
  ])
  await db.cstClassTrib.bulkPut([
    cct('200', '200034', 60),
    cct('200', '200035', 60),
  ])
  await db.ncmNomenclatura.bulkPut([
    { codigo: NCM_DANONE, codigoOriginal: NCM_DANONE, descricao: 'Iogurte', dataInicio: null, dataFim: null, ato: null },
  ])
  await db.ncm.bulkPut([
    vinculo(NCM_DANONE, '200', '200034'),
    vinculo(NCM_DANONE, '200', '200035'),
  ])
})

describe('contexto follow-up (bug do print)', () => {
  it('extrai o NCM formatado da resposta da assistente', () => {
    const ctx = extrairContextoConversa([
      { papel: 'user', texto: 'Tem algum ncm de danone?' },
      { papel: 'assistant', texto: 'Classificação sugerida: NCM 0403.20.00 — Iogurte' },
      { papel: 'user', texto: 'só tem esse?' },
    ])
    expect(ctx.ultimoCodigoNcm).toBe(NCM_DANONE)
    expect(ctx.ultimoAssunto).toBe('danone')
  })

  it('"só tem esse?" lista os enquadramentos do NCM anterior (não reclassifica o andaime)', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Tem algum ncm de danone?' },
      { papel: 'assistant' as const, texto: 'Classificação sugerida: NCM 0403.20.00 — Iogurte. Enquadramento CST 200 · cClassTrib 200034.' },
      { papel: 'user' as const, texto: 'só tem esse?' },
    ]
    const r = await responderChat('só tem esse?', hist)
    expect(r.texto).toContain('0403.20.00')
    expect(r.texto).not.toContain('8471')
    expect(r.texto).toMatch(/2 enquadramentos/)
  }, 15000)
})

describe('memória persistente (perfil + aprendizado)', () => {
  it('extrai nome declarado e rejeita atividade como nome', () => {
    expect(extrairNomeDeTexto('meu nome é David')).toBe('David')
    expect(extrairNomeDeTexto('me chamo Ana Souza')).toBe('Ana Souza')
    expect(extrairNomeDeTexto('me chama de Dani')).toBe('Dani')
    expect(extrairNomeDeTexto('sou comerciante')).toBeNull()
    expect(extrairNomeDeTexto('tem algum ncm de banana?')).toBeNull()
  })

  it('detecta pergunta sobre a memória', () => {
    expect(ehPerguntaMemoria('qual meu nome?')).toBe(true)
    expect(ehPerguntaMemoria('o que você sabe sobre mim?')).toBe(true)
    expect(ehPerguntaMemoria('tem algum ncm de banana?')).toBe(false)
  })

  it('detecta sinais de aprendizado', () => {
    expect(extrairSinalAprendizado('não é esse')).toBe('correcao')
    expect(extrairSinalAprendizado('isso mesmo')).toBe('confirmacao')
    expect(extrairSinalAprendizado('tem algum ncm de banana?')).toBeNull()
  })

  it('declara o nome e lembra depois (persistência entre turnos)', async () => {
    const r1 = await responderChat('meu nome é David', [])
    expect(r1.texto).toContain('David')
    const r2 = await responderChat('qual meu nome?', [
      { papel: 'user', texto: 'meu nome é David' },
      { papel: 'assistant', texto: r1.texto },
    ])
    expect(r2.texto).toContain('David')
  }, 15000)

  it('saudação usa o nome lembrado (cordialidade)', async () => {
    await responderChat('meu nome é Ana', [])
    const r = await responderChat('oi', [
      { papel: 'user', texto: 'meu nome é Ana' },
      { papel: 'assistant', texto: 'Prazer, Ana!' },
      { papel: 'user', texto: 'oi' },
    ])
    expect(r.texto).toContain('Ana')
  }, 15000)

  it('correção curta não repete o RAG: pede detalhes e registra', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Tem algum ncm de danone?' },
      { papel: 'assistant' as const, texto: 'Classificação sugerida: NCM 0403.20.00 — Iogurte. Enquadramento CST 200 · cClassTrib 200034.' },
      { papel: 'user' as const, texto: 'não é esse' },
    ]
    const r = await responderChat('não é esse', hist)
    expect(r.texto).not.toContain('8471')
    expect(r.texto).toMatch(/detalhes|não vou repetir/i)
  }, 15000)
})
