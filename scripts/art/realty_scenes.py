"""Real-estate scenes other than the private island (see realty.py)."""
import math

from paint import Canvas, mix, smooth
from realty import modern_house, skyline, tower


def street(c, y, color="#1a1f2b", line="#3a4256"):
    c.rect((0, y, 1200, 750), color)
    c.rect((0, y, 1200, y + 10), mix(color, "#ffffff", 0.08))
    for x in range(0, 1200, 90):
        c.rect((x + 20, y + 52, x + 70, y + 57), line)


def lamp(c, x, y, h=150, warm="#ffd27a"):
    c.rect((x - 2.5, y - h, x + 2.5, y), "#2b3142")
    c.line([(x, y - h), (x + 22, y - h - 8), (x + 34, y - h - 2)], "#2b3142", 4)
    c.ellipse((x + 26, y - h - 4, x + 42, y - h + 6), warm)
    c.glow(x + 34, y - h + 10, 120, warm, 0.45)
    c.ellipse((x - 40, y - 6, x + 110, y + 14), warm, blur=10, opacity=0.25)


def studio():
    c = Canvas(seed=11)
    c.vgrad([(0, "#1b1440"), (0.5, "#5b2a6e"), (0.82, "#f08a5d"), (1, "#ffc38a")], (0, 0, 1200, 600))
    c.glow(600, 600, 520, "#ffb36b", 0.55)
    skyline(c, 600, 0, 160, 300, ["#2a2147", "#33275a", "#241c3d"], lit=0.25, seed=4, warm="#ffcf7a")
    x0, x1, top, base = 360, 840, 170, 600   # cozy brick building
    c.rect_grad((x0, top, x1, base), [(0, "#9a4f3c"), (1, "#5a2a22")])
    c.rect((x0 - 12, top - 14, x1 + 12, top), "#3b1c17")
    c.windows((x0 + 30, top + 30, x1 - 30, base - 110), 6, 6, lit=0.55, warm="#ffd27a", dark="#2a1a24", pad=0.4, seed=8, radius=3)
    for j in range(6):
        yy = top + 30 + (j + 1) * (base - 140 - top) / 6 - 6
        c.rect((x0 + 20, yy, x1 - 20, yy + 6), "#2c1612")
    c.rect((560, base - 95, 640, base), "#2a1a24")
    c.rect((568, base - 88, 632, base), "#ffd27a", opacity=0.85)
    c.glow(600, base - 40, 140, "#ffd27a", 0.45)
    c.rect((x0 + 205, top + 160, x0 + 275, top + 210), "#fff0b8")   # your studio: the brightest window
    c.glow(x0 + 240, top + 185, 110, "#ffe29a", 0.6)
    street(c, base)
    lamp(c, 250, base)
    lamp(c, 980, base)
    for i, bx in enumerate([120, 300, 900, 1080]):
        c.bush(bx, base - 4, 90, 40, color="#1d3a2c", highlight="#2f5a40", seed=40 + i)
    c.vignette(0.35)
    c.grain(3)
    return c


def apartment():
    c = Canvas(seed=12)
    c.vgrad([(0, "#3a6fd8"), (0.6, "#9cc8f2"), (1, "#ffe4b8")], (0, 0, 1200, 640))
    c.glow(260, 520, 420, "#ffd59a", 0.6)
    c.clouds([(800, 120, 260, 55), (420, 90, 200, 40)], "#ffffff", 0.8, blur=5, shade="#d6dfee")
    skyline(c, 640, 0, 120, 260, ["#7c93b8", "#8aa1c4", "#6f86ab"], lit=0.0, seed=6, wmin=50, wmax=110)
    x0, x1, top, base = 430, 770, 70, 640   # residential tower with glass balconies
    c.rect_grad((x0, top, x1, base), [(0, "#f2efe9"), (1, "#c9c3b8")])
    c.rect((x0, top, x0 + 18, base), "#b7b0a5")
    floors = 14
    for j in range(floors):
        yy = top + 20 + j * (base - top - 40) / floors
        c.rect((x0 + 28, yy, x1 - 28, yy + 26), "#3c5a7d")
        c.windows((x0 + 28, yy, x1 - 28, yy + 26), 5, 1, lit=0.12, warm="#ffe0a0", dark="#4d7099", pad=0.12, seed=100 + j, glow=False)
        c.rect((x0 + 20, yy + 26, x1 - 20, yy + 31), "#ffffff", opacity=0.9)
        c.rect((x0 + 20, yy + 18, x1 - 20, yy + 26), (180, 220, 255, 90))
    c.rect((x0 - 10, top - 12, x1 + 10, top), "#d8d2c8")
    c.vgrad([(0, "#4f9a52"), (1, "#2c5e30")], (0, base, 1200, 750))
    for i, bx in enumerate(range(40, 1200, 130)):
        c.bush(bx, base + 30 + (i % 2) * 20, 120, 70, color="#2d6a35", highlight="#62b25e", seed=60 + i)
    c.vignette(0.25)
    c.grain(3)
    return c


def townhouse():
    c = Canvas(seed=13)
    c.vgrad([(0, "#4aa3e8"), (1, "#cfeaff")], (0, 0, 1200, 560))
    c.glow(1000, 110, 300, "#fff7d6", 0.7)
    c.clouds([(250, 120, 280, 60), (700, 80, 200, 45)], "#ffffff", 0.9, blur=5)
    c.hills(560, 70, "#7cb87a", seed=2, step=60)
    colors = [("#e9dccb", "#8c3b2e"), ("#cfd9e6", "#2f4a6d"), ("#efe1b8", "#6b4f2a"), ("#e6d2d2", "#5b2f3f")]
    base = 600
    for i, (wall, roof) in enumerate(colors):
        x = 120 + i * 245
        c.rect_grad((x, 300, x + 230, base), [(0, wall), (1, mix(wall, "#000000", 0.2))])
        c.poly([(x - 14, 304), (x + 115, 210), (x + 244, 304)], roof)
        c.rect((x + 150, 200, x + 180, 260), mix(roof, "#000000", 0.2))
        c.windows((x + 25, 330, x + 205, 440), 3, 2, lit=0.2, warm="#fff1c4", dark="#2b4560", pad=0.3, seed=i, glow=False)
        c.rect((x + 90, 480, x + 140, base), mix(roof, "#000000", 0.1))
        c.ellipse((x + 128, 535, x + 134, 541), "#ffd27a")
        c.rect((x + 70, base - 6, x + 160, base), "#cfc6b5")
    c.vgrad([(0, "#5cab55"), (1, "#2f6c30")], (0, base, 1200, 750))
    c.rect((0, base + 70, 1200, base + 92), "#bfb6a4")
    for i, bx in enumerate([60, 365, 610, 860, 1140]):
        c.bush(bx, base + 20, 90, 50, color="#2c6a33", highlight="#69b863", seed=70 + i)
    c.vignette(0.22)
    c.grain(3)
    return c


def villa():
    c = Canvas(seed=14)
    horizon = 360
    c.vgrad([(0, "#2b1b5e"), (0.45, "#c2477a"), (0.8, "#ff9a62"), (1, "#ffd18a")], (0, 0, 1200, horizon))
    c.glow(840, horizon - 10, 420, "#ffcf7a", 0.7)
    c.ellipse((790, horizon - 60, 890, horizon + 40), "#ffe7a8")
    c.water(horizon, [(0, "#d86f6a"), (0.4, "#5a3c7a"), (1, "#1d1d46")], shimmer="#ffd59a", seed=3, density=120, highlight_x=840)
    c.hills(horizon + 1, 40, "#3a2552", seed=9, step=70, opacity=0.9)
    c.poly([(0, 470), (1200, 455), (1200, 750), (0, 750)], "#2a2236")   # cliff terrace
    c.vgrad([(0, "#e8d9c4"), (1, "#b9a68c")], (0, 470, 1200, 500))
    modern_house(c, 520, 470, 380, 210, wall="#f6f1e8", glass="#25305a", warm="#ffd27a", lit=0.75, seed=14)
    c.rect_grad((90, 478, 500, 520), [(0, "#7ff6f0"), (1, "#14a7c0")], radius=3)   # infinity pool
    c.glow(300, 500, 240, "#7ff6f0", 0.35)
    c.line([(100, 486), (490, 486)], "#ffffff", 1.5, opacity=0.7)
    for i, (px, h, lean) in enumerate([(70, 230, 0.25), (1050, 260, -0.3), (1130, 200, -0.2), (470, 180, 0.15)]):
        c.palm(px, 480, h, lean=lean, color="#1a1030", trunk="#2c1d33", seed=80 + i)
    c.vgrad([(0, "#2b2438"), (1, "#120f1b")], (0, 520, 1200, 750))
    c.reflect(470 - 220, 750, 520, opacity=0.18)
    c.vignette(0.35)
    c.grain(3)
    return c


def penthouse():
    c = Canvas(seed=15)
    c.vgrad([(0, "#05081a"), (0.6, "#101a44"), (1, "#24306a")], (0, 0, 1200, 750))
    c.stars(140, 380)
    c.glow(980, 120, 160, "#dfe8ff", 0.6)
    c.ellipse((945, 85, 1015, 155), "#f4f6ff")
    skyline(c, 760, 0, 120, 380, ["#111a3a", "#16224a", "#0d1530"], lit=0.45, seed=21, warm="#ffcf7a", wmin=40, wmax=80, glow=True)
    x0, x1 = 300, 900
    c.rect_grad((x0, 300, x1, 750), [(0, "#1d2c5c"), (1, "#0a1230")])
    c.windows((x0 + 20, 420, x1 - 20, 750), 12, 7, lit=0.4, warm="#ffd27a", dark="#13204a", pad=0.25, seed=5)
    c.rect((x0 + 80, 250, x1 - 120, 360), "#ffcf8a", opacity=0.9)   # the penthouse
    c.windows((x0 + 80, 250, x1 - 120, 360), 8, 1, lit=1.0, warm="#ffd99a", dark="#1d2c5c", pad=0.06, seed=9)
    c.glow(560, 300, 380, "#ffcf7a", 0.35)
    c.rect((x0 + 60, 238, x1 - 100, 252), "#0d1530")
    c.rect((x0 + 20, 360, x1 - 20, 380), "#1a2550")   # terrace with a glowing pool
    c.rect_grad((x1 - 260, 362, x1 - 40, 378), [(0, "#7ff6f0"), (1, "#1fa9d6")])
    c.glow(x1 - 150, 370, 200, "#5ff0ff", 0.35)
    c.line([(x0 + 20, 344), (x1 - 20, 344)], "#9fb6ff", 2, opacity=0.6)
    for xx in range(x0 + 30, x1 - 20, 40):
        c.line([(xx, 344), (xx, 360)], "#9fb6ff", 1.2, opacity=0.5)
    c.vignette(0.4)
    c.grain(3)
    return c


def mansion():
    c = Canvas(seed=16)
    c.vgrad([(0, "#0e1230"), (0.55, "#3b2a6a"), (1, "#8a5aa0")], (0, 0, 1200, 560))
    c.stars(80, 300, seed=9)
    c.glow(600, 520, 600, "#c58aff", 0.25)
    base = 560
    for (a, b, top) in [(170, 430, 330), (770, 1030, 330), (380, 820, 230)]:
        c.rect_grad((a, top, b, base), [(0, "#efe6d6"), (1, "#bfae93")])
        c.rect((a - 10, top - 14, b + 10, top), "#d8ccb6")
    c.poly([(360, 232), (600, 130), (840, 232)], "#d9cdb8")
    c.poly([(400, 228), (600, 145), (800, 228)], "#c8b99f")
    for xx in range(410, 800, 60):
        c.rect_grad((xx, 240, xx + 18, base - 10), [(0, "#fffaf0"), (1, "#cdbfa6")])
    c.windows((190, 360, 410, 520), 4, 2, lit=0.9, warm="#ffd88a", dark="#2b2440", pad=0.35, seed=3)
    c.windows((790, 360, 1010, 520), 4, 2, lit=0.9, warm="#ffd88a", dark="#2b2440", pad=0.35, seed=4)
    c.windows((440, 260, 760, 520), 5, 3, lit=0.8, warm="#ffe2a0", dark="#2b2440", pad=0.45, seed=5)
    c.rect((560, 440, 640, base), "#3a2a1c")
    c.rect((568, 448, 632, base), "#ffcf7a", opacity=0.9)
    c.glow(600, 500, 260, "#ffcf7a", 0.4)
    c.vgrad([(0, "#24402c"), (1, "#0f1d14")], (0, base, 1200, 750))
    c.poly([(560, base), (640, base), (760, 750), (440, 750)], "#c9b99b")
    c.ellipse((520, 620, 680, 668), "#9fd8ff", opacity=0.9)
    c.ellipse((540, 628, 660, 660), "#4fb4e6")
    c.line([(600, 640), (600, 590)], "#cfeaff", 4, blur=1)
    c.glow(600, 630, 120, "#8fd8ff", 0.4)
    for i, bx in enumerate([80, 230, 380, 820, 970, 1120]):
        c.bush(bx, base + 20, 110, 46, color="#16331f", highlight="#2f5f3b", seed=90 + i)
    lamp(c, 420, 700, 130)
    lamp(c, 760, 700, 130)
    c.vignette(0.35)
    c.grain(3)
    return c


def skyscraper():
    c = Canvas(seed=17)
    c.vgrad([(0, "#030616"), (0.5, "#0b1640"), (1, "#1b2b6b")], (0, 0, 1200, 750))
    c.stars(90, 300, seed=5)
    for x in (430, 770):   # searchlights
        c.poly([(x, 740), (x - 40 + (x - 600) * 0.6, 0), (x + 40 + (x - 600) * 0.6, 0)], (110, 170, 255, 60), blur=8)
    skyline(c, 750, 0, 140, 330, ["#0d1736", "#111d44", "#0a1230"], lit=0.4, seed=33, warm="#ffcf7a", wmin=50, wmax=95, glow=True)
    c.glow(600, 300, 520, "#2f7bff", 0.35)
    tower(c, 520, 160, 90, 750, "#14306f", "#4f8bff", lit=0.55, cols=8, rows=40, warm="#bfe0ff", dark="#0c1d48", seed=2, crown=110)
    c.line([(520, 90), (600, -20), (680, 90)], "#7fb0ff", 2, blur=1, opacity=0.9)
    c.vignette(0.4)
    c.grain(3)
    return c


def resort_island():
    c = Canvas(seed=18)
    horizon = 250
    c.vgrad([(0, "#3a2a7a"), (0.5, "#e0628a"), (1, "#ffc188")], (0, 0, 1200, horizon))
    c.glow(300, horizon, 380, "#ffd59a", 0.7)
    c.water(horizon, [(0, "#e48aa0"), (0.25, "#2bb4c8"), (1, "#0b6f9a")], shimmer="#ffe7c4", seed=8, density=140, highlight_x=300)
    for k, (cx, cy, rx, ry, palms) in enumerate([(220, 420, 170, 55, 3), (640, 330, 120, 36, 2), (1000, 470, 210, 65, 4)]):
        for rr, col, op, bl in [(1.7, "#2fcbd1", 0.55, 26), (1.35, "#6fe6da", 0.8, 14)]:
            c.ellipse((cx - rx * rr, cy - ry * rr * 0.8, cx + rx * rr, cy + ry * rr), col, blur=bl, opacity=op)
        shape = smooth([(cx - rx, cy + 5), (cx - rx * 0.6, cy - ry), (cx + rx * 0.4, cy - ry * 0.9), (cx + rx, cy), (cx + rx * 0.5, cy + ry * 0.8), (cx - rx * 0.5, cy + ry * 0.8)], 4)
        c.poly_grad(shape, [(0, "#fff1cf"), (1, "#dcb980")])
        c.bush(cx, cy - ry * 0.3, rx * 1.1, ry * 1.1, color="#1e6b47", highlight="#4fb06b", seed=200 + k)
        for p in range(palms):
            c.palm(cx - rx * 0.5 + p * rx * 0.45, cy + 4, 70 + 25 * (p % 2), lean=0.25 - p * 0.15, color="#0f5a3c", trunk="#8a6239", seed=210 + k * 10 + p, scale=0.8)
    pts = [(300 + i * 70, 560 + 40 * math.sin(i / 2.2)) for i in range(10)]   # overwater bungalows
    c.line([(230, 440)] + pts, "#a87b4f", 8)
    for bx, by in pts[1:]:
        c.rect((bx - 26, by - 8, bx + 26, by + 4), "#8a5f38")
        for px in (bx - 20, bx + 16):
            c.rect((px, by + 4, px + 4, by + 24), "#6b4a2b")
        c.poly([(bx - 32, by - 8), (bx, by - 40), (bx + 32, by - 8)], "#d6b073")
        c.poly([(bx - 32, by - 8), (bx, by - 40), (bx - 4, by - 8)], "#b98e52")
        c.rect((bx - 8, by - 4, bx + 8, by + 2), "#ffd27a")
    c.birds([(520, 120, 1.0), (560, 100, 0.8), (600, 130, 0.9)], "#2a1840")
    c.vignette(0.3)
    c.grain(3)
    return c


def mega_tower():
    c = Canvas(seed=19)
    c.vgrad([(0, "#0b1a4a"), (0.45, "#3d5bb0"), (0.75, "#ff9f7a"), (1, "#ffd9a8")], (0, 0, 1200, 750))
    c.glow(250, 560, 520, "#ffcf8a", 0.7)
    c.stars(40, 160, seed=12)
    c.clouds([(120, 600, 360, 90), (450, 640, 420, 100), (820, 610, 420, 95), (1120, 650, 360, 90)], "#fff2e6", 0.95, blur=8, shade="#e8b8b0")
    cx = 680   # 1 km tower piercing the clouds
    body = [(cx - 95, 750), (cx - 70, 420), (cx - 45, 220), (cx - 18, 80), (cx - 4, 10), (cx + 4, 10), (cx + 18, 80), (cx + 45, 220), (cx + 70, 420), (cx + 95, 750)]
    c.poly_grad(body, [(0, "#d7e6ff"), (0.4, "#7f9bd6"), (1, "#3b4f86")])
    c.poly([(cx, 10), (cx + 4, 10), (cx + 18, 80), (cx + 45, 220), (cx + 70, 420), (cx + 95, 750), (cx + 10, 750)], (20, 30, 70, 90))
    for k in range(18):
        yy = 90 + k * 36
        half = 18 + (yy - 80) * 0.11
        c.line([(cx - half, yy), (cx + half, yy)], "#ffffff", 1.2, opacity=0.35)
    c.line([(cx, -10), (cx, 12)], "#e8f0ff", 2)
    c.glow(cx, 4, 40, "#ff4d61", 0.6)
    c.glow(cx - 40, 260, 260, "#ffffff", 0.15)
    c.clouds([(560, 700, 520, 110), (980, 720, 420, 100)], "#fff6ee", 0.92, blur=9, shade="#e2b0a8")
    c.line([(170, 240), (210, 232)], "#ffffff", 1.5, opacity=0.8)   # plane
    c.line([(60, 262), (170, 240)], "#ffffff", 1, blur=1, opacity=0.35)
    c.vignette(0.3)
    c.grain(3)
    return c


SCENES = {"studio": studio, "apartment": apartment, "townhouse": townhouse, "villa": villa, "penthouse": penthouse,
          "mansion": mansion, "skyscraper": skyscraper, "resort_island": resort_island, "mega_tower": mega_tower}
