# Bases-fonte — atualização de dados + compilação

> O pipeline oficial é **só `npm run base`** (base tributária deterministicamente embutida).
> Troque os JSONs-fonte nesta pasta, recompile, teste e gere o instalador.

Tudo abaixo roda dentro de `Aurum Tax NCM\` (onde está o `package.json`).

```powershell
cd "Aurum Tax NCM"
```


Tudo abaixo roda dentro de `Aurum Tax NCM\` (onde está o `package.json`).

```powershell
cd "Aurum Tax NCM"
```

Pré-requisitos: **Node.js 20+**, `npm install` já executado, ~1 GB livre.

---

## 0. Atualização automática — `npm run fontes:sync` (plug-in pull)

Em toda nova compilação, o fluxo oficial é:

```powershell
npm run fontes:sync   # baixa/normaliza o que tem endpoint oficial + verifica as demais fontes
npm run base          # recompila public/base/ (ou `npm run build`, que já chama a base completa)
```

O `fontes:sync` (`scripts/fontes-sync.mjs`):

1. **NBS 2.00 oficial** — lê o painel oficial da MDIC (Power BI, publicação anônima
   publish-to-web; mesma página pública que o portal do governo embeda em
   "Painel de Códigos NBS") e grava `bases-fonte/NBS 2.00 (oficial).json`
   (5 seções, 26 capítulos, 146 posições, 454 subposições 1º nível, 802 2º nível,
   892 itens, 919 subitens — NBS 2.00 da Portaria Conjunta RFB/SCS nº 2.000/2018).
   Use `--full` para incluir NEBS/notas explicativas completas (~6 MB).
2. **DE-PARA NBS 1.1 ↔ 2.0** — normaliza o CSV oficial exportado do site da MDIC
   ("Correlações NBS", fonte bruta `NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018(Planilha1).csv`)
   e grava `bases-fonte/NBS DE-PARA (oficial).json` (1.391 linhas).
3. **NCM (nomenclatura vigente)** — baixa do Portal Único Siscomex e move a
   versão anterior para `bases-fonte/.historico/` (nada é apagado).
4. **Conferência de todas as fontes** — frescor (mtime) + sha256; grava
   `bases-fonte/FONTES.json`, o mapa auditável da pasta (o que é automático, o
   que é manual, de onde veio cada arquivo, quando atualizou por último).

Modos: `npm run fontes:sync -- --check` (só verifica, não baixa nada) ·
`--only=nbs|depara|ncm` (uma fonte só) · `--full` (NBS com NEBS completos).

**Fontes manuais** (o portal exige navegador/sessão — não há download
programático público): `classificacao_tributaria.json`,
`reforma_tributaria_por_ncm.json` e `NBS SERVIÇOS.json` vêm do **Portal CFF
(SVRS)** — https://dfe-portal.svrs.rs.gov.br/Cff — o script avisa quando
estão velhos (>120 dias) com o passo a passo. O mapa completo, com URLs,
licenças e cadência de cada fonte, está em [`docs/fontes-oficiais-nbs.md`](../docs/fontes-oficiais-nbs.md).

---

## 1. Quais arquivos ficam nesta pasta

O `npm run base` (`scripts/build-base.mjs`) lê **8 arquivos**. Ordem de procura:

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
| `CNAE X NBS.qualclasstrib.json` | **Sim (Phase 9)** | Ponte CNAE → NBS (fonte **não-oficial** qualclasstrib.com.br): 508 CNAEs × 6.641 links (`por_codigo`) + 677 CNAE×LC (`fallback-cnae-links`) + 1.739 LC×NBS (`fallback-relations`). Tracking Google (`respostas_de_rede` com url `google`) descartado no import | Copiado de `C:\Users\david\Downloads\CNAE X NBS\qualclasstrib_completo.json`. Links são **candidatos** — alíquota/benefício só do resolvedor oficial. Sem ele a build falha (ou mantém `public/base/` versionado) |
| `NBS 2.00 (oficial).json` | Não (vivo, **automático**) | NBS 2.00 oficial completa (dump do painel MDIC: secoes…subitens). Gerada por `npm run fontes:sync`; compilada para `public/base/nbs-nomenclatura.json` (3.239 posições) | MDIC — Painel de Códigos NBS (Power BI): https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/painel-de-codigos-nbs · Portaria Conjunta RFB/SCS nº 2.000/2018 |
| `NBS DE-PARA (oficial).json` | Não (vivo, **automático**) | De-para NBS 1.1 ↔ 2.0 (1.391 linhas; 876 mapeadas, 325 extintas, 253 novas na 2.0, 63 linhas duplicadas removidas). Gerada por `npm run fontes:sync` a partir do CSV bruto abaixo | MDIC — Correlações NBS: https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/correlacoes |
| `NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018(Planilha1).csv` | Fonte bruta do de-para (1391 → 1454 linhas) | CSV Latin-1 exportado da aba "Planilha1" da planilha oficial de correlação (mesmo link acima; `.xlsx` → CSV `;`) | Mesmo link MDIC Correlações |
| `FONTES.json` | Gerado por `npm run fontes:sync` | Mapa auditável das fontes (nome, arquivo, origem, url, licença, sha256, frescor) | Gerado em toda sincronização |
| `cfop.json` | Não (vivo) | Tabela CFOP oficial — 619 operações (CFOP, descrição, grupo, âmbito) | Arquivo vivo mantido no projeto (não entra no `npm run base`) |

> `cnae.json` e `mei_cnaes.json`, se existirem soltos nesta pasta, são **ignorados**
> pela compilação (sobras/derivados antigos — pode apagar). O `cnae.json` que
> vale é o **gerado** em `public/base/cnae.json`.

---

## 2. Fluxo completo de atualização (passo a passo)

```powershell
# 1. Jogue os JSONs novos nesta pasta (bases-fonte\), substituindo os antigos.
#    Nomes exatos para os 2 primeiros; o da Nomenclatura só precisa do
#    prefixo/sufixo. Mantenha os 2 vivos salvo se a fonte publicou versão nova.

# 1. Atualize as fontes automáticas (NBS oficial + DE-PARA + NCM):
npm run fontes:sync
#    (ou baixe/atualize manualmente os arquivos do §1 — ver docs/fontes-oficiais-nbs.md)

# 2. Compile a base + IA (OBRIGATÓRIO antes do instalador):
#    = build-base + preparar-dados-ia + gerar-indice-ia --lexical + validar-conhecimento
#    Detalhe de cada etapa no §3.

# 3. Confira a saída (tem que aparecer assim):
#    origem efetiva: ...\bases-fonte
#    ✔ Integridade: nenhuma inconsistência cruzada.   (ou lista de ⚠ Avisos — ver §5)
#    ✔ Índice lexical v2 gerado

# 4. Teste rápido (não precisa de Electron):
npm run dev:web
#    Abra http://127.0.0.1:5173, confira Consulta NCM + Serviços (NBS) + Simples.

# 5. Suba a versão em package.json (ex.: 1.0.0 -> 1.0.1).
#    O nome do instalador sai daqui (AurumTaxNCM-<versão>-win-x64.exe).

# 6. Compile tudo + gere o instalador:
npm run dist:win
#      + electron-builder --win  →  release\*.exe
#    Detalhe no §4. Artefatos em release\ (NSIS + Portable).

# 7. Suba para o GitHub (Release v1.0.1 com os arquivos de release\).
#    O canal é privado (Davidev29/aurum-tax-ncm). O app instalado verifica
#    a atualização em Configurações → Atualização.
```

> Atalho: `npm run base` sozinho só refaz `public/base/` (). Para

---


Roda 4 scripts em sequência. Qualquer `✖` aborta com exit 1.

### 3.1 `node scripts/build-base.mjs` (base tributária)

- Entrada: os 8 arquivos do §1 (os 2 NBS novos são opcionais — sem eles a compilação segue e mantém os artefatos versionados).
- Saída em `public/base/` (versionada no git — é por isso que
  `git clone + npm ci + npm run dist:win` funciona mesmo sem os JSONs brutos):
  - `classificacao-tributaria.json` — referência normalizada (chave `cst|cClassTrib`)
  - `reforma.json` — `cst` + `cstClassTrib` + vínculos `ncm` + `nbs`
  - `nomenclatura.json` — nomenclatura vigente
  - `cnae.json` — CNAE × Anexo (vazio se o vivo estiver ausente — tolerado)
  - `cnae-nbs.json` (Phase 9) — 6.641 links CNAE→NBS (`por_codigo`, dedupe `cnae7|nbs`) + 1.739 relações LC×NBS
  - `classificacoes-consolidadas.json` (Phase 9) — 1.145 templates por CNAE (1.090 regras + 55 divergências de código marcadas, sem regra consolidada). Precedência de descrição: oficial > qualclasstrib > auxiliar. `beneficiosReforma` nasce vazio (runtime resolve com ano de referência)
  - `nbs-nomenclatura.json` — NBS 2.00 oficial completa: 3.239 posições (26 capítulos + 146 posições + 454 subposições 1º + 802 2º nível + 892 itens + 919 subitens). Descrições com herança do ancestral mais próximo (a tabela oficial publica ~1.251 nós sem texto próprio; `descricaoOriginal` preserva a crua). Hierarquia com `pai` em dígitos + flag `folha` nos subitens
  - `nbs-depara.json` — DE-PARA NBS 1.1 ↔ 2.0: 1.391 linhas (876 mapeadas — 346 identidade + 530 migradas; 325 extintas na 2.0; 190 novas na 2.0; 63 linhas duplicadas removidas no import — descrições divergiam só por uma vírgula)
  - `MANIFEST.json` — `origem.baseDir` + `origem.arquivos` + `estatisticas` + `fontesVivas.{qualclasstrib, nbsOficial, nbsDepara}` + `codigosIgnorados` + sha256
- Contagens esperadas hoje (qualquer divergência aparece no log e no `verificar`):
  `referencia 164 · ncm 2335 · cst 17 · cstClassTrib 132 · nomenclatura ~15156 ·`
  `cnae 1090 · nbs 122 (25 dups removidos + 10 do Anexo IX resgatados do overflow NCM) ·`
  `ignorados 0 · ncmSemNomenclatura 6 ·`
  `cnaesComRegras 1090 · cnaesComNbs 508 · cnaeNbsLinks 6641 · nbsUnicas 588 ·`
  `lcLinks 677 · lcNbs 1739 · descricoesConferidas 434 · descricoesDivergentes 74`
  `nbsOficial 3239 · nbsOficialFolhas 919 · nbsOficialDescricoesHerdadas 1251 ·`
  `nbsDepara 1391 (mapeados 876 · identidade 346 · migrados 530 · extintos 325 · novos 190 · duplicados 63 · faltantesOficial 1 — ver nota) ·`
  `(55 códigos legados + 19 textos) · nbsSemDescricao 0`.
- **Nota — `nbsDeparaFaltantesOficial: 1`:** a linha `1.0119.10.00 → 1.0105.21.00`
  ("Serviços de construção de estruturas de edificações") do DE-PARA oficial
  (MDIC, 2019) aponta um código que NÃO existe no painel oficial NBS 2.00
  atual (Subposição 1.0105.2 tem apenas `1.0105.22`). É uma inconsistência
  da própria planilha de correlação — mantida fiel à fonte e sinalizada
  pelo compilador (aviso, nunca erro). Ver `docs/nbs-avaliacao-2026-11.md`.
- Só entram vínculos com NCM de 8 dígitos e NBS de 9; o resto é descartado
  e listado em `MANIFEST.codigosIgnorados` + no log (`Códigos descartados`).
- Sem os 3 obrigatórios e sem `public/base/` versionado: exit 1.
  Sem os 3 mas **com** `public/base/` versionado: só avisa e mantém o versionado.


- Entrada: `public/base/*.json`.
  nomenclatura × referência; NBS excluído).
- **Falha (exit 1) se não tiver exatamente 2335 vínculos.** Esperado:
  `sem nomenclatura: 6 códigos` (mantidos e marcados em `notas`).


- Saída em `recursos-ia/indice-ncm/`:
  `indice-lexical.json` + `sinonimos-gerados.json` + `.manifest-hash`
  (hash semântico base+conhecimento; é ele que diz se o índice está em dia).
- O `build-base` tem gatilho que regenera o índice sozinho quando o MANIFEST
  muda; o `--lexical` força o modo 100% offline (o modo vetorial exige rede
  e não é usado na release).

### 3.4 `node scripts/validar-conhecimento.mjs` (curadoria)

  (sinônimos, dicionário, marcas, erros, frases, serviços, contexto NBS)
  contra a nomenclatura vigente + espelhos TS (`vocabulario.ts`,
  `dicionario-comercial.ts`, etc.).
  apontado antes de seguir.

---

## 4. Do dado ao instalador (compilação do app)

`npm run dist:win` = `npm run build` + `electron-builder --win --publish never`.

O `npm run build` faz, nesta ordem:

2. `tsc --noEmit` (tipos — tem que passar limpo)
3. `vite build` → `dist/` (renderer; `sourcemap: false`, `base: './'`)
4. `npm run build:electron` → `electron/dist/` (`main.js`, `preload.cjs`)
5. `node scripts/ofuscar-build.cjs` — ofusca renderer e processo principal, sem `.map`
6. `node scripts/verificar-build.mjs` — portão: base fiscal, saídas compiladas, Prisma/IPC e ofuscação

O `electron-builder` empacota `dist/**`, `electron/dist/**` e `package.json` com `asar: true` e
`afterPack: scripts/after-pack.cjs`. O banco Prisma é desembrulhado via `asarUnpack`.
Não há recursos de modelo, embeddings, grafo ou índice externo no instalador.

Comandos úteis:

| Comando | Quando usar |
|---|---|
| `npm run base` | Só refazer `public/base/` (iteração rápida, ) |
| `npm run verificar:pre` | Checar bases + IA antes do `vite build` |
| `npm run typecheck` / `npm test` | Tipos / Vitest (ver `npm test`) |
| `npm run build` | Compilação completa sem empacotar |
| `npm run dist` / `dist:win` / `dist:mac` | Instalador da plataforma atual / Win (NSIS+Portable) / Mac (DMG+ZIP). Sem cross-build (1 OS por máquina). Linux: `npx electron-builder --linux --publish never` |

---

## 5. Solução de problemas

- `NBS oficial ausente / NBS DE-PARA ausente (aviso no build)` → rode
  `npm run fontes:sync` (baixa o painel oficial MDIC + normaliza o de-para)
  e depois `npm run base`. Os artefatos passam a viajar no instalador.
- `1 DE-PARA aponta código 2.0 inexistente na nomenclatura` → esperado
  (inconsistência conhecida da planilha oficial MDIC 1.1→2.0: linha
  `1.0119.10.00 → 1.0105.21.00`). É aviso, não erro; ver
  `docs/nbs-avaliacao-2026-11.md`.
- `Arquivos de origem ausentes: referencia, reforma, nomenclatura` → jogue os
  3 JSONs em `bases-fonte/` com os nomes exatos (o da Nomenclatura: prefixo
  `Tabela_NCM_Vigente_` + `.json`).
- `origem efetiva` apontou para a pasta pai → há duplicata legada em
  `REFORMA NCM\`. Remova de lá ou defina `$env:AURUM_BASE_DIR`.
- `Contagem divergente / MANIFEST inconsistente` → a fonte oficial mudou
  (ex.: NCM novo). É esperado: atualize os números neste README +
  (`EXPECTED_NCM`) somente após confirmar que a fonte está correta.
- `⚠ Avisos de integridade` (ex.: NCM sem nomenclatura) → normal até o
  limite conhecido (6 / 10). Acima disso, inspecione
  `MANIFEST.codigosIgnorados`.
  espelho TS, e rode `npm run ia:validar-conhecimento`.
- `JS SEM ofuscação / sourcemap vazando` → rode `node scripts/ofuscar-build.cjs`
  (nunca publique `release/` com `.map`).

São esses 9 de `public/base/` (+ IA em `recursos-ia/`) que viajam dentro do
instalador (`dist/base` + `resources/recursos-ia`). É por isso que depois do
continua na base antiga.
