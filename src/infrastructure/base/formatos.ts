/**
 * Reconhecimento de bases pelo **conteúdo** (fingerprint), nunca pelo nome do
 * arquivo — nomes vindos de download (`ConsultaClassificacaoProduto (1).json`)
 * perdem a origem (`?sistema=NFCom|NFAg|NF3e|NFGas`).
 *
 * Precedência (primeiro teste vence): nomenclatura → reforma → classtrib-cff →
 * referencia-dfe → anexos → credito-presumido → indoper → classprod → desconhecido.
 * Cada teste exige a chave-assinatura do formato para evitar falso positivo
 * entre `referencia` (flat) e `reforma` (vínculos com `codigo`).
 */

export type TipoBase =
  | 'nomenclatura'
  | 'reforma'
  | 'referencia-dfe'
  | 'classtrib-cff'
  | 'anexos-cff'
  | 'credito-presumido-cff'
  | 'indoper-cff'
  | 'classprod-cff'
  | 'cnae-anexo'
  | 'nbs-servicos'
  | 'desconhecido'

export interface InfoBase {
  tipo: TipoBase
  /** Rótulo curto para a UI. */
  rotulo: string
  /** Store(s) de destino no Dexie. */
  destino: string
  /** Verdadeiro quando a importação exige o sistema (classprod). */
  precisaSistema: boolean
}

const INFO: Record<TipoBase, Omit<InfoBase, 'tipo'>> = {
  nomenclatura: { rotulo: 'NCM vigente (Siscomex)', destino: 'ncmNomenclatura', precisaSistema: false },
  reforma: { rotulo: 'Reforma por NCM/NBS (vínculos)', destino: 'ncm, cst, cstClassTrib, nbs', precisaSistema: false },
  'referencia-dfe': { rotulo: 'Classificação tributária (DFe/portal)', destino: 'referencia', precisaSistema: false },
  'classtrib-cff': { rotulo: 'Classificação tributária (API CFF)', destino: 'referencia, cst, cstClassTrib', precisaSistema: false },
  'anexos-cff': { rotulo: 'Anexos por NCM/NBS (API CFF)', destino: 'anexos', precisaSistema: false },
  'credito-presumido-cff': { rotulo: 'Crédito presumido (API CFF)', destino: 'meta (versionado)', precisaSistema: false },
  'indoper-cff': { rotulo: 'Locais de operação (API CFF)', destino: 'meta (versionado)', precisaSistema: false },
  'classprod-cff': { rotulo: 'Produtos por DFe (API CFF)', destino: 'produtosDfe', precisaSistema: true },
  'cnae-anexo': { rotulo: 'CNAE × Anexo Simples (arquivo vivo)', destino: 'cnae', precisaSistema: false },
  'nbs-servicos': { rotulo: 'NBS Serviços (arquivo vivo)', destino: 'nbs', precisaSistema: false },
  desconhecido: { rotulo: 'Formato não reconhecido', destino: '—', precisaSistema: false },
}

export function infoBase(tipo: TipoBase): InfoBase {
  return { tipo, ...INFO[tipo] }
}

const ehObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Detecta o tipo da base pelo conteúdo. Idempotente e sem I/O: aceita tanto o
 * JSON oficial bruto quanto artefatos já normalizados (`{ tipo, itens }`).
 */
export function fingerprintBase(json: unknown): TipoBase {
  if (!json || typeof json !== 'object') return 'desconhecido'

  // Envelopes já normalizados da base embutida.
  if (ehObj(json) && typeof json.tipo === 'string') {
    if (json.tipo === 'nomenclatura' && Array.isArray(json.itens)) return 'nomenclatura'
    if (json.tipo === 'reforma') return 'reforma'
    if (json.tipo === 'cnae' && Array.isArray(json.itens)) return 'cnae-anexo'
    if (json.tipo === 'classificacao-tributaria' && Array.isArray(json.itens)) return 'referencia-dfe'
  }

  if (ehObj(json)) {
    // Tabela NCM vigente (Siscomex).
    if (Array.isArray(json.Nomenclaturas)) return 'nomenclatura'
    // Vínculos da Reforma (bruto `NCM` ou normalizado `ncm`).
    if (Array.isArray(json.NCM) || Array.isArray(json.ncm)) return 'reforma'
  }

  if (Array.isArray(json)) {
    const prim = json[0] as Record<string, unknown> | undefined
    if (!prim || typeof prim !== 'object') return 'desconhecido'
    // Phase 7 — arquivos vivos de Serviços (chaves PT acentuadas).
    if ('CNAE' in prim) return 'cnae-anexo'
    if ('NBS' in prim) return 'nbs-servicos'
    // API CFF `classTrib`: CSTs com classificações aninhadas.
    if ('classificacoesTributarias' in prim && 'CST' in prim) return 'classtrib-cff'
    // API CFF `anexos`: linhas NCM/NBS × anexo.
    if ('nroAnexo' in prim && 'codNcmNbs' in prim) return 'anexos-cff'
    // API CFF `credPresumido`.
    if ('codCredPres' in prim) return 'credito-presumido-cff'
    // API CFF `indOper`.
    if ('codOperacao' in prim) return 'indoper-cff'
    // API CFF `ConsultaClassificacaoProduto`: catálogo por produto.
    if ('codClassProd' in prim) return 'classprod-cff'
    // Portal DFe flat (chaves PT) ou linhas já normalizadas da referência.
    if ('Código da Situação Tributária' in prim) return 'referencia-dfe'
    if ('cst' in prim && 'cClassTrib' in prim && !('codigo' in prim)) return 'referencia-dfe'
  }

  return 'desconhecido'
}
