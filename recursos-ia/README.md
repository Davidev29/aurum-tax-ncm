# recursos-ia — Artefatos de IA offline (Phase 6)

Diretório **fora de `public/`** (decisão 06-01: embarcado via `extraResources` do
electron-builder em 06-07, nunca via bundle web). Nada aqui vai para o git
além de `.gitkeep`, `README.md` e `CHECKSUMS.txt` — GGUF, embeddings e índice
são ignorados (ver `.gitignore`: `*.gguf`, `recursos-ia/indice-ncm/*`,
`recursos-ia/embedding/*`, `logs/*.jsonl`, a cargo de 06-01).

## Onde colocar o modelo (IA-04)

```text
recursos-ia/modelo/ailo-152m-v2-q4_k_m.gguf   (~97MB, q4_k_m)
```

1. Copie o arquivo GGUF para `recursos-ia/modelo/` com **exatamente** esse nome.
2. Valide a integridade contra `recursos-ia/CHECKSUMS.txt`:
   ```powershell
   certutil -hashfile recursos-ia\modelo\ailo-152m-v2-q4_k_m.gguf SHA256
   node scripts/testar-modelo-ia.mjs        # valida SHA + inferência real restrita
   ```
3. Sem o arquivo, o script roda em **modo MOCK** (seletor determinístico por
   overlap de tokens, mesma semântica do spike `electron/spike/ia-spike-worker.cjs`)
   e mede latência/RAM do mock. O modo mock NÃO prova orçamento de modelo real.

## Layout

| Caminho | Conteúdo | Versionado? |
|---|---|---|
| `modelo/ailo-152m-v2-q4_k_m.gguf` | LLM local q4_k_m (~97MB) | NÃO (`*.gguf`) |
| `embedding/` | `all-MiniLM-L6-v2` (06-03) | NÃO |
| `indice-ncm/` | Índice Vectra <200MB (06-03) | NÃO |
| `dados-brutos/ncm-para-ia.json` | Base 2335 NCMs (06-02) | SIM (pequeno) |
| `CHECKSUMS.txt` | SHA256 dos artefatos | SIM |

## Orçamento (IA-04)

Inferência <3s CPU moderna (teto 5s x86_64 básico), RAM processo ~300MB
(teto 500MB). Medido via `scripts/testar-modelo-ia.mjs` — ver
`docs/diagnostico-fase-3.md`.

## Como recriar cada artefato (06-01)

| Artefato | Script gerador | Origem |
|----------|---------------|--------|
| `dados-brutos/ncm-para-ia.json` | `scripts/preparar-dados-ia.mjs` (06-02) | `public/base/*.json` |
| `embedding/` (pesos) | download 06-03 (`all-MiniLM-L6-v2`, fallback `multilingual-e5-small`) | HuggingFace (uma vez, depois offline) |
| `indice-ncm/` (Vectra) | `scripts/gerar-indice-ia.mjs` (06-03) | `dados-brutos/` + `embedding/` |
| `modelo/*.gguf` | aquisição manual 06-04 | fonte interna (~97MB) |

```powershell
certutil -hashfile recursos-ia/modelo/ailo-152m-v2-q4_k_m.gguf SHA256
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
