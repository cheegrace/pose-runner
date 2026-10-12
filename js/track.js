/* ============================================================
   TRACK — the corridor, the winding path, and the doorways.

   Three things live here because they are one thing: the doorways
   decide where the path goes.

     1. Each wall runs its own doorway clock, so the two sides never
        fall into step with each other.
     2. Every doorway claims a leg of the path, and the path swings
        to that doorway's side of the corridor for the length of it.
     3. Following the path therefore walks Dewy past the doorway, and
        passing it connects that app.

   Dewdrops get laid along the same centreline (see spawner.js), so
   the drops, the path and the doorways all point the same way.

   The purple -> turquoise transformation is not stored per segment:
   a segment is lit if it is behind Dewy, full stop. That makes the
   trail exact and free.
   ============================================================ */

const Track = {
  legs: [],          // { z0, z1, x0, x1, lane } — the centreline, in order
  doors: [],         // Doorway, ordered by z
  nextDoorZ: { '-1': 0, '1': 0 },
  lastLane: 0,       // -1 left, 0 centre, +1 right
  builtTo: 0,        // furthest z the centreline is defined out to

  laneX(lane) { return lane * CONFIG.LANE_WIDTH; },

  reset() {
    this.legs = [{ z0: 0, z1: 1200, x0: 0, x1: 0, lane: 0,
                   turnLen: CONFIG.PATH_TURN_LEN }];
    this.doors = [];
    this.nextDoorZ['-1'] = CONFIG.DOOR_FIRST;
    this.nextDoorZ['1'] = CONFIG.DOOR_FIRST + CONFIG.DOOR_FIRST_OFFSET;
    this.lastLane = 0;
    this.builtTo = 1200;
  },

  /* Extend the centreline and the doorway list out to `z`. Called
     every frame with the draw horizon, so the world is always built
     a little further ahead than the player can see. */
  ensure(z) {
    let guard = 0;
    while (this.builtTo < z && guard++ < 200) this._addLeg();
  },

  /* The path runs in three lanes and steps between them. Each leg
     holds one lane dead straight, then steps to the next over
     PATH_TURN_LEN — a fixed distance, so every corner in the game is
     the same shape and the same difficulty no matter how long the
     straight before it was.

     The doorways ride the path rather than driving it. Tying the two
     together the other way round (one leg per doorway) is the obvious
     design and it is wrong: a doorway count that reads well on the
     score card means a doorway every few seconds, which would leave
     the path dead straight in between. So legs come first, and a wall
     gets its doorway on the next leg that happens to step that way.
     The guarantee the game depends on still holds: when a doorway
     passes, the path is already settled in that doorway's lane. */
  _addLeg() {
    const last = this.legs[this.legs.length - 1];
    const z0 = last.z1;
    const z1 = z0 + rand(CONFIG.PATH_LEG_MIN, CONFIG.PATH_LEG_MAX);

    const lane = this._nextLane(z1);
    this.lastLane = lane;
    const target = this.laneX(lane);

    // A corner crossing two lanes gets twice the depth to do it in.
    // Holding the length fixed instead would double the steering rate
    // it demands, and that one corner would be the only unfair thing
    // in the game.
    const crossed = Math.max(1, Math.abs(lane - last.lane));
    const turnLen = CONFIG.PATH_TURN_LEN * crossed;

    this.legs.push({ z0, z1, x0: last.x1, x1: target, lane, turnLen });
    this.builtTo = z1;

    // Does this wall have a doorway due? Its centre — where the
    // connect is judged — goes at the end of the leg, once the path
    // has finished swinging across. The panel itself is far longer
    // than a leg and simply overhangs its neighbours, which is what
    // the artwork does too.
    // Just *past* the end of the leg, not just before it: at z1 the
    // swing has finished and centerX is exactly x1. Placing the
    // connect point mid-ease leaves the ribbon still near the middle
    // of the corridor, and a player who never steers at all collects
    // half the apps for free.
    const side = Math.sign(lane);
    const key = String(side);
    const settled = z1 + 100;
    if (side !== 0 && this.nextDoorZ[key] <= z1 && settled > z0) {
      this.doors.push(new Doorway(settled, side, target));
      this.nextDoorZ[key] = settled
        + rand(CONFIG.DOOR_GAP_MIN, CONFIG.DOOR_GAP_MAX);
    }
  },

  /* Which lane does the next leg run in?

     A wall with a doorway due wins outright — that is the whole
     reason the path moves. Otherwise pick any lane but the current
     one; a step across two lanes at once is rarer because it is the
     one corner that demands the full steering rate. */
  _nextLane(z1) {
    const sides = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    for (const side of sides) {
      if (this.nextDoorZ[String(side)] <= z1 && this.lastLane !== side) {
        return side;
      }
    }
    const here = this.lastLane;
    const far = -here;                       // 0 when already centred
    if (here !== 0 && Math.random() < CONFIG.PATH_DOUBLE_CHANCE) return far;
    const options = [-1, 0, 1].filter((l) => l !== here &&
                                             (here === 0 || l === 0));
    return options[Math.floor(Math.random() * options.length)];
  },

  /* Lateral centre of the ribbon at absolute depth z.
     Each leg holds its lane dead straight, then eases across to the
     next over PATH_TURN_LEN. In perspective that short ease reads as
     a rounded right angle, a connector elbow. */
  centerX(z) {
    const legs = this.legs;
    if (!legs.length) return 0;
    if (z <= legs[0].z0) return legs[0].x0;

    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      if (z < leg.z0) continue;
      if (z > leg.z1) {
        if (i === legs.length - 1) return leg.x1;
        continue;
      }
      const turnLen = leg.turnLen || CONFIG.PATH_TURN_LEN;
      const holdEnd = leg.z1 - turnLen;
      if (z <= holdEnd) return leg.x0;
      const t = (z - holdEnd) / turnLen;
      return leg.x0 + (leg.x1 - leg.x0) * smoothstep(t);
    }
    return legs[legs.length - 1].x1;
  },

  /* Is the ribbon running straight at this depth, or mid-turn?

     Obstacles are only ever placed on straight stretches. Asking a
     player to dodge sideways while the path is also swinging
     sideways stacks two full-rate steering demands on top of each
     other, and with pose input that is not a challenge, it is a
     coin toss. */
  isStraight(z) {
    const legs = this.legs;
    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i];
      if (z < leg.z0 || z > leg.z1) continue;
      const holdEnd = leg.z1 - (leg.turnLen || CONFIG.PATH_TURN_LEN);
      return z <= holdEnd - CONFIG.OBSTACLE_TURN_CLEAR;
    }
    return true;    // beyond the built centreline: straight by default
  },

  /* How far off the middle of the ribbon a lateral position sits,
     as a fraction: 0 = dead centre, 1 = right on the edge. */
  offPathAmount(x, z) {
    return Math.abs(x - this.centerX(z)) / CONFIG.PATH_HALF;
  },

  onPath(x, z) {
    return Math.abs(x - this.centerX(z))
         <= CONFIG.PATH_HALF + CONFIG.FALL_MARGIN;
  },

  /* Drop everything the player has already run past. */
  cull(travel) {
    const behind = travel - CONFIG.SEG_LEN * 4;
    while (this.legs.length > 1 && this.legs[1].z0 < behind) this.legs.shift();
    this.doors = this.doors.filter((d) => d.z + CONFIG.DOOR_WIDTH > behind);
  },

  connectedCount() {
    let n = 0;
    for (const d of this.doors) if (d.connected) n++;
    return n;
  },
};

function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/* Stable pseudo-random from an integer. The corridor's stripe colours
   and brick placement come from this, so a wall slice looks identical
   every frame instead of strobing as it scrolls toward the camera. */
function hash01(i, salt) {
  let x = (i * 374761393 + (salt || 0) * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177 | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}


/* ============================================================
   DOORWAY — an app alcove set into one wall.

   Purple until Dewy runs past it on its side; then the turquoise
   floods up the panel and the app is connected.
   ============================================================ */

class Doorway {
  constructor(z, side, pathTarget) {
    this.z = z;
    this.side = side;              // -1 left wall, +1 right wall
    this.pathTarget = pathTarget;  // where the path swings for it
    this.shape = Shapes.random();
    this.connected = false;
    this.missed = false;
    this.connectAge = 0;
    this.age = 0;
    this.spin = 0;
  }

  get z0() { return this.z - CONFIG.DOOR_WIDTH / 2; }
  get z1() { return this.z + CONFIG.DOOR_WIDTH / 2; }

  update(dt) {
    this.age += dt;
    if (this.connected) {
      this.connectAge += dt;
      // One celebratory turn of the shape, easing out.
      this.spin += CONFIG.SHAPE_SPIN * dt
                 * Math.max(0, 1 - this.connectAge / CONFIG.DOOR_CONNECT_TIME) * 10;
    }
  }

  /* 0 -> 1 as the turquoise floods the panel. */
  fill() {
    if (!this.connected) return 0;
    return clamp(this.connectAge / CONFIG.DOOR_CONNECT_TIME, 0, 1);
  }
}
