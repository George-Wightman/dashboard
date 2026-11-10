# Heather and flower beds are purple too, so ground tiles get only the edge pass.
# Takes the magenta fringe off a cut-out sprite: a pink-tinged pixel on the edge of the picture
# (red and blue both well above green, next to a transparent one) goes, twice over. Shared by
# dev/build-terrain.py and dev/build-landmarks.py.

def defringe(im, passes=3, inner=False):
    im = im.convert('RGBA'); W, H = im.size; px = im.load()
    # Landmarks only (`inner`): magenta caught inside the picture (between lattice girders, under arches), blended with what's
    # behind it: red and blue both far above green and close to each other. Gone wherever it is.
    for y in range(H if inner else 0):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a and r - g > 55 and b - g > 55 and abs(r - b) < 70: px[x, y] = (0, 0, 0, 0)
    # A nearly invisible rim pixel would shield the pink one inside it: gone first.
    for y in range(H):
        for x in range(W):
            if 0 < px[x, y][3] < 40: px[x, y] = (0, 0, 0, 0)
    for _ in range(passes):
        drop = []
        for y in range(H):
            for x in range(W):
                r, g, b, a = px[x, y]
                if a == 0 or not (r - g > 22 and b - g > 14): continue
                if any(not (0 <= x + dx < W and 0 <= y + dy < H) or px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    drop.append((x, y))
        for x, y in drop: px[x, y] = (0, 0, 0, 0)
    return im
