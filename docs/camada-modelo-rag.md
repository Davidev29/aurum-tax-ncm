# Camada de compatibilidade do modelo + RAG agêntico

## 1. Trocar o modelo: simples assim (AUTOMÁTICO)

```
recursos-ia/modelo/
  <qualquer-nome>.gguf   ← coloque aqui, apague o antigo
  modelo.json            ← OPCIONAL (ajustes; copie de modelo.json.example)
```

1. Apague o `.gguf` atual, copie o novo (qualquer nome, qualquer família:
   Qwen, Llama, Mistral, Phi, Gemma…).
2. **Só aguarde** — o app vigia `recursos-ia/modelo/` (`observarModelo`,
   `electron/ia/ia-service.cjs`) e recarrega o worker SOZINHO quando o
   arquivo estabiliza (cópia grande leva minutos; a vigia espera a cópia
   terminar). Sem reiniciar, sem clicar em nada. O selo
   "troca automática ativa" no DebugIA confirma; o log mostra
   `[ia] troca de modelo detectada…`. Opt-out: `AURUM_IA_WATCH=0`.
3. (Opcional) Copie `modelo.json.example` → `modelo.json` e ajuste
   `familia` / `templateChat` / `contextSize` / parâmetros. Sem o arquivo,
   a família é detectada pelo nome e o resto usa defaults seguros.
   O status IA (`DebugIA` / `ia:status`) mostra o `perfil` efetivo:
   `{ familia, templateChat, contextSize, arquivo }`.

Regras:

- Descoberta (ordem): `modelo.json:arquivo` → env `AURUM_IA_MODEL` →
  legado `Qwen3-0.6B-Q8_0.gguf` → qualquer `*.gguf` (maior vence).
- O sistema consome o PERFIL, nunca o modelo: prompts de classificação,
  envelope de conversa (ChatML/Llama3/Mistral/Phi/Gemma/genérico), stops,
  `maxTokens`/`temperature`/`topP`/`topK`/`repeatPenalty`, `contextSize` e
  sanitização vêm de `electron/ia/perfil-modelo.cjs`.
- Sem gramática no modelo? O worker tenta com gramática e cai para geração
  livre curta + extração do 1º dígito (fail-closed: fora de 0..N = NÃO SEI).
- Empacotamento: `extraResources` leva `recursos-ia/modelo/*.gguf + *.json`
  (não mais um nome fixo); `after-pack`/`verificar-build`/scripts de teste
  aceitam qualquer `.gguf` (SHA conferido pela linha do arquivo atual em
  `CHECKSUMS.txt` — registre o hash do novo modelo).
- `CHECKSUMS.txt`: adicione a linha `<sha256>  modelo/<novo>.gguf`.

## 2. RAG expandido: o que o modelo recebe

- Registro executável: `src/application/aurum-ai-registro-ferramentas.ts`
  - `REGISTRO_FERRAMENTAS` (22 ferramentas, 7 domínios: fiscal, calculo,
    simples, dados, cadastro, legislacao, sistema).
  - `listarFerramentasParaModelo()` → specs function-calling
    (OpenAI-compatível) para entregar a qualquer modelo com suporte a tools
    ou ao loop agente futuro.
  - `ferramentasParaIntencao()` → candidatas por intenção (auditoria).
  - `executarFerramenta(nome, args, ctx)` → dispatcher (o MODELO escolhe,
    o MOTOR executa; escrita P3 devolve OFERTA, nunca grava).
- Pacote de contexto: `src/application/aurum-ai-contexto-rag.ts`
  - `montarPacoteContextoRag()` junta intenção + fichas + filtros de dados
    + memória + histórico + ferramentas candidatas em UM JSON com orçamento
    de chars derivado do `contextSize` do perfil (ficha > dados > memória).
  - `pacoteParaTexto()` serializa compacto para injeção em prompt.
- Mapa das fontes: `recursos-ia/conhecimento/catalogo-rag.json` (11 fontes:
  índice NCM, base IA, NBS, CNAE, LC214, curadoria, glossário PT-EN, XML,
  empresas, Simples, motor IBS/CBS) — validado por
  `scripts/gerar-catalogo-rag.mjs` contra o registro TS.
- Orquestrador atual (`aurum-ai-chat.ts`) inalterado por padrão: continua
  determinístico; o pacote/registro servem para auditoria, DebugIA e o
  futuro loop com tools — sem risco de regressão.

## 3. Arquivos tocados (camada)

- NOVO `electron/ia/perfil-modelo.cjs` (a camada), copiado pelo esbuild,
  `asarUnpack` e verificado no after-pack/verificar-build.
- `electron/ia/caminhos-ia.cjs`: `caminhoDirModelo`, `descobrirGgufEfetivo`,
  `perfilModeloEfetivo` (+ `caminhoModeloGguf` agora por descoberta).
- `electron/ia/ia-worker.cjs`: perfil ativo, prompts/parâmetros/stops por
  perfil, fallback sem gramática, `init` com autodescoberta, `contextSize`
  do perfil, novo comando `perfil`.
- `electron/ia/ia-service.cjs`: mensagens genéricas, `perfil` no status,
  `perfilModeloViaIa()`.
- `src/domain/ia/perfil-modelo.ts` + `perfil` em `StatusIaBridge`.
- Scripts genéricos: `testar-modelo-ia`, `testar-conversa-livre`,
  `criptografar-modelo-ia`, `after-pack-ia`, `verificar-build`.
