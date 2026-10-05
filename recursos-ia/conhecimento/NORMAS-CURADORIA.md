# NORMAS DE CURADORIA — Base de Conhecimento Aurum AI

> Princípio inviolável: **nada aqui altera a base tributária oficial**.
> `public/base/*`, `db.ncm/cst/cstClassTrib/referencia/ncmNomenclatura` e os
> campos tributários de `ncm-para-ia.json` (`cst, cClassTrib, pRed, baseLegal`)
> são **nível Deus — somente leitura**. O conhecimento só ADICIONA expansões
> de consulta e pins de candidatos; o **resolvedor valida tudo**.

## 1. Sinônimos (`sinonimos.json`)

- Chave e valor já normalizados (minúsculas, sem acento — ver `normalizarBusca`).
- O valor deve existir LITERALMENTE no texto oficial (ou ser radical comum
  às flexões: `bovin` casa com bovino/bovina/bovinos via substring).
- A expansão só ADICIONA consultas — nunca vira NCM direto.

## 2. Dicionário (`dicionario.json`)

- `ncm`: 8 dígitos vigentes na TEC (`Tabela_NCM_Vigente_20260922.json`).
- Nunca genérico ("Outros") por preguiça — o pin deve ser o enquadramento
  padrão do produto.
- `termos`: já normalizados. Termo de 1 palavra só quando INEQUÍVOCO
  sozinho (`parmesao` ✓, `prato` ✗, `minas` ✗, `nike` ✗).
  Ambíguo só em frase (`queijo prato`, `tenis nike`).
- Match: frase por substring; palavra única por token inteiro.
- Em conflito vence o termo MAIS LONGO.

## 3. Marcas/siglas (`marcas-siglas.json`)

- Sempre para hiperônimo oficial, nunca para NCM direto.
- Marca multi-categoria (`nike`, `lg`) só em frase, nunca sozinha.

## 4. Erros comuns (`erros-comuns.json`)

- Só correção ortográfica (typo → forma correta).
- Minerado de `logs/consultas-ia.jsonl` + `ia_feedback` negativo.

## 5. Frases-modelo (`frases-modelo.json`)

- Cada frase precisa de `ncm` validado por `resolverClassificacoes`.
- Vira caso de regressão em `testar-indice-ia.mjs`.

## 7. Fine-tuning de serviços/NBS (`servicos-nbs.json` + `frases-modelo-servicos.json`)

- `servicos-nbs.json` (versão `finetuning-servicos-v1`): guia de raciocínio por
  setor — sinais, perguntas de refino, anexos LC 214, condições de risco e o
  chain-of-thought em 7 etapas. Espelho curado de `vocabulario-servicos.ts`,
  `classificador-descricao-servicos.ts` e `preditivo-servicos.ts`.
- `frases-modelo-servicos.json` (≥40 frases): dia a dia → hipótese NBS/cct,
  com tipos `preditiva`, `regra_geral`, `sem-lastro`, `insuficiente` e
  `fora-de-escopo`. Adicionar só após validação humana + resolvedor.
- Predição informativa (`preditivo-servicos.ts`): top-3 por nomes/sinônimos
  (título ×2 + descrição ×1 + bônus benefício, cobertura mínima 0,25). Cada
  sugestão tem `apenasInformativo: true` + aviso fixo — a UI exibe o selo
  "apenas informativa, NÃO é decisão final" e o botão "Classificar oficialmente".
- Validar com `node scripts/validar-conhecimento.mjs` (etapas 5–6) e
  `npx vitest run tests/servicos-cobertura.test.ts tests/servicos-preditivo.test.ts tests/servicos-finetuning.test.ts`.

## 8. Dicionário de serviços + mapeamento de padrões (v3)

- `src/domain/constants/dicionario-servicos.ts`: pins nome popular → NBS
  exato (9 dígitos COM benefício na base viva). SÓ setores com benefício
  (educação/saúde/cultura/segurança/ciber) — fora de benefício nunca ganha
  pin (o honesto é regra geral + orientação setorial). Termo único só quando
  inequívoco (`dentista` ✓, `consulta` ✗); ambíguo só em frase
  (`festa de casamento`, `formacao de condutores`). Cada pin passa pelo
  resolvedor; sem vínculo na base atual, morre sem virar resposta.
- `recursos-ia/conhecimento/mapeamento-padroes-servicos.json`: pesquisa
  oficial × popular (tokens distintivos por grupo, falsos amigos substring
  corrigidos, setores sem benefício listados como gaps honestos).
- Anti-falso-benefício: `TOKENS_JURIDIQUES_NBS` (juridiquês boilerplate) é
  filtrado no RAG (`buscarNbsPorTexto`), no preditivo e no seletor local;
  expansões →juridiquês são descartadas. Valores matcháveis
  (educacao/saude/espetaculo/...) SÓ para termos genuinamente do setor.

## 9. Contexto personalizado por NBS (`contexto-nbs.json` + `contexto-nbs.ts`)

- `scripts/gerar-contexto-nbs.py`: lê a base viva (107 NBS) e combina os
  vínculos reais por código (ccts, documentos) com a curadoria dos 5 grupos
  (resumo fiel ao oficial + LC 214, quando se aplica / NÃO se aplica,
  condições, consultas típicas, termos populares, refino, CNAEs). Regenerar
  (`python3 scripts/gerar-contexto-nbs.py`) após atualizar a base NBS;
  `--conferir` só valida.
- `recursos-ia/conhecimento/contexto-nbs.json`: 23 grupos (5 com NBS + PROF-30 + 17 benefícios de serviço sem NBS: transporte/ZPE, pesquisa ICT, FGTS, financeiro-importador, cooperativas, transporte público, ProUni, locações ×3, ambiental, comunicação pública, esporte, imóveis, hotelaria, turismo, diferimento insumos) + 107 itens
  (cluster estrutural, flag representante, nota dual nos 5 XI).
- `src/domain/constants/contexto-nbs.ts`: espelho com `obterContextoNbs()`.
  A descrição preditiva carrega o contexto: `SugestaoPreditivaServico.contexto`,
  `SugestaoNbsJson.contextoNbs`, camada `origem: 'contexto-personalizado'`
  no preditivo e `BlocoContextoNbs` na UI (sugestão, preditivas, CNAE).

## 6. Loop de aprendizado

`logs/consultas-ia.jsonl` (NÃO SEI + feedback "Não é esse") → triagem
humana semanal → `sinonimos/dicionario/frases-modelo` → rebuild do índice
(`gerar-indice-ia.mjs`) → regressão (`testar-indice-ia.mjs`).

## 10. Corpus LC 214/2025 (`lc214-artigos.json` + `src/domain/services/lc214.ts`)

- Fonte canonica do bundle: `src/domain/services/lc214.ts` (100% offline, sem rede). O JSON e o TS DEVEM ser atualizados juntos.
- Cada verbete: numero, titulo, tema, aliases de busca, resumo curado (nunca redacao literal inventada), claro (linguagem simples), tecnico (aliquota/CST/cClassTrib/anexo/condicoes), quando_aplica, exemplo, link com ancora `#artNNN`.
- Redacao literal vigente: sempre a integra no Planalto (`LINK_LC214`). A IA cita o link em toda resposta e avisa que o texto e resumo curado.
- Cobertura atual: 33 artigos-guia (conceitos base, creditos, reducoes, diferimento, regimes especificos, administracao, transicao). Artigo fora da cobertura: resposta honesta + link da integra, nunca chute.
