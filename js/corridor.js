/* ============================================================
   CORRIDOR — every pixel of the world behind the entities.

   Drawn far to near, one depth slice at a time, so nearer geometry
   simply paints over further geometry and no z-sorting is needed.

   A slice of wall, seen from inside a corridor, projects to a
   vertical band on screen — which is exactly the striped wall in the
   mockup. So the stripes are not a texture: they are the corridor's
   own structure, coloured by a stable hash of the slice index.
   ============================================================ */

/* ============================================================
   SCHEME — the corridor's colour ground, cycling as the run goes on.

   It writes straight into CONFIG.COLORS, which every draw function
   already reads fresh each frame. That means none of the drawing code
   below has to know this exists: the walls simply come out a
   different colour.

   Only the wall and void keys move. The path, the turquoise, the
   doorways, the drops and Dewy are brand-locked and never cycle —
   those are the things the player is actually reading.
   ============================================================ */

const Scheme = {
  /* Hold a scheme, then blend into the next. A constant cross-fade
     would mean the corridor is never quite any of the three. */
  at(travel) {
    const list = CONFIG.SCHEMES;
    const n = list.length;
    if (!n) return;
    const t = Math.max(0, travel) / CONFIG.SCHEME_SPAN;
    const i = Math.floor(t) % n;
    const f = t - Math.floor(t);

    const fade = CONFIG.SCHEME_FADE;
    const hold = 1 - fade;
    const k = f <= hold ? 0 : smoothstep((f - hold) / fade);

    const a = list[i];
    const b = list[(i + 1) % n];
    for (const key of CONFIG.SCHEME_KEYS) {
      CONFIG.COLORS[key] = k <= 0 ? a[key] : mixHex(a[key], b[key], k);
    }
  },
};

/* Blend two '#RRGGBB' values. Straight linear mix in sRGB: these are
   neighbouring tones of similar lightness, so the extra machinery of a
   perceptual space buys nothing here. */
function mixHex(a, b, t) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const m = (sh) => {
    const p = (x >> sh) & 255, q = (y >> sh) & 255;
    return Math.round(p + (q - p) * t);
  };
  return '#' + ((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0))
    .toString(16).slice(1).toUpperCase();
}


const Corridor = {

  /* Reused between calls so the per-frame loop allocates nothing. */
  _p: { x: 0, y: 0, scale: 0 },

  draw(ctx, game) {
    const travel = game.travel;
    const C = CONFIG.COLORS;

    this._drawVoid(ctx);

    const first = Math.floor((travel + View.zMin) / CONFIG.SEG_LEN);
    const last = Math.floor((travel + CONFIG.DRAW_DISTANCE) / CONFIG.SEG_LEN);

    // Far to near.
    for (let i = last; i >= first; i--) {
      const zFar = (i + 1) * CONFIG.SEG_LEN;
      let zNear = i * CONFIG.SEG_LEN;
      const relFar = zFar - travel;
      let relNear = zNear - travel;
      if (relFar <= View.zMin) continue;
      if (relNear > CONFIG.DRAW_DISTANCE) continue;
      relNear = Math.max(relNear, View.zMin);
      zNear = relNear + travel;

      this._wallSlice(ctx, i, relNear, relFar, -1);
      this._wallSlice(ctx, i, relNear, relFar, 1);
      this._pathSlice(ctx, zNear, zFar, relNear, relFar, game);
    }

    // Doorways sit proud of the wall, so they go on afterwards,
    // still far to near.
    const doors = Track.doors;
    for (let i = doors.length - 1; i >= 0; i--) {
      this._doorway(ctx, doors[i], travel);
    }

    this._horizonHaze(ctx);
    this._topFade(ctx);
  },

  /* The dark the whole temple sits in. */
  _drawVoid(ctx) {
    const C = CONFIG.COLORS;
    ctx.fillStyle = C.voidDeep;
    ctx.fillRect(0, 0, View.w, View.h);

    // A soft lift around the vanishing point so the corridor reads as
    // going somewhere rather than ending in a flat wall.
    const r = Math.max(View.w, View.h) * 0.5;
    const g = ctx.createRadialGradient(View.cx, View.horizon, 0,
                                       View.cx, View.horizon, r);
    g.addColorStop(0, 'rgba(95,52,150,0.55)');
    g.addColorStop(0.5, 'rgba(58,21,96,0.28)');
    g.addColorStop(1, 'rgba(29,6,55,0)');
    ctx.fillStyle = g;
    // Only the circle's own box. Painting the whole screen blends
    // millions of fully transparent pixels on a tall display for no
    // visible difference.
    const gy = Math.max(0, View.horizon - r);
    const gh = Math.min(View.h, View.horizon + r) - gy;
    if (gh > 0) ctx.fillRect(0, gy, View.w, gh);
  },

  /* ---------------- walls ---------------- */

  /* One depth slice of one wall: a vertical band, flat-filled, with
     a couple of lighter blocks scattered up it. */
  _wallSlice(ctx, index, zNear, zFar, side) {
    const C = CONFIG.COLORS;
    const x = CONFIG.CORRIDOR_HALF * side;

    const sNear = View.scaleAt(zNear);
    const sFar = View.scaleAt(zFar);
    const xNear = View.cx + x * sNear;
    const xFar = View.cx + x * sFar;
    if (Math.abs(xNear - xFar) < 0.35) return;   // sub-pixel, skip it

    const floorNear = View.horizon + View.camHeight * sNear;
    const floorFar = View.horizon + View.camHeight * sFar;
    const topNear = floorNear - CONFIG.WALL_HEIGHT * sNear;
    const topFar = floorFar - CONFIG.WALL_HEIGHT * sFar;

    // Base band. A regular lilac pilaster every few slices, with the
    // gaps between them in the two darker purples — that rhythm is
    // what makes the corridor read as built rather than noisy. The
    // hash only chooses between the two darks, so the pattern never
    // crawls as the wall comes toward the camera.
    const salt = side > 0 ? 7 : 3;
    const pilaster = ((index + (side > 0 ? 1 : 0)) % CONFIG.WALL_PILASTER_EVERY) === 0;
    const r = hash01(index, salt);
    const base = pilaster ? (r < 0.72 ? C.wallLilac : C.wallGrey)
                          : (r < 0.55 ? C.wallBase : C.wallStripe);

    ctx.beginPath();
    ctx.moveTo(xNear, topNear);
    ctx.lineTo(xFar, topFar);
    ctx.lineTo(xFar, floorFar);
    ctx.lineTo(xNear, floorNear);
    ctx.closePath();
    ctx.fillStyle = base;
    ctx.fill();

    // The offset blocks from the artwork: one or two lighter bricks
    // at stable heights up the band. Pilasters stay clean.
    const bricks = pilaster ? 0
                 : (hash01(index, side > 0 ? 11 : 13) < 0.5 ? 1 : 2);
    for (let b = 0; b < bricks; b++) {
      const hy = hash01(index, 100 + b * 7 + side) * 0.9;
      const hh = 0.05 + hash01(index, 200 + b * 5 + side) * 0.11;
      const y0 = -0.05 + hy * 1.0;                  // in wall-height units
      const y1 = Math.min(y0 + hh, 1.05);
      if (y1 <= 0) continue;

      const tone = hash01(index, 300 + b + side);
      ctx.fillStyle = tone < 0.45 ? C.wallGrey
                    : tone < 0.78 ? C.wallLilac
                    : C.wallEdge;
      ctx.globalAlpha = 0.55 + tone * 0.35;

      const aN = floorNear - CONFIG.WALL_HEIGHT * y0 * sNear;
      const aF = floorFar - CONFIG.WALL_HEIGHT * y0 * sFar;
      const bN = floorNear - CONFIG.WALL_HEIGHT * y1 * sNear;
      const bF = floorFar - CONFIG.WALL_HEIGHT * y1 * sFar;

      ctx.beginPath();
      ctx.moveTo(xNear, aN);
      ctx.lineTo(xFar, aF);
      ctx.lineTo(xFar, bF);
      ctx.lineTo(xNear, bN);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Darken the wall as it recedes, so depth reads without fog.
    const dim = clamp((zNear - 400) / (CONFIG.DRAW_DISTANCE * 0.75), 0, 0.72);
    if (dim > 0.01) {
      ctx.globalAlpha = dim;
      ctx.fillStyle = C.voidDeep;
      ctx.beginPath();
      ctx.moveTo(xNear, topNear);
      ctx.lineTo(xFar, topFar);
      ctx.lineTo(xFar, floorFar);
      ctx.lineTo(xNear, floorNear);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  /* ---------------- the path ribbon ---------------- */

  /* One depth slice of the ribbon: three nested quads — outer rim,
     bright outline, then the fill. Behind Dewy every colour swaps to
     turquoise, with a brighter flush right at the boundary so the
     transformation has a visible leading edge. */
  /* Has the path at this depth turned turquoise yet?

     Measured against the slice's NEAR edge, not its far one. Against
     the far edge a slice only lights once Dewy has cleared the whole
     of it, so the turquoise stopped a full segment behind her feet
     and the trail looked like it belonged to someone else. Against
     the near edge the slice she is standing on is already lit, and
     the colour turns directly underneath her. */
  isLit(zNear, travel) {
    return zNear <= travel + CONFIG.PLAYER_Z;
  },

  _pathSlice(ctx, zNear, zFar, relNear, relFar, game) {
    const C = CONFIG.COLORS;
    const cNear = Track.centerX(zNear);
    const cFar = Track.centerX(zFar);

    const sNear = View.scaleAt(relNear);
    const sFar = View.scaleAt(relFar);
    const yNear = View.horizon + View.camHeight * sNear;
    const yFar = View.horizon + View.camHeight * sFar;

    const litEdge = game.travel + CONFIG.PLAYER_Z;
    const lit = this.isLit(zNear, game.travel);
    // How recently this slice flipped, in world units behind Dewy.
    const flush = lit ? clamp(1 - (litEdge - zFar) / 420, 0, 1) : 0;

    // The near edge is pushed down half a pixel so consecutive slices
    // overlap: butted quads leave a hairline of background showing
    // through wherever the antialiasing does not quite meet.
    const yN = yNear + 0.6;
    const quad = (half, style) => {
      ctx.beginPath();
      ctx.moveTo(View.cx + (cNear - half) * sNear, yN);
      ctx.lineTo(View.cx + (cNear + half) * sNear, yN);
      ctx.lineTo(View.cx + (cFar + half) * sFar, yFar);
      ctx.lineTo(View.cx + (cFar - half) * sFar, yFar);
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    };

    const rimW = CONFIG.PATH_HALF + CONFIG.PATH_RIM_W + CONFIG.PATH_EDGE_W;
    const edgeW = CONFIG.PATH_HALF + CONFIG.PATH_EDGE_W;

    quad(rimW, lit ? C.litRim : C.pathRim);
    quad(edgeW, lit ? C.litEdge : C.pathEdge);
    quad(CONFIG.PATH_HALF, lit ? C.litFill : C.pathFill);

    if (flush > 0.02) {
      ctx.globalAlpha = flush * 0.75;
      quad(CONFIG.PATH_HALF, C.litFlush);
      ctx.globalAlpha = 1;
    }

    // Same recession dimming the walls get, so the ribbon does not
    // glow brighter than the corridor it runs through.
    const dim = clamp((relNear - 500) / (CONFIG.DRAW_DISTANCE * 0.7), 0, 0.68);
    if (dim > 0.01) {
      ctx.globalAlpha = dim;
      quad(rimW, C.voidDeep);
      ctx.globalAlpha = 1;
    }
  },

  /* ---------------- doorways ---------------- */

  _doorway(ctx, door, travel) {
    const C = CONFIG.COLORS;
    const relNear = door.z0 - travel;
    const relFar = door.z1 - travel;
    // Once the far edge is inside the near clip the doorway is behind
    // the camera; drawing it would blow up to fill the screen.
    if (relFar <= View.zMin * 1.02 || relNear > CONFIG.DRAW_DISTANCE) return;

    const zn = Math.max(relNear, View.zMin);
    const sNear = View.scaleAt(zn);
    const sFar = View.scaleAt(relFar);

    // Slightly proud of the wall so the panel is not z-fighting it.
    const x = (CONFIG.CORRIDOR_HALF - CONFIG.DOOR_INSET) * door.side;
    const xNear = View.cx + x * sNear;
    const xFar = View.cx + x * sFar;
    if (Math.abs(xNear - xFar) < 1) return;

    const floorNear = View.horizon + View.camHeight * sNear;
    const floorFar = View.horizon + View.camHeight * sFar;

    /* A quad on the wall plane, between two heights above the floor. */
    const panel = (yLo, yHi) => {
      ctx.beginPath();
      ctx.moveTo(xNear, floorNear - yHi * sNear);
      ctx.lineTo(xFar, floorFar - yHi * sFar);
      ctx.lineTo(xFar, floorFar - yLo * sFar);
      ctx.lineTo(xNear, floorNear - yLo * sNear);
      ctx.closePath();
    };

    const sill = CONFIG.DOOR_SILL;
    const top = sill + CONFIG.DOOR_HEIGHT;
    const rev = CONFIG.DOOR_REVEAL;

    // Dark reveal: the recess the opening is cut into. Without it the
    // panel is just another wall stripe.
    panel(Math.max(sill - rev, 0), top + rev);
    ctx.fillStyle = C.voidDeep;
    ctx.fill();

    // The panel body.
    panel(sill, top);
    ctx.fillStyle = door.connected ? C.doorPurpleD : C.doorPurple;
    ctx.fill();

    // The turquoise flooding up from the sill.
    const f = door.fill();
    if (f > 0) {
      const ease = 1 - Math.pow(1 - f, 3);
      panel(sill, sill + (top - sill) * ease);
      ctx.fillStyle = C.doorLit;
      ctx.fill();

      if (ease < 0.995) {
        // A bright line riding the top of the flood.
        const y = sill + (top - sill) * ease;
        ctx.strokeStyle = C.litFlush;
        ctx.lineWidth = Math.max(1.5, 8 * sNear);
        ctx.beginPath();
        ctx.moveTo(xNear, floorNear - y * sNear);
        ctx.lineTo(xFar, floorFar - y * sFar);
        ctx.stroke();
      }
    }

    // The shape, billboarded and clipped to the opening.
    //
    // Laid into the wall plane rather than facing the player, so it
    // reads as painted on the panel. The basis comes from two points
    // actually projected onto that panel, which avoids any sign
    // guesswork about which way the corridor runs on screen. The
    // squash is floored: a true projection goes to zero as the panel
    // turns edge-on, which would hide the app just as the player
    // reaches it. Clipped so it always reads as being *in* the
    // alcove rather than floating over the corridor.
    //
    // And pinned to a depth well inside the doorway rather than to
    // its midpoint: these panels run long, so as one arrives its
    // midpoint comes right up to the camera and a shape sized off it
    // scales past the top of the screen. Holding the shape back in
    // the alcove keeps it a steady size and lets it slide across the
    // opening as the player goes by, which is what the artwork does.
    const midRel = (relNear + relFar) / 2;
    const shapeRel = Math.max(midRel, View.zMin * 2.2);
    const sMid = View.scaleAt(shapeRel);
    const floorMid = View.horizon + View.camHeight * sMid;
    const cxShape = View.cx + x * sMid;
    const cyShape = floorMid - (sill + CONFIG.DOOR_HEIGHT * 0.56) * sMid;

    // Size against the opening on screen as well as in world units:
    // the panel's projected width collapses with distance, and a
    // world-sized shape would spill out of it at the far end.
    const openW = Math.abs(xNear - xFar);
    const size = Math.min(openW * 0.66, CONFIG.SHAPE_SIZE * sMid,
                          View.h * 0.30);

    if (size > 2) {
      const yWorld = sill + CONFIG.DOOR_HEIGHT * 0.56;
      // The corridor axis at the shape's height, far edge to near.
      let ux = xNear - xFar;
      let uy = (floorNear - yWorld * sNear) - (floorFar - yWorld * sFar);
      const ulen = Math.hypot(ux, uy) || 1;
      ux /= ulen; uy /= ulen;

      // Screen length per world unit along z, against the same per
      // world unit vertically: that ratio is the foreshortening.
      const depth = Math.max(relFar - relNear, 1);
      const fore = clamp((ulen / depth) / sMid, CONFIG.SHAPE_PLANE_MIN, 1);

      ctx.save();
      panel(sill, top);
      ctx.clip();
      const bob = Math.sin(door.age * 1.6 + door.z * 0.01) * size * 0.03;
      ctx.translate(cxShape, cyShape + bob);
      // Local +x runs along the corridor; local +y stays screen-down,
      // so the shape keeps its own orientation.
      ctx.transform(ux * fore, uy * fore, 0, 1, 0, 0);
      Shapes.draw(ctx, door.shape, 0, 0, size, { rotation: door.spin });
      ctx.restore();
    }

    // Lintel: a bright lip along the top of the opening, so the
    // doorway has an edge to catch the light.
    ctx.strokeStyle = door.connected ? C.litRim : C.wallLilac;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, 6 * sNear);
    ctx.beginPath();
    ctx.moveTo(xNear, floorNear - top * sNear);
    ctx.lineTo(xFar, floorFar - top * sFar);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Recession dimming, over the whole opening.
    const dim = clamp((zn - 400) / (CONFIG.DRAW_DISTANCE * 0.8), 0, 0.6);
    if (dim > 0.01) {
      ctx.globalAlpha = dim;
      panel(Math.max(sill - rev, 0), top + rev);
      ctx.fillStyle = C.voidDeep;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  /* Softens the far end so slices do not visibly pop into being. */
  _horizonHaze(ctx) {
    // Centred on the vanishing point and fading in both directions, so
    // it softens the far end without leaving a hard edge of its own.
    // Tinted from the live palette, not a fixed purple, or it stays
    // violet while the rest of the corridor cycles to teal.
    const deep = hexToRgb(CONFIG.COLORS.voidDeep);
    const up = View.h * 0.10, down = View.h * 0.13;
    const g = ctx.createLinearGradient(0, View.horizon - up, 0, View.horizon + down);
    g.addColorStop(0, `rgba(${deep},0)`);
    g.addColorStop(0.42, `rgba(${deep},0.90)`);
    g.addColorStop(1, `rgba(${deep},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, View.horizon - up, View.w, up + down);
  },

  /* The walls now run off the top of the frame, but on the way there
     their tops cut a hard diagonal across the upper corners. This
     fades the top of the screen into the void so the texture climbs
     out of sight instead of stopping at a drawn edge. Not fully
     opaque at the very top: some wall should still be faintly there,
     receding into the dark, rather than meeting a flat band. */
  _topFade(ctx) {
    const deep = hexToRgb(CONFIG.COLORS.voidDeep);
    const end = View.horizon + View.h * CONFIG.TOP_FADE_EXTRA;
    if (end <= 0) return;
    const g = ctx.createLinearGradient(0, 0, 0, end);
    g.addColorStop(0, `rgba(${deep},0.88)`);
    g.addColorStop(0.5, `rgba(${deep},0.55)`);
    g.addColorStop(1, `rgba(${deep},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, View.w, end);
  },
};
