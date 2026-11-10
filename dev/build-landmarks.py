# The painted landmarks (made in Gemini, cut from magenta sheets) put into a city's private map file
# as `paint`: { <place id or "centre">: { src: data:image/webp, w, h } }. Each sprite stands on its
# own hex, so it's drawn instead of the tile's ground; it's scaled so its hex (dev/hexbase.py) is WIDTH
# pixels across, and `b` says so.
# The map files are private (the sync repo's map/ folder), so nothing here names a place.
#
#   python dev/build-landmarks.py <marks dir> <map.json> <city>
#
# <marks dir> holds <city>-<id>.png, and <city>-<id>.winter.png for the same place under snow (drawn from
# first snow to the thaw), which goes in `paintWinter`. Run it again after dev/build-map.mjs, which writes the file afresh.
import sys, os, io, json, base64
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from defringe import defringe
from hexbase import base_width

WIDTH = 128
marks, path, city = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(path, encoding='utf-8'))
ids = {p['id'] for p in m['places']} | {'centre'}
def sprite(f):
    im = defringe(Image.open(os.path.join(marks, f)), inner=True)
    k = WIDTH / base_width(im)
    im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=78, method=6)
    # `b`: how wide its hex is, in its pixels (dev/hexbase.py); a roof or tree may spill past it.
    return {'src': 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode(), 'w': im.size[0], 'h': im.size[1], 'b': WIDTH}

paint, winter = {}, {}
files = sorted(f for f in os.listdir(marks) if f.startswith(city + '-') and f.endswith('.png'))
for f in files:
    if f.endswith('.winter.png'): continue
    pid = f[len(city) + 1:-4]
    if pid not in ids:
        print('not a place on this map:', pid); continue
    paint[pid] = sprite(f)
    if f[:-4] + '.winter.png' in files: winter[pid] = sprite(f[:-4] + '.winter.png')
m['paint'] = paint
m['paintWinter'] = winter
text = json.dumps(m, ensure_ascii=False, separators=(',', ':'))
open(path, 'w', encoding='utf-8', newline='\n').write(text)
size = sum(len(v['src']) for v in [*paint.values(), *winter.values()])
print(f'{city}: {len(paint)} landmarks ({len(winter)} with winter), {size // 1024} KB of paint, file {len(text) // 1024} KB; missing: {sorted(ids - set(paint))}')
