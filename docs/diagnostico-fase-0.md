# Diagnóstico Fase 0 — Ambiente e Preparação (IA-01 / plan 06-01)

**Data:** 2026-09-30 · **Branch:** `spike/electron-llama` (trabalho na working tree, sem commit)
**Spike de referência:** `docs/spike-eletron-llama.md` (decisão: GO CONDICIONAL, Windows x64 validado)

## 1. Tabela de conformidade — versões exigidas vs encontradas (`npm ls`)

| Pacote | Exigido (06-01) | Encontrado | Status |
|--------|-----------------|------------|--------|
| electron | 44.x | 44.4.5 | ✓ |
| electron-builder | 26.x | 26.15.3 | ✓ |
| react (+ react-dom) | 19.x | 19.3.0 | ✓ |
| typescript | 5.9.x | 5.9.3 | ✓ |
| vite | 8.x | 8.3.1 | ✓ |
| dexie | 4.x | 4.4.6 (+ dexie-react-hooks 4.4.0) | ✓ |
| zustand | 5.x | 5.0.15 | ✓ |
| vitest | 5.x | 5.0.2 | ✓ |
| Node host / npm | — (info) | Node v24.19.0 | info |
| Node embutido Electron 44 | — (info) | 24.21.0 (medido no spike §1) | info |
| `node-llama-cpp` | ainda NÃO instalar (só em 06-03 dev / 06-05 prod) | 3.22.1 isolado em `%TEMP%\spike-llama` (`--no-save`, repo intocado) | ✓ por desenho |

Todas as 8 versões-alvo conferem (majors 44/26/19/5.9/8/4/5/5).

## 2. `utilityProcess` no Electron 44

- Confirmado em código + runtime pelo spike: `electron/spike/ia-spike-main.ts`
  (`runSpikeRoundTrip`, spawn pós-`whenReady()`) e harness
  `electron/spike/ia-spike-electron-run.cjs` — spawn→pronto 94–111 ms,
  IPC 0–1 ms, zero órfãos pós-quit no Windows (spike §3, itens 3/4/6).
- Observação load-bearing: `UtilityProcess.pid` veio `undefined` no 44.4.5;
  verificação de órfãos por contagem de processos + kill em `before-quit`
  (manter o padrão no módulo real, 06-05). Ver `docs/spike-eletron-llama.md` §3-nota e §4.

## 3. Estrutura `recursos-ia/` (fora de `public/`, via `extraResources` em 06-07)

```
recursos-ia/
├── README.md            # como recriar cada artefato (versionado)
├── CHECKSUMS.txt        # placeholders SHA256 (versionado)
├── .gitkeep
├── modelo/.gitkeep      # *.gguf, 06-04 (~97MB) — ignorado
├── embedding/.gitkeep   # pesos transformers, 06-03 — ignorado
├── indice-ncm/.gitkeep  # índice Vectra, 06-03 — ignorado
└── dados-brutos/.gitkeep # ncm-para-ia.json, 06-02
```

**Checkpoint (one-way):** `recursos-ia/` fora de `public/` implica empacotamento por
`extraResources` + resolução via `process.resourcesPath` (não via Vite `public/`).
Afeta 06-07. Requer confirmação do orquestrador antes de 06-02.

## 4. `.gitignore` — blindagem (plan 06-01 §tasks-4 + exceções)

```
*.gguf
recursos-ia/indice-ncm/*
recursos-ia/embedding/*
logs/*.jsonl            # trilha auditoria IA (06-06; `logs/` já ignora tudo)
!recursos-ia/README.md
!recursos-ia/CHECKSUMS.txt
!recursos-ia/.gitkeep
!recursos-ia/*/.gitkeep
```

Nota: usa-se `indice-ncm/*` (e não `indice-ncm/`) porque o git não permite
re-incluir arquivos dentro de um diretório excluído — assim o `.gitkeep`
estrutural continua versionado e todo o resto do índice segue bloqueado.

Verificação: `git check-ignore -v` bloqueia `.gguf` simulado (§5).

## 5. Verificações executadas

- [x] `npm ls electron electron-builder react typescript vite dexie zustand vitest` — 8/8 conformes (§1).
- [x] `git check-ignore -v recursos-ia/modelo/teste.gguf` → bloqueado por `*.gguf` (evidência abaixo).
- [x] `git status --porcelain` — nenhum binário/`.gguf`/índice listado; só arquivos-fonte esperados.
- [ ] Gate C1 do spike (3 VMs com GGUF real) — pendente, vira gate de 06-04/06-05.

## 6. Pendências para 06-02 (Curadoria de Dados)

1. Orquestrador confirmar checkpoint `recursos-ia/` fora de `public/` (one-way → `extraResources`).
2. `scripts/preparar-dados-ia.mjs` + `validar-dados-ia.mjs` (join `public/base/*.json`, 2335 NCMs, sem NBS).
3. Emitir `recursos-ia/dados-brutos/ncm-para-ia.json` + preencher seu hash em `CHECKSUMS.txt`.
4. `npm i --save-dev @xenova/transformers vectra` fica para 06-03 (NÃO instalar agora).
5. `node-llama-cpp` prod fica para 06-05 (manter isolado até lá).
6. Repetir harness do spike nas 3 VMs com GGUF real (gate C1, em 06-04/06-05).
