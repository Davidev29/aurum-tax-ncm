# -*- coding: utf-8 -*-
"""Gera build/LICENCA.rtf a partir de build/LICENCA.txt.

Por que RTF: a página de licença do instalador NSIS interpreta .txt como
ANSI sem BOM — os acentos em UTF-8 quebravam e o texto exibia cortado. Em
RTF (cp1252 com escapes \'xx) o texto integral aparece com acentos e rolagem.
"""
import re

SRC = "build/LICENCA.txt"
OUT = "build/LICENCA.rtf"

with open(SRC, encoding="utf-8") as f:
    texto = f.read()

def escapar_rtf(s: str) -> str:
    s = s.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    out = []
    for ch in s:
        if ch == "\n":
            out.append("\n")
        elif ord(ch) < 128:
            out.append(ch)
        else:
            out.append("\\'%02x" % ch.encode("cp1252")[0])
    return "".join(out)

paras = re.split(r"\n\s*\n", texto.strip())
corpo = []
for i, p in enumerate(paras):
    p = " ".join(p.splitlines()).strip()
    if not p:
        continue
    # Título (primeiro bloco) em destaque; resto corpo normal.
    if i == 0:
        corpo.append(r"{\pard\qc\fs24\b %s\par}" % escapar_rtf(p))
    else:
        corpo.append(r"{\pard\qj\fs20 %s\par}" % escapar_rtf(p))

rtf = ("{\\rtf1\\ansi\\ansicpg1252\\deff0"
       "{\\fonttbl{\\f0 Arial;}}"
       "\\margl1440\\margr1440\\margt1440\\margb1440"
       "\\f0\n" + "\n".join(corpo) + "\n}")
with open(OUT, "w", encoding="ascii") as f:
    f.write(rtf)

# Verificação: decodifica de volta e confere que nada foi perdido.
ver = (rtf.replace("\\par", "\n")
          .replace("{\\pard\\qc\\fs24\\b ", "").replace("{\\pard\\qj\\fs20 ", ""))
ver = re.sub(r"[{}]", "", ver)
ver = re.sub(r"\\'([0-9a-f]{2})",
             lambda m: bytes([int(m.group(1), 16)]).decode("cp1252"), ver)
ver = ver.replace("\\\\", "\\")
orig_norm = " ".join(texto.split())
ver_norm = " ".join(ver.split())
faltando = [t for t in orig_norm.split() if t not in ver_norm]
print("blocos:", len(corpo))
print("palavras origem:", len(orig_norm.split()), "| palavras rtf:", len(ver_norm.split()))
print("perdidas:", faltando if faltando else "nenhuma — texto integral OK")
import os
print("tamanho:", os.path.getsize(OUT), "bytes")
