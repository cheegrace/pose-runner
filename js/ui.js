/* ============================================================
   FX — full-screen flashes.
   ============================================================ */

const FX = {
  flash: 0,
  color: '#FFFFFF',
  shake: 0,

  reset() { this.flash = 0; this.shake = 0; },

  trigger(strength, color) {
    if (strength >= this.flash) {
      this.flash = strength;
      this.color = color || '#FFFFFF';
    }
  },

  kick(amount) { this.shake = Math.max(this.shake, amount); },

  update(dt) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * CONFIG.FLASH_DECAY);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);
  },

  /* Applied before the world is drawn, undone after. */
  applyShake(ctx) {
    if (this.shake <= 0) return false;
    ctx.save();
    ctx.translate((Math.random() - 0.5) * this.shake,
                  (Math.random() - 0.5) * this.shake);
    return true;
  },

  draw(ctx) {
    if (this.flash <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(this.flash, 1);
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, View.w, View.h);
    ctx.restore();
  },
};


/* ============================================================
   WAVE — the end of a run.

   Dewdrops rain the length of the screen, pool at the bottom, and
   the pool rises as a wave until the whole temple is turquoise.
   The score card comes up out of the water.

   Three phases, driven by one clock:
     rain   drops fall, the pool starts to gather
     rise   the surface climbs to the top of the screen
     settle turquoise field, card in
   ============================================================ */

/* Back-to-front for the front-on rig: trailing arm, body, face, legs,
   leading arm. The face is its own layer so it stays crisp over the
   body wherever the body is tilted. */
const FRONT_ORDER = ['armBack', 'body', 'face', 'legs', 'armFront'];

const Wave = {
  drops: [],
  t: 0,
  level: 0,        // 0 = off the bottom of the screen, 1 = past the top
  active: false,

  reset() {
    this.drops = [];
    this.t = 0;
    this.level = 0;
    this.rise = 0;       // 0..1 progress of the climb, before scaling
    this.active = false;
  },

  start() {
    this.reset();
    this.active = true;
    for (let i = 0; i < CONFIG.WAVE_DROPS; i++) {
      this.drops.push({
        x: Math.random(),                       // fraction of width
        y: -Math.random() * 1.4,                // fraction of height
        v: 1.5 + Math.random() * 2.4,           // screens per second
        size: 0.018 + Math.random() * 0.045,    // fraction of the short side
        rot: (Math.random() - 0.5) * 0.5,
        spin: (Math.random() - 0.5) * 2.4,
        wob: Math.random() * Math.PI * 2,
      });
    }
    Audio.sfx('wave');
  },

  update(dt) {
    if (!this.active) return;
    this.t += dt;

    for (const d of this.drops) {
      d.y += d.v * dt;
      d.rot += d.spin * dt;
      d.x += Math.sin(this.t * 2 + d.wob) * 0.03 * dt;
    }

    if (this.t > CONFIG.WAVE_RAIN_TIME) {
      const k = clamp((this.t - CONFIG.WAVE_RAIN_TIME) / CONFIG.WAVE_RISE_TIME, 0, 1);
      // Ease out, so the water arrives with weight and settles.
      this.rise = 1 - Math.pow(1 - k, 2.2);
      this.level = this.rise * CONFIG.WAVE_REST_LEVEL;
    }
  },

  /* Has the water reached its resting line? The card waits for this. */
  filled() {
    return this.rise >= 0.999;
  },

  /* Navy behind everything, fading in as the water climbs. The run is
     played in the purple temple; the payoff lands in brand colour. */
  backdrop(ctx) {
    if (!this.active) return 0;
    const k = clamp(this.t / (CONFIG.WAVE_RAIN_TIME * 0.9), 0, 1);
    if (k <= 0) return 0;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = CONFIG.COLORS.navy;
    ctx.fillRect(0, 0, View.w, View.h);
    ctx.restore();
    return k;
  },

  cardIn() {
    if (!this.active) return 0;
    const done = CONFIG.WAVE_RAIN_TIME + CONFIG.WAVE_RISE_TIME + CONFIG.WAVE_CARD_DELAY;
    return clamp((this.t - done) / 0.5, 0, 1);
  },

  draw(ctx) {
    if (!this.active) return;
    const C = CONFIG.COLORS;
    const unit = Math.min(View.w, View.h);

    // Falling drops.
    ctx.save();
    for (const d of this.drops) {
      const y = d.y * View.h;
      if (y < -unit || y > View.h + unit) continue;
      const size = d.size * unit;
      const x = d.x * View.w;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.rot);
      if (drawDrop(ctx, 0, 0, size)) { ctx.restore(); continue; }
      dropPath(ctx, 0, 0, size);
      ctx.fillStyle = C.drop;
      ctx.fill();
      if (size > 10) {
        ctx.fillStyle = C.dropShine;
        ctx.beginPath();
        ctx.ellipse(-size * 0.16, -size * 0.12, size * 0.10, size * 0.13,
                    -0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();

    if (this.level <= 0) return;

    // The body of water. Its surface is three sines at different
    // rates, so the crest never repeats on a visible cycle.
    const surface = View.h * (1 - this.level);
    // The crest keeps its full travel at rest — this water laps for as
    // long as the card is up, it does not freeze once it arrives.
    const amp = unit * 0.030;

    const crest = (x) => surface
      + Math.sin(x * 0.010 + this.t * 3.1) * amp
      + Math.sin(x * 0.023 - this.t * 4.4) * amp * 0.45
      + Math.sin(x * 0.005 + this.t * 1.7) * amp * 0.75;

    const body = (yOffset, fill) => {
      ctx.beginPath();
      ctx.moveTo(0, View.h);
      ctx.lineTo(0, crest(0) + yOffset);
      for (let x = 0; x <= View.w; x += 12) ctx.lineTo(x, crest(x) + yOffset);
      ctx.lineTo(View.w, View.h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    body(unit * 0.045, C.litEdge);   // the darker mass under the crest
    body(0, C.litFill);              // the surface itself

    // Foam: a bright line riding the crest, and a scatter of sparkles.
    ctx.strokeStyle = C.litFlush;
    ctx.lineWidth = Math.max(2, unit * 0.006);
    ctx.beginPath();
    for (let x = 0; x <= View.w; x += 12) {
      const y = crest(x);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

  },
};


/* ============================================================
   UI — HUD and the two screens.

   Type is Chewy throughout, matching the artwork. Every size is
   expressed against View.s so the layout holds in landscape now and
   in a tall portrait column later.
   ============================================================ */

const UI = {

  font(px) {
    const size = Math.round(px * View.s * CONFIG.UI_SCALE);
    return `${size}px Chewy, "Trebuchet MS", system-ui, sans-serif`;
  },

  num(n) {
    return Math.round(n).toLocaleString('en-US');
  },

  /* Draw `text` centred on (cx, cy) with a travelling wave through it:
     each glyph rides its own point on one sine, so the word ripples
     left to right instead of bobbing as a block.

     Measured per glyph and laid out by hand, because canvas has no way
     to offset individual characters inside a single fillText. */
  waveText(ctx, text, cx, cy, amp, t, speed) {
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    for (let i = 0; i < chars.length; i++) {
      const phase = t * (speed || 3.2) - i * 0.45;
      ctx.fillText(chars[i], x, cy + Math.sin(phase) * amp);
      x += widths[i];
    }
    ctx.textAlign = prevAlign;
  },

  /* Set the font to `px`, then shrink it until `text` fits inside
     `maxFrac` of the canvas width. The canvas has to hold a long
     title at any aspect ratio — including the tall spanned display
     the cabinet will run on — so type is fitted, never assumed. */
  fitFont(ctx, text, px, maxFrac) {
    const limit = View.w * maxFrac;
    let size = px;
    ctx.font = this.font(size);
    const w = ctx.measureText(text).width;
    if (w > limit) {
      size = px * (limit / w);
      ctx.font = this.font(size);
    }
    return size;
  },

  /* ---------------- shared pieces ---------------- */

  /* The white lozenge from the artwork: a hard drop shadow under a
     pure white pill. Used for every number the player reads. */
  pill(ctx, text, cx, cy, fontPx, opts) {
    opts = opts || {};
    ctx.font = this.font(fontPx);
    /* The box has to scale with UI_SCALE too. `font()` applies it, so
       the measured text grew with it while padX and h did not — the
       type crept to the ends of the lozenge and the box started
       overlapping whatever sat above it. */
    const u = View.s * CONFIG.UI_SCALE;
    const padX = fontPx * 0.78 * u;
    const w = ctx.measureText(text).width + padX * 2;
    // `fixedH` lets a caller match the pill to something beside it —
    // the HUD counters set it to the icon height so the row is one
    // band rather than a small glyph next to a tall lozenge.
    const h = opts.fixedH || fontPx * 1.68 * u;
    const r = h / 2;
    const x = cx - w / 2;
    const y = cy - h / 2;

    if (opts.shadow !== false) {
      ctx.fillStyle = opts.shadowColor || 'rgba(20,4,42,0.45)';
      roundRectPath(ctx, x, y + h * 0.09, w, h, r);
      ctx.fill();
    }

    ctx.fillStyle = opts.fill || CONFIG.COLORS.paper;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();

    ctx.fillStyle = opts.ink || CONFIG.COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Chewy sits high in its em box; nudge down so it optically centres.
    ctx.fillText(text, cx, cy + h * 0.06);
    return { w, h };
  },

  /* A dewdrop glyph, for the HUD counter and the score card. */
  dropIcon(ctx, cx, cy, size, opts) {
    const C = CONFIG.COLORS;
    opts = opts || {};
    if (!opts.vector && drawDrop(ctx, cx, cy, size)) return;
    dropPath(ctx, cx, cy, size);
    ctx.fillStyle = opts.fill || C.drop;
    ctx.fill();
    ctx.strokeStyle = opts.line || C.dropDeep;
    ctx.lineWidth = size * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.14, size * 0.26, Math.PI * 0.15, Math.PI * 0.72);
    ctx.stroke();
  },

  /* A doorway glyph — an arch, the same shape the player runs past. */
  /* The doorway pip: a panel with square top corners, softened only
     at the base, with one of the brand shapes sitting in front of it.
     The old version was an arch, which read as a tunnel mouth rather
     than as the flat lit panels the player actually runs past. */
  doorIcon(ctx, cx, cy, size) {
    const C = CONFIG.COLORS;
    const w = size * 0.74, h = size;
    const x = cx - w / 2, y = cy - h / 2;
    const r = w * 0.16;

    // Sharp at the top, rounded at the foot.
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.closePath();
    ctx.fillStyle = C.drop;
    ctx.fill();

    // The app itself, in front of the panel. A fixed shape rather
    // than a random one: this is a counter, and a pip that changes
    // form between frames reads as a glitch.
    const spec = CONFIG.SHAPES[1] || CONFIG.SHAPES[0];
    if (spec) {
      ctx.save();
      ctx.fillStyle = CONFIG.COLORS.void;
      ctx.globalAlpha *= 0.28;
      Shapes.draw(ctx, spec, cx, cy + h * 0.04, size * 0.62, {});
      ctx.globalAlpha /= 0.28;
      ctx.restore();
      Shapes.draw(ctx, spec, cx, cy, size * 0.62, {});
    }
  },

  image(ctx, key, cx, cy, targetH) {
    const img = Assets.get(key);
    if (!img) return 0;
    const w = targetH * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, cx - w / 2, cy - targetH / 2, w, targetH);
    return w;
  },

  /* ---------------- HUD ---------------- */

  /* The teeter. Dewy is over the void and has a moment to get back;
     without a signal for it the grace period just reads as the game
     failing to kill you, and then killing you for no visible reason.
     A red bloom on the side she is leaving, rising as the clock runs
     out, makes it obvious which way to lean. */
  drawTeeter(ctx, game) {
    const k = game.teeter ? game.teeter() : 0;
    if (k <= 0) return;
    const side = Math.sign(game.dewy.x -
                           Track.centerX(game.travel + CONFIG.PLAYER_Z)) || 1;
    const w = View.w * 0.30;
    const x0 = side > 0 ? View.w : 0;
    const g = ctx.createLinearGradient(x0, 0, side > 0 ? View.w - w : w, 0);
    // Pulse faster as the clock runs down.
    const pulse = 0.62 + 0.38 * Math.sin(game.coyote * (12 + k * 26));
    g.addColorStop(0, `rgba(255,90,110,${(0.30 + 0.5 * k) * pulse})`);
    g.addColorStop(1, 'rgba(255,90,110,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, View.w, View.h);
    ctx.restore();
  },

  drawHUD(ctx, game) {
    const k = CONFIG.HUD_SCALE;
    const pad = 34 * View.s;
    const icon = 46 * View.s * k;

    // Dewdrops, then apps connected directly beneath — the two things
    // the score card will talk about.
    /* The pill is pinned to the icon's height, so the row simply *is*
       the icon height. That also makes the alignment trivial: every
       row's top edge is its own y. */
    const rowH = icon;
    this._counter(ctx, pad, pad, icon, rowH, 'drop', this.num(game.drops),
                  game.dropPulse);
    this._counter(ctx, pad, pad + rowH * 1.18, icon, rowH, 'door',
                  this.num(game.apps), game.appPulse);

    if (game.boostTimer > 0) this._boostMeter(ctx, game, pad);

    if (CONFIG.SHOW_FPS) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(237,230,255,0.5)';
      ctx.font = `${Math.round(13 * View.s)}px monospace`;
      ctx.fillText(`${game.fps.toFixed(0)} fps · ${Input.mode}`,
                   View.w - pad, View.h - pad);
    }
  },

  /* Icon and number share one centre line, so the row reads as a
     single object rather than two things that happen to be near each
     other. `pulse` briefly swells the whole row when it ticks up. */
  _counter(ctx, x, y, icon, rowH, kind, text, pulse) {
    const cy = y + rowH / 2;
    /* Size the number to the icon, not the other way round. The pill
       is pinned to the icon's height now, so a font chosen
       independently simply overflowed it. 1.45 is the pill height a
       Chewy glyph needs to sit in comfortably. */
    const fs = icon / (1.45 * View.s * CONFIG.UI_SCALE);
    const grow = 1 + 0.18 * clamp(pulse || 0, 0, 1);

    ctx.save();
    if (grow !== 1) {
      ctx.translate(x, cy);
      ctx.scale(grow, grow);
      ctx.translate(-x, -cy);
    }

    /* The drop glyph is not centred inside its own box — the teardrop
       hangs below its midpoint — so it needs lifting to sit on the
       same line as the number beside it. The door pip is a plain
       rectangle and already centres. */
    if (kind === 'drop') this.dropIcon(ctx, x + icon / 2, cy - icon * 0.06, icon);
    else this.doorIcon(ctx, x + icon / 2, cy, icon);

    ctx.font = this.font(fs);
    const padX = fs * 0.78 * View.s * CONFIG.UI_SCALE;
    const w = ctx.measureText(text).width + padX * 2;
    this.pill(ctx, text, x + icon * 1.22 + w / 2, cy, fs, { fixedH: icon });
    ctx.restore();
  },

  /* A turquoise bar that drains for the length of a boost. */
  _boostMeter(ctx, game, pad) {
    const frac = clamp(game.boostTimer / CONFIG.BOOST_TIME, 0, 1);
    const w = 300 * View.s, h = 16 * View.s;
    const x = View.w / 2 - w / 2;
    const y = pad + 6 * View.s;

    ctx.fillStyle = 'rgba(20,4,42,0.45)';
    roundRectPath(ctx, x, y, w, h, h / 2);
    ctx.fill();

    ctx.fillStyle = CONFIG.COLORS.litFill;
    roundRectPath(ctx, x, y, Math.max(h, w * frac), h, h / 2);
    ctx.fill();

    ctx.fillStyle = CONFIG.COLORS.litFlush;
    ctx.font = this.font(26);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('FLOW STATE', View.w / 2, y + h * 1.5);
  },

  /* Radial speed lines from the vanishing point, only while a boost
     is running. Cheap, and it sells the rush far better than making
     the glow around Dewy any brighter. */
  drawBoostRush(ctx, game) {
    const t = CONFIG.BOOST_TIME - game.boostTimer;
    const fade = Math.min(clamp(t / 0.25, 0, 1),
                          clamp(game.boostTimer / 0.4, 0, 1));
    if (fade <= 0) return;

    const R = Math.hypot(View.w, View.h) * 0.75;
    ctx.save();
    ctx.translate(View.cx, View.horizon);
    ctx.strokeStyle = CONFIG.COLORS.litFlush;
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + i * 0.37;
      // Each streak runs its own loop out from the centre.
      const phase = ((t * (1.3 + (i % 5) * 0.28) + i * 0.31) % 1);
      const inner = 0.16 + phase * 0.9;
      const len = 0.10 + phase * 0.26;
      ctx.globalAlpha = fade * 0.42 * Math.sin(phase * Math.PI);
      ctx.lineWidth = (1.5 + phase * 4) * View.s;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * inner, Math.sin(a) * R * inner);
      ctx.lineTo(Math.cos(a) * R * (inner + len), Math.sin(a) * R * (inner + len));
      ctx.stroke();
    }
    ctx.restore();
  },

  /* The front-on run rig, composited live: two drawn poses swapped on
     a cycle, so the same Dewy greets you at the start and sees you
     out at the end. Falls back to the static cut-out if the rig
     files are missing — the cards still read. */
  dewyRun(ctx, cx, cy, targetH, t, opts) {
    opts = opts || {};
    const rate = opts.rate || 8;
    const rig = (Math.floor(t * rate / Math.PI) % 2 === 0) ? 'f1' : 'f2';
    // One order for both poses. It used to branch, because pose 2's
    // legs arrived as two layers and pose 1's as one; the final
    // artwork merged them, and a stale branch here silently drew that
    // pose with no legs at all.
    const parts = FRONT_ORDER;

    const w = targetH * (Assets.frontWidth / Assets.frontHeight);
    const x0 = cx - w / 2, y0 = cy - targetH / 2;
    let drew = false;
    for (const part of parts) {
      const img = Assets.frontPart(rig, part);
      if (!img) continue;
      ctx.drawImage(img, x0, y0, w, targetH);
      drew = true;
    }
    if (!drew) this.image(ctx, 'dewyFront', cx, cy, targetH);
  },

  /* ---------------- camera notice ----------------

     Confirmed with the same gesture that opened it, so there is one
     control to learn and it is the one the game uses. The standing
     notice on the attract card does the heavier lifting: by the time
     anyone can raise their hands here, the camera has already watched
     them do it. */
  drawConsent(ctx, game) {
    const C = CONFIG.COLORS;
    const t = game.consentTime;
    const ease = 1 - Math.pow(1 - clamp(t / 0.3, 0, 1), 3);

    ctx.save();
    ctx.fillStyle = 'rgba(20,4,42,0.90)';
    ctx.fillRect(0, 0, View.w, View.h);
    ctx.globalAlpha = ease;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const mid = View.w / 2;
    const body = CONFIG.CONSENT_BODY;
    const lineH = Math.min(View.h * 0.042, 46 * View.s);
    const blockH = body.length * lineH;
    const top = View.h * 0.30 + (1 - ease) * View.h * 0.03;

    this.fitFont(ctx, CONFIG.CONSENT_TITLE, 72, 0.8);
    ctx.fillStyle = C.turquoise;
    ctx.fillText(CONFIG.CONSENT_TITLE, mid, View.h * 0.20);

    // A camera glyph, so the subject is obvious before a word is read.
    this._cameraGlyph(ctx, mid, View.h * 0.115, Math.min(View.h * 0.05, 56 * View.s));

    ctx.fillStyle = C.paper;
    for (let i = 0; i < body.length; i++) {
      if (!body[i]) continue;
      this.fitFont(ctx, body[i], 30, 0.86);
      ctx.fillText(body[i], mid, top + i * lineH);
    }

    const prompt = Pose.status === 'tracking'
      ? CONFIG.CONSENT_ACCEPT : CONFIG.CONSENT_ACCEPT_KEY;
    const pulse = 1 + Math.sin(t * 3) * 0.02;
    ctx.save();
    ctx.translate(mid, top + blockH + View.h * 0.10);
    ctx.scale(pulse, pulse);
    this.pill(ctx, prompt, 0, 0, 40, {
      fill: C.lilac, ink: C.paper, shadowColor: C.lilacDeep,
    });
    ctx.restore();

    ctx.globalAlpha = ease * 0.6;
    ctx.fillStyle = C.lilac;
    this.fitFont(ctx, 'Or step away to cancel', 24, 0.5);
    ctx.fillText('Or step away to cancel', mid, top + blockH + View.h * 0.165);

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  _cameraGlyph(ctx, cx, cy, s) {
    ctx.save();
    ctx.strokeStyle = CONFIG.COLORS.lilac;
    ctx.lineWidth = Math.max(2, s * 0.09);
    ctx.lineJoin = 'round';
    roundRectPath(ctx, cx - s * 0.62, cy - s * 0.40, s * 1.24, s * 0.80, s * 0.20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  /* ---------------- how to play ----------------

     One card at a time, low on the screen so it never covers the
     stretch of path the player is being asked to read. The glyph
     beside the words mimes the control: chevrons that swing, a drop
     that falls into place, a hand that hops a cloud. Nobody at a
     stand reads instructions, but everybody copies a picture. */

  drawTutorial(ctx, game) {
    const C = CONFIG.COLORS;
    const step = game.step();
    if (!step) return;

    const t = game.tutorialTime;
    const done = game.tutorialDone;
    // Slide up and settle, so a new card announces itself.
    const inT = clamp(t / 0.32, 0, 1);
    const ease = 1 - Math.pow(1 - inT, 3);

    // Sits in the upper-middle: clear of the HUD counters above it and
    // clear of Dewy below it, so the player can watch themselves do
    // the thing the card is asking for.
    const cardY = View.h * 0.30 + (1 - ease) * View.h * 0.05;
    const cardW = Math.min(View.w * 0.86, 760 * View.s);
    const cardH = Math.min(View.h * 0.17, 210 * View.s);

    ctx.save();
    ctx.globalAlpha = ease;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Panel. Deep purple rather than the lilac of the title button:
    // this card carries two lines of real copy over a bright, moving
    // corridor, and white on lilac is not legible at body size.
    const px = View.w / 2 - cardW / 2, py = cardY - cardH / 2;
    const rad = cardH * 0.30;
    ctx.fillStyle = 'rgba(20,4,42,0.50)';
    roundRectPath(ctx, px, py + cardH * 0.07, cardW, cardH, rad);
    ctx.fill();
    ctx.fillStyle = 'rgba(29,6,55,0.94)';
    roundRectPath(ctx, px, py, cardW, cardH, rad);
    ctx.fill();
    // The rim is the state: lilac while the card is asking, turquoise
    // the moment the player performs the control.
    ctx.strokeStyle = done ? C.turquoise : C.lilac;
    ctx.lineWidth = Math.max(2, cardH * (done ? 0.045 : 0.025));
    roundRectPath(ctx, px, py, cardW, cardH, rad);
    ctx.stroke();

    // Mimed control, left third; words to the right of it.
    // Sized and nudged down so the tallest frame of the tallest glyph
    // (the hand at the top of its hop) still sits inside the panel.
    const glyphX = View.w / 2 - cardW * 0.33;
    const glyphS = cardH * 0.34;
    this._tutorialGlyph(ctx, step.id, glyphX, cardY + cardH * 0.06, glyphS, t, done);

    const textX = View.w / 2 + cardW * 0.09;
    const maxText = cardW * 0.6;
    ctx.fillStyle = C.paper;
    let size = 42;
    ctx.font = this.font(size);
    while (ctx.measureText(step.title).width > maxText && size > 18) {
      size -= 2;
      ctx.font = this.font(size);
    }
    ctx.fillText(step.title, textX, cardY - cardH * 0.14);

    ctx.fillStyle = C.lilac;
    let bsize = 26;
    ctx.font = this.font(bsize);
    while (ctx.measureText(step.body).width > maxText && bsize > 13) {
      bsize -= 1;
      ctx.font = this.font(bsize);
    }
    ctx.fillText(step.body, textX, cardY + cardH * 0.19);

    // Where we are in the lesson. Inside the panel and under the copy:
    // loose on the path outside it they read as three more collectibles.
    const n = CONFIG.TUTORIAL_STEPS.length;
    const dotR = cardH * 0.035;
    const gap = dotR * 3.4;
    const dy = cardY + cardH * 0.36;
    for (let i = 0; i < n; i++) {
      const x = textX + (i - (n - 1) / 2) * gap;
      ctx.fillStyle = i <= game.tutorialStep ? C.turquoise : 'rgba(255,255,255,0.30)';
      ctx.beginPath();
      ctx.arc(x, dy, i === game.tutorialStep ? dotR * 1.35 : dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  _tutorialGlyph(ctx, id, cx, cy, s, t, done) {
    const C = CONFIG.COLORS;
    ctx.save();
    ctx.strokeStyle = done ? C.turquoise : C.paper;
    ctx.fillStyle = done ? C.turquoise : C.paper;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.16;

    if (done) {
      // A tick, drawn once the control has been performed.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.52, cy);
      ctx.lineTo(cx - s * 0.14, cy + s * 0.40);
      ctx.lineTo(cx + s * 0.56, cy - s * 0.46);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // dir -1 points left, +1 points right — the tip is on the dir side.
    const chevron = (x, dir, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(x - dir * s * 0.22, cy - s * 0.42);
      ctx.lineTo(x + dir * s * 0.20, cy);
      ctx.lineTo(x - dir * s * 0.22, cy + s * 0.42);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    if (id === 'steer') {
      // Two chevrons taking turns, and a body leaning with them.
      const sway = Math.sin(t * 2.6);
      chevron(cx - s * 0.85, -1, 0.45 + 0.55 * Math.max(0, -sway));
      chevron(cx + s * 0.85, 1, 0.45 + 0.55 * Math.max(0, sway));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sway * 0.30);
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.10, s * 0.34, s * 0.30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = s * 0.12;
      ctx.beginPath();
      ctx.moveTo(-s * 0.14, s * 0.18); ctx.lineTo(-s * 0.14, s * 0.52);
      ctx.moveTo(s * 0.14, s * 0.18);  ctx.lineTo(s * 0.14, s * 0.52);
      ctx.stroke();
      ctx.restore();
    } else if (id === 'collect') {
      // Three drops falling on a loop.
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.9 + i / 3) % 1);
        ctx.globalAlpha = Math.sin(k * Math.PI);
        this.dropIcon(ctx, cx + (i - 1) * s * 0.62,
                      cy - s * 0.45 + k * s * 0.9, s * 0.42);
      }
      ctx.globalAlpha = 1;
    } else if (id === 'jump') {
      // A hand rising, and a hop over a cloud below it.
      const k = (t * 1.5) % 1;
      const lift = Math.sin(k * Math.PI);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.52, s * 0.52, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.16 - lift * s * 0.62,
                  s * 0.30, s * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = s * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.26, cy - s * 0.06 - lift * s * 0.62);
      ctx.lineTo(cx - s * 0.44, cy - s * 0.46 - lift * s * 0.62);
      ctx.moveTo(cx + s * 0.26, cy - s * 0.06 - lift * s * 0.62);
      ctx.lineTo(cx + s * 0.44, cy - s * 0.46 - lift * s * 0.62);
      ctx.stroke();
    }
    ctx.restore();
  },

  /* ---------------- title card ---------------- */

  /* Sparkles scattered around the title. Positions come from a hash
     rather than Math.random, so they hold still between frames and
     only the twinkle moves — re-rolling them every frame reads as
     static, not as sparkle.

     Each one runs its own clock, so they never pulse in unison. */
  _titleSparkles(ctx, cx, cy, boxW, boxH, t) {
    const n = 11;
    ctx.save();
    ctx.fillStyle = CONFIG.COLORS.turquoise;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(i, 7) * 0.5;
      // Ride an ellipse that hugs the type, pushed out a little so the
      // sparkles clear the letterforms.
      const rx = boxW * (0.52 + hash01(i, 1) * 0.14);
      const ry = boxH * (0.72 + hash01(i, 2) * 0.55);
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;

      const clock = t * (1.1 + hash01(i, 3) * 1.6) + hash01(i, 4) * 6.3;
      const twinkle = Math.max(0, Math.sin(clock));
      if (twinkle <= 0.02) continue;
      const size = boxH * (0.10 + hash01(i, 5) * 0.09) * twinkle;
      ctx.globalAlpha = 0.35 + 0.65 * twinkle;
      sparklePath(ctx, x, y, size, clock * 0.4);
      ctx.fill();
    }
    ctx.restore();
  },

  drawTitle(ctx, game) {
    const C = CONFIG.COLORS;
    const t = game.attractTime;

    // The corridor keeps running behind the card; a scrim holds the
    // type legible without hiding the motion.
    ctx.fillStyle = 'rgba(41,10,78,0.80)';
    ctx.fillRect(0, 0, View.w, View.h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cy = View.h;

    /* The standing camera notice, at the top of the card. It has to be
       readable before anyone engages: this screen is what a person is
       looking at while the camera is already watching for them to
       raise their hands, so this is the point of collection. */
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = C.lilac;
    this.fitFont(ctx, CONFIG.ATTRACT_NOTICE, 22, 0.92);
    ctx.fillText(CONFIG.ATTRACT_NOTICE, View.w / 2, cy * 0.034);
    // Studio credit, tucked under the notice so the two small lines
    // read as one block and leave the title its own space.
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = C.lilac;
    this.fitFont(ctx, CONFIG.CREDIT_LINE, 19, 0.6);
    ctx.fillText(CONFIG.CREDIT_LINE, View.w / 2, cy * 0.064);
    ctx.globalAlpha = 1;

    // High score.
    this.pill(ctx, `High score ${this.num(game.highScore)}`, View.w / 2,
              cy * 0.115, 44);

    // Title. Chewy, turquoise, with the artwork's hard shadow.
    const titleY = cy * 0.255;
    const titleSize = this.fitFont(ctx, TITLE, 140, 0.88);
    const titleW = ctx.measureText(TITLE).width;

    // Sparkles first, so they sit behind the letterforms and read as
    // coming off the type rather than sitting on top of it.
    this._titleSparkles(ctx, View.w / 2, titleY, titleW,
                        titleSize * View.s, t);

    // A slow breathe, and a shimmer that cools the turquoise toward
    // white and back. Static type on an attract screen reads as a
    // screenshot; a card nobody believes is live is a card nobody
    // walks up to.
    const breathe = 1 + Math.sin(t * 1.6) * 0.014;
    ctx.save();
    ctx.translate(View.w / 2, titleY);
    ctx.scale(breathe, breathe);
    ctx.font = this.font(titleSize);
    ctx.fillStyle = 'rgba(20,4,42,0.55)';
    ctx.fillText(TITLE, 0, 10 * View.s);
    ctx.fillStyle = C.turquoise;
    ctx.fillText(TITLE, 0, 0);
    ctx.globalAlpha = 0.30 + 0.42 * (0.5 + 0.5 * Math.sin(t * 2.1));
    ctx.fillStyle = C.litRim;
    ctx.fillText(TITLE, 0, 0);
    ctx.restore();

    const subSize = this.fitFont(ctx, SUBTITLE, 84, 0.5);
    /* Baseline separation of a bit over one title line. At 0.82 the
       two lines touched once UI_SCALE went up: the descenders of the
       title ran into the caps below. */
    const subY = titleY + (titleSize * 1.06) * View.s * CONFIG.UI_SCALE;
    ctx.fillStyle = 'rgba(20,4,42,0.5)';
    this.waveText(ctx, SUBTITLE, View.w / 2, subY + 7 * View.s,
                  subSize * 0.10 * View.s, t, 3.0);
    ctx.fillStyle = C.turquoise;
    this.waveText(ctx, SUBTITLE, View.w / 2, subY,
                  subSize * 0.10 * View.s, t, 3.0);

    // Dewy, running on the spot.
    const bob = Math.sin(t * 4.0) * 10 * View.s;
    const dewyH = Math.min(View.h * 0.30, 430 * View.s);
    this.dewyRun(ctx, View.w / 2, cy * 0.55 + bob, dewyH, t, { rate: 7 });

    // Sparkles orbiting her, on three different clocks.
    ctx.fillStyle = C.turquoise;
    for (let i = 0; i < 5; i++) {
      const a = t * (0.5 + i * 0.16) + i * 1.9;
      const rx = dewyH * (0.62 + (i % 3) * 0.16);
      const ry = dewyH * (0.42 + (i % 2) * 0.14);
      const s = dewyH * 0.055 * (0.6 + 0.4 * Math.sin(t * 3 + i));
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 2.4 + i * 1.3);
      sparklePath(ctx, View.w / 2 + Math.cos(a) * rx,
                  cy * 0.55 + bob + Math.sin(a * 1.3) * ry, s, a);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Call to action. The pill pulses so it reads as the live control.
    const pulse = 1 + Math.sin(t * 3) * 0.02;
    const btnY = cy * 0.775;
    ctx.save();
    ctx.translate(View.w / 2, btnY);
    ctx.scale(pulse, pulse);
    this.pill(ctx, this._startPrompt(), 0, 0, 56, {
      fill: C.lilac, ink: C.paper, shadowColor: C.lilacDeep,
    });
    ctx.restore();

    // Optional social line and handles, under the button.
    ctx.fillStyle = C.turquoise;
    if (CONFIG.SOCIAL_LINE) {
      this.fitFont(ctx, CONFIG.SOCIAL_LINE, 34, 0.6);
      ctx.fillText(CONFIG.SOCIAL_LINE, View.w / 2, cy * 0.872);
    }
    if (CONFIG.SOCIAL_TAGS) {
      this.fitFont(ctx, CONFIG.SOCIAL_TAGS, 27, 0.86);
      ctx.fillText(CONFIG.SOCIAL_TAGS, View.w / 2, cy * 0.903);
    }



    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  _startPrompt() {
    /* Always the gesture, never the keyboard. The keys still work —
       they are the operator's fallback — but a stand should only ever
       tell a guest the one thing they are meant to do. */
    return 'Raise both hands to start';
  },

  drawCountdown(ctx, game) {
    const n = Math.ceil(game.countdown);
    if (n <= 0) return;
    const frac = game.countdown - Math.floor(game.countdown);

    ctx.save();
    ctx.translate(View.w / 2, View.h * 0.38);
    ctx.scale(1 + (1 - frac) * 0.3, 1 + (1 - frac) * 0.3);
    ctx.globalAlpha = clamp(frac * 1.8, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = this.font(190);
    ctx.fillStyle = 'rgba(20,4,42,0.5)';
    ctx.fillText(String(n), 0, 12 * View.s);
    ctx.fillStyle = CONFIG.COLORS.turquoise;
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  /* ---------------- score card ---------------- */

  /* The payoff card. Navy, with the turquoise water lapping
     along the bottom third — so the screen splits into two zones and
     the type inverts across the waterline exactly as the start card
     inverts against the corridor. Everything sits in a rounded box
     with a hard coloured shadow, which is the artwork's one recurring
     device.

     Above the line: white and turquoise on navy — the result.
     Below it, on the water: dark ink on turquoise — the invitation. */
  drawScoreCard(ctx, game) {
    const k = Wave.cardIn();
    if (k <= 0) return;
    const C = CONFIG.COLORS;
    const H = View.h;
    const mid = View.w / 2;
    const t = game.overTimer;
    const waterline = 1 - CONFIG.WAVE_REST_LEVEL;

    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(0, (1 - k) * 44 * View.s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- above the waterline: navy ground ---------------------------
    const headY = H * 0.085;
    this.fitFont(ctx, 'Nice run!', 110, 0.7);
    ctx.fillStyle = 'rgba(6,39,65,0.75)';
    ctx.fillText('Nice run!', mid, headY + 9 * View.s);
    ctx.fillStyle = C.turquoise;
    ctx.fillText('Nice run!', mid, headY);

    const spread = View.portrait ? 0.21 : 0.15;
    this._stat(ctx, 'Score', this.num(game.score),
               mid - View.w * spread, H * 0.20);
    this._stat(ctx, 'High score', this.num(game.highScore),
               mid + View.w * spread, H * 0.20);

    ctx.fillStyle = C.paper;
    this.fitFont(ctx, 'You connected', 54, 0.6);
    ctx.fillText('You connected', mid, H * 0.325);

    // The app count — the one number the whole activation is for.
    const big = this.num(game.apps);
    const pop = 1 + Math.max(0, 1 - k) * 0.2;
    ctx.save();
    ctx.translate(mid, H * 0.425);
    ctx.scale(pop, pop);
    this.fitFont(ctx, big, 180, 0.5);
    ctx.fillStyle = 'rgba(6,39,65,0.8)';
    ctx.fillText(big, 0, 10 * View.s);
    ctx.fillStyle = C.turquoise;
    ctx.fillText(big, 0, 0);
    ctx.restore();

    const tail = game.apps === 1 ? 'app into an automated flow'
                                 : 'apps into an automated flow';
    ctx.fillStyle = C.paper;
    this.fitFont(ctx, tail, 54, 0.88);
    ctx.fillText(tail, mid, H * 0.495);

    // Dewy, running along the waterline.
    const dewyH = Math.min(H * 0.23, 400 * View.s);
    const bob = Math.sin(t * 4.2) * 6 * View.s;
    this.dewyRun(ctx, mid, H * waterline - dewyH * 0.13 + bob, dewyH, t, { rate: 7 });

    // --- below the waterline: on the water --------------------------
    /* Both lines inside one box. Two separate elements read as two
       unrelated messages; the invitation and how to act on it are one
       thing. No arrow — it pointed at nothing. */
    this._ctaBox(ctx, mid, H * 0.775);

    if (game.overTimer > CONFIG.GAME_OVER_LOCKOUT) {
      // Where the attract card puts its social line. Pulses, but never
      // dims past readable — this is the one thing on the card the
      // next player in the queue has to notice.
      ctx.globalAlpha = k * (0.78 + 0.22 * Math.sin(t * 3.4));
      ctx.fillStyle = C.navyDeep;
      this.fitFont(ctx, this._replayPrompt(), 34, 0.7);
      ctx.fillText(this._replayPrompt(), mid, H * 0.872);
      ctx.globalAlpha = k;
    }

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  /* The call to action, in the same lozenge the attract card uses for
     its button, at the same height. The two screens book-end a run,
     so their bottoms are laid out identically: box, then a line of
     text. */
  _ctaBox(ctx, cx, cy) {
    const C = CONFIG.COLORS;
    this.pill(ctx, CONFIG.CTA_LINE, cx, cy, 44, {
      fill: C.navy, ink: C.turquoise, shadowColor: 'rgba(6,39,65,0.45)',
    });
  },

  _stat(ctx, label, value, cx, cy) {
    ctx.fillStyle = CONFIG.COLORS.lilac;
    this.fitFont(ctx, label, 36, 0.3);
    // Clear of the pill below, which is now sized against UI_SCALE.
    ctx.fillText(label, cx, cy - 62 * View.s * CONFIG.UI_SCALE);
    this.pill(ctx, value, cx, cy + 22 * View.s, 56, {
      fill: CONFIG.COLORS.paper, ink: CONFIG.COLORS.navy,
      shadowColor: 'rgba(6,39,65,0.55)',
    });
  },

  _replayPrompt() {
    return 'Raise both hands to play again';
  },

  /* ---------------- operator banner ---------------- */

  /* One line telling the operator what the camera is doing. Silent
     once pose is tracking cleanly. */
  drawPoseStatus(ctx, game) {
    let text = null;
    switch (Pose.status) {
      case 'loading':     text = Pose.message || 'starting camera…'; break;
      case 'lost':        text = 'Step into frame'; break;
      case 'failed':      text = 'Camera off, keyboard mode (P to retry)'; break;
      default: return;
    }

    /* On the title card the bottom holds the start button and the
       optional social lines. The banner goes into the gap between Dewy and
       the button instead. It used to sit at 0.862, which landed
       exactly on the social line once that was added. */
    const onTitle = game && game.state === 'ATTRACT';
    const y = View.h * (onTitle ? 0.735 : 0.94);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = this.font(30);
    const w = ctx.measureText(text).width + 56 * View.s;
    const h = 62 * View.s;
    ctx.fillStyle = 'rgba(20,4,42,0.78)';
    roundRectPath(ctx, View.w / 2 - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = CONFIG.COLORS.turquoise;
    ctx.fillText(text, View.w / 2, y + 3 * View.s);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },
};
