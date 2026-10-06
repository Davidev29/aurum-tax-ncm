"""Phase 10-04 — espelho KGLite do schema fiscal (tooling Python, nunca runtime Electron).

Uso:
  python scripts/grafo/build-grafo-kglite.py --check
      # valida schema.cypher (nós + relações + PRIMARY KEY) e reporta kglite.
  python scripts/grafo/build-grafo-kglite.py --build [--demo] [--gate] [--threshold 0.85]
      # lê public/base/grafo/grafo.lbug.json + MANIFEST.grafo.json, constrói o
      # espelho via kglite quando disponível (senão mirror JSON), grava
      # audit-scorecard.json, exporta describe() e atualiza o catálogo RAG.
  python scripts/grafo/build-grafo-kglite.py --describe
      # só o passo describe(): describe.txt + system_prompt.txt + catálogo.
  python scripts/grafo/build-grafo-kglite.py --gate [--threshold 0.85]
      # avalia o scorecard existente (fail-closed p/ CI).

Artefatos (curadoria/CI — o app Electron usa LadybugDB `.lbug`, nunca `.kgl`):
  recursos-ia/grafo/grafo.kgl            # nativo kglite (só quando o pacote existe)
  recursos-ia/grafo/grafo.kgl.json       # espelho portátil (fallback sem kglite)
  recursos-ia/grafo/audit-scorecard.json # {nodos, arestas, semOrfaos, ...}
  recursos-ia/grafo/describe.txt         # schema textual p/ agentes dev

Proibições (10-PLAN §10-04): MUST NOT importar `.kgl` no app Electron;
MUST NOT vazar PII p/ MCP remoto (só stdio local).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "scripts" / "grafo" / "schema.cypher"
LBUG_JSON = ROOT / "public" / "base" / "grafo" / "grafo.lbug.json"
MANIFEST_GRAFO = ROOT / "public" / "base" / "grafo" / "MANIFEST.grafo.json"
GRAFO_DIR = ROOT / "recursos-ia" / "grafo"
OUT_KGL = GRAFO_DIR / "grafo.kgl"
OUT_JSON = GRAFO_DIR / "grafo.kgl.json"
SCORECARD = GRAFO_DIR / "audit-scorecard.json"
DESCRIBE_TXT = GRAFO_DIR / "describe.txt"
CATALOGO = ROOT / "recursos-ia" / "conhecimento" / "catalogo-rag.json"

GRAFO_VERSAO = "grafo-v1"
THRESHOLD_PADRAO = 0.85
# Mesmas origens de scripts/build-grafo.mjs (fail-closed: fora disso é rejeitado).
ORIGENS = ("por_codigo", "triangulado", "heranca", "curadoria", "uso_local")
# Tokens exigidos pelo --check (GRAFO-04: mesmo schema do LadybugDB).
TOKENS_NOS = ("NCM(", "CCT(", "Anexo(", "CNAE(", "NBS(")
TOKENS_RELS = ("PERTENCE_A", "TEM_CLASSIFICACAO", "MAPEIA")

MARCADOR_INICIO = "<!-- GRAFO-FISCAL-INICIO (gerado por scripts/grafo/build-grafo-kglite.py --describe; nao editar manualmente) -->"
MARCADOR_FIM = "<!-- GRAFO-FISCAL-FIM -->"

SECAO_PROMPT = """\
{inicio}
## Grafo fiscal local (referência, Phase 10)
- Nós: NCM, SH6, SH4, Capitulo, Secao, CCT, Anexo, ArtigoLC214, CNAE, NBS, Termo.
- Relações: PERTENCE_A, TEM_CLASSIFICACAO (+_NBS p/ serviços), REDUZ_PARA,
  FUNDAMENTA_EM, MAPEIA (CNAE→NBS, ponte não-oficial), SINONIMO_DE.
- Caminho auditável: NCM→SH6→SH4→Cap→CCT→Anexo→Artigo · serviços: CNAE→NBS→CCT.
- Toda aresta tem proveniência (origem: por_codigo|triangulado|heranca|curadoria,
  confianca 0–1, anoReferencia). Sem proveniência = sem citação de caminho.
- O grafo PROPÕE candidatos; o resolvedor determinístico DECIDE (via:grafo em
  trilha). Nunca precifique pelo grafo; nunca exponha PII ao MCP (stdio local).
{fim}""".format(inicio=MARCADOR_INICIO, fim=MARCADOR_FIM)

FONTE_GRAFO = {
    "id": "grafo-fiscal",
    "arquivo": "recursos-ia/grafo/grafo.kgl.json + recursos-ia/grafo/describe.txt",
    "tipo": "grafo-local",
    "cobre": "NCM→SH6→SH4→Cap→CCT→Anexo→Artigo + CNAE→NBS→CCT (nodos/arestas com proveniência por aresta)",
    "quandoUsar": "candidatos + caminho multi-hop auditável antes do resolvedor (via:grafo)",
    "ferramentas": ["consultarNCM", "consultarNBS", "consultarCNAE", "detalharCodigo"],
}


# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------
def check() -> dict:
    """Valida o schema.cypher; kglite ausente é reportado, nunca falha o check."""
    try:
        txt = SCHEMA.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"schema_ok": False, "faltando": ["schema.cypher ausente"], "kglite_ok": False}
    exigidos = list(TOKENS_NOS) + list(TOKENS_RELS)
    faltando = [t for t in exigidos if t not in txt]
    pk_ok = "PRIMARY KEY" in txt
    if not pk_ok:
        faltando.append("PRIMARY KEY")
    try:
        import kglite  # noqa: F401
        from importlib.metadata import version as _ver

        kglite_ok, kglite_ver = True, _ver("kglite")
    except Exception:
        kglite_ok, kglite_ver = False, "ausente (pip install kglite em 10-04)"
    return {
        "schema_ok": not faltando,
        "faltando": faltando,
        "pk_ok": pk_ok,
        "kglite_ok": kglite_ok,
        "kglite_ver": kglite_ver,
        "schema": str(SCHEMA.relative_to(ROOT)),
    }


# ---------------------------------------------------------------------------
# Carga do payload (full via 10-01, ou demo determinístico)
# ---------------------------------------------------------------------------
def _demo() -> tuple[list, list]:
    nodos = [
        {"id": "NCM:02011000", "tipo": "NCM", "props": {"codigo": "02011000", "descricao": "Carnes de bovino frescas", "vigente": True, "capitulo": "02"}},
        {"id": "SH6:020110", "tipo": "SH6", "props": {"codigo": "020110"}},
        {"id": "CCT:000001", "tipo": "CCT", "props": {"codigo": "000001", "redIBS": 0, "redCBS": 0}},
        {"id": "Anexo:I", "tipo": "Anexo", "props": {"nome": "I", "rotulo": "Anexo I (LC 214/2025)"}},
        {"id": "ArtigoLC214:125", "tipo": "ArtigoLC214", "props": {"numero": "125", "titulo": "Cesta básica"}},
        {"id": "CNAE:0161001", "tipo": "CNAE", "props": {"codigo": "0161001"}},
        {"id": "NBS:122011100", "tipo": "NBS", "props": {"codigo": "122011100"}},
    ]
    arestas = [
        {"de": "NCM:02011000", "para": "SH6:020110", "tipo": "PERTENCE_A", "origem": "heranca", "confianca": 0.6, "anoReferencia": 2026},
        {"de": "NCM:02011000", "para": "CCT:000001", "tipo": "TEM_CLASSIFICACAO", "origem": "por_codigo", "confianca": 1, "anoReferencia": 2026},
        {"de": "CCT:000001", "para": "Anexo:I", "tipo": "REDUZ_PARA", "origem": "por_codigo", "confianca": 1, "anoReferencia": 2026},
        {"de": "Anexo:I", "para": "ArtigoLC214:125", "tipo": "FUNDAMENTA_EM", "origem": "curadoria", "confianca": 0.9, "anoReferencia": 2026},
        {"de": "CNAE:0161001", "para": "NBS:122011100", "tipo": "MAPEIA", "origem": "por_codigo", "confianca": 0.9, "anoReferencia": 2026},
    ]
    return nodos, arestas


def carregar_payload(demo: bool = False) -> dict:
    """Lê public/base/grafo/grafo.lbug.json + MANIFEST.grafo.json (full) ou demo."""
    if not demo and LBUG_JSON.exists():
        payload = json.loads(LBUG_JSON.read_text(encoding="utf-8"))
        manifest = {}
        if MANIFEST_GRAFO.exists():
            manifest = json.loads(MANIFEST_GRAFO.read_text(encoding="utf-8"))
        return {
            "modo": "full",
            "nodos": payload.get("nodos", []),
            "arestas": payload.get("arestas", []),
            "hashBase": manifest.get("hashBase") or payload.get("hashBase"),
            "versao": manifest.get("versao", GRAFO_VERSAO),
        }
    nodos, arestas = _demo()
    return {"modo": "demo", "nodos": nodos, "arestas": arestas, "hashBase": None, "versao": GRAFO_VERSAO}


# ---------------------------------------------------------------------------
# Scorecard de auditoria
# ---------------------------------------------------------------------------
def auditar(nodos: list, arestas: list) -> dict:
    ids = [n.get("id") for n in nodos if isinstance(n, dict)]
    pk_unicas = len(set(ids)) == len(ids) and len(ids) > 0
    id_set = set(ids)
    sem_orfaos = bool(arestas) and all(
        isinstance(a, dict) and a.get("de") in id_set and a.get("para") in id_set for a in arestas
    )
    prov_ok = bool(arestas)
    for a in arestas:
        if not isinstance(a, dict):
            prov_ok = False
            break
        try:
            conf = float(a.get("confianca"))
        except (TypeError, ValueError):
            prov_ok = False
            break
        if a.get("origem") not in ORIGENS or not (0 <= conf <= 1):
            prov_ok = False
            break
    checagens = [pk_unicas, prov_ok, sem_orfaos, len(nodos) > 0, len(arestas) > 0]
    score = round(sum(1 for c in checagens if c) / len(checagens), 4)
    return {
        "nodos": len(nodos),
        "arestas": len(arestas),
        "semOrfaos": bool(sem_orfaos),
        "proveniencia100%": bool(prov_ok),
        "pkUnicas": bool(pk_unicas),
        "score": score,
    }


def hash_payload(nodos: list, arestas: list) -> str:
    return hashlib.sha256(json.dumps({"nodos": nodos, "arestas": arestas}).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# describe(): schema textual + system_prompt + catálogo
# ---------------------------------------------------------------------------
def _texto_describe(score: dict, modo: str) -> str:
    return f"""# Grafo fiscal Aurum Tax NCM — describe() KGLite (Phase 10-04)
# Espelho textual de scripts/grafo/schema.cypher p/ agentes dev (curadoria, offline).
# Gerado em: {datetime.now(timezone.utc).isoformat()} · versao: {GRAFO_VERSAO} · modo: {modo}
# Contadores: {score["nodos"]} nodos · {score["arestas"]} arestas · score {score["score"]}

## Nos (PRIMARY KEY = codigo/nome/numero/termo)
- NCM(codigo, descricao, vigente, capitulo)
- SH6(codigo, descricao) · SH4(codigo, descricao) · Capitulo(codigo, descricao) · Secao(codigo, descricao)
- CCT(codigo, descricao, redIBS, redCBS)
- Anexo(nome, rotulo) · ArtigoLC214(numero, titulo)
- CNAE(codigo, descricao, anexoSimples) · NBS(codigo, descricao) · Termo(termo)

## Relacoes (toda aresta carrega proveniencia: origem + confianca + anoReferencia)
- NCM -[PERTENCE_A]-> SH6 (-[SH6_EM]-> SH4 -[SH4_EM]-> Capitulo -[CAP_EM]-> Secao)
- NCM -[TEM_CLASSIFICACAO]-> CCT · NBS -[TEM_CLASSIFICACAO_NBS]-> CCT
- CCT -[REDUZ_PARA]-> Anexo -[FUNDAMENTA_EM]-> ArtigoLC214
- CNAE -[MAPEIA]-> NBS (ponte nao-oficial: por_codigo|triangulado)
- Termo -[SINONIMO_DE]-> NCM · Termo -[SINONIMO_NBS]-> NBS

## Caminho canonico auditavel (via:grafo)
NCM→SH6→SH4→Cap→CCT→Anexo→Artigo · servicos: CNAE→NBS→CCT
Origens validas: por_codigo|triangulado|heranca|curadoria (+uso_local do overlay 10-08).

## Regras duras
- O grafo PROPOE candidatos; o resolvedor deterministico DECIDE (via:grafo em trilha).
- 100% offline (LadybugDB .lbug no app; .kgl so p/ curadoria/CI). Fail-closed:
  sem .lbug/sem embedding → FTS-puro → lexical → NAO SEI. Nunca mock silencioso.
- MCP dev: kglite-mcp-server --graph recursos-ia/grafo/grafo.kgl (stdio local, sem PII remota).
"""


def _injetar_prompt(caminho: Path) -> bool:
    """Injeta a seção grafo entre marcadores (idempotente)."""
    if not caminho.exists():
        return False
    txt = caminho.read_text(encoding="utf-8")
    if MARCADOR_INICIO in txt and MARCADOR_FIM in txt:
        antes, resto = txt.split(MARCADOR_INICIO, 1)
        _, depois = resto.split(MARCADOR_FIM, 1)
        txt = antes + SECAO_PROMPT + depois
    else:
        if not txt.endswith("\n"):
            txt += "\n"
        txt += "\n" + SECAO_PROMPT + "\n"
    caminho.write_text(txt, encoding="utf-8")
    return True


def describe(score: dict | None = None, modo: str = "full") -> dict:
    """Exporta describe.txt + injeta system_prompt + atualiza catalogo-rag.json."""
    score = score or {"nodos": 0, "arestas": 0, "score": 0}
    GRAFO_DIR.mkdir(parents=True, exist_ok=True)
    DESCRIBE_TXT.write_text(_texto_describe(score, modo), encoding="utf-8")

    candidatos = [
        ROOT / "finetune_cnpj" / "system_prompt.txt",
        ROOT / "finetune_simples_inverso" / "system_prompt.txt",
        ROOT.parent / "finetune_cnpj" / "system_prompt.txt",
        ROOT.parent / "finetune_simples_inverso" / "system_prompt.txt",
    ]
    vistos: set[str] = set()
    prompts = []
    for cand in candidatos:
        chave = str(cand.resolve()) if cand.exists() else str(cand)
        if chave in vistos:
            continue
        vistos.add(chave)
        if _injetar_prompt(cand):
            prompts.append(str(cand))

    fontes_n = 0
    if CATALOGO.exists():
        catalogo = json.loads(CATALOGO.read_text(encoding="utf-8"))
        fontes = catalogo.get("fontes", [])
        for i, f in enumerate(fontes):
            if isinstance(f, dict) and f.get("id") == FONTE_GRAFO["id"]:
                fontes[i] = FONTE_GRAFO
                break
        else:
            fontes.append(FONTE_GRAFO)
        catalogo["fontes"] = fontes
        fontes_n = len(fontes)
        CATALOGO.write_text(json.dumps(catalogo, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return {
        "describe": str(DESCRIBE_TXT.relative_to(ROOT)),
        "prompts_atualizados": prompts,
        "catalogo_fontes": fontes_n,
    }


# ---------------------------------------------------------------------------
# --build / --gate
# ---------------------------------------------------------------------------
def construir_via_kglite(nodos: list, arestas: list) -> str | None:
    """Tenta materializar grafo.kgl nativo; devolve o caminho ou None (fallback JSON).

    Best-effort: a API exata varia entre versões do kglite — qualquer
    divergência cai no espelho JSON portátil (caminho suportado e testado).
    """
    import kglite

    grafo = kglite.Graph()  # AttributeError aqui => fallback
    ingestao = getattr(grafo, "cypher", None)
    if not callable(ingestao):
        return None
    for n in nodos:
        nid = str(n.get("id", "")).replace("'", "\\'")
        ingestao(f"CREATE (x:No {{id: '{nid}', tipo: '{n.get('tipo', '')}'}})")
    for a in arestas:
        ingestao(
            "MATCH (d:No {id: '%s'}), (p:No {id: '%s'}) CREATE (d)-[:LIGA {tipo: '%s'}]->(p)"
            % (str(a.get("de", "")).replace("'", "\\'"), str(a.get("para", "")).replace("'", "\\'"), a.get("tipo", ""))
        )
    salvar = getattr(grafo, "save", None)
    if not callable(salvar):
        return None
    salvar(str(OUT_KGL))
    return str(OUT_KGL)


def build(demo: bool = False) -> dict:
    res = check()
    if not res["schema_ok"]:
        raise SystemExit(f"schema incompleto: {res['faltando']}")
    payload = carregar_payload(demo=demo)
    nodos, arestas = payload["nodos"], payload["arestas"]
    score = auditar(nodos, arestas)

    GRAFO_DIR.mkdir(parents=True, exist_ok=True)
    try:
        salvo = construir_via_kglite(nodos, arestas)
        kglite_usado = salvo is not None
    except Exception as exc:  # pacote ausente ou API divergente => fallback
        salvo, kglite_usado = None, False
        print(f"kglite indisponivel ({str(exc)[:120]}) — usando espelho JSON.", file=sys.stderr)
    if salvo is None:
        espelho = {
            "formato": "grafo-kglite-espelho",
            "versao": payload["versao"],
            "geradoEm": datetime.now(timezone.utc).isoformat(),
            "modo": payload["modo"],
            "hashBase": payload["hashBase"],
            "hash": hash_payload(nodos, arestas),
            "nodos": nodos,
            "arestas": arestas,
        }
        OUT_JSON.write_text(json.dumps(espelho), encoding="utf-8")
        salvo = str(OUT_JSON)

    scorecard = {
        **score,
        "modo": payload["modo"],
        "versao": payload["versao"],
        "hashBase": payload["hashBase"],
        "geradoEm": datetime.now(timezone.utc).isoformat(),
        "kglite": kglite_usado,
    }
    SCORECARD.write_text(json.dumps(scorecard, indent=2, ensure_ascii=False), encoding="utf-8")

    desc = describe(score, payload["modo"])
    return {"salvo": salvo, "kglite": kglite_usado, "scorecard": scorecard, **desc}


def gate(threshold: float = THRESHOLD_PADRAO) -> dict:
    if not SCORECARD.exists():
        return {"gate_ok": False, "erro": "audit-scorecard.json ausente — rode --build antes"}
    score = json.loads(SCORECARD.read_text(encoding="utf-8"))
    valor = float(score.get("score", 0))
    return {"gate_ok": valor >= threshold, "score": valor, "threshold": threshold, "scorecard": str(SCORECARD.relative_to(ROOT))}


def main() -> None:
    ap = argparse.ArgumentParser(description="Phase 10-04 — espelho KGLite do grafo fiscal")
    ap.add_argument("--check", action="store_true", help="valida schema.cypher + reporta kglite")
    ap.add_argument("--build", action="store_true", help="gera .kgl (ou espelho JSON) + scorecard + describe()")
    ap.add_argument("--describe", action="store_true", help="só describe(): describe.txt + prompts + catálogo")
    ap.add_argument("--demo", action="store_true", help="com --build: grafo demo em vez do full")
    ap.add_argument("--gate", action="store_true", help="com --build ou sozinho: falha se score < threshold")
    ap.add_argument("--threshold", type=float, default=THRESHOLD_PADRAO, help="corte do gate (padrão 0.85)")
    a = ap.parse_args()

    if a.build:
        resultado = build(demo=a.demo)
        print(json.dumps(resultado, indent=2, ensure_ascii=False))
        if a.gate:
            g = gate(a.threshold)
            print(json.dumps(g, indent=2, ensure_ascii=False))
            sys.exit(0 if g["gate_ok"] else 2)
    elif a.describe:
        payload = carregar_payload(demo=a.demo)
        resultado = describe(auditar(payload["nodos"], payload["arestas"]), payload["modo"])
        print(json.dumps(resultado, indent=2, ensure_ascii=False))
    elif a.gate:
        g = gate(a.threshold)
        print(json.dumps(g, indent=2, ensure_ascii=False))
        sys.exit(0 if g["gate_ok"] else 2)
    else:  # --check (padrão)
        r = check()
        print(json.dumps(r, indent=2, ensure_ascii=False))
        sys.exit(0 if r["schema_ok"] else 1)


if __name__ == "__main__":
    main()
