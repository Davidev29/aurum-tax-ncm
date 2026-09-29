import type {
  DocumentosHabilitados,
  NomenclaturaNcm,
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
        id: typeof n.id === 'string' && n.id ? n.id : `${codigo}|${i}`,
        codigo,
        cst: padCst(n.cst) ?? '',
        cClassTrib: padCct(n.cClassTrib) ?? '',
        baseLegal: str(n.baseLegal),
        aliquotaIBS: toNum(n.aliquotaIBS),
        aliquotaCBS: toNum(n.aliquotaCBS),
        descricao: str(alt(n, 'descricaoCompleta', 'descricao')),
      } satisfies VinculoNbs
    })
    .filter((n): n is VinculoNbs => n !== null)
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
    .map((n) => {
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
      } satisfies NomenclaturaNcm
    })
    .filter((n): n is NomenclaturaNcm => n !== null)
}

const fmtNcmLocal = (d: string): string =>
  d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : d
