/* ============================================================
   VIEW — canvas sizing and the fake-3D projection.

   Camera sits at world z = 0 looking down +z. A point at depth z
   projects with scale = focal / z.

   The focal length is solved at every resize so the corridor walls
   land at the same fraction of the screen width no matter the
   aspect ratio. That is what lets one build cover a landscape
   laptop today and a stacked-monitor portrait column later: a
   taller window simply reveals more corridor above and more floor
   below, and the framing of the run never changes.
   ============================================================ */

const View = {
  canvas: null,
  ctx: null,

  w: 0,          // logical (CSS) pixels
  h: 0,
  cx: 0,         // horizontal centre of the corridor
  horizon: 0,    // y of the vanishing point
  focal: 0,
  camHeight: 0,
  s: 1,          // UI scale vs the authoring resolution
  zMin: 400,     // nearest depth drawn — solved at resize
  portrait: false,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);

    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const aspect = this.w / this.h;
    this.portrait = aspect < 0.87;

    // UI scale: the smaller of the two ratios, so nothing overflows a
    // narrow window and nothing looks lost in a tall one.
    this.s = Math.min(this.w / CONFIG.REF_WIDTH, this.h / CONFIG.REF_HEIGHT);

    this.cx = this.w / 2;

    // Horizon slides with the aspect ratio: high in a tall column so
    // the corridor has room to recede, lower in a wide window so the
    // floor does not take over the frame.
    const k = clamp((aspect - 0.75) / (1.78 - 0.75), 0, 1);
    const horizonFrac = CONFIG.HORIZON_FRAC_TALL
      + (CONFIG.HORIZON_FRAC_WIDE - CONFIG.HORIZON_FRAC_TALL) * k;
    this.horizon = this.h * horizonFrac;

    // Solve the projection from the framing rules rather than
    // hardcoding it — see the note in config.js.
    //
    // The rules are written against the width, because the game is
    // authored portrait. Scaling by raw width in a wide window blows
    // Dewy up to two-thirds of the screen and leaves no corridor to
    // look down, so the framing is driven by whichever dimension is
    // actually the constraint. A landscape window then reads as the
    // portrait composition with void either side, which is the same
    // design rather than a second one.
    const span = Math.min(this.w, this.h * 1.05);
    this.focal = (CONFIG.PATH_SCREEN_FRAC * span * CONFIG.PLAYER_Z)
               / CONFIG.PATH_HALF;

    const drop = CONFIG.PLAYER_FLOOR_FRAC - horizonFrac;
    this.camHeight = (drop * this.h * CONFIG.PLAYER_Z) / this.focal;

    // The near clip is wherever the floor meets the bottom edge.
    this.zMin = CONFIG.PLAYER_Z * drop / (1 - horizonFrac);
  },

  scaleAt(z) {
    return this.focal / Math.max(z, 1);
  },

  /* World (x across, y up from the floor, z into the screen) -> pixels. */
  project(x, y, z) {
    const scale = this.scaleAt(z);
    return {
      x: this.cx + x * scale,
      y: this.horizon + (this.camHeight - y) * scale,
      scale,
    };
  },

  /* y of the floor at depth z — used constantly, so it skips the
     object allocation project() would make. */
  floorY(z) {
    return this.horizon + this.camHeight * this.scaleAt(z);
  },
};
