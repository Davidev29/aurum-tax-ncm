# Changelog — Aurum Tax NCM

## [Em breve] — 2026-11-13

- **Módulo NBS — base oficial embutida + mecanismo de atualização (plug-in pull).** A partir de agora o app embarca a **nomenclatura oficial NBS 2.00 completa** (3.239 posições: 26 capítulos, 146 posições, 454 subposições 1º nível, 802 2º nível, 892 itens, 919 subitens), com descrições oficiais (herança do ancestral mais próximo — a tabela oficial publica ~1.251 nós sem texto próprio), e o **DE-PARA oficial NBS 1.1 ↔ 2.0** (1.391 linhas). Fontes: MDIC — Painel de Códigos NBS (Power BI público) e MDIC — Correlações. Portaria Conjunta RFB/SCS nº 2.000, de 18/12/2018. Detalhes e SOP em `docs/fontes-oficiais-nbs.md` e achados em `docs/nbs-avaliacao-2026-11.md`
  - `npm run fontes:sync` — comando único para refrescar o que tem endpoint oficial (NBS oficial + DE-PARA + NCM Siscomex) + verificação de frescor/sha256 de todas as fontes + mapa auditável `bases-fonte/FONTES.json`
  - `npm run base` compila para `public/base/nbs-nomenclatura.json` e `public/base/nbs-depara.json` (versionados); `npm run verificar:pre` exige mínimos no gate
  - UI: 2 painéis novos em **Tabelas Auxiliares** (NBS 2.00 oficial e DE-PARA), bloco "Descrição do NBS pela tabela oficial (NBS 2.00)" no cartão de consulta NBS, 2 contadores em Config → Bases e os 2 artefatos no export geral
  - Nenhum dado tributário foi migrado: **os 122 vínculos da Reforma (Anexo II/IX) já são NBS 2.00** (verificados um a um contra a nomenclatura oficial)
  - 1 inconsistência da própria planilha DE-PARA mantida fiel à fonte e sinalizada (aviso): linha `1.0119.10.00 → 1.0105.21.00` aponta código fora da NBS 2.00 vigente
- **CBS de referência: 9% → 11,3%** (`public/base/parametros.json`, `PARAMETROS_REF`, `REF_DEFAULT`) — soma IBS 19 + CBS 11,3 = **30,3** (a confirmar com o ato vigente; `validarParametrosRef` valida)
- **Configurações → 🧮 Alíquotas** — editor manual das alíquotas de referência direto na máquina; a alteração local tem precedência sobre a tabela do instalador e cobre todo o cálculo do app (Consulta, simulador dos cartões, XML, apuração, relatórios e exports)
  - Override persistido em `meta` do SQLite (acompanha o backup/restauação); restaurável com um clique
  - Aba mostra origem vigente (`Tabela do programa` / `Estimativa` / `Seu ajuste`) e soma calculada
  - Store `useReferencia` passa a refletir o override em tempo real, inclusive no XML (via store `useNfe`)
- Testes: `referencia-override.test.ts` (5 casos) + `nbs-oficial-base.test.ts` (12 casos); total: **174 suítes · 1.963 casos**

## v1.2.0 — 2026-11-13

**Menu enxuto (9 telas).** A Calculadora foi descontinuada — a simulação IBS/CBS vive nos cartões da Consulta NCM — e a **Consulta NCM passou a ser a primeira tela** (e a tela inicial) do menu. Nada mais foi tocado nas regras fiscais, nas bases nem nos dados do usuário.

### Removed
- Tela **Calculadora Tributária** (`pages/Calculadora.tsx`) e store `store/calculadora.ts`
- Modal "Adicionar à calculadora" (`ModalCalculadora`), o modal de NCM manual (`ModalCalcCustom`) e a ação "Enviar para a calculadora" em Produtos
- Botão "🧮 Calculadora" nos cartões/detalhe da Consulta (NCM e NBS)
- `produtoParaCalculadora` em `application/produtos.ts`
- Passo "Calculadora" do tour guiado (9 passos, 3 trilhas mantidas); passos das trilhas renumerados

### Changed
- **Consulta NCM em primeiro lugar no menu** e como tela inicial (`useUi.view = 'consulta'`)
- Alíquotas de referência IBS/CBS passam a viver em `store/referencia.ts` (tabela viva `parametros.json`, estimativa 19/9 como fallback) — o Simulador rápido dos cartões segue idêntico
- IA: Chat direciona "me leva para a calculadora" para a Consulta NCM; textos/botões de "Abrir Calculadora" viram "Abrir Consulta NCM"; exemplos do roteador atualizados
- Testes: tour 9 passos, navegação sem calculadora; `motor-unico` sem o assert da conversão removida

## v1.1.0 — 2026-11-13

**Modalidade de distribuição: venda avulsa.** O app abre direto na tela inicial — sem assistente de instalação, sem conta, sem chave de licença, sem portão de ativação. Nenhum dado fiscal sai da máquina.

### Removed
- Assistente de instalação (`TermoAceite`/contrato na primeira execução)
- Camada de licenciamento Aurumbit inteira: `src/aurum/*` (portão, login, faturas, aba Conta, banners, guards), cofre safeStorage no main (`electron/main/aurum-licenca.ts`), canais `aurum:*` no preload/main, `LicencaPonte`/`SessaoContaPonte` na ponte IPC
- Guards de ações sensíveis (exportação PDF, excluir/trocar titular de empresa): o app é funcional desde o primeiro uso
- Auto-abertura do tour (disponível sob demanda no botão ✨ Guia)
- Proxy de desenvolvimento `/v1` + `/api` → `localhost:3000`; `VITE_AURUM_*` e o arquivo de exemplo correspondente
- 4 suítes da camada removida deletadas (`aurum-chave-fluxo`, `aurum-contrato`, `aurum-erros-toast`, `aurum-gate`); `tour-guiado-contrato` reescrita como `tour-guiado.test.ts` (só o tour); `guards-seguranca` enxugado

### Fixed
- `npm test` quebrado no Windows (o shim `node_modules/.bin/vitest` é shell script, `node` falhava com `SyntaxError`) → `node --experimental-sqlite node_modules/vitest/vitest.mjs run`
- Tela "Conta e pagamentos" vazia persistia em instalações legadas — removida de Configurações
- Docs desatualizados (`.planning` ainda declarava fase 1/Dexie/0%; README com contagens erradas; contrato/licença afirmando fluxo inexistente)

### Docs/Contracts
- README auditado de novo (172 suítes · 1.946 casos; versão 1.1.0)
- `build/LICENCA.txt` / `LICENCA.rtf` reescritos para a modalidade venda avulsa
- `docs/CONTRATO - Aurum Tax NCM (Licenca de Uso Desktop Local).docx` atualizado para v1.2 (Nov/2026) — as cláusulas de "Termo de Aceite"/ativação viraram aceite por aquisição (Pedido)
- `.planning/` (STATE, PROJECT, REQUIREMENTS, ROADMAP, codebase/*) reescrito para a realidade pós-1.0.0
- Instalador (Setup + Portátil) gerado a partir do código deste commit; licença do instalador = `build/LICENCA.txt/.rtf`

## v1.0.0 — 2026-10-12

Primeira entrega pública. 10 módulos: Calculadora IBS/CBS, Simples Nacional (+ projeção dividida v2), Consulta NCM, Serviços (NBS) + Consulta de CNAEs, Classificação em lote, Notas Fiscais (XML), Produtos, Tabelas auxiliares, Legislação, Produtos/Empresas multi-CNPJ, backup/restore transacional, atualização via GitHub Releases, Aurum AI determinística (léxico + grafo fiscal + resolvedor oficial).

**Nota:** as releases do produto são marcadas no GitHub Releases deste repositório.
