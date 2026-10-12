/* ============================================================
   ENTITIES — Dewy, and everything on the path with her.

   Every world object is pinned to an absolute depth (`worldZ`), so
   the world scrolls by advancing one number: Game.travel.
   ============================================================ */

/* ------------------------------------------------------------
   DEWY

   Drawn as the artwork's own run cycle: a body PNG with four limbs
   composited over it. All the parts were exported on one shared
   canvas, so they line up by being drawn into the same box — no
   per-limb offsets to keep in sync.
   ------------------------------------------------------------ */

/* Back-to-front: far leg, trailing arm, body, near legs, leading arm.
   Every back rig has the same five parts on the same canvas. */
/* Two stacking orders, because the two sets of artwork are built
   differently. The R2 turned pair split around the body: a trailing
   leg and arm behind it, the near leg and leading arm in front. The
   centre cycle puts every limb over the body, which is how those
   frames are drawn — reconstructing them any other way does not match
   the artwork. A part a rig does not have is simply skipped. */
const RIG_ORDER_SPLIT = ['legFar', 'armBack', 'body', 'legs', 'armFront'];
const RIG_ORDER_OVER = ['body', 'legs', 'armBack', 'armFront'];

const CENTRE_FRAMES = ['c-1', 'c-2', 'c-3', 'c-4'];

// Where Dewy's centre of mass sits inside the shared rig canvas.
const RIG_ANCHOR_X = 0.543;

class Dewy {
  constructor() { this.reset(); }

  reset() {
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.runTime = 0;
    this.lean = 0;
    this.steerSmooth = 0;
    this.squash = 1;
    this.turned = 0;       // -1 left rig, 0 centre, +1 right rig
    this.falling = false;
    this.fallTime = 0;
    this.fallSpin = 0;
  }

  jump() {
    if (!this.grounded || this.falling) return;
    this.vy = CONFIG.JUMP_VELOCITY;
    this.grounded = false;
    this.squash = 0.82;
    Audio.sfx('jump');
  }

  /* steer: -1 .. 1. During a boost the game drives this itself. */
  update(dt, steer, speedFrac) {
    if (this.falling) {
      this.fallTime += dt;
      this.fallSpin += dt * 7;
      this.vy -= CONFIG.GRAVITY * 0.8 * dt;
      this.y += this.vy * dt;
      return;
    }

    // Smooth the *input*, then integrate it at full rate. Smoothing
    // the position instead — x += (target - x) * k — quietly caps the
    // real steering rate at a fraction of STEER_SPEED, which made the
    // sharper turns literally unfollowable however hard you leaned.
    this.steerSmooth += (clamp(steer, -1, 1) - this.steerSmooth)
                      * (1 - Math.exp(-CONFIG.STEER_SMOOTH * dt));
    const prev = this.x;
    this.x += this.steerSmooth * CONFIG.STEER_SPEED * dt;

    // Lean into the turn, proportional to how fast we are sliding.
    const slide = (this.x - prev) / Math.max(dt, 1e-4);
    const leanTarget = clamp(slide / 950, -1, 1) * CONFIG.MAX_LEAN;
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-11 * dt));

    if (!this.grounded) {
      this.vy -= CONFIG.GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.squash = 1.18;
      }
    } else {
      this.runTime += dt * (0.7 + speedFrac * 0.6);
    }

    this.squash += (1 - this.squash) * (1 - Math.exp(-14 * dt));
  }

  /* Stop the player steering themselves off the outside of the path.

     This only ever blocks movement the player caused this frame. If
     the ribbon turned and left Dewy behind, her offset grows without
     her steering at all — that is the failure the game is about, and
     it is deliberately not caught here. She can always steer back.

     `offBefore` is her offset measured after the world scrolled but
     before she steered, which is what separates the two cases. */
  blockOuterEdge(centre, offBefore) {
    if (!CONFIG.EDGE_BLOCK) return;
    // Pinned at the painted edge, not at the fall line: Dewy should
    // look like she is running along the rim of the path, not hovering
    // over the void beside it. FALL_MARGIN is grace for the ribbon
    // moving out from under her, which is a different thing.
    const limit = CONFIG.PATH_HALF;
    const off = this.x - centre;
    if (Math.abs(off) <= limit) return;
    if (Math.abs(off) <= Math.abs(offBefore)) return;   // the path moved, not her
    const allowed = Math.max(limit, Math.abs(offBefore));
    this.x = centre + Math.sign(off) * allowed;
  }

  /* Pull Dewy toward a lateral target, ignoring the steering rate.
     Used only while a boost is driving: the victory lap has to stay
     on the ribbon by construction, not by out-steering it. */
  autoFollow(dt, targetX, weight) {
    if (weight <= 0) return;
    const k = (1 - Math.exp(-CONFIG.BOOST_AUTOSTEER * dt)) * weight;
    this.x += (targetX - this.x) * k;
  }

  startFall(direction) {
    if (this.falling) return;
    this.falling = true;
    this.fallTime = 0;
    this.vy = 260;
    this.fallDir = direction;
  }

  /* Which frame of the centre run cycle is showing. Four frames to a
     stride, so a frame lasts a quarter turn of the run clock. */
  frame() {
    const n = CENTRE_FRAMES.length;
    const i = Math.floor(this.runTime * CONFIG.RUN_CYCLE / (Math.PI * 2 / n));
    return ((i % n) + n) % n;
  }

  /* Which back rig to draw. Leaning far enough turns Dewy's body into
     the turn; near centre she runs the four-frame cycle.

     The hysteresis is not decoration. Pose steering sits wherever the
     player's torso happens to be, and a bare threshold would flip the
     body back and forth several times a second for anyone holding a
     lean near it. */
  rigName() {
    const s = this.steerSmooth;
    if (this.turned !== 0) {
      if (Math.abs(s) < CONFIG.RIG_TURN_RELEASE ||
          Math.sign(s) !== this.turned) this.turned = 0;
    }
    if (this.turned === 0 && Math.abs(s) > CONFIG.RIG_TURN_ENTER) {
      this.turned = Math.sign(s);
    }
    if (this.turned < 0) return 'left';
    if (this.turned > 0) return 'right';
    return CENTRE_FRAMES[this.frame()];
  }

  draw(ctx, opts) {
    opts = opts || {};
    const z = CONFIG.PLAYER_Z;
    const bob = (this.grounded && !this.falling)
      ? Math.abs(Math.sin(this.runTime * CONFIG.RUN_CYCLE / 2)) * CONFIG.RUN_BOB
      : 0;

    const ground = View.project(this.x, 0, z);
    const scale = ground.scale;
    const h = CONFIG.PLAYER_HEIGHT * scale;
    // Reads the first centre frame, not a hardcoded name: if the rig
    // list is ever renamed again, this follows it instead of silently
    // dropping Dewy back to the placeholder blob.
    const rig = Assets.part(CENTRE_FRAMES[0], 'body');
    const aspect = rig ? (Assets.rigWidth / Assets.rigHeight) : 0.98;
    const w = h * aspect;

    const lift = (this.y + bob) * scale;

    // Contact shadow, shrinking as Dewy rises.
    if (!this.falling) {
      const air = clamp(this.y / 180, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.26 * (1 - air * 0.75);
      ctx.fillStyle = CONFIG.COLORS.pathShadow;
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y, w * 0.22 * (1 - air * 0.3), w * 0.055,
                  0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(ground.x, ground.y - lift);
    if (this.falling) {
      ctx.rotate(this.fallSpin * (this.fallDir || 1));
      ctx.globalAlpha = clamp(1 - this.fallTime / CONFIG.FALL_TIME, 0, 1);
    } else {
      ctx.rotate(this.lean);
      ctx.scale(1 / Math.sqrt(this.squash), this.squash);
    }

    if (opts.boost) this._boostGlow(ctx, w, h);

    const x0 = -w * RIG_ANCHOR_X;
    const y0 = -h;

    if (rig) this._drawRig(ctx, x0, y0, w, h, opts);
    else this._drawFallback(ctx, w, h);

    ctx.restore();
  }

  _drawRig(ctx, x0, y0, w, h, opts) {
    const rig = this.rigName();
    const turned = rig === 'left' || rig === 'right';
    const airborne = !this.grounded && !this.falling;
    const up = !!opts.boost || airborne;

    /* The turned rigs are one drawn pose each, so their run is
       animated here: one sine, legs opposite each other and arms
       opposite the legs. The centre cycle needs none of this — it has
       four real frames, and rotating those on top only fights the
       artwork. */
    const swing = turned ? Math.sin(this.runTime * CONFIG.RUN_CYCLE) : 0;
    const amp = CONFIG.LIMB_SWING_TURN;
    const legAmp = CONFIG.LIMB_SWING_LEG;

    const put = (part, rot, pivot) => {
      const img = Assets.part(rig, part);
      if (!img) return;                  // a rig without this part
      if (!rot) { ctx.drawImage(img, x0, y0, w, h); return; }
      const px = x0 + pivot[0] * w, py = y0 + pivot[1] * h;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.translate(-px, -py);
      ctx.drawImage(img, x0, y0, w, h);
      ctx.restore();
    };

    // Both arms up, for a boost and for the top of a jump. Rotated
    // rather than swapped: every rig now has exactly one pair of arms,
    // so there is no second frame to borrow a raised one from.
    const backRot = up ? CONFIG.ARM_RAISE : swing * amp;
    const frontRot = up ? -CONFIG.ARM_RAISE : -swing * amp;
    const legRot = up ? swing * legAmp * 0.35 : -swing * legAmp;

    const rots = {
      legFar: [-legRot, CONFIG.PIVOT_HIP],
      legs: [legRot, CONFIG.PIVOT_HIP],
      armBack: [backRot, CONFIG.PIVOT_ARM_BACK],
      armFront: [frontRot, CONFIG.PIVOT_ARM_FRONT],
      body: [0, null],
    };
    for (const part of (turned ? RIG_ORDER_SPLIT : RIG_ORDER_OVER)) {
      const [rot, pivot] = rots[part];
      put(part, rot, pivot);
    }
  }

  /* Used only if the PNGs are missing — the game still plays. */
  _drawFallback(ctx, w, h) {
    const C = CONFIG.COLORS;
    ctx.fillStyle = C.dewy;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.55, w * 0.42, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.dewyLine;
    ctx.lineWidth = Math.max(1.5, w * 0.035);
    ctx.beginPath();
    ctx.moveTo(-w * 0.12, -h * 0.16); ctx.lineTo(-w * 0.12, 0);
    ctx.moveTo(w * 0.12, -h * 0.16); ctx.lineTo(w * 0.12, 0);
    ctx.stroke();
  }

  _boostGlow(ctx, w, h) {
    const r = w * 0.72;
    const g = ctx.createRadialGradient(0, -h * 0.5, 0, 0, -h * 0.5, r);
    g.addColorStop(0, 'rgba(102,235,218,0.22)');
    g.addColorStop(0.55, 'rgba(102,235,218,0.09)');
    g.addColorStop(1, 'rgba(102,235,218,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(-r, -h * 0.5 - r, r * 2, r * 2);
    ctx.restore();
  }
}


/* ------------------------------------------------------------
   World objects
   ------------------------------------------------------------ */

class WorldEntity {
  constructor(x, worldZ) {
    this.x = x;
    this.worldZ = worldZ;
    this.alive = true;
    this.age = 0;
  }

  zRel(travel) { return this.worldZ - travel; }
  update(dt) { this.age += dt; }

  /* Did this cross Dewy's plane between the last frame and now? */
  crossedPlayer(prevTravel, travel) {
    return (this.worldZ - prevTravel) > CONFIG.PLAYER_Z &&
           (this.worldZ - travel) <= CONFIG.PLAYER_Z;
  }
}

/* ---------------- Sparkle dewdrop ---------------- */
class Dewdrop extends WorldEntity {
  constructor(x, worldZ) {
    super(x, worldZ);
    this.type = 'dewdrop';
    this.phase = Math.random() * Math.PI * 2;
  }

  y() {
    return CONFIG.DROP_Y +
           Math.sin(this.age * CONFIG.DROP_BOB_SPEED + this.phase) * CONFIG.DROP_BOB;
  }

  draw(ctx, travel) {
    const C = CONFIG.COLORS;
    const z = this.zRel(travel);
    if (z < View.zMin * 0.75) return;    // behind the camera
    const p = View.project(this.x, this.y(), z);
    const size = CONFIG.DROP_SIZE * p.scale;
    if (size < 1.2) return;

    ctx.save();
    if (drawDrop(ctx, p.x, p.y, size)) { ctx.restore(); return; }

    // Body.
    dropPath(ctx, p.x, p.y, size);
    ctx.fillStyle = C.drop;
    ctx.fill();

    if (size > 12) {
      // The curved shadow inside the belly, straight from the artwork.
      ctx.strokeStyle = C.dropDeep;
      ctx.lineWidth = size * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(p.x, p.y + size * 0.14, size * 0.26, Math.PI * 0.15, Math.PI * 0.72);
      ctx.stroke();

      // Highlight.
      ctx.fillStyle = C.dropShine;
      ctx.beginPath();
      ctx.ellipse(p.x - size * 0.16, p.y - size * 0.12,
                  size * 0.10, size * 0.13, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ---------------- Grumpy cloud — the one lethal thing ---------------- */
class Cloud extends WorldEntity {
  constructor(x, worldZ) {
    super(x, worldZ);
    this.type = 'cloud';
    this.seed = Math.floor(Math.random() * 10000);
    this.phase = Math.random() * Math.PI * 2;
    this.harmless = false;   // true for the ones the lesson lays down
  }

  y() {
    return CONFIG.CLOUD_Y + Math.sin(this.age * 1.7 + this.phase) * 10;
  }

  draw(ctx, travel) {
    const C = CONFIG.COLORS;
    const z = this.zRel(travel);
    if (z < View.zMin * 0.75) return;
    const p = View.project(this.x, this.y(), z);
    const s = CONFIG.CLOUD_SIZE * p.scale;
    if (s < 1.5) return;

    ctx.save();
    ctx.translate(p.x, p.y);

    // A lumpy grey blob: overlapping discs at stable offsets.
    ctx.fillStyle = C.cloud;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = s * (0.20 + hash01(this.seed, i) * 0.12);
      ctx.moveTo(Math.cos(a) * s * 0.24 + rr, Math.sin(a) * s * 0.16);
      ctx.arc(Math.cos(a) * s * 0.24, Math.sin(a) * s * 0.16, rr, 0, Math.PI * 2);
    }
    ctx.moveTo(s * 0.32, 0);
    ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // The scribble. Tight loops, so it reads as a knot of tangled work.
    if (s > 14) {
      ctx.strokeStyle = C.cloudLine;
      ctx.lineWidth = Math.max(1.4, s * 0.055);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const n = 44;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = t * Math.PI * 6.5 + this.seed;
        const rr = s * (0.10 + 0.24 * Math.abs(Math.sin(t * Math.PI * 1.9 + this.seed)));
        const px = Math.cos(a) * rr * 1.45;
        const py = Math.sin(a * 1.35) * rr * 0.95;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------------- Totem — two stacked shapes, the boost ---------------- */
class Totem extends WorldEntity {
  constructor(x, worldZ) {
    super(x, worldZ);
    this.type = 'totem';
    this.taken = false;
    // A stack of shapes, bottom to top, all different. Not just
    // different from the one below: the same mark appearing twice
    // anywhere in one tower reads as a glitch.
    this.stack = Shapes.sample(CONFIG.TOTEM_STACK);
    this.spin = 0;
  }

  update(dt) {
    this.age += dt;
    if (this.taken) this.spin += dt * 9;
  }

  draw(ctx, travel) {
    const z = this.zRel(travel);
    if (z < View.zMin * 0.75) return;
    const p = View.project(this.x, 0, z);
    const size = CONFIG.TOTEM_SIZE * p.scale;
    if (size < 2) return;

    const pulse = 0.55 + 0.45 * Math.sin(this.age * 3.4);
    const hover = Math.sin(this.age * 2.1) * size * 0.05;

    ctx.save();
    if (this.taken) ctx.globalAlpha = clamp(1 - (this.age % 1) * 2, 0, 1);

    // Glow so it reads from the far end of the corridor, tinted by
    // the stack it surrounds rather than a fixed pink.
    const tint = hexToRgb(this.stack[0].color);
    const glowY = p.y - size * (0.4 + 0.7 * this.stack.length);
    const glowR = size * (0.9 + 0.65 * this.stack.length);
    const g = ctx.createRadialGradient(p.x, glowY, 0, p.x, glowY, glowR);
    g.addColorStop(0, `rgba(${tint},${(0.34 * pulse).toFixed(3)})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(p.x - glowR, glowY - glowR, glowR * 2, glowR * 2);

    // Contact shadow.
    ctx.globalAlpha *= 0.5;
    ctx.fillStyle = CONFIG.COLORS.pathShadow;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, size * 0.42, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = this.taken ? clamp(1 - (this.age % 1) * 2, 0, 1) : 1;

    /* Bottom to top, each dome a little smaller than the one under it
       and sitting on its shoulders. Alternating spin so a taken totem
       unwinds rather than rotating as one lump. */
    let y = p.y - size * 0.42 + hover;
    let sz = size;
    for (let i = 0; i < this.stack.length; i++) {
      Shapes.draw(ctx, this.stack[i], p.x, y, sz,
                  { rotation: (i % 2 === 0) ? this.spin : -this.spin });
      y -= sz * 0.76;
      sz *= CONFIG.TOTEM_TAPER;
    }

    ctx.restore();
  }
}


/* ============================================================
   SHAPE BURST — the app leaving its doorway.

   Thrown out of the panel as it connects, it arcs onto the path,
   bounces once, then rolls along the floor and fades. It is pure
   decoration: it never collides and never scores. The point is that
   connecting should look like something coming *out* of the alcove
   and joining the flow, rather than a panel quietly changing colour.
   ============================================================ */

class ShapeBurst extends WorldEntity {
  constructor(spec, x, worldZ, side) {
    super(x, worldZ);
    this.type = 'burst';
    this.spec = spec;
    this.y = CONFIG.DOOR_HEIGHT * 0.5;
    // Inward, toward the middle of the corridor.
    this.vx = -side * CONFIG.BURST_SPEED * rand(0.8, 1.2);
    this.vy = CONFIG.BURST_LIFT * rand(0.85, 1.15);
    this.vz = rand(-140, 60);
    this.rot = 0;
    this.bounced = false;
  }

  update(dt) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.worldZ += this.vz * dt;
    this.vy -= CONFIG.BURST_GRAVITY * dt;

    if (this.y <= 0) {
      this.y = 0;
      if (!this.bounced) {
        this.bounced = true;
        this.vy = CONFIG.BURST_LIFT * CONFIG.BURST_BOUNCE;
      } else {
        this.vy = 0;
        this.vx *= Math.exp(-2.2 * dt);   // rolls to a stop
      }
    }

    // Rolling: spin tied to how fast it is travelling, so it looks
    // like the floor is turning it rather than a free spin.
    this.rot += (this.vx / 160) * CONFIG.BURST_SPIN * dt;
    if (this.age >= CONFIG.BURST_LIFE) this.alive = false;
  }

  draw(ctx, travel) {
    const z = this.zRel(travel);
    if (z < View.zMin * 0.6) return;
    const p = View.project(this.x, this.y, z);
    const size = CONFIG.SHAPE_SIZE * 0.5 * p.scale;
    if (size < 1) return;

    const fade = clamp(1 - this.age / CONFIG.BURST_LIFE, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, fade * 1.6);

    // Contact shadow while it is near the floor.
    if (this.y < 120) {
      const g = View.project(this.x, 0, z);
      ctx.save();
      ctx.globalAlpha *= 0.3 * (1 - this.y / 120);
      ctx.fillStyle = CONFIG.COLORS.pathShadow;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, size * 0.5, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    Shapes.draw(ctx, this.spec, p.x, p.y, size, { rotation: this.rot });
    ctx.restore();
  }
}


/* ============================================================
   PARTICLES — the sparkles.

   World-space, pinned to an absolute z, so they scroll and scale
   with everything else. The pool is capped: sparkles are decoration
   and must never be a frame-rate risk.
   ============================================================ */

class Particle {
  constructor() { this.life = 0; }

  spawn(x, y, worldZ, opts) {
    opts = opts || {};
    this.x = x;
    this.y = y;
    this.worldZ = worldZ;
    this.vx = (Math.random() - 0.5) * 2 * (opts.spread != null ? opts.spread : 80);
    this.vy = (opts.rise != null ? opts.rise : 110) * (0.5 + Math.random());
    this.vz = (Math.random() - 0.5) * 70;
    this.life = (opts.life != null ? opts.life : 1.1) * (0.7 + Math.random() * 0.6);
    this.maxLife = this.life;
    this.size = (opts.size != null ? opts.size : 26) * (0.6 + Math.random() * 0.8);
    // Each sparkle gets its own screen ceiling. A single shared cap
    // makes every near sparkle exactly the same size, and a handful
    // overlapping then reads as one many-pointed blob.
    this.maxPx = CONFIG.PARTICLE_MAX_PX * (0.45 + Math.random() * 0.75);
    this.color = opts.color || CONFIG.COLORS.litFlush;
    this.spin = (Math.random() - 0.5) * 5;
    this.rot = Math.random() * Math.PI;
    return this;
  }

  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.worldZ += this.vz * dt;
    this.rot += this.spin * dt;
    this.vy *= 0.982;
  }
}

const Particles = {
  pool: [],
  ambientAcc: 0,

  reset() {
    for (const p of this.pool) p.life = 0;
    this.ambientAcc = 0;
  },

  count() {
    let n = 0;
    for (const p of this.pool) if (p.life > 0) n++;
    return n;
  },

  _take() {
    for (const p of this.pool) if (p.life <= 0) return p;
    if (this.pool.length >= CONFIG.PARTICLE_MAX) return null;
    const p = new Particle();
    this.pool.push(p);
    return p;
  },

  burst(x, y, worldZ, count, opts) {
    for (let i = 0; i < count; i++) {
      const p = this._take();
      if (!p) return;
      p.spawn(x, y, worldZ, opts);
    }
  },

  /* A steady drift rising off the trail Dewy has already turned. */
  ambient(dt, game) {
    const rate = game.boostTimer > 0
      ? CONFIG.BOOST_SPARKLE_RATE : CONFIG.AMBIENT_SPARKLE_RATE;
    this.ambientAcc += dt * rate;
    while (this.ambientAcc >= 1) {
      this.ambientAcc -= 1;
      const z = game.travel + View.zMin
              + Math.random() * (CONFIG.PLAYER_Z - View.zMin);
      const cx = Track.centerX(z);
      const x = cx + (Math.random() - 0.5) * 2 * CONFIG.PATH_HALF;
      this.burst(x, 8, z, 1, {
        rise: 70, spread: 30, life: 1.5, size: 14,
        color: Math.random() < 0.35 ? CONFIG.COLORS.litFlush : CONFIG.COLORS.drop,
      });
    }
  },

  update(dt, travel) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.update(dt);
      if (p.worldZ - travel < 40) p.life = 0;
    }
  },

  draw(ctx, travel) {
    ctx.save();
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      const pz = p.worldZ - travel;
      if (pz < View.zMin * 0.7) continue;
      const proj = View.project(p.x, p.y, pz);
      // Capped, or a sparkle right under the camera fills the frame.
      const s = Math.min(p.size * proj.scale, p.maxPx * View.s);
      if (s < 0.6) continue;

      // Fade out as a sparkle passes the camera. Without this the
      // ones clamped to the size cap pile up at the bottom of the
      // frame and read as one spiky rosette rather than as sparkles.
      const near = clamp((pz - View.zMin * 0.7) / (View.zMin * 0.55), 0, 1);
      ctx.globalAlpha = Math.min(1, p.life / p.maxLife) * 0.95 * near;
      ctx.fillStyle = p.color;
      if (s < 3) {
        ctx.fillRect(proj.x - s / 2, proj.y - s / 2, s, s);
      } else {
        sparklePath(ctx, proj.x, proj.y, s, p.rot);
        ctx.fill();
      }
    }
    ctx.restore();
  },
};
