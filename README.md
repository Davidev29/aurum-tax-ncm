<div align="center">

# 🏛️ Aurum Tax NCM

### Classificador fiscal da Reforma Tributária — LC 214/2025

**Analise XML • Classifique por NCM/NBS • Simule IBS/CBS e Simples • Gere relatórios**

[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=for-the-badge&logo=electron&logoColor=white)](./electron/main.ts)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](./src/App.tsx)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](./vite.config.ts)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](./tsconfig.json)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](./src/index.css)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

*Aplicativo desktop (Windows / macOS / Linux) + modo web, 100% local e offline-first.*
*Versão atual: **1.0.0** · **77 suítes / 651 casos Vitest** · 10 views (9 no menu + Diagnóstico IA oculto).*

[✨ Proposta](#-proposta-do-sistema) • [🆕 Novidades](#-novidades) • [🚀 Começo rápido](#-começo-rápido) • [📖 Guia de uso](#-guia-de-uso-módulo-a-módulo) • [🧮 Regras tributárias](#-como-o-cálculo-funciona) • [🛠️ Desenvolvimento](#️-desenvolvimento)

</div>

---

## 📌 Proposta do sistema

A **Reforma Tributária (Lei Complementar nº 214/2025)** extingue PIS, COFINS, ICMS e ISS e cria o **IBS** (Imposto sobre Bens e Serviços) e a **CBS** (Contribuição sobre Bens e Serviços), além do Imposto Seletivo.

Na prática, todo produto/serviço passa a ser classificado por:

| Campo | O que é | Exemplo |
|---|---|---|
| **NCM** | Nomenclatura Comum do Mercosul (8 dígitos) | `0201.10.00` — Carnes de bovino |
| **NBS** | Nomenclatura Brasileira de Serviços (9 dígitos) | `122011100` — Serviços específicos, Anexo II |
| **CST IBS/CBS** | Código de Situação Tributária no novo modelo | `000` — Tributação integral |
| **cClassTrib** | Classificação tributária detalhada (reduções, anexos, regimes) | `000001` — Regra geral |

O **Aurum Tax NCM** é o assistente do contador, fiscal e empresário para essa transição:

> **Você informa o NCM/NBS (ou importa XML / planilha / CNPJ) → o sistema devolve CST + cClassTrib + % de redução de IBS/CBS + base legal + simulação em R$ — e, no Simples, o DAS + duelo Convencional × Híbrido.**

Tudo roda **localmente** (IndexedDB via Dexie, sem servidor, sem enviar dados fiscais para nuvem). Complementos online (Siscomex, CFF, BrasilAPI) só atuam quando há internet, com fallback manual.

---

## 🆕 Novidades

Estado real do código em `main` (03/10/2026):

| Área | Situação |
|---|---|
| 🧮 **Simples Nacional (`src/simples/`, 10 arquivos)** | **NOVO, ainda não comitado.** Módulo isolado (não importa o motor IBS/CBS): modos **Manual (Anexo I–V)** e **Automático por CNPJ** (BrasilAPI → CNAE → anexo). RBT12, receita do mês, folha 12m (Fator R ≥ 28% → III, senão V), RBA/sublimite R$ 3,6M em 4 cenários, trava ISS 5% com redistribuição, CBS de referência (padrão 8,80%) + despesas com crédito por item. Duelo **Convencional (CBS dentro) × Híbrido (CBS por fora)**, modal de repartição do DAS, **Relatório Analítico e Inteligente** (10 cenários I/II/III/IV/V × Conv/Híb, matriz III×V só em CNPJ dual, memória do híbrido, Fator R detalhado com gap de folha, hash + `reportId`, IA em modo leitura). Exports CSV / JSON canônico / PDF premium timbrado. Vigência 2027–2028 (a partir de 2029 as porcentagens mudam). |
| 🧰 **Serviços NBS/CNAE/CNPJ (Phase 7, implementada)** | Consulta NBS manual (9 dígitos) + automática por CNPJ, base viva (`CNAE X ANEXO.json` 1.090 CNAEs + `NBS SERVIÇOS.json` 137→112 após dedupe), resolvedor NBS próprio (`resolverClassificacoesNbs`, regra geral `000/000001` fora da base), busca textual + IA de serviços com vocabulário/sinais próprios, ponte CNAE→NBS, `CartaoCnae`/`FaixaCnae`, trilha de auditoria. |
| 🧾 **NF-e XML com 2 layouts** | `NfeXml` (clássica, com Chart.js) + `NfeXmlPolida` (padrão, veredito→ação→5 abas, zero canvas, count-up, copy-on-click, `localStorage['xml-layout']`). Hero executivo (a pagar / saldo credor / zerado), entradas × saídas, quarentena, ranking de fornecedores, top produtos/NCM/CFOP/CST, confronto Antigo × Novo, evolução mensal, apuração IBS/CBS, relatório IA + modal de relatório. |
| 🤖 **Aurum AI integrada (offline)** | Bypass determinístico → RAG lexical (`indice-lexical.json` + sinônimos) → modelo local **AILO-152M** (`recursos-ia/modelo/*.gguf`) em `utilityProcess` isolado. Geração restrita validada pelo resolvedor oficial (anti-alucinação: `99999999` e NCM sem nomenclatura viram “NÃO SEI”). Trilha em `audit_log` + `ia_feedback` + `logs/consultas-ia.jsonl`. Diagnóstico em `Ctrl+Shift+D` (view oculta `debugia`). Índice reconstruído por hash do `MANIFEST.json`. Inclui tradução PT↔EN, dicionário comercial e cobertura de tradução. |
| 🐾 **Pet Aurum (Aurinha)** | Mascote reativo na sidebar (estados por tela, celebra exportações, falas por horário, farejo, locomoção). Stores dedicadas `pet*` + sprite/CSS próprios. |
| ⚖️ **Legislação ampliada** | LC 214/2025 + Decreto 12.955/2026 (CBS) + Resolução CGIBS nº 6/2026 (IBS) + RICMS-CE + portais, leitura in-app via `ModalLegislacao`, deep-link `#art128` etc. |
| 🔄 **Bases e sincronizações** | Bases **embutidas e versionadas** (`public/base/` + `bases-fonte/`). Sync Siscomex (NCM vigente com diff novos/alterados/extintos), sync CFF (classTrib, anexos, crédito presumido, NFCom/NFAg/NF3e/NFGas — alguns exigem certificado ICP-Brasil, com importação manual de fallback), consulta CNPJ via BrasilAPI (DV local + cache 30d). Verificação de atualização via GitHub Releases em **Configurações → Atualização**. |
| 🧪 **Qualidade** | **77 arquivos `.test.ts`** (68 em `tests/` + 9 em `tests/ia/`), **651 casos `it/test`** contados estaticamente. Cobrem cálculo, lote, NFe (parse/apuração/crédito/regime/insights/relatório), SPED (parser), serviços/NBS, IA/classificação, CFF/Siscomex, vigência, reclassificação, PDF timbrado, Simples, relatório analítico, pet. |
| 📦 **Build blindado** | Pipeline `base:completa` + `tsc` + Vite + Electron + **ofuscação** (`ofuscar-build.cjs`) + **verificação** (`verificar-build.mjs`). Instaladores NSIS/Portable (Win), DMG/ZIP (Mac), AppImage (Linux). `recursos-ia/modelo` e `embedding` fora do `build.files`, reanexados via `extraResources` + `after-pack-ia.cjs`. |

> ⚠️ **SPED Fiscal — nota de honestidade:** o **motor SPED existe** (`src/infrastructure/sped/`: parse EFD ICMS/IPI C100/C170/C190 + EFD Contribuições, detecção de tipo com rejeição explicada de Reinf/e-Social/ECD/ECF, modo resumo C190, análise só de saídas, testes), mas **não há tela “SPED Fiscal” no menu atual**. As 10 views são: Calculadora, Simples Nacional, Consulta NCM, Serviços (NBS), Classificação em lote, Notas Fiscais (XML), Produtos, Tabelas auxiliares, Legislação + Diagnóstico IA oculto. A doc legada `docs/SPEC-LOGICA-NEGOCIO.md` ainda descreve o fluxo SPED da v1 single-file como referência do motor.

---

## ✨ Recursos principais

| Módulo | O que faz |
|---|---|
| 🧮 **Calculadora** | Cestas com produtos salvos ou NCM manual, qtd/valor editáveis, base + IBS + CBS + total + carga efetiva em tempo real. Alíquotas de referência editáveis (padrão IBS 19% + CBS 9%). Reduções congeladas no momento da adição. |
| 🧾 **Simples Nacional** *(novo)* | Passo 1: Anexo manual **ou** CNPJ → escolha 1 CNAE (“Qual usar?”). Passo 2: RBT12 + receita (+ folha se Anexo V/Fator R + RBA opcional + comparador híbrido opcional). Passo 3: **Visualizar cálculo** (skeleton Aurum AI → slide-in). Saída: DAS + repartição IRPJ/CSLL/CBS/IBS/CPP/ICMS/IPI/ISS, CBS dentro, Fator R automático, sublimite 4 cenários, duelo Conv × Híb, relatório analítico executivo (10 cenários + matriz III×V + memória híbrida + insights só-leitura), modal DAS, exports CSV/JSON/PDF. |
| 🔍 **Consulta NCM** | 8 dígitos (com ou sem ponto), fan-out número/nome/Aurum AI, N cards de classificação (CST · cClassTrib, % redução, anexo oficial, base legal, documentos NFe…NFSe), observações legais automáticas (Art. 128/135/137/158/261/275–289/127/308), simulador editável, “Visualizar legislação” no artigo exato, correção/detecção de escopo da consulta. |
| 🧰 **Serviços (NBS/CNAE/CNPJ)** | NBS manual + descrição livre (“aula de inglês online”) + CNPJ→CNAEs→NBS. Cartão por CNAE, Fator R como refino, tradutor fiscal PT↔EN, motor de hipóteses + verificação + preditivo, trilha de auditoria. Bases vivas versionadas. |
| 📋 **Classificação individual** *(dentro de Produtos/Lote/Consulta)* | SKU + nome + NCM obrigatórios, qtd/valor/CFOP/CST ICMS/PIS/COFINS (com cadastro rápido via **＋**), escolha da classificação da Reforma na lateral, snapshot tributário no produto, reclassificação manual com propagação + modal de divergência. |
| 📁 **Classificação em lote** | CSV/XLSX (`COD/SKU; NOME; NCM; CFOP; CST; PIS; COFINS`), centenas de linhas, pills (classificadas · regra geral · múltiplas opções · inválidos), `<select>` por linha, revisão IA (`analise-lote-ia`), salvamento como produtos, modelo CSV para download. |
| 🧾 **NF-e XML (2 layouts)** | Import NF-e mod. 55 / NFC-e mod. 65 (chaves repetidas ignoradas, quarentena), histórico por empresa/período, fornecedores (Simples sem crédito sinalizado), confronto NCM × base, apuração IBS/CBS (entradas=crédito, saídas=débito), insights (antigo×novo, evolução mensal, divergências, Top NCM/CFOP/CST), relatório IA + modal de relatório, vincular produtos, XMLs arquivados em `%APPDATA%/Aurum Tax NCM/xml/<cnpj>/<chave>.xml`. |
| 📦 **Produtos & 🏢 Empresas** | Multi-empresa (CNPJ, razão social, fantasia, lote), produtos vinculados à empresa ativa (modo visualização sem empresa), filtro 180 ms, paginação, exports CSV/JSON/PDF, idempotência em importações repetidas (lote/SPED). |
| 📚 **Tabelas auxiliares** | 8 listas editáveis via `AUX_META`: CST IBS/CBS, cClassTrib, NCM vigente, vínculo NCM×Classificação, CFOP, CST ICMS, CST PIS/COFINS (+ CNAE). Criar/editar/excluir com validação. |
| ⚖️ **Legislação** | Base federal + decretos + RICMS-CE + portais (CFF/Siscomex), texto integral em `src/infrastructure/legislacao-texto.ts` + catálogo, abertura no artigo exato. |
| 🖨️ **Emitente timbrado** | Razão social, CNPJ, logo, cor, rodapé — cabeçalho de todos os PDFs (inclui marca-d’água e modal de preview). |
| 🤖 **IA embutida (Aurum AI)** | Ver [Novidades](#-novidades). Atalho `Ctrl+Shift+D` abre o DebugIA. Nada sai da máquina. |
| 🔄 **Atualização e bases** | GitHub Releases (Configurações → Atualização). Bases embutidas renovadas a cada release. Complementos online: Siscomex + CFF + BrasilAPI (com fallback manual). Backup/restauração JSON idempotente. |
| 🐾 **Aurinha + 🌙 UX** | Pet-assistente + tema claro/escuro, responsivo, sidebar recolhível, drawer móvel, atalhos, toasts 3,4 s, skeleton/count-up/motion com respeito a `prefers-reduced-motion`, aceite local no primeiro uso. |

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

# Testes (Vitest, 77 suítes / 651 casos)
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

O instalador leva **só o app**: interface + base tributária embutida + índice da IA + modelo AILO-152M via `extraResources`.
`.planning/`, `docs/`, `tests/`, `scripts/` e pastas de modelo/embedding ficam de fora por regra explícita no `build.files` do `package.json`.
Os dados do usuário (XMLs importados, IndexedDB) vivem em `%APPDATA%` — fora da pasta do programa — e sobrevivem a atualizações/desinstalações.

> `npm run base` regenera `public/base/` a partir dos JSONs-fonte de `bases-fonte/`, mas o build **não depende deles**:
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

### 🧾 2. Simples Nacional (novo)

1. Vá em **Simples Nacional**.
2. **Passo 1:** modo **Manual** (toque um Anexo I–V) ou **Automático por CNPJ** (digite o CNPJ → **Buscar atividades** → escolha **1 CNAE** em “Qual atividade usar?”; as demais colapsam, com **Trocar atividade** para simular outra).
3. **Passo 2** (só aparece após o Passo 1): informe **RBT12** + **receita do mês**. Folha 12m só aparece com Anexo V/Fator R (com previsão automática III × V). Opcional: **RBA diferente** (sublimite R$ 3,6M) e **Comparar com o regime híbrido** (CBS ref + despesas com crédito por item).
4. **Passo 3:** **✨ Visualizar cálculo** (a Aurum AI “pensa” 750 ms com skeleton, depois slide-in).
5. Resultado: **GUIA DAS** + repartição por tributo + CBS dentro + trava ISS + Fator R + cenário do sublimite (1–4) + duelo Conv × Híb + **Relatório Analítico e Inteligente** (10 cenários, matriz III×V em CNPJ dual, memória do híbrido, gap de folha).
6. Ações: **Repartição** (modal DAS), **CSV / JSON / PDF analítico premium**, **Limpar**.

### 🔍 3. Consulta por NCM

1. Vá em **Consulta NCM**.
2. Digite `02011000` ou `0201.10.00` — sugestões a partir de 2 dígitos; também aceita nome do produto e linguagem natural (via Aurum AI com validação).
3. Clique em **Classificar**. Você verá:
   - Descrição oficial da nomenclatura + capítulo
   - Um card por classificação: `CST · cClassTrib`, % redução IBS/CBS, anexo oficial, base legal, documentos (NFe…NFSe)
   - Observações legais automáticas (ex.: *Art. 137 — in natura*, *Art. 135 — alimentos*)
   - Simulador com valor editável
   - Botão **Visualizar legislação** (abre o artigo exato da LC 214)
4. **➕ Adicionar à calculadora** joga a classificação direto na cesta.

> **NCM sem vínculo específico?** O sistema aplica a **regra geral** (`CST 000 · 000001`, tributação integral) e avisa em âmbar. É o comportamento oficial da LC 214.

### 🧰 4. Serviços (NBS)

1. Vá em **Serviços (NBS)**.
2. Modo **Manual:** digite o NBS (9 dígitos) ou descreva o serviço (“aula de inglês online”) — o GATE determinístico tenta primeiro; a IA só entra se houver lastro, senão retorna NÃO SEI.
3. Modo **Por CNPJ:** digite o CNPJ → o sistema lista os CNAEs (principal + secundários) com anexo Simples + elegibilidade, 1 cartão por CNAE.
4. Cada resultado mostra CST/cClassTrib, reduções, anexo LC 214 (≠ anexo do Simples), base legal e simulação. Trilha de auditoria disponível.

### 📁 5. Classificação em lote

1. Vá em **Classificação em lote**.
2. Baixe o **modelo CSV** (`COD/SKU;NOME DO PRODUTO;NCM;CFOP;CST;PIS;COFINS`) se for a primeira vez.
3. Arraste o `.csv` / `.xlsx` / `.xls` para a área pontilhada.
4. Confira as pills: classificadas · em regra geral · com múltiplas opções · inválidos.
5. NCMs com N opções têm um `<select>` para trocar a classificação (+ revisão IA quando cabível).
6. **Salvar todos como produtos** (ignora linhas sem SKU ou sem NCM válido, idempotente).

### 🧾 6. Notas Fiscais (XML) — layout Polida (padrão) e Clássica

1. Vá em **Notas Fiscais (XML)** (requer empresa ativa).
2. Arraste 1 ou N `.xml` (NF-e 55 / NFC-e 65; duplicadas ignoradas, quarentena separada).
3. Hero executivo: **veredito** (A pagar / Saldo credor / Zerado) + Base + IBS+CBS + Carga + barra de cobertura crédito/débito.
4. Explore as 5 abas: **Notas** (tabela + detalhe por item) · **Fornecedores** (ranking de crédito, Simples sinalizado) · **Produtos** (mais comprados/vendidos) · **NCM** (por benefício/CST/CFOP/Top NCM) · **Insights** (Antigo × Novo, evolução mensal, prontidão do XML).
5. Ações: **Vincular produtos**, filtros (texto/direção/fornecedor/CFOP/CST), **relatório IA + modal de relatório**, alíquotas IBS/CBS de referência editáveis, botão **↩ Clássica** para alternar o layout (`xml-layout`).

### 📦 7. Produtos, 🏢 Empresas, 📚 Auxiliares e ⚙️ Configurações

- **Produtos**: filtre por SKU/nome/NCM, exporte CSV/JSON/PDF, edite ou exclua. Tudo respeita a **empresa ativa** no topo.
- **Empresas** (botão 🏢 no header): cadastre por CNPJ, importe em lote, defina a ativa. Sem empresa ativa = *modo visualização*.
- **Tabelas auxiliares**: 8 listas (CST, cClassTrib, NCM, vínculo NCM×Classificação, CFOP, CST ICMS/PIS-COFINS, CNAE) com filtro + **＋ Novo** + editar/excluir. Útil quando a legislação atualizar um código antes da próxima base oficial.
- **Configurações** (⚙️): emitente timbrado (+ preview), **importação da base** (`reforma_tributaria_por_ncm.json` e `Tabela_NCM_Vigente_*.json`), backup/restauração JSON, status da base (contadores por store), **Atualização** via GitHub Releases.

---

## 🧮 Como o cálculo funciona

### IBS/CBS (LC 214 — redução de alíquota)

Fórmula única em Calculadora/Consulta/Lote/XML:

```
aliqIBS = 19 × (1 − redIBS/100)
aliqCBS =  9 × (1 − redCBS/100)
vIBS    = base × aliqIBS / 100
vCBS    = base × aliqCBS / 100
total   = vIBS + vCBS
carga   = base > 0 ? total/base × 100 : 0
```

Derivação do **anexo** (faixa operacional por `redIBS`+`redCBS`):

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

Observações legais automáticas: `100` → Alíquota Zero · `60` → Art. 128 (+ Art. 137 se in natura + Art. 135 se alimento) · `80` → Art. 158 · `70`/`50` → Art. 261 · `40` → Arts. 275–289 · `30` → Art. 127 · `60/100` → Art. 308 (Prouni) · senão → Regra geral.

### Simples Nacional (LC 123 + Reforma, vigência 2027–2028)

```
faixa = localizar(RBT12 nos limites do anexo)
aliquotaEfetiva = (RBT12 × nominal − deduzir) / RBT12
DAS = aliquotaEfetiva × receitaMes
repartição: valorTributo = DAS × %faixa
6ª faixa: ICMS/ISS/IBS/IPI pela alíquota efetiva da 5ª faixa
ISS: trava 5% + redistribuição do excedente (IRPJ/CSLL/CBS/CPP)
sublimite R$ 3,6M: 4 cenários (RBT12 × RBA)
Fator R = folha12 / RBT12 (≥ 28% → III, senão V)
híbrido: DASreduzido = DAS − CBSdentro; CBSfora = MAX(0, débitos − créditos)
```

---

## 🛠️ Desenvolvimento

### Scripts npm

| Script | O que faz |
|---|---|
| `npm run dev` | Vite (127.0.0.1:5173) + Electron lado a lado |
| `npm run dev:web` | Só Vite no navegador |
| `npm run dev:renderer` / `dev:electron` | Partes do `dev` (usadas pelo `concurrently`) |
| `npm run build` | `base:completa` + `tsc --noEmit` + `vite build` + Electron + ofuscar + verificar |
| `npm run build:electron` | Compila `electron/main.ts` + `preload.ts` + workers IA via esbuild |
| `npm run base` | Gera a base embutida a partir de `bases-fonte/` (`scripts/build-base.mjs`) |
| `npm run base:completa` | Base + dados IA + índice lexical + validação do conhecimento |
| `npm run ia:indice` / `ia:testar-indice` / `ia:validar-conhecimento` / `ia:cobertura` | Pipeline da Aurum AI (índice, teste, curadoria, cobertura PT↔EN) |
| `npm run ofuscar` / `ofuscar:check` | Ofusca o build / só confere |
| `npm run verificar` / `verificar:pre` | Valida o build (pós/pŕe) |
| `npm run typecheck` / `npm test` | Tipos / Vitest (`vitest run`) |
| `npm run dist` / `dist:win` / `dist:mac` | Instaladores via electron-builder |
| `npm run icon` | Gera `build/icon.ico` a partir do SVG |

### Estrutura

```
aurum-tax-ncm/
├── electron/            # main.ts, preload.ts, esbuild.mjs
│   ├── dist/            # compilados (main.js, preload.cjs, workers IA)
│   └── ia/              # worker IA offline (utilityProcess isolado, RAG lexical + GGUF AILO-152M)
├── src/
│   ├── App.tsx          # shell: Calculadora, Simples, Consulta, Serviços, Lote,
│   │                    #  NfeXml/NfeXmlPolida, Produtos, Auxiliares, Legislacao (+ DebugIA oculta)
│   ├── main.tsx         # bootstrap React
│   ├── pages/           # 12 arquivos: Calculadora, Consulta, ConsultaServicos, Lote,
│   │                    #  NfeXml, NfeXmlPolida, ModalRelatorioNfe, Produtos,
│   │                    #  Auxiliares, Legislacao, DebugIA
│   ├── simples/         # 10 arquivos: módulo Simples isolado (tabelas, calculo, store,
│   │                    #  page, DasModal, relatorio-analitico, RelatorioAnalitico,
│   │                    #  export, export-relatorio-analitico, ia-insights)
│   ├── domain/          # entidades, constants (10), capitulos, legislacao, seeds, contrato
│   │   └── services/    # 21 serviços: cálculo, classificação NCM/NBS, busca-texto,
│   │                    #  CNAE/CNPJ, vocabulários, preditivo, verificação, correção…
│   ├── application/     # 22 casos de uso (produtos, empresas, lote, backup, CFF/Siscomex,
│   │                    #  NFe insights/relatório, IA NCM/serviços, reclassificação, atualização…)
│   ├── infrastructure/  # 30 arquivos: Dexie/IndexedDB, base, parsers (lote/SPED/NFe),
│   │                    #  PDF/CSV, CFF/Siscomex/BrasilAPI, bridge IPC, legislação-texto
│   ├── store/           # 18 arquivos Zustand (ui, sessão, calculadora, simples fora daqui,
│   │                    #  consulta, lote, nfe, produtos, base, ia, pet*…)
│   ├── ui/              # 21 arquivos: Layout, kit, Marca, PetAurum, ModalLegislacao,
│   │                    #  motion, consulta-enxuta/premium, servicos, cartoes…
│   └── modais/          # 3 arquivos: globais (empresas/config/emitente/backup…), pagina, reclassificacao
├── recursos-ia/         # IA offline: GGUF AILO-152M + índice lexical + conhecimento (via extraResources)
├── bases-fonte/         # 8 JSONs-fonte oficiais + vivos (ver tabela abaixo)
├── scripts/             # build-base, gerar-indice-ia, cobertura-traducao, ofuscar, verificar, after-pack…
├── tests/               # 77 suítes (68 raiz + 9 em tests/ia) — 651 casos
├── docs/                # SPEC-LOGICA-NEGOCIO.md, arquitetura/segurança/troubleshooting IA,
│                        #  diagnósticos fase 0–6/8 + final, manuais + 2 contratos .docx (fora do instalador)
├── public/              # assets + base JSON embutida versionada (5 JSONs + MANIFEST)
├── build/               # icon.ico/png, LICENCA.rtf/txt (instalador NSIS em PT-BR)
└── release/             # instaladores gerados (ignorado no git)
```

Arquitetura: **React + Clean Architecture** — `domain` (regras puras) → `application` (casos de uso) → `infrastructure` (Dexie, parsers, PDF) → `pages/ui` (apresentação). Paridade com a v1 single-file documentada em [`docs/SPEC-LOGICA-NEGOCIO.md`](./docs/SPEC-LOGICA-NEGOCIO.md). O módulo `src/simples/` é **isolado de propósito** (matemática própria das planilhas, sem importar o motor IBS/CBS).

### Stack

- **Desktop:** Electron 44 + electron-builder (NSIS PT-BR, DMG, AppImage)
- **Front:** React 19, Vite 8 (`base: './'` p/ file://), TailwindCSS 4, Zustand 5, Framer Motion, Chart.js
- **Dados:** Dexie 4 (IndexedDB `aurum_tax_ncm_v1`), XLSX (SheetJS), pdfmake, fast-xml-parser
- **IA local:** node-llama-cpp (AILO-152M Q4_K_M) em `utilityProcess`
- **Qualidade:** TypeScript strict, Vitest + jsdom + fake-indexeddb, esbuild, ofuscação + verificação de build

### Dados / base tributária

- `public/base/` carrega a base embutida gerada por `npm run base` (NCM × CST × cClassTrib + nomenclatura vigente + NBS + CNAE + `MANIFEST.json` com hash do índice IA).
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
| `cnae.json` / `mei_cnaes.json` | Apoio CNAE/MEI para consulta por CNPJ e Simples | Derivados/curados no projeto (espelham BrasilAPI + tabela viva) | Não |

Outras tabelas CFF (`anexos`, `credPresumido`, `indOper`, `ConsultaClassificacaoProduto?sistema=NFCom|NFAg|NF3e|NFGas`) não entram no `npm run base`: são sincronizadas/importadas em tempo de execução (algumas exigem certificado digital ICP-Brasil — nesse caso baixe o JSON no portal CFF e importe em **Configurações → Importação da base**).

---

## ❓ FAQ

**Precisa de internet?**
Não para o uso diário. Só legislação externa, sync Siscomex/CFF/BrasilAPI e verificação de atualização usam rede — tudo com fallback offline/manual.

**Meus dados do SPED/XML saem da máquina?**
Não. Todo o processamento é local (IndexedDB no Electron/navegador). Não há backend. O motor SPED (EFD ICMS/IPI + Contribuições) roda localmente; hoje sem tela dedicada — a importação com UI é a de **XML de NF-e**.

**E se meu NCM tiver 2 classificações?**
Na Consulta você vê os N cards; na Classificação e no Lote você escolhe no radio/select. No XML o sistema usa a primeira da base (ordem de importação) — troque manualmente no Lote se precisar. Em Serviços (NBS) vale a mesma lógica, com regra geral `000/000001` fora da base.

**Posso usar no navegador sem instalar?**
Sim: `npm run dev:web` ou sirva a pasta `dist/` após `npm run build`. O Electron só adiciona janela nativa, menu, workers IA isolados e instalador.

**A IA funciona sem internet / sem baixar modelo?**
Sim. O app embarca o índice lexical + o modelo AILO-152M e opera 100% offline. Nada é baixado sozinho. O índice é reconstruído por hash do `MANIFEST.json` quando a base muda.

**Onde ficam meus XMLs e meu banco?**
XMLs importados vão para `%APPDATA%/Aurum Tax NCM/xml/<cnpj>/<chave>.xml`; o banco (empresas, produtos, auxiliares) fica no IndexedDB local. Nada sai da máquina e nada se perde ao atualizar.

**Como recebo tabelas novas (NCM, CST, alíquotas)?**
Junto com a atualização do programa (**Configurações → Atualização**): as bases são embutidas e versionadas com o app. Como complemento, o app sincroniza sozinho a **tabela Siscomex** (NCM vigente) e as **tabelas CFF** quando há internet (alguns endpoints CFF exigem certificado digital — nesses casos, baixe o JSON no portal e importe manualmente).

**O Simples Nacional substitui a Calculadora IBS/CBS?**
Não. São motores separados: a **Calculadora** simula IBS/CBS da LC 214 por NCM; o **Simples** calcula o DAS (LC 123 + Reforma 2027–2028) por Anexo/RBT12 e compara Convencional × Híbrido. Use os dois conforme o regime do cliente.

---

## 📄 Licença

Ver [LICENSE](./LICENSE) (MIT).

© Aurum Bit Labs & Studios LTDA.
Base legal: [LC 214/2025](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm) · [Decreto 12.955/2026](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm) · [Res. CGIBS nº 6/2026](https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf)

<div align="center">
  <sub>Feito com ⚖️ + 💻 para a transição tributária brasileira.</sub>
</div>
