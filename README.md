<div align="center">

# 🏛️ Aurum Tax NCM

### Classificador fiscal da Reforma Tributária — LC 214/2025

**Analise SPED • Classifique por NCM • Simule IBS/CBS • Gere relatórios**

[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=for-the-badge&logo=electron&logoColor=white)](./electron/main.ts)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](./src/App.tsx)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](./vite.config.ts)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](./tsconfig.json)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](./src/index.css)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

*Aplicativo desktop (Windows / macOS / Linux) + modo web, 100% local e offline-first.*

[✨ Proposta](#-proposta-do-sistema) • [🚀 Começo rápido](#-começo-rápido) • [📖 Guia de uso](#-guia-de-uso-módulo-a-módulo) • [🧮 Regras tributárias](#-como-o-cálculo-funciona) • [🛠️ Desenvolvimento](#️-desenvolvimento)

</div>

---

## 📌 Proposta do sistema

A **Reforma Tributária (Lei Complementar nº 214/2025)** extingue PIS, COFINS, ICMS e ISS e cria o **IBS** (Imposto sobre Bens e Serviços) e a **CBS** (Contribuição sobre Bens e Serviços), além do Imposto Seletivo.

Na prática, todo produto/serviço passa a ser classificado por:

| Campo | O que é | Exemplo |
|---|---|---|
| **NCM** | Nomenclatura Comum do Mercosul (8 dígitos) | `0201.10.00` — Carnes de bovino |
| **CST IBS/CBS** | Código de Situação Tributária no novo modelo | `000` — Tributação integral |
| **cClassTrib** | Classificação tributária detalhada (reduções, anexos, regimes) | `000001` — Regra geral |

O **Aurum Tax NCM** é o assistente do contador, fiscal e empresário para essa transição:

> **Você informa o NCM (ou importa seu SPED / planilha) → o sistema devolve CST + cClassTrib + % de redução de IBS/CBS + base legal + simulação em R$.**

Tudo roda **localmente** (IndexedDB via Dexie, sem servidor, sem enviar dados fiscais para nuvem).

---

## ✨ Recursos principais

| Módulo | O que faz |
|---|---|
| 🧮 **Calculadora** | Monte cestas com produtos salvos ou NCM manual, edite qtd/valor e veja base, IBS, CBS, total e carga efetiva em tempo real. Alíquotas de referência editáveis (padrão IBS 19% + CBS 9%). |
| 🔍 **Consulta NCM** | Digite 8 dígitos (com ou sem ponto) e veja todas as classificações possíveis, reduções, anexo, documentos habilitados (NFe, NFCe, CTe…), observações legais (Art. 128/135/137) e simulação. |
| 📋 **Classificação individual** | Cadastro de produto (SKU, nome, NCM, qtd, valor, CFOP, CST ICMS/PIS/COFINS) + escolha da classificação da Reforma na lateral. Gera snapshot tributário no produto. |
| 📁 **Classificação em lote** | Arraste CSV/XLSX (`COD/SKU; NOME DO PRODUTO; NCM; CFOP; CST; PIS; COFINS`), o sistema classifica centenas de linhas de uma vez, permite trocar entre múltiplas opções e salvar tudo como produtos. Inclui modelo CSV para download. |
| 📄 **SPED Fiscal** | Importe EFD **ICMS/IPI** (blocos C100/C170/C190) ou **EFD Contribuições** (A100/A170, C100/C170, D100/D170). Detecta automaticamente o tipo, rejeita Reinf/e-Social/ECD/ECF com explicação, analisa **só as saídas**, agrupa por anexo, exibe gráficos, Top 15 produtos e exporta **PDF timbrado + CSV**. |
| 🧾 **NF-e XML** | Importe XMLs de NF-e, confronte com a base, apure IBS/CBS por nota e avalie crédito. |
| 🧰 **Serviços (NBS/CNAE)** | Consulta por NBS (9 dígitos), elegibilidade Simples por CNAE (Anexos I–V + Fator R), tradutor fiscal PT↔EN e motor de hipóteses com trilha de auditoria. Base viva: `NBS SERVIÇOS.json` + `CNAE X ANEXO.json`. |
| 📦 **Produtos & 🏢 Empresas** | Multi-empresa (CNPJ, razão social, fantasia, importação em lote). Produtos vinculados à empresa ativa. Exportação CSV / JSON / PDF. |
| 📚 **Tabelas auxiliares** | CST IBS/CBS, cClassTrib, Nomenclatura NCM vigente, vínculo NCM × Classificação, CFOP, CST ICMS, CST PIS/COFINS — todas **editáveis** (criar/editar/excluir). |
| ⚖️ **Legislação** | LC 214/2025, Decreto 12.955/2026 (CBS), Resolução CGIBS nº 6/2026 (IBS) e Portal Conformidade Fácil. Na consulta, *“Visualizar legislação”* abre o artigo exato (`#art128`, `#art137`…). |
| 🖨️ **Emitente timbrado** | Configure razão social, CNPJ, logo, cor e rodapé — sai no cabeçalho de todos os PDFs. |
| 🤖 **IA embutida (Aurum AI — integrada)** | Sugestão de NCM/NBS por descrição em linguagem natural (PT/EN). Pipeline: bypass determinístico → RAG lexical (`indice-lexical.json` + sinônimos, ~1 MB) → modelo local **AILO-152M** (`recursos-ia/modelo/*.gguf`, ~97 MB) em `utilityProcess` isolado, 100% offline e sem rede. Toda saída passa por geração restrita validada pelo resolvedor oficial (anti-alucinação: `99999999` e NCM sem nomenclatura viram “NÃO SEI”). Trilha auditável em `audit_log` + `ia_feedback` + `logs/consultas-ia.jsonl`. Diagnóstico em `Ctrl+Shift+D` (tela DebugIA oculta). O índice é reconstruído sozinho quando a base muda (hash do `MANIFEST.json`). |
| 🔄 **Atualização automática** | Verificação via GitHub Releases (aba **Configurações → Atualização**). As bases tributárias viajam **embutidas no programa** — cada atualização do app renova NCM, CST, cClassTrib, nomenclatura, NBS e CNAE. Sem servidor, sem sincronização avulsa. Complemento online (quando há internet): sync **Siscomex** (tabela NCM vigente, com diff novos/alterados/extintos) e **CFF** (classTrib, anexos, crédito presumido, locais de operação, produtos NFCom/NFAg/NF3e/NFGas — alguns exigem certificado ICP-Brasil e têm fallback de importação manual). |
| 🐾 **Aurinha** | Pet-assistente da interface: reage às telas, celebra exportações e sugere sem atrapalhar. |
| 🌙 **UX** | Tema claro/escuro, responsivo, atalhos, toasts, modo offline total. Primeiro uso com assistente de aceite local. |

---

## 🚀 Começo rápido

### Requisitos

- **Node.js 20+** e **npm 10+** (só para desenvolver/compilar — o usuário final só precisa do instalador)
- Windows 10/11 64-bit, macOS 12+ ou Linux (para o instalador desktop)
- ~1 GB livre para compilar; o instalador Windows tem ~120 MB e **não exige administrador** (instalação por usuário)

### 1. Instalar

```bash
git clone https://github.com/Davidev29/aurum-tax-ncm.git
cd aurum-tax-ncm
npm install
```

### 2. Rodar em desenvolvimento

```bash
# Web + Electron juntos (recomendado)
npm run dev

# Só web (navegador, sem Electron)
npm run dev:web

# Só checagem de tipos
npm run typecheck

# Testes (Vitest, 68 suítes / 667 testes)
npm test
```

> O `predev` mata a porta 5173, gera a base embutida (`npm run base`) e compila o main do Electron automaticamente.

Acesse: **http://127.0.0.1:5173**

### 3. Gerar o instalador

```bash
# Build completo + instalador da plataforma atual
npm run dist

# Alvos específicos
npm run dist:win   # NSIS (.exe) + Portable
npm run dist:mac   # DMG + ZIP (x64 + arm64)
```

Os artefatos saem em `./release/`:

| Arquivo | O quê |
|---|---|
| `AurumTaxNCM-Setup-<versão>-win-x64.exe` | Instalador NSIS (PT-BR, por usuário, com atalho + desinstalador) |
| `AurumTaxNCM-Portatil-<versão>-win-x64.exe` | Versão portátil (sem instalar) |

O instalador leva **só o app**: interface + base tributária embutida + índice da IA.
`.planning/`, `docs/`, `tests/`, `scripts/` e artefatos de modelo/embedding ficam de fora por regra explícita no `build.files` do `package.json`.
Os dados do usuário (XMLs importados, IndexedDB) vivem em `%APPDATA%` — fora da pasta do programa — e sobrevivem a atualizações/desinstalações.

> `npm run base` regenera `public/base/` a partir dos JSONs-fonte da pasta pai, mas o build **não depende deles**:
> a base compilada é versionada no git, então `git clone + npm ci + npm run dist:win` funciona em qualquer máquina.

---

## 📖 Guia de uso — módulo a módulo

### 🧮 1. Calculadora

1. Acesse **Calculadora** no menu lateral.
2. Busque um produto salvo (SKU, nome ou NCM) **ou** clique em **➕ NCM manual**.
3. Ajuste **quantidade** e **valor unitário** direto na lista.
4. O painel **Resumo do cálculo** atualiza sozinho:
   - Base total · IBS (R$) · CBS (R$) · Total tributos · Total geral · Carga efetiva (%)
5. Se precisar, altere as **Alíquotas de referência** (IBS/CBS) no card lateral — todo o sistema usa esses dois números.
6. **💾 Salvar no produto** grava o cálculo de volta no cadastro.

### 🔍 2. Consulta por NCM

1. Vá em **Consulta NCM**.
2. Digite `02011000` ou `0201.10.00` — sugestões aparecem a partir de 2 dígitos.
3. Clique em **Classificar**. Você verá:
   - Descrição oficial da nomenclatura + capítulo
   - Um card por classificação: `CST · cClassTrib`, % redução IBS/CBS, anexo, base legal, documentos (NFe…NFSe)
   - Observações legais automáticas (ex.: *Art. 137 — in natura*, *Art. 135 — alimentos*)
   - Simulador com valor editável
   - Botão **Visualizar legislação** (abre o artigo exato da LC 214)
4. **➕ Adicionar à calculadora** joga a classificação direto na cesta.

> **NCM sem vínculo específico?** O sistema aplica a **regra geral** (`CST 000 · 000001`, tributação integral) e avisa em âmbar. É o comportamento oficial da LC 214.

### 📋 3. Classificação individual

1. Vá em **Classificação**.
2. Preencha **SKU** + **Nome** + **NCM** (obrigatórios).
3. Opcional: qtd, valor, CFOP, CST ICMS/PIS/COFINS (dá para cadastrar novos com o botão **＋**).
4. Na lateral **Classificação da Reforma**, escolha entre as opções (radio). Se houver só 1, ela já vem marcada.
5. **💾 Salvar produto** — ele fica vinculado à empresa ativa (ou “sem empresa” no modo visualização).

### 📁 4. Classificação em lote

1. Vá em **Classificação em lote**.
2. Baixe o **modelo CSV** (`COD/SKU;NOME DO PRODUTO;NCM;CFOP;CST;PIS;COFINS`) se for a primeira vez.
3. Arraste o `.csv` / `.xlsx` / `.xls` para a área pontilhada.
4. Confira as pills: classificadas · em regra geral · com múltiplas opções · inválidos.
5. NCMs com N opções têm um `<select>` para trocar a classificação.
6. **Salvar todos como produtos** (ignora linhas sem SKU ou sem NCM válido).

Exemplo de cabeçalho aceito (acentos e maiúsculas são normalizados):

```
COD/SKU;NOME DO PRODUTO;NCM;CFOP;CST;PIS;COFINS
02011000;Carne bovina;02011000;5102;000;01;01
```

### 📄 5. SPED Fiscal (o módulo mais usado)

1. Vá em **SPED Fiscal**.
2. Arraste o `.txt` do SPED. O sistema detecta sozinho:
   - ✅ **EFD ICMS/IPI** (C100/C170/C190)
   - ✅ **EFD Contribuições** (A170/C170/D170)
   - ⛔ Reinf, e-Social, ECD, ECF → tela vermelha explicando o motivo
3. O parser lê o **0200** (cadastro produto→NCM) e os itens de **saída** (`indOper = 1`). Entradas são descartadas e contabilizadas como *“ignoradas”*.
4. Resultado:
   - Cards: notas saída analisadas × entradas ignoradas, itens processados, itens sem NCM
   - **Alíquota Zero** (top 50), **Separação por Anexo** (0 / 60 / 30 / sem redução)
   - Gráficos (rosca por anexo + barras Top 15 por tributos)
   - Tabela detalhada (primeiras 200 linhas) com NCM, CST reforma, reduções, IBS/CBS, anexo e observações
5. Ações:
   - 📕 **Exportar PDF** (A4 paisagem, timbrado com emitente)
   - 📊 **Exportar CSV** (separador `;`, BOM, pronto pro Excel)
   - 💾 **Salvar produtos na empresa** (cria/associa produtos a partir do SPED)

> **Só C190 (sem C170)?** O sistema entra em *modo resumo*: agrupa por `CST ICMS + CFOP`, estima pela regra geral e avisa que a classificação é aproximada.

### 🧾 6. NF-e XML, 📦 Produtos e 📚 Auxiliares

- **NF-e XML**: importe um ou vários XMLs, veja totais por nota, confronto NCM × base e apuração de IBS/CBS e crédito presumido.
- **Produtos**: filtre por SKU/nome/NCM, exporte CSV/JSON/PDF, edite ou exclua. Tudo respeita a **empresa ativa** no topo.
- **Empresas** (botão 🏢 no header): cadastre por CNPJ, importe em lote, defina a ativa. Sem empresa ativa = *modo visualização*.
- **Tabelas auxiliares**: cada tabela tem filtro + **＋ Novo** + editar/excluir. Útil quando a legislação atualizar um CST ou cClassTrib antes da próxima base oficial.
- **Configurações** (⚙️): emitente timbrado, **importação da base** (`reforma_tributaria_por_ncm.json` e `Tabela_NCM_Vigente_*.json`), backup/restauração JSON, status da base (contadores por store).

---

## 🧮 Como o cálculo funciona

Fórmula única, aplicada em todos os módulos:

```
aliqIBS = 19 × (1 − redIBS/100)
aliqCBS =  9 × (1 − redCBS/100)
vIBS    = base × aliqIBS / 100
vCBS    = base × aliqCBS / 100
total   = vIBS + vCBS
carga   = base > 0 ? total/base × 100 : 0
```

Derivação do **anexo** (SPED/NF-e/Lote, por `redIBS`+`redCBS`):

| redIBS / redCBS | Anexo | Rótulo |
|---|---|---|
| 100% / 100% | `0` | 🟢 Alíquota zero |
| 80% | `80` | 🟠 Redução 80% (art. 158) |
| 70% | `70` | 🟠 Redução 70% (art. 261) |
| 60% / 60% | `60` | 🟡 Redução 60% (arts. 128/135/137) |
| 50% | `50` | 🔵 Redução 50% (art. 261) |
| 40% | `40` | 🔵 Redução 40% (arts. 275–289) |
| 30% | `30` | 🔵 Redução 30% (art. 127) |
| IBS ≠ CBS | `misto` | 🟣 Redução IBS ≠ CBS (ex.: Prouni 60/100, art. 308) |
| 0% | `isento` | ⚪ Sem redução |

Os cartões de consulta exibem o anexo **oficial** da base (`Número do Anexo`: "Anexo IX — LC 214/2025" etc.), nunca confundir com a faixa derivada acima.

Cálculo (LC 214/2025 — redução de **alíquota**): BC = valor cheio da operação · alíquota efetiva = referência × (1 − red/100) · tributo = base × alíquota efetiva.

Observações legais automáticas: `100` → Alíquota Zero · `60` → Art. 128 (+ Art. 137 se in natura + Art. 135 se alimento) · `80` → Art. 158 · `70`/`50` → Art. 261 · `40` → Arts. 275–289 · `30` → Art. 127 · `60/100` → Art. 308 (Prouni) · senão → Regra geral.

---

## 🛠️ Desenvolvimento

### Scripts npm

| Script | O que faz |
|---|---|
| `npm run dev` | Vite (127.0.0.1:5173) + Electron lado a lado |
| `npm run dev:web` | Só Vite no navegador |
| `npm run build` | Base + `tsc --noEmit` + `vite build` + Electron |
| `npm run build:electron` | Compila `electron/main.ts` + `preload.ts` via esbuild |
| `npm run base` | Gera a base embutida a partir de `bases-fonte/` (`scripts/build-base.mjs`) |
| `npm run typecheck` / `npm test` | Tipos / Vitest (`vitest run`) |
| `npm run dist[:win,:mac]` | Instaladores via electron-builder |
| `npm run icon` | Gera `build/icon.ico` a partir do SVG |

### Estrutura

```
aurum-tax-ncm/
├── electron/            # main.ts, preload.ts, esbuild.mjs
│   └── ia/              # worker IA offline (utilityProcess isolado, RAG lexical + GGUF AILO-152M)
├── src/
│   ├── App.tsx          # shell: Calculadora, Consulta, Lote, NfeXml,
│   │                    #  Produtos, Auxiliares, Legislacao (+ DebugIA oculta)
│   ├── main.tsx         # bootstrap React
│   ├── pages/           # telas (apresentação sobre stores)
│   ├── domain/          # entidades, constants, capitulos, legislacao, seeds, contrato
│   │   └── services/    # cálculo, classificação, observações legais
│   ├── application/     # casos de uso (produtos, empresas, lote, backup, atualização…)
│   ├── infrastructure/  # Dexie/IndexedDB, parsers SPED, NFe, PDF, CSV, Receita, bridge IPC
│   ├── store/           # Zustand (ui, sessão, empresa ativa, alíquotas, pet)
│   ├── ui/              # Layout, Marca, PetAurum (Aurinha), kit
│   └── modais/          # globais (Configurações: emitente/bases/backup/atualização…)
├── recursos-ia/         # IA offline: GGUF AILO-152M + índice lexical + conhecimento (embarcado via extraResources)
├── bases-fonte/         # ← JOGUE OS JSONs OFICIAIS AQUI p/ atualizar: 3 obrigatórios + 2 vivos (ver tabela abaixo)
├── scripts/             # build-base.mjs, gerar-indice-ia.mjs, after-pack-ia.cjs…
├── tests/               # 68 suítes Vitest (cálculo, SPED, NFe, lote, PDF, IA, CFF, Siscomex…)
├── docs/                # SPEC-LOGICA-NEGOCIO.md, diagnósticos, manuais (fora do instalador)
├── public/              # assets estáticos + base JSON embutida (versionada)
├── build/               # icon.ico/png, LICENCA.rtf/txt (instalador NSIS em PT-BR)
└── release/             # instaladores gerados (ignorado no git)
```

Arquitetura: **React + Clean Architecture** — `domain` (regras puras) → `application` (casos de uso) → `infrastructure` (Dexie, parsers, PDF) → `pages/ui` (apresentação). Paridade total com a v1 single-file, documentada em [`docs/SPEC-LOGICA-NEGOCIO.md`](./docs/SPEC-LOGICA-NEGOCIO.md).

### Stack

- **Desktop:** Electron 44 + electron-builder (NSIS PT-BR, DMG, AppImage)
- **Front:** React 19, Vite 8 (`base: './'` p/ file://), TailwindCSS 4, Zustand 5
- **Dados:** Dexie 4 (IndexedDB `aurum_tax_ncm_v1`), XLSX (SheetJS), Chart.js, pdfmake
- **Qualidade:** TypeScript strict, Vitest + jsdom + fake-indexeddb, esbuild

### Dados / base tributária

- `public/` carrega a base embutida gerada por `npm run base` (NCM × CST × cClassTrib + nomenclatura vigente + NBS + CNAE).
- Para atualizar: **Configurações → Importação da base** e selecione o JSON novo (`NCM + tabelasAuxiliares` ou `Nomenclaturas`). Só entram vínculos com NCM de 8 dígitos; o resto é descartado com aviso.
- Backup: **Configurações → Backup** exporta tudo (empresas, produtos, auxiliares, emitente) em JSON; a restauração é idempotente.

### Onde baixar as bases oficiais (para compilar a próxima build)

Coloque os arquivos em `bases-fonte/` com os nomes exatos e rode `npm run base` (detalhes em [`bases-fonte/README.md`](./bases-fonte/README.md)):

| Arquivo em `bases-fonte/` | O que é | Onde baixar | Obrigatório? |
|---|---|---|---|
| `classificacao_tributaria.json` | Referência CST × cClassTrib (164 registros) | Portal DFe / Conformidade Fácil: https://dfe-portal.svrs.rs.gov.br/Cff → Classificação Tributária (ou `https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria`); API: `https://cff.svrs.rs.gov.br/api/v1/consultas/classTrib` | Sim |
| `reforma_tributaria_por_ncm.json` | Vínculos NCM/NBS × CST × cClassTrib (+ tabelas `cst`/`cstClassTrib`) | Mesmo portal CFF acima (exportação NCM da Reforma — LC 214/2025) | Sim |
| `Tabela_NCM_Vigente_AAAA-MM-DD.json` | Nomenclatura NCM vigente (~15 mil itens) | Portal Único Siscomex: https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json (espelho na página “Download NCM” da Receita). Vale qualquer data no nome, desde que comece com `Tabela_NCM_Vigente_` e termine com `.json`. O app também sincroniza sozinho (com diff novos/alterados/extintos) quando há internet | Sim |
| `CNAE X ANEXO.json` | CNAE × Anexo Simples + Fator R (~1.090 CNAEs) | Arquivo vivo mantido no projeto (sem URL oficial única — preserve o atual; se a fonte publicar nova versão, substitua com o mesmo nome) | Não (sem ele a store `cnae` nasce vazia, sem quebrar a build) |
| `NBS SERVIÇOS.json` | Vínculos NBS de serviços (~112 únicos após dedupe) | Arquivo vivo mantido no projeto (idem acima; NBS cai no legado `reforma.json` quando ausente) | Não |

Outras tabelas CFF (`anexos`, `credPresumido`, `indOper`, `ConsultaClassificacaoProduto?sistema=NFCom|NFAg|NF3e|NFGas) não entram no `npm run base`: são sincronizadas/importadas em tempo de execução (algumas exigem certificado digital ICP-Brasil — nesse caso baixe o JSON no portal CFF e importe em **Configurações → Importação da base**).

---

## ❓ FAQ

**Precisa de internet?**
Não para o uso diário. Só os links de legislação (“Visualizar legislação”, portal CFF) abrem páginas externas.

**Meus dados do SPED saem da máquina?**
Não. Todo o processamento é local (IndexedDB no Electron/navegador). Não há backend.

**E se meu NCM tiver 2 classificações?**
Na Consulta você vê os N cards; na Classificação e no Lote você escolhe no radio/select. No SPED o sistema usa a primeira da base (ordem de importação) — troque manualmente no Lote se precisar.

**Posso usar no navegador sem instalar?**
Sim: `npm run dev:web` ou sirva a pasta `dist/` após `npm run build`. O Electron só adiciona janela nativa, menu e instalador.

**A IA funciona sem internet / sem baixar modelo?**
Sim. O app embarca o índice lexical + o modelo AILO-152M (~97MB) e opera 100% offline. Nada é baixado sozinho.

**Onde ficam meus XMLs e meu banco?**
XMLs importados vão para `%APPDATA%/Aurum Tax NCM/xml/<cnpj>/<chave>.xml`; o banco (empresas, produtos, auxiliares) fica no IndexedDB local. Nada sai da máquina e nada se perde ao atualizar.

**Como recebo tabelas novas (NCM, CST, alíquotas)?**
Junto com a atualização do programa (**Configurações → Atualização**): as bases são embutidas e versionadas com o app. Não há sincronização avulsa obrigatória. Como complemento, o app sincroniza sozinho a **tabela Siscomex** (NCM vigente) e as **tabelas CFF** quando há internet (alguns endpoints CFF exigem certificado digital — nesses casos, baixe o JSON no portal e importe manualmente).

---

## 📄 Licença

Ver [LICENSE](./LICENSE) (MIT).

© Aurum Bit Labs & Studios LTDA.
Base legal: [LC 214/2025](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm) · [Decreto 12.955/2026](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm) · [Res. CGIBS nº 6/2026](https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf)

<div align="center">
  <sub>Feito com ⚖️ + 💻 para a transição tributária brasileira.</sub>
</div>
