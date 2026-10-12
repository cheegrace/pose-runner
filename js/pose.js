/* ============================================================
   INPUT + POSE

   Input is the single interface the game reads. Two things feed it:
     - the keyboard (always available — the permanent fallback)
     - the pose reader below (MediaPipe, webcam, 100% local)

   If the webcam or the model is unavailable for any reason, the
   game keeps running on the keyboard. Pose failure is never fatal.
   ============================================================ */

const Input = {
  mode: 'keyboard',     // 'keyboard' | 'pose'

  _keyLeft: false,      // keyboard steering is held, not queued
  _keyRight: false,
  _poseSteer: 0,        // -1 .. 1, written by the pose reader
  _jump: false,
  _any: false,
  _gesture: false,      // rising edge of "both hands up"
  _skip: false,
  _lock: false,         // operator hold: stay on the attract card

  init() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    window.addEventListener('pointerdown', () => {
      Audio.unlock();
      Audio.resume();
      this._any = true;
    });
  },

  _isLeft(k)  { return k === 'ArrowLeft' || k === 'a' || k === 'A'; },
  _isRight(k) { return k === 'ArrowRight' || k === 'd' || k === 'D'; },
  _isJump(k)  { return k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W'; },

  _onKeyDown(e) {
    // Browsers keep audio silent until a real gesture; this is it.
    Audio.unlock();
    Audio.resume();

    const k = e.key;
    let operator = false;
    if (this._isLeft(k))       { this._keyLeft = true; e.preventDefault(); }
    else if (this._isRight(k)) { this._keyRight = true; e.preventDefault(); }
    else if (this._isJump(k))  { if (!e.repeat) this._jump = true; e.preventDefault(); }
    else if (k === 'Escape' || k === 'Enter') { this._skip = true; operator = true; }
    else if (k === 'p' || k === 'P') { Pose.retry(); operator = true; }
    else if (k === 'c' || k === 'C') { Pose.recalibrate(); operator = true; }
    else if (k === 'm' || k === 'M') { Audio.toggleMute(); operator = true; }
    else if (k === 'l' || k === 'L') { this._lock = !this._lock; operator = true; }

    /* Operator keys are not "any key". Escape in particular used to
       start a run: reaching for it to skip the lesson, or just to get
       out of something, dropped you straight into gameplay. */
    if (!operator) this._any = true;
  },

  _onKeyUp(e) {
    const k = e.key;
    if (this._isLeft(k)) this._keyLeft = false;
    else if (this._isRight(k)) this._keyRight = false;
  },

  /* --- Pushed by the pose reader --- */
  pushJump() { this._jump = true; },
  pushGesture() { this._gesture = true; },
  setSteer(v) { this._poseSteer = clamp(v, -1, 1); },

  /* --- Read by the game --- */

  /* Steering is continuous now, not a lane. Keyboard and pose are
     both live at once: whichever is asking for more wins, so a
     keypress always works even mid-run with the camera tracking. */
  steer() {
    let key = 0;
    if (this._keyLeft) key -= 1;
    if (this._keyRight) key += 1;
    const pose = (Pose.status === 'tracking') ? this._poseSteer : 0;
    return Math.abs(key) > Math.abs(pose) ? key : pose;
  },

  takeJump() { const v = this._jump; this._jump = false; return v; },
  takeAny()  { const v = this._any;  this._any  = false; return v; },

  /* Both hands up, on the rising edge only — the deliberate "I am
     ready" gesture that starts a run. Edge-triggered because a
     player who walks up to the mark already waving would otherwise
     start a run before they had read the screen. */
  takeGesture() { const v = this._gesture; this._gesture = false; return v; },

  /* Esc / Enter — the operator's way past the lesson for a player who
     has already played, or a queue that is backing up. Deliberately
     not "any key": the arrows are the very thing the first card asks
     the player to press. */
  takeSkip() { const v = this._skip; this._skip = false; return v; },

  /* `L` holds the game on the attract card, for setting up or packing
     down without a passer-by starting a run. */
  locked() { return this._lock; },
};


/* ============================================================
   POSE — MediaPipe Pose Landmarker over the local webcam.

   Body mapping (deliberately gross and forgiving):
     lean left / right  -> steer that far, continuously
     either hand above the shoulder -> jump

   Everything is loaded from this folder. No network, ever.
   ============================================================ */

/* MediaPipe landmark indices we care about. "Left" is the player's
   own left, which appears on the RIGHT of an unmirrored camera image. */
const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
};

const Pose = {
  /* 'off' | 'loading' | 'calibrating' | 'tracking' | 'lost' | 'failed' */
  status: 'off',
  message: '',

  landmarker: null,
  video: null,
  stream: null,

  lastVideoTime: -1,
  landmarks: null,

  baseX: 0,          // neutral torso x, captured during calibration
  baseWidth: 0.2,    // shoulder width at calibration (a proxy for distance)
  calibSamples: [],
  calibTime: 0,
  lostTime: 0,

  lean: 0,           // smoothed, normalised: -1 = hard left, +1 = hard right
  steer: 0,          // what the game actually reads
  handsUp: false,
  bothUp: false,
  variant: '',          // which delegate built the landmarker
  dbgCx: 0, dbgRaw: 0, dbgMin: null, dbgMax: null,
  jumpCooldown: 0,

  async init() {
    if (!CONFIG.POSE_ENABLED) { this.status = 'off'; return; }
    this.status = 'loading';
    this.message = 'starting camera…';

    try {
      await this._startCamera();
      this.message = 'loading pose model…';
      await this._loadModel();
      this.recalibrate();
    } catch (err) {
      this._fail(err);
    }
  },

  async _startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('no camera API (are you on localhost?)');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: CONFIG.POSE_VIDEO_W, height: CONFIG.POSE_VIDEO_H },
      audio: false,
    });

    const v = document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = this.stream;
    await v.play();
    this.video = v;
  },

  /* Resolve a bundled path against the page URL.
     This matters: dynamic import() treats "js/lib/x.mjs" as a BARE
     specifier and refuses it. Absolute URLs also keep the library from
     guessing wrong about where the wasm lives. */
  _url(relative) {
    return new URL(relative, document.baseURI).href;
  },

  async _loadModel() {
    // Dynamic import so a missing/broken bundle degrades to keyboard
    // instead of breaking the page load.
    const vision = await import(this._url(CONFIG.POSE_LIB_PATH));
    const fileset = await vision.FilesetResolver.forVisionTasks(
      this._url(CONFIG.POSE_WASM_PATH));

    /* One body, GPU first. The CPU entry is not about crowds: it is
       there so a delegate that will not build cannot take the camera
       away entirely and drop the stand to keyboard. */
    const attempts = [
      { delegate: 'GPU', variant: 'GPU' },
      { delegate: 'CPU', variant: 'CPU' },
    ];

    let lastErr = null;
    for (const a of attempts) {
      try {
        this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: this._url(CONFIG.POSE_MODEL_PATH),
            delegate: a.delegate,
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        this.variant = a.variant;
        console.log(`[pose] landmarker running on ${a.delegate}`);
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[pose] ${a.variant} unavailable:`, err && err.message);
      }
    }
    throw lastErr || new Error('no pose configuration could be created');
  },

  _fail(err) {
    this.status = 'failed';
    this.message = String((err && err.message) || err);
    Input.mode = 'keyboard';
    console.warn('[pose] unavailable, staying on keyboard:', err);
  },

  retry() {
    if (this.status === 'loading' || this.status === 'tracking') return;
    this.landmarker = null;
    this.init();
  },

  recalibrate() {
    this.status = 'calibrating';
    this.message = 'stand on the mark';
    this.calibSamples = [];
    this.calibTime = 0;
  },

  /* Called once per frame from the game loop. */
  update(dt, now) {
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    if (!this.landmarker || !this.video) return;

    // Only run inference when the camera has actually produced a new frame.
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      try {
        const res = this.landmarker.detectForVideo(this.video, now);
        this.landmarks = (res && res.landmarks && res.landmarks[0]) || null;
      } catch (err) {
        this._fail(err);
        return;
      }
    }

    if (!this.landmarks) {
      // Clear the held gesture state, or the next player to step in
      // with their arms already raised gets no rising edge.
      this.bothUp = false;
      this.handsUp = false;
      this.lostTime += dt;
      if (this.status === 'tracking' && this.lostTime > CONFIG.POSE_LOST_TIME) {
        this.status = 'lost';
        this.message = 'step into frame';
      }
      if (this.lostTime > CONFIG.POSE_RECALIBRATE_TIME && this.status !== 'calibrating') {
        this.recalibrate();
      }
      return;
    }

    this.lostTime = 0;
    if (this.status === 'calibrating') this._calibrate(dt);
    else this._track(dt);
  },

  _torso() {
    const lm = this.landmarks;
    const ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER];
    const lh = lm[LM.L_HIP], rh = lm[LM.R_HIP];

    // Torso centre: shoulders and hips together, so a shrug or a
    // reaching arm doesn't read as a lane change.
    const cx = (ls.x + rs.x + lh.x + rh.x) / 4;
    const shoulderWidth = Math.max(Math.abs(ls.x - rs.x), 0.05);
    const shoulderY = (ls.y + rs.y) / 2;
    return { cx, shoulderWidth, shoulderY };
  },

  _calibrate(dt) {
    const t = this._torso();
    this.calibSamples.push(t);
    this.calibTime += dt;

    if (this.calibTime >= CONFIG.POSE_CALIBRATE_TIME) {
      // Median is steadier than a mean when a frame or two goes weird.
      const xs = this.calibSamples.map((s) => s.cx).sort((a, b) => a - b);
      const ws = this.calibSamples.map((s) => s.shoulderWidth).sort((a, b) => a - b);
      this.baseX = xs[Math.floor(xs.length / 2)];
      this.baseWidth = Math.max(ws[Math.floor(ws.length / 2)], 0.05);

      this.lean = 0;
      this.steer = 0;
      this.dbgMin = null;
      this.dbgMax = null;
      this.status = 'tracking';
      this.message = '';
      Input.mode = 'pose';
    }
  },

  _track(dt) {
    const lm = this.landmarks;
    const t = this._torso();

    // Offset from the neutral pose, in shoulder-widths — so it reads
    // the same whether the player stands near or far from the camera.
    let raw = (t.cx - this.baseX) / this.baseWidth;
    if (CONFIG.POSE_MIRROR) raw = -raw;

    // Kept for the debug readout: an asymmetric lean is almost always
    // a framing problem rather than a maths one, and the only way to
    // tell is to see baseX and the raw travel either side of it.
    this.dbgCx = t.cx;
    this.dbgRaw = raw;
    this.dbgMin = Math.min(this.dbgMin == null ? raw : this.dbgMin, raw);
    this.dbgMax = Math.max(this.dbgMax == null ? raw : this.dbgMax, raw);

    // Smooth hard: pose jitter must never twitch the steering.
    const a = 1 - Math.exp(-CONFIG.POSE_SMOOTHING_RATE * dt);
    this.lean += (clamp(raw, -2, 2) - this.lean) * a;

    // Continuous steering with a dead zone, so standing still is
    // genuinely still and a full lean is a full turn.
    const mag = Math.abs(this.lean);
    let steer = 0;
    if (mag > CONFIG.POSE_LEAN_DEADZONE) {
      const span = Math.max(CONFIG.POSE_LEAN_RANGE - CONFIG.POSE_LEAN_DEADZONE, 0.01);
      steer = Math.sign(this.lean) * clamp((mag - CONFIG.POSE_LEAN_DEADZONE) / span, 0, 1);
    }
    this.steer = steer;
    Input.setSteer(steer);
    this.status = 'tracking';

    // Jump: either wrist above the shoulder line, on the rising edge.
    const wristY = Math.min(lm[LM.L_WRIST].y, lm[LM.R_WRIST].y);
    const up = wristY < t.shoulderY - CONFIG.POSE_JUMP_MARGIN;

    if (up && !this.handsUp && this.jumpCooldown <= 0) {
      Input.pushJump();
      this.jumpCooldown = CONFIG.POSE_JUMP_COOLDOWN;
    }
    this.handsUp = up;

    // Both wrists up — the "I'm ready" gesture that starts a run and
    // replays one. Fired on the rising edge so holding a pose does
    // not re-trigger, and so a player who walks to the mark with
    // their arms already up gets to read the screen first.
    const wasBothUp = this.bothUp;
    this.bothUp = lm[LM.L_WRIST].y < t.shoulderY - CONFIG.POSE_JUMP_MARGIN &&
                  lm[LM.R_WRIST].y < t.shoulderY - CONFIG.POSE_JUMP_MARGIN;
    if (this.bothUp && !wasBothUp) Input.pushGesture();
  },

  active() {
    return this.status === 'tracking' || this.status === 'calibrating' ||
           this.status === 'lost';
  },

  /* Small mirrored preview + the landmarks we actually use.
     Doubles as the operator's "is it seeing the player?" readout. */
  drawDebug(ctx) {
    if (!CONFIG.SHOW_POSE_DEBUG || !this.video) return;

    const w = CONFIG.POSE_PREVIEW_W * View.s;
    const h = w * (CONFIG.POSE_VIDEO_H / CONFIG.POSE_VIDEO_W);
    const x = View.w - w - 24 * View.s;
    const y = View.h - h - 24 * View.s;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(x, y);

    // Mirror the preview so the player sees themselves as in a mirror.
    ctx.save();
    if (CONFIG.POSE_MIRROR) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    try { ctx.drawImage(this.video, 0, 0, w, h); } catch (e) { /* not ready */ }

    if (this.landmarks) {
      const pts = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST,
                   LM.L_HIP, LM.R_HIP];
      ctx.fillStyle = CONFIG.COLORS.accent;
      for (const i of pts) {
        const p = this.landmarks[i];
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 3 * View.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(237,230,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    /* The numbers that actually diagnose a one-sided lean.

       `neutral` is where the player was standing when the pose was
       zeroed: 0.50 means dead centre of frame. Anything far from that
       and one direction runs out of picture before it runs out of
       steering. `travel` is the furthest raw lean seen each way since
       the last calibration — if those two are lopsided, the camera is
       not pointed where the player stands. */
    const f = (v) => (v == null ? '--' : (v >= 0 ? ' ' : '') + v.toFixed(2));
    ctx.font = `${Math.round(11 * View.s)}px monospace`;
    ctx.fillStyle = 'rgba(237,230,255,0.9)';
    ctx.textAlign = 'left';
    const rows = [
      `neutral ${f(this.baseX)}  width ${f(this.baseWidth)}`,
      `now     ${f(this.dbgCx)}  raw   ${f(this.dbgRaw)}`,
      `travel  L ${f(this.dbgMax)}  R ${f(this.dbgMin)}`,
      `steer   ${f(this.steer)}  (full at ${CONFIG.POSE_LEAN_RANGE})`,
    ];
    rows.forEach((line, i) => {
      ctx.fillText(line, 0, h + 26 * View.s + i * 13 * View.s);
    });

    // Lean meter: dead zone marked, current lean as a needle.
    const my = h + 8 * View.s, mh = 6 * View.s;
    ctx.fillStyle = 'rgba(237,230,255,0.15)';
    ctx.fillRect(0, my, w, mh);
    const dz = (CONFIG.POSE_LEAN_DEADZONE / 2) * w;
    ctx.fillStyle = 'rgba(110,231,249,0.25)';
    ctx.fillRect(w / 2 - dz, my, dz * 2, mh);
    ctx.fillStyle = CONFIG.COLORS.hud;
    const nx = clamp(w / 2 + (this.lean / 2) * w, 0, w - 3 * View.s);
    ctx.fillRect(nx, my - 2 * View.s, 3 * View.s, mh + 4 * View.s);

    ctx.restore();
  },
};
