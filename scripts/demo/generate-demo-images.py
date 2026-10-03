"""Generates the demo catalogue's product and lookbook images.

Deterministic, dependency: Pillow. Each image is a flat garment silhouette
on a warm studio background, visibly marked "DEMO" so it can never be
mistaken for real product photography. Output: apps/storefront/public/demo/.
Run: python3 scripts/demo/generate-demo-images.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = Path(__file__).resolve().parents[2] / "apps/storefront/public/demo"
W, H = 800, 1000

COLOURS = {
    "ivory": (236, 226, 208), "maroon": (110, 28, 40), "navy": (30, 42, 74),
    "olive": (92, 98, 56), "sand": (198, 170, 128), "rust": (164, 76, 44),
    "teal": (32, 92, 96), "rose": (196, 122, 132), "black": (32, 30, 30),
    "mustard": (196, 150, 44), "sage": (148, 164, 132), "indigo": (52, 54, 110),
}

def silhouette(kind):
    """Polygon points for each garment type, on an 800x1000 canvas."""
    if kind in ("kurta", "bandhgala"):
        long = 900 if kind == "kurta" else 720
        return [[(330, 170), (470, 170), (560, 210), (650, 420), (590, 440), (545, 330), (560, long), (240, long), (255, 330), (210, 440), (150, 420), (240, 210)]]
    if kind == "shirt":
        return [[(320, 190), (480, 190), (580, 230), (660, 470), (600, 490), (550, 360), (555, 760), (245, 760), (250, 360), (200, 490), (140, 470), (220, 230)]]
    if kind == "trousers":
        return [[(270, 180), (530, 180), (560, 880), (430, 880), (400, 360), (370, 880), (240, 880)]]
    if kind == "saree":
        return [[(360, 150), (450, 150), (520, 260), (600, 880), (200, 880), (300, 260)], [(450, 150), (640, 420), (600, 460), (470, 260)]]
    if kind == "coord":
        return [[(310, 170), (490, 170), (570, 220), (620, 380), (560, 400), (530, 300), (535, 480), (265, 480), (270, 300), (240, 400), (180, 380), (230, 220)],
                [(280, 500), (520, 500), (545, 880), (420, 880), (400, 640), (380, 880), (255, 880)]]
    if kind == "dress":
        return [[(340, 170), (460, 170), (520, 240), (500, 420), (620, 880), (180, 880), (300, 420), (280, 240)]]
    raise ValueError(kind)

def font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()

def shade(rgb, k):
    return tuple(max(0, min(255, int(c * k))) for c in rgb)

def product_image(kind, colour, name):
    base = COLOURS[colour]
    img = Image.new("RGB", (W, H), (244, 238, 230))
    d = ImageDraw.Draw(img)
    for y in range(H):  # soft studio gradient
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(246 - 18 * t), int(240 - 20 * t), int(232 - 22 * t)))
    d.ellipse([(200, 880), (600, 940)], fill=(214, 204, 190))  # floor shadow
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for poly in silhouette(kind):
        ld.polygon(poly, fill=base + (255,))
    layer = layer.filter(ImageFilter.GaussianBlur(0.6))
    img.paste(layer, (0, 0), layer)
    d = ImageDraw.Draw(img)
    for poly in silhouette(kind):  # subtle seam/edge detail
        d.line(poly + [poly[0]], fill=shade(base, 0.72), width=4)
    if kind in ("kurta", "bandhgala", "shirt", "coord"):
        d.line([(400, 175), (400, 470 if kind != "coord" else 470)], fill=shade(base, 0.6), width=4)
        for y in range(230, 460, 55):
            d.ellipse([(394, y), (406, y + 12)], fill=shade(base, 1.4) if colour in ("navy", "black", "maroon", "indigo", "teal") else shade(base, 0.5))
    d.text((40, 40), "VANYA", font=font(30), fill=(60, 52, 44))
    d.text((40, 945), f"DEMO IMAGE · {name}", font=font(22), fill=(110, 100, 90))
    return img

def lookbook(title, colours):
    img = Image.new("RGB", (W, H), (30, 26, 23))
    d = ImageDraw.Draw(img)
    for i, colour in enumerate(colours):
        x0 = 60 + i * 240
        d.rounded_rectangle([(x0, 160), (x0 + 200, 820)], radius=28, fill=COLOURS[colour])
    d.text((60, 60), "VANYA · WATCH & SHOP", font=font(28), fill=(244, 238, 230))
    d.text((60, 860), title, font=font(40), fill=(244, 238, 230))
    d.text((60, 930), "DEMO LOOKBOOK IMAGE", font=font(22), fill=(190, 180, 170))
    return img

PRODUCTS = {
    "festive-silk-kurta": ("kurta", ["ivory", "maroon"]),
    "heritage-bandhgala": ("bandhgala", ["navy", "black"]),
    "linen-camp-shirt": ("shirt", ["sand", "olive"]),
    "silk-blend-shirt": ("shirt", ["teal", "ivory"]),
    "pleated-trousers": ("trousers", ["sand", "black"]),
    "everyday-cotton-kurta": ("kurta", ["sage", "indigo"]),
    "chanderi-saree": ("saree", ["rose", "mustard"]),
    "banarasi-silk-saree": ("saree", ["maroon", "teal"]),
    "linen-coord-set": ("coord", ["rust", "ivory"]),
    "festive-anarkali-dress": ("dress", ["indigo", "rose"]),
    "midi-wrap-dress": ("dress", ["olive", "black"]),
    "embroidered-kurta-set": ("coord", ["mustard", "sage"]),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, (kind, colours) in PRODUCTS.items():
        for colour in colours:
            product_image(kind, colour, slug.replace("-", " ").upper()).save(OUT / f"{slug}-{colour}.jpg", quality=82, optimize=True)
    lookbook("The Festive Edit", ["maroon", "ivory", "mustard"]).save(OUT / "lookbook-festive.jpg", quality=82, optimize=True)
    lookbook("Linen Season", ["sand", "olive", "ivory"]).save(OUT / "lookbook-linen.jpg", quality=82, optimize=True)
    lookbook("Wedding Guest", ["teal", "rose", "navy"]).save(OUT / "lookbook-wedding.jpg", quality=82, optimize=True)
    print("wrote", len(list(OUT.glob("*.jpg"))), "images to", OUT)
