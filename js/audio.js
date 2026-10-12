/* ============================================================
   AUDIO — every sound in the game is synthesised here, live.

   Why synthesis and not sound files: the build spec's hard rule is
   that the game runs with the venue's wifi off, and that no asset
   comes from a CDN. Generating the music and the effects from
   oscillators keeps the whole soundtrack at a few kB of code, so
   there is nothing to download, nothing to license, and nothing to
   go missing on the show floor. It also lets the music react — the
   boost genuinely opens the filter and adds an octave rather than
   crossfading to a second file.

   The music is a four-bar loop in F# minor pentatonic: a soft bass
   pulse, a plucked arpeggio, a held pad, and a light kit. Scheduling
   uses the standard lookahead pattern — a timer that stays well
   ahead of the audio clock, so nothing is at the mercy of the
   frame rate.

   Browsers block audio until the player interacts, so everything
   stays silent until unlock() is called from a real gesture.
   ============================================================ */

/* Long enough that a loop is never audible as a loop, short enough
   that building it once costs nothing worth measuring. */
const NOISE_SECONDS = 2.5;

const Audio = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  musicFilter: null,
  started: false,
  muted: false,

  /* Scheduler state */
  step: 0,
  nextNoteTime: 0,
  timer: null,
  LOOKAHEAD: 0.12,      // seconds of audio scheduled ahead of the clock
  TICK: 25,             // ms between scheduler wake-ups

  intensity: 0,         // 0 = idle screens, 1 = mid-run, 2 = boosting

  /* F# minor pentatonic, two octaves. Every melodic voice draws from
     this, which is why nothing in the game can play a wrong note. */
  SCALE: [92.50, 110.00, 123.47, 138.59, 164.81,
          185.00, 220.00, 246.94, 277.18, 329.63,
          370.00, 440.00, 493.88, 554.37, 659.25],

  BASS: [0, 0, 3, 3, 5, 5, 1, 1],          // one index per bar-half
  ARP: [7, 9, 11, 9, 12, 11, 9, 7,
        6, 8, 11, 8, 13, 11, 8, 6],

  unlock() {
    if (this.started || !CONFIG.AUDIO_ENABLED) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      // Music runs through a lowpass that opens up during a boost.
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 1400;
      this.musicFilter.Q.value = 0.7;

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.musicFilter);
      this.musicFilter.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = CONFIG.SFX_VOLUME;
      this.sfxGain.connect(this.master);

      this.started = true;
      this.nextNoteTime = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this._schedule(), this.TICK);
      this.setIntensity(0);
    } catch (e) {
      console.warn('[audio] unavailable, running silent:', e);
      this.started = false;
    }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9,
                                       this.ctx.currentTime, 0.05);
    }
    return this.muted;
  },

  /* 0 idle, 1 running, 2 boosting. Changes volume, filter and the
     density of the kit — the loop itself never restarts. */
  setIntensity(level) {
    this.intensity = level;
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const vol = level === 0 ? CONFIG.MUSIC_VOLUME * 0.55
              : level === 2 ? CONFIG.MUSIC_VOLUME * 1.25
              : CONFIG.MUSIC_VOLUME;
    const cut = level === 0 ? 900 : level === 2 ? 6500 : 2200;
    this.musicGain.gain.setTargetAtTime(vol, t, 0.25);
    this.musicFilter.frequency.setTargetAtTime(cut, t, 0.18);
  },

  /* ---------------- the sequencer ---------------- */

  _stepTime() {
    // Sixteenths, sped up a touch while boosting.
    const bpm = CONFIG.MUSIC_BPM * (this.intensity === 2 ? 1.12 : 1);
    return 15 / bpm;
  },

  _schedule() {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    let guard = 0;
    while (this.nextNoteTime < now + this.LOOKAHEAD && guard++ < 40) {
      this._playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += this._stepTime();
      this.step = (this.step + 1) % 64;
    }
  },

  _playStep(step, t) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const busy = this.intensity > 0;

    // Bass: a long pulse on every half bar.
    if (s === 0 || s === 8) {
      const note = this.SCALE[this.BASS[(bar * 2 + (s === 8 ? 1 : 0)) % 8]];
      this._voice({
        t, freq: note, type: 'sine', dest: this.musicGain,
        attack: 0.01, decay: 0.55, peak: 0.5,
      });
      this._voice({
        t, freq: note * 2, type: 'triangle', dest: this.musicGain,
        attack: 0.01, decay: 0.30, peak: 0.12,
      });
    }

    // Pad: a held fifth under the whole bar, quiet.
    if (s === 0) {
      const root = this.SCALE[this.BASS[(bar * 2) % 8] + 7];
      for (const f of [root, root * 1.5]) {
        this._voice({
          t, freq: f, type: 'triangle', dest: this.musicGain,
          attack: 0.25, decay: 1.6, peak: 0.055,
        });
      }
    }

    // Arpeggio: eighths when idle, sixteenths once the run is on.
    if (busy || s % 2 === 0) {
      const idx = this.ARP[(bar % 2) * 8 + (s % 8)] + (this.intensity === 2 ? 2 : 0);
      this._voice({
        t, freq: this.SCALE[Math.min(idx, this.SCALE.length - 1)],
        type: 'triangle', dest: this.musicGain,
        attack: 0.004, decay: this.intensity === 2 ? 0.16 : 0.22,
        peak: busy ? 0.16 : 0.10,
      });
    }

    if (!busy) return;

    // Kit. A soft kick on the quarters, hats on the offbeats.
    if (s % 4 === 0) this._kick(t);
    if (s % 2 === 1) this._hat(t, this.intensity === 2 ? 0.045 : 0.028);
    if (this.intensity === 2 && s % 4 === 2) this._hat(t, 0.035);
  },

  /* ---------------- primitives ---------------- */

  /* One enveloped oscillator. Every melodic sound in the game is
     this function; only the numbers change.

     A non-finite frequency or a zero peak throws inside the Web Audio
     API and takes the frame with it, so both are checked here rather
     than at each of the dozen call sites. A wrong note is a bug; a
     thrown exception mid-run is an outage. */
  _voice(o) {
    if (!Number.isFinite(o.freq) || o.freq <= 0 ||
        !Number.isFinite(o.peak) || o.peak <= 0 ||
        !Number.isFinite(o.t)) {
      console.warn('[audio] skipped a bad voice', o);
      return;
    }
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.glide) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(o.glide, 1), o.t + (o.decay || 0.2));
    }
    gain.gain.setValueAtTime(0.0001, o.t);
    gain.gain.exponentialRampToValueAtTime(o.peak, o.t + (o.attack || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, o.t + (o.decay || 0.2));
    osc.connect(gain);
    gain.connect(o.dest || this.sfxGain);
    osc.start(o.t);
    osc.stop(o.t + (o.decay || 0.2) + 0.05);
  },

  _kick(t) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(t); osc.stop(t + 0.2);
  },

  _hat(t, level) {
    const src = this._noise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(hp); hp.connect(g); g.connect(this.musicGain);
    src.start(t, src._offset); src.stop(t + 0.06);
  },

  /* A short buffer of white noise — the basis for hats, whooshes
     and the water in the end-of-run wave. */
  /* White noise, from one buffer made once.

     This used to allocate a fresh AudioBuffer per call and fill it a
     sample at a time — about 34,000 Math.random() calls for a 0.7s
     whoosh, on the main thread, at the exact moment the player takes a
     totem. That is a hitch you can feel, and it landed on the frame
     least able to afford it.

     One buffer covers every caller: a BufferSource is cheap, and the
     playback offset is randomised so repeats do not sound identical. */
  _noiseBuffer: null,

  _noise() {
    if (!this._noiseBuffer) {
      const n = Math.max(1, Math.floor(this.ctx.sampleRate * NOISE_SECONDS));
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuffer = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    // Start somewhere different every time. Without this the hats,
    // which fire twice a bar, would replay the same 50ms of noise and
    // read as one clicking sample rather than as a kit.
    src._offset = Math.random() * this._noiseBuffer.duration;
    return src;
  },

  /* ---------------- effects ---------------- */

  sfx(name, arg) {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime + 0.001;
    const S = this.SCALE;

    switch (name) {
      case 'drop': {
        // Climbs with the streak, then resets — the classic reward
        // ladder. Capped to the top of the scale: a long run pushes
        // this index further every drop, and running off the end of
        // the array feeds NaN straight into an AudioParam.
        const step = Math.min(Math.max(arg || 0, 0), S.length - 1 - 4);
        this._voice({ t, freq: S[4 + step], type: 'sine',
                      attack: 0.004, decay: 0.13, peak: 0.20 });
        this._voice({ t: t + 0.012, freq: S[4 + step] * 2, type: 'triangle',
                      attack: 0.004, decay: 0.09, peak: 0.08 });
        break;
      }
      case 'connect': {
        // A bright stacked chord — the sound of two things joining.
        [7, 9, 11, 14].forEach((n, i) => {
          this._voice({ t: t + i * 0.035, freq: S[n], type: 'triangle',
                        attack: 0.01, decay: 0.7, peak: 0.19 });
        });
        this._shimmer(t + 0.05, 0.5);
        break;
      }
      case 'totem': {
        [4, 7, 9, 11, 12, 14].forEach((n, i) => {
          this._voice({ t: t + i * 0.045, freq: S[n], type: 'square',
                        attack: 0.005, decay: 0.28, peak: 0.10 });
        });
        break;
      }
      case 'boost': {
        this._whoosh(t, 0.7, 400, 5200);
        this._voice({ t, freq: S[2], glide: S[9], type: 'sawtooth',
                      attack: 0.02, decay: 0.55, peak: 0.13 });
        break;
      }
      case 'jump':
        this._voice({ t, freq: S[6], glide: S[11], type: 'sine',
                      attack: 0.004, decay: 0.16, peak: 0.13 });
        break;
      case 'edge':
        // Warning scrape as Dewy strays toward the drop.
        this._voice({ t, freq: S[3], type: 'sawtooth',
                      attack: 0.01, decay: 0.12, peak: 0.05 });
        break;
      case 'cloud': {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(180, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g); g.connect(this.sfxGain);
        o.start(t); o.stop(t + 0.45);
        break;
      }
      case 'fall':
        this._voice({ t, freq: S[10], glide: 60, type: 'triangle',
                      attack: 0.01, decay: 0.75, peak: 0.20 });
        break;
      case 'wave':
        // Water: noise swept down through a resonant lowpass, over a
        // low swell. Reads as a wall of water arriving.
        this._whoosh(t, 1.9, 5000, 260, 0.30);
        this._voice({ t, freq: S[0], type: 'sine',
                      attack: 0.35, decay: 1.9, peak: 0.24 });
        this._voice({ t: t + 0.2, freq: S[5], type: 'triangle',
                      attack: 0.4, decay: 1.7, peak: 0.11 });
        break;
      case 'card':
        [7, 11, 14].forEach((n, i) => {
          this._voice({ t: t + i * 0.07, freq: S[n], type: 'triangle',
                        attack: 0.02, decay: 0.9, peak: 0.15 });
        });
        break;
      case 'start':
        [0, 4, 7, 11].forEach((n, i) => {
          this._voice({ t: t + i * 0.08, freq: S[n], type: 'triangle',
                        attack: 0.01, decay: 0.5, peak: 0.16 });
        });
        break;
      case 'count':
        this._voice({ t, freq: S[7], type: 'triangle',
                      attack: 0.005, decay: 0.2, peak: 0.16 });
        break;
      default:
        break;
    }
  },

  _shimmer(t, level) {
    const src = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3000, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + 0.5);
    bp.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * level, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    src.start(t, src._offset); src.stop(t + 0.6);
  },

  _whoosh(t, dur, fromHz, toHz, level) {
    const src = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(fromHz, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(toHz, 40), t + dur);
    lp.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level != null ? level : 0.18, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    src.start(t, src._offset); src.stop(t + dur + 0.05);
  },
};
