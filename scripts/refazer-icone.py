# -*- coding: utf-8 -*-
"""Refaz o ícone do app a partir do escudo (que preenche bem o quadro).

Problema: public/icone.png e build/icon.png (500x500) tinham a arte ocupando
só ~22% da largura — na barra de tarefas (24-32px) o escudo virava um ponto
invisível. Aqui a arte passa a ocupar ~88% do quadro, com fundo transparente.
"""
from PIL import Image

TAMANHO = 512
ALTURA_ARTE = 490  # ~96% do quadro — máximo visível na barra de tarefas

escudo = Image.open("public/escudo.png").convert("RGBA")
arte = escudo.crop(escudo.getbbox())  # remove margem transparente do original
w0, h0 = arte.size
nova_alt = ALTURA_ARTE
nova_larg = round(w0 * nova_alt / h0)
arte = arte.resize((nova_larg, nova_alt), Image.LANCZOS)

tela = Image.new("RGBA", (TAMANHO, TAMANHO), (0, 0, 0, 0))
tela.paste(arte, ((TAMANHO - nova_larg) // 2, (TAMANHO - nova_alt) // 2), arte)

tela.save("build/icon.png")
tela.save("public/icone.png")
tamanhos_ico = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
                (48, 48), (64, 64), (128, 128), (256, 256)]
tela.save("build/icon.ico", sizes=tamanhos_ico)
tela.save("public/icon.ico", sizes=tamanhos_ico)

conf = Image.open("build/icon.png").convert("RGBA")
print("novo bbox arte:", conf.getbbox(), "tamanho:", conf.size)
import os
for f in ["build/icon.png", "public/icone.png", "build/icon.ico", "public/icon.ico"]:
    print(f, os.path.getsize(f), "bytes")
