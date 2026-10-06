# Grafo fiscal — MCP de desenvolvimento (Phase 10-04, GRAFO-04)

Agentes dev consultam o **espelho KGLite** do grafo fiscal
(`scripts/grafo/schema.cypher` → `recursos-ia/grafo/grafo.kgl`).
O app Electron **nunca** importa `.kgl`: em runtime ele usa LadybugDB
(`public/base/grafo/grafo.lbug`) via `electron/ia/grafo-service.cjs`.
Schemas espelhados; o resolvedor determinístico continua sendo a única verdade
(`via:grafo` em trilha).

## Gerar / validar o espelho

```bash
# valida schema (nós + relações + PRIMARY KEY; kglite ausente não falha)
python scripts/grafo/build-grafo-kglite.py --check

# build full a partir de public/base/grafo/grafo.lbug.json + MANIFEST.grafo.json
# (sem kglite: espelho JSON portátil + audit-scorecard.json; score 1.0 no full)
python scripts/grafo/build-grafo-kglite.py --build --gate

# só describe(): describe.txt + system_prompt.txt + catalogo-rag.json
python scripts/grafo/build-grafo-kglite.py --describe

# demo rápido (7 nós / 5 arestas, p/ CI sem base)
python scripts/grafo/build-grafo-kglite.py --build --demo --gate
```

Gate de CI: `--gate [--threshold 0.85]` falha (exit 2) se `score < threshold`.
Score = média de `{pkUnicas, proveniencia100%, semOrfaos, nodos>0, arestas>0}`.

## Servir via MCP (sempre stdio local)

```bash
pip install kglite
kglite-mcp-server --graph recursos-ia/grafo/grafo.kgl
```

Exemplo de configuração MCP (Claude Code / cliente compatível) — **só stdio
local, sem endpoint remoto**:

```json
{
  "mcpServers": {
    "grafo-fiscal": {
      "command": "kglite-mcp-server",
      "args": ["--graph", "recursos-ia/grafo/grafo.kgl"]
    }
  }
}
```

Consulta de sanidade do agente: pedir `graph_overview` — deve listar os nós
fiscais (`NCM`, `CCT`, `Anexo`, `CNAE`, `NBS`) e o caminho canônico
`NCM→SH6→SH4→Cap→CCT→Anexo→Artigo` (serviços: `CNAE→NBS→CCT`).
Texto de referência offline: `recursos-ia/grafo/describe.txt`.

## Code graph do repositório (`codingest`)

```bash
codingest . -o recursos-ia/grafo/code.kgl   # grafo do código-fonte p/ agentes
```

Se a sua versão do `codingest` tiver flags diferentes, consulte
`codingest --help` — o destino deve continuar dentro de `recursos-ia/grafo/`
(artefato de curadoria, nunca empacotado no app).

## Proibições

- **MUST NOT** importar `.kgl`/`.kgl.json` no app Electron (renderer, main ou
  worker quente) — runtime fiscal é só LadybugDB + Dexie.
- **MUST NOT** vazar PII para MCP remoto: o servidor MCP do grafo roda **só
  via stdio local**; nenhuma nota XML, empresa ou CNPJ sai da máquina.
- Sem `.kgl`: o agente usa `recursos-ia/grafo/describe.txt` (sempre gerado,
  mesmo sem `pip install kglite`).
