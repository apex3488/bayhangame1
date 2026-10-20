"""Real-estate illustrations for the game (public/realty/<code>.webp, 1200x750).

  python scripts/art/realty.py            # all
  python scripts/art/realty.py island     # one
"""
import math
import random
import sys
from pathlib import Path

from paint import Canvas, mix, smooth

OUT = Path(__file__).resolve().parents[2] / "public" / "realty"


# ---------------------------------------------------------------- shared pieces

def modern_house(c, x, y, w, h, wall="#f4f1ea", glass="#1d3557", warm="#ffd27a", lit=0.7, seed=1):
    """Two-storey modern house: white boxes, big glass, flat roofs. (x, y) = bottom-left."""
    r = random.Random(seed)
    # lower volume
    c.rect_grad((x, y - h * 0.5, x + w, y), [(0, wall), (1, mix(wall, "#8d8a85", 0.35))])
    c.rect((x + w * 0.06, y - h * 0.44, x + w * 0.62, y - h * 0.04), glass)
    c.windows((x + w * 0.06, y - h * 0.44, x + w * 0.62, y - h * 0.04), 4, 1, lit=lit, warm=warm, dark=glass, pad=0.08, seed=seed)
    # upper cantilever volume
    c.rect_grad((x + w * 0.22, y - h, x + w * 1.08, y - h * 0.5), [(0, mix(wall, "#ffffff", 0.3)), (1, mix(wall, "#8d8a85", 0.25))])
    c.rect((x + w * 0.28, y - h * 0.92, x + w * 1.0, y - h * 0.6), glass)
    c.windows((x + w * 0.28, y - h * 0.92, x + w * 1.0, y - h * 0.6), 5, 1, lit=lit, warm=warm, dark=glass, pad=0.08, seed=seed + 3)
    # roof slabs and shadows
    c.rect((x + w * 0.2, y - h * 1.02, x + w * 1.1, y - h * 0.985), mix(wall, "#000000", 0.15))
    c.rect((x - w * 0.02, y - h * 0.52, x + w * 0.24, y - h * 0.495), mix(wall, "#000000", 0.12))
    c.rect((x + w * 0.22, y - h * 0.5, x + w * 1.08, y - h * 0.47), (0, 0, 0, 70))


def tower(c, x, w, top, base, body, edge, lit=0.35, cols=8, rows=30, warm="#ffd27a", dark="#0e1628", seed=1, crown=None, glow=True):
    c.rect_grad((x, top, x + w, base), [(0, body), (1, mix(body, "#000000", 0.45))])
    c.rect((x, top, x + w * 0.06, base), edge, opacity=0.6)
    c.windows((x + w * 0.08, top + 10, x + w * 0.96, base - 6), cols, rows, lit=lit, warm=warm, dark=dark, pad=0.35, seed=seed, glow=glow)
    if crown:
        c.poly([(x, top), (x + w / 2, top - crown), (x + w, top)], mix(body, "#ffffff", 0.15))


def skyline(c, base, n, hmin, hmax, colors, lit=0.3, seed=1, warm="#ffd27a", xr=(0, 1200), wmin=40, wmax=90, glow=False):
    r = random.Random(seed)
    x = xr[0] - 20
    while x < xr[1]:
        w = r.uniform(wmin, wmax)
        h = r.uniform(hmin, hmax)
        col = r.choice(colors)
        tower(c, x, w, base - h, base, col, mix(col, "#ffffff", 0.1), lit=lit, cols=max(2, int(w / 14)), rows=max(3, int(h / 16)),
              warm=warm, dark=mix(col, "#000000", 0.3), seed=r.randint(0, 9999), glow=glow)
        x += w + r.uniform(-6, 10)


def yacht(c, x, y, s=1.0, hull="#f5f7fa", accent="#1d4ed8"):
    c.poly([(x, y), (x + 180 * s, y), (x + 215 * s, y - 22 * s), (x - 10 * s, y - 22 * s)], hull)
    c.poly([(x + 20 * s, y - 22 * s), (x + 165 * s, y - 22 * s), (x + 140 * s, y - 42 * s), (x + 45 * s, y - 42 * s)], mix(hull, "#c8d0dc", 0.4))
    c.rect((x + 50 * s, y - 38 * s, x + 135 * s, y - 31 * s), "#1f2a44")
    c.poly([(x + 60 * s, y - 42 * s), (x + 125 * s, y - 42 * s), (x + 112 * s, y - 56 * s), (x + 75 * s, y - 56 * s)], hull)
    c.line([(x - 5 * s, y - 10 * s), (x + 205 * s, y - 10 * s)], accent, 2.2 * s)
    c.line([(x - 30 * s, y + 3), (x + 250 * s, y + 3)], "#ffffff", 2, blur=1.2, opacity=0.6)


# ---------------------------------------------------------------- scenes

def island():
    c = Canvas(seed=7)
    horizon = 330
    c.vgrad([(0, "#2a7de1"), (0.55, "#7cc4f5"), (1, "#d9f1ff")], (0, 0, 1200, horizon))
    c.glow(930, 120, 420, "#fff6d5", 0.9)
    c.glow(930, 120, 90, "#ffffff", 1.0, power=1.4)
    c.clouds([(220, 120, 260, 60), (520, 70, 180, 40), (760, 200, 300, 55), (1100, 260, 220, 45)], "#ffffff", 0.9, blur=5)
    c.hills(horizon + 2, 26, "#5d8fb4", seed=3, opacity=0.55, blur=1.5)  # distant islands
    # ocean: deep blue to turquoise near the island
    c.water(horizon, [(0, "#1d6fb8"), (0.35, "#1683b8"), (1, "#0a5a8c")], seed=11, density=120, highlight_x=930)
    # lagoon: soft turquoise shallows fading into the deep ocean
    cx, cy = 600, 520
    for k, (rx, ry, col, op, bl) in enumerate([(520, 190, "#1aa6c4", 0.55, 40), (440, 150, "#2fcbd1", 0.75, 26), (380, 125, "#63e3d8", 0.85, 16), (345, 105, "#9ff0e2", 0.7, 10)]):
        c.ellipse((cx - rx, cy - ry + 10, cx + rx, cy + ry + 10), col, blur=bl, opacity=op)
    # sand island (organic outline)
    rough = [(cx - 330, cy + 20), (cx - 300, cy - 40), (cx - 200, cy - 80), (cx - 40, cy - 96), (cx + 140, cy - 88), (cx + 290, cy - 52),
             (cx + 345, cy + 5), (cx + 300, cy + 55), (cx + 120, cy + 82), (cx - 120, cy + 84), (cx - 280, cy + 60)]
    sand = smooth(rough, 4)
    c.poly([(x, y + 12) for x, y in sand], "#0e7f8f", blur=8, opacity=0.5)   # underwater shadow
    c.poly_grad(sand, [(0, "#fff3d6"), (0.6, "#f0d6a2"), (1, "#d9b77e")])
    c.line(sand + [sand[0]], "#ffffff", 5, blur=3, opacity=0.85)            # surf
    c.line([(x * 1.0, y + 8) for x, y in sand[len(sand) // 2 - 30 : len(sand) // 2 + 30]], "#ffffff", 2.5, blur=2, opacity=0.5)
    # jungle on the island
    for i, (bx, by, bw, bh) in enumerate([(cx - 210, cy - 40, 120, 70), (cx - 90, cy - 70, 160, 80), (cx + 80, cy - 60, 150, 70), (cx + 210, cy - 20, 110, 55), (cx - 260, cy + 5, 80, 45)]):
        c.bush(bx, by, bw, bh, color="#1d6b45", highlight="#4fb06b", seed=10 + i)
    # villa with glass and infinity pool
    vx, vy = cx - 60, cy + 30
    c.rect((vx - 150, vy - 8, vx + 200, vy + 30), "#d9cbb0")  # terrace
    c.rect_grad((vx - 130, vy - 4, vx + 30, vy + 22), [(0, "#7ff6f0"), (1, "#18b8c9")], radius=4)  # pool
    c.line([(vx - 120, vy + 2), (vx + 10, vy + 2)], "#ffffff", 1.5, opacity=0.7)
    modern_house(c, vx + 40, vy + 2, 140, 95, wall="#fbf8f2", glass="#2b5f86", warm="#fff4c2", lit=0.15, seed=4)
    # overwater deck
    c.rect((vx + 200, vy + 12, vx + 330, vy + 20), "#a87b4f")
    for px in range(int(vx + 205), int(vx + 330), 22):
        c.rect((px, vy + 20, px + 4, vy + 40), "#7a5634")
    # palms (front ones bigger)
    for i, (px, py, ph, lean) in enumerate([(cx - 290, cy + 40, 150, -0.35), (cx - 240, cy + 50, 120, -0.2), (cx + 250, cy + 30, 170, 0.32),
                                            (cx + 300, cy + 45, 130, 0.45), (cx - 20, cy - 40, 110, 0.1), (cx + 150, cy - 30, 125, -0.15)]):
        c.palm(px, py, ph, lean=lean, color="#0f5a3c", trunk="#8a6239", seed=20 + i)
    yacht(c, 860, 640, 0.9)
    c.birds([(330, 210, 1.2), (365, 190, 0.9), (400, 222, 1.0), (760, 120, 0.8)])
    c.line([(0, horizon), (1200, horizon)], "#ffffff", 1.2, blur=1, opacity=0.5)
    c.vignette(0.25)
    c.grain(3)
    return c


def main():
    from realty_scenes import SCENES as OTHERS
    scenes = {**OTHERS, "island": island}
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(scenes)
    for n in names:
        scenes[n]().save(OUT / f"{n}.webp")
        print("painted", n)


if __name__ == "__main__":
    main()
