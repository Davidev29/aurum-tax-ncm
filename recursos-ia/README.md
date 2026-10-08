# recursos-ia — Artefatos de busca local determinística

> ⚠️ **Nota de legado (08/10/2026):** este README descrevia o worker LLM com GGUF
> (`Qwen3.5-2B`, `ia-worker.cjs`, embeddings neurais). **Esse worker foi removido.**
> Hoje `electron/ia/` tem só `grafo-service.cjs` + `caminhos-ia.cjs`, o app não
> embarca nem baixa nenhum `.gguf`, e a classificação é 100% determinística
> (léxico + sinônimos + grafo + resolvedor). O conteúdo abaixo sobre GGUF/embeddings/
> Vectra é **histórico para experimentos** — não é exigido pelo `npm run base`,
> `npm run build` nem pelo instalador. Se for reativar LLM um dia, revalidar tudo.

# recursos-ia — Artefatos de IA offline (Phase 6) — LEGADO

Diretório **fora de `public/`** (decisão 06-01: embarcado via `extraResources` do
electron-builder em 06-07, nunca via bundle web). Nada aqui vai para o git
além de `.gitkeep`, `README.md` e `CHECKSUMS.txt` — GGUF, embeddings e índice
são ignorados (ver `.gitignore`: `*.gguf`, `recursos-ia/indice-ncm/*`,
`recursos-ia/embedding/*`, `logs/*.jsonl`, a cargo de 06-01).

## Onde colocar o modelo (camada de compatibilidade — qualquer GGUF)

```text
recursos-ia/modelo/<qualquer-nome>.gguf   (oficial: Qwen3.5-2B-Q4_K_M.gguf, ~1221MB, Q4_K_M, pin em modelo/modelo.json)
recursos-ia/modelo/modelo.json            (pin oficial do modelo + overrides; copie de modelo.json.example)
```

1. O modelo oficial é o **Qwen3.5-2B-Q4_K_M** (pin em `modelo.json`, família `qwen3`, ctx 4096).
   A descoberta continua automática: `modelo.json:arquivo` → env `AURUM_IA_MODEL` →
   legado `Qwen3-0.6B-Q8_0.gguf` (compat) → qualquer `*.gguf`. Ver
   `docs/camada-modelo-rag.md` + `electron/ia/perfil-modelo.cjs`.
2. Valide a integridade contra `recursos-ia/CHECKSUMS.txt`:
   ```powershell
   certutil -hashfile recursos-ia\modelo\<nome>.gguf SHA256
   node scripts/testar-modelo-ia.mjs        # valida SHA + inferência real restrita
   ```
3. Sem nenhum `.gguf`, o script roda em **modo MOCK** (seletor determinístico por
   overlap de tokens, mesma semântica do spike `electron/spike/ia-spike-worker.cjs`)
   e mede latência/RAM do mock. O modo mock NÃO prova orçamento de modelo real.

## Layout

| Caminho | Conteúdo | Versionado? |
|---|---|---|
| `modelo/Qwen3.5-2B-Q4_K_M.gguf` | LLM local Q4_K_M (~1221MB) | NÃO (`*.gguf`) |
| `embedding/` | `all-MiniLM-L6-v2` (06-03) | NÃO |
| `indice-ncm/` | Índice Vectra <200MB (06-03) | NÃO |
| `dados-brutos/ncm-para-ia.json` | Base 2335 NCMs (06-02) | SIM (pequeno) |
| `CHECKSUMS.txt` | SHA256 dos artefatos | SIM |

## Orçamento (IA-04, Qwen3.5-2B-Q4_K_M — medido 2026-10-06)

Inferência 0.9–2.7s/caso CPU moderna (teto 15s), load ~8.6s, RAM processo
~2.2GB (teto 2.6GB). Medido via `scripts/testar-modelo-ia.mjs` — ver
`docs/diagnostico-fase-3.md` (orçamento anterior do AILO-152M: <3s/~300MB;
intermediário Qwen3-0.6B-Q8_0: load 5.6s, ~0.4s/caso, ~1.3GB).
Requisito de máquina: 8 GB RAM recomendados (worker IA + grafo + SO).

## Como recriar cada artefato (06-01)

| Artefato | Script gerador | Origem |
|----------|---------------|--------|
| `dados-brutos/ncm-para-ia.json` | `scripts/preparar-dados-ia.mjs` (06-02) | `public/base/*.json` |
| `embedding/` (pesos) | download 06-03 (`all-MiniLM-L6-v2`, fallback `multilingual-e5-small`) | HuggingFace (uma vez, depois offline) |
| `indice-ncm/` (Vectra) | `scripts/gerar-indice-ia.mjs` (06-03) | `dados-brutos/` + `embedding/` |
| `modelo/*.gguf` | aquisição manual (oficial Qwen3.5-2B-Q4_K_M, ~1221MB) | HuggingFace (Qwen3.5-2B-GGUF) |

```powershell
certutil -hashfile recursos-ia/modelo/Qwen3.5-2B-Q4_K_M.gguf SHA256
# colar o hash em CHECKSUMS.txt no lugar do placeholder
```

## Regras de versionamento (06-01)

```
*.gguf
recursos-ia/indice-ncm/*
recursos-ia/embedding/*
logs/*.jsonl
!recursos-ia/README.md
!recursos-ia/CHECKSUMS.txt
!recursos-ia/.gitkeep
!recursos-ia/*/.gitkeep
```
