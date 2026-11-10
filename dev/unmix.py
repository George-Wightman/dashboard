# Cuts a sprite off Gemini's magenta (#FF00FF) by taking the magenta out of each pixel, rather
# than keeping or dropping it whole. A thin dark girder drawn over magenta comes out as a dark,
# partly see-through line, where a yes-or-no cut would lose it. It assumes what's in front is
# near-grey where it's thin (iron, shadow), which suits lattices and frames. Only magenta-ish pixels
# change: red and blue both above green, and close to each other.
#
#   python dev/unmix.py <sheet.png> <x0,y0,x1,y1> <out.png>
import sys
from collections import deque
from PIL import Image

def unmix(im):
    im = im.convert('RGBA'); W, H = im.size; px = im.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            m = min(r, b) - g
            if m <= 24 or abs(r - b) > 80: continue
            # p = alpha * grey + (1 - alpha) * magenta: the magenta lifts red and blue above green by
            # (1 - alpha) * 255.
            al = max(0.0, 1 - m / 235)
            if al < 0.08: px[x, y] = (0, 0, 0, 0); continue
            f = lambda c: max(0, min(255, round((c - (1 - al) * 255) / al)))
            grey = max(0, min(255, round(g / al)))
            nr, nb = f(r), f(b)
            # Keep any warmth left in red and blue after the magenta is out, but never more than a
            # little past green (that would be magenta again).
            px[x, y] = (min(nr, grey + 30), grey, min(nb, grey + 30), round(a * al))
    return im

def biggest(im):
    # The sprite only: the biggest piece of what's left (no bits of the next cell).
    px = im.load(); W, H = im.size; seen = set(); best = []
    for y in range(H):
        for x in range(W):
            if (x, y) in seen or px[x, y][3] < 40: continue
            q = deque([(x, y)]); seen.add((x, y)); part = []
            while q:
                a, b = q.popleft(); part.append((a, b))
                for nx, ny in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                    if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and px[nx, ny][3] >= 40: seen.add((nx, ny)); q.append((nx, ny))
            if len(part) > len(best): best = part
    keep = set(best)
    for y in range(H):
        for x in range(W):
            if px[x, y][3] and (x, y) not in keep and not any((x + dx, y + dy) in keep for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2)):
                px[x, y] = (0, 0, 0, 0)
    return im.crop(im.getbbox())

if __name__ == '__main__':
    box = tuple(int(v) for v in sys.argv[2].split(','))
    out = biggest(unmix(Image.open(sys.argv[1]).crop(box)))
    out.save(sys.argv[3]); print(sys.argv[3], out.size)
