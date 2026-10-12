/* ============================================================
   SPAWNER — lays the run down the track ahead of the player.

   Everything it places is positioned against Track.centerX, so the
   dewdrop trail bends toward each doorway exactly as the path does.
   A player who just chases the drops ends up connecting apps
   without ever being told to, which is the whole metaphor.

   One rule it must not break: never put a cloud where the player
   has no room to get around it, and never put one on top of a totem.
   ============================================================ */

const Spawner = {
  nextDropZ: 0,
  nextCloudZ: 0,
  nextTotemZ: 0,
  totemZs: [],

  reset() {
    this.nextDropZ = 900;
    this.nextCloudZ = CONFIG.CLOUD_FIRST;
    this.nextTotemZ = CONFIG.TOTEM_FIRST;
    this.totemZs = [];
  },

  update(game) {
    const horizon = game.travel + CONFIG.DRAW_DISTANCE;
    // During the lesson the cards lay down their own props. A random
    // cloud drifting through the "lean left and right" card teaches
    // the player the wrong thing.
    const lesson = game.state === STATE.TUTORIAL;

    // Totems first: clouds need to know where they are before they
    // are allowed to place themselves.
    let guard = 0;
    while (this.nextTotemZ < horizon + 800 && guard++ < 40) {
      if (lesson) { this.nextTotemZ += CONFIG.TOTEM_EVERY; continue; }
      const z = this.nextTotemZ;
      game.entities.push(new Totem(Track.centerX(z), z));
      this.totemZs.push(z);
      this.nextTotemZ += CONFIG.TOTEM_EVERY * rand(0.85, 1.15);
    }

    guard = 0;
    while (this.nextDropZ < horizon && guard++ < 200) {
      this._drop(game, this.nextDropZ);
      this.nextDropZ += CONFIG.DROP_SPACING;
    }

    guard = 0;
    while (this.nextCloudZ < horizon && guard++ < 40) {
      const z = this.nextCloudZ;
      if (!lesson && Math.random() < CONFIG.CLOUD_CHANCE && !this._nearTotem(z)
          && Track.isStraight(z)) {
        // Off to one side of the ribbon, far enough out that the lane
        // past it is comfortably wider than Dewy needs, and never so
        // far that dodging it means leaving the path.
        const off = pick([-1, 1]) * CONFIG.PATH_HALF * rand(0.45, 0.62);
        game.entities.push(new Cloud(Track.centerX(z) + off, z));
      }
      this.nextCloudZ += rand(1500, 2600);
    }

    this.totemZs = this.totemZs.filter((z) => z > game.travel);
  },

  _nearTotem(z) {
    for (const tz of this.totemZs) if (Math.abs(tz - z) < 700) return true;
    return false;
  },

  /* Dead on the centreline. The drops used to weave across the path,
     which looked lively but read as noise: they are the thing telling
     the player where the lane goes, so anything that blurs the lane's
     centre is working against them. */
  _drop(game, z) {
    game.entities.push(new Dewdrop(Track.centerX(z), z));
  },
};
