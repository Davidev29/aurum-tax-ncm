/**
 * Artefatos-resumo cifrados da Aurum AI:
 * - o resumo de cada chat é cifrado (AES-GCM) e só a IA descriptografa;
 * - em repouso (Dexie `meta` + localStorage) só existe envelope opaco;
 * - em chat novo (sem histórico) o artefato devolve assunto/códigos e
 *   contribui com o resultado ("só tem esse?" resolve o NCM anterior);
 * - chave e artefatos ficam fora de backup/relatório por construção.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  atualizarArtefatoResumido,
  carregarMemoriaSistema,
  cifrarTexto,
  decifrarTexto,
  definirProvedorSegredoOS,
  ehEnvelopeCifrado,
} from '@/application/aurum-ai-artefatos'
import { declararNomeMemoria } from '@/application/aurum-ai-memoria'
import { responderChat } from '@/application/aurum-ai-chat'
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

const HIST_DANONE = [
  { papel: 'user' as const, texto: 'Tem algum ncm de danone?' },
  { papel: 'assistant' as const, texto: 'Classificação sugerida: NCM 0403.20.00 — Iogurte. Enquadramento CST 200 · cClassTrib 200034.' },
]

beforeEach(async () => {
  definirProvedorSegredoOS(null)
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
  await db.cstClassTrib.bulkPut([cct('200', '200034', 60), cct('200', '200035', 60)])
  await db.ncmNomenclatura.bulkPut([
    { codigo: NCM_DANONE, codigoOriginal: NCM_DANONE, descricao: 'Iogurte', dataInicio: null, dataFim: null, ato: null },
  ])
  await db.ncm.bulkPut([vinculo(NCM_DANONE, '200', '200034'), vinculo(NCM_DANONE, '200', '200035')])
})

describe('criptografia do artefato (só a IA descriptografa)', () => {
  it('round-trip cifra/decifra', async () => {
    const env = await cifrarTexto('segredo-da-aurum')
    expect(ehEnvelopeCifrado(env)).toBe(true)
    expect(await decifrarTexto(env)).toBe('segredo-da-aurum')
  })

  it('ciphertext não contém o claro', async () => {
    const env = await cifrarTexto('danone iogurte 04032000')
    const bruto = JSON.stringify(env)
    expect(bruto).not.toContain('danone')
    expect(bruto).not.toContain('04032000')
  })

  it('envelope adulterado não abre (falha fechada, sem throw)', async () => {
    const env = await cifrarTexto('dado real')
    expect(ehEnvelopeCifrado(env)).toBe(true)
    const adulterado = { ...env!, data: `${env!.data.slice(0, -4)}AAAA` }
    expect(await decifrarTexto(adulterado)).toBeNull()
    expect(await decifrarTexto({ v: 1, alg: 'AES-GCM-256' })).toBeNull()
    expect(await decifrarTexto(null)).toBeNull()
  })
})

describe('artefato-resumo como memória de sistema', () => {
  it('condensa o chat e devolve assunto + códigos + nome', async () => {
    await declararNomeMemoria('meu nome é David')
    const ok = await atualizarArtefatoResumido(HIST_DANONE, { forcar: true, totalConversas: 1 })
    expect(ok).toBe(true)
    const mem = await carregarMemoriaSistema()
    expect(mem?.assunto).toBe('danone')
    expect(mem?.codigoNcm).toBe(NCM_DANONE)
    expect(mem?.nome).toBe('David')
    expect(mem?.linhas.length).toBeGreaterThan(0)
  })

  it('em repouso só existe envelope opaco (sem nome/termo em claro)', async () => {
    await declararNomeMemoria('meu nome é David')
    await atualizarArtefatoResumido(HIST_DANONE, { forcar: true, totalConversas: 1 })
    const linhas = await db.table('meta').toArray()
    const bruto = JSON.stringify(linhas)
    expect(bruto).not.toContain('0403.20.00')
    const chaves = (linhas as { chave: string }[]).map((l) => l.chave)
    expect(chaves.some((k) => k.startsWith('aurum_artefato_resumo__'))).toBe(true)
    try {
      let claroLocal = ''
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? ''
        if (k.startsWith('aurum_artefato_resumo__')) claroLocal += localStorage.getItem(k) ?? ''
      }
      expect(claroLocal).not.toContain('danone')
      expect(claroLocal).not.toContain('David')
    } catch { /* sem storage */ }
  })

  it('chat novo sem histórico resolve "só tem esse?" pelo artefato', async () => {
    await atualizarArtefatoResumido(HIST_DANONE, { forcar: true, totalConversas: 1 })
    const r = await responderChat('só tem esse?', [])
    expect(r.texto).toContain('0403.20.00')
    expect(r.texto).not.toContain('8471')
  }, 15000)

  it('saudação em chat novo retoma a sessão anterior', async () => {
    await atualizarArtefatoResumido(HIST_DANONE, { forcar: true, totalConversas: 1 })
    const r = await responderChat('oi', [])
    expect(r.texto).toContain('danone')
  }, 15000)

  it('chave e artefatos ficam fora do backup por construção', async () => {
    await atualizarArtefatoResumido(HIST_DANONE, { forcar: true, totalConversas: 1 })
    const { montarBackup } = await import('@/application/backup')
    const bruto = JSON.stringify(await montarBackup())
    expect(bruto).not.toContain('aurum_kek_artefatos')
    expect(bruto).not.toContain('aurum_artefato_resumo')
  })
})
