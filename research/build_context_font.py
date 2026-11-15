"""Expose Caveat's existing ss01/ss02 outlines to Canvas as private cmap aliases.

No letter outlines or stroke paths are invented, stretched, or warped. The OFL,
copyright and original glyph tables are retained; the derivative is renamed.
fontTools is needed only to rebuild this checked-in asset, not at runtime.
"""
from pathlib import Path

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'


def build():
    font = TTFont(ROOT / 'public/fonts/Caveat.ttf', recalcTimestamp=False)
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    aliases = {}
    for index, character in enumerate(ALPHABET):
        base = cmap[ord(character)]
        outlines = []
        for variant, glyph in enumerate((base, f'{base}.ss01', f'{base}.ss02')):
            if glyph not in glyphs:
                raise ValueError(f'Missing authored alternate: {glyph}')
            pen = RecordingPen()
            glyphs[glyph].draw(pen)
            outlines.append(repr(pen.value))
            if variant:
                aliases[0xE000 + index * 2 + variant - 1] = glyph
        if len(set(outlines)) != 3:
            raise ValueError(f'{character} does not have three distinct authored outlines.')

    for table in font['cmap'].tables:
        if table.isUnicode() and table.format in (4, 12):
            table.cmap.update(aliases)
    names = {
        1: 'InkForge Context', 2: 'Regular', 3: 'InkForgeContext-Contextual-1',
        4: 'InkForge Context Regular', 6: 'InkForgeContext-Regular',
        16: 'InkForge Context', 17: 'Regular', 25: 'InkForgeContext',
        10: 'Derived from Caveat. Private cmap aliases expose existing ss01/ss02 outlines; no outline edits. SIL OFL 1.1; see caveat-OFL.txt.',
    }
    for name_id, value in names.items():
        font['name'].removeNames(nameID=name_id)
        font['name'].setName(value, name_id, 3, 1, 0x409)
        font['name'].setName(value, name_id, 1, 0, 0)
    destination = ROOT / 'public/fonts/InkForgeContext.ttf'
    font.save(destination)
    font.close()
    print(f'Created {destination.name}: 52 letters, 104 aliases, three distinct authored forms per letter.')


if __name__ == '__main__':
    build()
