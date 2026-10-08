/**
 * Protocolo do banco SQLite — tipos e metadados compartilhados.
 *
 * Zero dependências (sem Node, sem Prisma, sem DOM): importado pelo renderer
 * (`motor.ts`), pelo processo main (`electron/main/db.ts`), pelo preload
 * (tipos) e pelos testes. Nada aqui executa I/O.
 */

/** Filtro indexado traduzível para SQL (única coisa que viaja ao main). */
export type OpWhere =
  | { tipo: 'equals'; campo: string; valor: string | number | null }
  | { tipo: 'anyOf'; campo: string; valores: Array<string | number> }
  | { tipo: 'between'; campo: string; min: string | number; max: string | number; incMin: boolean; incMax: boolean }
  | { tipo: 'composto'; campos: string[]; valores: Array<string | number> }
  | { tipo: 'startsWith'; campo: string; prefixo: string }

/** Operações genéricas do canal `db:op` (allowlist no main). */
export type DbOpKind =
  | 'buscar'
  | 'contar'
  | 'porChave'
  | 'inserir'
  | 'upsert'
  | 'lote'
  | 'atualizar'
  | 'remover'
  | 'limpar'
  | 'removerOnde'
  | 'apagarTudo'

export interface DbOp {
  op: DbOpKind
  tabela?: string
  tabelas?: string[]
  where?: OpWhere | null
  chave?: string | number
  registro?: Record<string, unknown>
  patch?: Record<string, unknown>
  registros?: Array<Record<string, unknown>>
  /** Lote `'inserir'` = só-insere (pula duplicadas); padrão `'upsert'`. */
  modo?: 'upsert' | 'inserir'
}

/** Modo de escrita em lote. */
export type ModoLote = 'upsert' | 'inserir'

/** Metadados de cada store: chave primária, auto-incremento e delegate Prisma. */
export interface StoreMeta {
  pk: string
  auto: boolean
  delegate: string
}

export const STORE_META: Record<string, StoreMeta> = {
  ncm: { pk: 'id', auto: false, delegate: 'vinculoNcm' },
  nbs: { pk: 'id', auto: false, delegate: 'vinculoNbs' },
  cst: { pk: 'codigo', auto: false, delegate: 'tabelaCst' },
  cstClassTrib: { pk: 'id', auto: false, delegate: 'tabelaCstClassTrib' },
  referencia: { pk: 'id', auto: false, delegate: 'referenciaCClassTrib' },
  ncmNomenclatura: { pk: 'codigo', auto: false, delegate: 'nomenclaturaNcm' },
  empresas: { pk: 'id', auto: true, delegate: 'empresa' },
  produtos: { pk: 'id', auto: true, delegate: 'produto' },
  meta: { pk: 'chave', auto: false, delegate: 'meta' },
  cfop: { pk: 'codigo', auto: false, delegate: 'cfop' },
  cstIcms: { pk: 'codigo', auto: false, delegate: 'cstIcms' },
  cstPisCofins: { pk: 'codigo', auto: false, delegate: 'cstPisCofins' },
  nfeNotas: { pk: 'id', auto: true, delegate: 'nfeNota' },
  reclassificacoesManuais: { pk: 'ncm', auto: false, delegate: 'reclassificacaoManual' },
  classificacaoProduto: { pk: 'id', auto: false, delegate: 'classificacaoProdutoSistema' },
  anexos: { pk: 'id', auto: false, delegate: 'anexoNcm' },
  produtosDfe: { pk: 'id', auto: false, delegate: 'produtoDfe' },
  audit_log: { pk: 'id', auto: true, delegate: 'auditLog' },
  cest: { pk: 'codigo', auto: false, delegate: 'tabelaCest' },
  ia_feedback: { pk: 'id', auto: true, delegate: 'iaFeedback' },
  cnae: { pk: 'codigo7', auto: false, delegate: 'cnaeAnexo' },
  consultasCnpj: { pk: 'cnpj', auto: false, delegate: 'consultaCnpj' },
  conversasEmitente: { pk: 'conversaId', auto: false, delegate: 'conversaEmitente' },
  cnaeNbs: { pk: 'id', auto: true, delegate: 'cnaeNbsLink' },
  lcNbs: { pk: 'id', auto: true, delegate: 'lcNbsRelation' },
  classificacoesConsolidadas: { pk: 'cnae7', auto: false, delegate: 'classificacaoConsolidada' },
  grafometa: { pk: 'id', auto: false, delegate: 'grafoMeta' },
}

/** Todas as stores conhecidas (allowlist do IPC + `contarTodos`). */
export const TODAS_STORES = Object.keys(STORE_META)

/** `'[a+b]'` → `['a','b']`; campo simples → `[campo]`. */
export function camposDe(indice: string): string[] {
  const t = indice.trim()
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split('+')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return [t]
}

/** Nome de campo/índice seguro para SQL (defesa em profundidade — o Prisma já parametriza). */
export function campoSeguro(nome: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)
}

/**
 * Campos conhecidos de cada store (colunas do Prisma).
 *
 * O Dexie era schemaless e aceitava campos extras (ex.: `id` gerado sobre a
 * store `cfop`, cuja chave é `codigo`). O Prisma rejeita argumento
 * desconhecido — então os drivers REMOVEM o que não é coluna antes de
 * gravar (após validar, nunca antes). Campos ausentes viram NULL/default.
 */
export const CAMPOS_POR_STORE: Record<string, string[]> = {
  ncm: ['id', 'codigo', 'codigoFormatado', 'cst', 'cClassTrib', 'baseLegal', 'reducao', 'aliquotaIBS', 'aliquotaCBS', 'descricao', 'documentos'],
  nbs: ['id', 'codigo', 'cst', 'cClassTrib', 'baseLegal', 'reducao', 'aliquotaIBS', 'aliquotaCBS', 'descricao', 'documentos'],
  cst: ['codigo', 'descricao', 'indIBSCBS', 'indIBSCBSMono', 'indReducao', 'indDiferimento', 'indTransferenciaCredito', 'docs'],
  cstClassTrib: ['id', 'cst', 'cClassTrib', 'nome', 'descricao', 'lcRedacao', 'lcRef', 'tipoAliquota', 'pRedIBS', 'pRedCBS', 'indRedutorBC', 'indTribRegular', 'indCredPres', 'indMono', 'indMonoReten', 'indMonoRet', 'indMonoDif', 'creditoPara', 'inicioVigencia', 'fimVigencia', 'atualizadoEm'],
  referencia: ['id', 'cst', 'cstDescricao', 'cClassTrib', 'descricao', 'pRedIBS', 'pRedCBS', 'tipoAliquota', 'anexo', 'urlLegislacao', 'exigeTributacao', 'reducaoBC', 'reducaoAliquota', 'transferenciaCredito', 'diferimento', 'monofasica', 'creditoPresumidoZFM', 'ajusteCompetencia', 'tributacaoRegular', 'creditoPresumido', 'estornoCredito', 'monoNormal', 'monoRetencao', 'monoRetida', 'monoDiferimentoCombustivel', 'simplesReceitaBruta', 'regimeContribuicaoSocial', 'impostoBensServicos', 'docs'],
  ncmNomenclatura: ['codigo', 'codigoOriginal', 'descricao', 'dataInicio', 'dataFim', 'ato', 'atoFim'],
  empresas: ['id', 'razaoSocial', 'cnpj', 'fantasia', 'criadoEm', 'ie', 'im', 'regimeTributario', 'endereco', 'cidade', 'uf', 'cep', 'telefone', 'email'],
  produtos: ['id', 'empresaId', 'codigo', 'nome', 'ncm', 'cfop', 'cstIcms', 'pis', 'cofins', 'quantidade', 'valorUnitario', 'cstReforma', 'cClassTrib', 'regraGeral', 'classificacaoManual', 'classificacaoSnapshot', 'baseLegal', 'criadoEm', 'atualizadoEm'],
  meta: ['chave', 'valor', 'data', 'arquivo', 'total', 'quando', 'atualizadoEm'],
  cfop: ['codigo', 'descricao', 'tipo'],
  cstIcms: ['codigo', 'descricao', 'tipo'],
  cstPisCofins: ['codigo', 'descricao', 'tipo'],
  nfeNotas: ['id', 'empresaId', 'chave', 'numero', 'serie', 'modelo', 'natOp', 'dataEmissao', 'emitCnpj', 'emitNome', 'emitCrt', 'emitIe', 'emitIm', 'emitEndereco', 'emitCidade', 'emitUf', 'destDoc', 'destNome', 'destIe', 'valorProdutos', 'valorTotal', 'totalIbsXml', 'totalCbsXml', 'totalCreditoIbsCbsXml', 'arquivo', 'xmlConteudo', 'refIBS', 'refCBS', 'totalIBS', 'totalCBS', 'totalTributos', 'importadoEm', 'itens', 'itensAnalisados', 'direcao'],
  reclassificacoesManuais: ['ncm', 'cst', 'cClassTrib', 'descricao', 'fonteDescricao', 'fonteUrl', 'criadoEm', 'atualizadoEm'],
  classificacaoProduto: ['id', 'sistema', 'cClassTrib', 'descricao', 'permitido', 'confianca', 'flags', 'inicioVigencia', 'fimVigencia', 'sincronizadoEm'],
  anexos: ['id', 'codigo', 'tipo', 'permissao', 'nroAnexo', 'nroItemAnexoLei', 'descrAnexo', 'descrItemAnexo', 'descrCondicao', 'descrExcecao', 'observacao', 'inicioVigencia', 'fimVigencia'],
  produtosDfe: ['id', 'sistema', 'codClassProd', 'codGrupo', 'descrGrupo', 'descricao', 'tipoPrestacao', 'flags', 'sincronizadoEm'],
  audit_log: ['id', 'quando', 'tabela', 'chave', 'operacao', 'autor', 'antes', 'depois'],
  cest: ['codigo', 'descricao', 'ncm'],
  ia_feedback: ['id', 'quando', 'descricao', 'via', 'decisao', 'confianca', 'motivo', 'mock'],
  cnae: ['codigo7', 'codigoFormatado', 'descricao', 'situacao', 'anexos', 'fatorR'],
  consultasCnpj: ['cnpj', 'razaoSocial', 'fantasia', 'porte', 'situacao', 'opcaoSimples', 'cnaePrincipal', 'cnaesSecundarios', 'quando'],
  conversasEmitente: ['conversaId', 'emitenteId', 'empresaAtivaId', 'titulo', 'mensagens', 'updatedAt', 'createdAt'],
  cnaeNbs: ['id', 'cnae7', 'cnae', 'nbs', 'fonte'],
  lcNbs: ['id', 'lc', 'nbs', 'cct', 'descricaoLc', 'descricaoNbs', 'descricaoCct', 'onerosa', 'exterior', 'indop', 'local'],
  classificacoesConsolidadas: ['cnae7', 'codigoFormatado', 'descricao', 'fonteDescricao', 'anexoSimples', 'situacao', 'fatorR', 'vedacoes', 'nbsVinculadas', 'beneficiosReforma', 'divergencia', 'estadoNbs'],
  grafometa: ['id', 'hash', 'versao', 'nodos', 'arestas', 'geradoEm'],
}

/** Remove campos que não são coluna (paridade schemaless do Dexie). */
export function somenteConhecidos(tabela: string, registro: Record<string, unknown>): Record<string, unknown> {
  const conhecidos = CAMPOS_POR_STORE[tabela]
  if (!conhecidos) throw new Error(`validacao:${tabela}:store-desconhecida`)
  const out: Record<string, unknown> = {}
  for (const c of conhecidos) {
    if (registro[c] !== undefined) out[c] = registro[c]
  }
  return out
}
