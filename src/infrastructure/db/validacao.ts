/**
 * Validação de escrita do SQLite — segunda camada depois do Prisma.
 *
 * O Prisma garante tipos, NOT NULL, @unique e @id (fail-closed). Aqui vão as
 * regras de DOMÍNIO fiscal que o schema relacional não expressa:
 *   - formatos (CNPJ 14 dígitos, NCM 8, NBS 9, CEST 7, CNAE 7, chave 44…);
 *   - enums fechados (situação CNAE, direção da nota, operação de auditoria…);
 *   - números finitos (nunca NaN/Infinity, que corromperiam backup JSON);
 *   - tetos de texto (defesa contra blobs acidentais).
 *
 * Toda escrita (`put`/`add`/`bulkPut`/`update`) passa por
 * `validarRegistro()` em TODOS os drivers (Prisma direto, IPC/main e
 * memória/web) — e o processo main revalida o que chega via IPC
 * (renderer nunca é confiável).
 *
 * Decisões intencionais (não afrouxar sem revisar os fluxos):
 * - CNPJ: exige 14 dígitos, mas NÃO checa DV aqui — o DV é regra de entrada
 *   (já existe em `consultar-por-cnpj`/`cnpj.ts`); fixtures e XMLs legados
 *   usam dígitos formalmente válidos que podem não passar no DV.
 * - `Empresa.cnpj` aceita `''` (fluxo manual legado sem CNPJ).
 * - `Produto.ncm` aceita 0–10 dígitos (o lote grava NCM bruto e o motor
 *   classifica depois; o formulário exige 8 em `produtos.ts`).
 * - Tabelas de base oficial (ncm/nbs/cst/…) validam estrutura + presença;
 *   formatos rígidos ficam nos dados de usuário (não bloquear evolução da
 *   base oficial por validação estrita demais).
 */

const TETO_TEXTO = 20000
const TETO_TEXTO_CURTO = 500

function falha(store: string, motivo: string): never {
  throw new Error(`validacao:${store}:${motivo}`)
}

type Rec = Record<string, unknown>

function texto(v: unknown, store: string, campo: string, teto = TETO_TEXTO, obrigatorio = true): string {
  if (v === undefined || v === null) {
    if (!obrigatorio) return v as unknown as string
    return falha(store, `${campo}-ausente`)
  }
  if (typeof v !== 'string') return falha(store, `${campo}-nao-texto`)
  if (obrigatorio && !v.trim()) return falha(store, `${campo}-vazio`)
  if (v.length > teto) return falha(store, `${campo}-longo`)
  return v
}

function textoOuNulo(v: unknown, store: string, campo: string, teto = TETO_TEXTO): string | null | undefined {
  if (v === undefined || v === null) return v as null | undefined
  if (typeof v !== 'string') return falha(store, `${campo}-nao-texto`)
  if (v.length > teto) return falha(store, `${campo}-longo`)
  return v
}

function digitos(v: unknown, store: string, campo: string, tamanhos: number[], permitirVazio = false): string {
  const s = texto(v, store, campo, 100, !permitirVazio)
  if (permitirVazio && s === '') return s
  if (!/^\d+$/.test(s) || !tamanhos.includes(s.length)) {
    return falha(store, `${campo}-formato`)
  }
  return s
}

function numero(v: unknown, store: string, campo: string, obrigatorio = true): number {
  if (v === undefined || v === null) {
    if (!obrigatorio) return v as unknown as number
    return falha(store, `${campo}-ausente`)
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return falha(store, `${campo}-nao-numerico`)
  return v
}

function numeroOuNulo(v: unknown, store: string, campo: string): number | null | undefined {
  if (v === undefined || v === null) return v as null | undefined
  return numero(v, store, campo)
}

function inteiro(v: unknown, store: string, campo: string, min = 0): number {
  const n = numero(v, store, campo)
  if (!Number.isInteger(n) || n < min) return falha(store, `${campo}-nao-inteiro`)
  return n
}

function booleano(v: unknown, store: string, campo: string, obrigatorio = true): boolean {
  if (v === undefined || v === null) {
    if (!obrigatorio) return v as unknown as boolean
    return falha(store, `${campo}-ausente`)
  }
  if (typeof v !== 'boolean') return falha(store, `${campo}-nao-booleano`)
  return v
}

function booleanoOuNulo(v: unknown, store: string, campo: string): boolean | null | undefined {
  if (v === undefined || v === null) return v as null | undefined
  return booleano(v, store, campo)
}

function enumeracao<T extends string>(v: unknown, store: string, campo: string, valores: readonly T[], obrigatorio = true): T {
  if (v === undefined || v === null) {
    if (!obrigatorio) return v as unknown as T
    return falha(store, `${campo}-ausente`)
  }
  if (typeof v !== 'string' || !(valores as readonly string[]).includes(v)) {
    return falha(store, `${campo}-invalido`)
  }
  return v as T
}

function arr(v: unknown, store: string, campo: string): unknown[] {
  if (!Array.isArray(v)) return falha(store, `${campo}-nao-lista`)
  return v
}

function obj(v: unknown, store: string, campo: string, permitirNulo = true): Rec | null {
  if (v === undefined) return falha(store, `${campo}-ausente`)
  if (v === null) {
    if (!permitirNulo) return falha(store, `${campo}-nulo`)
    return null
  }
  if (typeof v !== 'object' || Array.isArray(v)) return falha(store, `${campo}-nao-objeto`)
  return v as Rec
}

const SITUACAO_CNAE = ['Permitido', 'Permitido com ressalvas', 'Depende da atividade'] as const
const ESTADO_NBS = ['mapeado', 'sem-mapeamento', 'divergencia'] as const
const FONTE_DESCRICAO = ['oficial', 'qualclasstrib', 'auxiliar'] as const
const FONTE_LINK = ['por_codigo', 'triangulacao'] as const
const DIRECAO_NOTA = ['entrada', 'saida', 'quarentena'] as const
const OPERACAO_AUDIT = ['criar', 'atualizar', 'excluir'] as const
const REGIME_TRIB = ['simples', 'mei', 'normal'] as const
const CONTADOR_TIPO = ['pf', 'pj'] as const
const CONFIANCA_CLASSPROD = ['explicita', 'presenca'] as const
const TIPO_AUX = ['Entrada', 'Saída', 'Outros'] as const
const TIPO_ANEXO = ['NCM', 'NBS'] as const
const PERMISSAO_ANEXO = ['permitido', 'negado'] as const

function validaVinculo(r: Rec, store: string, digitosCodigo: number[]): void {
  texto(r.id, store, 'id', TETO_TEXTO_CURTO)
  digitos(r.codigo, store, 'codigo', digitosCodigo)
  // Stores editáveis na tela Auxiliares: o formulário grava parciais
  // (só chave + alguns campos). O que vier, vem bem-formado; o ausente
  // fica NULL no SQLite (paridade com o `undefined` do Dexie).
  if (r.codigoFormatado !== undefined && r.codigoFormatado !== null) {
    texto(r.codigoFormatado, store, 'codigoFormatado', 50)
  }
  if (r.cst !== undefined && r.cst !== null) digitos(r.cst, store, 'cst', [3])
  if (r.cClassTrib !== undefined && r.cClassTrib !== null) digitos(r.cClassTrib, store, 'cClassTrib', [6])
  if (r.baseLegal !== undefined && r.baseLegal !== null) texto(r.baseLegal, store, 'baseLegal', 2000, false)
  numeroOuNulo(r.reducao, store, 'reducao')
  numeroOuNulo(r.aliquotaIBS, store, 'aliquotaIBS')
  numeroOuNulo(r.aliquotaCBS, store, 'aliquotaCBS')
  if (r.descricao !== undefined && r.descricao !== null) texto(r.descricao, store, 'descricao', TETO_TEXTO, false)
  if (r.documentos !== undefined && r.documentos !== null) texto(r.documentos, store, 'documentos', 500, false)
}

function validaAuxiliar(r: Rec, store: string): void {
  texto(r.codigo, store, 'codigo', 50)
  if (r.descricao !== undefined && r.descricao !== null) texto(r.descricao, store, 'descricao', 2000, false)
  if (r.tipo !== undefined && r.tipo !== null) enumeracao(r.tipo, store, 'tipo', TIPO_AUX)
}

const VALIDADORES: Record<string, (r: Rec) => void> = {
  ncm: (r) => validaVinculo(r, 'ncm', [8]),
  nbs: (r) => validaVinculo(r, 'nbs', [9]),
  cst: (r) => {
    digitos(r.codigo, 'cst', 'codigo', [3])
    if (r.descricao !== undefined && r.descricao !== null) texto(r.descricao, 'cst', 'descricao', 2000, false)
    for (const c of ['indIBSCBS', 'indIBSCBSMono', 'indReducao', 'indDiferimento', 'indTransferenciaCredito']) {
      if (r[c] !== undefined && r[c] !== null) booleano(r[c], 'cst', c)
    }
    if (r.docs !== undefined && r.docs !== null) obj(r.docs, 'cst', 'docs')
  },
  cstClassTrib: (r) => {
    texto(r.id, 'cstClassTrib', 'id', TETO_TEXTO_CURTO)
    digitos(r.cst, 'cstClassTrib', 'cst', [3])
    digitos(r.cClassTrib, 'cstClassTrib', 'cClassTrib', [6])
    texto(r.nome, 'cstClassTrib', 'nome', 2000, false)
    if (r.descricao !== undefined && r.descricao !== null) texto(r.descricao, 'cstClassTrib', 'descricao', TETO_TEXTO, false)
    for (const c of ['lcRedacao', 'lcRef', 'tipoAliquota', 'creditoPara', 'inicioVigencia', 'fimVigencia', 'atualizadoEm']) {
      textoOuNulo(r[c], 'cstClassTrib', c)
    }
    for (const c of ['pRedIBS', 'pRedCBS', 'indRedutorBC', 'indTribRegular', 'indCredPres', 'indMono', 'indMonoReten', 'indMonoRet', 'indMonoDif']) {
      numeroOuNulo(r[c], 'cstClassTrib', c)
    }
  },
  referencia: (r) => {
    texto(r.id, 'referencia', 'id', TETO_TEXTO_CURTO)
    digitos(r.cst, 'referencia', 'cst', [3])
    texto(r.cstDescricao, 'referencia', 'cstDescricao', 2000, false)
    digitos(r.cClassTrib, 'referencia', 'cClassTrib', [6])
    texto(r.descricao, 'referencia', 'descricao', TETO_TEXTO, false)
    numero(r.pRedIBS, 'referencia', 'pRedIBS')
    numero(r.pRedCBS, 'referencia', 'pRedCBS')
    textoOuNulo(r.tipoAliquota, 'referencia', 'tipoAliquota', 200)
    textoOuNulo(r.anexo, 'referencia', 'anexo', 200)
    textoOuNulo(r.urlLegislacao, 'referencia', 'urlLegislacao', 2000)
    for (const c of ['exigeTributacao', 'reducaoBC', 'reducaoAliquota', 'transferenciaCredito', 'diferimento', 'monofasica', 'creditoPresumidoZFM', 'ajusteCompetencia', 'tributacaoRegular', 'creditoPresumido', 'estornoCredito', 'monoNormal', 'monoRetencao', 'monoRetida', 'monoDiferimentoCombustivel']) {
      booleano(r[c], 'referencia', c)
    }
    textoOuNulo(r.simplesReceitaBruta, 'referencia', 'simplesReceitaBruta')
    textoOuNulo(r.regimeContribuicaoSocial, 'referencia', 'regimeContribuicaoSocial')
    textoOuNulo(r.impostoBensServicos, 'referencia', 'impostoBensServicos')
    obj(r.docs, 'referencia', 'docs')
  },
  ncmNomenclatura: (r) => {
    // Nomenclatura oficial tem desdobramentos de 2–8 dígitos (`01012`,
    // `0102291`…): aceita qualquer comprimento nesse intervalo.
    const cod = texto(r.codigo, 'ncmNomenclatura', 'codigo', 50)
    if (!/^\d{2,8}$/.test(cod)) falha('ncmNomenclatura', 'codigo-formato')
    if (r.codigoOriginal !== undefined && r.codigoOriginal !== null) {
      texto(r.codigoOriginal, 'ncmNomenclatura', 'codigoOriginal', 50, false)
    }
    if (r.descricao !== undefined && r.descricao !== null) texto(r.descricao, 'ncmNomenclatura', 'descricao', TETO_TEXTO, false)
    textoOuNulo(r.dataInicio, 'ncmNomenclatura', 'dataInicio', 50)
    textoOuNulo(r.dataFim, 'ncmNomenclatura', 'dataFim', 50)
    textoOuNulo(r.ato, 'ncmNomenclatura', 'ato', 500)
    if (r.atoFim !== undefined) textoOuNulo(r.atoFim, 'ncmNomenclatura', 'atoFim', 500)
  },
  empresas: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'empresas', 'id')
    texto(r.razaoSocial, 'empresas', 'razaoSocial', 500)
    digitos(r.cnpj, 'empresas', 'cnpj', [14], true)
    texto(r.fantasia, 'empresas', 'fantasia', 500, false)
    texto(r.criadoEm, 'empresas', 'criadoEm', 100)
    for (const c of ['ie', 'im', 'endereco', 'cidade', 'uf', 'cep', 'telefone', 'email']) {
      if (r[c] !== undefined) textoOuNulo(r[c], 'empresas', c, 500)
    }
    if (r.regimeTributario !== undefined && r.regimeTributario !== null) {
      enumeracao(r.regimeTributario, 'empresas', 'regimeTributario', REGIME_TRIB)
    }
    if (r.contadorTipo !== undefined && r.contadorTipo !== null && r.contadorTipo !== '') {
      enumeracao(r.contadorTipo, 'empresas', 'contadorTipo', CONTADOR_TIPO)
    }
    for (const c of ['contadorNome', 'contadorDoc', 'contadorCrc', 'contadorEmail', 'contadorTelefone']) {
      if (r[c] !== undefined) textoOuNulo(r[c], 'empresas', c, 500)
    }
    if (typeof r.contadorDoc === 'string' && r.contadorDoc.trim()) {
      const d = r.contadorDoc.replace(/\D/g, '')
      if (d.length !== 11 && d.length !== 14) falha('empresas', 'contadorDoc-formato')
    }
  },
  produtos: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'produtos', 'id')
    if (r.empresaId !== undefined && r.empresaId !== null) inteiro(r.empresaId, 'produtos', 'empresaId')
    texto(r.codigo, 'produtos', 'codigo', 200)
    texto(r.nome, 'produtos', 'nome', 1000, false)
    digitos(r.ncm, 'produtos', 'ncm', [0, 2, 4, 6, 8, 9, 10], true)
    texto(r.cfop, 'produtos', 'cfop', 20, false)
    texto(r.cstIcms, 'produtos', 'cstIcms', 20, false)
    texto(r.pis, 'produtos', 'pis', 20, false)
    texto(r.cofins, 'produtos', 'cofins', 20, false)
    // Tributação anterior por fluxo (entrada × saída): opcionais, mas quando
    // presentes devem ser texto curto (a existência na tabela auxiliar é
    // checada na camada de aplicação, com aviso — nunca bloqueio de base).
    for (const c of ['cfopEntrada', 'cfopSaida', 'cstIcmsEntrada', 'cstIcmsSaida', 'pisEntrada', 'pisSaida', 'cofinsEntrada', 'cofinsSaida'] as const) {
      if (r[c] !== undefined && r[c] !== null) texto(r[c], 'produtos', c, 20, false)
    }
    numero(r.quantidade, 'produtos', 'quantidade')
    numero(r.valorUnitario, 'produtos', 'valorUnitario')
    digitos(r.cstReforma, 'produtos', 'cstReforma', [3])
    digitos(r.cClassTrib, 'produtos', 'cClassTrib', [6])
    booleano(r.regraGeral, 'produtos', 'regraGeral')
    if (r.classificacaoManual !== undefined) booleanoOuNulo(r.classificacaoManual, 'produtos', 'classificacaoManual')
    obj(r.classificacaoSnapshot, 'produtos', 'classificacaoSnapshot')
    if (r.baseLegal !== undefined) textoOuNulo(r.baseLegal, 'produtos', 'baseLegal', 2000)
    texto(r.criadoEm, 'produtos', 'criadoEm', 100)
    texto(r.atualizadoEm, 'produtos', 'atualizadoEm', 100)
  },
  meta: (r) => {
    texto(r.chave, 'meta', 'chave', 200)
    if (r.total !== undefined && r.total !== null) inteiro(r.total, 'meta', 'total')
    for (const c of ['data', 'arquivo', 'quando', 'atualizadoEm']) {
      if (r[c] !== undefined) textoOuNulo(r[c], 'meta', c, 500)
    }
  },
  cfop: (r) => validaAuxiliar(r, 'cfop'),
  cstIcms: (r) => validaAuxiliar(r, 'cstIcms'),
  cstPisCofins: (r) => validaAuxiliar(r, 'cstPisCofins'),
  nfeNotas: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'nfeNotas', 'id')
    inteiro(r.empresaId, 'nfeNotas', 'empresaId')
    digitos(r.chave, 'nfeNotas', 'chave', [44])
    texto(r.numero, 'nfeNotas', 'numero', 50, false)
    texto(r.serie, 'nfeNotas', 'serie', 50, false)
    texto(r.modelo, 'nfeNotas', 'modelo', 20, false)
    texto(r.natOp, 'nfeNotas', 'natOp', 500, false)
    texto(r.dataEmissao, 'nfeNotas', 'dataEmissao', 50)
    digitos(r.emitCnpj, 'nfeNotas', 'emitCnpj', [14], true)
    texto(r.emitNome, 'nfeNotas', 'emitNome', 500, false)
    enumeracao(r.direcao, 'nfeNotas', 'direcao', DIRECAO_NOTA)
    if (typeof r.destDoc === 'string' && r.destDoc !== '') {
      if (!/^\d{11}$/.test(r.destDoc) && !/^\d{14}$/.test(r.destDoc)) {
        falha('nfeNotas', 'destDoc-formato')
      }
    }
    // Fixtures/testes gravam notas só com `itensAnalisados`; nada no app lê
    // `itens` cru (só `itensAnalisados ?? []`). Ausentes viram NULL.
    if (r.itens !== undefined && r.itens !== null) arr(r.itens, 'nfeNotas', 'itens')
    if (r.itensAnalisados !== undefined && r.itensAnalisados !== null) {
      arr(r.itensAnalisados, 'nfeNotas', 'itensAnalisados')
    }
    for (const c of ['valorProdutos', 'valorTotal', 'refIBS', 'refCBS', 'totalIBS', 'totalCBS', 'totalTributos']) {
      numero(r[c], 'nfeNotas', c)
    }
    for (const c of ['totalIbsXml', 'totalCbsXml', 'totalCreditoIbsCbsXml']) {
      if (r[c] !== undefined) numeroOuNulo(r[c], 'nfeNotas', c)
    }
    texto(r.importadoEm, 'nfeNotas', 'importadoEm', 100)
    if (r.arquivo !== undefined) textoOuNulo(r.arquivo, 'nfeNotas', 'arquivo', 500)
    if (r.xmlConteudo !== undefined && r.xmlConteudo !== null && typeof r.xmlConteudo !== 'string') {
      falha('nfeNotas', 'xmlConteudo-nao-texto')
    }
  },
  reclassificacoesManuais: (r) => {
    digitos(r.ncm, 'reclassificacoesManuais', 'ncm', [8])
    digitos(r.cst, 'reclassificacoesManuais', 'cst', [3])
    digitos(r.cClassTrib, 'reclassificacoesManuais', 'cClassTrib', [6])
    texto(r.descricao, 'reclassificacoesManuais', 'descricao', TETO_TEXTO, false)
    texto(r.fonteDescricao, 'reclassificacoesManuais', 'fonteDescricao', 2000, false)
    texto(r.fonteUrl, 'reclassificacoesManuais', 'fonteUrl', 2000, false)
    texto(r.criadoEm, 'reclassificacoesManuais', 'criadoEm', 100)
    texto(r.atualizadoEm, 'reclassificacoesManuais', 'atualizadoEm', 100)
  },
  classificacaoProduto: (r) => {
    texto(r.id, 'classificacaoProduto', 'id', TETO_TEXTO_CURTO)
    texto(r.sistema, 'classificacaoProduto', 'sistema', 50)
    digitos(r.cClassTrib, 'classificacaoProduto', 'cClassTrib', [6])
    textoOuNulo(r.descricao, 'classificacaoProduto', 'descricao')
    booleanoOuNulo(r.permitido, 'classificacaoProduto', 'permitido')
    enumeracao(r.confianca, 'classificacaoProduto', 'confianca', CONFIANCA_CLASSPROD)
    obj(r.flags, 'classificacaoProduto', 'flags')
    textoOuNulo(r.inicioVigencia, 'classificacaoProduto', 'inicioVigencia', 50)
    textoOuNulo(r.fimVigencia, 'classificacaoProduto', 'fimVigencia', 50)
    texto(r.sincronizadoEm, 'classificacaoProduto', 'sincronizadoEm', 100)
  },
  anexos: (r) => {
    texto(r.id, 'anexos', 'id', TETO_TEXTO_CURTO)
    if (r.codigo !== undefined && r.codigo !== null) digitos(r.codigo, 'anexos', 'codigo', [8, 9])
    if (r.tipo !== undefined && r.tipo !== null) enumeracao(r.tipo, 'anexos', 'tipo', TIPO_ANEXO)
    if (r.permissao !== undefined && r.permissao !== null) enumeracao(r.permissao, 'anexos', 'permissao', PERMISSAO_ANEXO)
    inteiro(r.nroAnexo, 'anexos', 'nroAnexo')
    numeroOuNulo(r.nroItemAnexoLei, 'anexos', 'nroItemAnexoLei')
    texto(r.descrAnexo, 'anexos', 'descrAnexo', TETO_TEXTO, false)
    for (const c of ['descrItemAnexo', 'descrCondicao', 'descrExcecao', 'observacao', 'inicioVigencia', 'fimVigencia']) {
      textoOuNulo(r[c], 'anexos', c)
    }
  },
  produtosDfe: (r) => {
    texto(r.id, 'produtosDfe', 'id', TETO_TEXTO_CURTO)
    texto(r.sistema, 'produtosDfe', 'sistema', 50)
    digitos(r.codClassProd, 'produtosDfe', 'codClassProd', [7])
    textoOuNulo(r.codGrupo, 'produtosDfe', 'codGrupo', 50)
    textoOuNulo(r.descrGrupo, 'produtosDfe', 'descrGrupo', 2000)
    texto(r.descricao, 'produtosDfe', 'descricao', TETO_TEXTO, false)
    textoOuNulo(r.tipoPrestacao, 'produtosDfe', 'tipoPrestacao', 500)
    obj(r.flags, 'produtosDfe', 'flags')
    texto(r.sincronizadoEm, 'produtosDfe', 'sincronizadoEm', 100)
  },
  audit_log: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'audit_log', 'id')
    texto(r.quando, 'audit_log', 'quando', 100)
    texto(r.tabela, 'audit_log', 'tabela', 200)
    texto(r.chave, 'audit_log', 'chave', 500)
    enumeracao(r.operacao, 'audit_log', 'operacao', OPERACAO_AUDIT)
    texto(r.autor, 'audit_log', 'autor', 200)
    if (r.antes !== undefined && r.antes !== null && (typeof r.antes !== 'object' || Array.isArray(r.antes))) {
      falha('audit_log', 'antes-nao-objeto')
    }
    if (r.depois !== undefined && r.depois !== null && (typeof r.depois !== 'object' || Array.isArray(r.depois))) {
      falha('audit_log', 'depois-nao-objeto')
    }
  },
  cest: (r) => {
    digitos(r.codigo, 'cest', 'codigo', [7])
    if (r.descricao !== undefined && r.descricao !== null) texto(r.descricao, 'cest', 'descricao', 2000, false)
    if (r.ncm !== undefined) textoOuNulo(r.ncm, 'cest', 'ncm', 50)
  },
  ia_feedback: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'ia_feedback', 'id')
    texto(r.quando, 'ia_feedback', 'quando', 100)
    texto(r.descricao, 'ia_feedback', 'descricao', TETO_TEXTO, false)
    texto(r.via, 'ia_feedback', 'via', 100)
    textoOuNulo(r.decisao, 'ia_feedback', 'decisao', 500)
    numero(r.confianca, 'ia_feedback', 'confianca')
    textoOuNulo(r.motivo, 'ia_feedback', 'motivo', 2000)
    if (r.mock !== undefined) booleanoOuNulo(r.mock, 'ia_feedback', 'mock')
  },
  cnae: (r) => {
    digitos(r.codigo7, 'cnae', 'codigo7', [7])
    texto(r.codigoFormatado, 'cnae', 'codigoFormatado', 50)
    texto(r.descricao, 'cnae', 'descricao', 2000, false)
    enumeracao(r.situacao, 'cnae', 'situacao', SITUACAO_CNAE)
    const anexosLista = arr(r.anexos, 'cnae', 'anexos')
    for (const a of anexosLista) {
      // A origem traz `"III / V"` fatiado e `"III,IV,V"` agrupado — o
      // normalizador preserva o agrupado (paridade Dexie). Valida o
      // alfabeto (romanos + separadores), não a forma fatiada.
      if (typeof a !== 'string' || !/^[IVX,\s/.|-]+$/.test(a) || !/[IVX]/.test(a)) {
        falha('cnae', 'anexo-invalido')
      }
    }
    booleano(r.fatorR, 'cnae', 'fatorR')
  },
  consultasCnpj: (r) => {
    digitos(r.cnpj, 'consultasCnpj', 'cnpj', [14])
    texto(r.razaoSocial, 'consultasCnpj', 'razaoSocial', 500, false)
    texto(r.fantasia, 'consultasCnpj', 'fantasia', 500, false)
    textoOuNulo(r.porte, 'consultasCnpj', 'porte', 200)
    textoOuNulo(r.situacao, 'consultasCnpj', 'situacao', 200)
    booleanoOuNulo(r.opcaoSimples, 'consultasCnpj', 'opcaoSimples')
    textoOuNulo(r.cnaePrincipal, 'consultasCnpj', 'cnaePrincipal', 50)
    arr(r.cnaesSecundarios, 'consultasCnpj', 'cnaesSecundarios')
    texto(r.quando, 'consultasCnpj', 'quando', 100)
  },
  conversasEmitente: (r) => {
    texto(r.conversaId, 'conversasEmitente', 'conversaId', 200)
    texto(r.emitenteId, 'conversasEmitente', 'emitenteId', 200)
    if (r.empresaAtivaId !== undefined && r.empresaAtivaId !== null) {
      inteiro(r.empresaAtivaId, 'conversasEmitente', 'empresaAtivaId')
    }
    texto(r.titulo, 'conversasEmitente', 'titulo', 500, false)
    const mensagens = arr(r.mensagens, 'conversasEmitente', 'mensagens')
    for (const m of mensagens) {
      if (!m || typeof m !== 'object') falha('conversasEmitente', 'mensagem-invalida')
      const mm = m as Rec
      enumeracao(mm.papel, 'conversasEmitente', 'mensagem.papel', ['user', 'assistant'] as const)
      texto(mm.texto, 'conversasEmitente', 'mensagem.texto', TETO_TEXTO, false)
      texto(mm.quando, 'conversasEmitente', 'mensagem.quando', 100)
    }
    texto(r.updatedAt, 'conversasEmitente', 'updatedAt', 100)
    texto(r.createdAt, 'conversasEmitente', 'createdAt', 100)
  },
  cnaeNbs: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'cnaeNbs', 'id')
    digitos(r.cnae7, 'cnaeNbs', 'cnae7', [7])
    texto(r.cnae, 'cnaeNbs', 'cnae', 50)
    digitos(r.nbs, 'cnaeNbs', 'nbs', [9])
    enumeracao(r.fonte, 'cnaeNbs', 'fonte', FONTE_LINK)
  },
  lcNbs: (r) => {
    if (r.id !== undefined) inteiro(r.id, 'lcNbs', 'id')
    // A ponte traz linhas incompletas (sem lc, sem NBS ou sem cct):
    // guardam-se como estão — nunca participam de join, só de auditoria.
    texto(r.lc, 'lcNbs', 'lc', 50, false)
    if (r.nbs !== '') digitos(r.nbs, 'lcNbs', 'nbs', [9])
    if (r.cct !== '') digitos(r.cct, 'lcNbs', 'cct', [6])
    texto(r.descricaoLc, 'lcNbs', 'descricaoLc', TETO_TEXTO, false)
    texto(r.descricaoNbs, 'lcNbs', 'descricaoNbs', TETO_TEXTO, false)
    texto(r.descricaoCct, 'lcNbs', 'descricaoCct', TETO_TEXTO, false)
    for (const c of ['onerosa', 'exterior', 'indop', 'local']) {
      texto(r[c], 'lcNbs', c, 500, false)
    }
  },
  classificacoesConsolidadas: (r) => {
    digitos(r.cnae7, 'classificacoesConsolidadas', 'cnae7', [7])
    texto(r.codigoFormatado, 'classificacoesConsolidadas', 'codigoFormatado', 50)
    texto(r.descricao, 'classificacoesConsolidadas', 'descricao', 2000, false)
    enumeracao(r.fonteDescricao, 'classificacoesConsolidadas', 'fonteDescricao', FONTE_DESCRICAO)
    arr(r.anexoSimples, 'classificacoesConsolidadas', 'anexoSimples')
    enumeracao(r.situacao, 'classificacoesConsolidadas', 'situacao', SITUACAO_CNAE)
    booleano(r.fatorR, 'classificacoesConsolidadas', 'fatorR')
    arr(r.vedacoes, 'classificacoesConsolidadas', 'vedacoes')
    arr(r.nbsVinculadas, 'classificacoesConsolidadas', 'nbsVinculadas')
    arr(r.beneficiosReforma, 'classificacoesConsolidadas', 'beneficiosReforma')
    if (r.divergencia !== undefined && r.divergencia !== null) {
      obj(r.divergencia, 'classificacoesConsolidadas', 'divergencia')
    }
    enumeracao(r.estadoNbs, 'classificacoesConsolidadas', 'estadoNbs', ESTADO_NBS)
  },
  grafometa: (r) => {
    texto(r.id, 'grafometa', 'id', 100)
    texto(r.hash, 'grafometa', 'hash', 200)
    texto(r.versao, 'grafometa', 'versao', 100)
    inteiro(r.nodos, 'grafometa', 'nodos')
    inteiro(r.arestas, 'grafometa', 'arestas')
    texto(r.geradoEm, 'grafometa', 'geradoEm', 100)
  },
}

/** Nomes de store aceitos em qualquer operação (allowlist do IPC). */
export const STORES_SQLITE = Object.keys(VALIDADORES)

/**
 * Valida um registro antes de gravar. Lança `Error('validacao:<store>:<motivo>')`
 * quando inválido. Fail-closed: store desconhecida ou registro não-objeto
 * também lançam.
 */
export function validarRegistro(store: string, registro: unknown): void {
  const fn = VALIDADORES[store]
  if (!fn) falha(store, 'store-desconhecida')
  if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
    falha(store, 'registro-invalido')
  }
  fn(registro as Rec)
}

/**
 * Valida uma chave de busca/exclusão (get/delete/update). Aceita string
 * não-vazia ou número inteiro ≥ 0. Chave composta (`[a+b]`) é validada
 * elemento a elemento pelo chamador via `validarChaveComposta`.
 */
export function validarChave(store: string, chave: unknown): void {
  if (typeof chave === 'string') {
    if (!chave) falha(store, 'chave-vazia')
    if (chave.length > 500) falha(store, 'chave-longa')
    return
  }
  if (typeof chave === 'number') {
    if (!Number.isInteger(chave) || chave < 0) falha(store, 'chave-numerica-invalida')
    return
  }
  falha(store, 'chave-invalida')
}
