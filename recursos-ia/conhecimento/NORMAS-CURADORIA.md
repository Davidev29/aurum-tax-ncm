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

## 6. Loop de aprendizado

`logs/consultas-ia.jsonl` (NÃO SEI + feedback "Não é esse") → triagem
humana semanal → `sinonimos/dicionario/frases-modelo` → rebuild do índice
(`gerar-indice-ia.mjs`) → regressão (`testar-indice-ia.mjs`).
