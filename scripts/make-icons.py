#!/usr/bin/env python3
"""Generate the app icons and the tab favicon from one vector definition.

Pure stdlib (zlib + struct + math) — no Pillow, so it runs anywhere python3
does. Re-run after changing the mark or the palette:

    python3 scripts/make-icons.py

The mark is the "ruler-T pen": a T whose crossbar is a ruler (long/short
inch ticks notched into its top edge) and whose stem is a pen, nib down, with
one heavy cycle of AC waveform arriving from the left and finishing at the
nib — measure it, then write the electrical bid. Dark on the brand yellow
tile, the same tile CountTooling's and PipeTooling's marks sit on, so the
three read as siblings.

The nib's slit and breather hole are drawn only at 64 px and up (the app
icons, the touch icon, icon.svg): below that they can't resolve and would
only thin the stem, so the favicon sizes and favicon.svg carry the plain nib.

Outputs (paths relative to the repo root):
    icons/icon.svg              canonical vector, nib detail on (rounded tile)
    icons/favicon.svg           the small-size vector, plain nib — the SVG tab icon
                                and the source of index.html's inline header mark
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
import re
import struct
import zlib

YELLOW = (0xE8, 0xC5, 0x47)  # --accent
DARK = (0x16, 0x16, 0x17)    # the glyph ink (CountTooling's #161617)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'icons')

# --- the mark, in 512-unit canvas coordinates ------------------------------
TILE_RX = 112
BAR = (72, 84, 368, 100, 16)          # x, y, w, h, rx  — the ruler crossbar
TICK_W = 22
TICKS = ((118, 56), (164, 34), (210, 56), (302, 56), (348, 34), (394, 56))  # (x-center, depth) long/short
STEM = (208, 84, 96, 222, 16)         # x, y, w, h, rx  — the pen barrel, down past the nib's shoulder
NIB = ((208, 296), (304, 296), (256, 392))  # shoulder-left, shoulder-right, tip
SLIT = ((256, 384), (256, 322), 10)   # the nib's slit: from near the tip up to the breather hole; width
BREATHER = (256, 322, 11)             # cx, cy, r
DETAIL_MIN_PX = 64                    # slit + breather only at this size and up
# The wave: one cycle of sine from the left of the safe zone to the nib tip,
# written left to right the way a hand moves, so the pen sits at the end of
# the stroke. Heavy on purpose — the weight is what keeps it a wave at 16 px.
WAVE_X0, WAVE_AMP, WAVE_CYCLES = 72, 40, 1
SIG_W = 50


def wave_path():
    """The sine as absolute cubic Béziers (M + C), ending at the nib tip."""
    (_, _), (_, _), (tx, ty) = NIB
    half = (tx - WAVE_X0) / (2 * WAVE_CYCLES)
    d = f'M{WAVE_X0} {ty}'
    x = WAVE_X0
    for i in range(2 * WAVE_CYCLES):
        sign = 1 if i % 2 else -1          # first half-wave rises (screen y down)
        peak = ty + sign * WAVE_AMP * 1.55  # control-point height for a sine-like hump
        ax, bx, ex = x + half * 0.36, x + half * 0.64, x + half
        d += f' C{ax:.1f} {peak:.1f} {bx:.1f} {peak:.1f} {ex:.1f} {ty}'
        x = ex
    return d


SIG = wave_path()


def svg_text(bleed=False, detail=True):
    """The mark as SVG. bleed=True fills the whole square (maskable / apple-touch)."""
    tile = ('<rect width="512" height="512" fill="#e8c547"/>' if bleed
            else f'<rect width="512" height="512" rx="{TILE_RX}" fill="#e8c547"/>')
    x, y, w, h, rx = BAR
    bar = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="#161617"/>'
    ticks = ''.join(f'<rect x="{cx - TICK_W // 2}" y="{y}" width="{TICK_W}" height="{d}" fill="#e8c547"/>'
                    for cx, d in TICKS)
    x, y, w, h, rx = STEM
    stem = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="#161617"/>'
    (ax, ay), (bx, by), (cx, cy) = NIB
    nib = f'<path d="M{ax} {ay} H{bx} L{cx} {cy} Z" fill="#161617"/>'
    slit = ''
    if detail:
        (sx0, sy0), (sx1, sy1), sw = SLIT
        hx, hy, hr = BREATHER
        slit = (f'<line x1="{sx0}" y1="{sy0}" x2="{sx1}" y2="{sy1}" stroke="#e8c547" stroke-width="{sw}" stroke-linecap="round"/>'
                f'<circle cx="{hx}" cy="{hy}" r="{hr}" fill="#e8c547"/>')
    sig = (f'<path d="{SIG}" fill="none" stroke="#161617" stroke-width="{SIG_W}" '
           f'stroke-linecap="round" stroke-linejoin="round"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'{tile}{bar}{ticks}{stem}{nib}{slit}{sig}</svg>\n')


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
    (ax, ay), (bx, by), (cx, cy) = NIB
    if yc < ay or yc > cy:
        return None
    t = (yc - ay) / (cy - ay)
    return (ax + (cx - ax) * t, bx + (cx - bx) * t)


def cubic_points(d, n=48):
    """Sample an SVG path made of M + C segments into a dense polyline."""
    tokens = re.sub(r'([MC])', r' \1 ', d.replace(',', ' ')).split()
    pts, i, cur = [], 0, None
    while i < len(tokens):
        cmd = tokens[i]
        if cmd == 'M':
            cur = (float(tokens[i + 1]), float(tokens[i + 2]))
            pts.append(cur)
            i += 3
        elif cmd == 'C':
            p1 = (float(tokens[i + 1]), float(tokens[i + 2]))
            p2 = (float(tokens[i + 3]), float(tokens[i + 4]))
            p3 = (float(tokens[i + 5]), float(tokens[i + 6]))
            p0 = cur
            for k in range(1, n + 1):
                t = k / n
                u = 1 - t
                pts.append((u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]))
            cur = p3
            i += 7
        else:
            raise ValueError('unsupported path command ' + cmd)
    return pts


def stroke_discs(points, width, step=2.0):
    """A round-capped stroke as a union of discs: densify the polyline so
    consecutive discs overlap, then return [(cx, cy, r), ...]."""
    r = width / 2
    out = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dist = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(dist / step))
        for k in range(n):
            t = k / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r))
    x, y = points[-1]
    out.append((x, y, r))
    return out


SIG_DISCS = stroke_discs(cubic_points(SIG), SIG_W)
SLIT_DISCS = stroke_discs([SLIT[0], SLIT[1]], SLIT[2]) + [BREATHER]


def disc_spans(discs, yc):
    for cx, cy, r in discs:
        dy = yc - cy
        if -r < dy < r:
            half = math.sqrt(r * r - dy * dy)
            yield (cx - half, cx + half)


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
    detail = size >= DETAIL_MIN_PX
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
        by = BAR[1]
        for cx, d in TICKS:
            if by <= yc < by + d:
                paint(row, (cx - TICK_W / 2, cx + TICK_W / 2), k, 1)
        paint(row, rrect_span(STEM, yc), k, 2)
        paint(row, tri_span(yc), k, 2)
        if detail:
            for span in disc_spans(SLIT_DISCS, yc):
                paint(row, span, k, 1)
        for span in disc_spans(SIG_DISCS, yc):
            paint(row, span, k, 2)
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
    write('icons/icon.svg', svg_text(detail=True).encode())
    write('icons/favicon.svg', svg_text(detail=False).encode())
    write('icons/icon-192.png', png_bytes(render(192, bleed=False), opaque=False))
    write('icons/icon-512.png', png_bytes(render(512, bleed=False), opaque=False))
    write('icons/maskable-512.png', png_bytes(render(512, bleed=True), opaque=True))
    write('icons/apple-touch-180.png', png_bytes(render(180, bleed=True), opaque=True))
    write('favicon.ico', ico_bytes([(s, png_bytes(render(s, bleed=False), opaque=False)) for s in (16, 32, 48)]))
    print('icons + favicon generated.')
