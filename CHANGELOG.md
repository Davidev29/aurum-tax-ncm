# Changelog — Aurum Tax NCM

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
