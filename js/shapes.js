/* ============================================================
   SHAPES — the geometric set, drawn as vectors.

   Five flat forms: stacked domes, a diamond, a double chevron, a
   circle and a triangle. Each one is authored inside a unit box centred on the origin
   so a single `size` scales it, and each gets two brand-consistent
   treatments:

     rounded corners  — every hard vertex is arced off

   They are flat, single-colour fills, exactly as the brand sheet has
   them. An earlier pass gave each one a lighter offset copy clipped
   to its own outline, as a slide highlight; that reads as duotone and
   is not how the marks are drawn.

   Nothing here knows about the game. Doorways, totems and the HUD
   all call the same `draw`.
   ============================================================ */

const Shapes = {

  KINDS: ['domes', 'diamond', 'arrows', 'circle', 'triangle'],

  /* Pick a random entry from CONFIG.SHAPES. Optionally exclude one
     kind so a totem's two halves never come out identical. */
  /* `n` different shapes, no repeats. Used for a totem stack: the
     same mark twice in one tower reads as a rendering mistake rather
     than as a stack. Falls back to allowing repeats only if the pool
     is smaller than the stack. */
  sample(n) {
    const pool = CONFIG.SHAPES.slice();
    const out = [];
    while (out.length < n) {
      if (!pool.length) return out.concat(this.sample(n - out.length));
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  },

  random(excludeKind) {
    const pool = excludeKind
      ? CONFIG.SHAPES.filter((s) => s.kind !== excludeKind)
      : CONFIG.SHAPES;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  /* --------------------------------------------------------
     draw(ctx, spec, cx, cy, size, opts)

     spec  { kind, color }
     opts  { rotation, alpha, squash }
             squash < 1 flattens vertically — used when a doorway is
             seen at a steep angle down the corridor.
     -------------------------------------------------------- */
  draw(ctx, spec, cx, cy, size, opts) {
    opts = opts || {};
    if (!(size > 0.5)) return;

    ctx.save();
    ctx.translate(cx, cy);
    if (opts.rotation) ctx.rotate(opts.rotation);
    if (opts.squash) ctx.scale(1, opts.squash);
    ctx.scale(size, size);
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;

    // Corner radius is expressed in unit-box terms, so it scales with
    // the shape instead of getting chunky when a shape is far away.
    const r = CONFIG.SHAPE_CORNER;

    this._path(ctx, spec.kind, r);
    ctx.fillStyle = spec.color;
    ctx.fill();

    ctx.restore();
  },

  /* Draws the silhouette only — used for shadows and for the totem's
     glow pass. */
  silhouette(ctx, kind, cx, cy, size, rotation) {
    ctx.save();
    ctx.translate(cx, cy);
    if (rotation) ctx.rotate(rotation);
    ctx.scale(size, size);
    this._path(ctx, kind, CONFIG.SHAPE_CORNER);
    ctx.restore();
  },

  /* ---------------- the silhouettes ---------------- */

  _path(ctx, kind, r) {
    switch (kind) {
      case 'diamond':  return this._poly(ctx, [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]], r);
      case 'triangle': return this._poly(ctx, [[0, -0.48], [0.5, 0.42], [-0.5, 0.42]], r);
      case 'circle':   return this._circle(ctx);
      case 'arrows':   return this._arrows(ctx, r);
      case 'domes':    return this._domes(ctx);
      default:         return this._circle(ctx);
    }
  },

  _circle(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
    ctx.closePath();
  },

  /* Two chevrons pointing the way the flow runs. */
  _arrows(ctx, r) {
    const tri = (dx) => [[dx - 0.22, -0.46], [dx + 0.24, 0], [dx - 0.22, 0.46]];
    ctx.beginPath();
    this._polyInto(ctx, tri(-0.26), r);
    this._polyInto(ctx, tri(0.24), r);
    ctx.closePath();
  },

  /* The brand's stacked half-domes — a small one riding a larger one. */
  _domes(ctx) {
    ctx.beginPath();
    // Upper dome: flat side down, sitting on the waist.
    ctx.arc(0, -0.06, 0.34, Math.PI, 0);
    ctx.lineTo(0.34, -0.06);
    ctx.lineTo(-0.34, -0.06);
    ctx.closePath();
    // Lower dome: wider, flat side down on the baseline.
    ctx.moveTo(-0.5, 0.5);
    ctx.arc(0, 0.5, 0.5, Math.PI, 0);
    ctx.lineTo(0.5, 0.5);
    ctx.closePath();
  },

  _poly(ctx, pts, r) {
    ctx.beginPath();
    this._polyInto(ctx, pts, r);
    ctx.closePath();
  },

  /* Rounded polygon. Each corner is replaced by an arc of radius r,
     shrunk if a side is too short to carry it. */
  _polyInto(ctx, pts, r) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];

      const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
      const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
      const rr = Math.min(r, d1 / 2, d2 / 2);

      const ax = cur[0] + (prev[0] - cur[0]) / d1 * rr;
      const ay = cur[1] + (prev[1] - cur[1]) / d1 * rr;
      const bx = cur[0] + (next[0] - cur[0]) / d2 * rr;
      const by = cur[1] + (next[1] - cur[1]) / d2 * rr;

      if (i === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
      ctx.quadraticCurveTo(cur[0], cur[1], bx, by);
    }
  },
};

/* ---------------- shared path helpers ---------------- */

/* Rounded rectangle that works without ctx.roundRect. */
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* The four-point sparkle from the title card: two crossed spindles
   with concave sides. Used everywhere something good happens. */
function sparklePath(ctx, cx, cy, r, rotation) {
  const k = r * 0.22;   // waist — smaller k = pointier
  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(k, -k, r, 0);
  ctx.quadraticCurveTo(k, k, 0, r);
  ctx.quadraticCurveTo(-k, k, -r, 0);
  ctx.quadraticCurveTo(-k, -k, 0, -r);
  ctx.closePath();
  ctx.restore();
}

/* A dewdrop: round belly, pinched point at the top. */
/* Draw a dewdrop at `size` — the sprite if it loaded, the curve below
   if it did not. `size` keeps the vector version's meaning so every
   caller's numbers stay valid either way. */
function drawDrop(ctx, cx, cy, size) {
  const img = (typeof Assets !== 'undefined') ? Assets.get('dewdrop') : null;
  if (!img) return false;
  const h = size * 1.12;
  const w = h * (img.naturalWidth / img.naturalHeight);
  ctx.drawImage(img, cx - w / 2, cy - size * 0.5, w, h);
  return true;
}

function dropPath(ctx, cx, cy, size) {
  const w = size * 0.62;      // half-width of the belly
  const top = cy - size * 0.5;
  const belly = cy + size * 0.16;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(cx + w * 0.55, top + size * 0.30, cx + w, belly - size * 0.16, cx + w, belly);
  ctx.bezierCurveTo(cx + w, belly + size * 0.46, cx - w, belly + size * 0.46, cx - w, belly);
  ctx.bezierCurveTo(cx - w, belly - size * 0.16, cx - w * 0.55, top + size * 0.30, cx, top);
  ctx.closePath();
}

/* '#RRGGBB' -> 'r,g,b', for building rgba() strings at runtime. */
const _rgbCache = {};
function hexToRgb(hex) {
  if (_rgbCache[hex]) return _rgbCache[hex];
  const n = parseInt(hex.slice(1), 16);
  const s = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  _rgbCache[hex] = s;
  return s;
}

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
