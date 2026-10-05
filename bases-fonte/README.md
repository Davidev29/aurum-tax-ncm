# Bases-fonte — atualização de dados + compilação

É aqui que você atualiza os dados do programa. Sem IA solta, sem script extra:
troque os JSONs-fonte nesta pasta, recompile, teste e gere o instalador.

Tudo abaixo roda dentro de `Aurum Tax NCM\` (onde está o `package.json`).

```powershell
cd "Aurum Tax NCM"
```

Pré-requisitos: **Node.js 20+**, `npm install` já executado, ~1 GB livre.

---

## 1. Quais arquivos ficam nesta pasta

O `npm run base` (`scripts/build-base.mjs`) lê **5 arquivos**. Ordem de procura:

1. `$env:AURUM_BASE_DIR` (se definida — uso avançado)
2. **`bases-fonte/` (esta pasta — USE ESTA)**
3. pasta pai `REFORMA NCM\` (legado, só para não quebrar quem ainda usa)

Vale o que o log chama de `origem efetiva`. Confira sempre essa linha.

| Arquivo em `bases-fonte/` | Obrigatório? | O que é | Onde conseguir |
|---|---|---|---|
| `classificacao_tributaria.json` | **Sim** | Referência CST × cClassTrib (164 registros) | Portal CFF: https://dfe-portal.svrs.rs.gov.br/Cff → Classificação Tributária · API: `https://cff.svrs.rs.gov.br/api/v1/consultas/classTrib` |
| `reforma_tributaria_por_ncm.json` | **Sim** | Vínculos NCM/NBS × CST × cClassTrib + tabelas `cst` (17) / `cstClassTrib` (132) | Mesmo portal CFF (exportação NCM da Reforma — LC 214/2025) |
| `Tabela_NCM_Vigente_AAAA-MM-DD.json` | **Sim** | Nomenclatura vigente (~15.156 itens) | Portal Único Siscomex: https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json. Vale qualquer data no nome, desde que comece com `Tabela_NCM_Vigente_` e termine com `.json`. Se vier mais de um, o programa usa o **primeiro que achar — deixe só o mais novo aqui** |
| `CNAE X ANEXO.json` | Não (vivo) | CNAE × Anexo Simples + Fator R (1.090 CNAEs) | Arquivo vivo mantido no projeto, sem URL oficial única. Sem ele a store `cnae` nasce vazia, sem quebrar a build |
| `NBS SERVIÇOS.json` | Não (vivo) | Vínculos NBS de serviços (137 linhas → 112 únicos após dedupe) + 10 NBS do Anexo IX resgatados do overflow de 9 dígitos da lista `NCM` (total 122) | Arquivo vivo mantido no projeto. Sem ele o NBS cai no legado dentro de `reforma.json` |
| `cfop.json` | Não (vivo) | Tabela CFOP oficial — 619 operações (CFOP, descrição, grupo, âmbito) para o módulo XML comparar natureza/CFOP × crédito (venda × diferente de venda × imobilizado × imunidades LC 214/2025) | Arquivo vivo mantido no projeto (não entra no `npm run base`; a curadoria fiscal fica em `src/infrastructure/nfe/cfop.ts`) |

> `cnae.json` e `mei_cnaes.json`, se existirem soltos nesta pasta, são **ignorados**
> pela compilação (sobras/derivados antigos — pode apagar). O `cnae.json` que
> vale é o **gerado** em `public/base/cnae.json`.

---

## 2. Fluxo completo de atualização (passo a passo)

```powershell
# 1. Jogue os JSONs novos nesta pasta (bases-fonte\), substituindo os antigos.
#    Nomes exatos para os 2 primeiros; o da Nomenclatura só precisa do
#    prefixo/sufixo. Mantenha os 2 vivos salvo se a fonte publicou versão nova.

# 2. Compile a base + IA (OBRIGATÓRIO antes do instalador):
npm run base:completa
#    = build-base + preparar-dados-ia + gerar-indice-ia --lexical + validar-conhecimento
#    Detalhe de cada etapa no §3.

# 3. Confira a saída (tem que aparecer assim):
#    origem efetiva: ...\bases-fonte
#    ✔ Integridade: nenhuma inconsistência cruzada.   (ou lista de ⚠ Avisos — ver §5)
#    ✔ ncm-para-ia.json gerado (2335 vínculos)
#    ✔ Índice lexical v2 gerado
#    ✔ Base de conhecimento válida (exit 0).

# 4. Teste rápido (não precisa de Electron):
npm run dev:web
#    Abra http://127.0.0.1:5173, confira Consulta NCM + Serviços (NBS) + Simples.

# 5. Suba a versão em package.json (ex.: 1.0.0 -> 1.0.1).
#    O nome do instalador sai daqui (AurumTaxNCM-<versão>-win-x64.exe).

# 6. Compile tudo + gere o instalador:
npm run dist:win
#    = npm run build (base:completa + tsc + vite + electron + ofuscar + verificar)
#      + electron-builder --win  →  release\*.exe
#    Detalhe no §4. Artefatos em release\ (NSIS + Portable).

# 7. Suba para o GitHub (Release v1.0.1 com os arquivos de release\).
#    O canal é privado (Davidev29/aurum-tax-ncm). O app instalado verifica
#    a atualização em Configurações → Atualização.
```

> Atalho: `npm run base` sozinho só refaz `public/base/` (sem IA). Para
> instalador, use sempre `base:completa` (o `build`/`dist` já chamam ela).

---

## 3. O que o `npm run base:completa` faz (compilação dos dados)

Roda 4 scripts em sequência. Qualquer `✖` aborta com exit 1.

### 3.1 `node scripts/build-base.mjs` (base tributária)

- Entrada: os 5 arquivos do §1.
- Saída em `public/base/` (versionada no git — é por isso que
  `git clone + npm ci + npm run dist:win` funciona mesmo sem os JSONs brutos):
  - `classificacao-tributaria.json` — referência normalizada (chave `cst|cClassTrib`)
  - `reforma.json` — `cst` + `cstClassTrib` + vínculos `ncm` + `nbs`
  - `nomenclatura.json` — nomenclatura vigente
  - `cnae.json` — CNAE × Anexo (vazio se o vivo estiver ausente — tolerado)
  - `MANIFEST.json` — `origem.baseDir` + `origem.arquivos` + `estatisticas` + `codigosIgnorados` + sha256
- Contagens esperadas hoje (qualquer divergência aparece no log e no `verificar`):
  `referencia 164 · ncm 2335 · cst 17 · cstClassTrib 132 · nomenclatura ~15156 ·`
  `cnae 1090 · nbs 122 (25 dups removidos + 10 do Anexo IX resgatados do overflow NCM) ·`
  `ignorados 0 · ncmSemNomenclatura 6`.
- Só entram vínculos com NCM de 8 dígitos e NBS de 9; o resto é descartado
  e listado em `MANIFEST.codigosIgnorados` + no log (`Códigos descartados`).
- Sem os 3 obrigatórios e sem `public/base/` versionado: exit 1.
  Sem os 3 mas **com** `public/base/` versionado: só avisa e mantém o versionado.

### 3.2 `node scripts/preparar-dados-ia.mjs` (base da IA)

- Entrada: `public/base/*.json`.
- Saída: `recursos-ia/dados-brutos/ncm-para-ia.json` (join NCM 8 dígitos ×
  nomenclatura × referência; NBS excluído).
- **Falha (exit 1) se não tiver exatamente 2335 vínculos.** Esperado:
  `sem nomenclatura: 6 códigos` (mantidos e marcados em `notas`).

### 3.3 `node scripts/gerar-indice-ia.mjs --lexical` (índice RAG)

- Entrada: `ncm-para-ia.json` + `recursos-ia/conhecimento/*.json`.
- Saída em `recursos-ia/indice-ncm/`:
  `indice-lexical.json` + `sinonimos-gerados.json` + `.manifest-hash`
  (hash semântico base+conhecimento; é ele que diz se o índice está em dia).
- O `build-base` tem gatilho que regenera o índice sozinho quando o MANIFEST
  muda; o `--lexical` força o modo 100% offline (o modo vetorial exige rede
  e não é usado na release).

### 3.4 `node scripts/validar-conhecimento.mjs` (curadoria)

- Só leitura: valida `recursos-ia/conhecimento/*.json`
  (sinônimos, dicionário, marcas, erros, frases, serviços, contexto NBS)
  contra a nomenclatura vigente + espelhos TS (`vocabulario.ts`,
  `dicionario-comercial.ts`, etc.).
- Exit 0 = `✔ Base de conhecimento válida`. Exit 1 = corrigir o JSON
  apontado antes de seguir.

---

## 4. Do dado ao instalador (compilação do app)

`npm run dist:win` = `npm run build` + `electron-builder --win --publish never`.

O `npm run build` faz, nesta ordem:

1. `npm run base:completa` (§3)
2. `tsc --noEmit` (tipos — tem que passar limpo)
3. `vite build` → `dist/` (renderer; `sourcemap: false`, `base: './'`)
4. `npm run build:electron` (`node electron/esbuild.mjs`) → `electron/dist/`
   (`main.js`, `preload.cjs`, `ia-worker.cjs`, `caminhos-ia.cjs`, `modelo-seguro.cjs`)
5. `node scripts/ofuscar-build.cjs` — ofusca `dist/assets/*.js` + `electron/dist/`
   (marcador `__AURUM_BUILD_OFUSCADO__`, `node --check` + smoke da IA por arquivo;
   falha restaura o original e aborta). Conferir sem ofuscar: `npm run ofuscar:check`
6. `node scripts/verificar-build.mjs` — **portão**: base (164/2335/17/132/
   nomenclatura ≥15000/CNAE 1090/NBS ≥100) + IA (`ncm-para-ia` 2335, índice,
   hash sincronizado, conhecimento, **GGUF ~97 MB com SHA conferido contra
   `CHECKSUMS.txt`**) + `dist/` + `electron/dist/` + ofuscação total sem `.map`.
   Pré-checagem sem exigir `dist/`: `npm run verificar:pre`

O `electron-builder` então empacota (`asar: true`, `afterPack:
scripts/after-pack-ia.cjs`):

- Dentro do app: `dist/**` + `electron/dist/**` + `package.json`
  (`.map`, `.planning/`, `docs/`, `tests/`, `scripts/`, modelo/embedding ficam de fora).
- Via `extraResources` (fora do asar): `dados-brutos/` + `indice-lexical.json` +
  `.manifest-hash` + `sinonimos-gerados.json` + `conhecimento/*.json|md` +
  `CHECKSUMS.txt` + `modelo/Qwen3-0.6B-Q8_0.gguf`.
- **GGUF é obrigatório** (`recursos-ia/modelo/Qwen3-0.6B-Q8_0.gguf`, SHA
  registrado em `recursos-ia/CHECKSUMS.txt`). Sem ele o pack **falha**
  (AI-first — instalador sem IA real não sai). Modelo nunca vai para o git
  (`*.gguf` no `.gitignore`).
- `asarUnpack`: `ia-worker.cjs`, `caminhos-ia.cjs`, `modelo-seguro.cjs`
  (fork/binário nativo não funciona dentro do asar).

Comandos úteis:

| Comando | Quando usar |
|---|---|
| `npm run base` | Só refazer `public/base/` (iteração rápida, sem IA) |
| `npm run base:completa` | Atualização de dados oficial (sempre antes do instalador) |
| `npm run verificar:pre` | Checar bases + IA antes do `vite build` |
| `npm run typecheck` / `npm test` | Tipos / Vitest (77 suítes / 651 casos) |
| `npm run build` | Compilação completa sem empacotar |
| `npm run dist` / `dist:win` / `dist:mac` | Instalador da plataforma atual / Win (NSIS+Portable) / Mac (DMG+ZIP). Sem cross-build (1 OS por máquina). Linux: `npx electron-builder --linux --publish never` |
| `npm run ia:indice` / `ia:testar-indice` / `ia:validar-conhecimento` / `ia:cobertura` | Pipeline IA avulso (índice, teste top-k Frango/Arroz/Notebook, curadoria, cobertura PT↔EN) |

---

## 5. Solução de problemas

- `Arquivos de origem ausentes: referencia, reforma, nomenclatura` → jogue os
  3 JSONs em `bases-fonte/` com os nomes exatos (o da Nomenclatura: prefixo
  `Tabela_NCM_Vigente_` + `.json`).
- `origem efetiva` apontou para a pasta pai → há duplicata legada em
  `REFORMA NCM\`. Remova de lá ou defina `$env:AURUM_BASE_DIR`.
- `Contagem divergente / MANIFEST inconsistente` → a fonte oficial mudou
  (ex.: NCM novo). É esperado: atualize os números neste README +
  `scripts/verificar-build.mjs` (`ESPERADO`) + `preparar-dados-ia.mjs`
  (`EXPECTED_NCM`) somente após confirmar que a fonte está correta.
- `⚠ Avisos de integridade` (ex.: NCM sem nomenclatura) → normal até o
  limite conhecido (6 / 10). Acima disso, inspecione
  `MANIFEST.codigosIgnorados`.
- `índice IA dessincronizado (.manifest-hash ≠ hash atual)` → rode
  `node scripts/gerar-indice-ia.mjs --lexical` de novo.
- `Base de conhecimento válida (exit 1)` / `termo não normalizado / NCM extinto` →
  corrija o JSON em `recursos-ia/conhecimento/` (minúsculas, sem acento) ou o
  espelho TS, e rode `npm run ia:validar-conhecimento`.
- `GGUF ausente / SHA diverge / CHECKSUMS sem linha` → copie o
  `Qwen3-0.6B-Q8_0.gguf` para `recursos-ia/modelo/`, rode
  `certutil -hashfile recursos-ia\modelo\Qwen3-0.6B-Q8_0.gguf SHA256`,
  cole em `recursos-ia/CHECKSUMS.txt`, valide com `node scripts/testar-modelo-ia.mjs`.
- `JS SEM ofuscação / sourcemap vazando` → rode `node scripts/ofuscar-build.cjs`
  (nunca publique `release/` com `.map`).

São esses 5 de `public/base/` (+ IA em `recursos-ia/`) que viajam dentro do
instalador (`dist/base` + `resources/recursos-ia`). É por isso que depois do
`npm run base:completa` você precisa gerar um Release novo — senão o usuário
continua na base antiga.
