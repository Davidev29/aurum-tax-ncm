# Diagnóstico Fase 3 — Modelo de Linguagem [IA-04] (Plan 06-04)

**Data:** 2026-09-30 · **Status: MOCK VERDE / REAL PENDENTE (offline, sem rede)**
**Artefato de teste:** `scripts/testar-modelo-ia.mjs` · **Modelo alvo:** `ailo-152m-v2-q4_k_m.gguf` (~97MB)

## 1. Status: MOCK vs REAL

| Item | Estado |
|---|---|
| `recursos-ia/modelo/` + `.gitkeep` | CRIADO |
| `recursos-ia/README.md` (onde colocar o GGUF) | CRIADO |
| `recursos-ia/CHECKSUMS.txt` | CRIADO com placeholder `PENDENTE-OFFLINE-SEM-REDE` (hash real pendente) |
| GGUF `ailo-152m-v2-q4_k_m.gguf` | AUSENTE (ambiente offline — download proibido nesta execução) |
| `node-llama-cpp` no `package.json` | INTENCIONALMENTE AUSENTE (script usa `import()` dinâmico + try/catch; `git diff package.json` vazio para este plan) |
| Modo MOCK | VERDE — exit 0 |

### Resultado mock (2026-09-30, Node v24.19.0, Win x64)

```text
[06-04] Modelo IA — modo MOCK
  - frango-vivo: codigo=0105.94.00 motivo=mock-overlap ms=1 rss=35.13MB
  - notebook: codigo=8471.30.12 motivo=mock-overlap ms=1 rss=35.26MB
  - gibberish: codigo=NÃO SEI motivo=similaridade-insuficiente ms=0 rss=35.26MB
[06-04] acertos=3/3 restricao100=true latMax=1ms rssMax=35.26MB
```

- **Restrição 100%**: toda saída é código da lista de candidatos ou `NÃO SEI`
  (coerção em `interpretarSaida()`; violação → exit 2). Gibberish → `NÃO SEI`.
- **Latência/RAM do mock NÃO provam o orçamento do modelo real** — medem só o
  seletor determinístico (~35MB RSS do próprio Node). Orçamento real pendente §3.

## 2. Prompt rígido (contrato para 06-05)

`montarPromptRigido(descricao, candidatos)` em `scripts/testar-modelo-ia.mjs:66`:

1. Responda SOMENTE com o NÚMERO do candidato (1..N) ou `NÃO SEI`.
2. NUNCA invente, complete ou sugira código NCM fora da lista.
3. Sem confiança suficiente → `NÃO SEI`. Nenhum texto extra.

O worker real (`electron/ia/ia-worker.cjs`, 06-05) deve reaproveitar este prompt
via `init{modelPath}` — caminho já previsto no spike (`docs/spike-eletron-llama.md` §9.3).
Detalhe ESM-only (spike §4.1): `node-llama-cpp` v3 exige `await import()`; o script
já segue esse padrão, e `electron/esbuild.mjs` deverá marcá-lo `external` (06-05/06-07).

## 3. Como adquirir o modelo real (quando houver rede)

1. Obter `ailo-152m-v2-q4_k_m.gguf` (~97MB, quant `q4_k_m`) da fonte oficial do projeto AILO
   e copiar para `recursos-ia/modelo/` com exatamente esse nome.
2. Registrar o SHA256 real em `recursos-ia/CHECKSUMS.txt` (substituir a linha `PENDENTE-…`):
   ```powershell
   certutil -hashfile recursos-ia\modelo\ailo-152m-v2-q4_k_m.gguf SHA256
   ```
3. Instalar a lib **sem salvar** (não poluir o ciclo de vida do app — deps prod em 06-05):
   ```powershell
   npm i --no-save node-llama-cpp
   node scripts/testar-modelo-ia.mjs        # valida SHA + inferência real restrita
   ```
4. O script ABORTA (exit 1) se o hash divergir ou ainda for placeholder — GGUF
   não confiável nunca é carregado.

## 4. Orçamento [IA-04]

| Métrica | Meta | Teto | Medido |
|---|---|---|---|
| Latência inferência (CPU) | <3s (moderna) | <5s (x86_64 básico) | MOCK ~1ms · REAL pendente |
| RAM processo worker | ~300MB (GGUF ~97MB) | <500MB | MOCK ~35MB · REAL pendente (spike: 117,6MB runtime sem modelo — margem plausível) |

Verificação real (gate C2 do spike): `latenciaOk`/`rssOk` no `--json` do script.
Se estourar: fallback Top-1 RAG sem LLM + `NÃO SEI` agressivo (risco §8 do plano).

## 5. Pendências para 06-05 (tracer)

- [ ] P1 — Repetir este script com GGUF real: `node scripts/testar-modelo-ia.mjs` deve
      sair em modo REAL com `restricao100=true`, latência e RSS dentro do teto.
- [ ] P2 — `electron/ia/ia-worker.cjs`: handlers `init{modelPath}`, `buscar`,
      `selecionar` (prompt §2), `encerrar`; `import()` dinâmico; grep prova
      ausência de `fetch`/`net.connect`.
- [ ] P3 — `electron/ia/ia-service.cjs` derivado de `electron/spike/ia-spike-main.ts`;
      kill em `before-quit`; repetir harness nas 3 VMs (gate C1 do spike).
- [ ] P4 — `npm i node-llama-cpp` (prod, 06-05) + `external: ['node-llama-cpp']` no esbuild.
- [ ] P5 — Atualizar esta linha de `CHECKSUMS.txt` com o hash real antes de qualquer inferência.
