# Diagnóstico Final IA — Dossiê de Entrega Phase 6 (IA-10 / plan 06-10)

**Data:** 2026-09-30 · **Working tree, sem commit** · **UAT do usuário pendente**
Dossiê com evidências dos 11 plans (06-00…06-10). Métricas medidas hoje:
`npx tsc --noEmit` exit 0 · `npm test` **41 arquivos / 433 testes, 433/433 verdes**.

## 1. Evidências por plan (plan → arquivos → verificação → status)

| Plan | Arquivos principais | Verificação executada | Status |
|---|---|---|---|
| 06-00 Spike GO/NO-GO | `electron/spike/ia-spike-worker.cjs`, `ia-spike-main.ts`, `ia-spike-electron-run.cjs`, `docs/spike-eletron-llama.md` | load 944–958 ms (<10 s), IPC 0–1 ms (<50 ms), 0 órfãos (Win x64); macOS/Linux pendentes | **GO CONDICIONAL** |
| 06-01 Prep | `recursos-ia/{modelo,embedding,indice-ncm,dados-brutos}/`, `README.md`, `CHECKSUMS.txt`, `.gitignore`, `docs/diagnostico-fase-0.md` | `npm ls` 8/8 conformes; `git check-ignore` bloqueia `.gguf`; tree OK | **Verde** |
| 06-02 Dados | `scripts/preparar-dados-ia.mjs`, `validar-dados-ia.mjs`, `recursos-ia/dados-brutos/ncm-para-ia.json`, `docs/diagnostico-fase-1.md` | exit 0; 2335 vínculos NCM, 0 NBS, paridade MANIFEST, amostra 5/5 | **Verde** |
| 06-03 Índice | `scripts/gerar-indice-ia.mjs`, `testar-indice-ia.mjs`, `indice-lexical.json` (1,05 MB), `.manifest-hash`, gatilho em `build-base.mjs`, `docs/diagnostico-fase-2.md` | top-k exit 0 (Frango→01, Arroz→10, Notebook→84/85); `du` ≪ 200 MB; gatilho provado 2 ramos | **Verde (fallback lexical; Vectra real pendente de rede)** |
| 06-04 Modelo | `scripts/testar-modelo-ia.mjs`, prompt rígido, `CHECKSUMS.txt` (placeholder), `docs/diagnostico-fase-3.md` | mock 3/3, restrição 100%; latência/RAM reais pendentes | **MOCK VERDE / REAL PENDENTE (offline)** |
| 06-05 Tracer | `electron/ia/ia-worker.cjs`, `ia-service.cjs`, patches `main.ts`/`preload.ts`/`esbuild.mjs`/`bridge.ts`, `src/store/ia.ts`, `src/application/classificacao-ia.ts`, `src/pages/DebugIA.tsx`, `docs/diagnostico-fase-4.md` | UI 40 ms; candidato válido; NÃO SEI; kill `before-quit`; 0 rede; 37 suítes verdes | **Verde (mock, Win x64)** |
| 06-06 Consulta | `src/infrastructure/ia/classificacao-ia-repo.ts`, `SecaoSugestaoIa` em `Consulta.tsx`, `store/consulta.ts`, Dexie v9 `ia_feedback`, `logs/consultas-ia.jsonl`, `docs/diagnostico-fase-5.md` | 5/5 fáceis `via: deterministico` sem worker; 5/5 difíceis `via: ia` validadas; 1/1 incoerente NÃO SEI | **Verde** |
| 06-07 Pack | `package.json#build` (`extraResources`, `asarUnpack`, `afterPack`), `electron/ia/caminhos-ia.cjs`, `scripts/after-pack-ia.cjs`, `docs/diagnostico-fase-6.md` | `tsc` 0; `build:electron` OK; `afterPack` 6/6 + aviso mock; projeção ~100–150 MB ≤ 300 MB | **Preparável-offline OK; pack real pendente (3 OS)** |
| 06-08 Proteção | `scripts/ofuscar-ia.cjs`, `scripts/criptografar-modelo-ia.mjs`, `electron/ia/modelo-seguro.cjs`, rename `aux.dat`/`idx/`, `docs/seguranca-ia.md` | leve+smoke PASS; cifra dummy 3× PASS; `strings` sem header; helper sem escrita em disco | **Implementado offline; UAT pendente (ofuscador real + GGUF real)** |
| 06-09 Testes | `tests/ia/*` (4 suites + `ajuda-ia.ts`), métricas DebugIA + `logs/metricas-ia.jsonl`, `docs/diagnostico-fase-8.md`, fix gate nomenclatura em `classificacao-ia.ts` | 53/53 IA; 37 legadas verdes; `npm test` 41/433; `taxa_uso_ia` 23,3% | **Verde** |
| 06-10 Docs | `docs/arquitetura-ia.md`, `manual-atualizacao-ia.md`, `troubleshooting-ia.md`, este dossiê | `tsc` 0 + `npm test` 41/433 revalidados hoje | **Verde (este plan)** |

Nota: não existe `docs/diagnostico-fase-7.md` — a fase 7 (empacotamento/06-07) foi
documentada como `docs/diagnostico-fase-6.md` (numeração do doc segue o dossiê Fase 6,
não o nº do plan). Nada está faltando.

## 2. Gates

| Gate | Resultado |
|---|---|
| Spike 06-00 GO antes de 06-01 | **GO CONDICIONAL** (Win x64; C1–C4 viraram gates de 06-04/06-05, parcialmente pendentes) |
| Tracer 06-05 verde antes de 06-06 | **Verde** (mock, Win x64) |
| Bypass determinístico (06-09) | **Verde** — 5/5 fáceis com 0 chamadas ao worker; 23/30 conhecidos `via: deterministico` |
| Gate anti-alucinação | **Verde + fix** — mock `99999999` 3/3 bloqueado; gate exige `nomenclatura != null` |
| Migração Dexie v8→v9 | Implementada (v8 congelada, `backup.ts` cobre `iaFeedback`); rollback test = restore do backup |
| Pack ≤ 300 MB | **Projeção** ~100–150 MB (atual, sem embedding/GGUF); UAT final pendente |
| `taxa_uso_ia` < 30% | **23,3%** (7/30 na bateria de conhecidos) |
| Sniff rede | Código: 0 ocorrências; sniff em VM: **UAT pendente** |
| UAT terceiro (06-10) | **Pendente — é o aceite deste dossiê** |

## 3. Checklist §12 do dossiê (06-PLAN §9) — item a item

| # | Item §12 | Status |
|---|---|---|
| 1 | 3 instaladores offline | **UAT-pendente** (config + afterPack prontos; `dist:win/mac`, AppImage exigem rede + CI por OS) |
| 2 | Zero rede | Código **OK** (grep 0); sniff em VM **UAT-pendente** |
| 3 | 100% via resolver | **OK** — nenhuma saída IA chega à UI sem `resolverClassificacoes` (gate + testes) |
| 4 | NÃO SEI sem alucinação | **OK** — 10/10 ambíguos + 5/5 inválidos NÃO SEI; 0 alucinação (45 asserts) |
| 5 | Trilha Dexie + jsonl com `via` | **OK** — `audit_log` + `ia_feedback` + `consultas-ia.jsonl` + `metricas-ia.jsonl` |
| 6 | ≥ 85% acerto | **OK** — 30/30 conhecidos (100%) |
| 7 | Bypass determinístico | **OK** — 5/5 F1-F5 + 23/30 com 0 chamadas |
| 8 | `taxa_uso_ia` < 30% | **OK** — 23,3% |
| 9 | Update sem retreino | **OK** (código + manual) — reindex por hash MANIFEST; prova com GGUF/índice reais é UAT |
| 10 | Ofuscação + cifra | Código **OK** (modo leve/dummy); preset médio + GGUF real **UAT-pendente** |
| 11 | Worker extinto pós-quit | **OK** (código + teste fork; 0 órfãos no spike e no tracer) |
| 12 | ≤ 300 MB | **Projeção OK** (~100–150 MB atual); medição final **UAT-pendente** (≤300 MB final com GGUF+embedding) |
| 13 | 37 suítes legadas verdes | **OK** — 41 arquivos / 433 testes verdes (37 legadas + 4 IA) |
| 14 | Resolver única verdade | **OK** |

**Resumo:** 11/14 OK em código; 3 itens (1, 2-sniff, 12-final) + partes de 9/10 exigem
**GGUF real + rede + VMs** e estão marcados **UAT-pendente** — não são falhas, são
limites declarados do ambiente offline.

## 4. Métricas (medidas, não estimadas)

| Métrica | Valor | Meta | Fonte |
|---|---|---|---|
| `taxa_uso_ia` (30 conhecidos) | **23,3%** (7/30) | < 30% | `diagnostico-fase-8.md` §1 |
| Acerto conhecidos | **100%** (30/30) | ≥ 85% | `tests/ia/classificacao-ia.test.ts` |
| Ambíguos → NÃO SEI | **10/10** | 10/10 | idem |
| Inválidos → NÃO SEI | **5/5** | 5/5 | idem |
| Alucinação (`99999999`) | **0** (3/3 bloqueados) | 0 | `validacao-deterministica.test.ts` |
| Bypass (fáceis, 0 chamadas) | **100%** (5/5 + 23/30) | 100% | `bypass-deterministico.test.ts` |
| Conhecidos (fáceis) `via: deterministico` | **100%** | — | 23/23 sem worker |
| Perf p95 / RSS / índice | ms / <500 MB / **1,05 MB** | <5 s / <500 MB / <200 MB | `performance.test.ts` |
| `npm test` total | **41 arquivos / 433 testes, 433/433** | 37 legadas verdes | rodado hoje |
| `tsc --noEmit` | **exit 0** | 0 | rodado hoje |

## 5. O que falta para o aceite final (UAT do usuário)

1. **Adquirir GGUF real** (`manual-atualizacao-ia.md` §2): copiar, SHA em
   `CHECKSUMS.txt`, `node scripts/testar-modelo-ia.mjs` em modo REAL.
2. **Pack 3 OS** (`diagnostico-fase-6.md` §4, casos U1–U8): `dist:win`/`dist:mac`/
   AppImage em CI por OS, VM limpa sem internet, sniff zero rede, ≤300 MB final.
3. **Segurança real** (`seguranca-ia.md` §5, UAT-1…UAT-6): ofuscador preset médio,
   cifra do GGUF, carga em memória, rename físico, `safeStorage`, rotação.
4. **Aceite e encerramento:** após UAT, marcar ROADMAP Phase 6 + REQUIREMENTS
   IA-00…IA-10 como completos (deixados `[ ]` de propósito neste plan) e dar
   `Last activity` final no `STATE.md`.

**ROADMAP/REQUIREMENTS propositalmente NÃO marcados** — aguardam o aceite UAT acima.
