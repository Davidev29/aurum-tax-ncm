# Spike IA-00 — Viabilidade `node-llama-cpp` + `utilityProcess` no Electron 44

**Plan:** 06-00 · **Branch:** `spike/electron-llama` · **Data:** 2026-09-30
**Decisão: GO CONDICIONAL** (Windows x64 validado de ponta a ponta; condições em §5)

## 1. Ambiente medido

| Item | Valor |
|---|---|
| OS / arch | Windows 10 build 19045 (Win32NT 10.0.19045.0), x64 |
| Electron | 44.4.5 · Node embutido 24.21.0 |
| Node host | v24.19.0 · npm 11.17.0 |
| `node-llama-cpp` | 3.22.1 (instalado **isolado** em `%TEMP%\spike-llama`, `npm install --no-save`; `package.json`/`package-lock.json` do repo **intocados** — `git diff` vazio) |
| Modelo GGUF | **nenhum disponível offline** — load/inferência real com mock (limitação §6) |

## 2. Artefatos do spike (nesta branch, isolados do build)

- `electron/spike/ia-spike-worker.cjs` — worker sem dependências, protocolo `{id,cmd}→{id,ok,…}` (`init`/`classificar`/`encerrar` + `pronto`), transporte duplo `process.parentPort` (utilityProcess) / `process.send` (fork). Seletor mock determinístico por overlap de tokens, com `NÃO SEI` sob limiar.
- `electron/spike/ia-spike-main.ts` — `runSpikeRoundTrip(workerPath)` (spawn pós-`whenReady`, `rpc()` com timeout 15 s, kill de segurança espelhando o `before-quit` do plano real) + `killIaSpikeWorker()`.
- `electron/spike/ia-spike-electron-run.cjs` — harness headless (sem `BrowserWindow`): imprime `SpikeReport` JSON no stdout, exit 0/1.

## 3. Medidas (critérios do plano: load <10 s, IPC <50 ms, sem órfãos, 3 OS)

| # | Medida | Resultado | Critério |
|---|---|---|---|
| 1 | `getLlama()` Node 24 puro (binding nativo win-x64) | **OK, 1826 ms** | load <10 s ✓ (sem modelo) |
| 2 | `getLlama()` **dentro do main process Electron 44** (via `import()`, sem rebuild) | **OK, 944 ms** | load <10 s ✓ |
| 3 | `getLlama()` **dentro de `utilityProcess`** (topologia de produção) | **OK: spawn→pronto 100 ms, load 958 ms, RSS worker 117,6 MB** | load <10 s ✓ |
| 4 | Round-trip `init→3×classificar→encerrar` via `utilityProcess` (2 runs) | **spawn→pronto 94–111 ms; IPC 0–1 ms; encerrar 0 ms; wall total ~2 s** | IPC <50 ms ✓ |
| 5 | Comportamento do seletor mock | `frango vivo`→`01022911` (0,5); `notebook`→`84713012` (1,0); gibberish→`NÃO SEI` | fail-safe plausível ✓ |
| 6 | Órfãos pós-quit | `workerVivoAposKill=false`; `Get-Process electron` = **0** após cada run | sem órfãos ✓ (Windows) |
| 7 | macOS / Linux | **não testados (sem VMs)** | ⚠ pendente — condição §5 |

Notas: `UtilityProcess.pid` veio `undefined` no 44.4.5 (relatório registra `workerPid: null`); a verificação de órfãos foi feita por contagem de processos, e o módulo real deve manter o mesmo padrão (kill em `before-quit` + `try process.kill(pid,0)` quando o pid existir).

## 4. Achados que viram restrição de implementação (06-05/06-07)

1. **ESM-only (v3):** `require('node-llama-cpp')` no main CJS falha (`ERR_REQUIRE_ASYNC_MODULE`). Usar `await import(fileUrl)` — worker `.cjs` + `import()` dinâmico funciona nos 3 contextos testados.
2. **Nunca bundlar:** `node-llama-cpp` deve ser `external` no `electron/esbuild.mjs` (a estrutura de arquivos + binários nativos é load-bearing; guia oficial exige ASAR com binários fora do `.asar` → `asarUnpack` em 06-07).
3. **Main process apenas:** a lib declara crash em renderer — confirma o desenho (LLM só no worker `utilityProcess`, nunca no renderer/preload).
4. **Tamanho (orçamento ≤300 MB em risco sem poda):** pacote JS 37,8 MB + binário **win-x64 CPU 29,3 MB**, mas `npm install` puxa **todas** as optionals (win-arm64/cuda/vulkan…) = **667 MB**. 06-07 **deve** podar para 1 plataforma CPU-only (+ GGUF ~97 MB + embedding + índice Vectra). Sem poda, estoura.
5. **Sem cross-packaging:** a lib não baixa binários de outras plataformas (`npm install` numa máquina só traz o host). Instaladores mac/Linux exigem **CI por OS** (template GH Actions no guia oficial). macOS arm64→x64 ok; contrário, não.
6. **Precedente oficial:** `@electron/llm@1.2.0` (pacote do próprio Electron) usa exatamente `node-llama-cpp` + `utilityProcess` + Mojo IPC — mesma topologia do plano.
7. **RAM parcial:** 117,6 MB RSS com runtime carregado **sem modelo**. Os ~300 MB com `ailo-152m-v2-q4_k_m` (~97 MB) ficam para 06-04; nada nos números atuais sugere estouro dos 500 MB de teto.

## 5. Condições do GO (viram gates de 06-04/06-05)

- C1 — Repetir este harness nas **3 VMs** (Win10/macOS/Ubuntu) no tracer 06-05, com GGUF real pequeno; só então GO total.
- C2 — Medir com modelo real: load <10 s, inferência <3 s CPU (<5 s teto), RSS <500 MB.
- C3 — `electron-builder`: `asarUnpack` de `node-llama-cpp` + binário da plataforma, poda das optionals, `extraResources` de `recursos-ia/`; teste de boot offline por OS.
- C4 — Grep/prova de ausência de `fetch`/`net.connect` no worker (segregação de rede).

## 6. Limitações deste spike (declaradas)

- Load/inferência **mock** — sem GGUF offline, tempos reais de modelo não medidos.
- Só Windows x64; macOS/Linux pendentes (sem VMs no host).
- Caminho `build from source` (sem binário prévio) não exercitado — não foi preciso (prebuilt win-x64 carregou sem rebuild, Node 24 do Electron 44 alinhado ao Node 24 do sistema).

## 7. Alternativas se NO-GO futuro (pivot, por ordem)

1. **CLI `llama.cpp` sidecar** (`llama-server` local + HTTP em `127.0.0.1`): isola ABI nativa, custa um binário extra por OS e quarentena de porta local.
2. **`@electron/llm`** (wrapper oficial sobre a mesma stack): menos controle sobre prompt restrito/RAG, avaliar em 06-04.
3. **Modelo menor / fallback RAG-puro** (Top-1 Vectra + `NÃO SEI` agressivo, sem LLM): já previsto como degradado no plano (§8, risco RAM/latência).

## 8. Reprodução

```powershell
npx esbuild electron/spike/ia-spike-main.ts --bundle --platform=node --format=cjs --external:electron --outfile="$env:TEMP\ia-spike\ia-spike-main.cjs"
npx electron electron/spike/ia-spike-electron-run.cjs
Get-Process electron  # deve ser 0 após o término
```

Probes ABI (arquivos em `$env:TEMP\ia-spike\`, fora do repo): `getLlama()` no main e no `utilityProcess` — ambos OK (§3, itens 2–3).

## 9. Próximos passos para 06-01

1. Manter branch `spike/electron-llama` como referência; **não** mergear worker/mock no `main`.
2. 06-01: criar `recursos-ia/{modelo,embedding,indice-ncm,dados-brutos}/`, `.gitignore` (`*.gguf`, índice, `logs/*.jsonl`), `CHECKSUMS.txt`; auditar `npm ls` (electron@44, builder@26, resto).
3. 06-04: adquirir `ailo-152m-v2-q4_k_m.gguf` + `scripts/testar-modelo-ia.mjs` reaproveitando o protocolo deste spike (trocar `mock:true` por `modelPath` real — o caminho `init{modelPath}` já está implementado no worker).
4. 06-05: derivar `electron/ia/ia-service.cjs` de `ia-spike-main.ts` (adicionar `external: ['node-llama-cpp']` no esbuild, `import()` dinâmico, kill em `before-quit`) e repetir §8 nas 3 VMs (gate C1).
