# Diagnóstico Fase 6 — Empacotamento IA offline (06-07 / IA-07)

**Data:** 2026-09-30 · **Status:** preparável-offline concluído; pack real pendente (UAT, sem rede/VM)
**Tracer:** 06-05 verde (mock) · 06-06 pronta · **Sem commit** (arquivos no working tree)

## 1. Config aplicada

### `package.json` → `build`
- `asar: true` — confirmado (já existia, mantido).
- `extraResources` (NOVO) — embarca **somente** o leve e versionado, com `from`/`to`
  explícitos (sem glob `recursos-ia/**`, para nunca puxar peso por acidente):
  | `from` | `to` |
  |---|---|
  | `recursos-ia/dados-brutos` (filtro `**/*` menos `.gitkeep`) | `recursos-ia/dados-brutos` |
  | `recursos-ia/indice-ncm/indice-lexical.json` | `recursos-ia/indice-ncm/indice-lexical.json` |
  | `recursos-ia/indice-ncm/.manifest-hash` | `recursos-ia/indice-ncm/.manifest-hash` |
  | `recursos-ia/CHECKSUMS.txt` | `recursos-ia/CHECKSUMS.txt` |
- Deliberadamente **FORA** do instalador: `recursos-ia/modelo/*.gguf` (ausente
  offline → modo mock) e `recursos-ia/embedding/*` (pesos 06-03 ainda não
  adquiridos; quando existirem, reavaliar — ver §4, risco de estouro).
- `asarUnpack` (NOVO): `**/node-llama-cpp/**`, `**/@xenova/transformers/**`,
  `**/vectra/**` (padrões inócuos enquanto as deps não estão instaladas) +
  `electron/dist/ia-worker.cjs` e `electron/dist/caminhos-ia.cjs` (fork exige
  arquivo real; binários nativos NÃO funcionam dentro do `.asar` — achado C2
  do spike).
- `afterPack: scripts/after-pack-ia.cjs` (NOVO, registrado).
- **Nenhuma dependência adicionada; nenhum script `dist` executado**
  (electron-builder exige toolchain/download de rede).

### `electron/ia/caminhos-ia.cjs` (NOVO)
Resolução central: prod `process.resourcesPath/recursos-ia` (empacotado,
`app.isPackaged` ou heurística `app.asar`/`resources`) → dev
`<raiz>/recursos-ia` → `cwd/recursos-ia`, com fallback e `console.warn`/`log`
(nunca lança). Exporta `dirRecursosIa`, `raizProjeto`, `caminhoIndiceLexical`,
`caminhoManifestHash`, `caminhoBaseIa`, `caminhoModeloGguf` (`null` sem GGUF),
`resolverWorkerPath` (inclui candidato `app.asar.unpacked`), `ehEmpacotado`.
- **Integração aplicada (não apenas documentada):** `ia-service.cjs` delega
  `resolverWorkerPath()` ao módulo (bundlado no `main.js` pelo esbuild);
  `ia-worker.cjs` delega `raizProjeto()` ao módulo (`require` relativo —
  funciona na fonte `electron/ia/` e no `dist/`). Módulo sem estado, logo a
  duplicação bundle/cópia é segura.
- `electron/esbuild.mjs`: além do worker, agora copia `caminhos-ia.cjs` para
  `electron/dist/` (provado no log do build).

### `scripts/after-pack-ia.cjs` (NOVO, hook `afterPack`)
Verifica worker copiado + `caminhos-ia` + base 06-02 + índice lexical +
`.manifest-hash` + `CHECKSUMS` (FALHA = lança `Error` e reprova o pack);
GGUF ausente = **só AVISO** (modo mock); `embedding/` e `modelo/` locais
nunca embarcados (aviso informativo); confere `resources/recursos-ia` no
`appOutDir` quando disponível (aviso por alvo NSIS/DMG/AppImage).
Execução manual offline: `node scripts/after-pack-ia.cjs` (exit 0 aqui).

## 2. Verificações executadas (offline)

| # | Comando | Resultado |
|---|---|---|
| 1 | `npx tsc --noEmit` | OK, sem saída (exit 0) |
| 2 | `npm run build:electron` | OK — `main.js`, `preload.cjs`, `ia-worker.cjs` + `caminhos-ia.cjs` copiados |
| 3 | `node scripts/validar-dados-ia.mjs` | OK — 2335 vínculos, 0 falhas, amostragem 5/5 |
| 4 | `node scripts/after-pack-ia.cjs` | OK — 6/6 artefatos presentes; 1 AVISO esperado (GGUF ausente → mock) |
| 5 | `node --check` nos 4 `.cjs` | OK |
| 6 | Smoke `caminhos-ia` (node puro) | `empacotado:false`, `dir` → `<raiz>/recursos-ia`, `gguf:null`, worker resolvido |
| 7 | Smoke fork do worker (fonte **e** dist) + `buscar "frango vivo"` | OK nos dois — `["01051200","02109911"]` (cap. 01/02, avicultura) |
| 8 | Bundle `main.js` (31.138 bytes) | contém `dirRecursosIa`; worker NÃO bundlado (fork externo preservado) |
| — | `electron-builder` (`dist:*`) | **NÃO executado** — exige rede (toolchains/winCodeSign). Ver §5 |

## 3. Estimativa de tamanho (bytes medidos hoje)

| Artefato | Bytes | MiB |
|---|---|---|
| `recursos-ia/dados-brutos/ncm-para-ia.json` | 3.239.325 | ~3,09 |
| `recursos-ia/indice-ncm/indice-lexical.json` | 1.102.017 | ~1,05 |
| `recursos-ia/indice-ncm/.manifest-hash` + `CHECKSUMS.txt` + READMEs | ~3.100 | ~0,00 |
| **Total `recursos-ia/` (vai ao instalador: ~4,34 MB)** | **4.344.430** | **~4,14** |
| `electron/dist/` (main+preload+worker+caminhos) | 110.693 | ~0,11 |
| `dist/` renderer | 8.694.217 | ~8,29 |
| `modelo/*.gguf` | 0 (ausente) | — |
| `embedding/` | 0 (ausente) | — |

**Projeção do instalador:** base atual (renderer + main + IA lexical ≈ 12,5 MB
descompactados) + Electron runtime (~80–120 MB por plataforma) + NSIS/DMG/
AppImage overhead → ordem de **~100–150 MB**, com folga ante o teto de
**≤300 MB**. O teto só entra em risco quando `embedding/` (06-03, centenas de
MB sem poda) e o GGUF (~97 MB) entrarem — nesse ponto aplicar a poda do spike:
1 plataforma CPU-only, removendo as optionals de 667 MB (`npm install` puxa
win-arm64/cuda/vulkan…), conforme `docs/spike-eletron-llama.md` §4 item 4.

## 4. Checklist UAT — 3 OS (pendente, com VMs + rede p/ toolchains)

Pré-requisito por OS (CI por OS — sem cross-packaging, achado §4 item 5 do spike):
`npm ci` **na própria plataforma** (traz o binário `node-llama-cpp` do host,
CPU-only) + GGUF 06-04 + embedding/índice 06-03 quando existirem.

Comandos exatos (na VM de cada OS, com rede liberada só p/ o build):
```powershell
# Windows 10 x64 (NSIS + portable)
npm run dist:win
# → release/AurumTaxNCM-Setup-1.0.0-win-x64.exe
```
```bash
# macOS (dmg + zip, x64 e arm64 — um build por arch hospedeiro)
npm run dist:mac
# → release/AurumTaxNCM-1.0.0-mac-x64.dmg / -arm64.dmg
# Linux (AppImage)
npx electron-builder --linux --publish never
# → release/*.AppImage
```

| # | Caso (repetir Win10 / macOS / Ubuntu, **VM limpa, SEM internet**) | Critério |
|---|---|---|
| U1 | Instalar + boot | abre sem erro, `ia:status` = `mock` (ou `modelo` pós-06-04) |
| U2 | Consulta fácil (`frango vivo`, `arroz branco`) | resolve via determinístico/sem IA, cálculo IBS/CBS exibido |
| U3 | Consulta `notebook` | Top-5 cap. 84/85, seleção restrita, carimbo `resolverClassificacoes` |
| U4 | Gibberish (`asdf qwer zxcv`) | `NÃO SEI`, sem código fictício |
| U5 | Sniff de rede no boot + consulta (Wireshark/`netstat`) | **zero** sockets externos (worker sem `fetch`/`net`) |
| U6 | Tamanho do instalador | **≤300 MB** por OS |
| U7 | Encerramento | sem `electron`/worker órfão (`Get-Process`/`ps` = 0) |
| U8 | `afterPack` no log do build | 6/6 ok + aviso mock (ou GGUF ok pós-06-04) |

## 5. Pendências (não executáveis offline / sem VM)

1. **Pack real** (`dist:win|dist:mac`, AppImage) — exige rede (download de
   toolchains electron-builder) + CI por OS (binário nativo do host).
2. **GGUF real** `ailo-152m-v2-q4_k_m.gguf` (~97 MB, 06-04) + hash em
   `CHECKSUMS.txt` — sem ele, instalador sai em mock (by design, com aviso).
3. **Embedding real + índice Vectra** (06-03) — ao chegarem, decidir embarque
   vs. download pós-instalação contra o teto de 300 MB (poda CPU-only).
4. **Repetir UAT** §4 nas 3 VMs limpas offline (U1–U8), incluindo sniff (U5).
5. **37 suítes legadas** não re-executadas aqui (nenhum arquivo de `src/` ou
   teste foi tocado; só `electron/ia/`, `esbuild.mjs`, `package.json#build`,
   `scripts/after-pack-ia.cjs` + este doc) — rodar `npm test` na UAT.
6. **Ofuscação + cifragem** (06-08) e `seguranca-ia.md` — fora deste plan.

## 6. Arquivos (working tree, sem commit)

- Criados: `electron/ia/caminhos-ia.cjs`, `scripts/after-pack-ia.cjs`,
  `docs/diagnostico-fase-6.md` (este).
- Editados: `package.json` (`build`: `afterPack`, `extraResources`,
  `asarUnpack`), `electron/ia/ia-service.cjs` (delega worker path),
  `electron/ia/ia-worker.cjs` (delega raiz), `electron/esbuild.mjs` (copia
  `caminhos-ia.cjs`).
- Gerados (git-ignorados, esperados): `electron/dist/*` rebuildado.
