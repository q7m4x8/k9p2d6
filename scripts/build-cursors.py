"""Build transparent 32px PNG fallbacks for the SVG drawing cursors."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'cursors'
SCALE = 4


def cursor(name, polygons, lines=()):
    image = Image.new('RGBA', (32 * SCALE, 32 * SCALE))
    draw = ImageDraw.Draw(image)
    # Scale the pen around its (3,3) hotspot so the drawing tip stays aligned.
    factor = .85 if name == 'pen' else 1
    def point(x, y):
        return (round((3 + (x - 3) * factor) * SCALE), round((3 + (y - 3) * factor) * SCALE))
    for points, fill, outline, width in polygons:
        points = [point(x, y) for x, y in points]
        draw.polygon(points, fill=fill)
        if outline:
            draw.line(points + points[:1], fill=outline, width=round(width * factor * SCALE), joint='curve')
    for points, fill, width in lines:
        draw.line([point(x, y) for x, y in points], fill=fill, width=round(width * factor * SCALE))
    image.resize((32, 32), Image.Resampling.LANCZOS).save(OUT / f'{name}.png')


pen = [(3, 3), (10, 5), (25, 20), (26.5, 23), (25, 26), (22.5, 26.5), (20, 25), (5, 10)]
cursor('pen', [
    (pen, '#ffffff', '#ffffff', 3),
    ([(3, 3), (10, 5), (5, 10)], '#c9cfd4', '#39434d', 1),
    ([(3, 3), (6.3, 4), (4, 6.3)], '#27333e', None, 0),
    (pen[1:] + [(10, 5)], '#56616c', '#39434d', 1),
], [([(10, 8), (22, 20)], '#b9c1c7', 1.3)])

eraser = [(4, 18), (17, 5), (19, 4), (21, 5), (28, 12), (29, 14), (28, 16), (16, 28), (11, 28), (4, 21), (3.5, 19.5)]
cursor('eraser', [
    (eraser, '#ffffff', '#ffffff', 3),
    (eraser, '#7e8d9c', '#344454', 1.4),
    ([(4, 18), (11, 11), (24, 24), (16, 28), (11, 28), (4, 21), (3.5, 19.5)], '#edf1f4', '#344454', 1.4),
])

for name in ('pen', 'eraser'):
    with Image.open(OUT / f'{name}.png') as image:
        assert image.size == (32, 32) and image.mode == 'RGBA'
        assert image.getpixel((31, 0))[3] == 0
print('Built and verified two transparent 32px cursor fallbacks.')
