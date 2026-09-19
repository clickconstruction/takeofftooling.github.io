#!/usr/bin/env python3
"""Generate the app icons and the tab favicon from one vector definition.

Pure stdlib (zlib + struct + math) — no Pillow, so it runs anywhere python3
does. Re-run after changing the mark or the palette:

    python3 scripts/make-icons.py

The mark is the "ruler-T pin": a T whose crossbar is a ruler (long/short
inch ticks notched into its top edge) and whose stem ends in a pin point —
measure, then mark the spot on the plan. Dark on the brand yellow tile,
the same tile CountTooling's mark sits on, so the two read as siblings.

Outputs (paths relative to the repo root):
    icons/icon.svg              canonical vector (rounded tile, transparent corners)
    icons/favicon.svg           the same, served as the SVG tab icon
    favicon.ico                 16/32/48 PNG-in-ICO (Safari + the browser's own
                                /favicon.ico probe)
    icons/icon-192.png          rounded tile, transparent corners   (manifest "any")
    icons/icon-512.png          rounded tile, transparent corners   (manifest "any")
    icons/maskable-512.png      FULL-BLEED yellow to every edge      (manifest "maskable")
    icons/apple-touch-180.png   FULL-BLEED yellow, opaque            (apple-touch-icon)

Geometry lives on a 512x512 canvas and stays inside the central ~80% so a
platform's maskable crop never clips it. The raster is 4x4 supersampled from
the same numbers the SVG is written from, so the PNGs and the SVG can't drift.
"""
import math
import os
import struct
import zlib

YELLOW = (0xE8, 0xC5, 0x47)  # --accent
DARK = (0x16, 0x16, 0x17)    # the glyph ink (CountTooling's #161617)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'icons')

# --- the mark, in 512-unit canvas coordinates ------------------------------
TILE_RX = 112
BAR = (72, 88, 368, 100, 16)          # x, y, w, h, rx  — the ruler crossbar
STEM = (208, 88, 96, 272, 16)         # x, y, w, h, rx  — the stem, down to the pin's shoulder
PIN = ((208, 350), (304, 350), (256, 440))  # the point: shoulder-left, shoulder-right, tip
TICK_W = 22
TICKS = ((118, 56), (164, 34), (210, 56), (302, 56), (348, 34), (394, 56))  # (x-center, depth) long/short


def svg_text(bleed=False):
    """The mark as SVG. bleed=True fills the whole square (maskable / apple-touch)."""
    tile = (f'<rect width="512" height="512" fill="#e8c547"/>' if bleed
            else f'<rect width="512" height="512" rx="{TILE_RX}" fill="#e8c547"/>')
    x, y, w, h, rx = BAR
    bar = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="#161617"/>'
    ticks = ''.join(f'<rect x="{cx - TICK_W // 2}" y="{y}" width="{TICK_W}" height="{d}" fill="#e8c547"/>'
                    for cx, d in TICKS)
    x, y, w, h, rx = STEM
    stem = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="#161617"/>'
    (ax, ay), (bx, by), (cx, cy) = PIN
    pin = f'<path d="M{ax} {ay} H{bx} L{cx} {cy} Z" fill="#161617"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'{tile}{bar}{ticks}{stem}{pin}</svg>\n')


# --- rasterizer: per-row class intervals on a 4x supersampled grid ----------
SS = 4  # supersample factor per axis (16 samples per pixel)


def rrect_span(rect, yc):
    """Horizontal [x0, x1) covered by a rounded rect at canvas row yc, or None."""
    x, y, w, h, rx = rect
    if yc < y or yc >= y + h:
        return None
    rx = min(rx, w / 2, h / 2)
    if yc < y + rx:
        dy = (y + rx) - yc
    elif yc > y + h - rx:
        dy = yc - (y + h - rx)
    else:
        return (x, x + w)
    half = math.sqrt(max(rx * rx - dy * dy, 0.0))
    return (x + rx - half, x + w - rx + half)


def tri_span(yc):
    (ax, ay), (bx, by), (cx, cy) = PIN
    if yc < ay or yc > cy:
        return None
    t = (yc - ay) / (cy - ay)
    return (ax + (cx - ax) * t, bx + (cx - bx) * t)


def paint(row, span, k, value):
    if span is None:
        return
    x0 = max(0, int(round(span[0] * k)))
    x1 = min(len(row), int(round(span[1] * k)))
    if x1 > x0:
        row[x0:x1] = bytes([value]) * (x1 - x0)


def render(size, bleed):
    """Return rows of (r, g, b, a) for a `size` px icon."""
    n = size * SS
    k = n / 512.0
    # class per sample: 0 = outside the tile, 1 = yellow tile, 2 = dark ink
    sub_rows = []
    for sy in range(n):
        yc = (sy + 0.5) / k
        row = bytearray(n)
        if bleed:
            row[:] = b'\x01' * n
        else:
            paint(row, rrect_span((0, 0, 512, 512, TILE_RX), yc), k, 1)
        paint(row, rrect_span(BAR, yc), k, 2)
        bx, by, bw, bh, _ = BAR
        for cx, d in TICKS:
            if by <= yc < by + d:
                paint(row, (cx - TICK_W / 2, cx + TICK_W / 2), k, 1)
        paint(row, rrect_span(STEM, yc), k, 2)
        paint(row, tri_span(yc), k, 2)
        sub_rows.append(row)

    total = SS * SS
    out = []
    for py in range(size):
        block = sub_rows[py * SS:(py + 1) * SS]
        line = []
        for px in range(size):
            x0 = px * SS
            n_ink = n_tile = 0
            for r in block:
                seg = r[x0:x0 + SS]
                n_ink += seg.count(2)
                n_tile += seg.count(1)
            cover = n_ink + n_tile
            if cover == 0:
                line.append((0, 0, 0, 0))
                continue
            rgb = tuple(round((YELLOW[i] * n_tile + DARK[i] * n_ink) / cover) for i in range(3))
            line.append(rgb + (round(255 * cover / total),))
        out.append(line)
    return out


# --- encoders ---------------------------------------------------------------
def png_bytes(rows, opaque):
    size = len(rows)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter: none
        for r, g, b, a in row:
            raw += bytes((r, g, b)) if opaque else bytes((r, g, b, a))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    color_type = 2 if opaque else 6  # truecolour / truecolour + alpha
    ihdr = struct.pack('>IIBBBBB', size, size, 8, color_type, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))


def ico_bytes(pngs):
    """An ICO container of PNG-encoded images: [(size, png_bytes), ...]."""
    header = struct.pack('<HHH', 0, 1, len(pngs))
    entries = b''
    offset = 6 + 16 * len(pngs)
    for size, data in pngs:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return header + entries + b''.join(data for _, data in pngs)


def write(rel, data):
    path = os.path.join(ROOT, rel)
    with open(path, 'wb') as fh:
        fh.write(data)
    print(f'  wrote {rel}')


if __name__ == '__main__':
    os.makedirs(ICONS, exist_ok=True)
    write('icons/icon.svg', svg_text().encode())
    write('icons/favicon.svg', svg_text().encode())
    write('icons/icon-192.png', png_bytes(render(192, bleed=False), opaque=False))
    write('icons/icon-512.png', png_bytes(render(512, bleed=False), opaque=False))
    write('icons/maskable-512.png', png_bytes(render(512, bleed=True), opaque=True))
    write('icons/apple-touch-180.png', png_bytes(render(180, bleed=True), opaque=True))
    write('favicon.ico', ico_bytes([(s, png_bytes(render(s, bleed=False), opaque=False)) for s in (16, 32, 48)]))
    print('icons + favicon generated.')
