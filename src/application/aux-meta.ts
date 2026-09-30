/**
 * Metadados das **tabelas auxiliares** — descrevem, por tipo, a store, a chave,
 * os campos do formulário de edição e as colunas da listagem.
 *
 * Espelha SPEC §9.1 (`AUX_META`), mas declarativamente: a UI de edição é
 * genérica e renderiza a partir daqui (Clean Code — um único lugar para
 * adicionar ou alterar uma tabela).
 */
import { DOCUMENTOS, type StoreName } from '@/domain/constants'
import { fmtNcm, norm } from '@/domain/services/format'
import type { MaskKey } from '@/domain/services/format'

export type TipoAux = 'cst' | 'cstct' | 'ncmnomen' | 'ncm' | 'cfop' | 'csticms' | 'cstpiscofins' | 'cest'

export type TipoCampoAux = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'docs'

export interface CampoAux {
  nome: string
  label: string
  tipo: TipoCampoAux
  required?: boolean
  mask?: MaskKey
  mono?: boolean
  maxLength?: number
  readOnlyOnEdit?: boolean
  colSpan?: 1 | 2
  options?: readonly string[]
}

export interface MetaAux {
  tipo: TipoAux
  store: StoreName
  keyPath: 'codigo' | 'id'
  titulo: string
  singular: string
  campos: CampoAux[]
  /** Texto concatenado usado pelo filtro de busca. */
  texto: (r: Record<string, unknown>) => string
  /** Valor da chave do registro. */
  chave: (r: Record<string, unknown>) => string
}

const str = (v: unknown): string => (v == null ? '' : String(v))

export const AUX_META: Record<TipoAux, MetaAux> = {
  cst: {
    tipo: 'cst',
    store: 'cst',
    keyPath: 'codigo',
    titulo: 'CST IBS/CBS',
    singular: 'CST IBS/CBS',
    campos: [
      { nome: 'codigo', label: 'Código CST (3 dígitos)', tipo: 'text', mask: 'cst', required: true, mono: true, readOnlyOnEdit: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', required: true, colSpan: 2 },
      { nome: 'indIBSCBS', label: 'Tributação integral', tipo: 'boolean' },
      { nome: 'indIBSCBSMono', label: 'Monofásica', tipo: 'boolean' },
      { nome: 'indReducao', label: 'Redução de alíquota', tipo: 'boolean' },
      { nome: 'indDiferimento', label: 'Diferimento', tipo: 'boolean' },
      { nome: 'indTransferenciaCredito', label: 'Transferência de crédito', tipo: 'boolean' },
      { nome: 'docs', label: 'Documentos habilitados', tipo: 'docs' },
    ],
    texto: (r) => `${str(r.codigo)} ${str(r.descricao)}`.toLowerCase(),
    chave: (r) => str(r.codigo),
  },

  cstct: {
    tipo: 'cstct',
    store: 'cstClassTrib',
    keyPath: 'id',
    titulo: 'cClassTrib',
    singular: 'cClassTrib',
    campos: [
      { nome: 'cst', label: 'CST', tipo: 'text', mask: 'cst', required: true, mono: true },
      { nome: 'cClassTrib', label: 'cClassTrib', tipo: 'text', required: true, mono: true, maxLength: 6 },
      { nome: 'nome', label: 'Nome', tipo: 'text', required: true },
      { nome: 'tipoAliquota', label: 'Tipo de alíquota', tipo: 'text' },
      { nome: 'pRedIBS', label: 'Redução IBS (%)', tipo: 'number' },
      { nome: 'pRedCBS', label: 'Redução CBS (%)', tipo: 'number' },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', colSpan: 2 },
      { nome: 'lcRef', label: 'Referência legal', tipo: 'text', colSpan: 2 },
      { nome: 'lcRedacao', label: 'Redação da LC', tipo: 'textarea', colSpan: 2 },
    ],
    texto: (r) => `${str(r.cClassTrib)} ${str(r.cst)} ${str(r.nome)} ${str(r.descricao)}`.toLowerCase(),
    chave: (r) => str(r.id),
  },

  ncmnomen: {
    tipo: 'ncmnomen',
    store: 'ncmNomenclatura',
    keyPath: 'codigo',
    titulo: 'Nomenclatura NCM',
    singular: 'NCM',
    campos: [
      { nome: 'codigo', label: 'Código NCM', tipo: 'text', mask: 'ncm', required: true, mono: true, readOnlyOnEdit: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', required: true, colSpan: 2 },
      { nome: 'dataInicio', label: 'Início de vigência', tipo: 'text' },
      { nome: 'dataFim', label: 'Fim de vigência', tipo: 'text' },
      { nome: 'ato', label: 'Ato', tipo: 'text', colSpan: 2 },
    ],
    texto: (r) => `${str(r.codigo)} ${str(r.descricao)} ${str(r.ato)}`.toLowerCase(),
    chave: (r) => str(r.codigo),
  },

  ncm: {
    tipo: 'ncm',
    store: 'ncm',
    keyPath: 'id',
    titulo: 'NCM × Classificação',
    singular: 'Vínculo NCM',
    campos: [
      { nome: 'codigo', label: 'Código NCM', tipo: 'text', mask: 'ncm', required: true, mono: true },
      { nome: 'cst', label: 'CST', tipo: 'text', mask: 'cst', required: true, mono: true },
      { nome: 'cClassTrib', label: 'cClassTrib', tipo: 'text', required: true, mono: true, maxLength: 6 },
      { nome: 'baseLegal', label: 'Base legal', tipo: 'text' },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', colSpan: 2 },
      { nome: 'aliquotaIBS', label: 'Alíquota IBS (%)', tipo: 'number' },
      { nome: 'aliquotaCBS', label: 'Alíquota CBS (%)', tipo: 'number' },
    ],
    texto: (r) => `${norm(r.codigo)} ${str(r.cst)} ${str(r.cClassTrib)} ${str(r.descricao)}`.toLowerCase(),
    chave: (r) => str(r.id),
  },

  cfop: {
    tipo: 'cfop',
    store: 'cfop',
    keyPath: 'codigo',
    titulo: 'CFOP',
    singular: 'CFOP',
    campos: [
      { nome: 'codigo', label: 'Código CFOP', tipo: 'text', mask: 'cfop', required: true, mono: true, readOnlyOnEdit: true },
      { nome: 'tipo', label: 'Tipo', tipo: 'select', options: ['Entrada', 'Saída', 'Outros'] as const, required: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', required: true, colSpan: 2 },
    ],
    texto: (r) => `${str(r.codigo)} ${str(r.descricao)} ${str(r.tipo)}`.toLowerCase(),
    chave: (r) => str(r.codigo),
  },

  csticms: {
    tipo: 'csticms',
    store: 'cstIcms',
    keyPath: 'codigo',
    titulo: 'CST ICMS',
    singular: 'CST ICMS',
    campos: [
      { nome: 'codigo', label: 'Código CST', tipo: 'text', mask: 'cst', required: true, mono: true, readOnlyOnEdit: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', required: true, colSpan: 2 },
    ],
    texto: (r) => `${str(r.codigo)} ${str(r.descricao)}`.toLowerCase(),
    chave: (r) => str(r.codigo),
  },

  cstpiscofins: {
    tipo: 'cstpiscofins',
    store: 'cstPisCofins',
    keyPath: 'codigo',
    titulo: 'CST PIS/COFINS',
    singular: 'CST PIS/COFINS',
    campos: [
      { nome: 'codigo', label: 'Código CST', tipo: 'text', mask: 'cstPis', required: true, mono: true, readOnlyOnEdit: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', required: true, colSpan: 2 },
    ],
    texto: (r) => `${str(r.codigo)} ${str(r.descricao)}`.toLowerCase(),
    chave: (r) => str(r.codigo),
  },

  cest: {
    tipo: 'cest',
    store: 'cest',
    keyPath: 'codigo',
    titulo: 'CEST',
    singular: 'CEST',
    campos: [
      { nome: 'codigo', label: 'Código CEST (7 dígitos)', tipo: 'text', required: true, mono: true, maxLength: 7, readOnlyOnEdit: true },
      { nome: 'descricao', label: 'Descrição', tipo: 'textarea', required: true, colSpan: 2 },
      { nome: 'ncm', label: 'NCM vinculado (8 dígitos)', tipo: 'text', mask: 'ncm', mono: true },
    ],
    texto: (r) => `${str(r.codigo)} ${str(r.descricao)} ${str(r.ncm)}`.toLowerCase(),
    chave: (r) => str(r.codigo),
  },
}

export const TIPOS_AUX: TipoAux[] = ['cst', 'cstct', 'ncm', 'ncmnomen', 'cfop', 'csticms', 'cstpiscofins', 'cest']

/** Formata uma célula de listagem conforme o tipo de tabela. */
export function celulaAux(tipo: TipoAux, campo: string, valor: unknown): string {
  if (valor == null) return '—'
  if (campo === 'codigo' && (tipo === 'ncm' || tipo === 'ncmnomen')) return fmtNcm(valor)
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não'
  if (campo === 'docs') return docsHabilitados(valor)
  if (typeof valor === 'object') return Array.isArray(valor) ? String(valor.length) : '—'
  const s = String(valor)
  return s.length > 160 ? `${s.slice(0, 160)}…` : s
}

/** `docs` → relação de documentos habilitados (`NFe · CTe`), como na v1. */
function docsHabilitados(valor: unknown): string {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return '—'
  const ativos = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v === true || v === 1 || String(v).toLowerCase() === 'sim')
    .map(([k]) => k)
  return ativos.length ? ativos.join(' · ') : '—'
}

/** Ordem das colunas exibidas em cada listagem. */
export const COLUNAS_AUX: Record<TipoAux, string[]> = {
  cst: ['codigo', 'descricao', 'indIBSCBS', 'indReducao', 'indDiferimento', 'docs'],
  cstct: ['cst', 'cClassTrib', 'nome', 'tipoAliquota', 'pRedIBS', 'pRedCBS'],
  ncm: ['codigo', 'cst', 'cClassTrib', 'baseLegal', 'descricao'],
  ncmnomen: ['codigo', 'descricao', 'dataInicio', 'ato'],
  cfop: ['codigo', 'tipo', 'descricao'],
  csticms: ['codigo', 'descricao'],
  cstpiscofins: ['codigo', 'descricao'],
  cest: ['codigo', 'descricao', 'ncm'],
}

export const ROTULOS_COLUNA: Record<string, string> = {
  codigo: 'Código',
  descricao: 'Descrição',
  indIBSCBS: 'Integral',
  indReducao: 'Redução',
  indDiferimento: 'Diferimento',
  docs: 'Docs',
  cst: 'CST',
  cClassTrib: 'cClassTrib',
  nome: 'Nome',
  tipoAliquota: 'Tipo',
  pRedIBS: 'Red. IBS',
  pRedCBS: 'Red. CBS',
  baseLegal: 'Base legal',
  tipo: 'Tipo',
  dataInicio: 'Início',
  ato: 'Ato',
  ncm: 'NCM',
}

export const DOCUMENTOS_AUX = DOCUMENTOS
