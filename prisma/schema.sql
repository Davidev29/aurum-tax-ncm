-- CreateTable
CREATE TABLE "VinculoNcm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "codigoFormatado" TEXT,
    "cst" TEXT,
    "cClassTrib" TEXT,
    "baseLegal" TEXT,
    "reducao" REAL,
    "aliquotaIBS" REAL,
    "aliquotaCBS" REAL,
    "descricao" TEXT,
    "documentos" TEXT
);

-- CreateTable
CREATE TABLE "VinculoNbs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "cst" TEXT,
    "cClassTrib" TEXT,
    "baseLegal" TEXT,
    "reducao" REAL,
    "aliquotaIBS" REAL,
    "aliquotaCBS" REAL,
    "descricao" TEXT,
    "documentos" TEXT
);

-- CreateTable
CREATE TABLE "TabelaCst" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "descricao" TEXT,
    "indIBSCBS" BOOLEAN NOT NULL DEFAULT false,
    "indIBSCBSMono" BOOLEAN NOT NULL DEFAULT false,
    "indReducao" BOOLEAN NOT NULL DEFAULT false,
    "indDiferimento" BOOLEAN NOT NULL DEFAULT false,
    "indTransferenciaCredito" BOOLEAN NOT NULL DEFAULT false,
    "docs" JSONB
);

-- CreateTable
CREATE TABLE "TabelaCstClassTrib" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cst" TEXT NOT NULL,
    "cClassTrib" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "lcRedacao" TEXT,
    "lcRef" TEXT,
    "tipoAliquota" TEXT,
    "pRedIBS" REAL,
    "pRedCBS" REAL,
    "indRedutorBC" REAL,
    "indTribRegular" REAL,
    "indCredPres" REAL,
    "indMono" REAL,
    "indMonoReten" REAL,
    "indMonoRet" REAL,
    "indMonoDif" REAL,
    "creditoPara" TEXT,
    "inicioVigencia" TEXT,
    "fimVigencia" TEXT,
    "atualizadoEm" TEXT
);

-- CreateTable
CREATE TABLE "ReferenciaCClassTrib" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cst" TEXT NOT NULL,
    "cstDescricao" TEXT NOT NULL,
    "cClassTrib" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "pRedIBS" REAL NOT NULL,
    "pRedCBS" REAL NOT NULL,
    "tipoAliquota" TEXT,
    "anexo" TEXT,
    "urlLegislacao" TEXT,
    "exigeTributacao" BOOLEAN NOT NULL,
    "reducaoBC" BOOLEAN NOT NULL,
    "reducaoAliquota" BOOLEAN NOT NULL,
    "transferenciaCredito" BOOLEAN NOT NULL,
    "diferimento" BOOLEAN NOT NULL,
    "monofasica" BOOLEAN NOT NULL,
    "creditoPresumidoZFM" BOOLEAN NOT NULL,
    "ajusteCompetencia" BOOLEAN NOT NULL,
    "tributacaoRegular" BOOLEAN NOT NULL,
    "creditoPresumido" BOOLEAN NOT NULL,
    "estornoCredito" BOOLEAN NOT NULL,
    "monoNormal" BOOLEAN NOT NULL,
    "monoRetencao" BOOLEAN NOT NULL,
    "monoRetida" BOOLEAN NOT NULL,
    "monoDiferimentoCombustivel" BOOLEAN NOT NULL,
    "simplesReceitaBruta" TEXT,
    "regimeContribuicaoSocial" TEXT,
    "impostoBensServicos" TEXT,
    "docs" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "NomenclaturaNcm" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "codigoOriginal" TEXT,
    "descricao" TEXT,
    "dataInicio" TEXT,
    "dataFim" TEXT,
    "ato" TEXT,
    "atoFim" TEXT
);

-- CreateTable
CREATE TABLE "Empresa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "fantasia" TEXT NOT NULL,
    "criadoEm" TEXT NOT NULL,
    "ie" TEXT,
    "im" TEXT,
    "regimeTributario" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "cep" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "contadorTipo" TEXT,
    "contadorNome" TEXT,
    "contadorDoc" TEXT,
    "contadorCrc" TEXT,
    "contadorEmail" TEXT,
    "contadorTelefone" TEXT
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ncm" TEXT NOT NULL,
    "cfop" TEXT NOT NULL,
    "cstIcms" TEXT NOT NULL,
    "pis" TEXT NOT NULL,
    "cofins" TEXT NOT NULL,
    "cfopEntrada" TEXT,
    "cfopSaida" TEXT,
    "cstIcmsEntrada" TEXT,
    "cstIcmsSaida" TEXT,
    "pisEntrada" TEXT,
    "pisSaida" TEXT,
    "cofinsEntrada" TEXT,
    "cofinsSaida" TEXT,
    "quantidade" REAL NOT NULL,
    "valorUnitario" REAL NOT NULL,
    "cstReforma" TEXT NOT NULL,
    "cClassTrib" TEXT NOT NULL,
    "regraGeral" BOOLEAN NOT NULL,
    "classificacaoManual" BOOLEAN,
    "classificacaoSnapshot" JSONB NOT NULL,
    "baseLegal" TEXT,
    "criadoEm" TEXT NOT NULL,
    "atualizadoEm" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Meta" (
    "chave" TEXT NOT NULL PRIMARY KEY,
    "valor" JSONB,
    "data" TEXT,
    "arquivo" TEXT,
    "total" INTEGER,
    "quando" TEXT,
    "atualizadoEm" TEXT
);

-- CreateTable
CREATE TABLE "Cfop" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "descricao" TEXT,
    "tipo" TEXT
);

-- CreateTable
CREATE TABLE "CstIcms" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "descricao" TEXT,
    "tipo" TEXT
);

-- CreateTable
CREATE TABLE "CstPisCofins" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "descricao" TEXT,
    "tipo" TEXT
);

-- CreateTable
CREATE TABLE "NfeNota" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empresaId" INTEGER NOT NULL,
    "chave" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "natOp" TEXT NOT NULL,
    "dataEmissao" TEXT NOT NULL,
    "emitCnpj" TEXT NOT NULL,
    "emitNome" TEXT NOT NULL,
    "emitCrt" TEXT NOT NULL,
    "emitIe" TEXT NOT NULL,
    "emitIm" TEXT NOT NULL,
    "emitEndereco" TEXT NOT NULL,
    "emitCidade" TEXT NOT NULL,
    "emitUf" TEXT NOT NULL,
    "destDoc" TEXT NOT NULL,
    "destNome" TEXT NOT NULL,
    "destIe" TEXT NOT NULL,
    "valorProdutos" REAL NOT NULL,
    "valorTotal" REAL NOT NULL,
    "totalIbsXml" REAL,
    "totalCbsXml" REAL,
    "totalCreditoIbsCbsXml" REAL,
    "arquivo" TEXT,
    "xmlConteudo" TEXT,
    "refIBS" REAL NOT NULL,
    "refCBS" REAL NOT NULL,
    "totalIBS" REAL NOT NULL,
    "totalCBS" REAL NOT NULL,
    "totalTributos" REAL NOT NULL,
    "importadoEm" TEXT NOT NULL,
    "itens" JSONB,
    "itensAnalisados" JSONB,
    "direcao" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ReclassificacaoManual" (
    "ncm" TEXT NOT NULL PRIMARY KEY,
    "cst" TEXT NOT NULL,
    "cClassTrib" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "fonteDescricao" TEXT NOT NULL,
    "fonteUrl" TEXT NOT NULL,
    "criadoEm" TEXT NOT NULL,
    "atualizadoEm" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ClassificacaoProdutoSistema" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sistema" TEXT NOT NULL,
    "cClassTrib" TEXT NOT NULL,
    "descricao" TEXT,
    "permitido" BOOLEAN,
    "confianca" TEXT NOT NULL,
    "flags" JSONB NOT NULL,
    "inicioVigencia" TEXT,
    "fimVigencia" TEXT,
    "sincronizadoEm" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AnexoNcm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT,
    "tipo" TEXT,
    "permissao" TEXT,
    "nroAnexo" INTEGER NOT NULL,
    "nroItemAnexoLei" INTEGER,
    "descrAnexo" TEXT NOT NULL,
    "descrItemAnexo" TEXT,
    "descrCondicao" TEXT,
    "descrExcecao" TEXT,
    "observacao" TEXT,
    "inicioVigencia" TEXT,
    "fimVigencia" TEXT
);

-- CreateTable
CREATE TABLE "ProdutoDfe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sistema" TEXT NOT NULL,
    "codClassProd" TEXT NOT NULL,
    "codGrupo" TEXT,
    "descrGrupo" TEXT,
    "descricao" TEXT NOT NULL,
    "tipoPrestacao" TEXT,
    "flags" JSONB NOT NULL,
    "sincronizadoEm" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quando" TEXT NOT NULL,
    "tabela" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB
);

-- CreateTable
CREATE TABLE "TabelaCest" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "descricao" TEXT,
    "ncm" TEXT
);

-- CreateTable
CREATE TABLE "IaFeedback" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quando" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "decisao" TEXT,
    "confianca" REAL NOT NULL,
    "motivo" TEXT,
    "mock" BOOLEAN
);

-- CreateTable
CREATE TABLE "CnaeAnexo" (
    "codigo7" TEXT NOT NULL PRIMARY KEY,
    "codigoFormatado" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "anexos" JSONB NOT NULL,
    "fatorR" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "ConsultaCnpj" (
    "cnpj" TEXT NOT NULL PRIMARY KEY,
    "razaoSocial" TEXT NOT NULL,
    "fantasia" TEXT NOT NULL,
    "porte" TEXT,
    "situacao" TEXT,
    "opcaoSimples" BOOLEAN,
    "cnaePrincipal" TEXT,
    "cnaesSecundarios" JSONB NOT NULL,
    "quando" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ConversaEmitente" (
    "conversaId" TEXT NOT NULL PRIMARY KEY,
    "emitenteId" TEXT NOT NULL,
    "empresaAtivaId" INTEGER,
    "titulo" TEXT NOT NULL,
    "mensagens" JSONB NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "CnaeNbsLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cnae7" TEXT NOT NULL,
    "cnae" TEXT NOT NULL,
    "nbs" TEXT NOT NULL,
    "fonte" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "LcNbsRelation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lc" TEXT NOT NULL,
    "nbs" TEXT NOT NULL,
    "cct" TEXT NOT NULL,
    "descricaoLc" TEXT NOT NULL,
    "descricaoNbs" TEXT NOT NULL,
    "descricaoCct" TEXT NOT NULL,
    "onerosa" TEXT NOT NULL,
    "exterior" TEXT NOT NULL,
    "indop" TEXT NOT NULL,
    "local" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ClassificacaoConsolidada" (
    "cnae7" TEXT NOT NULL PRIMARY KEY,
    "codigoFormatado" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "fonteDescricao" TEXT NOT NULL,
    "anexoSimples" JSONB NOT NULL,
    "situacao" TEXT NOT NULL,
    "fatorR" BOOLEAN NOT NULL,
    "vedacoes" JSONB NOT NULL,
    "nbsVinculadas" JSONB NOT NULL,
    "beneficiosReforma" JSONB NOT NULL,
    "divergencia" JSONB,
    "estadoNbs" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "GrafoMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "versao" TEXT NOT NULL,
    "nodos" INTEGER NOT NULL,
    "arestas" INTEGER NOT NULL,
    "geradoEm" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "VinculoNcm_codigo_idx" ON "VinculoNcm"("codigo");

-- CreateIndex
CREATE INDEX "VinculoNcm_cst_idx" ON "VinculoNcm"("cst");

-- CreateIndex
CREATE INDEX "VinculoNcm_cClassTrib_idx" ON "VinculoNcm"("cClassTrib");

-- CreateIndex
CREATE INDEX "VinculoNbs_codigo_idx" ON "VinculoNbs"("codigo");

-- CreateIndex
CREATE INDEX "VinculoNbs_cClassTrib_idx" ON "VinculoNbs"("cClassTrib");

-- CreateIndex
CREATE INDEX "TabelaCstClassTrib_cst_idx" ON "TabelaCstClassTrib"("cst");

-- CreateIndex
CREATE INDEX "TabelaCstClassTrib_cClassTrib_idx" ON "TabelaCstClassTrib"("cClassTrib");

-- CreateIndex
CREATE INDEX "ReferenciaCClassTrib_cst_idx" ON "ReferenciaCClassTrib"("cst");

-- CreateIndex
CREATE INDEX "ReferenciaCClassTrib_cClassTrib_idx" ON "ReferenciaCClassTrib"("cClassTrib");

-- CreateIndex
CREATE INDEX "Empresa_cnpj_idx" ON "Empresa"("cnpj");

-- CreateIndex
CREATE INDEX "Empresa_razaoSocial_idx" ON "Empresa"("razaoSocial");

-- CreateIndex
CREATE INDEX "Produto_empresaId_idx" ON "Produto"("empresaId");

-- CreateIndex
CREATE INDEX "Produto_ncm_idx" ON "Produto"("ncm");

-- CreateIndex
CREATE INDEX "NfeNota_empresaId_idx" ON "NfeNota"("empresaId");

-- CreateIndex
CREATE INDEX "NfeNota_dataEmissao_idx" ON "NfeNota"("dataEmissao");

-- CreateIndex
CREATE INDEX "NfeNota_emitCnpj_idx" ON "NfeNota"("emitCnpj");

-- CreateIndex
CREATE INDEX "NfeNota_chave_idx" ON "NfeNota"("chave");

-- CreateIndex
CREATE INDEX "NfeNota_direcao_idx" ON "NfeNota"("direcao");

-- CreateIndex
CREATE UNIQUE INDEX "NfeNota_empresaId_chave_key" ON "NfeNota"("empresaId", "chave");

-- CreateIndex
CREATE INDEX "ClassificacaoProdutoSistema_sistema_idx" ON "ClassificacaoProdutoSistema"("sistema");

-- CreateIndex
CREATE INDEX "ClassificacaoProdutoSistema_cClassTrib_idx" ON "ClassificacaoProdutoSistema"("cClassTrib");

-- CreateIndex
CREATE INDEX "AnexoNcm_codigo_idx" ON "AnexoNcm"("codigo");

-- CreateIndex
CREATE INDEX "AnexoNcm_nroAnexo_idx" ON "AnexoNcm"("nroAnexo");

-- CreateIndex
CREATE INDEX "ProdutoDfe_sistema_idx" ON "ProdutoDfe"("sistema");

-- CreateIndex
CREATE INDEX "ProdutoDfe_codClassProd_idx" ON "ProdutoDfe"("codClassProd");

-- CreateIndex
CREATE INDEX "AuditLog_quando_idx" ON "AuditLog"("quando");

-- CreateIndex
CREATE INDEX "AuditLog_tabela_idx" ON "AuditLog"("tabela");

-- CreateIndex
CREATE INDEX "TabelaCest_ncm_idx" ON "TabelaCest"("ncm");

-- CreateIndex
CREATE INDEX "IaFeedback_quando_idx" ON "IaFeedback"("quando");

-- CreateIndex
CREATE INDEX "CnaeAnexo_descricao_idx" ON "CnaeAnexo"("descricao");

-- CreateIndex
CREATE INDEX "ConversaEmitente_emitenteId_idx" ON "ConversaEmitente"("emitenteId");

-- CreateIndex
CREATE INDEX "ConversaEmitente_updatedAt_idx" ON "ConversaEmitente"("updatedAt");

-- CreateIndex
CREATE INDEX "CnaeNbsLink_cnae7_idx" ON "CnaeNbsLink"("cnae7");

-- CreateIndex
CREATE INDEX "CnaeNbsLink_nbs_idx" ON "CnaeNbsLink"("nbs");

-- CreateIndex
CREATE UNIQUE INDEX "CnaeNbsLink_cnae7_nbs_key" ON "CnaeNbsLink"("cnae7", "nbs");

-- CreateIndex
CREATE INDEX "LcNbsRelation_lc_idx" ON "LcNbsRelation"("lc");

-- CreateIndex
CREATE INDEX "LcNbsRelation_nbs_idx" ON "LcNbsRelation"("nbs");

-- CreateIndex
CREATE INDEX "GrafoMeta_hash_idx" ON "GrafoMeta"("hash");

