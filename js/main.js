/* ============================================================
   MAIN — the game loop and the state machine.

   ATTRACT -> CONSENT -> TUTORIAL -> COUNTDOWN -> PLAYING -> DYING
           -> GAME_OVER -> replay, or back to ATTRACT when nobody is there

   ATTRACT is the resting state, not just the opening one. Anything
   else on screen means somebody is stood at the machine, so when they
   stop being there — no input on the score card, or nobody in frame
   mid-run — the game returns to attracting on its own.

   TUTORIAL is a real run of the corridor with the teeth pulled:
   nothing can kill you and nothing scores. Each card names one
   control and waits until the player performs it, so they arrive at
   the run already knowing how to steer, collect and jump.

   DYING is its own state because the run has to be visibly over
   before the wave starts: Dewy tumbles or recoils for a beat, then
   the dewdrops rain.
   ============================================================ */

const STATE = {
  ATTRACT: 'ATTRACT',
  CONSENT: 'CONSENT',
  TUTORIAL: 'TUTORIAL',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  DYING: 'DYING',
  GAME_OVER: 'GAME_OVER',
};

const Game = {
  state: STATE.ATTRACT,

  travel: 0,
  prevTravel: 0,
  speed: CONFIG.BASE_SPEED,
  drops: 0,          // dewdrops collected — this IS the score
  apps: 0,           // doorways connected
  totems: 0,
  streak: 0,         // consecutive drops, drives the collect pitch
  highScore: 0,
  fps: 60,

  entities: [],
  dewy: null,

  countdown: 0,
  tutorialStep: 0,
  tutorialTime: 0,
  tutorialDone: false,     // the step on screen has been performed
  boostTimer: 0,
  handoffTimer: 0,   // control blending back after a boost
  dyingTimer: 0,
  overTimer: 0,
  attractTime: 0,
  dropPulse: 0,      // 1 -> 0 swell on the HUD when a counter ticks up
  appPulse: 0,
  idle: 0,           // seconds since the player last did anything
  taught: false,     // the lesson has been shown to whoever is here now
  consentTime: 0,
  edgeWarn: 0,
  coyote: 0,       // seconds spent off the ribbon, so far

  /* The score is not a separate number. Connecting an app and taking
     a totem both pay out in dewdrops, so there is exactly one thing
     on the HUD and one thing to beat. */
  get score() { return this.drops; },

  init() {
    View.init(document.getElementById('game'));
    Assets.load();
    Input.init();
    Pose.init();       // async on purpose — keyboard works immediately
    this.dewy = new Dewy();
    this.highScore = this._loadHighScore();
    this.resetRun();
    this.state = STATE.ATTRACT;
  },

  /* ---------------- high score ---------------- */

  _loadHighScore() {
    try {
      const v = parseInt(localStorage.getItem(CONFIG.HIGH_SCORE_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) {
      return 0;      // private mode, or storage disabled — not fatal
    }
  },

  _saveHighScore() {
    if (this.score <= this.highScore) return;
    this.highScore = this.score;
    try {
      localStorage.setItem(CONFIG.HIGH_SCORE_KEY, String(this.highScore));
    } catch (e) { /* nothing to do; the number still shows this session */ }
  },

  /* ---------------- run lifecycle ---------------- */

  resetRun() {
    this.travel = 0;
    this.prevTravel = 0;
    this.speed = CONFIG.BASE_SPEED;
    this.drops = 0;
    this.apps = 0;
    this.totems = 0;
    this.streak = 0;
    this.boostTimer = 0;
    this.handoffTimer = 0;
    this.dyingTimer = 0;
    this.dropPulse = 0;
    this.appPulse = 0;
    this.edgeWarn = 0;
    this.coyote = 0;
    this.entities = [];
    this.dewy.reset();
    Track.reset();
    Spawner.reset();
    Particles.reset();
    Wave.reset();
    FX.reset();
    Mist.reset();
  },

  startRun() {
    this.resetRun();
    Audio.resume();
    Audio.setIntensity(0);   // the calm attract bed, all run long
    Audio.sfx('start');

    // Shown once to whoever is stood here. A second run is the same
    // person playing again — they have just been taught.
    if (CONFIG.TUTORIAL_ENABLED && CONFIG.TUTORIAL_STEPS.length && !this.taught) {
      this.state = STATE.TUTORIAL;
      this._beginStep(0);
    } else {
      this._beginCountdown();
    }
  },

  _beginCountdown() {
    this.countdown = CONFIG.COUNTDOWN_TIME;
    this.state = STATE.COUNTDOWN;
    this._lastCount = Math.ceil(this.countdown);
  },

  /* ---------------- update ---------------- */

  update(dt) {
    Pose.update(dt, performance.now());
    FX.update(dt);
    Mist.update(dt);
    const fade = Math.exp(-6 * dt);
    this.dropPulse *= fade;
    this.appPulse *= fade;
    Track.ensure(this.travel + CONFIG.DRAW_DISTANCE + 1200);
    // Recolour the corridor for this frame before anything draws.
    Scheme.at(this.travel);

    switch (this.state) {
      case STATE.ATTRACT:   this.updateAttract(dt);   break;
      case STATE.CONSENT:   this.updateConsent(dt);   break;
      case STATE.TUTORIAL:  this.updateTutorial(dt);  break;
      case STATE.COUNTDOWN: this.updateCountdown(dt); break;
      case STATE.PLAYING:   this.updatePlaying(dt);   break;
      case STATE.DYING:     this.updateDying(dt);     break;
      case STATE.GAME_OVER: this.updateGameOver(dt);  break;
    }
  },

  /* The corridor keeps flowing behind the title card — it doubles as
     an attract-mode demo of the transformation. */
  updateAttract(dt) {
    this.attractTime += dt;
    this.prevTravel = this.travel;
    this.travel += CONFIG.BASE_SPEED * 0.4 * dt;
    // Drift Dewy along the path so the trail behind her keeps lighting.
    this.dewy.x += (Track.centerX(this.travel + CONFIG.PLAYER_Z) - this.dewy.x)
                 * (1 - Math.exp(-4 * dt));
    this.dewy.update(dt, 0, 0.2);
    this.worldFX(dt);
    Input.takeJump();
    Input.takeSkip();
    // Both hands up is the deliberate gesture the card asks for. The
    // keyboard stays live underneath it: if the camera never comes up,
    // the stand still has a playable game.
    const start = Input.takeGesture() || Input.takeAny();
    if (start && !Input.locked()) {
      this.consentTime = 0;
      this.idle = 0;
      this.state = STATE.CONSENT;
      Audio.resume();
      Audio.sfx('count');
    }
  },

  /* The camera notice. Confirmed with the same gesture that got them
     here, so there is one thing to learn and it is the thing the game
     is controlled with. */
  updateConsent(dt) {
    this.consentTime += dt;
    this.idle += dt;
    this.prevTravel = this.travel;
    this.travel += CONFIG.BASE_SPEED * 0.25 * dt;
    this.dewy.update(dt, 0, 0.15);
    this.worldFX(dt);
    Input.takeJump();
    Input.takeSkip();

    // A moment's lockout so the gesture that opened this card cannot
    // also dismiss it before it has been read.
    if (this.consentTime < 0.8) { Input.takeGesture(); Input.takeAny(); return; }
    if (Input.takeGesture() || Input.takeAny()) { this.startRun(); return; }
    if (this.idle > CONFIG.ATTRACT_TIMEOUT) this.toAttract();
  },

  /* Back to the resting state, and forget the player who just left —
     the next person at the machine has not seen the lesson. */
  toAttract() {
    this.taught = false;
    this.idle = 0;
    Pose.lostTime = 0;
    this.attractTime = 0;
    this.resetRun();
    this.state = STATE.ATTRACT;
    Audio.setIntensity(0);
  },

  /* ---------------- the lesson ---------------- */

  step() { return CONFIG.TUTORIAL_STEPS[this.tutorialStep] || null; },

  _beginStep(i) {
    this.tutorialStep = i;
    this.tutorialTime = 0;
    this.tutorialDone = false;
    this._seenLeft = false;
    this._seenRight = false;
    this._tutDrops = 0;
    this._tutJumped = false;
    this._tutCleared = false;
    this._tutCloudAt = 0;
  },

  updateTutorial(dt) {
    if (this.checkAbandoned(dt)) return;
    const step = this.step();
    if (!step) { this._finishTutorial(); return; }
    this.tutorialTime += dt;

    // Skip is a dedicated key, never "any key" — the arrows are the
    // steering the first card is asking the player to try.
    if (Input.takeSkip()) { this._finishTutorial(); return; }

    const steer = Input.steer();
    if (Input.takeJump()) { this.dewy.jump(); this._tutJumped = true; }
    if (steer < -CONFIG.TUTORIAL_STEER_MIN) this._seenLeft = true;
    if (steer > CONFIG.TUTORIAL_STEER_MIN) this._seenRight = true;

    // A gentle, fixed pace — there is no ramp and no boost in here.
    this.speed += (CONFIG.BASE_SPEED * CONFIG.TUTORIAL_SPEED - this.speed)
                * (1 - Math.exp(-5 * dt));
    this.prevTravel = this.travel;
    this.travel += this.speed * dt;

    this.dewy.update(dt, steer, 0.15);
    // A safety net, not autopilot: it only pulls once the player has
    // drifted near the edge, so steering still feels like theirs.
    const centre = Track.centerX(this.travel + CONFIG.PLAYER_Z);
    const off = Math.abs(this.dewy.x - centre) / CONFIG.PATH_HALF;
    if (off > 0.9) this.dewy.autoFollow(dt, centre, clamp((off - 0.9) * 2, 0, 1));

    if (step.id === 'jump') this._practiceCloud(dt);

    this.worldFX(dt);
    Spawner.update(this);
    this.updateEntities(dt);
    this.checkDoorways();

    if (!this.tutorialDone && this._stepSolved(step)) {
      this.tutorialDone = true;
      Audio.sfx('connect');
      FX.trigger(0.18, CONFIG.COLORS.turquoise);
    }

    const settled = this.tutorialDone && this.tutorialTime >= CONFIG.TUTORIAL_HOLD;
    if (settled || this.tutorialTime >= step.max) {
      if (this.tutorialStep + 1 < CONFIG.TUTORIAL_STEPS.length) {
        this._beginStep(this.tutorialStep + 1);
      } else {
        this._finishTutorial();
      }
    }
  },

  _stepSolved(step) {
    switch (step.id) {
      case 'steer':   return this._seenLeft && this._seenRight;
      case 'collect': return this._tutDrops >= CONFIG.TUTORIAL_DROPS;
      // Not `_tutJumped`: pressing jump the moment the card appears
      // used to tick it off and start the countdown while the cloud
      // was still coming, so the player never saw themselves clear it.
      // The lesson is the hop, so the hop has to happen.
      case 'jump':    return this._tutCleared;
      default:        return true;
    }
  },

  /* Lay a cloud dead on the centreline so it cannot be side-stepped:
     this card is about the jump, and a player who swerves past has
     not learned it. Another follows until they hop one. */
  _practiceCloud(dt) {
    if (this._tutCleared) return;
    this._tutCloudAt -= dt;
    if (this._tutCloudAt > 0) return;
    this._tutCloudAt = CONFIG.TUTORIAL_CLOUD_EVERY;
    const z = this.travel + CONFIG.PLAYER_Z + CONFIG.TUTORIAL_CLOUD_AHEAD;
    const cloud = new Cloud(Track.centerX(z), z);
    cloud.harmless = true;
    this.entities.push(cloud);
  },

  /* The lesson does not score. The world carries straight on — same
     corridor, same path, same doorways — so the handover reads as the
     run simply starting, not as a scene change. */
  _finishTutorial() {
    this.taught = true;
    this.drops = 0;
    this.apps = 0;
    this.totems = 0;
    this.streak = 0;
    for (const e of this.entities) if (e.type === 'cloud') e.harmless = false;
    this._beginCountdown();
  },

  updateCountdown(dt) {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this._lastCount && n > 0) {
      this._lastCount = n;
      Audio.sfx('count');
    }
    this.dewy.update(dt, 0, 0.3);
    this.worldFX(dt);
    Input.takeJump();
    Input.takeAny();
    if (this.countdown <= 0) this.state = STATE.PLAYING;
  },

  /* Nobody in front of the camera for a while: whoever started this
     run has walked off, so hand the screen back to the attract card
     for the next person. Only ever triggers when the camera is the
     input — a keyboard player is not "lost" just because the pose
     reader cannot see them. */
  checkAbandoned(dt) {
    // Keyboard mode has no idea whether anyone is there, so it never
    // abandons a run.
    if (Pose.status === 'failed' || Pose.status === 'off') return false;

    // Ask the pose reader how long since it last saw a body, rather
    // than watching for the 'lost' status. After a few seconds with an
    // empty frame the reader gives up and re-arms for the next player,
    // which moves it off 'lost' and would reset a timer watching for
    // that — so the run would never time out at all.
    if (Pose.lostTime < CONFIG.ABANDON_TIME) return false;
    this.toAttract();
    return true;
  },

  worldFX(dt) {
    Particles.update(dt, this.travel);
    Particles.ambient(dt, this);
    Track.cull(this.travel);
    for (const d of Track.doors) d.update(dt);
  },

  updatePlaying(dt) {
    if (this.checkAbandoned(dt)) return;
    const boosting = this.boostTimer > 0;

    // During a boost the game drives Dewy itself: the player gets a
    // hands-free victory lap, still scoring.
    let steer = 0;
    if (boosting) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) this.endBoost();
    } else {
      steer = Input.steer();
      if (Input.takeJump()) this.dewy.jump();
      if (this.handoffTimer > 0) this.handoffTimer = Math.max(0, this.handoffTimer - dt);
    }

    // Speed.
    const ramp = Math.min(CONFIG.MAX_SPEED,
                          CONFIG.BASE_SPEED + this.travel * CONFIG.SPEED_RAMP);
    const target = boosting ? CONFIG.BOOST_SPEED : ramp;
    this.speed += (target - this.speed) * (1 - Math.exp(-5 * dt));

    this.prevTravel = this.travel;
    this.travel += this.speed * dt;

    const speedFrac = clamp((this.speed - CONFIG.BASE_SPEED)
                          / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED), 0, 1);

    // Measured after the world scrolled, before she steers: the gap
    // between this and her offset afterwards is the part she caused.
    const centre = Track.centerX(this.travel + CONFIG.PLAYER_Z);
    const offBefore = this.dewy.x - centre;
    this.dewy.update(dt, steer, speedFrac);
    this.dewy.blockOuterEdge(centre, offBefore);

    // Auto-follow, at full strength through the boost and fading out
    // across the handoff, so control comes back without a lurch.
    this.dewy.autoFollow(dt, centre, this.autoWeight());

    if (boosting) this._boostSparkles(dt);

    this.worldFX(dt);
    Spawner.update(this);
    this.updateEntities(dt);
    this.checkDoorways();
    this.checkFooting(dt);
  },

  /* 1 while a boost is driving, easing to 0 across the handoff. */
  autoWeight() {
    if (this.boostTimer > 0) return 1;
    return clamp(this.handoffTimer / CONFIG.BOOST_HANDOFF, 0, 1);
  },

  /* The invariant the whole difficulty rests on: nothing may end the
     run while the game, rather than the player, is steering. That
     covers the boost itself and the handoff after it — during the
     handoff the boost is technically over, but Dewy is still being
     pulled back to the centreline and a cloud arriving right then is
     one the player had no way to dodge. */
  playerInControl() {
    return this.autoWeight() <= 0.25;
  },

  updateDying(dt) {
    this.dyingTimer += dt;
    // The world coasts to a stop rather than snapping.
    this.speed *= Math.exp(-3.2 * dt);
    this.prevTravel = this.travel;
    this.travel += this.speed * dt;
    this.dewy.update(dt, 0, 0);
    this.worldFX(dt);
    this.updateEntities(dt);

    if (this.dyingTimer > CONFIG.FALL_TIME) this.endRun();
  },

  updateGameOver(dt) {
    this.overTimer += dt;
    Wave.update(dt);
    Particles.update(dt, this.travel);
    // Dewy keeps tumbling under the rain until the water takes her.
    this.dewy.update(dt, 0, 0);

    if (Wave.cardIn() >= 1 && !this._cardChimed) {
      this._cardChimed = true;
      Audio.sfx('card');
    }

    // Ignore stray input for a beat so the last frantic keypress
    // does not skip the score screen.
    const ready = this.overTimer > CONFIG.GAME_OVER_LOCKOUT && Wave.cardIn() >= 1;
    if (ready && (Input.takeGesture() || Input.takeAny())) {
      this.idle = 0;
      this.startRun();      // straight back in: same player, already taught
      return;
    }
    Input.takeAny();
    Input.takeGesture();
    this.idle += dt;
    if (this.idle > CONFIG.ATTRACT_TIMEOUT) this.toAttract();
  },

  /* ---------------- world interactions ---------------- */

  updateEntities(dt) {
    const keep = [];
    for (const e of this.entities) {
      e.update(dt);
      const live = this.state === STATE.PLAYING || this.state === STATE.TUTORIAL;
      if (live && e.crossedPlayer(this.prevTravel, this.travel)) {
        this.resolve(e);
      }
      if (e.alive && e.zRel(this.travel) > 40) keep.push(e);
    }
    this.entities = keep;
  },

  resolve(e) {
    const dx = Math.abs(this.dewy.x - e.x);
    const boosting = this.boostTimer > 0;

    if (e.type === 'dewdrop') {
      // A boost auto-collects: the whole point is that the player
      // does not have to do anything.
      if (dx < CONFIG.COLLECT_X || boosting) { this.collect(e); this._tutDrops++; }
      else this.streak = 0;
      return;
    }

    if (e.type === 'totem') {
      if (this.state === STATE.TUTORIAL) return;   // no boost mid-lesson
      if (!e.taken && (dx < CONFIG.TOTEM_HIT_X || boosting)) {
        e.taken = true;
        e.age = 0;
        this.totems++;
        this.award(CONFIG.TOTEM_DROPS, e.x, 240, e.worldZ);
        this.startBoost(e);
      }
      return;
    }

    if (e.type === 'cloud') {
      // Two ways past a cloud: steer around it, or jump it. The jump
      // is the one the tutorial teaches, so it has to actually work —
      // CLOUD_Y and CLOUD_CLEAR_Y are set against JUMP_VELOCITY so a
      // well-timed hop clears the hit box with room either side.
      const over = this.dewy.y >= CONFIG.CLOUD_CLEAR_Y;

      // The lesson's own cloud: passing over it is what completes the
      // card. Steering around it does not count — that card is about
      // the jump, which is why it is laid on the centreline.
      if (e.harmless && over && dx < CONFIG.CLOUD_HIT_X) {
        this._tutCleared = true;
        Audio.sfx('connect');
      }

      if (dx < CONFIG.CLOUD_HIT_X && !over &&
          this.playerInControl() && !this.dewy.falling && !e.harmless) {
        this.hitCloud(e);
      }
    }
  },

  collect(e) {
    e.alive = false;
    this.drops++;
    this.dropPulse = 1;
    this.streak++;
    Particles.burst(e.x, e.y(), e.worldZ, CONFIG.SPARKLE_ON_COLLECT, {
      color: CONFIG.COLORS.drop, spread: 140, rise: 170, life: 0.8, size: 22,
    });
    Audio.sfx('drop', this.streak - 1);
  },

  /* A doorway is connected if Dewy is still on the path, on that
     doorway's side, when it goes past. Following the path is
     therefore the whole of the skill — which is the metaphor. */
  checkDoorways() {
    const playerZ = this.travel + CONFIG.PLAYER_Z;
    const prevZ = this.prevTravel + CONFIG.PLAYER_Z;

    for (const door of Track.doors) {
      if (door.connected || door.missed) continue;

      /* Connect the moment Dewy draws level with the near edge of the
         panel, not when she passes its centre. Waiting for the centre
         meant the turquoise arrived when she was already alongside and
         looking past it — the flood read as something that happened
         to her rather than something she did. */
      if (playerZ < door.z0) continue;
      const past = playerZ > door.z1;

      // Two ways to count as having gone through: be on the
      // doorway's side of the corridor, or be riding the middle of
      // the ribbon — which by then has swung over to that side
      // anyway. Both require still being on the path.
      //
      // The middle-of-the-ribbon clause is measured against the
      // ribbon, never against the corridor: a player who simply
      // stands in the centre of the screen and never steers must not
      // collect every app for free.
      const onPath = Track.onPath(this.dewy.x, playerZ);
      const centred = Math.abs(this.dewy.x - Track.centerX(playerZ))
                    < CONFIG.PATH_HALF * 0.5;
      const rightSide = this.dewy.x * door.side > 0 || centred;

      if (onPath && rightSide && !this.dewy.falling) this.connect(door);
      else if (past) door.missed = true;   // still alongside: keep trying
    }
  },

  connect(door) {
    door.connected = true;
    door.connectAge = 0;
    this.apps++;
    this.appPulse = 1;

    // Sparkles thrown from the doorway back across the path — the
    // app joining the flow — and a payout in drops.
    const x = CONFIG.CORRIDOR_HALF * door.side * 0.8;

    // The app itself comes out of the alcove and rolls onto the path.
    this.entities.push(new ShapeBurst(door.shape, x, door.z, door.side));

    Particles.burst(x, 260, door.z, CONFIG.SPARKLE_ON_CONNECT, {
      color: CONFIG.COLORS.litFlush, spread: 320, rise: 190, life: 1.3, size: 30,
    });
    this.award(CONFIG.DOOR_DROPS, x * 0.5, 220, door.z);
    FX.trigger(0.16, CONFIG.COLORS.litFlush);
    Audio.sfx('connect');
  },

  /* A bonus, paid in the only currency the game has. The burst makes
     it legible: the drops visibly arrive rather than the counter
     silently jumping. */
  award(drops, x, y, worldZ) {
    this.drops += drops;
    Particles.burst(x, y, worldZ, Math.min(drops, 22), {
      color: CONFIG.COLORS.drop, spread: 220, rise: 210, life: 1.1, size: 26,
    });
  },

  startBoost(totem) {
    this.boostTimer = CONFIG.BOOST_TIME;
    Audio.setIntensity(1);   // a lift for the boost, not a gear change
    Audio.sfx('totem');
    Audio.sfx('boost');
    FX.trigger(0.42, CONFIG.COLORS.boostFlash);
    FX.kick(10);
    Particles.burst(totem.x, 200, totem.worldZ, 40, {
      color: CONFIG.COLORS.litFlush, spread: 300, rise: 260, life: 1.4, size: 34,
    });
    fireMist('sparkle totem');
  },

  endBoost() {
    this.boostTimer = 0;
    this.handoffTimer = CONFIG.BOOST_HANDOFF;
    Audio.setIntensity(0);   // the calm attract bed, all run long
  },

  _boostSparkles(dt) {
    // A dense trail streaming off Dewy while the boost runs.
    this._boostAcc = (this._boostAcc || 0) + dt * 38;
    while (this._boostAcc >= 1) {
      this._boostAcc -= 1;
      Particles.burst(this.dewy.x + rand(-90, 90), rand(20, 260),
                      this.travel + CONFIG.PLAYER_Z + rand(-60, 40), 1, {
        color: Math.random() < 0.5 ? CONFIG.COLORS.litFlush : CONFIG.COLORS.drop,
        spread: 60, rise: 40, life: 0.7, size: 30,
      });
    }
  },

  /* Off the ribbon = into the ether. */
  checkFooting(dt) {
    if (this.dewy.falling || !this.playerInControl()) { this.coyote = 0; return; }
    const z = this.travel + CONFIG.PLAYER_Z;
    const off = Track.offPathAmount(this.dewy.x, z);

    // Audible warning while Dewy is out past the fill but still safe.
    if (off > 0.86) {
      this.edgeWarn -= dt;
      if (this.edgeWarn <= 0) { Audio.sfx('edge'); this.edgeWarn = 0.22; }
    } else {
      this.edgeWarn = 0;
    }

    // Teeter, then fall. Getting back over the edge resets it, so a
    // player who overshoots a corner and corrects keeps their run.
    if (Track.onPath(this.dewy.x, z)) {
      this.coyote = 0;
    } else {
      this.coyote += dt;
      if (this.coyote >= CONFIG.COYOTE_TIME) this.fall();
    }
  },

  /* 0 -> 1 as the teeter runs out. Drives the wobble and the flash. */
  teeter() {
    return clamp(this.coyote / CONFIG.COYOTE_TIME, 0, 1);
  },

  fall() {
    this.dewy.startFall(Math.sign(this.dewy.x - Track.centerX(this.travel + CONFIG.PLAYER_Z)) || 1);
    this.state = STATE.DYING;
    this.dyingTimer = 0;
    Audio.sfx('fall');
    Audio.setIntensity(0);
  },

  hitCloud(cloud) {
    cloud.alive = false;
    this.state = STATE.DYING;
    this.dyingTimer = 0;
    this.dewy.startFall(0);
    this.dewy.vy = 420;
    FX.trigger(0.45, CONFIG.COLORS.hitFlash);
    FX.kick(22);
    Audio.sfx('cloud');
    Audio.setIntensity(0);
  },

  endRun() {
    this._saveHighScore();
    this._cardChimed = false;
    this.overTimer = 0;
    this.state = STATE.GAME_OVER;
    Wave.start();
    fireMist('end of run');
  },

  /* ---------------- render ---------------- */

  render() {
    const ctx = View.ctx;
    ctx.clearRect(0, 0, View.w, View.h);

    const shaken = FX.applyShake(ctx);

    Corridor.draw(ctx, this);
    this.drawWorld(ctx);
    Particles.draw(ctx, this.travel);

    if (shaken) ctx.restore();

    switch (this.state) {
      case STATE.ATTRACT:
        UI.drawTitle(ctx, this);
        break;
      case STATE.CONSENT:
        UI.drawConsent(ctx, this);
        break;
      case STATE.TUTORIAL:
        UI.drawHUD(ctx, this);
        UI.drawTutorial(ctx, this);
        break;
      case STATE.COUNTDOWN:
        UI.drawHUD(ctx, this);
        UI.drawCountdown(ctx, this);
        break;
      case STATE.PLAYING:
      case STATE.DYING:
        if (this.boostTimer > 0) UI.drawBoostRush(ctx, this);
        UI.drawTeeter(ctx, this);
        UI.drawHUD(ctx, this);
        break;
      case STATE.GAME_OVER:
        Wave.backdrop(ctx);
        Wave.draw(ctx);
        UI.drawScoreCard(ctx, this);
        break;
    }

    FX.draw(ctx);
    Pose.drawDebug(ctx);
    if (this.state !== STATE.GAME_OVER) UI.drawPoseStatus(ctx, this);
  },

  /* Painter's algorithm: far entities first, Dewy dropped in at her
     own depth so anything nearer paints over her. */
  drawWorld(ctx) {
    const sorted = this.entities.slice()
      .sort((a, b) => b.zRel(this.travel) - a.zRel(this.travel));

    let drawn = false;
    for (const e of sorted) {
      if (!drawn && e.zRel(this.travel) < CONFIG.PLAYER_Z) {
        this.drawDewy(ctx);
        drawn = true;
      }
      e.draw(ctx, this.travel);
    }
    if (!drawn) this.drawDewy(ctx);
  },

  drawDewy(ctx) {
    // On the title card the running Dewy would collide with the
    // front-on Dewy on the poster. The world still runs — she is
    // just not drawn — so the trail keeps lighting behind her.
    if (this.state === STATE.ATTRACT) return;
    this.dewy.draw(ctx, { boost: this.boostTimer > 0 });
  },
};

/* ---------------- Loop ---------------- */
let _last = performance.now();
let _fpsAccum = 0, _fpsFrames = 0;

function frame(now) {
  // Clamp dt so an alt-tab or a hitch cannot teleport Dewy off the path.
  const dt = Math.min((now - _last) / 1000, 0.05);
  _last = now;

  _fpsAccum += dt;
  _fpsFrames++;
  if (_fpsAccum >= 0.25) {
    Game.fps = _fpsFrames / _fpsAccum;
    _fpsAccum = 0;
    _fpsFrames = 0;
  }

  Game.update(dt);
  Game.render();
  requestAnimationFrame(frame);
}

window.addEventListener('load', () => {
  Game.init();
  requestAnimationFrame(frame);
});
