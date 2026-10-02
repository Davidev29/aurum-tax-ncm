/**
 * Semente mínima compartilhada das suites `tests/ia/*` (Phase 6 / 06-09).
 *
 * Reaproveita exatamente a base de `tests/classificacao-inteligente.test.ts`:
 * 12 nomenclaturas + vínculos 10051000×2 / 23091000 / 23099090 (CST 200,
 * cClassTrib 200034/200038, refs VII/IX). Fora do Electron o gate usa o
 * seletor mock local (`mock: true`) — o caminho de produção com worker vivo
 * (`mock: false`) passa pelo mesmo gate + resolvedor.
 */
import { invalidarCacheBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

const NOMEN = [
  { codigo: '01', codigoOriginal: '01', descricao: 'Animais vivos.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '0102', codigoOriginal: '01.02', descricao: 'Animais vivos da espécie bovina.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '010229', codigoOriginal: '0102.29', descricao: '-- Outros (bovinos domésticos)', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '01022919', codigoOriginal: '0102.29.19', descricao: 'Outros, para reprodução', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '10', codigoOriginal: '10', descricao: 'Cereais', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '1005', codigoOriginal: '10.05', descricao: 'Milho.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '10051000', codigoOriginal: '1005.10.00', descricao: 'Para semeadura (sementeira)', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '10059010', codigoOriginal: '1005.90.10', descricao: 'Em grão', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '23', codigoOriginal: '23', descricao: 'Resíduos das indústrias alimentares; alimentos para animais', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '2309', codigoOriginal: '23.09', descricao: 'Preparações do tipo utilizado na alimentação de animais.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '23091000', codigoOriginal: '2309.10.00', descricao: 'Alimentos para cães ou gatos, acondicionados para venda a retalho', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '23099090', codigoOriginal: '2309.90.90', descricao: 'Outras', dataInicio: null, dataFim: null, ato: 'Ato' },
]

const vinculo = (codigo: string, cst: string, cClassTrib: string, descricao: string) => ({
  id: `${codigo}|${cst}|${cClassTrib}`,
  codigo,
  codigoFormatado: codigo,
  cst,
  cClassTrib,
  baseLegal: descricao,
  reducao: 60,
  aliquotaIBS: null,
  aliquotaCBS: null,
  descricao,
  documentos: 'NFE',
})

const DOCS = {
  NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false,
  NF3e: false, NFCom: false, NFSe: false,
}

/** Limpa as stores usadas e semeia a base mínima (idempotente por teste). */
export async function semearBaseIa(): Promise<void> {
  await db.ncmNomenclatura.clear()
  await db.ncm.clear()
  await db.cst.clear()
  await db.cstClassTrib.clear()
  await db.referencia.clear()
  invalidarCacheBuscaTexto()
  await db.ncmNomenclatura.bulkPut(NOMEN as never)
  await db.cst.put({
    codigo: '200',
    descricao: 'Alíquota reduzida',
    indIBSCBS: true,
    indIBSCBSMono: false,
    indReducao: true,
    indDiferimento: false,
    indTransferenciaCredito: false,
    docs: DOCS,
  })
  await db.cstClassTrib.bulkPut([
    {
      id: '200|200034', cst: '200', cClassTrib: '200034',
      nome: 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)',
      descricao: 'Fornecimento dos alimentos destinados ao consumo humano relacionados no Anexo VII',
      lcRedacao: 'Art. 135. Ficam reduzidas em 60% as alíquotas do IBS e da CBS',
      lcRef: 'Art. 135', tipoAliquota: 'Padrão', pRedIBS: 60, pRedCBS: 60,
      indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0,
      indMonoReten: 0, indMonoRet: 0, indMonoDif: 0, creditoPara: null,
      inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
    {
      id: '200|200038', cst: '200', cClassTrib: '200038',
      nome: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
      descricao: 'Fornecimento dos insumos agropecuários e aquícolas relacionados no Anexo IX',
      lcRedacao: 'Art. 138. Ficam reduzidas em 60% as alíquotas do IBS e da CBS',
      lcRef: 'Art. 138', tipoAliquota: 'Padrão', pRedIBS: 60, pRedCBS: 60,
      indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0,
      indMonoReten: 0, indMonoRet: 0, indMonoDif: 0, creditoPara: null,
      inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
  ] as never)
  await db.ncm.bulkPut([
    vinculo('10051000', '200', '200034', 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)'),
    vinculo('10051000', '200', '200038', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)'),
    vinculo('23091000', '200', '200038', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)'),
    vinculo('23099090', '200', '200038', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)'),
  ] as never)
  await db.referencia.bulkPut([
    {
      id: '200|200034', cst: '200', cstDescricao: 'Alíquota reduzida', cClassTrib: '200034',
      descricao: 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)',
      pRedIBS: 60, pRedCBS: 60, tipoAliquota: 'Padrão', anexo: '7',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art135',
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
      monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs: DOCS,
    },
    {
      id: '200|200038', cst: '200', cstDescricao: 'Alíquota reduzida', cClassTrib: '200038',
      descricao: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
      pRedIBS: 60, pRedCBS: 60, tipoAliquota: 'Padrão', anexo: '9',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art138',
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
      monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs: DOCS,
    },
  ] as never)
}

/** NCM com pontos (`1005.10.00`) → só dígitos (`10051000`). */
export function soDigitos(codigo: string | null | undefined): string | null {
  if (!codigo) return null
  const d = codigo.replace(/\D+/g, '')
  return d || null
}
