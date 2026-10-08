# ARQUITETURA — Aurum Tax NCM

> Estado em 2026-10-08 (passo Arquitetura/Performance). Este doc define a
> **regra-alvo** e lista as **violações conhecidas** como backlog — não afirma
> conformidade onde ela ainda não existe.

## 1. Camadas

```
ui/pages/store  →  application  →  domain
       ↓                ↓
   infrastructure (implementa ports, SQLite, PDF, IPC, logs)
```

| Camada | Papel | Pode importar |
|---|---|---|
| `domain/*` | Regra fiscal pura (LC 214/2025): entidades, serviços, constantes | `domain/*` apenas (**alvo** — ver §5) |
| `application/*` | Casos de uso + ports (orquestram domain + infrastructure) | `domain`, `ai/guards`, `infrastructure` (via ports), outros `application` |
| `infrastructure/*` | Adaptadores: db, parsers, exporters, bridge/Electron, repos IA | `domain`, `application` (tipos/ports) |
| `store/*` | Estado zustand (fatia por tela) | `application`, `domain`, `infrastructure` |
| `pages/*`, `simples/*` | Apresentação React (alvo: só via `application` — ver §5) | `store`, `ui`, `application`, `domain` (format/services) |
| `ui/*` | Kit visual sem negócio (`kit`, `Layout`, `motion`, `skeleton`) | quase nada (só `domain/constants`, `store/ui` no `kit`) |
| `ai/*` | Guards transversais (`removerPII`, `hashEmitente`) | `domain` |

## 2. Convenção EN/PT

- **Código em inglês**: identificadores, nomes de arquivo, comentários estruturais
  (`function agendarJobOverlay`, `src/application/log-rotacao.ts` aceita
  hífen PT quando o termo é do negócio — ex.: `apuracao`, `cnae`).
- **Humano em PT-BR**: toda string visível na UI, toasts, logs legíveis,
  mensagens de erro apresentadas, docs.
- Regra prática: se aparece na tela, é PT-BR; se aparece no import, é EN
  (com exceção de termos fiscais intraduzíveis: `apuracao`, `cClassTrib`).

## 3. Domain puro (alvo)

`domain/*` **não** importa `application`, `infrastructure`, `store`, `ui` ou
`pages` — nem valor, nem tipo. Motivo: a regra fiscal precisa rodar idêntica
no renderer, no Electron-main, nos scripts e nos testes, sem arrastar SQLite,
IPC ou React.

## 4. Ports

Fronteiras que `infrastructure` implementa e `application` consome:

- `bridge` (`src/infrastructure/bridge.ts`) — único canal renderer→main (IPC);
  `application` nunca toca `window`/`ipcRenderer` direto.
- Repositórios (`infrastructure/base/*`, `infrastructure/db/*`) — SQLite/prisma;
  casos de uso recebem dados, não abrem banco.
- Trilha auditável dupla: `audit_log` (SQLite) + `logs/*.jsonl` (best-effort
  Node) via `src/application/log-rotacao.ts` (teto 5 MiB, 3 gerações, scrub
  de `descricao` com `removerPII`).
- Overlay de aprendizado (`application/grafo-overlay.ts`) — só reordena
  (boost com teto), nunca cria redução; resolvedor tem veto total; nunca lança.

## 5. Pages só via application (alvo + violações conhecidas)

**Alvo**: `pages/*` falam com `store` + `application`; nunca importam
`infrastructure/*` direto (cálculo, export, banco). Tipos de infraestrutura
(`NotaXml`, `ItemLote`) entram via `application` ou via `domain/entities`.

**Violações conhecidas (backlog, não quebrar em refactor oportunista)**:

- `pages`: `NfeXml.tsx:37-43`, `NfeXmlPolida.tsx:28-29`, `Lote.tsx:21-24`,
  `Consulta.tsx:53-59`, `Calculadora.tsx:29`, `NfeNatureza.tsx:13`,
  `NfeConferenciaProdutos.tsx:13`, `ModalRelatorioNfe.tsx:10-11`,
  `ConsultaCnaes.tsx:16` importam `infrastructure/*` direto.
- `domain` importa fora: `services/classificacao-nbs.ts`,
  `services/cnae.ts`, `services/cnae-nbs.ts`, `services/preditivo-servicos.ts`,
  `services/validacao-produto.ts` (→ `infrastructure/db`, `base/*`);
  `services/validacao-produto.ts` (→ tipo de `application/produtos`);
  `tutorial.ts` (→ tipo de `store/ui`); `constants/aliases.ts` (→ db);
  `simples/nucleo.ts`, `simples/validacao.ts`, `services/percentual-chat.ts`
  (→ `simples/*`).
- Migração de exemplo já aplicada: `NfeXmlPolida` dedupou `apurarIbsCbs`
  (cache por referência `apuracaoUnica`); o próximo passo é expor a apuração
  via `application/notas-xml` em vez de importar `infrastructure/nfe/apuracao`.

## 6. Performance (passo atual)

- `App.tsx`: 11 views em `React.lazy` + `Suspense` (`SkeletonPagina`) +
  boundary por view (`ErroFatal key={view}`) + global em `main.tsx`;
  `xml-layout` lido 1× via `useState` inicial (fora do render crítico);
  `Consulta` pré-carregada em idle (`requestIdleCallback`/`setTimeout`).
- Chart.js: registro central em `src/ui/chart-registry.ts`
  (`garantirChartsRegistrados`, idempotente). Migração pendente nos 4 pontos
  que ainda registram direto: `simples/Graficos.tsx:26`, `pages/NfeXml.tsx:58`,
  `ui/grafico-chat.tsx:31` (+plugin de sombra 56-64),
  `simples-projection/SimuladorSegregacao.tsx:34`. **Não** importar o registry
  no boot — puxaria o `chart.js` para o chunk inicial.
- Logs: `application/log-rotacao.ts` criado; integração pendente —
  `anexarConsultaIaJsonl` (`infrastructure/ia/classificacao-ia-repo.ts:93`)
  deve delegar a `acrescentarLog('consultas-ia.jsonl', …)`.
- A11y junto: skip-link `#conteudo` + `aria-label` nos 5 botões só-ícone do
  `Layout`; `Modal` (`ui/kit.tsx`) com foco inicial, focus-trap (Tab) e
  retorno de foco a quem abriu.
