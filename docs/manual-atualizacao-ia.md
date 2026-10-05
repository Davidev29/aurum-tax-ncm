# Manual de Atualização IA — Phase 6 (IA-10 / plan 06-10)

Como manter o módulo IA sem retreino: reindex, troca de modelo, build, updater, rollback.

## 1. Reindex sem retreino (mudança legal = regenerar índice)

O modelo nunca é re-treinado. Quando `public/base/` muda (nova tabela oficial):

1. `npm run base` — `scripts/build-base.mjs` regenera `reforma.json`/`nomenclatura.json`/
   `MANIFEST.json` e o gatilho `gatilhoIndiceIA()` compara o hash semântico com
   `recursos-ia/indice-ncm/.manifest-hash`. Divergente/ausente → roda
   `node scripts/gerar-indice-ia.mjs` automaticamente; igual → ignora (nunca falha o build).
2. Se a base IA precisar ser refeita manualmente:
   ```powershell
   node scripts/preparar-dados-ia.mjs   # public/base/*.json → recursos-ia/dados-brutos/ncm-para-ia.json (2335 NCMs)
   node scripts/validar-dados-ia.mjs    # exit 0 = 2335 vínculos, unicidade, paridade MANIFEST, amostra 5/5
   node scripts/gerar-indice-ia.mjs     # → recursos-ia/indice-ncm/indice-lexical.json
   node scripts/testar-indice-ia.mjs    # exit 0 = Frango→cap.01, Arroz→cap.10, Notebook→84/85
   ```
3. Quando houver rede + `@xenova/transformers`/`vectra`: o mesmo `gerar-indice-ia.mjs`
   tenta o caminho vetorial por import dinâmico (hoje cai no lexical). Revalidar com
   `testar-indice-ia.mjs` e conferir `du` < 200 MB.

**Quando reindexar:** toda vez que `npm run base` reportar `MANIFEST mudou — regenerando`;
toda release que embarcar base nova; nunca por mudança de descrição do usuário
(descrições livres não tocam o índice).

## 2. Troca do GGUF (modelo — agnóstico via camada de compatibilidade)

Trocar de modelo = trocar o arquivo `.gguf` (qualquer nome, qualquer família:
Qwen, Llama, Mistral, Phi, Gemma…). O sistema consome o PERFIL
(`electron/ia/perfil-modelo.cjs`), nunca o modelo — ver
`docs/camada-modelo-rag.md`.

1. Apague o `.gguf` atual e copie o novo para `recursos-ia/modelo/`
   (ex.: o atual `Qwen3-0.6B-Q8_0.gguf`, ~640 MB, `Q8_0`,
   fonte: https://huggingface.co/Qwen/Qwen3-0.6B-GGUF).
2. (Opcional) Copie `recursos-ia/modelo/modelo.json.example` →
   `recursos-ia/modelo/modelo.json` para fixar `familia`/`templateChat`/
   `contextSize`/parâmetros. Sem ele, a família é detectada pelo nome.
3. Calcule o SHA256 e registre em `recursos-ia/CHECKSUMS.txt`:
   ```powershell
   certutil -hashfile recursos-ia\modelo\<novo>.gguf SHA256
   ```
   Formato: `<sha256-hex>  modelo/<novo>.gguf`.
4. Valide (aborta com exit 1 se o hash divergir — GGUF não confiável nunca carrega):
   ```powershell
   node scripts/testar-modelo-ia.mjs            # qualquer .gguf (descoberta automática)
   node scripts/testar-modelo-ia.mjs --modelo recursos-ia\modelo\<novo>.gguf
   ```
   Esperado: modo REAL, `restricao100=true`, latência < 15 s, RSS < 1.6 GB.
   O `init` do worker responde com o `perfil` efetivo (confira no DebugIA).
5. Se o modelo for distribuído cifrado: ver `docs/seguranca-ia.md` §5
   (`--cifrar` → `assets/aux.dat`, registrar `cifrado <sha256>  assets/aux.dat`
   no `CHECKSUMS.txt`, chave no cofre, nunca no repo).

**Nunca commitar** `*.gguf` (`.gitignore` bloqueia; `git check-ignore -v` prova).

## 3. Build + afterPack + dist por OS

Pré-requisito por OS (**sem cross-packaging**: `node-llama-cpp` só traz o binário
do host — um build por plataforma, CPU-only, com as optionals CUDA/Vulkan podadas):

```powershell
# Windows 10 x64 → release/AurumTaxNCM-Setup-1.0.0-win-x64.exe (+ portable)
npm run dist:win
```
```bash
# macOS (um build por arch hospedeiro) → .dmg x64 / arm64
npm run dist:mac
# Linux → .AppImage
npx electron-builder --linux --publish never
```

O que o build faz (config em `package.json#build`):
- `asar: true`; `extraResources` embarca **só** o leve versionado
  (`dados-brutos/`, `indice-lexical.json`, `.manifest-hash`, `CHECKSUMS.txt` —
  `from`/`to` explícitos, sem glob `recursos-ia/**`).
- `asarUnpack`: `node-llama-cpp`, `@xenova/transformers`, `vectra`,
  `electron/dist/ia-worker.cjs`, `electron/dist/caminhos-ia.cjs`
  (binários nativos e fork não funcionam dentro do `.asar`).
- `afterPack: scripts/after-pack-ia.cjs` — FALHA o pack se faltar worker/base/
  índice/hash/CHECKSUMS; GGUF ausente = só AVISO (modo mock). Checagem manual:
  `node scripts/after-pack-ia.cjs` (exit 0).

Resolução de paths em prod: `electron/ia/caminhos-ia.cjs`
(`process.resourcesPath/recursos-ia` → dev `<raiz>/recursos-ia` → `cwd`).
Nunca referenciar `public/base` em runtime empacotado.

## 4. Updater

Canais existentes no main (`atualizacao:versao|verificar|baixar|instalar` em
`electron/main.ts:364-399`). Para releases com base nova ou índice novo:
1. Versionar (`package.json`), gerar instaladores por OS (§3).
2. Publicar; o app instalado verifica/baixa/instala pelo fluxo padrão.
3. Pós-instalação, o gatilho do índice (§1) garante paridade base↔índice;
   `afterPack` garante presença dos artefatos no pacote.

## 5. Rollback

| Cenário | Ação |
|---|---|
| Índice novo ruim (testes top-k falham) | Restaurar `indice-lexical.json` + `.manifest-hash` anteriores; `npm run ia:testar-indice` deve voltar a exit 0. O `.manifest-hash` versionado permite detectar divergência. |
| GGUF novo ruim (hash/latência) | Voltar o `.gguf` anterior, restaurar a linha SHA em `CHECKSUMS.txt`, `node scripts/testar-modelo-ia.mjs`. Sem GGUF válido o worker degrada para mock com aviso (by design). |
| Migração Dexie v8→v9 | `src/infrastructure/db/schema.ts` mantém a v8 congelada; `backup.ts` cobre `ia_feedback` (export/import). Antes de migrar em produção: backup via fluxo existente, testar restore. |
| Release com regressão | Reinstalar o instalador anterior da release (`release/`); trilha `audit_log` + `.jsonl` preservada no `userData`, não no pacote. |
