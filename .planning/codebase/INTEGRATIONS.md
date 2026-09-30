# Integrations

> Mapeamento das integrações de `` (Electron main ↔ renderer, fontes de dados, import/export, segredos).
> Referências: `electron/main.ts`, `electron/preload.ts`, `src/infrastructure/bridge.ts`.

## External Services

| Serviço | Endpoint / mecanismo | Uso | Arquivo |
|---|---|---|---|
| BrasilAPI (CNPJ) | `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` | Completar cadastro de empresas por CNPJ; timeout 12 s, cache em memória, lote com concorrência 3, nunca lança em lote | `src/infrastructure/receita/brasilapi.ts` |
| Portal Único Siscomex — Classif (NCM vigente) | `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json` (+ fallback `?perfil=PUBLICO`) | Sync da tabela NCM vigente: diff por hash canônico, novos/alterados/extintos (`dataFim`/`atoFim`), piso de sanidade 1000 linhas; intervalo mín. 24 h, timeout 90 s, retry 3×/10 s | `src/domain/constants/siscomex-apis.ts`, `src/infrastructure/siscomex/ncm-sync.ts`, `src/application/ncm-sync.ts` |
| CFF — Conformidade Fácil / DFe (SVRS) | `https://cff.svrs.rs.gov.br/api/v1/consultas/{classTrib,credPresumido,anexos,…}` | Sync de referência CST × cClassTrib, crédito presumido, anexos LC 214, locais de operação, classificação de produtos (NFCom/NFAg/NF3e/NFGas); endpoints com mTLS lançam `ErroCertificadoCff` (import manual via portal) | `src/domain/constants/cff-apis.ts`, `src/infrastructure/cff/cff-sync.ts`, `src/application/cff-sync.ts` |
| Planalto / CGIBS (legislação) | Hosts allowlist: `planalto.gov.br`, `www.planalto.gov.br`, `www4.planalto.gov.br`, `cgibs.gov.br`, `www.cgibs.gov.br` (+ `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm` no menu Ajuda) | Leitura interna de normas no modal de legislação (renderer não sofre CORS — fetch roda no main) | `electron/main.ts` (`HOSTS_LEGISLACAO`, canal `rede:buscar-texto`), `src/infrastructure/legislacao-texto.ts`, `src/domain/legislacao.ts`, `src/ui/ModalLegislacao.tsx` |
| GitHub Releases (auto-update) | `publish: { provider: github, owner: Davidev29, repo: aurum-tax-ncm, private: true }` via `electron-updater` | Checagem 30 s após abrir + a cada 6 h; eventos `verificando/disponivel/em-dia/baixando/baixada/erro`; **é aqui que as bases embutidas (`dist/base`) são renovadas** | `electron/main.ts` (`configurarAtualizador`, canais `atualizacao:*`), `src/application/atualizacao.ts`, `package.json: build.publish` |
| Nenhum backend próprio | App 100% local/offline-first | Sem API SaaS, sem telemetria; aceite de contrato só em `localStorage` | `src/domain/contrato.ts`, `src/ui/TermoAceite.tsx` |

## Internal Modules / IPC

Arquitetura: renderer com `contextIsolation: true`, `nodeIntegration: false` — toda I/O via `window.aurum` (`contextBridge`).

| Canal IPC | Direção | Payload | Propósito |
|---|---|---|---|
| `base:ler` | renderer → main → renderer | `relPath → string UTF-8` | Ler `public/base` (dev) / `dist/base` (prod) com trava anti-traversão (`resolverNoBase`) |
| `base:ler-base64` | renderer → main → renderer | `relPath → base64` | Mesmo, binário; decode UTF-8 no preload (tem `Buffer`) |
| `rede:buscar-texto` | renderer → main → renderer | `url → { ok, status, urlFinal, contentType, texto }` | Fetch de norma oficial sem CORS; travas: só HTTPS, só hosts allowlist, sem fragmento, teto 15 MB, timeout 90 s, decode charset (Planalto serve ISO-8859-1) |
| `arquivo:escolher` | renderer → main → renderer | `filtros → { caminho, nome, conteudo base64 } \| null` | `dialog.showOpenDialog` (openFile) + leitura |
| `arquivo:escolher-pasta` | renderer → main → renderer | `void → path \| null` | `dialog.showOpenDialog` (openDirectory) |
| `arquivo:salvar` | renderer → main → renderer | `{ nome, conteudo base64, filtro } → path \| null` | `dialog.showSaveDialog` + escrita |
| `xml:salvar` | renderer → main → renderer | `{ cnpj, chave44, conteudo } → relPath` | Guarda NF-e em `<userData>/xml/<cnpj>/<chave>.xml` (mkdir recursivo) |
| `xml:ler` / `xml:remover` | renderer → main → renderer | `relPath → string` / `void` | Ler/remover XML guardado (inexistente não é erro) |
| `atualizacao:versao` | renderer → main → renderer | `→ { versao, empacotado }` | Versão instalada (aba Atualização) |
| `atualizacao:verificar` / `:baixar` / `:instalar` | renderer → main → renderer | manual check/download/quitAndInstall | Sem efeito fora do app empacotado (mensagem amigável) |
| `atualizacao:evento` | main → renderer (push) | `{ tipo, … }` | Progresso do auto-updater |
| `menu:acao` | main → renderer (push) | `{ acao: 'abrir' \| 'exportar' \| 'tema' \| 'atualizar' }` | Menu nativo (Arquivo/Exibir/Ajuda + atalhos `CmdOrCtrl+O/E`, `Shift+L`) |

Contrato e fallback:

| Peça | Arquivo | Notas |
|---|---|---|
| `AurumBridge` (tipos `BridgeEscolha`, `BridgeSalvar`, `TextoRemoto`, `VersaoApp`, `EventoAtualizacao`) | `src/infrastructure/bridge.ts` | `bridge = window.aurum ?? null`; `isElectron()`; `lerArquivoBase()` usa IPC no Electron e `fetch('base/...')` no navegador |
| Preload `window.aurum` | `electron/preload.ts` | Implementa 1:1 o `AurumBridge`; versão via `--aurum-versao=` (additionalArguments); `onMenu`/`onAtualizacao` com assinatura única (`removeAllListeners`) |
| Janela | `electron/main.ts: criarJanela` | 1440×900 (mín. 1024×700), `preload.cjs`, `sandbox: false`, single-instance, `will-navigate` bloqueada, `setWindowOpenHandler` → links externos no navegador |
| Armazenamento XML | `electron/main.ts: diretorioXml/resolverNoXml` + `src/infrastructure/arquivos/xml-storage.ts` | `app.getPath('userData')/xml` (gravável, preservado no update; nunca dentro do `.asar`) |

## Data Sources

| Fonte | Formato | Ingestão | Destino |
|---|---|---|---|
| Bases raiz (`classificacao_tributaria.json`, `reforma_tributaria_por_ncm.json`, `Tabela_NCM_Vigente_*.json`) | JSON brutos | `npm run base` → `scripts/build-base.mjs` (normalização 3FN, validações cruzadas, `MANIFEST.json` com sha256) | `public/base/*.json` → `dist/base` (embutido no instalador) |
| Bases embutidas (`reforma.json`, `classificacao-tributaria.json`, `nomenclatura.json`) | JSON normalizados | `useBase.iniciar()` via `lerArquivoBase()` (IPC ou fetch) | IndexedDB (seed) |
| Dexie/IndexedDB (`aurum_tax_ncm_v1`, v8) | Object stores locais | `src/infrastructure/db/schema.ts` + `src/infrastructure/base/*` + `src/application/base.ts` | Stores: `ncm`, `nbs`, `cst`, `cstClassTrib`, `referencia`, `ncmNomenclatura`, `empresas`, `produtos`, `meta`, `cfop`, `cstIcms`, `cstPisCofins`, `nfeNotas` (`++id`, único `empresaId+chave`), `reclassificacoesManuais`, `classificacaoProduto`, `auditLog` (append-only), `cest`; migração idempotente v2→v3 (nomes legados `ind_g*`) |
| Siscomex Classif (tabela vigente) | JSON ~3 MB (`Nomenclaturas[]`) | `ncm-sync.ts` (hash canônico, diff, metadados em `meta[siscomex_ncm_sync]`) | `ncmNomenclatura` |
| CFF/DFe (classTrib, anexos, crédito) | JSON por endpoint | `cff-sync.ts` (hash/etag/lastModified em `meta[cff_sync_*]`) | `cst`, `cstClassTrib`, `referencia`, `classificacaoProduto` |
| XMLs de NF-e do usuário | NF-e XML (chave 44 dígitos) | `xml-storage.ts` + canais `xml:*` → `<userData>/xml/<cnpj>/<chave>.xml`; parse `fast-xml-parser` | `nfeNotas` (itens + análise embutidos) |
| Cadastro de empresas | Digitação + BrasilAPI | `src/application/empresas.ts`, `src/application/emitente.ts` | `empresas` (+ sessão ativa em `localStorage[aurum_empresa_ativa_id]`) |
| Tabelas auxiliares (CFOP, CST ICMS/PIS-COFINS, CEST) | Seeds gerados | `scripts/gen-seeds.cjs`, `scripts/gen-capitulos.cjs` → `src/domain/constants/seeds.ts` | `cfop`, `cstIcms`, `cstPisCofins`, `cest` |

## Import/Export

| Formato | Lib | Módulo | Notas |
|---|---|---|---|
| XLSX/CSV (import lote) | `xlsx ^0.18.5` | `src/infrastructure/parsers/lote.ts`, `src/store/lote.ts`, `src/pages/Lote.tsx` | Import de produtos/NCM em lote; limite `ROWS_LIMIT = 200` linhas |
| CSV (export produtos) | manual (`montarCSV`) | `src/infrastructure/exporters/relatorios.ts` | Paridade v1: separador `;`, `\r\n`, BOM para Excel; produtos só entreaspam se contiver `"`/`;`/quebra; SPED sempre entreaspas |
| JSON (export/backup) | nativo | `relatorios.ts`, `src/application/backup.ts` | Backup/restore do IndexedDB (mesmos keyPaths desde a v1) |
| PDF (relatórios) | `pdfmake ^0.3.11` (lazy import) | `src/infrastructure/pdf/setup.ts` (+ `menu-exportacao.ts`), `relatorios.ts` | Documento declarativo (header timbrado, rodapé `Página X de Y`, Courier p/ NCM/CST/CFOP via `standard-fonts`); motor ~1,9 MB carregado sob demanda; substitui jsPDF+autotable da v1 |
| XML NF-e/SPED (import) | `fast-xml-parser ^5.11.1` | `src/infrastructure/nfe/parse.ts`, `src/infrastructure/sped/{parse,leitura,analisar}.ts`, `src/pages/NfeXml.tsx` | Validação + análise fiscal (apuração IBS/CBS, crédito, regime); `estudo-relatorio-xml.md` documenta o relatório |
| Arquivos genéricos | IPC `arquivo:*` | `electron/main.ts` + `preload.ts` | Abrir/salvar com filtros de extensão; conteúdo em base64 |
| Download navegador | `Blob + <a download>` | `relatorios.ts: baixar()` | Fallback web (fora do Electron) |
| Clipboard | `navigator.clipboard` | `src/pages/NfeXml.tsx`, `src/pages/Legislacao.tsx` | Copiar chave da nota / URL da norma |

## Environment & Secrets

| Item | Valor / localização | Notas |
|---|---|---|
| `.env` / `.env.*` | **Inexistentes** (verificado) | Nenhuma variável de ambiente versionada ou exigida |
| `VITE_DEV_SERVER_URL` | Injetada só em dev: `cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron .` (`dev:electron`) | `electron/main.ts` usa para decidir dev (`loadURL`) vs. produção (`loadFile dist/index.html`) |
| `AURUM_BASE_DIR` | Opcional para `scripts/build-base.mjs` (default: pasta pai do projeto) | Aponta onde estão os 3 JSONs-fonte |
| `--aurum-versao=` | `webPreferences.additionalArguments` (main → preload) | Repassa `app.getVersion()` ao renderer (`window.aurum.versao`) |
| Chaves/API keys | **Nenhuma** | BrasilAPI, Siscomex Classif e CFF públicos usados sem autenticação (CFF com mTLS exige certificado do usuário, nunca chave no código); GitHub Releases privado só no build empacotado |
| Segredos locais | `localStorage`: `tema`, `aurum_empresa_ativa_id`, aceite de contrato; IndexedDB: dados fiscais; `userData/xml`: XMLs | Tudo 100% na máquina — sem nuvem, sem telemetria (ver `src/domain/contrato.ts`, `src/ui/TermoAceite.tsx`) |
