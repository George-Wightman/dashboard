# How wide a painted sprite's hex base is, in its own pixels. Trees and roofs can spill past the
# hex, so the sprite's full width isn't it: measured from the bottom point up, the outline widens
# steadily along the two lower edges and stops widening at the hex's side corners. That width is the
# base. Shared by dev/build-terrain.py and dev/build-landmarks.py, so every tile is scaled by its
# own hex and they meet on the board.

def base_width(im):
    a = im.convert('RGBA').getchannel('A').load()
    W, H = im.size
    widths = []
    for y in range(H - 1, -1, -1):
        xs = [x for x in range(W) if a[x, y] > 128]
        if xs: widths.append(max(xs) - min(xs) + 1)
        elif widths: widths.append(0)
    # The lower edges widen the outline by about 4.6 pixels a row at any scale (the hex's tilt).
    # Going up from the bottom, past the blunt tip (half the sprite's width), the base is where three
    # rows further up add less than a third of that.
    full = max(widths)
    for h in range(len(widths) - 3):
        if widths[h] < full / 2: continue
        if widths[h + 3] - widths[h] < 4.6:
            base = max(widths[:h + 4])
            # Under 85% of the whole is something odd at the bottom (a stray piece): the whole, then.
            return base if base >= 0.85 * full else full
    return full
