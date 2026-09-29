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
| 🧮 **Calculadora** | Monte cestas com produtos salvos ou NCM manual, edite qtd/valor e veja base, IBS, CBS, total e carga efetiva em tempo real. Alíquotas de referência editáveis (padrão IBS 17,70% + CBS 8,80%). |
| 🔍 **Consulta NCM** | Digite 8 dígitos (com ou sem ponto) e veja todas as classificações possíveis, reduções, anexo, documentos habilitados (NFe, NFCe, CTe…), observações legais (Art. 128/135/137) e simulação. |
| 📋 **Classificação individual** | Cadastro de produto (SKU, nome, NCM, qtd, valor, CFOP, CST ICMS/PIS/COFINS) + escolha da classificação da Reforma na lateral. Gera snapshot tributário no produto. |
| 📁 **Classificação em lote** | Arraste CSV/XLSX (`COD/SKU; NOME DO PRODUTO; NCM; CFOP; CST; PIS; COFINS`), o sistema classifica centenas de linhas de uma vez, permite trocar entre múltiplas opções e salvar tudo como produtos. Inclui modelo CSV para download. |
| 📄 **SPED Fiscal** | Importe EFD **ICMS/IPI** (blocos C100/C170/C190) ou **EFD Contribuições** (A100/A170, C100/C170, D100/D170). Detecta automaticamente o tipo, rejeita Reinf/e-Social/ECD/ECF com explicação, analisa **só as saídas**, agrupa por anexo, exibe gráficos, Top 15 produtos e exporta **PDF timbrado + CSV**. |
| 🧾 **NF-e XML** | Importe XMLs de NF-e, confronte com a base, apure IBS/CBS por nota e avalie crédito. |
| 📦 **Produtos & 🏢 Empresas** | Multi-empresa (CNPJ, razão social, fantasia, importação em lote). Produtos vinculados à empresa ativa. Exportação CSV / JSON / PDF. |
| 📚 **Tabelas auxiliares** | CST IBS/CBS, cClassTrib, Nomenclatura NCM vigente, vínculo NCM × Classificação, CFOP, CST ICMS, CST PIS/COFINS — todas **editáveis** (criar/editar/excluir). |
| ⚖️ **Legislação** | LC 214/2025, Decreto 12.955/2026 (CBS), Resolução CGIBS nº 6/2026 (IBS) e Portal Conformidade Fácil. Na consulta, *“Visualizar legislação”* abre o artigo exato (`#art128`, `#art137`…). |
| 🖨️ **Emitente timbrado** | Configure razão social, CNPJ, logo, cor e rodapé — sai no cabeçalho de todos os PDFs. |
| 🌙 **UX** | Tema claro/escuro, responsivo, atalhos, toasts, modo offline total. |

---

## 🚀 Começo rápido

### Requisitos

- **Node.js 20+** e **npm 10+**
- Windows 10/11, macOS 12+ ou Linux (para o instalador desktop)
- ~400 MB livres (dependências + build)

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

# Testes (Vitest, 20+ suítes)
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

Os artefatos saem em `./release/` (ex.: `AurumTaxNCM-1.0.0-win-x64.exe`).

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
aliqIBS = 17,70 × (1 − redIBS/100)
aliqCBS =  8,80 × (1 − redCBS/100)
vIBS    = base × aliqIBS / 100
vCBS    = base × aliqCBS / 100
total   = vIBS + vCBS
carga   = base > 0 ? total/base × 100 : 0
```

Derivação do **anexo** (só no SPED, pela `redIBS`):

| redIBS | Anexo | Rótulo |
|---|---|---|
| ≥ 100% | `0` | 🟢 Anexo I — Alíquota Zero |
| ≥ 60% | `60` | 🟡 Redução 60% |
| ≥ 30% | `30` | 🔵 Redução 30% |
| < 30% | `isento` | ⚪ Sem redução |

Observações legais automáticas: `≥100` → Alíquota Zero · `≥60` → Art. 128 (+ Art. 137 se in natura + Art. 135 se alimento) · `≥30` → Redução parcial · senão → Regra geral.

---

## 🛠️ Desenvolvimento

### Scripts npm

| Script | O que faz |
|---|---|
| `npm run dev` | Vite (127.0.0.1:5173) + Electron lado a lado |
| `npm run dev:web` | Só Vite no navegador |
| `npm run build` | Base + `tsc --noEmit` + `vite build` + Electron |
| `npm run build:electron` | Compila `electron/main.ts` + `preload.ts` via esbuild |
| `npm run base` | Gera a base embutida (`scripts/build-base.mjs`) |
| `npm run typecheck` / `npm test` | Tipos / Vitest (`vitest run`) |
| `npm run dist[:win,:mac]` | Instaladores via electron-builder |
| `npm run icon` | Gera `build/icon.ico` a partir do SVG |

### Estrutura

```
aurum-tax-ncm/
├── electron/            # main.ts, preload.ts, esbuild.mjs (processo main)
├── src/
│   ├── App.tsx          # troca de views (shell)
│   ├── main.tsx         # bootstrap React
│   ├── pages/           # Calculadora, Consulta, Classificar, Lote, Sped,
│   │                    #  NfeXml, Produtos, Auxiliares, Legislacao
│   ├── domain/          # entidades, constants, capitulos, legislacao, seeds
│   │   └── services/    # cálculo, classificação, observações legais
│   ├── application/     # casos de uso (produtos, empresas, lote, backup…)
│   ├── infrastructure/  # Dexie/IndexedDB, parsers SPED, NFe, PDF, CSV, Receita
│   ├── store/           # Zustand (ui, sessão, empresa ativa, alíquotas)
│   ├── ui/              # Layout, modais, TermoAceite
│   └── modais/
├── scripts/             # build-base.mjs, gen-seeds.cjs, gen-capitulos.cjs…
├── tests/               # 20+ suítes Vitest (cálculo, SPED, NFe, lote, PDF…)
├── docs/                # SPEC-LOGICA-NEGOCIO.md + contratos
├── public/              # assets estáticos + base JSON embutida
├── build/               # ícones, LICENCA.txt (instalador NSIS em PT-BR)
└── release/             # instaladores gerados (ignorado no git)
```

Arquitetura: **React + Clean Architecture** — `domain` (regras puras) → `application` (casos de uso) → `infrastructure` (Dexie, parsers, PDF) → `pages/ui` (apresentação). Paridade total com a v1 single-file, documentada em [`docs/SPEC-LOGICA-NEGOCIO.md`](./docs/SPEC-LOGICA-NEGOCIO.md).

### Stack

- **Desktop:** Electron 44 + electron-builder (NSIS PT-BR, DMG, AppImage)
- **Front:** React 19, Vite 8 (`base: './'` p/ file://), TailwindCSS 4, Zustand 5
- **Dados:** Dexie 4 (IndexedDB `aurum_tax_ncm_v1`), XLSX (SheetJS), Chart.js, pdfmake
- **Qualidade:** TypeScript strict, Vitest + jsdom + fake-indexeddb, esbuild

### Dados / base tributária

- `public/` carrega a base embutida gerada por `npm run base` (NCM × CST × cClassTrib + nomenclatura vigente).
- Para atualizar: **Configurações → Importação da base** e selecione o JSON novo (`NCM + tabelasAuxiliares` ou `Nomenclaturas`). Só entram vínculos com NCM de 8 dígitos; o resto é descartado com aviso.
- Backup: **Configurações → Backup** exporta tudo (empresas, produtos, auxiliares, emitente) em JSON; a restauração é idempotente.

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

---

## 📄 Licença

Distribuído sob **MIT** — ver [LICENSE](./LICENSE).

© Aurum Bit Labs & Studios LTDA — Todos os direitos reservados.
Base legal: [LC 214/2025](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm) · [Decreto 12.955/2026](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm) · [Res. CGIBS nº 6/2026](https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf)

<div align="center">
  <sub>Feito com ⚖️ + 💻 para a transição tributária brasileira.</sub>
</div>
