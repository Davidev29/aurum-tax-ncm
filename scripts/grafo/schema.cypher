// Phase 10-00 — Schema fiscal do grafo (LadybugDB Cypher + espelho KGLite).
// LadybugDB exige schema pré-definido: node tables com PRIMARY KEY + rel tables FROM->TO.
// Proveniência vai em props da relação: origem (por_codigo|triangulado|heranca|curadoria), confianca, anoReferencia.

// --- Nós ---
CREATE NODE TABLE NCM(codigo STRING PRIMARY KEY, descricao STRING, vigente BOOLEAN, capitulo STRING);
CREATE NODE TABLE SH6(codigo STRING PRIMARY KEY, descricao STRING);
CREATE NODE TABLE SH4(codigo STRING PRIMARY KEY, descricao STRING);
CREATE NODE TABLE Capitulo(codigo STRING PRIMARY KEY, descricao STRING);
CREATE NODE TABLE Secao(codigo STRING PRIMARY KEY, descricao STRING);
CREATE NODE TABLE CCT(codigo STRING PRIMARY KEY, descricao STRING, redIBS DOUBLE, redCBS DOUBLE);
CREATE NODE TABLE Anexo(nome STRING PRIMARY KEY, rotulo STRING);
CREATE NODE TABLE ArtigoLC214(numero STRING PRIMARY KEY, titulo STRING);
CREATE NODE TABLE CNAE(codigo STRING PRIMARY KEY, descricao STRING, anexoSimples STRING);
CREATE NODE TABLE NBS(codigo STRING PRIMARY KEY, descricao STRING);
CREATE NODE TABLE Termo(termo STRING PRIMARY KEY);

// --- Relações (com proveniência) ---
CREATE REL TABLE PERTENCE_A(FROM NCM TO SH6, origem STRING, confianca DOUBLE);
CREATE REL TABLE SH6_EM(FROM SH6 TO SH4);
CREATE REL TABLE SH4_EM(FROM SH4 TO Capitulo);
CREATE REL TABLE CAP_EM(FROM Capitulo TO Secao);
CREATE REL TABLE TEM_CLASSIFICACAO(FROM NCM TO CCT, origem STRING, confianca DOUBLE, anoReferencia INT64);
CREATE REL TABLE TEM_CLASSIFICACAO_NBS(FROM NBS TO CCT, origem STRING, confianca DOUBLE, anoReferencia INT64);
CREATE REL TABLE REDUZ_PARA(FROM CCT TO Anexo, redIBS DOUBLE, redCBS DOUBLE);
CREATE REL TABLE FUNDAMENTA_EM(FROM Anexo TO ArtigoLC214);
CREATE REL TABLE MAPEIA(FROM CNAE TO NBS, origem STRING, confianca DOUBLE);
CREATE REL TABLE SINONIMO_DE(FROM Termo TO NCM, peso DOUBLE);
CREATE REL TABLE SINONIMO_NBS(FROM Termo TO NBS, peso DOUBLE);

// --- Índices de retrieval (criados após COPY) ---
// CALL CREATE_FTS_INDEX('NCM', 'NcmFts', ['codigo', 'descricao']);
// CALL CREATE_FTS_INDEX('NBS', 'NbsFts', ['codigo', 'descricao']);
// CALL CREATE_VECTOR_INDEX('NCM', 'NcmVec', 'embedding');
// CALL CREATE_VECTOR_INDEX('NBS', 'NbsVec', 'embedding');

// --- Query canônica do tracer 10-00 (texto livre -> caminho auditável) ---
// MATCH (n:NCM)-[t:TEM_CLASSIFICACAO]->(c:CCT)-[r:REDUZ_PARA]->(a:Anexo)-[f:FUNDAMENTA_EM]->(art:ArtigoLC214)
// WHERE n.codigo = $ncm RETURN n, t.origem, c.codigo, r.redIBS, r.redCBS, a.nome, art.numero;
