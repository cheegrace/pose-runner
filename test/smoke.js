/* ============================================================
   Headless harness: fakes just enough DOM/canvas to run real game
   frames, then asserts the things that would ruin an event —
   unfollowable turns, unavoidable obstacles, a run that ends in
   five seconds, a score that does not add up.

   Run:  node test/smoke.js
   ============================================================ */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}

/* ---------------- the fake page ---------------- */

const grad = { addColorStop() {} };
const ctx = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 1280, height: 720 };
    if (typeof k !== 'string') return undefined;
    // Every draw call is checked for NaN/Infinity, which is how a
    // projection bug usually shows up: a blank screen, no error.
    return (...a) => {
      for (const v of a) {
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error(`non-finite arg to ctx.${k}: ${JSON.stringify(a)}`);
        }
      }
    };
  },
  set() { return true; },
});

// A real event target keeps every listener, not just the last one
// registered — which is exactly the bug this stub used to hide.
const listeners = {};
const addListener = (t, f) => (listeners[t] = listeners[t] || []).push(f);
const fire = (t, ev) => (listeners[t] || []).forEach((f) => f(ev));
const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
const store = {};

class FakeImage {
  set src(v) { this._src = v; setTimeout(() => this.onerror && this.onerror(), 0); }
  get src() { return this._src; }
}

// The game logs every mist shot for the operator's console. Useful on
// the show floor, deafening across thousands of simulated frames.
const quietConsole = Object.assign(Object.create(console), { log() {}, warn() {} });

const sandbox = {
  console: quietConsole,
  performance: { now: () => Date.now() },
  window: {
    innerWidth: 900, innerHeight: 1240, devicePixelRatio: 2,
    addEventListener: addListener,
    // No Web Audio in node: the game must run silent, not crash.
    AudioContext: undefined,
  },
  document: {
    getElementById: () => canvas,
    createElement: () => canvas,
    baseURI: 'http://localhost:8000/',
    fonts: undefined,
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  Image: FakeImage,
  FontFace: undefined,
  URL,
  navigator: { mediaDevices: undefined },
  requestAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const FILES = ['config', 'assets', 'shapes', 'view', 'track', 'corridor',
               'entities', 'spawner', 'audio', 'pose', 'ui', 'mist', 'main'];
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'),
                  sandbox, { filename: f + '.js' });
}

const ev = (src) => vm.runInContext(src, sandbox);

/* Seeded RNG so a failure is reproducible.

   Both sides need it. The game's randomness lives in the sandbox, but
   the scripted player below runs out here in Node — so seeding only
   the sandbox left the *player's* wobble and lapses unseeded, and the
   difficulty median swung between 22s and 56s from run to run. A
   check that fails one run in three is worse than no check: it trains
   you to ignore it. */
ev(`(function () { let s = 12345;
  Math.random = function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  globalThis.__reseed = function (n) { s = n >>> 0; };
})()`);

let _seed = 987654321;
function rnd() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
}
/* Put both generators back to a known point, so a section's result
   does not depend on how much randomness the sections above it used. */
function reseed(n) { _seed = n >>> 0; ev(`__reseed(${n >>> 0})`); }

const G = ev('Game'), C = ev('CONFIG'), S = ev('STATE');
const T = ev('Track'), V = ev('View'), I = ev('Input'), P = ev('Pose');
const W = ev('Wave'), A = ev('Audio'), Sh = ev('Shapes');
const clamp = ev('clamp');
const CONFIG_IDLE = C.ATTRACT_TIMEOUT;

const key = (k) => fire('keydown', { key: k, preventDefault() {} });
const step = (n, dt) => { for (let i = 0; i < n; i++) { G.update(dt || 1 / 60); G.render(); } };

/* A scripted player. `skill` 1 tracks the centreline exactly; lower
   values lag and wobble, which is what a person on a webcam does. */
function play(frames, skill, distracted) {
  skill = skill == null ? 1 : skill;
  const lag = Math.round((1 - skill) * 18);
  const blankChance = distracted ? 0.004 * (1 - skill) : 0;
  let blank = 0;
  const queue = [];
  P.status = 'tracking';            // Input.steer() ignores pose otherwise
  for (let i = 0; i < frames; i++) {
    if (G.state !== S.PLAYING) return i;
    const pz = G.travel + C.PLAYER_Z;
    let want = T.centerX(pz);
    let near = null, nearD = Infinity;
    for (const e of G.entities) {
      if (e.type !== 'cloud') continue;
      const d = e.worldZ - pz;
      // Look ahead in seconds, not in world units: at top speed a
      // fixed distance is barely half a second of warning, which is
      // the harness being short-sighted rather than the game being
      // unfair.
      if (d < 0 || d > G.speed * 1.6 || d >= nearD) continue;
      near = e; nearD = d;
    }
    if (near) {
      // Aim at an offset from the ribbon, not at an absolute x. The
      // cloud sits at a fixed world x, but the ribbon between here
      // and there is still turning, so an absolute target drifts
      // right into the thing it was avoiding.
      const off = near.x - T.centerX(near.worldZ);
      const lim = C.PATH_HALF * 0.75;
      const dodge = off - Math.sign(off || 1) * (C.CLOUD_HIT_X + 50);
      want = T.centerX(pz) + Math.max(-lim, Math.min(lim, dodge));
    }
    queue.push(want);
    const seen = queue.length > lag ? queue[queue.length - 1 - lag] : want;
    if (blank > 0) blank--;
    else if (rnd() < blankChance) blank = 25;
    const wobble = (1 - skill) * 0.4 * (rnd() - 0.5) * 2;
    I.setSteer(blank > 0 ? 0
      : Math.max(-1, Math.min(1, (seen - G.dewy.x) / 50 + wobble)));
    G.update(1 / 60);
    G.render();
  }
  return frames;
}

/* Clear the camera notice. It holds briefly so the gesture that
   opened it cannot also dismiss it. */
function passConsent() {
  if (G.state !== S.CONSENT) return;
  step(Math.ceil(0.8 * 60) + 2);
  key(' ');
  G.update(1 / 60);
}

/* Straight to the run. The lesson has its own section below; every
   other test wants the game proper. */
function startRun() {
  G.startRun();
  if (G.state === S.TUTORIAL) { key('Escape'); G.update(1 / 60); }
  G.countdown = 0.01;
  G.update(1 / 60);
}

fire('load');

/* ---------------- state machine ---------------- */
console.log('\n— state machine —');
check(G.state === S.ATTRACT, 'starts in ATTRACT');
step(10);
key(' ');
G.update(1 / 60);
check(G.state === S.CONSENT, 'a keypress opens the camera notice');

// The notice must not be dismissable by the same gesture that opened it.
key(' ');
G.update(1 / 60);
check(G.state === S.CONSENT, 'the notice holds for a beat before it can be cleared');

passConsent();
check(G.state === S.TUTORIAL, 'agreeing opens the lesson');
key('Escape');
G.update(1 / 60);
check(G.state === S.COUNTDOWN, 'Esc skips the lesson to the countdown');
step(Math.ceil(C.COUNTDOWN_TIME * 60) + 5);
check(G.state === S.PLAYING, 'countdown hands over to PLAYING');

/* ---------------- both hands up ---------------- */
console.log('\n— the start gesture —');
G.state = S.ATTRACT;
G.update(1 / 60);
I.takeAny();
P.status = 'tracking';
G.taught = false;
I.pushGesture();
G.update(1 / 60);
check(G.state === S.CONSENT, 'raising both hands opens the notice');
step(Math.ceil(0.8 * 60) + 2);
I.pushGesture();
G.update(1 / 60);
check(G.state === S.TUTORIAL, 'and raising them again agrees and plays');
key('Escape'); G.update(1 / 60);

/* ---------------- nobody is there ---------------- */
console.log('\n— the stand goes back to attracting —');
G.toAttract();
check(G.state === S.ATTRACT, 'toAttract resets to the title card');

// Left on the notice: times out.
key(' '); G.update(1 / 60);
check(G.state === S.CONSENT, 'the notice is up');
step(Math.ceil(CONFIG_IDLE * 60) + 4);
check(G.state === S.ATTRACT, `an unattended notice returns to attract (${CONFIG_IDLE}s)`);

// Walked off mid-run: the pose reader reports nobody in frame.
startRun();
play(60 * 3, 1);
// `Pose.lostTime` is the reader's own "seconds since I last saw a
// body". There is no camera in here to stop seeing one, so drive that
// clock directly — it is the contract the abandon check reads.
P.status = 'tracking';
P.lostTime = C.ABANDON_TIME + 0.1;
G.update(1 / 60);
check(G.state === S.ATTRACT,
      `walking off mid-run returns to attract (${C.ABANDON_TIME}s)`);

// A dead camera is not an absent player: keyboard runs must survive.
startRun();
play(60 * 3, 1);
I.setSteer(0);
P.status = 'failed';
P.lostTime = 999;
step(60);
// She may well fall off on her own with nobody steering — what must
// not happen is the run being taken away as abandoned.
check(G.state !== S.ATTRACT, 'a keyboard run is never abandoned');
P.status = 'tracking'; P.lostTime = 0;

// Left on the score card: times out too.
startRun();
play(60 * 3, 1);
G.endRun();
step(Math.ceil((C.ATTRACT_TIMEOUT + 6) * 60));
check(G.state === S.ATTRACT, 'an unattended score card returns to attract');

/* ---------------- the lesson is taught once ---------------- */
console.log('\n— the lesson is shown once per player —');
G.toAttract();
check(!G.taught, 'a fresh player has not been taught');
key(' '); G.update(1 / 60); passConsent();
check(G.state === S.TUTORIAL, 'the first run opens the lesson');
key('Escape'); G.update(1 / 60);
G.taught = true;                       // as _finishTutorial would leave it
G.startRun();
check(G.state === S.COUNTDOWN, 'a replay skips straight past it');
G.toAttract();
check(!G.taught, 'and the next person at the machine gets taught again');

/* ---------------- the lesson ---------------- */
console.log('\n— how to play —');
G.toAttract();
G.update(1 / 60);
I.takeAny();
key(' ');
G.update(1 / 60);
passConsent();
check(G.state === S.TUTORIAL, 'the lesson opens');

/* A player who does exactly what each card asks. The cards have to
   notice, and the lesson has to hand over to a clean run. */
const cardsSeen = [];
let lessonFrames = 0;
P.status = 'tracking';
while (G.state === S.TUTORIAL && lessonFrames++ < 60 * 90) {
  const st = G.step();
  if (st && cardsSeen[cardsSeen.length - 1] !== st.id) cardsSeen.push(st.id);
  if (st && st.id === 'steer') {
    // Lean one way, then the other.
    I.setSteer(Math.sin(lessonFrames / 14) > 0 ? 0.9 : -0.9);
  } else if (st && st.id === 'collect') {
    I.setSteer(clamp((T.centerX(G.travel + C.PLAYER_Z) - G.dewy.x) / 50, -1, 1));
  } else if (st && st.id === 'jump') {
    I.setSteer(clamp((T.centerX(G.travel + C.PLAYER_Z) - G.dewy.x) / 50, -1, 1));
    // Jump when a cloud is close enough that the hop will cover it.
    for (const e of G.entities) {
      if (e.type !== 'cloud') continue;
      const d = e.worldZ - (G.travel + C.PLAYER_Z);
      if (d > 0 && d < G.speed * 0.30 && G.dewy.grounded) I.pushJump();
    }
  }
  G.update(1 / 60);
  G.render();
}
check(G.state !== S.TUTORIAL, `the lesson ends (${(lessonFrames / 60).toFixed(0)}s)`);
check(cardsSeen.join(',') === 'steer,collect,jump',
      `every card is shown in order (${cardsSeen.join(' -> ')})`);
check(lessonFrames / 60 < 32, 'a player who follows along is not held up');
check(G.drops === 0 && G.apps === 0, 'the lesson does not score');
check(G.state === S.COUNTDOWN, 'the lesson hands over to the countdown');
I.setSteer(0);

/* Nobody in front of the camera: every card must still time out. */
G.startRun();
let idleFrames = 0;
while (G.state === S.TUTORIAL && idleFrames++ < 60 * 200) {
  I.setSteer(0);
  G.update(1 / 60);
}
check(G.state === S.COUNTDOWN,
      `a player who does nothing still reaches the run (${(idleFrames / 60).toFixed(0)}s)`);
const lessonCap = C.TUTORIAL_STEPS.reduce((a, b) => a + b.max, 0);
check(idleFrames / 60 <= lessonCap + 1,
      `and waits no longer than the caps (${lessonCap}s)`);

/* ---------------- a full run ---------------- */
console.log('\n— a perfect run —');
startRun();
const survived = play(60 * 90, 1);
check(survived === 60 * 90, 'a player who tracks the path never dies (90s)');
check(G.apps >= 8, `connects a sensible number of apps (${G.apps} in 90s)`);
check(G.drops > 400, `collects a sensible number of drops (${G.drops})`);
check(G.totems >= 3, `sees several totems (${G.totems})`);

/* ---------------- the track is followable ---------------- */
console.log('\n— the path is possible —');
T.reset();
T.ensure(400000);
let worstRate = 0, discontinuity = 0;
const lanes = new Set();
let squareCorners = true;
for (const leg of T.legs) {
  const turnZ = leg.turnLen;
  const swing = Math.abs(leg.x1 - leg.x0);
  worstRate = Math.max(worstRate, (swing / turnZ) * C.MAX_SPEED);
  lanes.add(leg.lane);
  // Every leg must sit exactly on a lane, and hold it straight for a
  // stretch before the corner.
  if (Math.abs(leg.x1 - leg.lane * C.LANE_WIDTH) > 0.001) squareCorners = false;
  if (leg.z1 - leg.z0 <= leg.turnLen) squareCorners = false;
}

/* The rate above is an average, and a smoothstep corner is steepest
   in the middle — so averages alone do not prove a corner is
   turnable. Fly the worst one at top speed with a player who can only
   steer at STEER_SPEED and see how far off the ribbon they get. */
function worstTrackingError() {
  let worst = 0;
  for (const leg of T.legs) {
    if (Math.abs(leg.x1 - leg.x0) < 1) continue;
    const dt = 1 / 60;
    let x = leg.x0;
    let err = 0;
    for (let z = leg.z1 - leg.turnLen - 600; z < leg.z1 + 600; z += C.MAX_SPEED * dt) {
      // Aim at where the ribbon is right now, not where it is going.
      // That is the pessimistic player — they always lag the corner
      // and never lead it — so if they stay on, anyone can.
      const want = T.centerX(z);
      const move = Math.min(Math.abs(want - x), C.STEER_SPEED * dt);
      x += Math.sign(want - x) * move;
      err = Math.max(err, Math.abs(x - T.centerX(z)));
    }
    worst = Math.max(worst, err);
  }
  return worst;
}
const trackErr = worstTrackingError();
const tolerance = C.PATH_HALF + C.FALL_MARGIN;
check(trackErr < tolerance,
      `the worst corner at top speed leaves Dewy ${Math.round(trackErr)} off ` +
      `the centreline, tolerance ${tolerance}`);
for (let z = 0; z < 200000; z += 40) {
  discontinuity = Math.max(discontinuity, Math.abs(T.centerX(z + 1) - T.centerX(z)));
}
check(worstRate <= C.STEER_SPEED,
      `worst turn needs ${Math.round(worstRate)} u/s, Dewy has ${C.STEER_SPEED}`);
check(discontinuity < 2, 'the centreline has no jumps in it');
check(T.legs.length > 100, 'the centreline keeps generating');
check(squareCorners, 'every leg runs dead straight down one of the lanes');
check(lanes.size === 3 && [...lanes].every((l) => l === -1 || l === 0 || l === 1),
      `the path uses all three lanes and no others (${[...lanes].sort()})`);
check(C.LANE_WIDTH > C.PATH_HALF + C.FALL_MARGIN,
      'ignoring a corner puts you off the path (lane gap ' +
      `${C.LANE_WIDTH} > tolerance ${C.PATH_HALF + C.FALL_MARGIN})`);

let maxOffset = 0;
for (let z = 0; z < 200000; z += 60) maxOffset = Math.max(maxOffset, Math.abs(T.centerX(z)));
check(maxOffset + C.PATH_HALF < C.CORRIDOR_HALF,
      'the ribbon never runs into a wall');

/* ---------------- doorways ---------------- */
console.log('\n— doorways —');
const doors = T.doors;
check(doors.length > 15, `doorways keep coming (${doors.length} over the run)`);
check(doors.some((d) => d.side === -1) && doors.some((d) => d.side === 1),
      'both walls get doorways');

let onSide = 0, gapsL = [], gapsR = [];
let lastL = null, lastR = null;
for (const d of doors) {
  if (Math.sign(T.centerX(d.z)) === d.side) onSide++;
  if (d.side === -1) { if (lastL !== null) gapsL.push(d.z - lastL); lastL = d.z; }
  else { if (lastR !== null) gapsR.push(d.z - lastR); lastR = d.z; }
}
check(onSide === doors.length,
      'the path is on the doorway\'s side of the corridor at every doorway');
check(gapsL.every((g) => g >= C.DOOR_GAP_MIN) && gapsR.every((g) => g >= C.DOOR_GAP_MIN),
      'each wall keeps to its own spacing');
// The two clocks are independent, so the merged sequence should not
// simply alternate left, right, left, right.
const sides = doors.map((d) => d.side);
let alternating = 0;
for (let i = 1; i < sides.length; i++) if (sides[i] !== sides[i - 1]) alternating++;
check(alternating < sides.length - 1, 'the two walls are not in lockstep');

/* ---------------- connecting ---------------- */
console.log('\n— connecting an app —');
startRun();
play(60 * 40, 1);
const connected = T.doors.filter((d) => d.connected).length;
check(G.apps > 0, 'staying on the path connects apps');
check(T.doors.every((d) => !(d.connected && d.missed)),
      'no doorway is both connected and missed');
check(T.doors.filter((d) => d.connected).every((d) => d.fill() >= 0),
      'a connected doorway floods turquoise');

// Now the same run, refusing to follow the path.
startRun();
P.status = 'tracking';
// Doorways get culled once they are behind the camera, so the tally
// has to be taken as they go past, not at the end of the run.
const seen = new Set();
for (let i = 0; i < 60 * 40; i++) {
  I.setSteer(0);
  G.dewy.x = 0;              // pinned to the middle, ignoring the path
  G.dewy.falling = false;
  G.state = S.PLAYING;       // ignore the falls this obviously causes
  // No boosts either: a boost steers Dewy onto the path for her, and
  // the apps it connects are the game's doing, not the player's.
  G.boostTimer = 0;
  G.handoffTimer = 0;
  G.update(1 / 60);
  for (const d of T.doors) if (d.connected || d.missed) seen.add(d);
}
const passed = seen.size;
check(passed > 2, `the stubborn player did meet doorways (${passed})`);
check(G.apps < passed / 2,
      `standing in the middle misses most of them (${G.apps} of ${passed})`);

/* ---------------- clouds are always dodgeable ---------------- */
console.log('\n— obstacles are fair —');
startRun();
play(60 * 60, 1);
let badCloud = 0, cloudOnTurn = 0;
for (const e of G.entities) {
  if (e.type !== 'cloud') continue;
  const c = T.centerX(e.worldZ);
  // Is there room to pass on at least one side, without leaving the path?
  const room = C.PATH_HALF + C.FALL_MARGIN;
  const leftGap = (e.x - C.CLOUD_HIT_X) - (c - room);
  const rightGap = (c + room) - (e.x + C.CLOUD_HIT_X);
  if (Math.max(leftGap, rightGap) < 60) badCloud++;
  if (!T.isStraight(e.worldZ)) cloudOnTurn++;
}
check(badCloud === 0, 'every cloud leaves a lane to get past it');
check(cloudOnTurn === 0, 'no cloud sits on a turn');

/* ---------------- scoring ---------------- */
console.log('\n— scoring —');
startRun();
play(60 * 30, 1);
check(G.score === G.drops, 'the score is the dewdrop count, nothing else');
const before = G.drops;
G.award(25, 0, 100, G.travel + 1000);
check(G.drops === before + 25, 'a bonus is paid in dewdrops');

store[C.HIGH_SCORE_KEY] = '0';
startRun();
play(60 * 20, 1);
const runScore = G.score;
G.endRun();
check(G.highScore === runScore, 'the high score takes the run');
check(store[C.HIGH_SCORE_KEY] === String(runScore), 'the high score is written to storage');
startRun();
play(60 * 3, 1);
G.endRun();
check(G.highScore === runScore, 'a worse run does not lower the high score');

/* ---------------- boost ---------------- */
console.log('\n— totem boost —');
startRun();
play(60 * 6, 1);
const totem = { x: G.dewy.x, worldZ: G.travel + C.PLAYER_Z, type: 'totem', taken: false, age: 0 };
G.startBoost(totem);
check(G.boostTimer > 0, 'a totem starts the boost');
let offPathDuringBoost = 0, hands = 0, diedInHandoff = false;
const dropsAtBoost = G.drops;
// Not a fixed frame count: a totem picked up mid-boost extends it,
// so run until the game actually gives control back.
const cap = 60 * 30;
for (let i = 0; i < cap && (G.boostTimer > 0 || G.handoffTimer > 0); i++) {
  I.setSteer(0);                       // the player does nothing at all
  const wasBoost = G.boostTimer > 0;
  G.update(1 / 60);
  G.render();
  if (wasBoost) {
    hands++;
    if (!T.onPath(G.dewy.x, G.travel + C.PLAYER_Z)) offPathDuringBoost++;
  }
  if (G.state !== S.PLAYING) { diedInHandoff = true; break; }
}
// Measured against the constant, not a fixed number of seconds: the
// boost length is a tuning dial and this check should follow it.
check(hands > 60 * C.BOOST_TIME * 0.8,
      `the boost runs hands-free for its full ${C.BOOST_TIME}s ` +
      `(${(hands / 60).toFixed(1)}s driven)`);
check(offPathDuringBoost === 0, 'the boost keeps Dewy on the path by itself');
check(G.drops > dropsAtBoost, 'the boost keeps scoring while the player rests');
check(!diedInHandoff, 'nothing can kill Dewy while the game is still steering');
check(G.boostTimer === 0 && G.handoffTimer <= 0.02, 'boost and handoff both finish');
// Control really does come back: a player who resumes steering lives.
check(play(60 * 4, 1) === 60 * 4, 'the player has control again afterwards');

/* ---------------- the trail is under her feet ---------------- */
console.log('\n— the turquoise trail ---'.replace('---','—'));
startRun();
play(60 * 4, 1);
{
  const Co = ev('Corridor');
  const dewyZ = G.travel + C.PLAYER_Z;
  const seg = Math.floor(dewyZ / C.SEG_LEN);
  check(Co.isLit(seg * C.SEG_LEN, G.travel),
        'the slice Dewy is standing on is lit');
  check(!Co.isLit((seg + 1) * C.SEG_LEN, G.travel),
        'the slice ahead of her is not');
  // The boundary must sit at her feet, never a segment behind them.
  let lastLit = -Infinity;
  for (let z = 0; z < dewyZ + C.SEG_LEN * 4; z += C.SEG_LEN) {
    if (Co.isLit(z, G.travel)) lastLit = z;
  }
  check(dewyZ - lastLit < C.SEG_LEN,
        `the lit edge reaches her feet (${Math.round(dewyZ - lastLit)} behind, ` +
        `segment is ${C.SEG_LEN})`);
}

/* ---------------- leaning outward is always safe ---------------- */
console.log('\n— reaching for a doorway never kills —');
/* The path steps between lanes to reach each doorway, so a player
   chasing one leans hard and holds it. That must never be what ends a
   run: the only failure the game asks for is missing a corner. Pin the
   centreline straight, so a legitimate missed turn cannot be mistaken
   for the thing this is checking. */
const realCenterX = T.centerX;
T.centerX = () => 0;
/* Clouds off: this block asks whether *leaning* can drop you off the
   path, and a cloud hit is a different mechanic entirely. With clouds
   as frequent as they now are, a player pinned to the ribbon edge for
   sixteen seconds will meet one. */
const realCloudChance = C.CLOUD_CHANCE;
C.CLOUD_CHANCE = 0;
startRun();
G.entities = G.entities.filter((e) => e.type !== 'cloud');
play(60 * 2, 1);
let leanKilled = null;
for (const dir of [-1, 1]) {
  for (let i = 0; i < 60 * 8; i++) {
    I.setSteer(dir);
    G.update(1 / 60);
    if (G.state !== S.PLAYING) { leanKilled = dir; break; }
  }
  if (leanKilled !== null) break;
}
const pinned = Math.abs(G.dewy.x);
T.centerX = realCenterX;
C.CLOUD_CHANCE = realCloudChance;
I.setSteer(0);
check(leanKilled === null,
      'holding a full lean on a straight never ends the run');
check(pinned <= C.PATH_HALF + 1,
      `and Dewy stops at the painted edge (${Math.round(pinned)} of ${C.PATH_HALF})`);

/* ---------------- falling ---------------- */
console.log('\n— falling off —');
startRun();
play(60 * 5, 1);
/* Totems are frequent enough now that five seconds in, a run is
   often mid-boost — and nothing may end a run while the game is
   steering. Clear it, or this section is testing the boost rather
   than the footing. */
G.boostTimer = 0;
G.handoffTimer = 0;
G.update(1 / 60);

/* Step off and hold Dewy there. She teeters first — that grace is the
   whole reason a lane path is playable — and only then falls. */
const offPath = () => {
  G.dewy.x = T.centerX(G.travel + C.PLAYER_Z) + C.PATH_HALF + C.FALL_MARGIN + 40;
};
offPath();
G.update(1 / 60);
check(G.state === S.PLAYING, 'stepping off teeters before it kills');
check(G.teeter() > 0, 'and the teeter is showing');

// Back on the path in time — the run survives.
G.dewy.x = T.centerX(G.travel + C.PLAYER_Z);
G.update(1 / 60);
check(G.teeter() === 0 && G.state === S.PLAYING, 'getting back saves the run');

for (let i = 0; i < Math.ceil(C.COYOTE_TIME * 60) + 4; i++) {
  offPath();
  G.update(1 / 60);
}
check(G.state === S.DYING, 'staying off the ribbon ends the run');
step(Math.ceil(C.FALL_TIME * 60) + 4);
check(G.state === S.GAME_OVER, 'the fall leads to the score screen');
check(W.active, 'the wave starts');

/* ---------------- the wave ---------------- */
console.log('\n— the end-of-run wave —');
check(W.level === 0, 'it rains before the water rises');
step(Math.ceil(C.WAVE_RAIN_TIME * 60) + 2);
check(W.level > 0 && W.level < 1, 'the water is on its way up');
step(Math.ceil(C.WAVE_RISE_TIME * 60) + 2);
check(W.filled(), 'the water covers the screen');
check(W.cardIn() < 1, 'the card waits a beat behind the water');
step(Math.ceil(C.WAVE_CARD_DELAY * 60) + 40);
check(W.cardIn() === 1, 'the score card arrives');

key(' ');
G.update(1 / 60);
check(G.state === S.COUNTDOWN || G.state === S.TUTORIAL,
      'a keypress starts the next run without re-consenting');
if (G.state === S.TUTORIAL) { key('Escape'); G.update(1 / 60); }

/* ---------------- difficulty ---------------- */
console.log('\n— difficulty, with an imperfect player —');
reseed(20240915);   // this section must not inherit the run above it
/* The build spec asks for runs of roughly 45-60 seconds: long enough
   that a guest feels they played something, short enough that the
   queue keeps moving. The player here lags, wobbles, and now and then
   stops paying attention altogether. */
const lengths = [], appCounts = [];
for (let t = 0; t < 15; t++) {
  startRun();
  lengths.push(play(60 * 150, 0.35, true) / 60);
  appCounts.push(G.apps);
}
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const median = med(lengths);
check(median >= 25, `a distracted player lasts ${median.toFixed(0)}s (want 25s+)`);
check(median <= 110, `a distracted player does eventually fall (${median.toFixed(0)}s)`);
check(med(appCounts) >= 4,
      `and still connects a card-worthy number of apps (${med(appCounts)})`);

/* ---------------- rendering holds up ---------------- */
console.log('\n— rendering —');
const sizes = [[900, 1240], [1600, 900], [1080, 3240], [480, 800]];
let renderError = null;
for (const [w, h] of sizes) {
  sandbox.window.innerWidth = w;
  sandbox.window.innerHeight = h;
  V.resize();
  check(Number.isFinite(V.focal) && V.focal > 0 &&
        Number.isFinite(V.camHeight) && V.camHeight > 0 &&
        V.zMin > 0 && V.zMin < C.PLAYER_Z,
        `${w}x${h}: the projection solves to sane numbers`);
  try {
    startRun();
    play(60 * 20, 0.7);
    for (const st of [S.ATTRACT, S.CONSENT, S.TUTORIAL, S.COUNTDOWN,
                      S.PLAYING, S.GAME_OVER]) {
      G.state = st;
      G.render();
    }
  } catch (e) {
    renderError = `${w}x${h}: ${e.message}`;
  }
}
check(!renderError, 'no draw call ever gets a non-finite coordinate' +
      (renderError ? ' — ' + renderError : ''));

let shapeError = null;
for (const spec of C.SHAPES) {
  try { Sh.draw(ctx, spec, 100, 100, 80, { highlight: 0.2, rotation: 0.4 }); }
  catch (e) { shapeError = spec.kind + ': ' + e.message; }
}
check(!shapeError,
      `all ${C.SHAPES.length} brand shapes draw` + (shapeError ? ': ' + shapeError : ''));

/* A totem must never show the same mark twice in one tower. */
let dupStack = null;
for (let i = 0; i < 200 && !dupStack; i++) {
  const kinds = Sh.sample(C.TOTEM_STACK).map((x) => x.kind);
  if (new Set(kinds).size !== kinds.length) dupStack = kinds.join(',');
}
check(!dupStack, `a totem stack never repeats a shape${dupStack ? ': ' + dupStack : ''}`);
check(C.SHAPES.every((x) => x.kind !== 'blob'),
      'the brand character marks are not in the decorative pool');

/* ---------------- audio and mist degrade quietly ---------------- */
console.log('\n— audio and hardware —');
A.unlock();
check(!A.started, 'no Web Audio: the game runs silent instead of crashing');
let sfxError = null;
try { A.sfx('connect'); A.setIntensity(2); A.resume(); }
catch (e) { sfxError = e.message; }
check(!sfxError, 'calling into a dead audio engine is harmless');

// Every note the synth can ask for has to exist. The collect sound
// climbs with the streak, so a long run walks this index upward.
let badNote = null;
for (let streak = 0; streak < 2000; streak++) {
  const i = 4 + Math.min(Math.max(streak, 0), A.SCALE.length - 1 - 4);
  if (!Number.isFinite(A.SCALE[i])) { badNote = `streak ${streak} -> index ${i}`; break; }
}
for (let step = 0; step < 64; step++) {
  const bar = Math.floor(step / 16), sub = step % 16;
  const idxs = [A.BASS[(bar * 2 + (sub === 8 ? 1 : 0)) % 8],
                A.BASS[(bar * 2) % 8] + 7,
                Math.min(A.ARP[(bar % 2) * 8 + (sub % 8)] + 2, A.SCALE.length - 1)];
  for (const i of idxs) {
    if (!Number.isFinite(A.SCALE[i])) { badNote = `step ${step} -> index ${i}`; }
  }
}
check(!badNote, 'every note the synth can reach is in the scale' +
      (badNote ? ' — ' + badNote : ''));

const M = ev('Mist');
M.reset();
check(ev('fireMist("test")') === true, 'the mist fires');
check(ev('fireMist("test again")') === false, 'and refuses to fire again on cooldown');
M.update(C.MIST_COOLDOWN + 0.1);
check(ev('fireMist("later")') === true, 'and fires again once the cooldown is up');

/* ---------------- done ---------------- */
console.log(failures === 0
  ? '\nAll checks passed.\n'
  : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
