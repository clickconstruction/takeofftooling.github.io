#!/usr/bin/env python3
"""Generate the installable-app icons in icons/ from the css/styles.css palette.

Pure stdlib (zlib + struct) — no Pillow, so it runs anywhere python3 does.
Re-run after changing the palette:

    python3 scripts/make-icons.py

Draws a yellow "T" on the app's dark ground, inset far enough that a
maskable circle crop never clips it.
"""
import os
import struct
import zlib

BG = (0x0F, 0x0F, 0x11)      # --bg
ACCENT = (0xE8, 0xC5, 0x47)  # --accent
ACCENT2 = (0xC9, 0xA8, 0x2E)  # --accent2

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')


def draw(size):
    """Return `size` rows of `size` RGB pixels: a T mark on the app ground."""
    pad = round(size * 0.26)         # safe-zone inset for maskable crops
    thick = max(1, round(size * 0.15))
    left, right = pad, size - pad
    top, bottom = pad, size - pad
    stem_l = (size - thick) // 2
    stem_r = stem_l + thick
    rule_top = bottom + max(1, round(size * 0.055))
    rule_bot = rule_top + max(1, round(size * 0.045))

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            if top <= y < top + thick and left <= x < right:
                px = ACCENT                      # crossbar
            elif top <= y < bottom and stem_l <= x < stem_r:
                px = ACCENT                      # stem
            elif rule_top <= y < rule_bot and left <= x < right:
                px = ACCENT2                     # baseline rule
            else:
                px = BG
            row.append(px)
        rows.append(row)
    return rows


def png_bytes(rows):
    size = len(rows)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type: none
        for r, g, b in row:
            raw += bytes((r, g, b))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit truecolour
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        path = os.path.join(OUT_DIR, f'icon-{size}.png')
        with open(path, 'wb') as fh:
            fh.write(png_bytes(draw(size)))
        print(f'wrote {path}')
