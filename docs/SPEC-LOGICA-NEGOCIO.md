# SPEC-LOGICA-NEGOCIO — Aurum Tax NCM (v3.0)

> **Fonte analisada:** `C:\Users\david\Documents\REFORMA NCM\index.html` (2106 linhas, aplicação single-file HTML+JS).
> **Objetivo:** especificação exaustiva de lógica de negócio para reconstrução em React + Clean Architecture com **paridade total de comportamento**.
> **Convenção:** regras numeradas `**R&lt;seção&gt;.&lt;n&gt;**`. Valores entre aspas são literais exatos. Onde o comportamento original é um defeito, ele está marcado na seção 12 com `[BUG]` + linha.

---

## SUMÁRIO

1. [Modelo de dados](#1-modelo-de-dados)
2. [Regra de classificação (núcleo)](#2-regra-de-classificação-núcleo)
3. [Cálculo tributário](#3-cálculo-tributário)
4. [Módulo SPED](#4-módulo-sped)
5. [Importação de base](#5-importação-de-base)
6. [Lote (CSV/Excel)](#6-lote-csvexcel)
7. [Calculadora](#7-calculadora)
8. [Produtos / Empresas / Emitente](#8-produtos--empresas--emitente)
9. [Tabelas auxiliares](#9-tabelas-auxiliares)
10. [UI/UX](#10-uiux)
11. [Diferenciais / peculiaridades a preservar](#11-diferenciais--peculiaridades-a-preservar)
12. [Inconsistências e bugs](#12-inconsistências-e-bugs)

---

# 1. MODELO DE DADOS

## 1.1 Constantes globais (linhas 633–636)

| Constante | Valor exato | Linha |
|---|---|---|
| `DB_NAME` | `aurum_tax_ncm_v1` | 633 |
| `DB_VERSION` | `2` | 633 |
| `PAGE_SIZE` | `10` | 634 |
| `SESSION_KEY` | `aurum_empresa_ativa_id` (localStorage) | 635 |
| `REF_DEFAULT` | `{IBS: 17.70, CBS: 8.80}` | 636 |
| chave tema | `tema` (localStorage, valores `dark` \| `light`) | 2065 |
| chave banner | `banner_dismissed` (sessionStorage, valor `'1'`) | 201/826 |

**R1.1** — O `openDB()` (l.716–737) abre com `indexedDB.open(DB_NAME, DB_VERSION)`; em `onupgradeneeded` **cria stores apenas se não existirem** (`objectStoreNames.contains`), sem migração de dados entre versões.

**R1.2** — Conexão é cacheada em `_db`; `onversionchange` fecha e zera (`_db=null`). Se `indexedDB` inexistir → `rej(new Error('IndexedDB não suportado.'))`.

**R1.3** — Wrapper `tx(store, mode, fn)` (l.738–748): cria transação sobre **um único store**, executa `fn(store)`, resolve em `oncomplete` com `out.result` (se `out` for IDBRequest com `result !== undefined`) ou com o próprio `out` (caso contrário — usado para resolver uma Promise interna). Rejeita em `onerror`/`onabort`.

**R1.4** — Helpers: `dbGet(store,key)`, `dbGetAll`, `dbCount`, `dbPut`, `dbDelete`, `dbClear`, `dbIndex(store, indexName, key)` = `index(...).getAll(key)`.

**R1.5** — `dbBulkPut(store, items, onProgress)` (l.757–765): grava em **lotes de 500** (`CH = 500`), uma transação `readwrite` por lote; chama `onProgress(min(i+500, total), total)` após cada lote.

## 1.2 Object Stores

| Store (constante `S`) | Nome real | keyPath | Índices | Linha criação |
|---|---|---|---|---|
| `S.NCM` | `ncm` | `id` | `codigo` (não-único), `cst` (não-único) | 723 |
| `S.CST` | `cst` | `codigo` | — | 724 |
| `S.CSTCT` | `cstClassTrib` | `id` | `cst` (não-único) | 725 |
| `S.NCMNOM` | `ncmNomenclatura` | `codigo` | `descricao` (não-único) | 726 |
| `S.EMPRESAS` | `empresas` | `id` (autoIncrement) | — | 727 |
| `S.PRODUTOS` | `produtos` | `id` (autoIncrement) | `empresaId` (não-único), `ncm` (não-único) | 728 |
| `S.META` | `meta` | `chave` | — | 729 |
| `S.CFOP` | `cfop` | `codigo` | — | 730 |
| `S.CSTICMS` | `cstIcms` | `codigo` | — | 731 |
| `S.CSTPISCOFINS` | `cstPisCofins` | `codigo` | — | 732 |

**R1.6** — As buscas por NCM usam **exclusivamente** `dbIndex('ncm','codigo', c)`; nunca `getAll()` filtrado em memória para o núcleo de classificação.

## 1.3 Shape dos registros

### Produto (store `produtos`)

| Campo | Tipo | Origem / regra |
|---|---|---|
| `id` | number | autoIncrement |
| `empresaId` | `number \| null` | `state.empresaAtiva?.id ?? null` |
| `codigo` | string | SKU (obrigatório, trim) |
| `nome` | string | obrigatório (trim) |
| `ncm` | string | `norm(input)` → só dígitos, exige 8 |
| `cfop` | string | select, `''` se vazio |
| `cstIcms` | string | select |
| `pis` | string | select |
| `cofins` | string | select |
| `quantidade` | number | `parseQtd(...)` |
| `valorUnitario` | number | `parseMoeda(...)` |
| `cstReforma` | string | `classificacao.cst` |
| `cClassTrib` | string | `classificacao.cClassTrib` |
| `regraGeral` | boolean | `!!classificacao._isRegraGeral` |
| `classificacaoSnapshot` | object | ver abaixo |
| `criadoEm` | ISO string | |
| `atualizadoEm` | ISO string | |

`classificacaoSnapshot` (l.1026, 1085, 1237, 1684, 1810, 1210):

```js
{
  codigo,                 // classificacao.codigo
  codigoFormatado,        // classificacao.codigoFormatado (fmtNcm)
  cst, cClassTrib,
  descricao,              // classificacao.descricao (descrição do NCM)
  baseLegal,
  pRedIBS,                // resumo.percentualReducaoIBS ?? cstClassTribDetalhes?.pRedIBS ?? null
  pRedCBS,                // resumo.percentualReducaoCBS ?? cstClassTribDetalhes?.pRedCBS ?? null
  anexo,                  // resumo.anexo ?? null
  classificacao           // resumo.descricaoCClassTrib ?? baseLegal
}
```

**R1.7** — O produto **não** guarda `anexo` derivado nem `redIBS` numérico fora do snapshot; a UI lê `c.pRedIBS ?? 0`.

### Empresa (store `empresas`)

`{ id (auto), razaoSocial, cnpj, fantasia, criadoEm }` — l.908.
`cnpj` é gravado **com máscara** (`fmtCnpj` aplicada na importação em lote; na digitação, `data-mask="cnpj"`).

### Emitente (store `meta`, chave `emitente`)

`{ chave:'emitente', valor:{razaoSocial,cnpj,ie,endereco,cidade,cep,telefone,email,site,cor,rodape,logo}, atualizadoEm }`
Defaults na ausência: `cor:'#0f215c'`, demais `''`, `logo:null` (l.787, 791).

### NCM vínculo (store `ncm`) — `mapNcm(n, i)` l.860

| Campo | Origem no JSON |
|---|---|
| `id` | `` `${codigo}\|${cClassTrib}\|${i}` `` (i = índice no array de origem) |
| `codigo` | `norm(n.codigo)` |
| `codigoFormatado` | `fmtNcm(codigo)` |
| `cst` | `String(n.cst ?? '')` |
| `cClassTrib` | `String(n.cClassTrib ?? '')` |
| `baseLegal` | `n.baseLegal \|\| ''` |
| `reducao` | `n.reducao ?? null` |
| `aliquotaIBS` | `n.aliquotaIBS ?? null` |
| `aliquotaCBS` | `n.aliquotaCBS ?? null` |
| `descricao` | `n.descricaoCompleta \|\| ''` |
| `cstDetalhes` | `n.cstDetalhes \|\| null` |
| `cstClassTribDetalhes` | `n.cstClassTribDetalhes \|\| null` |
| `referencia` | `n.referenciaClassificacaoTributaria \|\| null` |
| `resumo` | `n.resumo \|\| null` |

**Sub-objeto `resumo` (campos efetivamente lidos pela UI):**
`descricaoCClassTrib`, `percentualReducaoIBS`, `percentualReducaoCBS`, `anexo`, `urlLegislacao`, `documentosHabilitados`.

**Sub-objeto `referencia` (campos lidos):** `'LC 214/25'`, `'Redução de Alíquota'`, `'Redução BC CST'`, `'Monofásica'`, `'Crédito Presumido'`, `'Número do Anexo'`, `'Url da Legislação'` + flags de documento (`NFe`,`NFCe`,`CTe`,`CTeOS`,`BPe`,`BPeTM`,`NF3e`,`NFCom`,`NFSe`).

**Sub-objeto `cstDetalhes`:** `'Descrição CST-IBS/CBS'`, `ind_gRed`, `docs`.
**Sub-objeto `cstClassTribDetalhes`:** `pRedIBS`, `pRedCBS`, `ind_RedutorBC`, `ind_CredPres`, `indMono`, `'LC 214/25'`, `'LC Redação'`, `nome`, `descricao`.

### CST IBS/CBS (store `cst`) — `mapCst(c)` l.858

`{ codigo: String(c['CST-IBS/CBS'] ?? '').padStart(3,'0'), descricao: c['Descrição CST-IBS/CBS'] || '', ind_gIBSCBS, ind_gIBSCBSMono, ind_gRed, ind_gDif, ind_gTransfCred, docs:{NFe,NFCe,CTe,CTeOS,BPe,BPeTM,NF3e,NFCom,NFSe} }`
(mapeia `indNFe, indNFCe, indCTe, indCteOS, indBPe, indBPeTM, indNF3e, indNFCom, indNFSe`).

### cClassTrib (store `cstClassTrib`) — `mapCstct(c)` l.859

```js
{ id: `${cst}|${ct}`,              // cst = String(c['CST-IBS/CBS'] ?? ''), ct = String(c.cClassTrib ?? '')
  cst, descricaoCst: c['Descrição CST-IBS/CBS'] || '',
  cClassTrib, nome: c['Nome cClassTrib'] || '', descricao: c['Descrição cClassTrib'] || '',
  lcRedacao: c['LC Redação'] || '', lcRef: c['LC 214/25'] || '', tipoAliquota: c['Tipo de Alíquota'] || '',
  pRedIBS, pRedCBS, ind_RedutorBC, ind_gTribRegular, ind_CredPres,
  indMono, indMonoReten, indMonoRet, indMonoDif,
  'LC 214/25': c['LC 214/25'] || '' }
```
**R1.8** — A chave `id` do cClassTrib é **composta `cst|cClassTrib`** (sem padStart aqui; o padStart é aplicado à importação via `mapCstct` só em `cst`? **não** — `mapCstct` grava `cst` crua; o `padStart(3)`/`padStart(6)` só acontece na edição manual, ver R9.x).

### Nomenclatura (store `ncmNomenclatura`) — l.866

`{ codigo (só dígitos, `norm(Codigo)`), codigoOriginal (trim do original), descricao, dataInicio, dataFim, ato }`
`ato` = `` `${Tipo_Ato_Ini} ${Numero_Ato_Ini||''}/${Ano_Ato_Ini||''}`.trim() `` se `Tipo_Ato_Ini` truthy, senão `null`.
Filtro de ingestão: `codigo.length >= 2`.

### CFOP / CST ICMS / CST PIS-COFINS

`{ codigo, descricao }` + `tipo: 'Entrada' | 'Saída' | 'Outros'` (apenas CFOP).

### META (store `meta`)

| `chave` | demais campos | Quando gravado |
|---|---|---|
| `emitente` | `valor`, `atualizadoEm` | salvarEmitente (l.791), restauração (l.2059) |
| `seed_v2_done` | `valor:true`, `quando` | seed (l.784) |
| `importacao` | `data`, `arquivo` | importarJSON formato NCM (l.886) |
| `importacao_nomenclatura` | `data`, `arquivo`, `total` | importarJSON formato Nomenclaturas (l.872) |

---

# 2. REGRA DE CLASSIFICAÇÃO (NÚCLEO)

## 2.1 Consultas básicas

**R2.1** — `buscarClassificacoesDoNcm(codigo)` (l.941):
`c = norm(codigo)`; **se `c.length !== 8` retorna `[]` imediatamente**; senão retorna `dbIndex('ncm','codigo', c)` (array na ordem do índice/keyval, ou seja, ordem de gravação).

**R2.2** — `buscarNomenclatura(codigo)` (l.942): `c = norm(codigo)`; se vazio → `null`; senão `dbGet('ncmNomenclatura', c)` (pode ser `undefined`).

**R2.3** — `sugerirNomenclatura(prefixo)` (l.943):
- `t = norm(prefixo)`; **se `t.length < 2` retorna `[]`**;
- `IDBKeyRange.bound(t, t + '\uffff')` sobre o store `ncmNomenclatura` (range lexicográfico sobre o keyPath `codigo`);
- cursor coleta **até 30** registros (`out.length >= 30` para) ou até o fim do range;
- retorna `[]` se nenhum.

## 2.2 Regra geral (fallback)

**R2.4** — `buscarRegraGeralDetalhes()` (l.945–952), ordem exata:
1. `cstDet = dbGet('cst','000')` (erro engolido por `try/catch` vazio);
2. `cctDet = dbGet('cstClassTrib','000|000001')` (erro engolido);
3. se `cstDet` nulo → fallback literal:
   `{codigo:'000', descricao:'Tributação integral', ind_gIBSCBS:1, ind_gIBSCBSMono:0, ind_gRed:0, ind_gDif:0, ind_gTransfCred:1, docs:{NFe:'Sim',NFCe:'Sim',CTe:'Sim',CTeOS:'Sim',BPe:'Sim',BPeTM:'Sim',NF3e:'Sim',NFCom:'Sim',NFSe:'Sim'}}`
4. se `cctDet` nulo → fallback literal:
   `{id:'000|000001', cst:'000', cClassTrib:'000001', descricaoCst:'Tributação integral', nome:'Tributação integral — regra geral', descricao:'Regra geral da LC 214/2025.', lcRedacao:'', lcRef:'LC 214/2025', tipoAliquota:'Integral', pRedIBS:0, pRedCBS:0, ind_RedutorBC:0, ind_gTribRegular:1, ind_CredPres:0, indMono:0, indMonoReten:0, indMonoRet:0, indMonoDif:0, 'LC 214/25':'LC 214/2025 — Regra geral'}`

**R2.5** — `classificacaoRegraGeral(codigo, nomen)` (l.953–956) retorna **exatamente**:

```js
{
  id: `REGRA|${cod}`,
  codigo: cod,
  codigoFormatado: fmtNcm(cod),
  cst: '000',
  cClassTrib: '000001',
  baseLegal: lcRef,                       // cctDet['LC 214/25'] || cctDet.lcRef || 'LC 214/2025 — Regra geral'
  descricao: nomen ? nomen.descricao : (cctDet.descricao || '—'),
  cstDetalhes: cstDet,
  cstClassTribDetalhes: cctDet,
  referencia: {
    'LC 214/25': lcRef,
    'Redução de Alíquota': 'Não', 'Redução BC CST': 'Não',
    'Monofásica': 'Não', 'Crédito Presumido': 'Não',
    'Número do Anexo': null, 'Url da Legislação': null,
    ...cstDet.docs          // espalha NFe:'Sim', NFCe:'Sim', ...
  },
  resumo: {
    descricaoCClassTrib: cctDet.nome || cctDet.descricao || 'Tributação integral — regra geral',
    percentualReducaoIBS: cctDet.pRedIBS ?? 0,
    percentualReducaoCBS: cctDet.pRedCBS ?? 0,
    anexo: null,
    urlLegislacao: null,
    documentosHabilitados: cstDet.docs || null
  },
  _isRegraGeral: true
}
```

**R2.6** — `_isRegraGeral === true` **apenas** quando o objeto foi produzido por `classificacaoRegraGeral` (ou pelo objeto sintético de NCM inválido em `Sped.analisar`, l.1479, que também traz `_isRegraGeral:true`). Vínculos vindos da base importada **nunca** têm a propriedade (`undefined` → `!!` = `false`).

**R2.7** — Os produtos gravam `regraGeral: !!cl._isRegraGeral`, exceto a calculadora, que acrescenta `|| p.cstReforma === '000'` (ver [BUG] L1146).

## 2.3 Fluxo de decisão: 0, 1 ou N classificações

| Qtd | Consulta NCM (`renderResultadoNcm`, l.993) | Formulário (`carregarClassificacoesForm`, l.1048) | Modal calc custom (`carregarCcClassificacoes`, l.1190) | Lote (l.1227) | SPED (`Sped.analisar`, l.1477) |
|---|---|---|---|---|---|
| **NCM ≠ 8 dígitos** | mensagem "Informe um NCM de 8 dígitos." | placeholder "Informe um NCM de 8 dígitos para carregar as classificações." | "Informe um NCM de 8 dígitos." | `classificacoes=[]`, `escolhida=null` → **inválido** | ramo `else` → objeto sintético |
| **0** | `classificacaoRegraGeral` + card `htmlCardTributacaoIntegral`; `ncmResultados=[rg]`, `rg.__uid='class-0-default'` | `ncmEncontrados=[rg]`, `ncmEscolhido=rg`, alerta âmbar + radio único "CST 000 · 000001" pré-marcado, badge visível, Salvar habilitado | `calcCustomClass = rg`, aviso "⚠ Sem classificação específica — regra geral." | `escolhida = rg`, `regraGeral=true` | `classificacao = rg`, `regraGeral=true` |
| **1** | cabeçalho da nomenclatura + 1 card | `ncmEncontrados=lista`, **`ncmEscolhido = lista[0]` automaticamente** | `calcCustomClass = lista[0]` (primeira) | `escolhida = lista[0]` | `classificacao = classificacoes[0]` |
| **N** | banner "⚡ Este NCM possui N classificações possíveis." + N cards | lista de radios; **nenhum pré-marcado** (`ncmEscolhido` só é setado se `length===1`) | `calcCustomClass = lista[0]` + radios (primeiro marcado) | `escolhida = lista[0]` + `<select>` de troca | `classificacao = classificacoes[0]` |

**R2.8** — Ordem das classificações é **a ordem do índice `codigo`** (ordem de gravação/importação), **sem ordenação** por redução, anexo ou CST.

**R2.9** — Só há fallback para `CST 000 / cClassTrib 000001` quando `buscarClassificacoesDoNcm` devolve `[]` **e** o NCM tem 8 dígitos; para NCM inválido o SPED usa o objeto sintético:

```js
{ cst:'000', cClassTrib:'000001',
  resumo:{ descricaoCClassTrib:'NCM inválido', percentualReducaoIBS:0, percentualReducaoCBS:0 },
  _isRegraGeral: true }
```

## 2.4 Montagem de `resumo`

**R2.10** — Para vínculos importados, `resumo` vem **pronto do JSON** (`mapNcm` copia `n.resumo` integralmente). Não há cálculo em tempo de leitura.
**R2.11** — Para regra geral, `resumo` é **construído** conforme R2.5 (anexo `null`, url `null`, reduções herdadas de `cctDet.pRedIBS/pRedCBS`).
**R2.12** — A UI usa `r.percentualReducaoIBS ?? cct.pRedIBS ?? 0` (`htmlCardClassificacao`, l.977) — ou seja, **fallback duplo** para o detalhe do cClassTrib quando o `resumo` vier incompleto.
**R2.13** — `anexo` exibido no card: `r.anexo || n.referencia?.['Número do Anexo'] || null` (l.978). **Não** é recalculado na UI de consulta (diferente do SPED, R3.3).

## 2.5 Capítulos, `in natura` e observações legais

**R2.14** — `CAPITULOS_IN_NATURA` (l.642) = **25 capítulos**:
`01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,41,42,43,44,45,46,50,51,52,53`.

**R2.15** — `isPossivelInNatura(ncm)` (l.958): `cod = norm(ncm)`; `false` se `cod.length < 2`; senão `CAPITULOS_IN_NATURA.has(cod.slice(0,2))`.

**R2.16** — O **aviso "Produto potencialmente in natura" (Art. 137)** só é renderizado em `htmlCardTributacaoIntegral` (l.985–990), ou seja, **somente quando o NCM não tem classificação específica**. Condição: `norm(codigo).length === 8 && isPossivelInNatura(codigo)`. O texto cita `Capítulo XX — <nome de CAPITULOS_NCM>` e链接 `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm`.

**R2.17** — `CAPITULOS_NCM` (l.638–640) é um mapa completo `capítulo → nome` de `01` a `97` (97 entradas; sem `77`), usado nos avisos e no agrupamento da tabela de Nomenclatura.

**R2.18** — `getObservacoesLegais(ncm, redIBS)` (l.959–966), decisão **exclusiva e nesta ordem** (if/else if — só **um** grupo é produzido):

| Faixa de `redIBS` | Observações empurradas |
|---|---|
| `>= 100` | `{titulo:'Alíquota Zero', texto:'Produto com alíquota zero de IBS/CBS conforme legislação específica.', cor:'emerald'}` |
| `>= 60` (e `<100`) | (a) se `cap ∈ CAPITULOS_IN_NATURA` → `OBS_ARTIGOS.art137`; (b) se `cap ∈ ['02','03','04','07','08','09','10','11','12','15','16','17','18','19','20','21','22']` → `OBS_ARTIGOS.art135`; (c) **sempre** → `OBS_ARTIGOS.art128` |
| `>= 30` (e `<60`) | `{titulo:'Redução parcial', texto:'Produto com redução parcial de alíquotas conforme Anexo da LC 214/2025.', cor:'amber'}` |
| `< 30` | `{titulo:'Regra geral', texto:'Produto sujeito à tributação integral (alíquota cheia) de IBS/CBS conforme regra geral da LC 214/2025.', cor:'slate'}` |

**R2.19** — **Capítulos do art. 135 = 17**: `02,03,04,07,08,09,10,11,12,15,16,17,18,19,20,21,22` (constante literal dentro da função).

**R2.20** — `OBS_ARTIGOS` (l.644–650) contém **5** entradas; `art133` (Medicamentos) e `art139` (Produções culturais) estão **definidas mas nunca referenciadas** (ver seção 12). Textos exatos:
- `art137`: título `Art. 137 — Produtos in natura`; texto `Ficam reduzidas em 60% as alíquotas do IBS e da CBS incidentes sobre o fornecimento de produtos agropecuários, aquícolas, pesqueiros, florestais e extrativistas vegetais in natura.`
- `art128`: `Art. 128 — Redução de 60%` / `Redução de 60% das alíquotas do IBS e da CBS para serviços de educação, saúde, dispositivos médicos, medicamentos, alimentos, produtos de higiene, insumos agropecuários, produções culturais e outros.`
- `art135`: `Art. 135 — Alimentos` / `Redução de 60% das alíquotas do IBS e da CBS para alimentos destinados ao consumo humano.`
- Todos com `link: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'`.

**R2.21** — `cap = norm(ncm).slice(0,2)` — para NCM vazio, `cap=''` e cai sempre no ramo "Regra geral".

## 2.6 Limiares de redução (100 / 60 / 30)

**R2.22** — Os três limiares aparecem em **três lugares distintos**, sempre sobre `percentualReducaoIBS` (nunca CBS):

| Onde | Limiares | Efeito |
|---|---|---|
| `Sped.analisar` (l.1482) | `>=100 → anexo '0'`; `>=60 → '60'`; `>=30 → '30'`; senão `'isento'` | atributo `anexo` |
| `getObservacoesLegais` (l.961–964) | mesmos | textos legais |
| UI (l.969 `badgeReducao`, l.1060 pill ZERO, l.1056, l.1513 `produtosZero`) | `>=100`, `>0`, `>=60` (só em getObs), `>=30` (só em getObs) | rótulos visuais |

**R2.23** — `badgeReducao(p)`: `n = Number(p)||0`; `n >= 100` → pill vermelha "⚡ Alíquota zero"; `n > 0` → pill âmbar "−X,XX%"; senão pill esmeralda "Sem redução".

---

# 3. CÁLCULO TRIBUTÁRIO

## 3.1 `calcularTributos` (l.970) — fórmula exata

```js
function calcularTributos(valorBase, redIBS, redCBS) {
  const rateIBS = state.rateIBS;              // default 17.70
  const rateCBS = state.rateCBS;              // default 8.80
  const redIBSn = Number(redIBS) || 0;
  const redCBSn = Number(redCBS) || 0;
  const aliqIBS = rateIBS * (1 - redIBSn/100);
  const aliqCBS = rateCBS * (1 - redCBSn/100);
  const vIBS = valorBase * (aliqIBS/100);
  const vCBS = valorBase * (aliqCBS/100);
  return { base: valorBase, redIBS: redIBSn, redCBS: redCBSn,
           aliqIBS, aliqCBS, vIBS, vCBS,
           total: vIBS + vCBS,
           carga: valorBase > 0 ? ((vIBS+vCBS)/valorBase)*100 : 0 };
}
```

**R3.1** — Alíquotas de referência são **globais e editáveis** (`state.rateIBS`/`rateCBS`, inputs `#calcRateIBS`/`#calcRateCBS`, `step=0.01 min=0 max=100`, valores HTML `17.70` e `8.80`). Mudança dispara `clamp(v,0,100)` + `atualizarResumoCalc()` + `recalcularTudo()`.

**R3.2** — Redução é aplicada **linearmente** (`1 - red/100`), por tributo de forma **independente** (IBS usa `redIBS`, CBS usa `redCBS`). Não há teto, arredondamento ou validação de `red > 100` (uma redução de 150% geraria alíquota negativa).

**R3.3** — `anexo` derivado (**somente** em `Sped.analisar`, l.1482):

```
redIBS >= 100  → '0'
redIBS >=  60  → '60'
redIBS >=  30  → '30'
senão          → 'isento'
```

Rótulos de badge (l.1518): `'0'` → "🟢 Anexo I — Alíquota Zero"; `'60'` → "🟡 Redução 60%"; `'30'` → "🔵 Redução 30%"; `'isento'` → "⚪ Sem redução". Qualquer valor desconhecido cai em `map['isento']`.

**R3.4** — `carga` (carga efetiva) = `(vIBS+vCBS)/base * 100`, ou `0` quando `base === 0`. Na UI é formatada com `toFixed(2).replace('.',',') + '%'`.

**R3.5** — `state.rateIBS/rateCBS` são lidos **também** por: cards de consulta (`htmlCalculadoraIBS`, `htmlCardTributacaoIntegral`), SPED (`Sped.analisar` → `calcularTributos`), exportações de produto e SPED. Ou seja, **todo o sistema usa as mesmas duas alíquotas globais** (ver [BUG] L973).

---

# 4. MÓDULO SPED

## 4.1 `lerArquivoTexto(file)` (l.1252–1256) — decodificação em cascata

**R4.1** — Ordem exata:
1. `new TextDecoder('utf-8', {fatal:true}).decode(buf)`; se retornar string contendo `'�'` (`\uFFFD`) → lança erro interno e vai para o passo 2;
2. `new TextDecoder('windows-1252').decode(buf)` — se o construtor lançar (navegador sem suporte), vai para o passo 3;
3. byte-a-byte: `out += String.fromCharCode(bytes[i])` (latin1/ISO-8859-1).

**R4.2** — Retorna **string** (não `ArrayBuffer`).

## 4.2 `Sped.toNumber(v)` (l.1259–1267)

| Entrada | Resultado |
|---|---|
| `null` / `undefined` / `''` | `0` |
| `number` finito | o próprio; `NaN/Infinity` → `0` |
| string com `,` | remove todos `.`, troca `,`→`.` e converte |
| string sem `,` | `Number(s)` direto (aceita `1.5`) |
| não numérico | `0` |

## 4.3 `Sped.detectarTipo(conteudo)` (l.1270–1301) — ordem **exata** das checagens

Pré-processamento: `String(conteudo).split(/\r\n|\r|\n/).slice(0, 500)`; para cada linha com `length >= 3`, `c = l.split('|')`, `c[1]` entra no `Set` `regs`; `reg0000 = c` quando `c[1] === '0000'` (último 0000 vence). `codVer = String(reg0000?.[2] ?? '').trim()`.

| # | Condição (primeira verdadeira vence) | Retorno |
|---|---|---|
| 1 | `regs.has('R1000') \|\| 'R2000' \|\| 'R9000'` | `{tipo:'reinf', nome:'EFD Reinf', compativel:false, motivo:'O EFD Reinf usa uma estrutura completamente diferente (eventos R-1000, R-2000, R-9000) e não contém notas fiscais no formato pipe-delimited.'}` |
| 2 | `S1000 \|\| S1200 \|\| S3000` | `{tipo:'esocial', nome:'e-Social', compativel:false, motivo:'O e-Social é um sistema de eventos XML, não um arquivo pipe-delimited. Não há registros C100/C170 para processar.'}` |
| 3 | `I200 \|\| I250` | `{tipo:'ecd', nome:'ECD (Escrituração Contábil Digital)', compativel:false, motivo:'O ECD contém livros contábeis (blocos I, J) e não notas fiscais.'}` |
| 4 | `regs.has('J100') && (regs.has('P100') \|\| regs.has('P200'))` | `{tipo:'ecf', nome:'ECF (Escrituração Contábil Fiscal)', compativel:false, motivo:'O ECF contém apuração do IRPJ/CSLL, não notas fiscais.'}` |
| 5 | `A100 \|\| A170 \|\| M100 \|\| M200 \|\| F100 \|\| F170` | `{tipo:'contribuicoes', nome:'EFD Contribuições (PIS/COFINS)', compativel:true, codVer}` |
| 6 | `C100 \|\| C170 \|\| C190 \|\| D100 \|\| D190` | `{tipo:'icmsipi', nome:'EFD ICMS/IPI (SPED Fiscal)', compativel:true, codVer}` |
| 7 | fallback | `{tipo:'desconhecido', nome:'Tipo de arquivo desconhecido', compativel:false, motivo:'Não foi possível identificar o layout. Certifique-se de que é um arquivo SPED Fiscal (ICMS/IPI) ou EFD Contribuições válido.'}` |

## 4.4 `Sped.parse(conteudo)` — EFD ICMS/IPI (l.1304–1381)

**R4.3** — Divisão de linhas: `split(/\r\n|\r|\n/)` (sem limite). Guardas comuns das duas passes: `if (!linha || linha.length < 3) continue;`.

### Passo 1 — cadastro 0200 (l.1310–1320)

Guardas: `campos.length >= 4` e `campos[1] === '0200'`.

| Campo | Índice |
|---|---|
| `codItem` | `campos[2]` |
| `descItem` | `campos[3]` |
| `ncm` | `campos[8]` → `.trim().replace(/\D/g,'')` |

Se `!codItem` ignora. Se `produtos` **já não tem** `codItem` grava `{codigo, descricao, ncm}` e incrementa `stats.registros0200` (**primeira ocorrência vence**).

### Passo 2 — notas e itens (l.1322–1379)

Guarda extra: `campos.length >= 3`. Variáveis de estado: `notaAtual` (ou `null`) e `notaAtualEhSaida` (**persistem entre linhas**).

**`C100` (l.1329–1340):**

| Campo | Índice |
|---|---|
| `indOper` | `campos[2]` |
| `codPart` | `campos[4]` |
| `numDoc` | `campos[8]` |
| `chave` | `campos[9]` |
| `dtDoc` | `campos[10]` |
| `vlDoc` | `campos[12]` |

- `indOper === '1'` → **saída**: `stats.notasSaida++`, `notaAtualEhSaida = true`, chave do Map `notasSaida` = `` `${numDoc}|${dtDoc}` `` (só grava se `numDoc` truthy).
- senão → **entrada**: `stats.notasEntrada++`, `notaAtualEhSaida=false`, `notasEntrada.push(notaAtual)`.

**`C170` (l.1341–1362)** — decisão prévia:
1. `if (!notaAtual)` → `stats.itensOrfaos++` e `continue` (descarta);
2. `if (!notaAtualEhSaida)` → `stats.itensEntrada++` e `continue` (**item de entrada descartado**).

| Campo | Índice |
|---|---|
| `numItem` | `campos[2]` |
| `codItem` | `campos[3]` |
| `descCompl` | `campos[4]` |
| `qtd` | `campos[5]` |
| `unid` | `campos[6]` |
| `vlItem` | `campos[7]` |
| `vlDesc` | `campos[8]` |
| `cstIcms` | `campos[10]` |
| `cfop` | `campos[11]` |
| `vlBcIcms` | `campos[13]` |
| `aliqIcms` | `campos[14]` |
| `vlIcms` | `campos[15]` |

Depois: `if (!codItem)` → `itensOrfaos++` e `continue`. `prod = produtos.get(codItem)`; se não existir → `stats.itensSemCadastro0200++`. Push:
`{numDoc: notaAtual.numDoc, chave: notaAtual.chave, data: notaAtual.data, numItem, codItem, descricaoProduto: prod?prod.descricao:(descCompl||codItem), ncm: prod?prod.ncm:'', qtd, unid, vlItem, vlDesc, cstIcms, cfop, vlBcIcms, aliqIcms, vlIcms, indOper:'1', tipoDoc:'C'}` e `stats.itensSaida++`.

**`C190` (l.1363–1378):**
1. `if (!notaAtual)` → `continue` (não conta nada);
2. `if (!notaAtualEhSaida)` → `stats.resumosEntrada++` e `continue` (descarta).

| Campo | Índice |
|---|---|
| `cstIcms` | `campos[2]` |
| `cfop` | `campos[3]` |
| `aliqIcms` | `campos[4]` |
| `vlOpr` | `campos[5]` |
| `vlBcIcms` | `campos[6]` |
| `vlIcms` | `campos[7]` |
| `vlBcIcmsSt` | `campos[8]` |
| `vlIcmsSt` | `campos[9]` |
| `vlRedBc` | `campos[10]` |

Push em `resumoC190` com `{numDoc, chave, data, cstIcms, cfop, aliqIcms, vlOpr, vlBcIcms, vlIcms, vlBcIcmsSt, vlIcmsSt, vlRedBc}` + `stats.resumosSaida++`.

**Retorno:** `{produtos:[...produtos.values()], notas:[...notasSaida.values()], notasEntrada, itens, resumoC190, stats, tipo:'icmsipi'}`.

**`stats` inicial (l.1308):** `{linhasTotais, registros0200:0, registrosC100:0, registrosC170:0, registrosC190:0, notasSaida:0, notasEntrada:0, itensSaida:0, itensEntrada:0, itensOrfaos:0, itensSemCadastro0200:0, resumosSaida:0, resumosEntrada:0}`.

## 4.5 `Sped.parseContribuicoes(conteudo)` (l.1384–1469)

Passo 1 (0200) **idêntico** ao do ICMS.

**`stats` inicial (l.1388):** `{linhasTotais, registros0200, registrosA100, registrosA170, registrosC100, registrosC170, registrosD100, registrosD170, notasSaida, notasEntrada, itensSaida, itensEntrada, itensOrfaos, itensSemCadastro0200, registrosC190 (sempre 0), resumosSaida, resumosEntrada}`.

### Cabeçalhos `A100 | C100 | D100` (l.1409–1420)

Comuns: `indOper = campos[2]`, `codPart = campos[4]`.

| Campo | A100 / C100 | D100 |
|---|---|---|
| `numDoc` | `campos[8]` | `campos[7]` |
| `chave` | `campos[9]` | `campos[9]` |
| `dtDoc` | `campos[10]` | `campos[10]` |
| `vlDoc` | `campos[12]` | `campos[12]` |

`notaAtual = {tipo: 'A'|'C'|'D', indOper, codPart, numDoc, chave, data, valorTotal}`.
Saída (`indOper==='1'`): chave do Map = `` `${notaAtual.tipo}${numDoc}|${dtDoc}` `` (prefixo do tipo evita colisão entre blocos), só grava se `numDoc` truthy. Senão: entrada (`notasEntrada.push`).

### Itens `A170 | C170 | D170` (l.1421–1466)

Guardas: `!notaAtual` → `itensOrfaos++`/`continue`; `!notaAtualEhSaida` → `itensEntrada++`/`continue`.

Comuns: `numItem = campos[2]`, `codItem = campos[3]`, `descCompl = campos[4]`.

| Campo | A170 | C170 | D170 |
|---|---|---|---|
| `qtd` | `1` (fixo) | `campos[5]` | `1` (fixo) |
| `unid` | `'UN'` (fixo) | `campos[6]` | `'UN'` (fixo) |
| `vlItem` | `campos[5]` | `campos[7]` | `campos[5]` |
| `vlDesc` | `campos[6]` | `campos[8]` | `campos[6]` |
| `cfop` | `''` | `campos[11]` | `''` |
| `cstIcms` | `''` | `campos[10]` | `''` |
| `cstPis` | `campos[9]` | `campos[25]` | `campos[9]` |
| `vlBcPis` | `campos[10]` | `campos[26]` | `campos[10]` |
| `vlPis` | `campos[12]` | `campos[30]` | `campos[12]` |
| `cstCofins` | `campos[13]` | `campos[31]` | `campos[13]` |
| `vlBcCofins` | `campos[14]` | `campos[32]` | `campos[14]` |
| `vlCofins` | `campos[16]` | `campos[36]` | `campos[16]` |

Depois: `!codItem` → `itensOrfaos++`/`continue`; lookup 0200; push:

```js
{ numDoc, chave, data, numItem, codItem,
  descricaoProduto: prod ? prod.descricao : (descCompl || codItem),
  ncm: prod ? prod.ncm : '',
  qtd, unid, vlItem, vlDesc,
  cstIcms: cstIcms || cstPis || cstCofins || '',
  cfop,
  vlBcIcms: vlBcPis || 0, aliqIcms: 0, vlIcms: 0,
  cstPis, cstCofins, vlPis, vlCofins, vlBcPis, vlBcCofins,
  indOper: '1', tipoDoc: notaAtual.tipo }
```

**Retorno:** `{produtos, notas, notasEntrada, itens, resumoC190: [], stats, tipo:'contribuicoes'}`.

## 4.6 `Sped.analisar(itens)` (l.1471–1487)

**R4.4** — Dois caches por execução: `cacheNcm: Map<ncm, classificacoes[]>` e `cacheNomen: Map<ncm, nomenclatura|undefined>`.

**R4.5** — Ordem de decisão por item:
1. Se `ncm` truthy **e** `ncm.length === 8` → usa cache ou `buscarClassificacoesDoNcm`; caso contrário `classificacoes = []`;
2. `classificacoes.length > 0` → `classificacao = classificacoes[0]`;
3. senão, se NCM válido → `nom` (cache/`buscarNomenclatura`), `classificacao = classificacaoRegraGeral(ncm, nom)`, `regraGeral = true`;
4. senão → objeto sintético (R2.9), `regraGeral = true`.

**R4.6** — Cálculo: `base = Number(item.vlItem) || 0`; `calc = calcularTributos(base, redIBS, redCBS)`; `anexo` (R3.3); `observacoes = getObservacoesLegais(ncm, redIBS)`.

**R4.7** — Resultado: `{...item, classificacao, regraGeral, redIBS, redCBS, ibs: calc.vIBS, cbs: calc.vCBS, totalTributos: calc.total, carga: calc.carga, anexo, observacoes}`.

## 4.7 `Sped.analisarResumo(resumoC190)` (l.1489–1502)

**R4.8** — Agrupamento por chave `` `${cstIcms}|${cfop}` `` (CST ICMS + CFOP). Acumuladores: `totalOperacao += vlOpr`, `totalBcIcms += vlBcIcms`, `totalIcms += vlIcms`, `qtdNotas += 1` (conta **registros**, não notas distintas).

**R4.9** — Para cada grupo: `calc = calcularTributos(totalOperacao, 0, 0)` — **sempre redução zero**. Monta:
```js
{ ...g,
  descricaoProduto: `Resumo CST ${g.cstIcms} / CFOP ${g.cfop}`,
  classificacao: { cst:'000', cClassTrib:'000001',
    resumo:{ descricaoCClassTrib:`Estimativa por CST ${g.cstIcms} + CFOP ${g.cfop}`,
             percentualReducaoIBS:0, percentualReducaoCBS:0 }, _isRegraGeral:true },
  regraGeral:true, redIBS:0, redCBS:0,
  ibs: calc.vIBS, cbs: calc.vCBS, totalTributos: calc.total, carga: calc.carga,
  anexo: 'isento',
  observacoes:[{ titulo:'Análise resumida (sem NCM)',
    texto:'Este arquivo SPED contém apenas registros C190 (resumo por CST/CFOP) para as saídas. Sem detalhamento por item (C170) com NCM, a classificação da Reforma é estimada pela REGRA GERAL (alíquota cheia). Para classificação precisa, exporte um SPED com os C170 das saídas ou use a aba "Classificação em lote" com um CSV de produtos.',
    cor:'amber' }],
  _isResumo: true }
```
**R4.10** — Ordenação final: **`sort` descendente por `totalOperacao`**.

## 4.8 Fluxo `processarSped(file)` (l.1705–1799)

**R4.11** — Sequência:
1. spinner "Lendo arquivo SPED…";
2. `texto = await lerArquivoTexto(file)`; `det = Sped.detectarTipo(texto)`;
3. **se `!det.compativel`** → painel vermelho "⛔ Tipo de arquivo não suportado" com `det.nome` e `det.motivo` + lista de tipos aceitos; **retorna** (nenhuma ação posterior);
4. `det.tipo === 'contribuicoes'` → `state.spedTipo='contribuicoes'`, spinner âmbar "Processando **EFD Contribuições** (PIS/COFINS)…", `Sped.parseContribuicoes`; senão `state.spedTipo='icmsipi'` e `Sped.parse`;
5. `state.spedStats = parsed.stats`;
6. **`parsed.itens.length > 0` → modo `itens`:**
   - `state.spedModo='itens'`; spinner "Analisando N itens de saída…"; `resultados = await Sped.analisar(parsed.itens)`; `state.spedDados = resultados`; `Sped.render(resultados, parsed.stats, det.tipo)`;
   - mostra os 4 botões: `#btnSpedLimpar`, `#btnSpedExportarPDF`, `#btnSpedExportarCSV`, `#btnSpedSalvarProdutos`;
   - toast: base `"${N} itens de saída analisados"`; se `stats.itensEntrada > 0` acrescenta `" · ${X} itens de entrada ignorados"`; `semNcm = resultados.filter(r => !r.ncm || r.ncm.length !== 8).length` e se `>0` acrescenta `" · ${Y} sem NCM válido"`; tipo do toast = `semNcm ? 'warn' : 'ok'`;
   - **retorna**;
7. **`parsed.resumoC190.length > 0` → modo `resumo`:**
   - `state.spedModo='resumo'`; spinner "Analisando N registros C190 de saída…"; `Sped.analisarResumo`; `Sped.renderResumo(resultados, parsed.stats)`;
   - mostra `Limpar`, `ExportarPDF`, `ExportarCSV`; **esconde** `#btnSpedSalvarProdutos`;
   - toast **warn**: `` `Modo resumo: ${resultados.length} grupos CST/CFOP · ${parsed.stats.resumosSaida} C190 de saída` ``;
   - **retorna**;
8. **senão (sem itens e sem resumo)** → painel âmbar com:
   - título: `` `Arquivo ${det.nome} contém apenas operações de ENTRADA` `` **se** `temEntradas && stats.notasSaida === 0`, onde `temEntradas = stats.notasEntrada > 0 || stats.itensEntrada > 0`; senão `'Nenhum item de saída encontrado no arquivo'`;
   - corpo: se só entradas → `"Detectamos apenas notas de entrada. Como a simulação é feita sobre as <strong>saídas</strong>, não há dados para analisar."`; senão `` `O arquivo ${det.nome} não contém itens detalhados (${isContrib ? 'A170/C170/D170' : 'C170'}) nem resumo ${isContrib ? '' : '(C190) '}para as saídas.` ``
   - grade de estatísticas: `Linhas totais`, `Registros 0200`, [`A100`,`A170` se contrib], `C100`, `C170`, [`D100`,`D170` se contrib **ou** `C190` se icms], `Notas entrada`, `Notas saída`, `Itens entrada`, `Itens saída`;
9. `catch(e)` → painel "Erro ao processar SPED" + `e.message` (com `console.error`).

**R4.12** — `renderSpedView()` é **vazio** (l.1817, "Reservado") — trocar para a view `sped` não altera o conteúdo já renderizado.

**R4.13** — "Limpar análise" (l.1698) zera `state.spedDados/spedStats/spedModo/spedTipo`, limpa `#spedResultado` e esconde os 4 botões.

## 4.9 Renderização (diferenciais de conteúdo)

**R4.14** — `Sped.render` monta: banner "O que foi identificado no arquivo SPED" (cards: Notas de entrada **(IGNORADAS)**, Notas de saída **(ANALISADAS)**, Itens de entrada *descartados*, Itens de saída *processados*; nota adicional "ℹ️ **EFD Contribuições**: processamos A170 (serviços), C170 (mercadorias) e D170 (transporte)." quando `tipo==='contribuicoes'`; linha "✅ **Apenas as saídas foram consideradas** — entradas não impactam a simulação." + "N item(ns) ignorado(s)." + "N item(ns) sem cadastro 0200.").

**R4.15** — Totais: `totalBase = Σ vlItem`, `totalIBS = Σ ibs`, `totalCBS = Σ cbs`, `totalTributos = IBS+CBS`, `cargaMedia = totalBase>0 ? totalTributos/totalBase*100 : 0`.

**R4.16** — Painéis: "Produtos com Alíquota Zero" (`redIBS >= 100`, máx. 50 linhas, coluna Tributos **fixa "R$ 0,00"**), "Separação por Anexo" (4 blocos com Itens/Valor/Tributos), 2 gráficos Chart.js (doughnut de valor por anexo; barra horizontal Top 15 produtos por tributos, `slice(0,15)`, labels truncados em 30 chars), tabela "Detalhamento por Produto" com **`resultados.slice(0, 200)`**.

**R4.17** — `renderResumo` (modo resumo): banner "Modo RESUMO ativado", cards `Grupos CST+CFOP`, `Notas (C190)` (`Σ qtdNotas`), `Base total` (`Σ totalOperacao`), IBS, CBS, Carga média; tabela por CST+CFOP com `tfoot TOTAL`.

## 4.10 Gravação a partir do SPED

**R4.18** — `salvarProdutoSped(r)` (l.1677–1689), validações **nesta ordem**:
1. `!r` → toast warn `'Nenhum produto selecionado.'`;
2. `!state.empresaAtiva` → warn `'Selecione uma empresa ativa para salvar o produto.'`;
3. `r._isResumo` → warn `'Análise resumida não permite salvar produtos individuais (falta NCM).'`.

**R4.19** — Derivação de valor unitário (**regra de paridade**):
```js
qtd = Number(r.qtd) || 0;
valorUnit = qtd > 0 ? (Number(r.vlItem) || 0) / qtd : 0;
```
Registro gravado (l.1684):
`{empresaId: state.empresaAtiva.id, codigo: r.codItem, nome: r.descricaoProduto || r.codItem, ncm: r.ncm, cfop: r.cfop, cstIcms: r.cstIcms, pis: r.cstPis || '', cofins: r.cstCofins || '', quantidade: qtd, valorUnitario: valorUnit, cstReforma: c.cst || '000', cClassTrib: c.cClassTrib || '000001', regraGeral: !!c._isRegraGeral, classificacaoSnapshot:{codigo: c.codigo || r.ncm, codigoFormatado: c.codigoFormatado || fmtNcm(r.ncm), cst, cClassTrib, descricao: c.descricao || '', baseLegal: c.baseLegal || '', pRedIBS: resumo.percentualReducaoIBS ?? r.redIBS ?? 0, pRedCBS: resumo.percentualReducaoCBS ?? r.redCBS ?? 0, anexo: resumo.anexo ?? null, classificacao: resumo.descricaoCClassTrib || c.baseLegal || ''}, criadoEm: agora, atualizadoEm: agora}`
Sucesso → toast `` `Produto "${r.codItem}" salvo.` ``, fecha modal, `carregarProdutos()` + `atualizarStatusBase()`. Erro → `'Erro ao salvar: ' + e.message`.

**R4.20** — `salvarTodosProdutosSped()` (l.1801–1815), validações:
1. `!state.spedDados?.length` → warn `'Nenhum dado para salvar.'`;
2. `state.spedModo === 'resumo'` → warn `'Análise em modo resumo não permite salvar produtos (sem NCM).'`;
3. `!state.empresaAtiva` → warn `'Selecione uma empresa ativa para salvar os produtos.'`;
4. `confirm("Salvar N produtos de saída na empresa \"<razão social>\"?")` — cancelar aborta.

Loop com a **mesma** derivação `valorUnitario = qtd>0 ? vlItem/qtd : 0` (idem snapshot, com `pRedIBS: resumo.percentualReducaoIBS ?? r.redIBS` — **sem** `?? 0` final). Toast final `` `${salvos} produtos salvos na empresa "<razão>"` ``.

## 4.11 Exportações do SPED

**R4.21** — `Sped.exportarCSV(resultados)` (l.1638–1645): detecta resumo por `resultados[0]._isResumo`.

| Modo | Cabeçalho (ordem exata) |
|---|---|
| resumo | `CST ICMS; CFOP; Notas; Valor Operação; BC ICMS; ICMS; IBS; CBS; Total Tributos` |
| itens | `Código; Produto; NCM; CST; CFOP; Qtd; Valor; CST Reforma; cClassTrib; Red. IBS (%); Red. CBS (%); IBS; CBS; Total Tributos; Anexo` |

Separador `;`, todas as células entre aspas (`"` escapado como `""`), linhas `\r\n`, BOM `\uFEFF`, arquivo `` `SPED_Tributacao_YYYY-MM-DD.csv` ``. Números com `.toFixed(2)`.

**R4.22** — `Sped.exportarPDF(resultados, stats)` (l.1610–1636): paisagem A4 (297×210), margens `{left:10,right:10,top:30,bottom:15}`, título `` `${tipoNome} — Relatório Tributário (LC 214/2025)` ``, subtítulo `` `Emitente: <razão ou —> · Gerado em <locale pt-BR>` ``, faixa de totais (Itens/Base/IBS/CBS/Total/Carga) e faixa de aviso `⚠️ Esta análise considera apenas as operações de SAÍDA do SPED. As entradas foram descartadas automaticamente.`; tabela `startY: 48`:

| Modo | Colunas |
|---|---|
| resumo | `CST ICMS, CFOP, Notas, Valor Operação, BC ICMS, IBS, CBS, Total` (9 colunas: inclui `ICMS`) |
| itens | `Código, Produto, NCM, CST, CFOP, Qtd, Valor, CST Reforma, cClassTrib, Red. IBS, Red. CBS, IBS, CBS, Total` (14) |

Arquivo `` `SPED_Tributacao_YYYY-MM-DD.pdf` ``.

---

# 5. IMPORTAÇÃO DE BASE

## 5.1 `importarJSON(json, nomeArquivo)` (l.861–891)

**R5.1** — Guarda inicial: `if (!json || typeof json !== 'object') throw new Error('JSON inválido.')`. Sempre mostra `#configProgress` (remove `hidden`).

**R5.2** — **Detecção do formato: primeiro teste vence** — `if (Array.isArray(json.Nomenclaturas))` → Formato A; senão → Formato B.

### Formato A — Nomenclaturas (Tabela_NCM_Vigente_*.json)

| Etapa | Mensagem/progresso |
|---|---|
| mapeia `json.Nomenclaturas` | `codigo=norm(Codigo)`, `codigoOriginal=String(Codigo||'').trim()`, `descricao=Descricao||''`, `dataInicio=Data_Inicio||null`, `dataFim=Data_Fim||null`, `ato` (R1.3 da seção 1) |
| filtro | `codigo.length >= 2` |
| vazio | `throw new Error('Base de nomenclatura sem itens válidos.')` |
| limpa | `'Limpando nomenclatura' — 5` → `dbClear('ncmNomenclatura')` |
| grava | `'Gravando nomenclatura' — 15` … `15 + round((a/b)*80)` (bulk) |
| final | `'Finalizando' — 100` |
| META | `{chave:'importacao_nomenclatura', data, arquivo: nomeArquivo, total: itens.length}` |
| toast | `` `Nomenclatura NCM importada: ${itens.length} códigos.` `` |
| pós | `atualizarStatusBase()`, `state.nomenCache=[]`, `renderAuxiliares()`; esconde progresso após **1200 ms** |

**Não** toca nas stores `ncm`, `cst`, `cstClassTrib`.

### Formato B — NCM + tabelasAuxiliares (reforma_tributaria_por_ncm.json)

| Etapa | Detalhe |
|---|---|
| leitura NCM | `ncmBruto = Array.isArray(json.NCM) ? json.NCM : Array.isArray(json.ncm) ? json.ncm : []`; se vazio → `throw new Error('Formato não reconhecido.')` |
| leitura tabelas | `tab = json.tabelasAuxiliares || {}`; `cstBruto = Array.isArray(tab.cst)?tab.cst:[]`; `cstctBruto = Array.isArray(tab.cstClassTrib)?tab.cstClassTrib:[]` |
| mapeia | `ncmItens = ncmBruto.map((n,i)=>mapNcm(n,i)).filter(x=>x.codigo.length===8)`; `cstItens = cstBruto.map(mapCst)`; `cstctItens = cstctBruto.map(mapCstct)` |
| limpa | `'Limpando base' — 3` → `Promise.all([dbClear(ncm), dbClear(cst), dbClear(cstClassTrib)])` |
| grava CST | `'Gravando CST' — 8` (apenas `if (cstItens.length)`) |
| grava cClassTrib | `'Gravando cClassTrib' — 18` (apenas `if (cstctItens.length)`) |
| grava NCM | `'Gravando NCM' — 28` … `28 + round((a/b)*70)` (bulk, **sempre**) |
| final | `'Finalizando' — 100` |
| META | `{chave:'importacao', data, arquivo}` (**sem** `total`) |
| caches | `state.cstCache = cstItens; state.cstctCache = cstctItens;` |
| toast | `` `Base da Reforma importada: ${ncmItens.length} NCMs.` `` |

**R5.3** — **Filtro crítico de paridade**: só entram na store `ncm` vínculos com `codigo.length === 8` **exatamente**; NCMs de 2–7 dígitos (subposições) são **descartados** silenciosamente.
**R5.4** — A `id` do vínculo depende do **índice no array de origem** (`...|${i}`), portanto reimportar o mesmo arquivo gera os mesmos ids **apenas** se a ordem do array não mudar (e a store é limpa antes, então não há duplicação).

**R5.5** — `atualizarStatusBase()` (l.892–896) conta: NCM, CST, cClassTrib, Nomencl., CFOP, CST ICMS, PIS/COFINS, Empresas, Produtos e renderiza 9 cards (grid `md:grid-cols-3 lg:grid-cols-6`).

---

# 6. LOTE (CSV/EXCEL)

## 6.1 `normalizeHeader(h)` (l.1215)

```
String(h ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')   // remove acentos
  .replace(/\W+/g,'')                                 // remove qualquer não-alfanumérico
```
Idêntica à `normalizeHeaderLote` (l.910) usada na importação de empresas.

## 6.2 `mapearColunas(headers)` (l.1216) — regex exatas

Aplica `normalizeHeader` em cada cabeçalho e testa **cadeia `if/else if`** (primeiro grupo que casar vence; a coluna é atribuída ao **último índice** que casar, pois `forEach` sobrescreve):

| Atributo | Regex (após normalização) |
|---|---|
| `codigo` | `/^(cod\|sku\|codigo\|codigosku\|codigoproduto\|code\|codigointerno)$/` |
| `nome` | `/^(nome\|nomedoproduto\|produto\|descricao\|nomedescricao\|descricaoproduto)$/` |
| `ncm` | `/^(ncm\|codigoncm\|ncmsh)$/` |
| `cfop` | `/^(cfop\|codigocfop)$/` |
| `cstIcms` | `/^(cst\|csticms)$/` |
| `pis` | `/^(pis\|cstpis\|piscst)$/` |
| `cofins` | `/^(cofins\|cstcofins\|cofinscst)$/` |

**R6.1** — Coluna chamada apenas **"CST"** mapeia para **CST ICMS** (não CST Reforma).

## 6.3 `processarArquivoLote(file)` (l.1217–1232)

**R6.2** — Leitura: `XLSX.read(await file.arrayBuffer(), {type:'array'})` → **primeira sheet** → `sheet_to_json(sheet, {header:1, defval:''})`.
**R6.3** — `rows.length < 2` → `throw new Error('Arquivo vazio ou sem dados.')`.
**R6.4** — `map.ncm == null` → `throw new Error('Coluna NCM não encontrada no cabeçalho.')`.
**R6.5** — Linhas de dados: `rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''))`.
**R6.6** — Por linha: `cod = norm(row[map.ncm])`; campos ausentes viram `''` (checagem `map.X != null`).

**R6.7** — Seleção automática da classificação (ordem):
```
if (cod.length === 8) classificacoes = await buscarClassificacoesDoNcm(cod)  else []
if (classificacoes.length)            escolhida = classificacoes[0]                       // PRIMEIRA
else if (cod.length === 8)            escolhida = await classificacaoRegraGeral(cod, nom); regraGeral = true
else                                  escolhida = null                                    // NCM inválido
```

**R6.8** — Todos os dados são processados **sequencialmente** (`await` dentro do `for`), sem paralelismo.

## 6.4 `renderResultadoLote(items, nomeArquivo)` (l.1233–1238)

**R6.9** — Estatísticas exibidas (pills):
| Pill | Cálculo | Cor |
|---|---|---|
| `📄 <arquivo>` | nome | slate |
| `N linhas` | `items.length` | slate |
| `N classificadas` | `items.filter(i=>i.escolhida).length` | esmeralda |
| `N em regra geral` | `filter(i=>i.regraGeral).length` (só se `>0`) | âmbar |
| `N com múltiplas opções` | `filter(i=>i.classificacoes.length>1).length` (só se `>0`) | âmbar |
| `N inválidos` | `filter(i=>i.ncm.length !== 8).length` (só se `>0`) | vermelha |

**R6.10** — Célula "Classificação Reforma" por linha (3 estados):
1. `ncm.length !== 8` → texto vermelho `NCM inválido`;
2. `regraGeral` → bloco âmbar `CST 000 · 000001` + `⚡ ${descricaoCClassTrib || 'Tributação integral'}`;
3. `classificacoes.length === 1` → `cst · cClassTrib` + descrição;
4. senão → rótulo `⚡ N opções` + `<select data-lote-idx="i">` com uma opção por classificação (`cst · cClassTrib - (descricao||baseLegal).slice(0,60)`), `selected` na atual.

**R6.11** — Tabela limitada a **`items.slice(0,200)`**; se `items.length > 200`, rodapé `Exibindo as primeiras 200 de N linhas.` (colspan 5).
**R6.12** — Troca no `<select>` grava `items[idx].escolhida = items[idx].classificacoes[j]` (mutação do array em memória).

## 6.5 "Salvar todos como produtos" (l.1237)

**R6.13** — Percorre `items`; **ignora** (`ignorados++`) quando `!it.escolhida || !it.codigo` (sem SKU). Grava:
`{empresaId: empresaAtiva?.id ?? null, codigo, nome: it.nome || it.codigo, ncm: it.ncm, cfop, cstIcms, pis, cofins, quantidade: 0, valorUnitario: 0, cstReforma: c.cst, cClassTrib: c.cClassTrib, regraGeral: !!c._isRegraGeral, classificacaoSnapshot:{...padrão...}, criadoEm, atualizadoEm}`.
**R6.14** — Toast `` `${salvos} produtos salvos.` `` + `` ` ${ignorados} ignorados.` `` se houver; depois `carregarProdutos()`, `atualizarStatusBase()`, `trocarView('produtos')`.

**R6.15** — Modelo CSV (l.1246): cabeçalho `COD/SKU;NOME DO PRODUTO;NCM;CFOP;CST;PIS;COFINS` + 3 linhas de exemplo (`02011000`, `90181100`, `30049099`; CFOP `5102`; CST `000`; PIS/COFINS `01`), separador `;`, BOM, nome `modelo_classificacao_lote.csv`.

---

# 7. CALCULADORA

## 7.1 Modelo de item (`state.calcItens`)

| Campo | Tipo | Observação |
|---|---|---|
| `uid` | string | `uid()` = `'x' + Date.now().toString(36) + Math.random().toString(36).slice(2,7)` |
| `origem` | `'produto' \| 'classificacao' \| 'manual'` | |
| `produtoId` | `number \| null` | null ⇒ item "manual/classificação" |
| `codigo` | string | SKU (vazio nos itens não-produto) |
| `nome` | string | |
| `ncm` | string | |
| `cst`, `cClassTrib`, `descClass` | string | `descClass` = `resumo.descricaoCClassTrib \|\| baseLegal \|\| '—'` |
| `redIBS`, `redCBS` | number | copiados **no momento da adição** (snapshot, não reativo) |
| `regraGeral` | boolean | ver abaixo |
| `quantidade` | number | |
| `valorUnitario` | number | |
| `baseLegal` | string | |

## 7.2 Três caminhos de adição

**R7.1** — `adicionarProdutoCalculadora(p)` (l.1146) — origem `'produto'`:
`c = p.classificacaoSnapshot || {}`; `descClass = c.classificacao || p.baseLegal || '—'`; `redIBS = c.pRedIBS ?? 0`; `redCBS = c.pRedCBS ?? 0`; **`regraGeral = !!p.regraGeral || p.cstReforma === '000'`**; **`quantidade = Number(p.quantidade) || 1`**; `valorUnitario = Number(p.valorUnitario) || 0`.

**R7.2** — `adicionarItemCalculadoraDeClassificacao(cl)` (l.1147) — origem `'classificacao'` (vindo dos cards da Consulta NCM):
`produtoId:null`, `codigo:''`, `nome: cl.descricao || (cl.codigoFormatado || 'Item')`, `regraGeral = !!cl._isRegraGeral`, **`quantidade:1`**, **`valorUnitario:0`**.

**R7.3** — Modal "NCM manual" (`btnCalcCustomAdd`, l.1202) — origem `'manual'`:
valida `state.calcCustomClass` (senão warn `'Informe um NCM válido.'`); `qtd = parseQtd($('#ccQtd').value) || 1`; `valor = parseMoeda($('#ccValor').value)`; `nome = cl.descricao || 'Item manual'`; fecha o modal e toast `'Item adicionado à calculadora.'`.

**R7.4** — Busca na calculadora (`bindCalcBusca`, l.1169–1188), debounce **180 ms**:
- produtos: `state.produtosCache.filter(p => !q || \`${codigo} ${nome} ${ncm}\`.toLowerCase().includes(qLower)).slice(0,8)`;
- nomenclatura: se `norm(q).length >= 2` → `sugerirNomenclatura(digits).slice(0,5)`;
- sem resultados → mensagem única; com resultados → seção fixa "Produtos salvos" e depois seção "NCM direto";
- clicar em produto → `adicionarProdutoCalculadora`; clicar em NCM → `abrirModalCalcCustomComNcm(codigo)`.

## 7.3 Edição de quantidade/valor

**R7.5** — Debounce de **350 ms** (`onEdit`, l.1162): atualiza `it.quantidade = parseQtd(t.value)` ou `it.valorUnitario = parseMoeda(t.value)` e re-renderiza a lista inteira (`renderCalcItens()`), o que **substitui os inputs** (perda de foco do campo em edição).
**R7.6** — Remoção por `data-calc-remove` filtra `state.calcItens` por `uid`.
**R7.7** — "🗑 Limpar" exige `confirm('Limpar todos os itens da calculadora?')`; se a lista já estiver vazia, retorna sem confirmação.

## 7.4 Resumo (`atualizarResumoCalc`, l.1154–1159)

```
base = Σ (qtd||0)*(valorUnit||0)
ibs  = Σ calcularTributos(...).vIBS
cbs  = Σ ...vCBS
trib = ibs + cbs
total = base + trib
carga = base>0 ? (trib/base)*100 : 0
```
Campos: `#rsItens` (contador), `#rsBase`, `#rsIBS`, `#rsCBS`, `#rsTrib`, `#rsTotal` (moeda pt-BR), `#rsCarga` = `carga.toFixed(2).replace('.',',') + '%'`.
`#calcResumoSub` = `` `${n} ${n===1?'item':'itens'} · Carga efetiva ${carga2}%` `` ou `'—'`.

**R7.8** — Item rendering (l.1151): por item mostra `#i`, NCM formatado, pill "regra geral" (se `it.regraGeral`), nome, `CST x · y · descClass`, campos Qtd (`data-mask="qtd"`, valor `fmtNum`) e Valor unit. (`data-mask="moeda"`, valor `MASK.moeda(String(Math.round(v*100)))`), box `Red. IBS / CBS`, box `Base`, e faixa IBS/CBS/Total com alíquotas efetivas `c.aliqIBS.toFixed(2)`/`c.aliqCBS.toFixed(2)`.

## 7.5 "Salvar no produto" (`bindCalcSalvar`, l.1204–1213)

**R7.9** — Validação: `!state.calcItens.length` → warn `'Adicione itens antes de salvar.'`.
**R7.10** — Divide em `comProd` (`produtoId` truthy) e `semProd`.
**R7.11** — `comProd`: para cada item, `dbGet(produtos, produtoId)`; se existir, sobrescreve **apenas** `quantidade`, `valorUnitario` e `atualizadoEm` e `dbPut` → `atualizados++`.
**R7.12** — `semProd`: se `confirm('Cadastrar os N item(ns) manuais como produtos?')`, para cada item faz **dois `prompt`**:
- `` prompt(`SKU para o item NCM ${fmtNcm(it.ncm)}:`, '') `` — vazio/cancelar → pula;
- `prompt('Nome do produto:', it.nome || '')` — vazio/cancelar → pula;
grava com `cfop:'' , cstIcms:'', pis:'', cofins:''`, `quantidade/valorUnitario` do item, `cstReforma/cClassTrib/regraGeral` do item e `classificacaoSnapshot` montado `{codigo: it.ncm, codigoFormatado: fmtNcm(it.ncm), cst, cClassTrib, descricao: it.nome, baseLegal: it.baseLegal, pRedIBS: it.redIBS, pRedCBS: it.redCBS, anexo: null, classificacao: it.descClass}`.
**R7.13** — Toast `` `${atualizados} atualizado(s)` `` + `` ` · ${criados} criado(s)` ``.

## 7.6 Simulador rápido embutido (`htmlCalculadoraIBS`, l.972–973)

**R7.14** — Card com input `data-mask="moeda"`; os valores são recalculados **em `input` global** na página. O `data-uid` do card define a fonte de redução: se `uid` começa com `'class-'`, procura `state.ncmResultados.find(x => x.__uid === uid)` e usa `resumo.percentualReducaoIBS/CBS`; caso contrário (`'default'`, card da regra geral) usa **0**. Sem digitação, exibe `carga = state.rateIBS + state.rateCBS`.

---

# 8. PRODUTOS / EMPRESAS / EMITENTE

## 8.1 Sessão da empresa ativa

**R8.1** — `carregarSessao()` (l.819): `id = Number(localStorage[SESSION_KEY])`; `0`/`null` → `null`; senão `dbGet(EMPRESAS, id)`; se não existir → remove a chave e `empresaAtiva = null`.
**R8.2** — `definirEmpresa(id)` (l.820): busca; se `null` **retorna sem fazer nada**; senão grava `localStorage[SESSION_KEY] = id` e `atualizarSessaoUI()`.
**R8.3** — `logout()` (l.821): zera `empresaAtiva`, remove a chave, `atualizarSessaoUI()`, toast warn `'Empresa ativa removida.'`, `carregarProdutos()`.
**R8.4** — `atualizarSessaoUI()` (l.822–827):
- com empresa → chip no header (razão social + CNPJ ou `'sem CNPJ'` + botão ✕ `App.logout()`), `#empresaProdutosNome` = razão social, **esconde** o banner `#empresaSugestao` e o aviso `#avisoEmpresa`;
- sem empresa → chip oculto, `#empresaProdutosNome = 'Todas / sem empresa'`, banner visível **a menos que** `sessionStorage.banner_dismissed === '1'`, aviso `#avisoEmpresa` visível.

## 8.2 CRUD de empresas

**R8.5** — `salvarEmpresa()` (l.905–908): valida `razaoSocial` (warn `'Informe a razão social.'`); grava `{razaoSocial, cnpj (com máscara), fantasia, criadoEm}`; limpa campos; toast `'Empresa cadastrada.'`; **se não havia empresa ativa**, refaz `dbGetAll` e seleciona o **primeiro** registro com `razaoSocial===razao && cnpj===cnpj`.
**R8.6** — `renderEmpresas()` (l.899–904): `dbGetAll` + **sort por `razaoSocial.localeCompare(...,'pt-BR')`**; filtro de texto sobre `` `${razaoSocial} ${cnpj||''} ${fantasia||''}` ``; empresa ativa ganha pill `ATIVA` e botão "✓ Em uso", demais ganham "Selecionar"; todas ganham 🗑.
**R8.7** — Exclusão: `confirm('Excluir esta empresa?')` → `dbDelete`; se era a ativa → zera `empresaAtiva`, remove chave e `atualizarSessaoUI()`. **Produtos não são excluídos nem desvinculados** (ficam órfãos com `empresaId` antigo).
**R8.8** — Importação em lote de empresas (`importarEmpresasLote`, l.911–925): XLSX (primeira sheet); `rows.length < 2` → `'Arquivo vazio ou sem dados.'`; colunas por regex:
- razão: `/^(razaosocial|razao|nome|nomeempresa|empresa|clientes)$/` → obrigatória (`'Coluna "Razão Social" não encontrada.'`);
- cnpj: `/^(cnpj|numerocnpj|cnpjempresa)$/` (aplicado `fmtCnpj`);
- fantasia: `/^(nomefantasia|fantasia|apelido|nomecomercial)$/;
linhas sem razão são puladas; vazio → `'Nenhuma empresa válida encontrada.'`; `confirm('Importar N empresa(s) em lote?')`; `dbBulkPut`.
**R8.9** — Modelo CSV de empresas: `Razão Social;CNPJ;Nome Fantasia` + `Empresa Exemplo Ltda;12345678000190;Exemplo` → `modelo_empresas.csv`.

## 8.3 Snapshot de classificação no produto

**R8.10** — `produtoCompleto(p)` (l.1096) deriva para a UI: `redIBS = snapshot.pRedIBS ?? 0`, `redCBS = snapshot.pRedCBS ?? 0`, `descClass = snapshot.classificacao || p.baseLegal || '—'`, `_empresaNome = empresasMap.get(empresaId)?.razaoSocial || 'Empresa #id'` (ou `null`).
**R8.11** — `carregarProdutos()` (l.1090–1095): com empresa ativa → `dbIndex('produtos','empresaId', id)`; sem → `dbGetAll` **e** carrega `state.empresasMap`; ordena por `codigo.localeCompare(...,'pt-BR')`; atualiza `#contadorProdutos`; chama `renderProdutos()`.
**R8.12** — Edição (l.1112): preenche o formulário, marca `state.produtoEditandoId`, `carregarClassificacoesForm()`, depois `findIndex(n => n.cClassTrib === p.cClassTrib && n.cst === p.cstReforma)`; se `idx >= 0` seleciona e re-renderiza; troca para a view `classificar`.

## 8.4 Exportações

**R8.13** — **CSV** (`cabecalhoExport`, l.1118), colunas na ordem exata (16):
`SKU; Nome; NCM; CFOP; CST ICMS; PIS; COFINS; Qtd; Valor Unitário; Total; CST Reforma; cClassTrib; Classificação Reforma; Red. IBS (%); Red. CBS (%); Anexo`
- `NCM` formatado (`fmtNcm`), `Valor Unitário` e `Total` com `.toFixed(2)`, `Red.*` = `snapshot.pRedIBS ?? ''`, `Anexo` = `snapshot.anexo || ''`;
- escape: valor com `[";\n\r]` vai entre aspas com `"` duplicado; separador `;`, linhas `\r\n`, BOM `\uFEFF`;
- fonte: **`state.produtosCache` inteiro** (ignora o filtro de texto da UI);
- nome: `` `produtos_${razao.replace(/\W+/g,'_') || 'todas'}_YYYY-MM-DD.csv` ``;
- sem registros → toast warn `'Nenhum produto para exportar.'`.

**R8.14** — **JSON** (l.1122): payload `{empresa: state.empresaAtiva || null, exportadoEm: ISO, produtos: state.produtosCache}`; nome `produtos_<suf>.json` (sem data).

**R8.15** — **PDF** (`exportarPDF`, l.1125–1144), retrato A4:
- emitente: `state.emitente || await carregarEmitente() || {}`; cor de destaque `hexToRgb(cor || '#0f215c')`;
- logo: `addImage(png)` → fallback `JPEG` → fallback `drawDefaultLogo` (retângulo arredondado com "Au" e "NCM");
- cabeçalho: razão social (default `'Aurum Bit Labs & Studios LTDA'`), linhas `CNPJ … · IE …`, `endereço · cidade · cep`, `telefone · email · site`;
- título `Relatório de Classificação Tributária`, subtítulo `[empresa, CNPJ, 'Gerado em <dd/mm/aa hh:mm>']` unidos por `'   ·   '`;
- faixa de resumo: `ITENS`, `VALOR TOTAL`, `CARGA MÉDIA IBS+CBS` (`cargaMedia = ΣIBS+CBS / ΣvalorTotal`);
- tabela (10 colunas): `SKU | Produto | NCM | Trib. anterior | CST | cClassTrib | Classificação | Qtd | Vlr. un. | Total`;
- `Trib. anterior` = `CFOP x\nCST y\nPIS z\nCOFINS w` filtrado, senão `'—'`; `Classificação` truncada em **140** chars;
- `columnStyles`: 0:15px bold, 1:35px, 2:16px bold center, 3:20px fs5.8 cinza, 4:8px center bold, 5:13px center bold, 6:37px, 7:10px right, 8:16px right, 9:16px right bold;
- especial: célula de CST igual a `'000'` ganha cor `[180,83,9]`;
- rodapé: `emitente.rodape || (razaoSocial || 'Aurum Tax NCM')` + `Página X de Y`;
- nome: `` `classificacao_${suf}_YYYY-MM-DD.pdf` ``.

## 8.5 Emitente e logo

**R8.16** — `handleLogoFile` (l.792): rejeita se `!file.type.startsWith('image/')` → warn `'Envie um arquivo de imagem.'`; rejeita se `file.size > 3*1024*1024` (3 MB) → warn `'Imagem muito grande (máx. 3 MB).'`; lê como DataURL e chama `maybeResizeImage(dataUrl, 600)`.
**R8.17** — `maybeResizeImage(dataUrl, maxSide=600)` (l.793):
- só processa `^data:image\/(png|jpe?g|webp|gif)`; senão devolve original;
- `ratio = Math.min(1, 600 / max(w,h))`;
- **se `ratio >= 1 && dataUrl.length < 300000`** → devolve o original (sem re-encoding);
- senão redimensiona para `round(w*ratio) × round(h*ratio)` em canvas e exporta `image/png`; se `toDataURL` lançar → devolve original;
- erro de `img.onload` → devolve original.
**R8.18** — `salvarEmitente()` (l.791) grava `{chave:'emitente', valor:{...11 campos com trim, cor default '#0f215c'}, atualizadoEm}`. `cor` sincroniza entre `<input type=color>` e o campo hex (aceita `#` opcional e valida `/^#[0-9a-fA-F]{6}$/`).
**R8.19** — Limpar emitente exige `confirm('Limpar dados do emitente?')` e **não persiste** até "Salvar emitente".

---

# 9. TABELAS AUXILIARES

## 9.1 `AUX_META` (l.1818–1826)

| tipo | store | keyPath | title | singular | máscaras dos campos |
|---|---|---|---|---|---|
| `cst` | `cst` | `codigo` | `CST IBS/CBS` | `CST IBS/CBS` | `codigo` → `mask:'cst'` |
| `cstct` | `cstClassTrib` | `id` | `cClassTrib` | `cClassTrib` | `cst` → `mask:'cst'`; `cClassTrib` → `maxLength:6` |
| `ncmnomen` | `ncmNomenclatura` | `codigo` | `Nomenclatura NCM` | `NCM` | `codigo` → `mask:'ncm'` |
| `ncm` | `ncm` | `id` | `NCM × Classificação` | `Vínculo NCM` | `codigo` → `mask:'ncm'`; `cst` → `mask:'cst'`; `cClassTrib` → `maxLength:6` |
| `cfop` | `cfop` | `codigo` | `CFOP` | `CFOP` | `codigo` → `mask:'cfop'` |
| `csticms` | `cstIcms` | `codigo` | `CST ICMS` | `CST ICMS` | `codigo` → `mask:'cst'` |
| `cstpiscofins` | `cstPisCofins` | `codigo` | `CST PIS/COFINS` | `CST PIS/COFINS` | `codigo` → `mask:'cstPis'` |

### Campos (nome, label, tipo, flags)

**`cst`** (7 + bloco docs):
| name | label | type | flags |
|---|---|---|---|
| `codigo` | Código CST (3 dígitos) | text | `mask:'cst'`, `required`, `mono`, `readOnlyOnEdit` |
| `descricao` | Descrição | textarea | `required` |
| `ind_gIBSCBS` | Tributação integral | boolean | |
| `ind_gIBSCBSMono` | Monofásica | boolean | |
| `ind_gRed` | Redução de alíquota | boolean | |
| `ind_gDif` | Diferimento | boolean | |
| `ind_gTransfCred` | Transferência de crédito | boolean | |
+ **Documentos habilitados**: checkboxes `NFe, NFCe, CTe, CTeOS, BPe, BPeTM, NF3e, NFCom, NFSe` → `'Sim'|'Não'`.

**`cstct`**: `cst` (text, mask cst, required), `cClassTrib` (text, required, maxLength 6), `nome` (text, required), `tipoAliquota` (text), `pRedIBS` (number), `pRedCBS` (number), `descricao` (textarea), `lcRef` (text), `lcRedacao` (textarea).

**`ncmnomen`**: `codigo` (text, mask ncm, required, readOnlyOnEdit), `descricao` (textarea, required, colSpan 2), `dataInicio` (text), `dataFim` (text), `ato` (text).

**`ncm`**: `codigo` (text, mask ncm, required), `cst` (text, mask cst, required), `cClassTrib` (text, required, maxLength 6), `baseLegal` (text), `descricao` (textarea), `aliquotaIBS` (number), `aliquotaCBS` (number).

**`cfop`**: `codigo` (text, mask cfop, required, readOnlyOnEdit), `tipo` (**select**, options `['Entrada','Saída','Outros']`, required), `descricao` (textarea, required).

**`csticms`**: `codigo` (text, mask cst, required, readOnlyOnEdit), `descricao` (textarea, required).

**`cstpiscofins`**: `codigo` (text, mask cstPis, required, readOnlyOnEdit), `descricao` (textarea, required).

## 9.2 Abertura e gravação

**R9.1** — `abrirAuxEdit(tipo, chaveOriginal)` (l.1830–1848): `isEdit = chaveOriginal != null`; carrega via `dbGet`; normaliza id ausente:
- keyPath `'id'` → `` `${String(cst||'').padStart(3,'0')}|${String(cClassTrib||'').padStart(6,'0')}` ``;
- tipo `ncm` → `` `${norm(codigo)}|${cClassTrib||''}|${uid()}` ``;
- tipo `cst` → `dado.docs = dado.docs || {}`.
`readOnlyOnEdit` aplica `readonly` quando `state.auxEdit.chaveOriginal != null`. Botão Excluir só em edição.

**R9.2** — `salvarAuxEdit()` (l.1863–1895), ordem exata:
1. Coleta campos: `boolean` → `1|0`; `number` → `null` se vazio, senão `Number`; demais → `el.value`;
2. Normaliza código: `norm(dados.codigo)` para `ncmnomen`, `ncm` e `cfop`;
3. **`if (dados.cst) dados.cst = String(dados.cst).replace(/\D/g,'').padStart(3,'0')`**;
4. **Validação de obrigatórios**: para cada campo `required`, se `null`/vazio → toast warn `` `Campo "<label>" é obrigatório.` `` e **aborta**;
5. tipo `cst` → `dados.docs` a partir dos checkboxes (`'Sim'|'Não'`);
6. keyPath `'id'`:
   - `cstct` → `cstP = padStart(3)`, `ctP = padStart(6)`, grava `dados.cst/dados.cClassTrib` **padded** e `dados.id = \`${cstP}|${ctP}\``;
   - `ncm` → `dados.id = dados.id || \`${norm(codigo)}|${cClassTrib||''}|${uid()}\``;
7. **Duplicidade**: `if (!isEdit && meta.keyPath === 'codigo' && dados.codigo)` → `dbGet`; se existir → toast warn `'Já existe um registro com este código.'` e **aborta**. **Não há checagem para keyPath `'id'`** (ver [BUG] L1879);
8. Troca de chave: se edição e a chave mudou → `dbDelete(chaveOriginal)` antes do `put`;
9. `dbPut` → toast `'Registro atualizado.'` / `'Registro criado.'`, fecha modal, **invalida o cache correspondente** (`state.<tipo>Cache = []`) e chama `renderAuxiliares()`, `atualizarStatusBase()`, `carregarSelectsAuxiliares()`. Erro → `'Erro: '+e.message`.

**R9.3** — Exclusão pela linha da tabela (l.2038–2045): `confirm('Excluir este registro de <title>?')` → `dbDelete(meta.store, key)` → toast warn `'Registro excluído.'` → invalida cache + re-render. Idem em `confirmarDeleteAux()` (l.1896–1914).

**R9.4** — Quick-add (`data-quick-add`) nos selects do formulário: `state.auxEdit.quickTarget = 'cfop'|'csticms'|'cstpiscofins'` e abre o modal. O valor digitado **não** é propagado de volta ao select automaticamente.

**R9.5** — Selects auxiliares (`carregarSelectsAuxiliares`, l.1916–1927): carrega CFOP/CST ICMS/CST PIS-COFINS, **ordena por `codigo.localeCompare`**, monta `<option value="codigo">codigo — descricao.slice(0,60)</option>`, prefixa `<option value="">— selecione —</option>` em `#prodCfop, #scCfop, #prodCstIcms, #scCstIcms, #prodPis, #prodCofins, #scPis, #scCofins`, preservando o valor atual se houver.

## 9.3 Seeds

**R9.6** — `seedTabelasAuxiliares()` (l.777–785): sai se `meta('seed_v2_done').valor`; caso contrário conta cada store e grava **somente as vazias**; por fim grava `{chave:'seed_v2_done', valor:true, quando}`.

### `SEED_CFOP` — 24 registros (l.768)

| Código | Tipo | Descrição |
|---|---|---|
| 1101 | Entrada | Compra para industrialização ou produção rural |
| 1102 | Entrada | Compra para comercialização |
| 1551 | Entrada | Compra de bem para o ativo imobilizado |
| 1949 | Entrada | Outra entrada de mercadoria ou prestação de serviço não especificada |
| 2101 | Entrada | Compra para industrialização ou produção rural (interestadual) |
| 2102 | Entrada | Compra para comercialização (interestadual) |
| 5101 | Saída | Venda de produção do estabelecimento |
| 5102 | Saída | Venda de mercadoria adquirida ou recebida de terceiros |
| 5103 | Saída | Venda de produção do estabelecimento, efetuada fora do estabelecimento |
| 5104 | Saída | Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento |
| 5105 | Saída | Venda de produção do estabelecimento que não deva por ele transitar |
| 5106 | Saída | Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar |
| 5405 | Saída | Venda de mercadoria adquirida ou recebida de terceiros, em operação sujeita a ST |
| 5910 | Saída | Remessa em bonificação, doação ou brinde |
| 5915 | Saída | Remessa para conserto ou reparo |
| 5916 | Saída | Retorno de mercadoria recebida para conserto ou reparo |
| 5917 | Saída | Remessa para demonstração |
| 5949 | Saída | Outra saída de mercadoria ou prestação de serviço não especificado |
| 6101 | Saída | Venda de produção do estabelecimento (interestadual) |
| 6102 | Saída | Venda de mercadoria adquirida ou recebida de terceiros (interestadual) |
| 6107 | Saída | Venda de produção do estabelecimento, destinada a não contribuinte |
| 6108 | Saída | Venda de mercadoria a não contribuinte (interestadual) — *literal: "Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte"* |
| 7101 | Saída | Venda de produção do estabelecimento (exterior) |
| 7102 | Saída | Venda de mercadoria adquirida ou recebida de terceiros (exterior) |

*Obs.: a ordem de gravação preserva o array original (1949 é o último elemento).*

### `SEED_CST_ICMS` — 21 registros (l.770–772)

`000` Tributada integralmente · `010` Tributada e com cobrança do ICMS por substituição tributária · `020` Com redução de base de cálculo · `030` Isenta ou não tributada e com cobrança do ICMS por ST · `040` Isenta · `041` Não tributada · `050` Suspensão · `051` Diferimento · `060` ICMS cobrado anteriormente por substituição tributária · `070` Com redução de base de cálculo e cobrança do ICMS por ST · `090` Outros · `101` Tributada com permissão de crédito (Simples Nacional) · `102` Tributada sem permissão de crédito (Simples Nacional) · `103` Isenção do ICMS para faixa de receita bruta (Simples Nacional) · `201` Tributada com permissão de crédito e com cobrança do ICMS por ST (Simples) · `202` Tributada sem permissão de crédito e com cobrança do ICMS por ST (Simples) · `203` Isenção do ICMS para faixa de receita bruta e com cobrança do ICMS por ST (Simples) · `300` Imune · `400` Não tributada pelo Simples Nacional · `500` ICMS cobrado anteriormente por ST ou por antecipação (Simples) · `900` Outros

### `SEED_CST_PISCOFINS` — 11 registros (l.773–775)

`01` Operação Tributável com Alíquota Básica · `02` Operação Tributável com Alíquota Diferenciada · `03` Operação Tributável com Alíquota por Unidade de Medida de Produto · `04` Operação Tributável Monofásica - Revenda a Alíquota Zero · `05` Operação Tributável por Substituição Tributária · `06` Operação Tributável a Alíquota Zero · `07` Operação Isenta da Contribuição · `08` Operação Sem Incidência da Contribuição · `09` Operação com Suspensão da Contribuição · `49` Outras Operações de Saída · `99` Outras Operações

## 9.4 Renderização e paginação

**R9.7** — `PAGE_SIZE = 10`; objeto `pag` (l.664): `{produtos, cst, cstct, nomen, ncm, cfop, csticms, cstpiscofins} = PAGE_SIZE` e `sugestoes = 15`.
**R9.8** — "⬇ Carregar mais (X de Y)" é renderizado por `btnMais(id, visivel, total)` em **`cst`, `cstct`, `ncm`, `cfop`, `csticms`, `cstpiscofins`** (e em `produtos` com texto "Carregar mais (exibindo X de Y)"), **nunca em `nomen`** (ver [BUG] L2019).
**R9.9** — Todos os filtros usam debounce **150 ms** e resetam a página correspondente para `PAGE_SIZE`. Filtro de produtos usa **180 ms**.
**R9.10** — `renderNomen()` (l.1959–1987): sem filtro → acordeão por capítulo (`CAPITULOS_NCM`), ordenação de capítulos `sort()` lexicográfico, NCMs do capítulo ordenados por `codigo.localeCompare`, **`slice(0, 50)`** com rodapé `Exibindo 50 de N NCMs.`, expansão persistida em `state.capitulosExpandidos` (Set). Com filtro → agrupa todos os resultados por capítulo (sem limite de 50) com busca inline (`buscaNomenInline`, debounce 200 ms).
**R9.11** — Filtros por tabela:
| Tabela | Campos comparados |
|---|---|
| CST | `codigo.includes(f)` (sem lower no código), `descricao.toLowerCase().includes` |
| cClassTrib | `cClassTrib`, `cst`, `nome`, `descricao` (lower) |
| NCM vínculo | `codigo` sem pontos, `cst`, `cClassTrib`, `descricao` |
| CFOP | `codigo`, `descricao`, `tipo` |
| CST ICMS / PIS-COFINS | `codigo`, `descricao` |

---

# 10. UI/UX

## 10.1 Navegação — 7 views

| `data-view` | Título (`#pageTitle`) | Subtítulo (`#pageSubtitle`) | Render ao ativar |
|---|---|---|---|
| `calculadora` | Calculadora Tributária | Simule IBS/CBS com base nas regras cadastradas | `renderCalcItens()` |
| `consulta` | Consulta NCM | Busque por NCM e veja todas as classificações da Reforma | `renderSugestoesIniciais()` |
| `classificar` | Classificação individual | Cadastre um produto escolhendo a classificação tributária | — |
| `lote` | Classificação em lote | Envie CSV ou Excel para classificar vários produtos | — |
| `sped` | SPED Fiscal | Importe o arquivo SPED e analise a tributação por produto | `renderSpedView()` (vazio) |
| `produtos` | Produtos cadastrados | Gerencie, filtre e exporte seus produtos | `renderProdutos()` |
| `auxiliares` | Tabelas auxiliares | Edite CST, cClassTrib, NCM, CFOP e demais tabelas | `renderAuxiliares()` |

**R10.1** — `trocarView` alterna `hidden` nas `section.view`, marca `data-active` nos `.side-btn`, atualiza título, executa o render específico, fecha a sidebar e faz `scrollTo({top:0, behavior:'smooth'})`. View inicial: **`calculadora`** (após `init`).

## 10.2 Modais

| id | Uso | Abertura |
|---|---|---|
| `modalEmpresas` | CRUD + importação de empresas | botão 🏢 Empresas / banner |
| `modalAuxEdit` | edição de registro auxiliar | `data-add-aux` / `data-quick-add` / `data-aux-edit` |
| `modalConfig` | emitente, status da base, importar JSON, backup/restaurar, apagar base | botão ⚙ |
| `modalSalvarClass` | salvar classificação da consulta como produto | `data-salvar-class` |
| `modalCalcCustom` | item manual por NCM | `btnCalcCustom` / sugestão "NCM direto" |
| `modalPreviewEmitente` | pré-visualização do timbrado (210mm × 297mm) | `btnPreviewEmitente` |
| `modalDetalheProduto` | detalhe do item do SPED (`overlay.open`) | clique na linha/botão 🔍 do SPED |

**R10.2** — `openModal(id)` remove `hidden` e adiciona `flex`; `closeModal` faz o inverso. O modal de detalhe SPED fecha clicando no backdrop (`e.target === overlay`).

**R10.3** — Teclado: `Enter` em `#scCodigo/#scNome/#scQtd/#scValor` dispara `salvarProdutoDoModal`; `Enter` em `#buscaNcm` dispara a consulta; setas `↑/↓` naveram as sugestões do NCM no formulário, `Enter` escolhe, `Escape` fecha.

## 10.3 Toasts (l.680–688)

| tipo | borda | ícone |
|---|---|---|
| `'ok'` | `border-l-emerald-500` | `✓` |
| `'err'` | `border-l-red-500` | `✕` |
| `'warn'` | `border-l-amber-500` | `⚠` |
| `''` (default) | `border-l-brand-500` | `ℹ` |

**R10.4** — Vida útil: **3400 ms** → fade/slide de 300 ms → remoção. Container `#toastWrap` (canto inferior direito, `z-[100]`).

## 10.4 Máscaras (`MASK`, l.690–698) e parsers

| Chave | Regra exata |
|---|---|
| `ncm` | `norm(v).slice(0,8)`; ≤4 → cru; ≤6 → `AAAA.BB`; senão `AAAA.BB.CC` |
| `cnpj` | `fmtCnpj` (ver abaixo) |
| `cfop` | `norm(v).slice(0,4)` |
| `cst` | `norm(v).slice(0,3)` |
| `cstPis` | `norm(v).slice(0,2)` |
| `qtd` | remove `[^\d,.]`, troca `.`→`,`, divide por `,`; se >1 vírgula → `partes[0] + ',' + partes.slice(1).join('').slice(0,3)`; senão `partes[0] + (,' + parte1.slice(0,3))` |
| `moeda` | dígitos `String(v).replace(/\D/g,'').slice(0,15)`; vazio → `''`; senão `'R$ ' + (d/100).toLocaleString('pt-BR',{min/max fraction 2})` |

`fmtCnpj(v)` (l.671): `d = norm(v).slice(0,14)`; `≤2` cru; `≤5` `AA.`; `≤8` `AA.BBB`; `≤12` `AA.BBB.CCC/DD`; senão `AA.BBB.CCC/DDDD-EE`.

| Parser | Regra |
|---|---|
| `parseMoeda(v)` | `String(v\|\|'').replace(/\D/g,'')`; se não vazio → `Number(d)/100`, senão `0` |
| `parseQtd(v)` | `String(v\|\|'').replace(/\./g,'').replace(',','.')`; `Number(s) \|\| 0` |

**R10.5** — Aplicação automática: listener global de `input` (l.702–713) em qualquer elemento com `data-mask`; compensa a posição do cursor com `delta = after - before` e `setSelectionRange(pos+delta, pos+delta)`.

**R10.6** — Formatações de leitura: `norm` = remove não-dígitos (`/\D+/g`); `fmtNcm` = `AAAA.BB.CC` só se 8 dígitos; `fmtMoeda` = BRL pt-BR; `fmtNum` = `maximumFractionDigits:3`; `fmtPct` = `null`→`'—'`, senão `pt-BR` com `maximumFractionDigits:2` + `'%'`.
**R10.7** — `esc(v)` escapa `& < > " '` para entidades HTML.
**R10.8** — `debounce(fn, ms=220)`; `clamp(n, mn, mx)`; `hexToRgb` aceita `#rgb`/`#rrggbb` com `padEnd(6,'0')`.

## 10.5 Tema (l.2064–2075)

**R10.9** — Inicial: `localStorage['tema']` senão `matchMedia('(prefers-color-scheme: dark)')`. Toggle adiciona/remove a classe `dark` em `<html>`, persiste `dark|light` e alterna ícone `☀` / `◐`. Tailwind configurado com `darkMode:'class'`.

## 10.6 Backup / restauração

**R10.10** — Backup (l.2056) exporta `{exportadoEm, ncm, cst, cstClassTrib, nomenclatura, empresas, produtos, emitente, cfop, cstIcms, cstPisCofins}` → `backup_aurum_tax_YYYY-MM-DD.json`.
**R10.11** — Restauração (l.2058–2060): `confirm('Substituir TODA a base atual pelo backup?')`; limpa as 9 stores (não limpa `meta`, além do próprio emitente); regrava cada array **apenas se `.length`**; `emitente` volta para `meta`; invalida todos os caches, `carregarSessao()`, `atualizarSessaoUI()`, status, auxiliares, produtos, emitente e selects.
**R10.12** — "Apagar base importada" (l.2061): `confirm('Apagar a base importada (NCM, CST, cClassTrib, Nomenclatura)? Empresas, produtos, CFOP, CST ICMS e PIS/COFINS serão mantidos.')` → `dbClear` apenas de `ncm`, `cst`, `cstClassTrib`, `ncmNomenclatura`.

---

# 11. DIFERENCIAIS / PECULIARIDADES A PRESERVAR

| # | Diferencial |
|---|---|
| **D01** | **Somente saídas do SPED são analisadas.** Itens de entrada são contabilizados (`stats.itensEntrada`) e **descartados** (ICMS l.1344; Contribuições l.1425); notas de entrada entram em `stats.notasEntrada` e `notasEntrada[]` mas nunca em `itens`. |
| **D02** | **"Modo resumo"**: se não há itens detalhados mas há C190 de saída, agrupa por `cstIcms\|cfop`, estima tudo pela regra geral com redução 0 e proíbe salvar produtos individuais (botão escondido + dupla validação). |
| **D03** | **Banner de escopo** fixo na análise SPED: "⚠️ Esta análise considera apenas as operações de SAÍDA do SPED. As entradas foram descartadas automaticamente. Os valores são estimativas." |
| **D04** | **Aviso Art. 137 ("in natura")** aparece **apenas** no card de tributação integral (NCM sem classificação), nunca nos cards de classificação específica. |
| **D05** | **Detecção automática de tipo** de SPED com recusa explícita (Reinf/e-Social/ECD/ECF) e mensagem de erro rica com lista do que é aceito. |
| **D06** | **Fallback de regra geral em 2 níveis**: primeiro tenta `cst '000'` + `cstClassTrib '000\|000001'` do banco; se ausente, usa os objetos literal de `buscarRegraGeralDetalhes()`. |
| **D07** | **Toda classificação escolhida é congelada em `classificacaoSnapshot`** no produto — as edições posteriores da base não alteram produtos já salvos. |
| **D08** | **`anexo` só é derivado no SPED**; na consulta/auxiliares ele vem do JSON importado (`resumo.anexo` ou `referencia['Número do Anexo']`). |
| **D09** | **Regra geral marcada com pill âmbar "regra geral"** nos itens da calculadora, no modal de salvar e no card de tributação integral. |
| **D10** | **Itens da calculadora têm `redIBS/redCBS` congelados** na adição (não reagem a reimportação da base). |
| **D11** | **Somente a primeira classificação é usada** nos fluxos automáticos (lote e SPED); a escolha manual só existe na tela de Classificação e no select do lote. |
| **D12** | **`produtosCache` é recortado por empresa ativa**; sem empresa ativa mostra coluna "Empresa" e o produto sem empresa aparece como *— sem empresa —*. |
| **D13** | **Exportações ignoram o filtro de texto** da tela (exportam o cache inteiro da empresa ativa). |
| **D14** | **Ordem do acordeão de Nomenclatura é alfabética por capítulo** (`sort()` de string), não numérica. |
| **D15** | **`XLSX.read` é usado inclusive para `.csv`/`.txt`** no lote e na importação de empresas (SheetJS detecta o delimitador). |
| **D16** | **Cabeçalhos de lote normalizados removendo acentos e não-alfanuméricos** (`NFD` + `\W+`). |
| **D17** | **`valorUnitario` do SPED = `vlItem / qtd`** (não `vlItem`); se `qtd = 0` → `valorUnitario = 0`. |
| **D18** | **`regraGeral` do produto também é inferido por `cstReforma === '000'`** apenas na calculadora (D11/R7.1). |
| **D19** | **Rodapé/logo/cor do PDF vêm do Emitente**, com defaults `Aurum Bit Labs & Studios LTDA` / `Aurum Tax NCM` / `#0f215c`. |
| **D20** | **Limites de renderização**: tabela SPED 200 linhas, lote 200 linhas, alíquota zero 50 linhas, top produtos 15, nomenclatura 50/capítulo, sugestões 15 (consulta) / 20 (form) / 30 (busca) / 8+5 (calculadora). |
| **D21** | **Modal de detalhe do SPED guarda o item atual em `window._spedProdutoAtual`** e só oferece "💾 Salvar produto" quando `!r._isResumo`. |
| **D22** | **A primeira empresa cadastrada é automaticamente ativada** se não havia empresa ativa. |
| **D23** | **Banner "modo visualização"** (`#empresaSugestao`) pode ser dispensado por sessão (`sessionStorage.banner_dismissed = '1'`). |
| **D24** | **Gráficos Chart.js** destruídos e recriados (`window._chartAnexo`, `window._chartTop`) com `setTimeout(...,100)` após o render. |

---

# 12. INCONSISTÊNCIAS E BUGS

> Marcação: `[BUG]` = defeito a corrigir na nova versão · `[⚠]` = inconsistência/risco a decidir.

| # | Linha(s) | Severidade | Descrição |
|---|---|---|---|
| **[BUG] L1061 + L1050/L1059** | 1061, 1050, 1059, 1062 | **Alta** | Ao mudar o radio de classificação com **N > 1** opções, o handler faz `state.ncmEscolhido = ...` e **em seguida chama `carregarClassificacoesForm()`**, que começa com `state.ncmEscolhido = null` e só o restaura quando `lista.length === 1`. Resultado: a seleção é perdida, o badge "✓ escolhida" some e o botão **Salvar produto fica desabilitado**. É impossível salvar um produto com NCM ambíguo. |
| **[BUG] L1879** | 1879 | **Alta** | A checagem de duplicidade (`dbGet` + "Já existe um registro com este código.") só roda para `meta.keyPath === 'codigo'`. Para **`cstClassTrib`** (keyPath `id`, composto `cst\|cClassTrib`), "＋ Novo cClassTrib" com uma combinação já existente **sobrescreve silenciosamente** o registro via `put`. |
| **[BUG] L1237, L1684, L1810, L1026** | 1237, 1684, 1810, 1026 | **Alta** | **Nenhum fluxo de gravação de produto faz upsert por SKU**: todos usam `dbPut` sem `id` sobre store `autoIncrement`. Repetir "Salvar todos como produtos" do lote ou do SPED **duplica todos os registros** (mesmo `codigo` repetido N vezes). |
| **[BUG] L1146** | 1146 | Média | `regraGeral: !!p.regraGeral \|\| p.cstReforma === '000'` — um produto cuja classificação específica tem CST `000` (Tributação integral escolhida deliberadamente) aparece na calculadora com a pill âmbar "regra geral". Além disso `quantidade: Number(p.quantidade)\|\|1` converte **0 em 1**, quebrando a paridade com produtos importados de lote (gravados com `quantidade: 0`). |
| **[BUG] L1560** | 1560 | Média | A tabela "Produtos com Alíquota Zero" filtra `r.redIBS >= 100` mas imprime a coluna Tributos **fixa em "R$ 0,00"**. Se `redCBS < 100`, `totalTributos` é **diferente de zero** — o valor exibido contradiz o resumo. |
| **[BUG] L1296** | 1296 | Média | Detecção de tipo: um arquivo **EFD Contribuições** que contenha apenas `C100/C170` (sem `A100/A170/M100/M200/F100/F170`) cai na regra 6 e é classificado como **`icmsipi`**, sendo parseado pelo parser errado (campos PIS/COFINS ignorados, `tipoDoc`/chaves diferentes). |
| **[BUG] L1435–1436, L1446–1447** | 1435-1436, 1446-1447 | Média | **`A170`/`D170` com posições PIS/COFINS deslocadas em +1** em relação ao layout oficial (`cstPis=9, vlBcPis=10, vlPis=12, cstCofins=13, vlBcCofins=14, vlCofins=16`; oficiais: 8, 9, 11, 12, 13, 15). Consequência: `cstPis` recebe o valor de `vl_bc_pis`, `vlPis` recebe `vl_pis` de COFINS etc. |
| **[BUG] L1416** | 1416 | Média | **`D100` com campos deslocados**: usa `numDoc=campos[7]` (posição de `SER` no layout oficial), `chave=campos[9]`, `dtDoc=campos[10]`, `vlDoc=campos[12]`. Layout oficial: `NUM_DOC=9`, `CHV_NFE=10`, `DT_DOC=11`, `VL_DOC=13`. Notas de transporte ficam com número/chave/data errados. |
| **[BUG] L1443–1448** | 1443-1448 | Média | **`D170` reutiliza o ramo do `A170`**: `qtd=1`, `unid='UN'`, `vlItem=campos[5]`, `vlDesc=campos[6]`. No layout `D170`, `campos[5]` é `QTD` e `campos[6]` é `UNID` — a **base de cálculo vira a quantidade** e `unid` vira a unidade textual errada (`campos[6]` de A170 é `VL_DESC`). |
| **[BUG] L1872 + L858** | 1872, 858 | Média | Em `salvarAuxEdit`, `dados.cst` é normalizado com `padStart(3,'0')`, mas o campo de código da tabela **CST chama-se `codigo`** → não recebe `padStart`. Um CST criado manualmente como `5` não casa com o lookup `dbGet('cst','000')` da regra geral nem com `mapCst` (que grava `005`), além de permitir códigos duplicados (`'5'` vs `'005'`). |
| **[BUG] L2019/L2028** | 2019, 2028 | Baixa | `pag.nomen` é inicializado, resetado no filtro e incrementado no botão "mais", mas **nunca é lido** por `renderNomen()` (que usa `slice(0,50)` por capítulo). O botão "Carregar mais" da Nomenclatura **nunca aparece** — paginação morta. |
| **[BUG] L973** | 973 | Média | O "Simulador rápido" embutido nos cards (consulta, regra geral) usa `state.rateIBS/rateCBS`, que são **globais e editáveis** na Calculadora. Alterar a alíquota de referência muda silenciosamente os valores exibidos na tela de Consulta e, via `calcularTributos`, **os totais dos relatórios PDF/CSV** de produtos e SPED. |
| **[BUG] L1112** | 1112 | Média | Fluxo de edição: se `findIndex(n => n.cClassTrib === p.cClassTrib && n.cst === p.cstReforma)` retornar **-1** (classificação do produto não existe mais na base, ou produto `regraGeral` sem vínculo equivalente), `ncmEscolhido` permanece `null` → botão Salvar desabilitado **sem nenhuma mensagem**, e o campo "classificação escolhida" é perdido. A edição também **não restaura `p.regraGeral`** (regravado como `!!n._isRegraGeral`). |
| **[BUG] L1479** | 1479 | Baixa | O objeto sintético de "NCM inválido" **não tem** `codigo`, `codigoFormatado`, `descricao`, `baseLegal`, `cstDetalhes`, `cstClassTribDetalhes`, `referencia` — campos que `abrirDetalheProdutoSped`, `Sped.exportarCSV/PDF` e `htmlCardClassificacao` acessam com `||`. Funciona por fallback, mas o card de detalhe mostra `—` e o `chipe` de condição não renderiza. |
| **[BUG] L1338 / L1418** | 1338, 1418 | Baixa | Chave de deduplicação das notas de saída: ICMS `` `${numDoc}\|${dtDoc}` `` (sem série nem participante) e Contribuições `` `${tipo}${numDoc}\|${dtDoc}` `` — duas notas de participantes/séries diferentes com mesmo número e data **colidem** e a segunda sobrescreve a primeira no Map (o item `C170` seguinte herda a `notaAtual` errada). |
| **[BUG] L777–785** | 777-785 | Baixa | `seedTabelasAuxiliares` fica destravado pelo META `seed_v2_done`; se o usuário apagar (ou esvaziar) a store CFOP depois da primeira execução, **o seed nunca mais roda**. |
| **[BUG] L908** | 908 | Baixa | Ao cadastrar a primeira empresa, a reativação faz `find(razaoSocial===razao && (cnpj||'')===cnpj)` sobre `dbGetAll` — com empresas duplicadas pré-existentes seleciona a **mais antiga**, não a recém-criada. |
| **[BUG] L1226** | 1226 | Baixa | `norm(row[map.ncm])` sobre célula numérica do Excel perde os zeros à esquerda (`2011000` em vez de `02011000`) → NCM marcado "NCM inválido" **sem diagnóstico** de tipo de coluna. |
| **[⚠] L1482 / L1513** | 1482, 1513 | — | `anexo` e "alíquota zero" derivam **apenas de `redIBS`**; um NCM com `redIBS=100` e `redCBS=60` recebe `anexo='0'` ("Alíquota Zero") embora pague CBS. |
| **[⚠] L1164–1165** | 1164-1165 | — | `state.rateIBS = clamp(Number(e.target.value)\|\|0, 0, 100)` reage a **cada tecla**: apagar o campo zera a alíquota global e recalcula SPED/relatórios imediatamente (sem debounce nem commit em blur). |
| **[⚠] L699–700** | 699-700 | — | `parseQtd` não trata formato anglo-saxão: `"1,234.56"` vira `1.234.56` → `NaN` → `0`. `parseMoeda` ignora totalmente o separador de milhar (`"1.234"` → `12.34`). |
| **[⚠] L1066–1068** | 1066-1068 | — | `blur`, `change` e `input`(debounce 300 ms) podem disparar `carregarClassificacoesForm()` concorrentemente (duas consultas IndexedDB em corrida), re-renderizando o painel duas vezes. |
| **[⚠] L2059** | 2059 | — | Restauração de backup **não limpa nem restaura a store `meta`** (exceto `emitente`): `seed_v2_done`, `importacao` e `importacao_nomenclatura` ficam desatualizados após restaurar outra base. |
| **[⚠] L936** | 936 | — | Excluir uma empresa **não** altera nem exclui os produtos com aquele `empresaId` (ficam órfãos; a coluna Empresa passa a exibir `Empresa #<id>`). |
| **[⚠] L644–650** | 644-650 | — | `OBS_ARTIGOS.art133` e `OBS_ARTIGOS.art139` estão definidos mas **nunca são usados** (`getObservacoesLegais` só referencia `art137`, `art135`, `art128`) — código morto ou observações legais faltando para medicamentos e produções culturais. |
| **[⚠] L1817** | 1817 | — | `renderSpedView()` é um stub ("Reservado"): navegar para a view `sped` **não restaura** uma análise existente se o DOM foi re-renderizado (na prática o HTML persiste, mas não há re-render intencional). |
| **[⚠] L1698** | 1698 | — | "🗑 Limpar análise" zera `state.sped*` mas **não** limpa `window._spedProdutoAtual` nem destrói os gráficos Chart.js (`window._chartAnexo/_chartTop` continuam apontando para canvas removidos). |
| **[⚠] L1102** | 1102 | — | A contagem "exibindo X de Y" do botão **Carregar mais** usa `itens` **já filtrado**, enquanto `#contadorProdutos` mostra o cache **não filtrado** — números divergentes na mesma tela. |

---

## APÊNDICE A — Funções por seção (referência cruzada)

| Função | Linha |
|---|---|
| `esc`, `norm`, `fmtNcm`, `fmtCnpj`, `fmtMoeda`, `fmtNum`, `fmtPct`, `debounce`, `clamp`, `hexToRgb`, `uid` | 668–678 |
| `toast` | 680 |
| `MASK` / `parseMoeda` / `parseQtd` | 690–700 |
| `openDB` / `tx` / `db*` / `dbBulkPut` | 716–765 |
| `SEED_*` / `seedTabelasAuxiliares` | 767–785 |
| Emitente (`carregarEmitente` … `renderPreviewTimbrado`) | 787–817 |
| Sessão da empresa | 819–827 |
| `VIEW_META` / `trocarView` | 829–849 |
| `mapCst`, `mapCstct`, `mapNcm`, `importarJSON` | 858–891 |
| `atualizarStatusBase` | 892 |
| Empresas | 899–939 |
| **Núcleo de classificação** | 941–966 |
| `badgeReducao`, **`calcularTributos`** | 969–970 |
| Cards de classificação / tributação integral | 972–991 |
| `renderResultadoNcm` / `bindConsulta` | 993–1012 |
| Modal salvar classificação | 1014–1033 |
| Formulário de classificação | 1035–1088 |
| Produtos (listagem/CRUD/exportações) | 1090–1144 |
| Calculadora | 1146–1213 |
| Lote | 1215–1247 |
| **SPED** (`lerArquivoTexto`, `Sped.*`) | 1252–1646 |
| Detalhe/gravacao SPED | 1648–1815 |
| `AUX_META` + CRUD auxiliar | 1818–1914 |
| Selects e render das tabelas | 1916–2047 |
| `bindConfig` (import/backup) | 2049–2062 |
| Tema / `init` / export público | 2064–2104 |

Export público de `window.App`: `{ openModal, closeModal, logout, abrirModalEmpresas, salvarProdutoSped }` (l.2100–2103).
