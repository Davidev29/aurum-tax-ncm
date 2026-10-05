import type {
  AnexoNcm,
  CnaeNbsLink,
  CreditoPresumido,
  DocumentosHabilitados,
  FonteDescricaoCnaeNbs,
  LcNbsRelation,
  LocalOperacao,
  NomenclaturaNcm,
  ProdutoDfe,
  ReferenciaCClassTrib,
  TabelaCst,
  TabelaCstClassTrib,
  VinculoNcm,
  VinculoNbs,
} from '@/domain/entities'
import { DOCUMENTOS, type Documento } from '@/domain/constants'

/* --------------------------------------------------------------------------
   Helpers de normalização — espelham `scripts/build-base.mjs` para que a
   importação em tempo de execução produza exatamente os mesmos registros.

   Todos os normalizadores são **idempotentes**: aceitam tanto o JSON oficial
   bruto (chaves de origem, ex.: `descricaoCompleta`) quanto o artefato já
   normalizado da base embutida (chave canônica, ex.: `descricao`). Sem isso,
   reaplicá-los sobre `public/base/*.json` descartaria silenciosamente os
   campos lidos a partir das chaves de origem.
   -------------------------------------------------------------------------- */

export const digits = (v: unknown): string => String(v ?? '').replace(/\D+/g, '')

export const toBool = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'sim' || s === '1' || s === 'true' || s === 's'
}

export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export const padCst = (v: unknown): string | null => {
  const d = digits(v)
  if (!d) return null
  return d.padStart(3, '0').slice(-3)
}

export const padCct = (v: unknown): string | null => {
  const d = digits(v)
  if (!d) return null
  return d.padStart(6, '0').slice(-6)
}

const str = (v: unknown): string => String(v ?? '').trim()

/**
 * Lê um campo em qualquer um dos dois formatos de origem: a chave oficial bruta
 * (`origem`) tem precedência; na ausência dela cai para a chave canônica
 * (`canonico`) da base embutida já normalizada.
 */
const alt = (
  registro: Record<string, unknown> | null | undefined,
  origem: string,
  canonico: string,
): unknown => (registro && registro[origem] !== undefined ? registro[origem] : registro?.[canonico])

/** Mapa `{NFe:true,…}` quando o próprio registro já veio normalizado, senão `null`. */
const docsEmbutidos = (registro: Record<string, unknown> | null | undefined): Record<
  string,
  unknown
> | null => {
  const docs = registro?.docs
  return docs && typeof docs === 'object' ? (docs as Record<string, unknown>) : null
}

/** Monta o rótulo do ato legal: "Res Gecex 272/2021". */
export const montarAto = (item: Record<string, unknown> | null | undefined): string | null => {
  const tipo = str(item?.Tipo_Ato_Ini)
  if (!tipo) return null
  const numero = str(item?.Numero_Ato_Ini)
  const ano = str(item?.Ano_Ato_Ini)
  const comp = [numero, ano].filter(Boolean).join('/')
  return [tipo, comp].filter(Boolean).join(' ').trim() || null
}

/** Monta o rótulo do ato de extinção: "Res Gecex 926/2026". Null quando vigente. */
export const montarAtoFim = (item: Record<string, unknown> | null | undefined): string | null => {
  const tipo = str(item?.Tipo_Ato_Fim)
  if (!tipo) return str(item?.atoFim) || null
  const numero = str(item?.Numero_Ato_Fim)
  const ano = str(item?.Ano_Ato_Fim)
  const comp = [numero, ano].filter(Boolean).join('/')
  return [tipo, comp].filter(Boolean).join(' ').trim() || null
}

const DOC_ALIASES: Record<string, string> = {
  NFe: 'NFe', NFCe: 'NFCe', CTe: 'CTe', 'CTe OS': 'CTeOS', CTeOS: 'CTeOS',
  BPe: 'BPe', 'BPe TM': 'BPeTM', BPeTM: 'BPeTM', NF3e: 'NF3e', NFCom: 'NFCom',
  NFSe: 'NFSe', NFSE: 'NFSe', 'BPe TA': 'BPeTA', BPeTA: 'BPeTA',
  NFAg: 'NFAg', NFSVIA: 'NFSVIA', NFABI: 'NFABI', NFGas: 'NFGas',
  DERE: 'DERE', DIR: 'DIR', DUIMP: 'DUIMP',
}

const vazioDocs = (): DocumentosHabilitados =>
  Object.fromEntries(DOCUMENTOS.map((d) => [d, false])) as DocumentosHabilitados

/**
 * Converte o mapa de documentos de qualquer um dos formatos de origem para a
 * lista canônica de chaves — corrige o `[BUG]` da v1 em que `"CTe OS"` /
 * `"BPe TM"` / `"NFSE"` nunca casavam com o regex de exibição.
 */
export function buildDocs(
  registro: Record<string, unknown> | null | undefined,
  extrator?: ((k: string) => string | null) | null,
): DocumentosHabilitados {
  const docs = vazioDocs()
  if (!registro) return docs
  for (const [rawKey, rawVal] of Object.entries(registro)) {
    const canon = DOC_ALIASES[rawKey] ?? (extrator ? extrator(rawKey) : null)
    if (canon && canon in docs) docs[canon as Documento] = toBool(rawVal)
  }
  return docs
}

const docsDaTabelaCst = (r: Record<string, unknown>): DocumentosHabilitados => ({
  NFe: toBool(r.indNFe),
  NFCe: toBool(r.indNFCe),
  CTe: toBool(r.indCTe),
  CTeOS: toBool(r.indCteOS),
  BPe: toBool(r.indBPe),
  BPeTM: toBool(r.indBPeTM),
  NF3e: toBool(r.indNF3e),
  NFCom: toBool(r.indNFCom),
  NFSe: toBool(r.indNFSe),
})

/** Documentos da CST: mapa já normalizado (`registro.docs`) ou campos `ind*` brutos. */
const docsDaCst = (c: Record<string, unknown>): DocumentosHabilitados => {
  const embutido = docsEmbutidos(c)
  return embutido ? buildDocs(embutido, null) : docsDaTabelaCst(c)
}

/* --------------------------------------------------------------------------
   Formato C — `classificacao_tributaria.json` (array plano) ou o artefato
   `classificacao-tributaria.json` da base embutida (`{ itens: [...] }`)
   -------------------------------------------------------------------------- */

export function normalizarReferencia(bruto: unknown): ReferenciaCClassTrib[] {
  const itens = Array.isArray(bruto)
    ? bruto
    : ((bruto as { itens?: unknown })?.itens as unknown[] | undefined)
  if (!Array.isArray(itens))
    throw new Error('classificacao_tributaria.json deve ser um array (ou conter a lista `itens`).')
  return itens
    .map((raw) => {
      const r = raw as Record<string, unknown>
      const cst = padCst(alt(r, 'Código da Situação Tributária', 'cst'))
      const cClassTrib = padCct(alt(r, 'Código da Classificação Tributária', 'cClassTrib'))
      return {
        id: `${st(cst)}|${st(cClassTrib)}`,
        cst: st(cst),
        cstDescricao: str(alt(r, 'Descrição da Situação Tributária', 'cstDescricao')),
        cClassTrib: st(cClassTrib),
        descricao: str(
          alt(r, 'Descrição do Código da Classificação Tributária', 'descricao'),
        ),
        pRedIBS: toNum(alt(r, 'Percentual Redução IBS', 'pRedIBS')) ?? 0,
        pRedCBS: toNum(alt(r, 'Percentual Redução CBS', 'pRedCBS')) ?? 0,
        tipoAliquota: str(alt(r, 'Tipo de Alíquota', 'tipoAliquota')) || null,
        anexo: str(alt(r, 'Número do Anexo', 'anexo')) || null,
        urlLegislacao: str(alt(r, 'Url da Legislação', 'urlLegislacao')) || null,
        exigeTributacao: toBool(alt(r, 'Exige Tributação', 'exigeTributacao')),
        reducaoBC: toBool(alt(r, 'Redução BC CST', 'reducaoBC')),
        reducaoAliquota: toBool(alt(r, 'Redução de Alíquota', 'reducaoAliquota')),
        transferenciaCredito: toBool(alt(r, 'Transferência de Crédito', 'transferenciaCredito')),
        diferimento: toBool(alt(r, 'Diferimento', 'diferimento')),
        monofasica: toBool(alt(r, 'Monofásica', 'monofasica')),
        creditoPresumidoZFM: toBool(
          alt(r, 'Crédito Presumido IBS Zona Franca de Manaus', 'creditoPresumidoZFM'),
        ),
        ajusteCompetencia: toBool(alt(r, 'Ajuste de Competência', 'ajusteCompetencia')),
        tributacaoRegular: toBool(alt(r, 'Tributação Regular', 'tributacaoRegular')),
        creditoPresumido: toBool(alt(r, 'Crédito Presumido', 'creditoPresumido')),
        estornoCredito: toBool(alt(r, 'Estorno de Crédito', 'estornoCredito')),
        monoNormal: toBool(alt(r, 'Tributação Monofásica Normal', 'monoNormal')),
        monoRetencao: toBool(
          alt(r, 'Tributação Monofásica sujeita a retenção', 'monoRetencao'),
        ),
        monoRetida: toBool(
          alt(r, 'Tributação Monofásica retida anteriormente', 'monoRetida'),
        ),
        monoDiferimentoCombustivel: toBool(
          alt(
            r,
            'Tributação Monofásica de Combustível com diferimento',
            'monoDiferimentoCombustivel',
          ),
        ),
        simplesReceitaBruta:
          str(alt(r, 'Tipo de Receita Bruta do Simples Nacional', 'simplesReceitaBruta')) || null,
        regimeContribuicaoSocial:
          str(
            alt(r, 'Regime de Contribuição Social sobre Bens e Serviços', 'regimeContribuicaoSocial'),
          ) || null,
        impostoBensServicos:
          str(alt(r, 'Imposto sobre Bens e Serviços', 'impostoBensServicos')) || null,
        docs: buildDocs(docsEmbutidos(r) ?? r, null),
      } satisfies ReferenciaCClassTrib
    })
    .filter((r) => r.cst && r.cClassTrib)
}

const st = (v: string | null | undefined): string => v ?? ''

/* --------------------------------------------------------------------------
   Formato B — `reforma_tributaria_por_ncm.json` ou o artefato `reforma.json`
   da base embutida (`{ cst, cstClassTrib, ncm, nbs }`)
   -------------------------------------------------------------------------- */

export function normalizarCst(bruto: unknown): TabelaCst[] {
  return (Array.isArray(bruto) ? bruto : [])
    .map((raw) => {
      const c = raw as Record<string, unknown>
      const codigo = padCst(alt(c, 'CST-IBS/CBS', 'codigo'))
      if (!codigo) return null
      return {
        codigo,
        descricao: str(alt(c, 'Descrição CST-IBS/CBS', 'descricao')),
        indIBSCBS: toBool(alt(c, 'ind_gIBSCBS', 'indIBSCBS')),
        indIBSCBSMono: toBool(alt(c, 'ind_gIBSCBSMono', 'indIBSCBSMono')),
        indReducao: toBool(alt(c, 'ind_gRed', 'indReducao')),
        indDiferimento: toBool(alt(c, 'ind_gDif', 'indDiferimento')),
        indTransferenciaCredito: toBool(alt(c, 'ind_gTransfCred', 'indTransferenciaCredito')),
        docs: docsDaCst(c),
      } satisfies TabelaCst
    })
    .filter((c): c is TabelaCst => c !== null)
}

export function normalizarCstClassTrib(bruto: unknown): TabelaCstClassTrib[] {
  return (Array.isArray(bruto) ? bruto : [])
    .map((raw) => {
      const c = raw as Record<string, unknown>
      const cst = padCst(alt(c, 'CST-IBS/CBS', 'cst'))
      const cct = padCct(c.cClassTrib)
      if (!cst || !cct) return null
      return {
        id: `${cst}|${cct}`,
        cst,
        cClassTrib: cct,
        nome: str(alt(c, 'Nome cClassTrib', 'nome')),
        descricao: str(alt(c, 'Descrição cClassTrib', 'descricao')),
        lcRedacao: str(alt(c, 'LC Redação', 'lcRedacao')) || null,
        lcRef: str(alt(c, 'LC 214/25', 'lcRef')) || null,
        tipoAliquota: str(alt(c, 'Tipo de Alíquota', 'tipoAliquota')) || null,
        pRedIBS: toNum(c.pRedIBS),
        pRedCBS: toNum(c.pRedCBS),
        indRedutorBC: toNum(alt(c, 'ind_RedutorBC', 'indRedutorBC')),
        indTribRegular: toNum(alt(c, 'ind_gTribRegular', 'indTribRegular')),
        indCredPres: toNum(alt(c, 'ind_CredPres', 'indCredPres')),
        indMono: toNum(c.indMono),
        indMonoReten: toNum(c.indMonoReten),
        indMonoRet: toNum(c.indMonoRet),
        indMonoDif: toNum(c.indMonoDif),
        creditoPara: str(alt(c, 'Crédito para', 'creditoPara')) || null,
        inicioVigencia: str(alt(c, 'dIniVig', 'inicioVigencia')) || null,
        fimVigencia: str(alt(c, 'dFimVig', 'fimVigencia')) || null,
        atualizadoEm: str(alt(c, 'DataAtualização', 'atualizadoEm')) || null,
      } satisfies TabelaCstClassTrib
    })
    .filter((c): c is TabelaCstClassTrib => c !== null)
}

export function normalizarNcm(bruto: unknown): VinculoNcm[] {
  return (Array.isArray(bruto) ? bruto : [])
    .map((raw, i) => {
      const n = raw as Record<string, unknown>
      const codigo = digits(n.codigo)
      const cst = padCst(n.cst) ?? ''
      const cClassTrib = padCct(n.cClassTrib) ?? ''
      if (codigo.length !== 8) return null
      return {
        id: typeof n.id === 'string' && n.id ? n.id : `${codigo}|${cClassTrib}|${i}`,
        codigo,
        codigoFormatado: fmtNcmLocal(codigo),
        cst,
        cClassTrib,
        baseLegal: str(n.baseLegal),
        reducao: toNum(n.reducao),
        aliquotaIBS: toNum(n.aliquotaIBS),
        aliquotaCBS: toNum(n.aliquotaCBS),
        documentos: str(alt(n, 'documentosFiscaisRelacionados', 'documentos')),
        descricao: str(alt(n, 'descricaoCompleta', 'descricao')),
      } satisfies VinculoNcm
    })
    .filter((n): n is VinculoNcm => n !== null)
}

export function normalizarNbs(bruto: unknown): VinculoNbs[] {
  return (Array.isArray(bruto) ? bruto : [])
    .map((raw, i) => {
      const n = raw as Record<string, unknown>
      const codigo = digits(n.codigo)
      if (codigo.length !== 9) return null
      return {
        id: typeof n.id === 'string' && n.id ? n.id : `${codigo}|${padCct(n.cClassTrib) ?? ''}|${i}`,
        codigo,
        cst: padCst(n.cst) ?? '',
        cClassTrib: padCct(n.cClassTrib) ?? '',
        baseLegal: str(n.baseLegal),
        reducao: toNum(alt(n, 'reducao', 'reducao')),
        aliquotaIBS: toNum(n.aliquotaIBS),
        aliquotaCBS: toNum(n.aliquotaCBS),
        descricao: str(alt(n, 'descricaoCompleta', 'descricao')),
        documentos: str(alt(n, 'documentosFiscaisRelacionados', 'documentos')),
      } satisfies VinculoNbs
    })
    .filter((n): n is VinculoNbs => n !== null)
}

/**
 * Une vínculos NBS com dedupe por `codigo|cst|cClassTrib` (paridade com
 * `unirNbs` de `scripts/build-base.mjs`).
 *
 * A fonte publica 10 NBS do Anexo IX (art. 138, 200/200038) DENTRO da lista
 * `NCM` — sem esta união eles são descartados e a conferência do serviço
 * cai em regra geral (sem descrição, redução, anexo ou LC).
 */
export function unirVinculosNbs(base: VinculoNbs[], complemento: VinculoNbs[] = []): VinculoNbs[] {
  const vistos = new Set<string>()
  const unicos: VinculoNbs[] = []
  for (const v of [...(base ?? []), ...(complemento ?? [])]) {
    if (!v || typeof v !== 'object') continue
    const chave = `${v.codigo}|${v.cst}|${v.cClassTrib}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    unicos.push(v)
  }
  unicos.forEach((v, k) => {
    v.id = `${v.codigo}|${v.cClassTrib}|${k}`
  })
  return unicos
}

/* --------------------------------------------------------------------------
   Phase 7 — arquivos vivos de Serviços (CNAE × Anexo Simples, NBS Serviços)
   Chaves acentuadas via `alt()` (ex.: `Descrição oficial` → `descricao`).
   -------------------------------------------------------------------------- */

/** `0111-3/01` → `0111301` (7 dígitos, chave de lookup). */
export const somenteDigitosCnae = (v: unknown): string => digits(v)

/** `0111301` → `0111-3/01` (máscara oficial). Fora do padrão, devolve cru. */
export function fmtCnae(codigo7: unknown): string {
  const d = digits(codigo7)
  if (d.length !== 7) return String(codigo7 ?? '').trim()
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}`
}

const SITUACOES_CNAE = [
  'Permitido',
  'Permitido com ressalvas',
  'Depende da atividade',
] as const

export type SituacaoCnae = (typeof SITUACOES_CNAE)[number]

const normalizarSituacaoCnae = (v: unknown): SituacaoCnae => {
  const s = str(v)
  const achada = SITUACOES_CNAE.find((x) => x.toLowerCase() === s.toLowerCase())
  return achada ?? 'Depende da atividade'
}

/** `"III / V"` → `['III','V']`; `"Não aplicável"` é descartado. */
export function normalizarAnexosSimples(v: unknown): string[] {
  return String(v ?? '')
    .split('/')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p && p !== 'NÃO APLICÁVEL' && p !== 'NAO APLICAVEL')
}

const ehSim = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'sim' || s === 's' || s === '1' || s === 'true'
}

/**
 * Normaliza `CNAE X ANEXO.json` (array plano) ou o artefato `cnae.json`
 * da base embutida (`{ itens: [...] }`). Idempotente nos dois sentidos.
 */
export function normalizarCnaeAnexo(bruto: unknown): import('@/domain/entities').CnaeAnexo[] {
  const lista = Array.isArray(bruto)
    ? bruto
    : ((bruto as { itens?: unknown })?.itens as unknown[] | undefined)
  if (!Array.isArray(lista)) return []
  const vistos = new Set<string>()
  const out: import('@/domain/entities').CnaeAnexo[] = []
  for (const raw of lista) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const codigo7 = digits(alt(r, 'CNAE', 'codigo7') ?? alt(r, 'codigoFormatado', 'codigoFormatado'))
    if (codigo7.length !== 7 || vistos.has(codigo7)) continue
    vistos.add(codigo7)
    out.push({
      codigo7,
      codigoFormatado: fmtCnae(codigo7),
      descricao: str(alt(r, 'Descrição oficial', 'descricao')),
      situacao: normalizarSituacaoCnae(alt(r, 'Situação', 'situacao')),
      anexos: normalizarAnexosSimples(alt(r, 'Anexos', 'anexos')),
      fatorR: ehSim(alt(r, 'Fator R', 'fatorR')),
    })
  }
  return out
}

export interface ResultadoNormalizacaoNbsServicos {
  vinculos: VinculoNbs[]
  /** Linhas descartadas como duplicadas (`codigo|cst|cClassTrib` repetido). */
  duplicados: number
}

/**
 * Normaliza `NBS SERVIÇOS.json` (array plano com chaves PT acentuadas) para
 * `VinculoNbs[]`, com **dedupe** por `codigo|cst|cClassTrib` (o arquivo vivo
 * contém ~30 linhas repetidas). `Aliq. IBS/CBS` são guardadas como dado de
 * origem/auditoria — o cálculo usa `calcularTributos` + `REF_DEFAULT`.
 */
export function normalizarNbsServicos(bruto: unknown): ResultadoNormalizacaoNbsServicos {
  const lista = Array.isArray(bruto) ? bruto : []
  const vistos = new Set<string>()
  const vinculos: VinculoNbs[] = []
  let duplicados = 0
  lista.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const n = raw as Record<string, unknown>
    const codigo = digits(alt(n, 'NBS', 'codigo'))
    if (codigo.length !== 9) return
    const cst = padCst(alt(n, 'CST', 'cst')) ?? ''
    const cClassTrib = padCct(alt(n, 'CclassTrib', 'cClassTrib')) ?? ''
    const chave = `${codigo}|${cst}|${cClassTrib}`
    if (vistos.has(chave)) {
      duplicados++
      return
    }
    vistos.add(chave)
    vinculos.push({
      id: typeof n.id === 'string' && n.id ? n.id : `${codigo}|${cClassTrib}|${i}`,
      codigo,
      cst,
      cClassTrib,
      baseLegal: str(alt(n, 'Base Legal', 'baseLegal')),
      reducao: toNum(alt(n, 'Redução', 'reducao')),
      aliquotaIBS: toNum(alt(n, 'Aliq. IBS', 'aliquotaIBS')),
      aliquotaCBS: toNum(alt(n, 'Aliq. CBS', 'aliquotaCBS')),
      descricao: str(alt(n, 'Descrição completa', 'descricao')),
      documentos: str(alt(n, 'DFes Relac.', 'documentos')),
    })
  })
  return { vinculos, duplicados }
}

/* --------------------------------------------------------------------------
   Phase 9 — ponte CNAE → NBS (fonte NÃO-oficial `CNAE X NBS.qualclasstrib.json`).
   Os links são CANDIDATOS; alíquota/benefício só do resolvedor oficial.
   Precedência de descrição: oficial > qualclasstrib > auxiliar (PLAN 09-01/E).
   -------------------------------------------------------------------------- */

/**
 * Repara mojibake latin1 (`ServiÃ§o` → `Serviço`) sem corromper texto já
 * correto (`NÃO-METÁLICOS`, `Âmbito` passam intactos).
 *
 * Só reinterpreta bytes que formam sequências UTF-8 VÁLIDAS (2–4 bytes com
 * continuações `0x80–0xBF`, sem overlong/surrogate); bytes avulsos (ex.: `À`
 * isolado = `0xC0`) passam como latin1. Strings fora do latin1 (`> 0xFF`)
 * voltam intactas (não é mojibake recuperável).
 *
 * Medido na fonte ponte (09-01): zero mojibake real (UTF-8 íntegro) — aqui é
 * rede de segurança documentada + cobertura de teste com caso sintético.
 */
export function fixLatin1(v: unknown): string {
  if (typeof v !== 'string') return String(v ?? '')
  if (!/[ÃÂ]/.test(v)) return v
  const bytes: number[] = []
  for (const ch of v) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp > 0xff) return v
    bytes.push(cp)
  }
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    let len = 0
    if (b >= 0xc2 && b <= 0xdf) len = 2
    else if (b >= 0xe0 && b <= 0xef) len = 3
    else if (b >= 0xf0 && b <= 0xf4) len = 4
    if (len > 0 && i + len <= bytes.length && bytes.slice(i + 1, i + len).every((x) => x >= 0x80 && x <= 0xbf)) {
      let cp = 0
      if (len === 2) cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
      else if (len === 3) cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      else cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      const minimo = len === 2 ? 0x80 : len === 3 ? 0x800 : 0x10000
      if (cp >= minimo && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
        out += String.fromCodePoint(cp)
        i += len
        continue
      }
    }
    out += String.fromCharCode(b)
    i += 1
  }
  return out
}

/** `XXXX-X/XX` → `XXXXXXX` (7 dígitos, chave de lookup). Fora do padrão → `''`. */
export const somenteDigitosCnaeNbs = (v: unknown): string => {
  const d = digits(v)
  return d.length === 7 ? d : ''
}

/** NBS `X.XXXX.XX.XX` → 9 dígitos. Fora do padrão → `''`. */
export const somenteDigitosNbsPonte = (v: unknown): string => {
  const d = digits(v)
  return d.length === 9 ? d : ''
}

/**
 * Normaliza UM link CNAE → NBS (aceita o bruto da ponte ou o artefato
 * `cnae-nbs.json` já normalizado — idempotente). Devolve `null` quando o par
 * é inválido (NBS fora de 9 dígitos ou CNAE fora de `XXXX-X/XX`).
 */
export function normalizarCnaeNbsLink(raw: unknown): CnaeNbsLink | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const cnae7 = somenteDigitosCnaeNbs(r.cnae7 ?? r.cnae ?? r.codigoFormatado ?? r.codigo)
  const nbs = somenteDigitosNbsPonte(r.nbs ?? r.codigo)
  if (!cnae7 || !nbs) return null
  const fonte = r.fonte === 'triangulacao' ? 'triangulacao' : 'por_codigo'
  return { cnae7, cnae: fmtCnae(cnae7), nbs, fonte }
}

export interface ResultadoNormalizacaoCnaeNbs {
  /** Links `por_codigo` com dedupe por `cnae7|nbs` (vão para `db.cnaeNbs`). */
  links: CnaeNbsLink[]
  /** Relações `fallback-relations.json` (1.739, fidelidade total — vão para `db.lcNbs`). */
  lcNbs: LcNbsRelation[]
  /** Pares CNAE × LC de `fallback-cnae-links.json` (só triangulação/validação). */
  cnaeLc: Array<{ cnae7: string; cnae: string; lc: string }>
  /** Descrições auxiliares `cnaed` por cnae7 (precedência mais baixa). */
  descricoesAuxiliares: Record<string, string>
  /** Pares `cnae7|nbs` triangulados via LC comum (validação cruzada, não viram links). */
  paresTriangulados: string[]
  /** Entradas `respostas_de_rede` descartadas por tracking (url com `google`). */
  descartadosRede: number
  /** Pares repetidos removidos no dedupe. */
  duplicados: number
  /** Pares com CNAE/NBS inválidos descartados. */
  invalidos: number
}

/**
 * Normaliza a fonte ponte (`por_codigo` + `fallback-cnae-links` [677] +
 * `fallback-relations` [1739]) ou o artefato `cnae-nbs.json` já normalizado
 * (`{ links, lcNbs }` — idempotente). `respostas_de_rede` com url contendo
 * `google` é tracking e é DESCARTADA (nunca vira dado).
 */
export function normalizarCnaeNbs(bruto: unknown): ResultadoNormalizacaoCnaeNbs {
  const vazio: ResultadoNormalizacaoCnaeNbs = {
    links: [], lcNbs: [], cnaeLc: [], descricoesAuxiliares: {}, paresTriangulados: [], descartadosRede: 0, duplicados: 0, invalidos: 0,
  }
  if (!bruto || typeof bruto !== 'object') return vazio
  const b = bruto as Record<string, unknown>

  // Artefato já normalizado (`cnae-nbs.json`): revalida sem perda.
  if (Array.isArray(b.links)) {
    const vistos = new Set<string>()
    for (const raw of b.links as unknown[]) {
      const link = normalizarCnaeNbsLink(raw)
      if (!link) {
        vazio.invalidos++
        continue
      }
      const chave = `${link.cnae7}|${link.nbs}`
      if (vistos.has(chave)) {
        vazio.duplicados++
        continue
      }
      vistos.add(chave)
      vazio.links.push(link.cnae7 && link.nbs ? { ...link } : link)
    }
    for (const raw of (Array.isArray(b.lcNbs) ? (b.lcNbs as unknown[]) : [])) {
      const rel = normalizarLcNbsRelation(raw)
      if (rel) vazio.lcNbs.push(rel)
    }
    return vazio
  }

  const porCodigo = (b.por_codigo ?? {}) as Record<string, unknown>
  const respostas = (b.respostas_de_rede ?? []) as Array<Record<string, unknown>>

  // Links `por_codigo`: 508 CNAEs × NBS, dedupe por `cnae7|nbs`.
  const vistos = new Set<string>()
  for (const [codigoCnae, entrada] of Object.entries(porCodigo)) {
    const e = (entrada ?? {}) as Record<string, unknown>
    const vinc = (e.vinculos ?? {}) as Record<string, unknown>
    const listaNbs = (vinc.NBS ?? []) as unknown[]
    if (!Array.isArray(listaNbs)) continue
    for (const nbsBruto of listaNbs) {
      const link = normalizarCnaeNbsLink({ cnae: codigoCnae, nbs: nbsBruto, fonte: 'por_codigo' })
      if (!link) {
        vazio.invalidos++
        continue
      }
      const chave = `${link.cnae7}|${link.nbs}`
      if (vistos.has(chave)) {
        vazio.duplicados++
        continue
      }
      vistos.add(chave)
      vazio.links.push(link)
    }
  }

  // `respostas_de_rede`: [0] cnae×lc (677), [1] lc×nbs (1739), [2+] tracking.
  const porLc = new Map<string, string[]>()
  for (const resp of respostas) {
    const url = String(resp.url ?? '')
    const dados = resp.dados as unknown
    if (/google/i.test(url)) {
      vazio.descartadosRede++
      continue
    }
    if (!Array.isArray(dados)) continue
    if (/fallback-cnae-links/i.test(url)) {
      for (const raw of dados) {
        if (!raw || typeof raw !== 'object') continue
        const r = raw as Record<string, unknown>
        const cnae7 = somenteDigitosCnaeNbs(r.cnae)
        const lc = String(r.lc ?? '').trim()
        if (!cnae7 || !lc) {
          vazio.invalidos++
          continue
        }
        vazio.cnaeLc.push({ cnae7, cnae: fmtCnae(cnae7), lc })
        const cnaed = fixLatin1(String(r.cnaed ?? '').trim())
        if (cnaed && !vazio.descricoesAuxiliares[cnae7]) vazio.descricoesAuxiliares[cnae7] = cnaed
      }
    } else if (/fallback-relations/i.test(url)) {
      // Fidelidade à origem: guarda as 1.739 linhas (3 exatas repetidas
      // inclusas — contadas em `duplicados`, sem descarte). Linhas sem NBS/cct
      // ficam com `''` e nunca participam de join (só auditoria/descrição).
      const vistosLc = new Set<string>()
      for (const raw of dados) {
        const rel = normalizarLcNbsRelation(raw)
        if (!rel) {
          vazio.invalidos++
          continue
        }
        const chave = JSON.stringify(rel)
        if (vistosLc.has(chave)) vazio.duplicados++
        else vistosLc.add(chave)
        vazio.lcNbs.push(rel)
        if (rel.nbs) {
          const lista = porLc.get(rel.lc) ?? []
          lista.push(rel.nbs)
          porLc.set(rel.lc, lista)
        }
      }
    }
  }

  // Triangulação CNAE → LC → NBS (validação cruzada; NÃO vira link).
  const triangulados = new Set<string>()
  for (const { cnae7, lc } of vazio.cnaeLc) {
    for (const nbs of porLc.get(lc) ?? []) triangulados.add(`${cnae7}|${nbs}`)
  }
  vazio.paresTriangulados = [...triangulados]
  return vazio
}

/**
 * Normaliza UMA relação LC → NBS (`fallback-relations.json` ou artefato).
 * Fidelidade total à origem (1.739 linhas): só exige objeto — `lc`/NBS/cct
 * ausentes viram `''` (3 linhas sem LC, 6 sem NBS, 12 sem cct; com chave vazia
 * nunca participam de join, só auditoria/descrição). Descrições passam por
 * `fixLatin1()` (rede de segurança — fonte medida sem mojibake real).
 */
export function normalizarLcNbsRelation(raw: unknown): LcNbsRelation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    lc: String(r.lc ?? '').trim(),
    nbs: somenteDigitosNbsPonte(r.nbs ?? r.codigo),
    cct: padCct(r.cct ?? r.cClassTrib) ?? '',
    descricaoLc: fixLatin1(String(r.lcd ?? r.descricaoLc ?? '').trim()),
    descricaoNbs: fixLatin1(String(r.nbsd ?? r.descricaoNbs ?? '').trim()),
    descricaoCct: fixLatin1(String(r.cctd ?? r.descricaoCct ?? '').trim()),
    onerosa: String(r.onerosa ?? '').trim(),
    exterior: String(r.exterior ?? '').trim(),
    indop: String(r.indop ?? '').trim(),
    local: fixLatin1(String(r.local ?? '').trim()),
  }
}

/**
 * Texto de vedação derivado da Situação (vedação = Situação — PLAN 09 princípio 5).
 * Todo CNAE tem regra textual; nunca vazio (invariante A).
 */
export function textoVedacaoCnae(situacao: string, anexos: string[]): string[] {
  if (situacao === 'Permitido com ressalvas') {
    return [`Permitido com ressalvas no Simples Nacional${anexos.length ? ` (Anexo Simples ${anexos.join('/')})` : ''} — verificar ressalvas da atividade.`]
  }
  if (situacao === 'Depende da atividade') {
    return ['Enquadramento depende da atividade exercida — confirmar CNAE e objeto social antes de optar.']
  }
  return [`Atividade permitida no Simples Nacional${anexos.length ? ` (Anexo Simples ${anexos.join('/')})` : ''}.`]
}

/** Normaliza texto para conferência (minúsculas, sem acento, espaços colapsados). */
export function normalizarTextoConferencia(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Escolhe a descrição vencedora (precedência oficial > qualclasstrib > auxiliar).
 * Devolve a descrição + a fonte vencedora.
 */
export function escolherDescricaoConferida(
  oficial: string,
  qualclasstrib: string,
  auxiliar: string,
): { descricao: string; fonte: FonteDescricaoCnaeNbs } {
  const of = oficial.trim()
  if (of) return { descricao: of, fonte: 'oficial' }
  const q = qualclasstrib.trim()
  if (q) return { descricao: q, fonte: 'qualclasstrib' }
  return { descricao: auxiliar.trim(), fonte: 'auxiliar' }
}

/* --------------------------------------------------------------------------
   Formato A — `Tabela_NCM_Vigente_*.json` ou o artefato `nomenclatura.json`
   da base embutida (`{ itens: [...] }`)
   -------------------------------------------------------------------------- */

export function normalizarNomenclatura(bruto: unknown): NomenclaturaNcm[] {
  const pacote = bruto as { itens?: unknown; Nomenclaturas?: unknown } | null
  const fonte = Array.isArray(pacote?.itens) ? pacote?.itens : pacote?.Nomenclaturas
  const itens = (Array.isArray(fonte) ? fonte : []) as Record<string, unknown>[]
  return itens
    .map((n): NomenclaturaNcm | null => {
      const original = str(alt(n, 'Codigo', 'codigoOriginal'))
      const codigo = digits(original)
      if (codigo.length < 2) return null
      const dataFim = str(alt(n, 'Data_Fim', 'dataFim'))
      const dataInicio = str(alt(n, 'Data_Inicio', 'dataInicio'))
      return {
        codigo,
        codigoOriginal: original,
        descricao: str(alt(n, 'Descricao', 'descricao')),
        dataInicio: dataInicio || null,
        dataFim: dataFim && dataFim !== '31/12/9999' ? dataFim : null,
        ato: montarAto(n) ?? (str(n.ato) || null),
        atoFim: montarAtoFim(n),
      }
    })
    .filter((n): n is NomenclaturaNcm => n !== null)
}

const fmtNcmLocal = (d: string): string =>
  d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : d

/* --------------------------------------------------------------------------
   Formato D — `ConsultaClassificacaoProduto?sistema=*` (CFF, tabelas por DFe)
   -------------------------------------------------------------------------- */

/** Candidatos de chave para o código da classificação tributária na linha. */
const CCT_KEYS = [
  'cClassTrib', 'codClassificacao', 'codigoClassificacao', 'cod_classificacao',
  'classificacao', 'cclass', 'cct', 'codigo', 'cod',
]

/** Candidatos de chave para descrição. */
const DESC_KEYS = ['descricao', 'nome', 'descNome', 'descricaoClassificacao', 'desc']

/** Candidatos de chave para o flag permitido × negado. */
const PERMITIDO_KEYS = [
  'permitido', 'habilitado', 'ativo', 'vigente', 'indPermitido', 'permiteEmissao',
  'habilitadoParaEmissao', 'permiteUso', 'indAtivo', 'situacaoPermitida',
]

/** Candidatos de chave para vigência da linha. */
const INI_KEYS = ['dIniVig', 'inicioVigencia', 'dtInicio', 'dataInicio', 'vigenciaInicio', 'iniVig']
const FIM_KEYS = ['dFimVig', 'fimVigencia', 'dtFim', 'dataFim', 'vigenciaFim', 'fimVig']

const pega = (r: Record<string, unknown>, chaves: string[]): unknown => {
  for (const k of chaves) {
    if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return r[k]
  }
  const lower = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v]))
  for (const k of chaves) {
    const v = lower[k.toLowerCase()]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return undefined
}

/** Interpreta flag permitido × negado; `undefined` quando a linha não informa. */
const parsePermitido = (v: unknown): boolean | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v).trim().toLowerCase()
  if (['sim', 's', '1', 'true', 'ativo', 'ativa', 'permitido', 'permitida', 'habilitado', 'habilitada', 'vigente', 'liberado', 'liberada'].includes(s)) return true
  if (['não', 'nao', 'n', '0', 'false', 'inativo', 'inativa', 'negado', 'negada', 'bloqueado', 'bloqueada', 'vedado', 'vedada', 'suspenso', 'suspensa'].includes(s)) return false
  return undefined
}

export const ehBooleano = (v: unknown): boolean => {
  if (typeof v === 'boolean' || typeof v === 'number') return true
  const s = String(v ?? '').trim().toLowerCase()
  return ['sim', 'não', 'nao', 's', 'n', '1', '0', 'true', 'false'].includes(s)
}

/**
 * Normaliza a tabela de Classificação de Produtos de um sistema (NFCom, NFAg,
 * NF3e, NFGas) para `ClassificacaoProdutoSistema[]`.
 *
 * Tolerante ao formato: aceita array direto ou envelope
 * `{ itens | data | produtos | tabela | lista | result | registros }`, chaves
 * em qualquer caixa e linhas que trazem o flag com nomes diversos. Quando a
 * linha não informa permitido × negado, a presença na tabela conta como
 * permitido (`confianca: 'presenca'`); flag explícito vira `'explicita'`.
 * Idempotente e sem rede.
 */
export function normalizarClassificacaoProduto(
  bruto: unknown,
  sistema: string,
  agora = new Date().toISOString(),
): import('@/domain/entities').ClassificacaoProdutoSistema[] {
  const b = bruto as Record<string, unknown> | unknown[] | null
  const lista = Array.isArray(b)
    ? b
    : (['itens', 'data', 'produtos', 'tabela', 'lista', 'result', 'registros', 'classificacoes']
      .map((k) => (b as Record<string, unknown>)?.[k])
      .find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
  if (!Array.isArray(lista)) return []

  const vistos = new Map<string, import('@/domain/entities').ClassificacaoProdutoSistema>()

  for (const raw of lista) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const cct = padCct(pega(r, CCT_KEYS))
    if (!cct) continue

    const flagRaw = pega(r, PERMITIDO_KEYS)
    const permitidoExpl = parsePermitido(flagRaw)
    const descricao = str(pega(r, DESC_KEYS)) || null
    const ini = str(pega(r, INI_KEYS)) || null
    const fim = str(pega(r, FIM_KEYS)) || null

    const flags: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(r)) {
      if (CCT_KEYS.includes(k) || DESC_KEYS.includes(k) || PERMITIDO_KEYS.includes(k) || INI_KEYS.includes(k) || FIM_KEYS.includes(k)) continue
      if (ehBooleano(v)) flags[k] = toBool(v)
    }

    const id = `${sistema}|${cct}`
    const anterior = vistos.get(id)
    const item: import('@/domain/entities').ClassificacaoProdutoSistema = {
      id,
      sistema,
      cClassTrib: cct,
      descricao: descricao ?? anterior?.descricao ?? null,
      permitido: permitidoExpl ?? anterior?.permitido ?? true,
      confianca: permitidoExpl !== undefined ? 'explicita' : (anterior?.confianca ?? 'presenca'),
      flags: { ...(anterior?.flags ?? {}), ...flags },
      inicioVigencia: ini ?? anterior?.inicioVigencia ?? null,
      fimVigencia: fim ?? anterior?.fimVigencia ?? null,
      sincronizadoEm: agora,
    }
    vistos.set(id, item)
  }

  return [...vistos.values()]
}

/* --------------------------------------------------------------------------
   Formato E — API CFF `classTrib` (CSTs com `classificacoesTributarias`
   aninhadas). É a mesma referência dos 164 em serialização nativa da API:
   achata para os 3 registros canônicos (referência + CST + CST×cClassTrib),
   com o mesmo shape dos normalizadores DFe para que o resolvedor e a
   revalidação funcionem sem bifurcação.
   -------------------------------------------------------------------------- */

/** Mapeia os 9 documentos do `DocumentosHabilitados` a partir dos flags `Ind*` do CFF. */
function docsDoCctCff(n: Record<string, unknown>): DocumentosHabilitados {
  const docs = vazioDocs()
  const mapa: Array<[keyof DocumentosHabilitados, string]> = [
    ['NFe', 'IndNFe'], ['NFCe', 'IndNFCe'], ['CTe', 'IndCTe'],
    ['CTeOS', 'IndCTeOS'], ['BPe', 'IndBPe'], ['BPeTM', 'IndBPeTM'],
    ['NF3e', 'IndNF3e'], ['NFCom', 'IndNFCom'], ['NFSe', 'IndNFSE'],
  ]
  for (const [canon, chave] of mapa) docs[canon] = toBool(n[chave])
  return docs
}

/** Booleano CFF → 1/0, preservando `null` quando a fonte não informa. */
const boolNum = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : toBool(v) ? 1 : 0

export interface ReferenciaCffAchatada {
  referencia: ReferenciaCClassTrib[]
  cst: TabelaCst[]
  cstClassTrib: TabelaCstClassTrib[]
}

export function normalizarClassTribCff(bruto: unknown): ReferenciaCffAchatada {
  const lista = Array.isArray(bruto) ? bruto : []
  const referencia: ReferenciaCClassTrib[] = []
  const cst: TabelaCst[] = []
  const cstClassTrib: TabelaCstClassTrib[] = []

  for (const raw of lista) {
    if (!raw || typeof raw !== 'object') continue
    const pai = raw as Record<string, unknown>
    const codigo = padCst(pai.CST)
    const linhas = pai.classificacoesTributarias
    if (!codigo || !Array.isArray(linhas)) continue

    const docsCst = vazioDocs()
    let temReducao = false
    for (const item of linhas) {
      if (!item || typeof item !== 'object') continue
      const n = item as Record<string, unknown>
      const cct = padCct(n.cClassTrib)
      if (!cct) continue
      const docs = docsDoCctCff(n)
      for (const k of Object.keys(docsCst) as (keyof DocumentosHabilitados)[]) {
        docsCst[k] = docsCst[k] || docs[k]
      }
      const pRedIBS = toNum(n.pRedIBS) ?? 0
      const pRedCBS = toNum(n.pRedCBS) ?? 0
      if (pRedIBS > 0 || pRedCBS > 0) temReducao = true
      const descricao = str(n.DescricaoClassTrib)
      referencia.push({
        id: `${codigo}|${cct}`,
        cst: codigo,
        cstDescricao: str(pai.DescricaoCST),
        cClassTrib: cct,
        descricao,
        pRedIBS,
        pRedCBS,
        tipoAliquota: str(n.TipoAliquota) || null,
        anexo: n.Anexo === null || n.Anexo === undefined || n.Anexo === '' ? null : String(n.Anexo),
        urlLegislacao: str(n.Link) || null,
        exigeTributacao: toBool(pai.IndIBSCBS),
        reducaoBC: toBool(pai.IndRedBC),
        reducaoAliquota: toBool(pai.IndRedAliq),
        transferenciaCredito: toBool(pai.IndTransfCred),
        diferimento: toBool(pai.IndDif),
        monofasica: toBool(pai.IndIBSCBSMono),
        creditoPresumidoZFM: toBool(pai.IndCredPresIBSZFM),
        ajusteCompetencia: toBool(pai.IndAjusteCompet),
        tributacaoRegular: toBool(n.IndTribRegular),
        creditoPresumido: toBool(n.IndCredPresOper),
        estornoCredito: toBool(n.IndEstornoCred),
        monoNormal: toBool(n.MonofasiaPadrao),
        monoRetencao: toBool(n.MonofasiaSujeitaRetencao),
        monoRetida: toBool(n.MonofasiaRetidaAnt),
        monoDiferimentoCombustivel: toBool(n.MonofasiaDiferimento),
        simplesReceitaBruta: str(n.TipoReceitaBrutaSN) || null,
        regimeContribuicaoSocial: null,
        impostoBensServicos: null,
        docs,
      })
      cstClassTrib.push({
        id: `${codigo}|${cct}`,
        cst: codigo,
        cClassTrib: cct,
        nome: descricao,
        descricao,
        lcRedacao: null,
        lcRef: null,
        tipoAliquota: str(n.TipoAliquota) || null,
        pRedIBS: toNum(n.pRedIBS),
        pRedCBS: toNum(n.pRedCBS),
        indRedutorBC: null,
        indTribRegular: boolNum(n.IndTribRegular),
        indCredPres: boolNum(n.IndCredPresOper),
        indMono: boolNum(n.MonofasiaPadrao),
        indMonoReten: boolNum(n.MonofasiaSujeitaRetencao),
        indMonoRet: boolNum(n.MonofasiaRetidaAnt),
        indMonoDif: boolNum(n.MonofasiaDiferimento),
        creditoPara: null,
        inicioVigencia: str(n.InicioVigencia) || null,
        fimVigencia: str(n.FimVigencia) || null,
        atualizadoEm: str(n.Publicacao) || null,
      })
    }
    cst.push({
      codigo,
      descricao: str(pai.DescricaoCST),
      indIBSCBS: toBool(pai.IndIBSCBS),
      indIBSCBSMono: toBool(pai.IndIBSCBSMono),
      indReducao: toBool(pai.IndRedAliq) || toBool(pai.IndRedBC) || temReducao,
      indDiferimento: toBool(pai.IndDif),
      indTransferenciaCredito: toBool(pai.IndTransfCred),
      docs: docsCst,
    })
  }

  return { referencia, cst, cstClassTrib }
}

/* --------------------------------------------------------------------------
   Formato F — API CFF `anexos` (NCM/NBS × anexo × permissão).
   -------------------------------------------------------------------------- */

/** `Permitido` → permitido · `Não Permitido` → negado · resto/nulo → null. */
function permissaoAnexo(v: unknown): 'permitido' | 'negado' | null {
  const letras = String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\p{L}]/gu, '')
  if (!letras) return null
  if (letras.includes('naopermitido')) return 'negado'
  if (letras.includes('permitido')) return 'permitido'
  return null
}

const ehSemCodigo = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase()
  return !s || s === 'sem código' || s === 'sem codigo'
}

export function normalizarAnexosCff(bruto: unknown): AnexoNcm[] {
  const b = bruto as Record<string, unknown> | unknown[] | null
  const lista = Array.isArray(b)
    ? b
    : (['itens', 'data', 'anexos', 'lista', 'result', 'registros']
      .map((k) => (b as Record<string, unknown>)?.[k])
      .find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
  if (!Array.isArray(lista)) return []

  return (lista as unknown[])
    .map((raw, i) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const nroAnexo = toNum(r.nroAnexo)
      if (nroAnexo === null) return null
      const semCodigo = ehSemCodigo(r.codNcmNbs)
      const dig = semCodigo ? '' : digits(r.codNcmNbs)
      const codigo = dig || null
      return {
        id: `${codigo ?? 'sem-codigo'}|${nroAnexo}|${i}`,
        codigo,
        tipo: !codigo ? null : codigo.length === 8 ? 'NCM' : codigo.length === 9 ? 'NBS' : null,
        permissao: permissaoAnexo(r.TipoPermissao),
        nroAnexo,
        nroItemAnexoLei: toNum(r.nroItemAnexoLei),
        descrAnexo: str(r.descrAnexo),
        descrItemAnexo: str(r.descrItemAnexo) || null,
        descrCondicao: str(r.descrCondicao) || null,
        descrExcecao: str(r.descrExcecao) || null,
        observacao: str(r.texObservacao) || null,
        inicioVigencia: str(r.dthIniVig) || null,
        fimVigencia: str(r.dthFimVig) || null,
      } satisfies AnexoNcm
    })
    .filter((a): a is AnexoNcm => a !== null)
}

/* --------------------------------------------------------------------------
   Formato G — API CFF `ConsultaClassificacaoProduto` (formato real: catálogo
   por `codClassProd` de 7 dígitos). O sistema de origem NÃO vem no arquivo
   (o mesmo código existe em sistemas diferentes com descrições diferentes),
   por isso `sistema` é parâmetro obrigatório.
   -------------------------------------------------------------------------- */

export function normalizarProdutoDfe(
  bruto: unknown,
  sistema: string,
  agora = new Date().toISOString(),
): ProdutoDfe[] {
  const sist = String(sistema ?? '').trim()
  if (!sist) throw new Error('Sistema de origem não informado (NFCom, NFAg, NF3e ou NFGas).')
  const b = bruto as Record<string, unknown> | unknown[] | null
  const lista = Array.isArray(b)
    ? b
    : (['itens', 'data', 'produtos', 'tabela', 'lista', 'result', 'registros']
      .map((k) => (b as Record<string, unknown>)?.[k])
      .find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
  if (!Array.isArray(lista)) return []

  const vistos = new Map<string, ProdutoDfe>()
  for (const raw of lista) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const cod = digits(r.codClassProd)
    if (!cod) continue
    const flags: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(r)) {
      if (['codClassProd', 'codGrupoClass', 'descrGrupoProd', 'descrClassProd', 'tipoPrestServico'].includes(k)) continue
      if (ehBooleano(v)) flags[k] = toBool(v)
    }
    const id = `${sist}|${cod}`
    vistos.set(id, {
      id,
      sistema: sist,
      codClassProd: cod,
      codGrupo: str(r.codGrupoClass) || null,
      descrGrupo: str(r.descrGrupoProd) || null,
      descricao: str(r.descrClassProd),
      tipoPrestacao: str(r.tipoPrestServico) || null,
      flags,
      sincronizadoEm: agora,
    })
  }
  return [...vistos.values()]
}

/* --------------------------------------------------------------------------
   Formatos H/I — CFF `credPresumido` e `indOper` (conversão tipada real).
   Sem chave com NCM/cClassTrib: viram tabelas de referência versionadas
   (informação adicional + consulta nas tabelas oficiais).
   -------------------------------------------------------------------------- */

function extrairLista(bruto: unknown): unknown[] {
  const b = bruto as Record<string, unknown> | unknown[] | null
  const lista = Array.isArray(b)
    ? b
    : (['itens', 'data', 'lista', 'result', 'registros']
      .map((k) => (b as Record<string, unknown>)?.[k])
      .find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
  return Array.isArray(lista) ? lista : []
}

export function normalizarCreditoPresumido(bruto: unknown): CreditoPresumido[] {
  return extrairLista(bruto)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const cod = toNum(r.codCredPres)
      if (cod === null) return null
      return {
        cod,
        descricao: str(r.descrCredPres),
        indIbs: toBool(r.indIbs),
        indCbs: toBool(r.indCbs),
        apropriaDfe: toBool(r.indApropriaDfe),
        apropriaEvento: toBool(r.indApropriaEvento),
        condSuspensiva: toBool(r.indCondSuspensiva),
        deduz: toBool(r.indDeduzCredPres),
        iniVigIbs: str(r.dthIniVigIbs) || null,
        fimVigIbs: str(r.dthFimVigIbs) || null,
        iniVigCbs: str(r.dthIniVigCbs) || null,
        fimVigCbs: str(r.dthFimVigCbs) || null,
      } satisfies CreditoPresumido
    })
    .filter((c): c is CreditoPresumido => c !== null)
}

export function normalizarLocaisOperacao(bruto: unknown): LocalOperacao[] {
  return extrairLista(bruto)
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const cod = str(r.codOperacao)
      if (!cod) return null
      return {
        cod,
        nome: str(r.nomeOperacao),
        dispLegal: str(r.texDispLegal) || null,
        localOperacao: str(r.texLocalOperacao) || null,
        localFornec: str(r.texLocalFornec) || null,
        caractFornec: str(r.texCaractFornec) || null,
        publicacao: str(r.dthPublicacao) || null,
        iniVig: str(r.dthIniVig) || null,
        fimVig: str(r.dthFimVig) || null,
      } satisfies LocalOperacao
    })
    .filter((l): l is LocalOperacao => l !== null)
}
