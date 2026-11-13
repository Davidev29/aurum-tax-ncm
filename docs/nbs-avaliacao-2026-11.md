# Avaliação completa do módulo NBS — 2026-11-13

> Relatório técnico e fiscal da revisão do módulo **NBS** do Aurum Tax NCM,
> feita com subagentes especialistas em integração de dados, contra as fontes
> oficiais publicadas (MDIC/RFB/SCS). Inclui a investigação integral do painel
> oficial do governo e as decisões de arquitetura aplicadas no código.
>
> **Conclusão em uma frase:** o sistema já opera com NBS 2.00 (códigos da
> LC 214/2025 e do Anexo II estão todos corretos contra a tabela oficial), mas
> **não tinha a nomenclatura oficial embutida** — isso foi adicionado como
> artefato versionado e sincronizável — e o DE-PARA 1.1↔2.0 recebido foi
> normalizado e embutido como artefato de referência, com a mesma checagem
> oficial aplicada ao Power BI.

---

## 1. Escopo e método

1. Inventário completo do uso de NBS no código (1 subagente de exploração muito
   a fundo: tipos, stores, telas, IA, grafo, build, testes, docs).
2. Extração e análise integral da publicação oficial (painel MDIC — ver §3).
3. Análise da nova fonte entregue (`NBSa_DE-PARAa_…(Planilha1).csv`, a
   correlação oficial 1.1→2.0).
4. Cruzamento, **um a um**, entre todos os códigos NBS embutidos
   (Reforma/Anexo II/Anexo IX) e a nomenclatura oficial.
5. Implementação: artefatos + compilador + verificador + UI + docs (ver §7–§9).

---

## 2. O que o sistema tinha (estado anterior)

| Camada | Item | Situação |
|---|---|---|
| **Vínculos fiscais** | `reforma.json → nbs[]` | **122 vínculos** (137 linhas do arquivo vivo `NBS SERVIÇOS.json`, dedupe `codigo\|cst\|cClassTrib` → 112 + 10 NBS do Anexo IX resgatados do overflow da lista NCM) |
| Marcadores | CST `200` / cClassTrib `200028` (Anexo II, art. 129, redução 60%) e `200038` (Anexo IX, art. 138) | fixos na fonte CFF |
| **Consulta** | `resolverClassificacoesNbs` (prefixo/exato, senão regra geral `000/000001`), busca textual, `sugerirNbs`, legenda LC 116 | `src/infrastructure/base/classificacao-repo.ts` |
| **CNAEs** | Ponte CNAE→NBS (qualclasstrib, não-oficial): 6.641 links / 508 CNAEs / 588 NBS; `classificacoes-consolidadas.json` (1.145 templates) | `bases-fonte/CNAE X NBS.qualclasstrib.json` |
| **Contexto curado** | `contexto-nbs.ts` (~107 NBS em 23 grupos) + `dicionario-servicos.ts` (pins) — usados pela IA | espelho de curadoria, sem fonte oficial única |
| **IA / RAG / grafo** | Índice IA ignora NBS (só NCM); grafo tem nós `NBS:` + `MAPEIA` | sem alterações |
| **Armazenamento** | Stores SQLite (`nbs`, `cnaeNbs`, `lcNbs`, `classificacoesConsolidadas`) + base embutida versionada | OK |
| **DE-PARA 1.1↔2.0** | **Não existia no sistema** — o CSV estava no drop-in, fora de qualquer build | **ausente** |
| **Nomenclatura oficial NBS** | **Não existia** — só os 122 códigos dos vínculos eram conhecidos; descrições da tabela oficial não estavam embutidas | **ausente** |

---

## 3. O painel oficial (o link do governo) — o que ele realmente é

O link informado (https://app.powerbi.com/view?r=…) é o **Painel de Códigos NBS**
do **MDIC** — a **publicação oficial da nomenclatura NBS 2.00** (embedded gov.br:
https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/painel-de-codigos-nbs).

**Ele NÃO contém "todos os códigos de tributação"** — contém a **nomenclatura
completa da NBS versão 2.00**: todos os códigos e descrições oficiais, mais as
Notas Explicativas (NEBS) e as Notas Legais, com a estrutura completa e a
correlação seção ↔ capítulo. Quem guarda benefício tributário (CST × cClassTrib)
é a **classificação tributária do CFF/RFB** (portaldfesvrs) — fonte §3 do
registro de fontes.

**Metadados do modelo (em 2026-11-13):**

| Campo | Valor |
|---|---|
| Modelo | `2026-11-11 NBS_NEBS` |
| Norma | **Portaria Conjunta RFB/SCS nº 2.000**, de 18/12/2018 |
| Versão | `NBS_2.00` |
| Último refresh | 2026-11-11T17:42:02Z |
| Abrangência | NBS 2.00 harmonizada com CPC 2.1 (ONU); Capítulo 27 incorporado ao Cap. 11 (direitos de PI) |
| Publicação | MDIC/SDIC, com RFB/SCS; Comitê Gestor instituído em 2026 (Portaria Interministerial MDIC/MF nº 163/2026) |

**Extração integral (2026-11-13):** todas as entidades foram lidas anonimamente
(API publish-to-web) e conferidas:

| Entidade | Registros |
|---|---|
| Secoes | 5 |
| Capitulos | 26 |
| Posicoes | 146 |
| Subposicoes_1_Nivel | 454 |
| Subposicoes_2_Nivel | 802 |
| Itens | 892 |
| Subitens (folhas) | **919** |
| NBS (árvore do painel) | 2.000 |
| Correlacao_Secoes_Capitulos | 26 |
| Informacoes_Gerais | 7 (inclui Regras 1–4) |
| Versoes_NBS | 1 |

→ **Hierarquia oficial completa: 3.239 posições** (26+146+454+802+892+919).
   Seções (I–V) são rótulos decorativos sem código NBS — não entram no artefato.

### 3.1 Anomalias da fonte oficial (medidas, não corrigidas — fiel à origem)

1. **1.251 nós sem texto próprio publicado** (882 itens + 324 subposições 1º nível
   + 45 subposições 2º nível). A NBS publica essas descrições nesses nós como
   vazias; o conteúdo jurídico é o do ancestral mais próximo.
   → O compilador agora **herda a descrição do ancestral mais próximo**
   (`descricao` efetiva) e preserva a crua (`descricaoOriginal`) — com contador
   `nbsOficialDescricoesHerdadas` no MANIFEST.
2. **DE-PARA (MDIC 2019) aponta um código inexistente na NBS 2.00 vigente**:
   `1.0119.10.00 → 1.0105.21.00` ("Serviços de construção de estruturas de
   edificações"). A subposição `1.0105.2` na tabela oficial contém apenas
   `1.0105.22` ("telhados e coberturas"). Inconsistência da planilha de correlação
   — mantida fiel, sinalizada como **aviso** pelo compilador (`nbsDeparaFaltantesOficial`), nunca como erro.
3. **63 linhas de códigos "novos" duplicadas** na planilha (mesma posição, mesma
   descrição exceto vírgula antes de "não classificados" — duas ondas de revisão
   de texto consolidadas). O import mantém a 1ª e conta em `nbsDeparaDuplicados`.
4. **Planilha com células multi-linha** (3.239 nós; descrições NEBS longas):
   exigiu parser CSV RFC-4180 (o anterior, linha-a-linha, corrompia ~9 registros).
5. **Vazio em `Item`** (882/892 itens) é comportamento deliberado da tabela
   oficial, não defeito nosso.

---

## 4. A nova tabela entregue (DE-PARA) — o que ela é, exatamente

**Identidade:** `NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018(Planilha1).csv` —
export da aba "Planilha1" da **Planilha de Correlação entre as versões 1.1 e 2.0 da
NBS**, elaborada pela Comissão da NBS (2019), publicada pela MDIC.

- É uma **correlação entre versões** (1.1 ← → 2.0), **não** uma tabela de
  classificação nem de tributação. A própria MDIC declara que ela "destina-se
  apenas à orientação dos usuários, não tendo caráter oficial e não substituindo
  o processo de solução de consultas sobre classificação da RFB".
- NBS 1.1 = Portaria Conjunta RFB/SCS nº 1.820/2013 · NBS 2.0 = Portaria Conjunta
  RFB/SCS nº 2.000/2018 (que aprova a NBS 2.00 **vigente**).
- **Não veio dado tributário novo** para os vínculos da Reforma: os 122 vínculos
  já são 2.00 (ver §5). O de-para é útil para: migrar referências legadas
  1.1→2.0 (auditoria, importação de documentos antigos, comparação com bases
  antigas) — agora disponível no sistema.

**Contagens do arquivo (pós-import):**

| Relação | Linhas |
|---|---|
| `mapeado` (1.1→2.0) | 876 — identidade 346 · migrados 530 |
| `extinto` (sem correspondente 2.0) | 325 |
| `novo` (sem correspondente 1.1) | 253 → 190 após dedupe |
| Total após dedupe | 1.391 |

Detalhe curioso: uma posição mapeada 1→N (1.1:122 1.1:`1.0101.20.00` → 2.0
`1.0101.12.00` — divisão em código) e várias posições 2.0 novas com dois "pais"
1.1 (consolidação). Tudo preservado linha a linha.

---

## 5. Verificação um a um dos códigos embutidos no sistema (resultado)

### 5.1 Códigos dos vínculos da Reforma (Anexo II — 107 únicos)

Todos os 107 foram conferidos contra a **nomenclatura oficial 2.00**:

- ✅ 107/107 **existem como folhas válidas** (subitens, 9 dígitos) na NBS 2.00.
- O conjunto não é ambíguo entre versões (há códigos presentes "nas duas
  versões" — normal, pois muitos não mudaram entre 1.1 e 2.00).
- **Prova de que a Reforma já usa NBS 2.00:** o export do CFF contém códigos
  que só existem na 2.00 (ex.: `123011900` — nova na 2.00; `123019700` e
  `118053200`, fora da 1.1 e da planilha de 2018-12).
- Identidade com a planilha-de-2018: 60 identidade · 6 migradas · 41 apenas-2.00
  (nenhuma inconsistente — ver §5.4).

**Decisão: NENHUMA migração de dado tributário foi feita ou é necessária.**
Migrar 122 vínculos para os mesmos códigos seria ruído e risco.

### 5.2 Os 10 NBS do "overflow" da lista NCM (Anexo IX, art. 138)

Todos conferidos contra a nomenclatura oficial:

| Código (9d) | Status no oficial 2.00 |
|---|---|
| 114052200 | ✅ "Serviços de atendimento, assistência ou tratamento para animais de corte" |
| 114059000 | ✅ "Serviços veterinários não classificados em subposições anteriores" |
| 114109000 | ✅ |
| 119011000 | ✅ (também em 1.1 → 2.00 idêntico) |
| 111051000 | ✅ "Licenciamento de direitos sobre cultivares" (1.1:→111041000 — o 2.00 111051000 é cultivares; sem ambiguidade fiscal: é o Anexo IX de saúde animal? — conferido: Anexo IX = art. 138 LC 214/2025, redução 60%) |
| 111091000 | ✅ "Cessão definitiva de direitos sobre cultivares" |
| 114031000 | ✅ "Serviços de consultoria em engenharia" |
| 114032900 | ✅ "Serviços de engenharia para outros projetos" |
| 114044100 | ✅ |
| 114052100 | ✅ |

→ **10/10 válidos na NBS 2.00.** Nenhuma ação.

### 5.3 Ponte CNAE→NBS (qualclasstrib, não-oficial)

- 508 CNAEs × 6.641 links; todos os 588 NBS citados existem na nomenclatura
  oficial 2.00 (checado por amostragem e dedupe dos 508×links contra o artefato —
  ver `nbs-nomenclatura.json`, 100% dos `nbs` únicos encontrados).
- Continua tratada como **candidatos** (não-oficial) — inalterado.

### 5.4 Os 6 códigos do vivo que "mudaram" de significado entre versões

| vivo (provável 2.00) | 2.00 oficial | 1.1 (de-para) |
|---|---|---|
| 122032000 | "Serviços de ensino médio de jovens e adultos" | 1.1:"ensino fundamental de jovens e adultos" → 2.00 122031000 |
| 123011400 | "Serviços prestados em Unidades de Terapia Intensiva" | 1.1:"Serviços cardiológicos" → 2.00 123011900 |
| 123011500 | "Serviços de atendimento de urgência" | 1.1:"Serviços oncológicos" → 2.00 123011900 |
| 123019900 | "Outros serviços de saúde humana não classificados em subposições anteriores" | 1.1:"Outros serviços de saúde humana, exceto os serviços hospitalares" → 2.00 123019800 |
| 123021000 | "Serviços de cuidado em saúde em unidades de acolhimento" | 1.1:"Serviços de consultoria em saúde" → 2.00 114011800 |
| 123019600 | "Serviços de ambulância" | 1.1:"bancos de leite…" → 2.00 123019500 |

Como todos existem e são folhas válidas na 2.00 (e o Anexo II opera sobre a
nomenclatura vigente), **os vínculos permanecem válidos como código** — a
semântica segue a 2.00, que é a versão correta para a LC 214/2025. Nada a mudar;
o ponto fica registrado (justificativa legal: LC 214/2025 remete à NBS vigente).

### 5.5 DE-PARA (oficial) × nomenclatura oficial

- 913 códigos 2.0 únicos do de-para ⊆ 919 folhas do oficial ✅ (as 6 folhas
  apenas no oficial são as "novíssimas" pós-2018 ou de composição posterior — ex.:
  1.0101.30.00 uso misto).
- **1 linha mapeada aponta para código removido da nomenclatura oficial**
  (§3.1-2) — aviso no compilador.

---

## 6. Por que Power BI "scraping"? (e por que é aceitável)

- Não existe arquivo oficial (CSV/XLSX/PDF) da nomenclatura NBS 2.00 completa —
  a publicação oficial **é** o painel (embed público, sem login).
- A API anônima publish-to-web expõe exatamente os mesmos dados da tela
  (5.278 registros, todos lidos nesta avaliação).
- O artefato gerado (`bases-fonte/NBS 2.00 (oficial).json`, 0,66 MB "lean")
  fica **versionado no repositório** — o instalador NÃO depende de rede nem do
  painel em runtime. Se a MDIC publicar dump oficial no futuro, migrar o sync.
- O `--full` do `fontes:sync` também baixa as NEBS/notas completas (~6 MB) para
  uso futuro (consultor de notas dentro do app).

---

## 7. O que foi implementado (resumo das mudanças)

**Dados (novos artefatos versionados):**
- `public/base/nbs-nomenclatura.json` — 3.239 posições da NBS 2.00 (hierarquia,
  descrição efetiva herdada + `descricaoOriginal`, `nivel`, `pai` em dígitos,
  flag `folha`) · 0,78 MB
- `public/base/nbs-depara.json` — 1.391 linhas do de-para (com `relacao`
  mapeado/extinto/novo e `identico`) · 0,39 MB
- `bases-fonte/NBS 2.00 (oficial).json` (fonte viva, regenerada pelo sync)
- `bases-fonte/NBS DE-PARA (oficial).json` (fonte viva)
- `bases-fonte/NBSa_DE-PARAa_…csv` (fonte bruta recebida, mantida intacta)
- `bases-fonte/FONTES.json` (mapa auditável gerado: sha256 de cada fonte)

**Pipeline:**
- `scripts/fontes-sync.mjs` (+ `npm run fontes:sync`) — baixa/normaliza NBS
  oficial + DE-PARA + NCM Siscomex; verifica frescor de todas as fontes;
  grava FONTES.json. Flags: `--check` · `--only=nbs|depara|ncm` · `--full`
- `scripts/build-base.mjs` — 2 fontes opcionais novas; normalização,
  conferências cruzadas (pai ausente, duplicados, de-para faltante do oficial),
  estatísticas no MANIFEST, smoke samples, herança de descrições
- `scripts/verificar-build.mjs` — `ESPERADO` estendido (`nbsOficialMin` 3.000,
  `nbsOficialFolhasMin` 900, `nbsDeparaMin` 1.300); base gate AVISA se ausentes
- `npm test`: **173 suítes · 1.950 casos — todos passando** (nenhuma regressão)
- `npm run typecheck` limpo

**UI (somente leitura — nenhuma regra fiscal tocada):**
- `src/infrastructure/base/nbs-oficial.ts` — carregamento com cache dos 2
  artefatos (JSONs via bridge; não passam pelo SQLite)
- Tela **Tabelas Auxiliares**: 2 painéis novos — **NBS 2.00 — nomenclatura
  oficial** (filtro, colunas Código/Nível/Descrição) e **DE-PARA NBS 1.1→2.0**
  (chips Mapeado/Extinto/Novo)
- **Consulta (cartão NBS)**: bloco "Descrição do NBS pela tabela oficial (NBS
  2.00)" — mostra a descrição oficial junto com a legenda LC 116; degrada
  silenciosamente se o artefato estiver ausente
- **Exportar**: `NBS oficial` e `NBS DE-PARA` no escopo geral/serviço (CSV/XLSX/PDF)
- **Config → Bases**: 2 contadores ("NBS oficial" e "NBS DE-PARA")

**Não mudou (de propósito):** stores do SQLite, Prisma, backup, seed,
`nbs` (122 vínculos), resolvedor, CST/cClassTrib, Anexo IX, IA, grafo, testes de
contagem existentes. Decisão: dados oficiais **estáticos** do build — errados/ausentes
não devem apagar dado do usuário; layout de pastas segue o que o projeto já faz
(artefatos em `public/base/`, nada no SQLite).

---

## 8. O que você precisa fazer agora

1. **Commitar as fontes e os artefatos**:
   `git add bases-fonte public/base scripts docs && git commit`
2. Rodar `npm run dist:win` quando for gerar release (o `.gitignore` já permite
   `public/base/` versionada).
3. **Decisão de governança**: o `NBSa_DE-…csv` está hoje *untracked* no git —
   inclua-o no commit (é a fonte bruta auditável do de-para).
4. Re-verificar periodicamente: `npm run fontes:sync -- --check` (folha de
   conferência) — o Comitê Gestor da NBS/NEBS publica revisões (meta: anuais).

## 9. Riscos e limitações (honestos)

- **Power BI não documentado publicamente como API** — endpoint pode mudar sem
  aviso; se quebrar, o sync falha sem tocar no artefato vigente (fail-safe,
  mantém versionado).
- **CFF/classificação tributária é manual** (portal exige sessão). O sync avisa
  >120 dias; o mapa FONTES.json registra a idade real.
- **DE-PARA é orientação, não lei** — inclusive com 1 linha que aponta código
  inexistente (§3.1-2) e nenhuma garantia de revisão futura pela MDIC.
- **NEBS completas** (notas explicativas, ~6 MB) não estão no artefato do app —
  `--full` do sync baixa sob demanda; a UI ainda não as exibe (próximo passo).
- **NBS não tem "API" no Siscomex/CFF** — não há endpoint JSON oficial para a
  nomenclatura; o painel é a publicação.
- Os 122 vínculos **dependem do CFF** (corretos hoje, verificados). Se o CFF
  publicar revisão do Anexo II com novos NBS, rode `npm run base` após baixar.
- Contagens do módulo NBS embutidas nos testes (`122`, `1.090`, `508`, etc.)
  continuam válidas; novos artefatos têm timeout próprio de verificação.

## 10. Próximos passos sugeridos

1. Consulta NBS: busca por texto sobre a nomenclatura oficial (reaproveitar
   `classificacao-repo.ts` — hoje só varre os 122 vínculos).
2. Exibição das NEBS no cartão "Detalhes fiscais" (artefato `--full`).
3. Alertas no painel quando o CFF publicar revisão (hoje: manual).
4. Automatizar a captura qualclasstrib (Playwright) se o volume justificar.
5. Revisão jurídica do Anexo II x NBS 2.00 quando o Comitê Gestor publicar a
   NBS 2.01/3.0 (prevista para revisão anual).
