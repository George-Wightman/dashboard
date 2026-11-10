# The painted landmarks (made in Gemini, cut from magenta sheets) put into a city's private map file
# as `paint`: { <place id or "centre">: { src: data:image/webp, w, h } }. Each sprite stands on its
# own hex, so it's drawn instead of the tile's ground; it's scaled so the hex is WIDTH pixels across.
# The map files are private (the sync repo's map/ folder), so nothing here names a place.
#
#   python dev/build-landmarks.py <marks dir> <map.json> <city>
#
# <marks dir> holds <city>-<id>.png. Run it again after dev/build-map.mjs, which writes the file afresh.
import sys, os, io, json, base64
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from defringe import defringe

WIDTH = 128
marks, path, city = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(path, encoding='utf-8'))
ids = {p['id'] for p in m['places']} | {'centre'}
paint = {}
for f in sorted(os.listdir(marks)):
    if not f.startswith(city + '-') or not f.endswith('.png'): continue
    pid = f[len(city) + 1:-4]
    if pid not in ids:
        print('not a place on this map:', pid); continue
    im = defringe(Image.open(os.path.join(marks, f)), inner=True)
    im = im.resize((WIDTH, round(im.size[1] * WIDTH / im.size[0])), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=78, method=6)
    paint[pid] = {'src': 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode(), 'w': im.size[0], 'h': im.size[1]}
m['paint'] = paint
text = json.dumps(m, ensure_ascii=False, separators=(',', ':'))
open(path, 'w', encoding='utf-8', newline='\n').write(text)
size = sum(len(v['src']) for v in paint.values())
print(f'{city}: {len(paint)} landmarks, {size // 1024} KB of paint, file {len(text) // 1024} KB; missing: {sorted(ids - set(paint))}')
