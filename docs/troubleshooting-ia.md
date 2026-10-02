# Troubleshooting IA — Phase 6 (IA-10 / plan 06-10)

Sintoma → causa provável → comando de checagem → correção.

## 1. Tensores / embedding ausente

**Sintoma:** `gerar-indice-ia.mjs` gera o lexical em vez do vetorial; `embedding/` vazio.
**Causa:** ambiente offline — `@xenova/transformers`/`vectra` não instalados e pesos
`all-MiniLM-L6-v2` não baixados (by design em 06-03; ver `diagnostico-fase-2.md`).
**Checks:**
```powershell
Get-ChildItem recursos-ia\embedding\
npm ls @xenova/transformers vectra
node scripts/gerar-indice-ia.mjs   # log indica caminho vetorial vs fallback lexical
```
**Correção:** com rede, `npm i --save-dev @xenova/transformers vectra`, baixar o
modelo para `recursos-ia/embedding/`, rodar `npm run ia:indice` + `npm run ia:testar-indice`
(exit 0). Sem rede: o lexical (1,05 MB) é o comportamento correto — não é erro.

## 2. Índice corrompido / `.manifest-hash` divergente

**Sintoma:** buscas retornam 0 candidatos; `testar-indice-ia.mjs` exit ≠ 0.
**Checks:**
```powershell
node scripts/testar-indice-ia.mjs
Get-Content recursos-ia\indice-ncm\.manifest-hash
npm run base   # "MANIFEST mudou — regenerando" indica rebuild automático
```
**Correção:**
```powershell
node scripts/gerar-indice-ia.mjs
node scripts/validar-dados-ia.mjs
node scripts/testar-indice-ia.mjs
```
Se `meta.geradoEm` confundir comparação de hashes: o gatilho usa hash **semântico**
(sem `meta.geradoEm`) — não comparar sha256 de arquivo cru (achado 06-03).

## 3. Worker não inicia / `ia:status` = `desligado`/`erro`

**Checks:**
```powershell
node electron/esbuild.mjs          # worker copiado para electron/dist/ ?
node --check electron/ia/ia-worker.cjs
node --check electron/ia/ia-service.cjs
node scripts/after-pack-ia.cjs     # 6/6 artefatos presentes ?
```
**Causas comuns:**
- `ia-worker.cjs` bundlado em vez de copiado → conferir `external` + cópia em
  `electron/esbuild.mjs` (o worker é forkado em runtime, nunca bundlado).
- `init{modelPath}` com GGUF inexistente → worker cai em mock com aviso (esperado
  offline); `ia:status` mostra `mock`, não `erro`.
- `node-llama-cpp` v3 é ESM-only: `require()` no main CJS falha
  (`ERR_REQUIRE_ASYNC_MODULE`) — usar `await import()` (achado do spike §4.1).
- Órfãos pós-quit: `before-quit` chama `encerrarIaService()`; conferir com
  `Get-Process electron` (deve ser 0 após sair).

## 4. Paths prod vs dev

**Sintoma:** funciona em dev, não acha base/índice no instalado.
**Causa:** código lendo `public/base` ou caminho relativo em vez de
`process.resourcesPath`.
**Check:** `electron/ia/caminhos-ia.cjs` — smoke em node puro imprime
`empacotado:false`, `dir` → `<raiz>/recursos-ia`, `gguf:null`, worker resolvido
(diagnostico-fase-6 §2 item 6). Toda resolução de artefato IA deve passar por
`dirRecursosIa()`/`resolverWorkerPath()` desse módulo (aceita layout
`recursos-ia/` e `assets/aux.dat`+`assets/idx/` pós-rename 06-08).

## 5. Dexie v9 (`ia_feedback`)

**Sintoma:** feedback "Não é esse" não persiste; `db.table('ia_feedback')` falha.
**Checks:** `src/infrastructure/db/schema.ts` (v8 congelada + v9 com `ia_feedback`),
`src/domain/constants/index.ts` (`DB_VERSION` → v9, `IAFEEDBACK: 'ia_feedback'`).
**Correção:** backup antes de migrar (`backup.ts` cobre `iaFeedback`); em testes sem
fake-indexeddb o `registrarFeedbackIa` degrada para auditoria (best-effort, não quebra a UI).

## 6. Rede bloqueada (comportamento esperado: tudo local)

**Sintoma:** dúvida se a IA chama algum serviço externo.
**Check (prova de segregação):** grep no worker por
`fetch(`/`node:net`/`node:http`/`node:dns`/`child_process`/`worker_threads`/`WebSocket`
— deve dar 0 ocorrências em código executável (hits só em comentários;
diagnostico-fase-4 §2). Em UAT: sniff no boot + consulta (Wireshark/`netstat`) = zero
sockets externos (caso U5 do diagnostico-fase-6 §4).

## 7. Comandos de checagem rápida (copiar/colar)

```powershell
npx tsc --noEmit
npm test
node scripts/validar-dados-ia.mjs
node scripts/testar-indice-ia.mjs
node scripts/testar-modelo-ia.mjs
node scripts/after-pack-ia.cjs
node scripts/ofuscar-ia.cjs --check
node scripts/criptografar-modelo-ia.mjs --check
git check-ignore -v recursos-ia/modelo/teste.gguf   # deve bloquear (*.gguf)
git status --porcelain                              # índice/embedding/gguf nunca listados
```
