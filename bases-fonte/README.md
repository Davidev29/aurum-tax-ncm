# Bases tributárias — pasta de atualização

É aqui que você atualiza os dados do programa. Sem IA, sem script extra.

## Onde jogar os arquivos

Coloque nesta pasta (`Aurum Tax NCM/bases-fonte/`) os 3 JSONs oficiais,
com estes nomes exatos:

1. `classificacao_tributaria.json` — referência CST × cClassTrib (164 registros)
2. `reforma_tributaria_por_ncm.json` — vínculos NCM/NBS × CST × cClassTrib
3. `Tabela_NCM_Vigente_AAAA-MM-DD.json` — nomenclatura vigente (ex.: `Tabela_NCM_Vigente_20260922.json`)
   - Vale qualquer data no nome, desde que comece com `Tabela_NCM_Vigente_` e termine com `.json`.
   - Se vier mais de um, o programa usa o primeiro que achar. Deixe só o mais novo aqui.

## Como atualizar (passo a passo do Davi)

```powershell
# 1. Jogue os 3 arquivos novos nesta pasta (substitua os antigos)
# 2. Dentro de Aurum Tax NCM\:
npm run base:completa
#    base tributária (5 fontes) + dados IA (2335 NCM) + índice lexical + validação conhecimento

# 3. Confira a saída:
#    origem efetiva: ...\bases-fonte
#    ✔ Integridade: nenhuma inconsistência cruzada.
#    ✔ Base de conhecimento válida (exit 0).

# 4. Teste rápido:
npm run dev:web

# 5. Suba a versão em package.json (ex.: 1.0.0 -> 1.0.1)

# 6. Gere o instalador (build completa + IA embutida + ofuscação total):
npm run dist:win
#    = base:completa + tsc + vite (minify, sem .map) + electron (minify, sem .map)
#      + ofuscar-build (stringArray em dist/ + electron/dist/) + verificar-build (portão)
#    Artefatos em release/ com IA embutida via extraResources (GGUF ~97MB + índice + conhecimento).

# 7. Suba para o GitHub (Release v1.0.1 com os arquivos de release/)
```

O `npm run base` (`scripts/build-base.mjs`) procura nesta ordem:
1. `AURUM_BASE_DIR` (se definida — uso avançado)
2. **`bases-fonte/` (esta pasta — USE ESTA)**
3. pasta pai `REFORMA NCM\` (legado, só para não quebrar quem ainda usa)

## O que é gerado

- `../public/base/reforma.json`
- `../public/base/nomenclatura.json`
- `../public/base/classificacao-tributaria.json`
- `../public/base/MANIFEST.json` (com `origem.baseDir` = pasta usada + sha256)

São esses 4 que viajam dentro do instalador (`dist/base`). É por isso que
depois do `npm run base` você precisa gerar um Release novo — senão o
usuário continua na base antiga.
