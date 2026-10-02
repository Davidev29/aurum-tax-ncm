# Arquitetura IA Offline — Phase 6 (IA-10 / plan 06-10)

**Data:** 2026-09-30 · **Status:** implementado, UAT pendente (GGUF real + pack 3 OS)
**Princípio:** IA como **camada superior** ao motor determinístico, nunca substituta.
Escopo: somente NCM de 8 dígitos. NBS explicitamente fora de escopo.

## 1. Topologia

```
┌──────────────────────────────────────────────────────────────┐
│  UI (renderer React)                                         │
│  Consulta.tsx ──aba "Sugestão IA" (só quando via==='ia')──┐  │
│  DebugIA.tsx (view oculta, Ctrl+Shift+D)                   │  │
│  stores: consulta.ts · ia.ts (Zustand)                      │  │
└──────────────────────────────┬───────────────────────────────┘
                               │ window.aurum.ia (preload contextBridge)
┌──────────────────────────────▼───────────────────────────────┐
│  Main (electron/main.ts)                                     │
│  ipcMain.handle ia:classificar / ia:buscar / ia:status       │
│  ia-service.cjs: spawn utilityProcess pós-whenReady,         │
│  rpc por id + timeout 30s, kill em before-quit               │
└──────────────────────────────┬───────────────────────────────┘
                               │ protocolo {id,cmd}→{id,ok,…}
┌──────────────────────────────▼───────────────────────────────┐
│  Worker (electron/ia/ia-worker.cjs, fork — nunca bundlado)   │
│  handlers: init / buscar / selecionar / classificar /encerrar│
│  RAG lexical sobre indice-lexical.json (2335 vínculos);      │
│  seletor mock por overlap (hoje); node-llama-cpp via         │
│  import() dinâmico quando houver GGUF (não instalado)        │
│  SEM rede: nenhum fetch/net/http no código executável        │
└──────────────────────────────┬───────────────────────────────┘
                               │ código escolhido (ou NÃO SEI)
┌──────────────────────────────▼───────────────────────────────┐
│  Domínio (única fonte de verdade tributária)                 │
│  resolverClassificacoes() → decisão oficial + regraGeral     │
│  calcularTributos() → IBS/CBS sobre VALOR_BASE_IA (R$ 1.000) │
└──────────────────────────────┬───────────────────────────────┘
                               │ decisão validada / NÃO SEI
┌──────────────────────────────▼───────────────────────────────┐
│  Trilha: Dexie audit_log + ia_feedback (schema v9)           │
│  + logs/consultas-ia.jsonl + logs/metricas-ia.jsonl          │
└──────────────────────────────────────────────────────────────┘
```

## 2. Fluxo de decisão (gate — `src/application/classificacao-ia.ts`)

1. `classificarPorDescricao()` roda **primeiro** (`classificacao-inteligente.ts:141`).
   Se retorna `ncm_provavel` com confiança `alta` → `via: 'deterministico'`,
   worker **nem é chamado** (bypass provado em `tests/ia/bypass-deterministico.test.ts`).
2. Senão (`null` ou `baixa`/`media`) → Top-5 RAG (`buscarNomenclaturaPorTexto`)
   → worker `ia:classificar` (ou mock local fora do Electron)
   → escolha validada por `resolverClassificacoes()`.
3. Falha segura: escolha `NÃO SEI` (ou código fora da nomenclatura vigente) →
   `codigoEscolhido: null`, sem decisão, sem cálculo, sem código fictício.
   O gate exige `lista.length > 0 && !extinto && nomenclatura != null`
   (fix 06-09: bloqueia alucinação `99999999`, que resolve para regra geral
   com `nomenclatura: null`).

## 3. Contratos IPC

| Canal | Direção | Payload | Resposta |
|---|---|---|---|
| `ia:classificar` | renderer→main→worker | `(descricao: string, candidatos: CandidatoIa[])` | `{codigo, confianca, motivo, mock}` |
| `ia:buscar` | renderer→main→worker | `(consulta: string, k?: number)` | Top-k RAG (DebugIA) |
| `ia:status` | renderer→main | — | `desligado`/`mock`/`modelo` (+ `erro?`) |

Protocolo worker: mensagens `{id, cmd, …}` → `{id, ok, …}`; cmds
`init {modelPath?}` / `buscar` / `selecionar` / `classificar` / `encerrar` + `pronto`.
Timeout 30 s no service; `encerrarIaService()` (post `encerrar` best-effort + `kill()`
síncrono) ligado em `app.on('before-quit')` — sem órfãos.

## 4. Onde mora cada arquivo

| Camada | Arquivos |
|---|---|
| Worker / main | `electron/ia/ia-worker.cjs`, `ia-service.cjs`, `caminhos-ia.cjs`, `modelo-seguro.cjs`; patches `electron/main.ts`, `preload.ts`, `esbuild.mjs` (external `node-llama-cpp`/`@xenova/transformers`/`vectra`, cópia do worker p/ `dist/`) |
| Gate aplicação | `src/application/classificacao-ia.ts` (`classificarComIa` + `aoWorker` p/ bypass) |
| Infra Consulta | `src/infrastructure/ia/classificacao-ia-repo.ts` (`classificarComIA`, `VALOR_BASE_IA=1000`, `anexarConsultaIaJsonl`, `registrarFeedbackIa`) |
| Stores/UI | `src/store/ia.ts` (`via`, `taxaUsoIa()`), `src/store/consulta.ts`, `src/pages/Consulta.tsx` (`SecaoSugestaoIa`), `src/pages/DebugIA.tsx`, `src/store/ui.ts` (view oculta `debugia`), `src/ui/Layout.tsx` (Ctrl+Shift+D) |
| Dados/scripts | `scripts/preparar-dados-ia.mjs`, `validar-dados-ia.mjs`, `gerar-indice-ia.mjs`, `testar-indice-ia.mjs`, `testar-modelo-ia.mjs`, `ofuscar-ia.cjs`, `criptografar-modelo-ia.mjs`, `after-pack-ia.cjs`; patch `scripts/build-base.mjs` (gatilho por hash) |
| Artefatos | `recursos-ia/{modelo,embedding,indice-ncm,dados-brutos}/`, `CHECKSUMS.txt`, `README.md` |
| Testes | `tests/ia/{classificacao-ia,bypass-deterministico,validacao-deterministica,performance}.test.ts` + `ajuda-ia.ts` |
| Docs | `docs/spike-eletron-llama.md`, `diagnostico-fase-{0,1,2,3,4,5,6,8}.md`, `seguranca-ia.md`, este + `manual-atualizacao-ia.md`, `troubleshooting-ia.md`, `diagnostico-final-ia.md` |

## 5. Decisões camada-superior (por que o desenho é assim)

- **Determinístico primeiro:** `classificarPorDescricao` já resolve casos fáceis com
  RGI + tokenização; IA só no fallback mantém `taxa_uso_ia` < 30% (medido 23,3%).
- **RAG fechada:** LLM nunca sintetiza código — só escolhe 1 entre Top-5 homologados
  de `public/base/` (prompt rígido em `testar-modelo-ia.mjs:66`).
- **Resolver como única verdade:** nenhuma saída IA chega à UI sem
  `resolverClassificacoes` (`classification-repo.ts:223`).
- **Worker isolado sem rede:** segredo fiscal nunca sai da máquina; grep prova
  ausência de `fetch`/`net.connect` no worker (diagnóstico-fase-4 §2).
- **`recursos-ia/` fora de `public/`:** embarque via `extraResources` (nunca bundle
  web), resolução via `process.resourcesPath` em prod (`caminhos-ia.cjs`).
- **Índice lexical fallback:** rede indisponível p/ `@xenova/transformers`+Vectra;
  TF-IDF/BM25-lite JSON puro (1,05 MB) com mesma interface `buscarIndice()` —
  troca pelo Vectra real é só regenerar (diagnostico-fase-2).
- **Mock por padrão:** sem GGUF offline; caminho real `init{modelPath}` já
  implementado no worker, não exercitado (gate C2 do spike).

## 6. NÃO SEI (falha segura)

Retornado quando: 0 candidatos RAG (`sem-candidatos`), similaridade abaixo do corte
(`similaridade-insuficiente`), ou código não homologado na nomenclatura vigente.
Efeito: `codigoEscolhido: null`, `decisao: null`, `calculo: null`, trilha com
`via` + `motivo`, UI exibe "NÃO SEI" sem código. Taxa NÃO SEI visível na DebugIA.
