"""Package the original SVG render as a 32-bit multi-resolution Windows icon.
Run node scripts/render-icon.mjs, then this script with Pillow installed.
The artwork is assets/icon.svg; application users do not need these tools.
"""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent / 'assets'
image = Image.open(root / 'icon-render.png').convert('RGBA')
image.resize((512, 512), Image.Resampling.LANCZOS).save(root / 'icon_512.png')
image.resize((256, 256), Image.Resampling.LANCZOS).save(root / 'icon.png')
sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
image.save(root / 'icon.ico', sizes=[(size, size) for size in sizes])
with Image.open(root / 'icon.ico') as icon:
    assert icon.ico.sizes() == {(size, size) for size in sizes}
    for size in sizes:
        frame = icon.ico.getimage((size, size)).convert('RGBA')
        assert frame.getextrema()[3] == (0, 255), (size, 'Missing transparency')
print('Windows icon verified: 10 RGBA sizes, 16–256 px, transparent corners.')
