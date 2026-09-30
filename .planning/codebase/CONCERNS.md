# Concerns

> Mapeamento de riscos, dívidas técnicas e pontos frágeis — `` (Electron + React + Vite + TS + Dexie).
> Verificado por leitura direta: `electron/main.ts`, `electron/preload.ts`, `src/infrastructure/db/schema.ts`,
> `src/application/backup.ts`, `src/infrastructure/legislacao-texto.ts`, `src/infrastructure/parsers/lote.ts`,
> `src/infrastructure/exporters/relatorios.ts`, `package.json`, `.planning/ROADMAP.md`.

## Tech Debt

- **TODO aberto (`src/infrastructure/cff/cff-sync.ts:380`)**: endpoints CFF fora de `Classificação Tributária` / `classProd_*`
  têm o JSON bruto persistido em `meta` sem normalizador ("implementar normalizadores específicos para cada endpoint").
  Dívida funcional silenciosa: o sync reporta "sincronizado" sem que os dados sejam consumíveis.
- **Duplicação `cff-sync`**: existem dois módulos — `src/application/cff-sync.ts` (orquestração/UI) e
  `src/infrastructure/cff/cff-sync.ts` (fetch/normalização). A separação é intencional (camadas), mas ambos
  conhecem `metaKey`/revalidação; mudança de contrato de endpoint exige tocar os dois — candidato a teste de contrato.
- **`xlsx@0.18.5` desatualizado e com histórico de CVEs** (prototype pollution / DoS via crafted workbook; SheetJS 0.18.x
  tem advisories públicos; checar `npm audit`). Mitigação parcial existente: import dinâmico só no fluxo de lote
  (`src/store/lote.ts:34`) e fallback CSV próprio. Recomendado: migrar para `xlsx@^0.18.5` patched/latest ou `exceljs`,
  ou ao menos fixar `sheetStubs:false` + limite de tamanho antes de `XLSX.read`.
- **`framer-motion@13` + `react@19`**: combinação fora da matriz de peers suportada (motion v13 mira React 18).
  Hoje funciona, mas updates do React 19 podem quebrar animação/modal — considerar `motion` (sucessor) ou fixar testes.
- **`sandbox: false` em `electron/main.ts:608`**: dívida de segurança (ver §Security). O preload usa `Buffer`/Node,
  o que impede ligar `sandbox:true` sem refatorar — registrado como item de hardening.
- **Grep `TODO|FIXME|HACK|XXX`**: só 1 TODO real no `src` (o do CFF acima); demais hits são falsos positivos
  ("TODOS" em comentários pt-BR). `console.*` no `src`: zero ocorrências fora de testes — só em `electron/main.ts:687`
  (erro fatal de boot, aceitável) e em `scripts/*` (build tooling, aceitável). Nenhum `debugger` no código.
- **ROADMAP desatualizado (dívida de processo)**: fases 1–4 marcadas `0/4 Not started`, mas o código já implementa
  boa parte (40 arquivos de teste, schema Dexie, classificadores, exporters, backup). Risco de execução: planejar
  "do zero" o que já existe → retrabalho e estimativas erradas. Recomendado: auditar e marcar o que já está pronto
  antes de iniciar fase 1.

## Security

**Pontos fortes (verificados):** `contextIsolation:true`, `nodeIntegration:false` (`main.ts:604-607`); IPC mínimo via
`contextBridge` (`preload.ts`); allowlist de hosts oficiais no `rede:buscar-texto` (`main.ts:37-46`, só HTTPS, teto
15 MB, timeout 90 s); anti-traversão em `resolverNoBase`/`resolverNoXml` (`main.ts:104-127`, `477-496`); validação de
`cnpj` (só dígitos) + `chave` (`/^\d{44}$/`) no `xml:salvar` (`main.ts:311-316`); navegação interna bloqueada
(`will-navigate`, `setWindowOpenHandler` nega popups, `main.ts:638-650`).

- **Dados fiscais sensíveis em claro (LGPD)**: CNPJ/CPF, razão social, e-mail de aceite, emitente, produtos e XMLs de
  NF-e ficam em IndexedDB (`DB_NAME='aurum_tax_ncm_v1'`), `localStorage` (aceite/tema, `TermoAceite.tsx:11-12,43`) e
  `<userData>/xml/<cnpj>/<chave>.xml` **sem criptografia**. Roubo de máquina/perfil = vazamento direto. Mitigação
  sugerida: `safeStorage` (Electron) para segredos + opção de backup criptografado (ver abaixo); documentar no termo.
- **Backup/restore sem validação real**: `ehBackup` (`backup.ts:136-140`) só checa `exportadoEm:string` + `ncm:array`.
  `restaurarBackup` faz `clear()` em 15 stores e `bulkPut` cego do JSON do usuário (`modais/globais.tsx:583-605` tem
  confirmação destrutiva, mas nenhuma checagem de versão/schema/assinatura). JSON malformado ou malicioso = banco
  corrompido ou registros arbitrários injetados (incluindo `__proto__`-like keys). Mitigação: validar schema por store
  (tipos `domain/entities`), checar versão do backup, importar em transação Dexie com rollback, e `JSON.parse` com
  limite de tamanho.
- **XSS via descrições NCM / HTML da norma**: único `dangerouslySetInnerHTML` é `ModalLegislacao.tsx:394`, alimentado
  pelo sanitizador caseiro `sanitizarHtml` (`legislacao-texto.ts:78-107`) — **sem DOMPurify**. O sanitizador remove
  `script/iframe/img/on*/style` e `javascript:/data:` em `href/src`, mas **não cobre** `srcset`, `xlink:href`,
  `formaction`, `srcdoc`, `poster`, nem `style` via SVG animado; e `span.innerHTML = el.innerHTML` (linha 98) copia
  HTML interno sem re-sanitizar. Risco hoje baixo (fonte = Planalto/CGIBS allowlist), mas descrições NCM vindas de
  planilha do usuário seguem outro caminho — auditar se alguma descrição de NCM/produto chega a `innerHTML`.
  Mitigação: adotar `dompurify`, ou estender a allowlist de atributos para deny-by-default.
- **Injeção via `ancora` em `destacarArtigo` (`legislacao-texto.ts:132`)**: `ancora.toLowerCase()` é interpolado num
  seletor CSS (`[name="${id}"]`) e num `RegExp` (`\\bArt\\.\\s*${num}\\b`) sem escape. `ancora` vem de URL/hash —
  `"]` ou `(a)+$` quebram o seletor (DoS de exceção) ou causam ReDoS localizada. Mitigação: `CSS.escape()` + escapar
  metacaracteres de regex.
- **CSV formula injection nos exports**: `montarCSV` (`relatorios.ts:58-70`) escapa aspas mas **não neutraliza células
  iniciadas por `= + - @`** (ex.: descrição/NCM digitado `=CMD(...)`). Ao abrir o CSV/XLSX no Excel, há execução de
  fórmula. Mitigação: prefixar com `'` ou `\t` células que casem `^[=+\-@]`.
- **Leitura de arquivo sem teto**: `arquivo:escolher` (`main.ts:243-262`) e `lerPlanilha` (`parsers/lote.ts:35-63`)
  carregam o arquivo inteiro (`fsp.readFile` / `file.arrayBuffer()` + `XLSX.read`) sem limite de tamanho. Um XLSX de
  500 MB = OOM do renderer/main. Mitigação: checar `file.size`/`stat` (ex.: recusar > 50 MB) antes de ler.
- **Rede de terceiros**: busca de CNPJ via BrasilAPI e `fetch` direto no modo web (`legislacao-texto.ts:46`, sem
  allowlist no fallback browser — qualquer URL passada a `buscarTextoLegislacao` é buscada). CNPJ consultado vaza
  para terceiro; resposta da API é persistida sem validação de schema aparente. Mitigação: allowlist também no modo
  web + validar resposta.
- **`sandbox:false` + preload com Node** (`main.ts:608`, `preload.ts:41` usa `Buffer`): qualquer XSS no renderer ganha
  capacidade de IPC irrestrita (leitura de `dist/base`, escrita de XMLs, `shell.openExternal` via links). Endurecer
  junto com a adoção de DOMPurify; a longo prazo, migrar decode base64 para o renderer puro e ligar `sandbox:true`.

## Performance

- **Busca <100 ms (meta fase 3) — em risco parcial**: índices Dexie existem e são razoáveis
  (`schema.ts:221-237`: `ncm: 'id, codigo, cst, cClassTrib'`, `ncmNomenclatura: 'codigo, descricao'`,
  `produtos: '++id, empresaId, ncm, codigo, cstReforma'`, `nfeNotas` com composto `&[empresaId+chave]`).
  Porém: (a) índice `descricao` é string integral — **Dexie/IndexedDB não faz `contains` indexado**; busca por
  substring provavelmente varre a store em memória (`busca-texto.ts` tokeniza e filtra em JS); (b) filtros combinados
  regime+origem+texto não têm índice composto correspondente. Com ~10 k NCMs + nomenclatura, varredura JS ainda deve
  ficar <100 ms em desktop, mas **medir com benchmark** (fase 3, plan 03-01) em máquina fraca; considerar índice
  full-text próprio (token map) se estourar.
- **Tabela virtualizada — AUSENTE**: `package.json` não contém `react-window`, `react-virtuoso` nem TanStack Virtual;
  grep confirma zero uso. Renderizar 10 k linhas direto no DOM vai travar scroll/render (meta fase 3, plan 03-02).
  Ação: adicionar `react-virtuoso` (ou `@tanstack/react-virtual`) antes da fase 3.
- **Classificação <2 s para 100 % da base (meta fase 2)**: o motor é síncrono/determinístico com resolvedor único
  (`resolverClassificacoes` — bom, sem duplicação de decisão) e `bulkPut` em lotes de 500 (`schema.ts:248-260`).
  Provável OK, mas sem teste de perf versionado — incluir no plan 02-02 um teste `vitest` com 10 k linhas e teto 2 s.
- **Import <5 s (meta fase 1)**: `build-base.mjs` gera `dist/base` embutida (evita importar 10 k via UI toda vez —
  boa decisão); o caminho `lerPlanilha` usa `raw:false` (formatação custa CPU em planilhas grandes) e tenta
  `XLSX.read` antes do fallback textual, mesmo para `.csv` (linhas 43-53: CSV passa pelo parser XLSX primeiro —
  desperdício + risco de misparse; inverter: CSV/TXT direto no parser próprio).
- **Revalidação silenciosa engole erro** (`application/base.ts:97-105`, `cff-sync.ts:141-145` com `catch {}`):
  bom para UX, ruim para diagnóstico de perf/degradação — ao menos logar em `audit_log` ou console persistente.

## Compliance / Domain Risk

- **Regras LC 214 Anexos I/II + IS/imunidade**: motor centralizado é o desenho certo (resolvedor único + `resumo`
  pronto do JSON, `mapNcm` copia `n.resumo` — `SPEC-LOGICA-NEGOCIO.md R2.10`), mas a **fonte da verdade é o JSON
  embutido** (`dist/base`, gerado por `scripts/build-base.mjs` a partir de pasta externa `AURUM_BASE_DIR`). Se a
  planilha-fonte estiver desatualizada ou o script tiver bug de mapeamento, **100 % das classificações nascem
  erradas** e nada no app detecta. Mitigação: teste `base-embutida.test.ts` já existe — garantir que ele valida
  amostragem contra Anexos + contagem de vínculos; versionar `MANIFEST.json` com hash/origem e exibir na UI.
- **Vetos e vigência**: há infraestrutura (`vigencia-ncm.test.ts`, `revogacao.test.ts`, `revalidacao.ts` reaplica a
  classificação vigente em produtos/notas), mas a revalidação pós-update é **best-effort silenciosa** — uma base nova
  com veto pode reclassificar produtos sem o usuário perceber a causa. Mitigação (fase 5, plan 05-03): relatório de
  "o que mudou e por quê" após cada revalidação, com base legal citada.
- **Múltiplas classificações para o mesmo NCM**: hoje o lote resolve via `resolverClassificacoes` e a UI de lote
  permite escolher (`lote.ts:escolher`), mas a **fase 5 (plan 05-02) exige análise comparativa explícita** — sem ela,
  o usuário escolhe no escuro e a responsabilidade tributária cai sobre ele sem trilha. Manter `escolhida` + auditoria.
- **Override manual com justificativa**: modal exige observação/fonte (`reclassificacao.tsx:440-446`) — bom; validar
  que `reclassificacoesManuais` + `audit_log` (append-only, nunca `clear` no restore — `backup.ts:103-104`) formam
  trilha completa exigível em fiscalização. Atenção: restore **acrescenta** `audit_log` do backup sobre o atual
  (append, sem dedup) — possível duplicação de trilha; documentar como comportamento.
- **Validação anti-regimes-conflitantes** (meta fase 2): verificar se existe no motor ou só na UI; teste
  `reclassificacao-manual.test.ts` deve cobrir conflito — checar cobertura antes de declarar a fase pronta.
- **Atualização automática das bases (fase 5, plan 05-04)**: hoje bases renovam **só via electron-updater**
  (`main.ts:417-422`). Se o usuário não atualiza o app, trabalha com lei velha indefinidamente, sem aviso de
  desatualização. Mitigação: banner "base de <data> — verificar atualização" + checagem no boot (já planejado).

## Fragile Areas

- **Import CSV/XLSX (`parsers/lote.ts`)**: ordem de tentativa (XLSX primeiro, mesmo p/ CSV); detecção de separador só
  pela primeira linha (falha com header com `;` dentro de aspas); `TextDecoder('utf-8')` no fallback — planilhas
  brasileiras em **Latin-1/Windows-1252** viram mojibake; `mapearColunas` por regex de sinônimos (frágil a headers
  fora do dicionário — erro "coluna não encontrada" sem sugestão próxima). Qualquer mudança de layout da planilha
  oficial quebra a importação. Mitigação: sniff de encoding (ou tentativa latin1), `string-similarity` para sugerir
  coluna, e corpus de fixtures (já há `csv.test.ts` — ampliar).
- **Schema Dexie / migrações (`schema.ts:197-240`)**: `DB_VERSION = 8` mas só declaradas `version(6)` e `version(8)` —
  **não há `version(7)`**; usuários que instalaram uma hipotética v7 (ou o Dexie gravou `dbver:7`) podem cair em erro
  de upgrade/downgrade. `migrarBancoLegado` faz `toArray()` + `bulkPut` de **tabelas inteiras dentro do upgrade** —
  com 10 k+ linhas pode estourar o tempo da transação de upgrade e deixar o banco meio-migrado (sem rollback por
  tabela). Mitigação: migração por cursor/lotes com progresso + teste `db-migracao.test.ts` cobrindo 6→8 e re-run
  idempotente (a função diz-se idempotente — garantir por teste).
- **Nomes de stores como strings mágicas**: `backup.ts:LOJA_BACKUP` lista 16 stores; `schema.ts` tem `STORES.*`.
  Divergência silenciosa (ex.: nova store esquecida no backup) = **perda de dados no restore**. Mitigação: derivar
  `LOJA_BACKUP` de `STORES` ou teste que compara as listas.
- **Export Excel/PDF/CSV (`relatorios.ts`, ~1500 linhas)**: módulo gigante multi-responsabilidade (CSV + 4+ layouts
  de PDF + lote + NF-e + SPED). `xlsx` antigo (vuln) na escrita; `pdfmake` com workaround de VFS de fontes
  (`pdf/setup.ts:14` — "File 'data/Courier.afm' not found" indica fragilidade de empacotamento asar); CSV ERP com
  BOM + `;` (correto) mas sem teste de encoding contra ERPs legados (Win-1252?). Mitigação: quebrar em módulos por
  formato, fixar teste golden (`pdf-exportacao.test.ts` existe — ampliar para Excel/CSV ERP), mais formula-escape.
- **XML de NF-e (`fast-xml-parser@5`, `infrastructure/nfe/*`, `sped/*`)**: parse de XML arbitrário do usuário;
  checar opções (`ignoreAttributes`, entities, `maxFileSize`) contra billion-laughs/XXE; `xml:salvar` grava UTF-8
  sem validar que o conteúdo é XML bem-formado (lixo persiste e quebra leituras futuras). Mitigação: validar
  bem-formação + chave-embarcada vs nome do arquivo antes de gravar.
- **CFF sync (`cff-sync.ts` ×2 + BrasilAPI)**: rede externa com retry/certificado (`ehErroCertificado`), `TODO` de
  normalizadores, `AbortSignal.timeout` distinto por caminho (90 s main vs 30 s web). Falha de rede vira status
  "erro/certificado" persistido em `meta` sem apagar último válido (bom), mas **revalidação automática dispara em
  seguida** (`application/cff-sync.ts:91`) e pode reclassificar a base com dados parcialmente sincronizados.
  Mitigação: só revalidar quando todos os endpoints críticos = `atualizado/inalterado`.

## Top 5 Risks

| Risco | Impacto | Likelihood | Mitigação sugerida |
|---|---|---|---|
| Base tributária embutida desatualizada/errada (LC 214) gera classificações erradas em massa | Alto (passivo fiscal do cliente; responsabilidade do escritório) | Média (updates só via electron-updater; sem aviso de staleness) | Fase 5 plan 05-04 + banner de idade da base; `MANIFEST.json` com hash/origem visível; teste de amostragem contra Anexos no CI |
| Restore de backup corrompe o banco (validação `ehBackup` trivial + `clear()` + `bulkPut` cego, sem transação) | Alto (perda total dos dados locais; trilha de auditoria duplicada) | Média (qualquer JSON arrastado; usuário leigo) | Validação de schema por store + versão; import em transação com rollback; dry-run de contagem antes do `clear()` |
| Dados fiscais sensíveis em claro (IndexedDB/localStorage/userData, LGPD) | Alto (vazamento em roubo/perda de máquina; multa LGPD) | Média (desktop físico; backup JSON portável circula por e-mail) | `safeStorage` p/ segredos; backup com opção criptografada (senha); documentar retenção no Termo de Aceite |
| XSS via sanitizador HTML caseiro (`sanitizarHtml` sem DOMPurify + `sandbox:false` + `ancora` sem escape) | Alto (XSS no renderer = IPC irrestrito: ler base, gravar XMLs, abrir links) | Baixa-Média (fonte atual é allowlist Planalto; cresce se descrição de planilha chegar ao HTML) | Adotar `dompurify`; `CSS.escape` + escape de regex na ancora; deny-by-default de atributos; planejar `sandbox:true` |
| Sem tabela virtualizada + busca por varredura JS (10 k registros; metas <2 s / <100 ms) | Médio (UI trava; fases 2–3 reprovam nos critérios de aceite) | Alta (nenhuma lib de virtualização instalada; índice `descricao` não serve p/ substring) | Adicionar `react-virtuoso`/`@tanstack/react-virtual` (plan 03-02); benchmark `vitest` de busca+classificação com 10 k linhas; índice tokenizado se necessário |
