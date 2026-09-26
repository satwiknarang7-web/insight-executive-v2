/**
 * Where a region sits on its map, from its SVG path.
 *
 * The bubble map puts a circle on each region and the shape map zooms to the
 * regions a table names, so both need the same two facts about a shape: the
 * box around it and a point inside it. The map files (lib/geo/maps/*.json) are
 * already projected SVG paths, so nothing here needs a projection — only a
 * reader for the path language. The world map uses absolute moves and lines,
 * but the country maps also use relative ones, horizontal and vertical lines
 * and curves; a curve is taken at its end points, which is close enough for a
 * box and a centre at the size a region is drawn.
 *
 * The centre is the centroid of the largest ring, not of the whole shape: a
 * country with islands would otherwise put its circle in the sea between them
 * (Norway's would land off the coast, France's in the Atlantic).
 */

// How many numbers each command takes per point it draws.
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const TOKEN = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/** The rings of a path, each a list of [x, y] in absolute coordinates. */
export function ringsOf(d) {
  const rings = [];
  let ring = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cmd = null;
  let args = [];
  const close = () => {
    if (ring?.length) rings.push(ring);
    ring = null;
  };
  const point = (px, py) => {
    x = px;
    y = py;
    (ring ||= []).push([x, y]);
  };
  // Apply one full set of arguments for the current command.
  const step = () => {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const a = args;
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'M') {
      close();
      point(ox + a[0], oy + a[1]);
      startX = x;
      startY = y;
      // Further pairs after a move are lines.
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L' || C === 'T') point(ox + a[0], oy + a[1]);
    else if (C === 'H') point((rel ? x : 0) + a[0], y);
    else if (C === 'V') point(x, (rel ? y : 0) + a[0]);
    else if (C === 'C') point(ox + a[4], oy + a[5]);
    else if (C === 'S' || C === 'Q') point(ox + a[2], oy + a[3]);
    else if (C === 'A') point(ox + a[5], oy + a[6]);
    args = [];
  };
  for (const [, c, n] of String(d || '').matchAll(TOKEN)) {
    if (c) {
      if (c === 'Z' || c === 'z') {
        close();
        x = startX;
        y = startY;
        cmd = null;
        continue;
      }
      cmd = c;
      args = [];
      continue;
    }
    if (!cmd) continue;
    args.push(Number(n));
    if (args.length === ARITY[cmd.toUpperCase()]) step();
  }
  close();
  return rings;
}

/** Signed area and centroid of one closed ring (shoelace). */
function ringCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  if (!a) {
    // A degenerate ring (a line): the middle of its points.
    const n = ring.length || 1;
    return { area: 0, centre: [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n] };
  }
  return { area: Math.abs(a), centre: [cx / (6 * a), cy / (6 * a)] };
}

/** { box: [x0, y0, x1, y1], centre: [x, y] } for one path, or null for an empty one. */
export function pathGeometry(d) {
  const rings = ringsOf(d);
  if (!rings.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  let best = null;
  for (const ring of rings) {
    const c = ringCentroid(ring);
    if (!best || c.area > best.area) best = c;
  }
  return { box: [x0, y0, x1, y1], centre: best.centre };
}

/**
 * A viewBox around several boxes, padded by a share of its larger side so a
 * region at the edge is not drawn against the frame.
 */
export function fitBox(boxes, pad = 0.04) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [a, b, c, d] of list) {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  }
  const p = Math.max(x1 - x0, y1 - y0) * pad;
  const f = (n) => Number(n.toFixed(1));
  return `${f(x0 - p)} ${f(y0 - p)} ${f(x1 - x0 + 2 * p)} ${f(y1 - y0 + 2 * p)}`;
}
