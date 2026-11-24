"""Verifica a cobertura de glifos da UI na Iosevka (brief, Adendo: "o build verifica os glifos").

Uso (da raiz do repositório ou de ui/):
    uv run --with fonttools --with brotli python ui/scripts/check-glyphs.py

Regras:
1. Todo caractere não-ASCII que não seja letra nem acento combinante e apareça em
   ui/src/**/*.{ts,tsx,css} precisa estar declarado em ui/src/lib/glyphs.ts (fonte única).
2. Todo glifo declarado precisa existir na Iosevka (400, 400 itálico e 700) de
   node_modules/@fontsource/iosevka/files/*.woff2.
Sai com código 1 e lista o que faltar.
"""

from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover
    sys.exit("fonttools ausente: rode com `uv run --with fonttools --with brotli python ...`")

UI = Path(__file__).resolve().parent.parent
SRC = UI / "src"
GLYPHS_TS = SRC / "lib" / "glyphs.ts"
FONT_DIR = UI / "node_modules" / "@fontsource" / "iosevka" / "files"
FONTES = ["iosevka-latin-400-normal.woff2", "iosevka-latin-400-italic.woff2", "iosevka-latin-700-normal.woff2"]


def relevante(ch: str) -> bool:
    """Não-ASCII, não letra (acentos do português são letras) e não marca combinante."""
    if ord(ch) < 128:
        return False
    cat = unicodedata.category(ch)
    return not (cat.startswith("L") or cat.startswith("M") or cat in ("Zs", "Cc", "Cf"))


def chars_de(texto: str) -> set[str]:
    return {c for c in texto if relevante(c)}


def main() -> int:
    if not FONT_DIR.is_dir():
        print(f"✕ fonte não encontrada em {FONT_DIR} (rode npm install em ui/)")
        return 1
    declarados = chars_de(GLYPHS_TS.read_text(encoding="utf-8"))
    usados: dict[str, set[str]] = {}
    for p in sorted(SRC.rglob("*")):
        if p.suffix not in (".ts", ".tsx", ".css") or p == GLYPHS_TS:
            continue
        for c in chars_de(p.read_text(encoding="utf-8")):
            usados.setdefault(c, set()).add(str(p.relative_to(UI)))

    falhas = 0
    nao_declarados = sorted(set(usados) - declarados)
    if nao_declarados:
        falhas += len(nao_declarados)
        print("✕ glifos usados em src/ e não declarados em src/lib/glyphs.ts:")
        for c in nao_declarados:
            print(f"   {c}  U+{ord(c):04X}  {unicodedata.name(c, '?')}  em {', '.join(sorted(usados[c]))}")

    todos = declarados | set(usados)
    for nome in FONTES:
        font = TTFont(str(FONT_DIR / nome))
        cmap = font.getBestCmap() or {}
        faltam = sorted(c for c in todos if ord(c) not in cmap)
        if faltam:
            falhas += len(faltam)
            print(f"✕ {nome}: {len(faltam)} glifo(s) ausente(s):")
            for c in faltam:
                print(f"   {c}  U+{ord(c):04X}  {unicodedata.name(c, '?')}")

    if falhas:
        return 1
    print(f"✓ {len(todos)} glifos verificados em {len(FONTES)} pesos da Iosevka ({len(usados)} usados em src/, {len(declarados)} declarados)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
