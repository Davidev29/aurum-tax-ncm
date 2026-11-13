# Concerns

> Riscos, dívidas técnicas e pontos frágeis — verificado na árvore atual (v1.1.0, 2026-11-13):
> Electron main/preload, `src/infrastructure/db/*`, `src/application/backup.ts`,
> `src/aurum/*` (removido), `src/ui/*` (ModalLegislacao), `package.json`, CI e testes.
> Histórico: a versão Dexie deste doc está no git (era ~set/2026).

## Security

**Pontos fortes (verificados):** `contextIsolation:true`, `nodeIntegration:false`; preload mínimo (`window.aurum`); DevTools só em dev; `will-navigate` travado (só dev-server/`dist/index.html`); `setWindowOpenHandler` → deny; lock single-instance; IPC do main denso em validação (allowlist de ops/tabelas do `db:op`, anti-traversão, tetos, CNPJ/chave NF-e); grafo fiscal fail-closed sem interpolação em Cypher; build fail-closed (`verificar-build`).

### Crítico

- **CSP inexistente** (0 ocorrências no repo). Única `dangerouslySetInnerHTML` ativo (`src/ui/ModalLegislacao.tsx`) depende de sanitizador artesanal; se houver XSS, o renderer herda a ponte IPC inteira (`db:op`/`apagarTudo`, `xml:remover`, `arquivo:salvar`, `atualizacao:instalar`). Fix: CSP (meta no `index.html` ou `onHeadersReceived`), idealmente + `dompurify`.
- **Auto-update sem assinatura/verificação** (`electron-updater`; Windows sem `publisherName`/cert, mac `identity:null`, Linux sem GPG; repo público). Comprometimento do release = RCE em todas as máquinas. Fix: Authenticode (Azure Trusted Signing) + publicação assinada; notarização mac; ou release interno com checksum assinado.

### Alto

- **`sandbox:false` no preload** (por causa de `Buffer.from(base64)`). Fix: `atob` + `Uint8Array` e `sandbox:true`.
- **`shell.openExternal` sem allowlist** (`setWindowOpenHandler` e ex-`aurum:abrir-url`, agora removido) — links injetados abrem no navegador. Fix: allowlist http(s) de hosts conhecidos.
- **`rede:buscar-texto` segue redirects sem revalidar host**; teto de 15 MB só após download completo. Fix: `redirect:'manual'` + validar `Location` no allowlist; checar `Content-Length`/abortar durante o stream.
- **`safeStorage` com fallback silencioso para base64** quando o keychain do SO não existir (Linux headless) — relevante apenas se algum segredo voltar a ser persistido localmente.
- **`apagarTudo` (db:op) permite wipe de até 40 tabelas** disponível ao renderer. Fix: remover do canal ou exigir confirmação nativa (`dialog`) + lista mínima.

### Médio/Baixo

- **`ModalLegislacao` sanitizer** artesanal — adicionar DOMPurify como segunda linha.
- **Sem `setPermissionRequestHandler`** (defaults Chromium liberais). Fix: deny-por-padrão.
- **`webSecurity` não explícito** (default seguro hoje, mas registre).

## Tech Debt

- **Monstros de código**: `aurum-ai-chat.ts` (253 KB), `pages/NfeXml.tsx` (195 KB), `modais/globais.tsx` (106 KB), `simples/page.tsx` (104 KB) — e `NfeXmlPolida.tsx` duplica a clássica sob toggle `xml-layout`. Decidir vencedor e deletar o perdedor.
- **Clean Architecture nominal**: `infrastructure` é namespace universal (109 imports em `application/`, 32 em `pages/`, …); `domain/` importa infra (11) e a feature `simples/` (3). Refatorar = portas + composition root.
- **Erros engolidos**: ~195 catches "best-effort" com comentário no corpo (bancos/rede falham em silêncio). Zero `console.log` em runtime, mas silêncio ≠ higiene — ao menos log local estruturado nas camadas de infra.
- **Motores paralelos/duplicação**: `round2` ×6, `aliqIBS/aliqCBS` ×7 sítios, alíquotas 19/9 em 3 pontos + tabela viva (`parametros.json`), re-exports "compat" em `simples/`, duplicação `NfeXml` × `NfeXmlPolida`.
- **`xlsx@0.18.5`** sem patch de segurança recente; avaliar `exceljs` (ou travar versão e revisão).
- **TODO real único** (`cff-sync.ts`: normalizadores de endpoints CFF incompletos) + **46 `eslint-disable`** (30 `exhaustive-deps`).
- **CI mínimo**: 1 job, só Ubuntu+Node 22, sem build/release/lint/coverage publish; thresholds de coverage ignorando `simples/` (letra morta); `fake-indexeddb`/`jsdom` declarados, mas sem testes de `.tsx`.

## Domain / Data Risk

- **Fonte da verdade = JSON embutido** (`public/base/*` gerado por `build-base.mjs`). Fonte desatualizada ou mapeamento errado → classificações erradas em massa. Mitigação existente: `verificar-build.mjs` (contagens + hash MANIFEST), `base-embutida.test.ts`. Recomendado: teste de amostragem rotineira + carimbo de idade da base na UI.
- **Atualização das bases = update do programa** (electron-updater). Usuário sem update trabalha com lei velha sem aviso. Fix: banner "base de <data> — verificar atualização" no boot.
- **Backup/restore transacional e validado** (v1.0.0+): all-or-nothing, snapshot pré-restore rotativo, manifest por tabela, KEK fora do export — risco residual baixo; restore de backup **não aceita sem confirmação** backup parcial.

## Performance

- Busca lexical/grafo local: <50ms tipicamente; busca por substring varre em memória (não há índice `contains`) — medir com base grande.
- **Tabela virtualizada ausente** (sem react-window/virtuoso): telas de tabela grandes contam com paginação/filtros; se o volume passar de milhares de linhas renderizadas, adicionar virtualização.
- `dump` do `build-base` regenera artefatos (1,5–2,8 MB) — determinístico, mas versionar cautelosamente (diff em `public/base/*` pode ser grande).

## Fragile Areas

- **`parsers/lote.ts`** (CSV/XLSX oficial): ordem de parsing (XLSX antes de CSV), latin1/cp1252 (acentos), regex de colunas fora do dicionário — exige tratamento cuidadoso.
- **XML NF-e**: `fast-xml-parser` — avaliar limites (tamanho, entidades) antes de parser de XML arbitrário; validar bem-formação antes de `xml:salvar`.
- **`modal globais/auxiliares`**: campos NCM/cClassTrib como texto — validação de domínio existe na escrita (`db:op`), mas a UX não avisa inline sempre.
- **`store/ui.ts` e `aplicacao`**: efeitos colaterais em import-time (tema aplicado no módulo). Ordem de import importa.
- **`.planning`**: já foi reescrito 2026-11-13; antes disso era desatualizado — manter os docs em sincrono a cada release (essa é uma regra de processo recomendada).

## Top Risks (prioridade)

| Risco | Impacto | Likelihood | Mitigação |
|---|---|---|---|
| Update sem assinatura comprometido | Crítico (RCE nas instalações) | Baixa-Média | Assinar Windows/mac antes de distribuir |
| XSS no renderer com IPC aberto | Crítico (wipe de banco, exfil) | Baixa-Média | CSP + DOMPurify + (futuro) sandbox:true |
| Base embutida desatualizada | Alto (classificação errada) | Média | Banner de idade da base no boot |
| Backup/restore mal comportado em JSON arbitrário | Alto (perda de dados) | Baixa | Já mitigado (v1.0.0) — manter testes |
| Refatoração adiada (monstros) | Médio (manutenção lenta) | Alta | Quebrar arquivos grandes por área |
