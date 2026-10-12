/* ============================================================
   MIST — the physical scent/mist dispenser trigger.

   Phase 5 ships this as a stub: it logs and flashes the screen.
   The transport is deliberately isolated in _send() so wiring the
   real hardware later touches nothing else in the game.

   Hardware plan: a Raspberry Pi on the venue LAN exposing a tiny
   HTTP (or WebSocket) endpoint that pulses a relay.
   ============================================================ */

const MIST_ENDPOINT = 'http://localhost:8787/mist';   // local Pi, not the internet

const Mist = {
  enabled: true,
  fired: 0,
  cooldown: 0,      // seconds remaining before another shot is allowed
  lastReason: '',

  update(dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  },

  /* Returns true if a shot actually went out. */
  fire(reason) {
    if (!this.enabled) return false;

    // Hardware guard: a canister must never be machine-gunned by a
    // player hitting three totems in a row.
    if (this.cooldown > 0) {
      if (CONFIG.MIST_LOG) console.log(`[mist] suppressed (${this.cooldown.toFixed(1)}s) — ${reason}`);
      return false;
    }

    this.cooldown = CONFIG.MIST_COOLDOWN;
    this.fired++;
    this.lastReason = reason || '';

    // Behind a flag: totems are frequent, and console.log with
    // DevTools open is slow enough to show up as a stutter on the
    // very frame the player is being rewarded.
    if (CONFIG.MIST_LOG) console.log(`MIST FIRED — ${reason} (shot #${this.fired})`);
    this._send(reason);

    // Visible stand-in for the real thing while the hardware is a stub.
    FX.trigger(CONFIG.MIST_FLASH_STRENGTH, CONFIG.COLORS.boostFlash);
    return true;
  },

  /* Swap the body of this for the real transport. Everything else stays. */
  _send(reason) {
    // --- HTTP version (Pi running a small local server) ---
    // fetch(MIST_ENDPOINT, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ reason, ms: CONFIG.MIST_PULSE_MS }),
    //   keepalive: true,
    // }).catch((e) => console.warn('[mist] dispenser unreachable:', e));

    // --- WebSocket version (lower latency, keep one socket open) ---
    // if (this.socket && this.socket.readyState === WebSocket.OPEN) {
    //   this.socket.send(JSON.stringify({ cmd: 'pulse', ms: CONFIG.MIST_PULSE_MS }));
    // }

    // NOTE: whichever transport is used, it must fail silently. A dead
    // dispenser can never be allowed to interrupt the game.
  },

  reset() {
    this.cooldown = 0;
  },
};

/* Convenience wrapper — the name the spec calls for. */
function fireMist(reason) {
  return Mist.fire(reason || 'payoff');
}
