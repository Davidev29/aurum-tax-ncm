# Integrations

> Mapeamento das integrações (Electron main ↔ renderer, fontes de dados, import/export, segredos).
> Referências: `electron/main.ts`, `electron/preload.ts`, `src/infrastructure/bridge.ts`.
> Atualizado em 2026-11-13 (v1.1.0): removidas as integrações da camada Aurumbit (licença/conta/cobrança).

## External Services

| Serviço | Endpoint / mecanismo | Uso | Arquivo |
|---|---|---|---|
| BrasilAPI (CNPJ) | `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` (+ fallbacks `oficina.cnpj.ws` → `receitaws` → `cnpj.ws`) | Completar cadastro de empresas por CNPJ (opcional; botão "Puxar dados") | `src/infrastructure/receita/brasilapi.ts` |
| Portal Único Siscomex — Classif | `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json` | Sync da nomenclatura NCM (opcional; diff por hash, piso sanidade); timeout, retry, 24h mín. | `src/infrastructure/siscomex/ncm-sync.ts`, `src/application/ncm-sync.ts` |
| CFF — Conformidade Fácil/DFe | `https://cff.svrs.rs.gov.br/api/v1/consultas/*` | Sync CST × cClassTrib, anexos, crédito presumido (opcional; endpoints mTLS → import manual) | `src/infrastructure/cff/cff-sync.ts`, `src/application/cff-sync.ts` |
| Planalto / CGIBS (legislação) | allowlist: `planalto.gov.br` (+`www.`/`www4.`), `cgibs.gov.br` | Leitura de normas no modal in-app (fetch no main, sem CORS); teto 15 MB, timeout 90 s | `electron/main.ts` (`HOSTS_REDE`), `src/infrastructure/legislacao-texto.ts`, `src/ui/ModalLegislacao.tsx` |
| GitHub Releases (auto-update) | `publish: { provider: github, owner: Davidev29, repo: aurum-tax-ncm, private: false }` via `electron-updater` | Checagem no boot + a cada 6 h; **é aqui que bases embutidas são renovadas** | `electron/main.ts` (`configurarAtualizador`), `src/application/atualizacao.ts`, `package.json: build.publish` |
| Fundo animado (Pexels) | `https://api.pexels.com` | Imagem de fundo (opcional; cache 24h) | `src/infrastructure/fundo/pexels.ts` |
| Nenhum backend próprio | App 100% local/offline-first | Sem API SaaS, sem conta, sem telemetria da base | — |

## Internal Modules / IPC

Arquitetura: renderer com `contextIsolation: true`, `nodeIntegration: false` — toda I/O via `window.aurum` (`contextBridge`).

| Canal IPC | Direção | Payload | Propósito |
|---|---|---|---|
| `base:ler` / `base:ler-base64` | renderer → main | `relPath → texto/base64` | Ler `public/base` (dev) / `dist/base` (prod); anti-traversão |
| `rede:buscar-texto` | renderer → main | `url → texto` | Fetch de norma oficial (só HTTPS + allowlist, sem fragmento, teto 15 MB, timeout 90 s) |
| `arquivo:escolher` / `:escolher-pasta` / `:salvar` | renderer → main | filtros → caminho/conteúdo base64 | Diálogos nativos + leitura/escrita na escolha do usuário |
| `xml:salvar` / `xml:ler` / `xml:remover` | renderer → main | `{ cnpj, chave44 }` / relPath | XMLs em `<userData>/xml/<cnpj>/<chave>.xml` (chave `^\d{44}$`) |
| `db:op` | renderer → main | `DbOp → resultado` | Banco SQLite via Prisma; allowlist de 11 ops/tabelas + validação de domínio + tetos |
| `db:transaction` | renderer → main | `DbOp[] → resultado[]` | Transação SQLite real (tudo-ou-nada), ≤500 ops |
| `db:snapshot` | renderer → main | `→ { ok, caminho }` | Snapshot pré-restore rotativo (`pre-restore-*.bak`) |
| `ia:grafo` / `ia:grafo-uso` | renderer → main | texto/k → resultado | Grafo fiscal local (FTS+2hops+PageRank) no `utilityProcess`; overlay local |
| `atualizacao:versao` / `:verificar` / `:baixar` / `:instalar` | renderer → main | manual | Sem efeito fora do empacotado |
| `atualizacao:evento` | main → renderer (push) | `{ tipo }` | Progresso do auto-updater |
| `menu:acao` | main → renderer (push) | `{ acao }` | Menu nativo (Arquivo/Exibir/Ajuda; atalhos `Ctrl/Cmd+O/E`, `Shift+L`) |

Contrato e fallback:

| Peça | Arquivo | Notas |
|---|---|---|
| `AurumBridge` | `src/infrastructure/bridge.ts` | `bridge = window.aurum ?? null`; `isElectron()`; leitura de base com fallback `fetch('base/...')` no navegador |
| Preload `window.aurum` | `electron/preload.ts` | Implementa 1:1 o `AurumBridge`; `sandbox: false` (preload usa `Buffer`; hardening pendente) |
| Janela | `electron/main.ts: criarJanela` | 1440×900 (mín. 1024×700); single-instance; `will-navigate` ativo; `setWindowOpenHandler` → deny + `openExternal` p/ http(s) |
| Banco | `electron/main/db.ts` + `src/infrastructure/db/*` | Singleton Prisma no main; IPC `db:op`; `aurum.db` em `userData`; `integrity_check` no boot (quarentena se corrompido) |

## Data Sources

| Fonte | Formato | Ingestão | Destino |
|---|---|---|---|
| Bases raiz (`classificacao_tributaria.json`, `reforma_tributaria_por_ncm.json`, `Tabela_NCM_Vigente_*.json`) | JSON | `npm run base` → `scripts/build-base.mjs` (3FN + `MANIFEST.json` sha256) | `public/base/*.json` → `dist/base` |
| `public/base/*.json` (`reforma`, `classificacao-tributaria`, `nomenclatura`, `cnae-nbs`, `parametros`, `grafo/*`) | JSON/LBDBG | `useBase.iniciar()` via IPC | Repositórios locais + grafo |
| SQLite (`aurum.db`) | Prisma schema (`prisma/schema.prisma`) | IPC `db:op` (bridge) ou Prisma direto em scripts | 27 tabelas (empresas, produtos, notas, audit_log, cest, cfop, auxiliares…) |
| Siscomex vigente | JSON ~3 MB | `ncm-sync.ts` (hash canônico, merge) | `ncmNomenclatura` |
| CFF/DFe | JSON/endpoint | `cff-sync.ts` (hash/etag) | `cst`, `cstClassTrib`, `referencia` |
| XML NF-e do usuário | NF-e XML | `xml:*` + `fast-xml-parser` | `nfeNotas` |
| Cadastro de empresas | digitação + BrasilAPI | `application/empresas.ts` | `empresas` |
| Sementes auxiliares | geradas | `scripts/gen-seeds.cjs` | `cfop`, `cst*`, `cest` |

## Import/Export

| Formato | Lib | Módulo | Notas |
|---|---|---|---|
| XLSX/CSV (lote) | `xlsx ^0.18.5` | `infrastructure/parsers/lote.ts` | Limite de linhas configurável; fallback CSV próprio |
| CSV (produtos) | manual | `infrastructure/exporters/relatorios.ts` | `;`, CRLF, BOM; escape de aspas |
| JSON (backup) | nativo | `application/backup.ts` | Transacional, tudo-ou-nada, snapshot rotativo pré-restore |
| PDF | `pdfmake ^0.3.11` | `infrastructure/exporters/relatorios.ts`, `infrastructure/pdf/*` | Lazy import (~1,9 MB sob demanda); emitente timbrado |
| XML NF-e/SPED (import) | `fast-xml-parser ^5` | `infrastructure/nfe/*`, `infrastructure/sped/*` | Análise fiscal + apuração assistida IBS/CBS |
| Download navegador | `Blob + <a download>` | `relatorios.ts` | Fallback web |
| Clipboard | `navigator.clipboard` | telas | Copiar chave/URL |

## Environment & Secrets

| Item | Valor / localização | Notas |
|---|---|---|
| `.env*` | **Sem variáveis exigidas** | v1.1.0 removeu `VITE_AURUM_*`; `.env.development.local` legado pode ser apagado (inerte) |
| `VITE_DEV_SERVER_URL` | Só dev (via `cross-env`) | Escolhe `loadURL(:5173)` vs. `loadFile(dist/index.html)` |
| `--aurum-versao=` | `additionalArguments` (main → preload) | Versão do app no renderer |
| Chaves/API keys | **Nenhuma no código** | Endpoints públicos sem autenticação; CFF mTLS exige certificado do usuário (nunca no repo); exceção: chave Pexels embutida (pendente de rotação) |
| Segredos locais | `localStorage`: `tema`, `aurum:sidebar-recolhida`, `aurum_empresa_ativa_id`, `xml-layout`, `TOUR_KEY` (`aurum:tour-guiado-visto`); SQLite: dados fiscais; `userData/xml`: XMLs | Tudo 100% na máquina; **o aceite de contrato e o gate de licença foram removidos na v1.1.0** |
