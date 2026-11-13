# Fontes oficiais — NBS, NCM e Classificação Tributária (registro e SOP)

> Mapa oficial de **onde** buscar cada fonte de dados do módulo fiscal, com
> cadência, licença, forma de atualização e o comando para cada uma.
> Atualizado em **2026-11-13**.
>
> Convenção:
> - **`npm run fontes:sync`** = automático (baixa/normaliza e registra em `bases-fonte/FONTES.json`)
> - **manual** = exige navegador (o portal não oferece download programático público)
> - `public/base/` é versionada no git — depois de rodar `npm run base`, commite os artefatos.

## Resumo executivo (o que é automático e o que não é)

| Fonte | Onde fica | Automático? | Comando |
|---|---|---|---|
| **NBS 2.00 oficial** (nomenclatura completa) | `bases-fonte/NBS 2.00 (oficial).json` → compilada em `public/base/nbs-nomenclatura.json` | ✅ `npm run fontes:sync -- --only=nbs` | lê o painel oficial MDIC (Power BI, anônimo) |
| **DE-PARA NBS 1.1 ↔ 2.0** | `bases-fonte/NBS DE-PARA (oficial).json` → compilada em `public/base/nbs-depara.json` | ✅ `npm run fontes:sync -- --only=depara` | normaliza o CSV oficial (fonte bruta no repo) |
| **NCM (nomenclatura vigente)** | `bases-fonte/Tabela_NCM_Vigente_AAAAMMDD.json` | ✅ `npm run fontes:sync -- --only=ncm` | Portal Único Siscomex (JSON público) |
| **Classificação tributária (CST × cClassTrib)** | `bases-fonte/classificacao_tributaria.json` | ❌ manual | Portal CFF (SVRS) — exige navegador |
| **Reforma por NCM/NBS (LC 214/2025)** | `bases-fonte/reforma_tributaria_por_ncm.json` | ❌ manual | Portal CFF (SVRS) — export "Reforma Tributária consulta por NCM" |
| **NBS — vínculos da Reforma (Anexo II)** | `bases-fonte/NBS SERVIÇOS.json` | ❌ manual | Portal CFF (SVRS) — Anexo II LC 214/2025 |
| **Cooldown/conferência (FONTES.json)** | `bases-fonte/FONTES.json` | ✅ gerado em toda sync | mapa auditável (sha256, frescor, licença) |

---

## 1. NBS 2.00 — publicação oficial (a fonte mais importante do módulo)

**O que é:** a versão vigente da NBS (Nomenclatura Brasileira de Serviços, Intangíveis e Outras Operações que Produzam Variações no Patrimônio), versão 2.00, aprovada pela **Portaria Conjunta RFB/SCS nº 2.000, de 18/12/2018** (substituiu os Anexos I e II da Portaria Conjunta nº 1.429/2018), com lastro na **Lei nº 12.546/2011** e no **Decreto nº 7.708/2012**. NBS e NEBS são elaboradas e revisadas pela RFB (tributação) em conjunto com a SCS/MDIC (comércio e serviços), IBGE e BACEN.

**Publicação oficial:** MDIC (Ministério do Desenvolvimento, Indústria, Comércio e Serviços) — **Painel de Códigos NBS** (Power BI embutido na página):

- Página oficial (gov.br): https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/painel-de-codigos-nbs
- O Power BI por trás: https://app.powerbi.com/view?r=eyJrIjoiOWU5YTk1Y2ItYTVjNC00NDY4LWExYmYtZjIwNjcxYTFmNjYwIiwidCI6IjQ1NjIxM2NmLTcwNzMtNDdjNi1iZjQ5LTQxYjY1NGFkNDQ5YiJ9
- Modelo (em 2026-11-13): `"2026-11-11 NBS_NEBS"` · Norma: Portaria Conjunta RFB/SCS nº 2.000 · Versão: `NBS_2.00` · Último refresh: **2026-11-11T17:42Z**

**Conteúdo (extraído integralmente em 2026-11-13 — 5.278 linhas):**

| Entidade (tabela) | Registros | Papel |
|---|---|---|
| Secoes | 5 | Seções I–V |
| Capitulos | 26 | Capítulos 01–26 |
| Posicoes | 146 | Posições |
| Subposicoes_1_Nivel | 454 | Subposições de 1º nível |
| Subposicoes_2_Nivel | 802 | Subposições de 2º nível |
| Itens | 892 | Itens |
| Subitens | 919 | Subitens (folhas) |
| NBS (navegação) | 2.000 | Árvore do painel (subconjunto de navegação) |
| Correlacao_Secoes_Capitulos | 26 | Correlação seção ↔ capítulo |
| Informacoes_Gerais | 7 | Abrangência, formação do código, Regras 1–4 |
| Versoes_NBS | 1 | `NBS_2.00` — Portaria 2.000/2018 |

**Total na hierarquia oficial (o artefato do app): 3.239 posições (919 subitens).**

**Por que scraping do Power BI e não um arquivo?** A MDIC publica a NBS 2.00 **somente** como painel interativo (não há CSV/PDF/Excel oficial para a nomenclatura completa — o `.xlsx` oficial existe só para a *correlação* 1.1↔2.0; ver §2). O painel é a publicação oficial e é acessível anonimamente; o `fontes:sync` lê exatamente o mesmo dado que a página mostra (leitura somente). Se a MDIC passar a oferecer export oficial, migre o sync para ele.

**Por que NÃO é o "códigos de tributação":** o painel contém a **nomenclatura** (códigos + descrições + NEBS — Notas Explicativas). Os vínculos tributários (NBS × CST × cClassTrib com benefício da Reforma) vêm da **classificação tributária da RFB** (CFF, ver §3/§4), não do painel.

**Cadência esperada:** a NBS muda por revisão — em 2026 foi instituído o **Comitê Gestor da NBS e das NEBS** (Portaria Interministerial MDIC/MF nº 163, de 22/01/2026), com incorporações "idealmente anuais". Acompanhar:

- Painel de Códigos NBS (atualiza junto: última atualização vista: 11/11/2026)
- Página "Propostas de Alteração": https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/Propostas-de-alteracao
- Normativo: https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/normativo

---

## 2. DE-PARA NBS 1.1 ↔ 2.0 — correlação entre versões

**O que é:** a correlação oficial entre a NBS 1.1 (Portaria Conjunta RFB/SCS nº 1.820, de 17/12/2013) e a NBS 2.00 (Portaria Conjunta RFB/SCS nº 2.000, de 18/12/2018), elaborada pela Comissão da NBS (2019). **Não é uma tabela de classificação** e não tem caráter oficial de enquadramento — é um guia de migração para quem tem referências na NBS 1.1.

**Publicação oficial:** MDIC — **Correlações**:

- Página: https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/correlacoes (publicada 17/04/2026; atualizada 09/11/2026)
- Arquivo oficial: `NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018.xlsx` (link na página)
- **Fonte bruta no projeto:** `bases-fonte/NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018(Planilha1).csv` (export Latin-1 da aba "Planilha1", separador `;`)

**Conteúdo (1.454 linhas → 1.391 após remoção de 63 duplicatas exatas da fonte):**

| Relação | Linhas |
|---|---|
| Mapeadas (1.1 → 2.0) | 876 (346 identidade + 530 migradas) |
| Extintas (sem correspondente 2.0) | 325 |
| Novas (sem correspondente 1.1) | 253 (190 após dedupe) |

**Armadilhas conhecidas (medidas em 2026-11):**

1. Uma linha aponta **código inexistente** na nomenclatura oficial: `1.0119.10.00 → 1.0105.21.00` ("Serviços de construção de estruturas de edificações"). A subposição `1.0105.2` na NBS 2.00 oficial só contém `1.0105.22`. Inconsistência da planilha — mantida fiel, sinalizada pelo compilador como aviso.
2. 63 linhas de códigos **"novos"** aparecem duas vezes com a descrição idêntica exceto por uma vírgula antes de "não classificados" (duas ondas de revisão de texto consolidadas na mesma planilha). O compilador mantém a primeira e reporta em `nbsDeparaDuplicados`.
3. Células multi-linha (descrições com quebra de linha literal) — o parser do `fontes:sync` é RFC-4180-completo; versões antigas desse arquivo quebrariam em 9 registros.

**Como atualizar:** a página "Correlações" é o endereço canônico. Se a MDIC publicar nova correlação: baixe o `.xlsx`, exporte a aba principal como CSV Latin-1 (`;`, aspas RFC-4180), salve sobre o nome acima e rode `npm run fontes:sync -- --only=depara`.

---

## 3. Classificação tributária — CST × cClassTrib (RFB/Conformidade Fácil)

**O que é:** a referência oficial da Reforma (LC 214/2025): CST × cClassTrib, com redução de alíquotas, créditos presumidos, anexos da LC 214/2025 e habilitação de documentos fiscais. É a espinha dos vínculos NCM/NBS × benefício.

**Publicação oficial:** Portal **Conformidade Fácil** (SVRS/RFB):

- Portal: https://dfe-portal.svrs.rs.gov.br/Cff → "Classificação Tributária"
- API (referência; o portal bloqueia acesso programático anônimo — 403): `https://cff.svrs.rs.gov.br/api/v1/consultas/classTrib`
- **No projeto:** `bases-fonte/classificacao_tributaria.json` (164 registros) — atualização **manual** pelo portal (baixar/exportar JSON). O `fontes:sync` avisa quando >120 dias.
- Data de atualização vista no conteúdo: `19/05/2025`.

**Vínculos da Reforma (NCM/NBS × benefício):**

- Portal: mesmo Cff → export **"Reforma Tributária consulta por NCM"** (`.xlsx`) → `bases-fonte/reforma_tributaria_por_ncm.json` (2.345 itens, dos quais 2.335 NCM de 8 dígitos + 10 NBS de 9 dígitos "vazando" na lista NCM — o compilador resgata estes últimos no Anexo IX).
- **Vínculos NBS da Reforma (Anexo II, art. 129, redução 60%):** `bases-fonte/NBS SERVIÇOS.json` (137 linhas → 122 vínculos após dedupe) — extraído do mesmo portal. **Códigos já são NBS 2.00** (verificado um a um contra o painel OFICIAL 2.00 — ver `docs/nbs-avaliacao-2026-11.md`).

**Cadência:** acompanhar atualizações da Reforma (até 2026: revisões frequentes). Quando atualizar: baixar os dois arquivos e rodar `npm run base`.

---

## 4. Nomenclatura NCM — Portal Único Siscomex

**O que é:** a Nomenclatura Comum do Mercosul com data de vigência (Resoluções Gecex), incluindo ato de extinção de códigos.

**Publicação oficial (download JSON público, sem login):**

- Endpoint: https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
- **No projeto:** `bases-fonte/Tabela_NCM_Vigente_AAAAMMDD.json` (≈3 MB, ~15.156 itens)
- **Automático:** `npm run fontes:sync -- --only=ncm` — baixa o JSON, grava com a data de hoje e move a versão anterior para `bases-fonte/.historico/` (nada é apagado; o compilador usa o primeiro `Tabela_NCM_Vigente_*.json` encontrado).

---

## 5. Fontes não-oficiais / arquivos vivos do projeto

| Arquivo | Origem | Status |
|---|---|---|
| `CNAE X ANEXO.json` | Arquivo vivo do projeto (sem URL oficial única) — CNAE × Anexo Simples + Fator R | manter no projeto |
| `CNAE X NBS.qualclasstrib.json` | **qualclasstrib.com.br** (captura manual de 2026-10-05; 508 CNAEs × 6.641 links) | **não-oficial** — links são candidatos; verdade fiscal só do resolvedor oficial (CFF/LC 214/2025) |
| `NBS SERVIÇOS.json` | Derivado do CFF (Anexo II LC 214/2025), mantido como arquivo vivo | oficial, mas o CFF é manual |
| `cest.json`, `cfop.json`, `cnae.json`, `mei_cnaes.json` | Arquivos vivos/legados do projeto | CFOP é vivo (módulo XML); `cnae.json` e `mei_cnaes.json` soltos são ignorados pela compilação |

Atualização da ponte qualclasstrib: re-captura manual sob demanda (quando o Simples ou a NBS mudarem). Documentar no commit a data de captura.

---

## 6. Governança / próximos passos oficiais

- **Normativo:** Leis 12.546/2011, Decreto 7.708/2012, Portaria Conjunta 1.820/2013 (NBS 1.1), Portaria Conjunta 1.429/2018 e **2.000/2018 (NBS 2.00 vigente)**, Portaria ME 413/2019, **Portaria Interministerial MDIC/MF nº 163, de 22/01/2026 (Comitê Gestor da NBS e das NEBS)** — ver https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/normativo
- **Quem atualiza a NBS/NEBS agora:** o Comitê Gestor (propostas via plataforma gov.br — "Propor alterações na NBS/NEBS"). Incorporações previstas para serem anuais.
- **LC 214/2025** (esp. Anexo II com NBS e classificação tributária): acompanhar o CFF e eventuais Anexos/alteradoras da LC (site do Planalto + atos da RFB).
- **Revisão do Simples Nacional (CNAEs)**: anualmente.

## 7. SOP — atualização completa em 1 comando

```powershell
# 1) refrescar tudo que é automático + verificar frescor do resto
npm run fontes:sync

# 2) recompilar a base embutida (public/base/)
npm run base          # iteração
npm run base:completa # antes de qualquer release

# 3) conferência
npm run verificar:pre

# 4) commitar (bases-fonte/ + public/base/ + MANIFEST.json)
git add bases-fonte public/base
```

O mapa auditável (`bases-fonte/FONTES.json`) registra o que foi atualizado, quando e com que hash — use-o no code review de UPDATE DE BASE.
