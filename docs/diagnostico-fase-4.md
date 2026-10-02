# Diagnóstico Fase 4 — Integração Electron TRACER (IA-05 / 06-05)

**Plan:** 06-05 · **Data:** 2026-09-30 · **Modo:** tracer funcional (mock; sem GGUF no repo)
**Status: VERDE** — todos os critérios de passagem do tracer atendidos no Windows x64.

## 1. O que foi construído

| Arquivo | Papel |
|---|---|
| `electron/ia/ia-worker.cjs` (novo) | Worker CommonJS forkado em runtime (nunca bundlado). Handlers `init` / `buscar` / `selecionar` / `classificar` / `encerrar` + `pronto`. RAG lexical real sobre `recursos-ia/indice-ncm/indice-lexical.json` (porte CJS de `scripts/gerar-indice-ia.mjs`); seletor mock por overlap com expansão de sinônimos; caminho real via `await import('node-llama-cpp')` + prompt rígido (não exercitado — pacote ausente, falha controlada). |
| `electron/ia/ia-service.cjs` (novo) | Lado main: `iniciarIaService(app)` pós-`whenReady()`, `rpc()` com correlação por `id` + timeout 30 s, `statusIa()`, `classificarViaIa()` (fallback mock local `fallback:'main'` sem worker), `buscarViaIa()`, `encerrarIaService()` (kill síncrono). Bundlado em `main.js`. |
| `electron/main.ts` (patch) | Handlers `ia:classificar`, `ia:buscar`, `ia:status`; `iniciarIaService()` pós-`whenReady()` (falha não impede a UI); `encerrarIaService()` em `before-quit`. |
| `electron/preload.ts` (patch) | `window.aurum.ia.{classificar,buscar,status}` via `contextBridge` (só IPC; LLM nunca no renderer). |
| `electron/esbuild.mjs` (patch) | `external: node-llama-cpp, @xenova/transformers, vectra`; copia `ia-worker.cjs` → `electron/dist/` sem bundle. |
| `src/infrastructure/bridge.ts` (patch) | Tipos `CandidatoIa`, `ResultadoIaBridge`, `StatusIaBridge`, `IaBridge`; `AurumBridge.ia`. |
| `src/store/ia.ts` (novo) | Zustand: `status/modo/mock/erro`, `candidatos`, `ultimaDecisao`, `historico` (20), `totalConsultas/consultasIa`, `taxaUsoIa()`. |
| `src/application/classificacao-ia.ts` (novo) | GATE: `classificarPorDescricao()` primeiro → `ncm_provavel` + `alta` retorna `via:'deterministico'` sem chamar o worker; senão Top-5 RAG → worker (ou mock local fora do Electron) → `resolverClassificacoes()`; `NÃO SEI` sem código. |
| `src/pages/DebugIA.tsx` (novo) | View oculta (`Ctrl+Shift+D`, registrado no `Layout`): status do worker, candidatos, decisão, `via`, `taxa_uso_ia` parcial. Renderiza sem esperar o modelo. |
| `src/store/ui.ts`, `src/App.tsx` (patch) | View `debugia` oculta (fora do menu; paridade das 7 telas preservada na navegação). |

`package.json` **intocado por este plan** (diff existente é de plans paralelos — só scripts `ia:*`; nenhuma dep prod/dev alterada; `package-lock.json` limpo). `node-llama-cpp` **não instalado** (tracer usa mock, conforme preferência do plan).

## 2. Evidências (critérios do tracer)

| Critério | Resultado |
|---|---|
| UI renderiza antes do modelo carregar | **OK — 40.2 ms** primeira pintura da `DebugIA` em jsdom (teste temporário, removido após medição); nenhum `await` no caminho de render — status do worker é assíncrono via efeito |
| Candidato válido exibido | **OK** — `frango vivo para abate` → `01051200` (cap. 01); `notebook com processador` → `84718000` (cap. 84); round-trip via `fork` Node puro (mesmo protocolo do `utilityProcess`) |
| Falha segura | **OK** — `xyzq blorp inexistente qqq` → `NÃO SEI` (`similaridade-insuficiente`) |
| Worker morre em `before-quit` | **OK (código + teste)** — `encerrarIaService()` (post `encerrar` best-effort + `kill()` síncrono) ligado em `app.on('before-quit')`; teste fork: `process.kill(pid,0)` após `encerrar` → processo morto, **sem órfãos** |
| Nenhuma chamada de rede | **OK — 0 ocorrências** de `fetch(`/`node:net`/`node:http`/`node:dns`/`child_process`/`worker_threads`/`WebSocket`/etc. no código executável do worker (checagem com comentários removidos; os 3 hits do grep cru são só comentários) |
| Latência IPC | spawn→`pronto` **64 ms**; `init` mock **0 ms**; `classificar` **9–10 ms** (inclui RAG sobre 2335 docs); RSS worker **~33 MB** sem modelo |
| Regressões | `tsc --noEmit` **exit 0**; `vitest run` **37 arquivos / 380 testes verdes**; `electron/esbuild.mjs` **exit 0** (main + preload + worker copiado) |
| Dedup RAG | índice tem 1 doc por vínculo (2335); `buscar` devolve 1 por NCM (ex.: frango → `01051200,02109911,01051300,01051400`) |

## 3. Decisões de tracer (débito explícito p/ 06-06+)

1. **Mock por padrão** — sem GGUF offline; `init {modelPath}` implementado mas não exercitado (gate C2 do spike: medir load/inferência/RAM com `ailo-152m-v2` real na 06-04).
2. **Descrição do candidato = `descricaoExpandida`** (nomenclatura pura como `-- Peruas e perus` não dá overlap com linguagem comercial; a expandida traz capítulo + vínculo). O LLM real (06-04) usará o mesmo campo no prompt rígido.
3. **Sinônimos também no seletor mock** (espelha o RAG) — sem isso, `notebook` dava `NÃO SEI` mesmo com RAG correto.
4. **Gate mora no renderer** (`classificacao-ia.ts`) com mock local fora do Electron; o teste de bypass (06-09) usa o hook `aoWorker`.
5. **`debugia` é view oculta**, não 8ª tela — sem item de menu, sem quebra da paridade SPEC §10.

## 4. Pendências → 06-06 (Fluxo Consulta Completo)

- P1 — Repetir harness nas 3 VMs com GGUF real (gate C1 do spike; aqui só Windows x64 + mock).
- P2 — `src/infrastructure/ia/classificacao-ia-repo.ts` + aba "Sugestão IA" na `Consulta.tsx` (badge `via`, feedback "Não é esse").
- P3 — Dexie v8→v9 (`ia_feedback`, `via`, `taxa_uso_ia`) + `logs/consultas-ia.jsonl` (migração com rollback test).
- P4 — `worker IA em paralelo` no `store/consulta.ts` só no fallback (guards `seq*`).
- P5 — `docs/diagnostico-fase-5.md` com 10 testes de negócio (5 determinísticos sem IA + 5 fallback).
