/* ============================================================
   Dewy's Pipeline Run — CONFIG

   Every number worth tuning on-site lives here. Nothing else in
   the game should hardcode a value you might want to change.

   Colours are lifted straight from the Affinity mockups so the
   running game and the artwork stay the same piece of design.
   ============================================================ */

const TITLE = "Dewy's Pipeline Run";
const SUBTITLE = 'Flow State';

const CONFIG = {

  /* ---------- Authoring resolution ----------
     The mockups are 1920 x 2629 (a tall portrait board). The game
     derives its scale from the *narrower* of the two ratios, so it
     reads the same in landscape now and on the stacked-monitor
     portrait column later. */
  REF_WIDTH: 1080,
  REF_HEIGHT: 1480,

  /* ---------- Camera / fake-3D projection ----------
     Camera sits at world z = 0 looking down +z. A point at distance
     z projects with scale = focal / z.

     None of focal, camera height or the near clip is a fixed number.
     All three are solved at resize time from three framing rules
     taken straight off the mockup:

       the ribbon is PATH_SCREEN_FRAC of the width at Dewy's depth
       Dewy's feet sit at PLAYER_FLOOR_FRAC down the screen
       the vanishing point sits at the horizon fraction

     Solving rather than hardcoding is what makes the framing hold in
     landscape now and in the tall stacked-monitor column later: a
     taller window shows more corridor, never a differently framed
     run. */
  PATH_SCREEN_FRAC: 0.128,     // half the ribbon, as a fraction of width
  PLAYER_FLOOR_FRAC: 0.85,     // where Dewy's feet land down the screen

  // The horizon has to move with the aspect: a tall column wants it
  // high so the corridor has somewhere to recede to, a wide window
  // wants it lower or the floor swallows the frame.
  HORIZON_FRAC_WIDE: 0.30,     // at 16:9 and wider
  HORIZON_FRAC_TALL: 0.11,     // at 3:4 and taller

  DRAW_DISTANCE: 9500,         // furthest z drawn (the vanishing point)

  /* ---------- The corridor ---------- */
  CORRIDOR_HALF: 620,          // wall plane, world units either side of centre
  /* The walls have to run off the top of the frame, not stop short of
     it. On a tall screen 1700 left a band of bare void above the
     nearest slice: the corridor looked like it had a ceiling. The
     rotated 29WN600 needs ~2310 for the near slice to clear, so this
     carries headroom for anything taller again. */
  /* How far past the horizon the top-of-frame fade reaches, as a
     fraction of screen height. The walls run off the top, but between
     the near slices and the vanishing point their tops cut a hard
     diagonal across the upper corners; this dissolves it. */
  TOP_FADE_EXTRA: 0.07,

  WALL_HEIGHT: 2500,           // how far the walls rise (they run off-screen)
  SEG_LEN: 115,                // depth of one floor segment
  WALL_PILASTER_EVERY: 5,      // a lighter stripe every N slices

  /* ---------- The path: three lanes, square corners ----------
     The ribbon runs dead straight down one of three lanes — left,
     centre, right — then steps across to another over a short fixed
     distance. In perspective that short step reads as a rounded
     right-angle elbow, which is the shape in the mockups. A freely meandering centreline looks
     arbitrary by comparison and gives the player nothing to aim at.

     LANE_WIDTH has to stay comfortably wider than PATH_HALF +
     FALL_MARGIN, or a player who ignores a corner entirely is still
     standing on the next lane and the turn means nothing. */
  PATH_HALF: 150,              // half-width of the walkable ribbon
  LANE_WIDTH: 340,             // distance between lane centres
  PATH_LEG_MIN: 1250,          // depth of one straight run between corners
  PATH_LEG_MAX: 1850,
  /* The corner. A shorter distance is a sharper elbow and a harder
     turn: the lateral rate it demands is LANE_WIDTH x speed /
     PATH_TURN_LEN, and that has to stay under STEER_SPEED at
     MAX_SPEED or the path is unfollowable through no fault of the
     player. `test/smoke.js` checks exactly this. */
  PATH_TURN_LEN: 380,
  PATH_DOUBLE_CHANCE: 0.22,    // odds a corner crosses two lanes at once
  PATH_EDGE_W: 20,             // the bright outline, world units
  PATH_RIM_W: 24,              // the soft outer rim behind the outline

  /* ---------- Falling off ---------- */
  FALL_MARGIN: 70,             // grace past the ribbon edge before falling
  /* Stepping off does not drop you instantly: you teeter for this
     long first, and getting back over the edge saves you. A lane path
     asks the player to commit to every corner, and without this a
     half-second of not looking is a dead run — which reads as the
     game being unfair rather than the player being late. It is the
     platformer's coyote time, and it is what keeps a queue moving. */
  COYOTE_TIME: 0.55,           // seconds off the ribbon before falling
  /* Leaning outward cannot kill you. Dewy presses against the outer
     edge of the ribbon and stays there, however hard the player
     leans — so reaching for a doorway is never the thing that ends a
     run. The only way off the path is failing to follow it when it
     moves, which is the one skill the game is actually asking for. */
  EDGE_BLOCK: true,
  FALL_TIME: 0.85,             // seconds of tumbling before the score screen

  /* ---------- Speed ---------- */
  BASE_SPEED: 640,             // world units/second at the start of a run
  MAX_SPEED: 1280,
  SPEED_RAMP: 0.0072,          // gained per world unit travelled
  BOOST_SPEED: 1560,           // flat speed while a totem boost is running

  /* ---------- Dewy ---------- */
  PLAYER_Z: 560,               // how far ahead of the camera Dewy runs
  /* Dewy's drawn size. This is a readability setting, but it has a
     ceiling: she has to stay legible against the ribbon she is
     standing on, because leaving it is how a run ends. At 690 she was
     twice the path's width and the edges disappeared behind her; 500
     is a clear step up from the original 345 and still reads against
     the lane. */
  PLAYER_HEIGHT: 500,          // world units, sprite height
  STEER_SPEED: 1400,           // world units/second of lateral movement
  STEER_SMOOTH: 14,            // how fast the steer input settles
  JUMP_VELOCITY: 840,
  GRAVITY: 2500,
  /* ---------- The run rig ----------
     A centre four-frame cycle, plus an R2 pair that turn Dewy's body
     into the turn so steering reads on her and not just on her
     position. Only the turned pair are animated by these constants;
     the centre cycle is carried by its own drawn frames. Hysteresis on the switch, or she
     flickers between poses when a player holds a lean near the
     threshold — which pose input does constantly. */
  RIG_TURN_ENTER: 0.40,        // lean this far to turn the body
  RIG_TURN_RELEASE: 0.24,      // come back inside this to face front

  /* The turned rigs are a single drawn pose, so their run is animated
     here: the limbs rotate about a pivot on the run cycle. The centre
     rig already has two drawn frames, so it only needs a hint. */
  LIMB_SWING_TURN: 0.26,       // radians, turned rigs (arms)
  /* Legs get far less. They are drawn mid-stride already, and the two
     of them counter-rotating about one hip sweeps them straight
     through each other — which on outline-only art reads as one thick
     leg rather than two. A nudge around the drawn pose is enough. */
  LIMB_SWING_LEG: 0.09,
  ARM_RAISE: 0.95,             // radians — both arms up, turned rigs
  /* Pivots as a fraction of the rig canvas: shoulders and hips. */
  PIVOT_ARM_BACK:  [0.44, 0.40],
  PIVOT_ARM_FRONT: [0.62, 0.40],
  PIVOT_HIP:       [0.52, 0.56],

  RUN_CYCLE: 11,               // run-cycle frequency, radians/second
  RUN_BOB: 12,                 // vertical bob, world units
  MAX_LEAN: 0.16,              // radians of body tilt when steering hard

  /* ---------- Doorways (the apps you connect) ----------
     Left and right walls run their own independent spawn clocks, so
     the two sides never fall into lockstep. */
  /* Pacing target: a ~50-60 second run should read as 8-12 apps on
     the score card. At the speeds below that is a doorway roughly
     every 6,500 world units overall, so each wall waits about twice
     that between its own. */
  DOOR_GAP_MIN: 4200,          // world units between doorways on ONE side
  DOOR_GAP_MAX: 6800,
  DOOR_FIRST: 1800,            // first doorway on the left wall
  DOOR_FIRST_OFFSET: 2400,     // right wall starts this much further along
  /* A doorway is a plane parallel to the view axis, so its width on
     screen comes entirely from how much corridor it spans. Short
     doorways are only legible for the last second before they pass;
     these run long, which is what gives the artwork's big flat
     panels flanking the path. */
  /* A doorway is a tall, narrow slot, not a broad panel. Narrow is
     what makes the connection read: the turquoise floods a shape you
     can take in at a glance, and two of them in view are obviously
     two apps rather than one long wall. */
  DOOR_WIDTH: 640,             // along the corridor (world units of depth)
  DOOR_HEIGHT: 1180,
  DOOR_SILL: 0,                // the doorway runs to the floor
  DOOR_INSET: 18,              // how far the panel sits proud of the wall
  /* The dark recess around the opening. Scaled to the panel: on a
     narrow doorway a heavy reveal eats most of the lit face, and the
     flood has nothing left to fill. */
  DOOR_REVEAL: 24,             // dark frame around the opening, world units
  DOOR_CONNECT_TIME: 0.75,     // seconds for the turquoise flood to fill it
  DOOR_DROPS: 25,              // dewdrops awarded for connecting an app

  /* ---------- Geometric shapes in the doorways ---------- */
  SHAPE_SIZE: 430,             // nominal world size inside a doorway
  /* How far the corridor axis may be squashed when a shape is laid
     into the wall plane. A true projection goes to zero as the panel
     turns edge-on, and the app would vanish exactly when the player
     is closest to it. */
  SHAPE_PLANE_MIN: 0.42,

  SHAPE_CORNER: 0.10,          // corner rounding as a fraction of size
  SHAPE_SPIN: 0.6,             // radians/second on connect

  /* ---------- Sparkle dewdrops ---------- */
  DROP_SIZE: 118,              // world units, point to shoulder
  DROP_Y: 120,                 // float height above the floor
  DROP_BOB: 14,
  DROP_BOB_SPEED: 3.2,
  DROP_SPACING: 210,           // depth between drops in a trail
  COLLECT_X: 150,              // half-width for collecting (generous)

  /* ---------- Grumpy clouds (the only thing that kills you) ---------- */
  /* A cloud sits low on the path so it can be jumped as well as
     steered around. CLOUD_Y + CLOUD_SIZE/2 is the top of the drawn
     blob; CLOUD_CLEAR_Y is set just above it so Dewy's feet visibly
     pass over, and JUMP_VELOCITY has to reach it with room to spare
     (apex is JUMP_VELOCITY^2 / 2*GRAVITY). `test/smoke.js` checks
     the jump actually clears. */
  CLOUD_SIZE: 180,
  CLOUD_Y: 30,
  CLOUD_CLEAR_Y: 125,          // Dewy clears a cloud above this height
  CLOUD_CHANCE: 0.62,          // chance a cloud slot is actually used
  CLOUD_HIT_X: 105,
  CLOUD_FIRST: 2600,           // no clouds before this — let people settle in
  OBSTACLE_TURN_CLEAR: 260,    // keep clouds this far clear of a turn

  /* ---------- Totems (two stacked shapes = the boost) ---------- */
  /* One totem every ~12 seconds. Any denser and a 4-second boost
     leaves the player permanently hands-free, which is no longer a
     reward — it is the game playing itself. */
  /* A totem buys BOOST_TIME + BOOST_HANDOFF seconds of invulnerable
     auto-run, so spacing them is really a choice about what fraction
     of the run the player cannot lose. At 15000 that was ~31%; this
     is ~42%. Below about 9000 it passes half, falling off stops
     happening, and the run stops being a game. */
  TOTEM_EVERY: 7800,           // world units between totems
  TOTEM_FIRST: 3900,
  TOTEM_SIZE: 260,             // width of the bottom dome
  TOTEM_STACK: 3,              // domes in the stack, bottom to top
  /* One size all the way up. Tapering made the stack read as a
     wedding cake rather than as three equal marks stacked. */
  TOTEM_TAPER: 1.0,
  TOTEM_HIT_X: 165,            // generous — a totem is a reward, not a test
  TOTEM_DROPS: 40,             // dewdrops awarded for a totem
  /* Shorter now that totems are frequent. Each one buys
     BOOST_TIME + BOOST_HANDOFF seconds during which the run cannot be
     lost, so the two constants have to move together: at 4s and a
     totem every 5200 units the player would be invulnerable most of
     the way down the corridor. */
  BOOST_TIME: 1.9,             // seconds of hands-free auto-run
  BOOST_AUTOSTEER: 11,         // how hard the boost pins Dewy to the ribbon
  /* Control does not snap back the instant a boost ends. It blends
     out over this long, with falling suspended, so the player is
     never handed a moving Dewy mid-turn at boost speed. */
  BOOST_HANDOFF: 0.8,

  /* ---------- Scoring ----------
     One currency: the dewdrop. The score IS the number of drops
     collected, and connecting an app or hitting a totem pays out in
     drops rather than in an abstract second number. One thing to
     read on the HUD, one thing to beat on the score card. */
  HIGH_SCORE_KEY: 'dewys-dash-high-score',

  /* ---------- Palette — sampled from the mockups ---------- */
  /* ---------- Corridor colour schemes ----------
     The corridor cycles through its grounds as the run goes on, so
     a long run does not look like one long corridor. Only the walls
     and the void change: the path, the turquoise, the doorways, the
     drops and Dewy are all brand-locked and stay put, or the player
     loses the things they are actually reading.

     Sampled from the flattened `color schemes.psd`, not from its
     layers: several of those sit at partial opacity, so a layer's own
     colour is not the colour you see. The five wall tones per scheme
     are that block's palette ordered dark to light.

     The ground underneath stays navy across all three. The
     swatches are woven plaids on white with no dark tone of their
     own, and without a dark ground the path has nothing to stand
     against. */
  SCHEME_SPAN: 14000,          // world units per scheme
  SCHEME_FADE: 0.28,           // fraction of that span spent blending
  SCHEME_KEYS: ['wallBase', 'wallStripe', 'wallLilac', 'wallGrey',
                'wallEdge', 'void', 'voidDeep'],
  SCHEMES: [
    { // 1 - purple and mauve
      wallBase: '#60378D', wallStripe: '#8D7AA2', wallGrey: '#C0A7BE',
      wallLilac: '#CAADC7', wallEdge: '#DAD1DB',
      void: '#0B375F', voidDeep: '#062741',
    },
    { // 2 - teal, slate and ice
      wallBase: '#623A8F', wallStripe: '#829DC1', wallGrey: '#79C0BE',
      wallLilac: '#9AB8D0', wallEdge: '#DBECF1',
      void: '#0B375F', voidDeep: '#062741',
    },
  ],

  COLORS: {
    /* The dark that everything sits on. */
    void:        '#290A4E',
    voidDeep:    '#1D0637',

    /* Corridor walls: flat vertical bands, no gradients.

       Deliberately darker than the doorways. In the artwork the
       bright lilac panels ARE the alcoves — so the wall has to stay
       out of their register, or every stripe reads as an app and
       none of them reads as the one to aim for. */
    wallBase:    '#2B0C50',
    wallStripe:  '#43206B',
    wallLilac:   '#6E4FA3',
    wallGrey:    '#5A4470',
    wallEdge:    '#8266B0',

    /* The path before Dewy runs it. */
    pathFill:    '#9377C1',
    pathEdge:    '#7C3FE0',
    pathRim:     '#B79FD6',
    pathShadow:  '#1D0637',

    /* The path after — the whole point of the game. */
    litFill:     '#66EBDA',
    litEdge:     '#25C4B4',
    litRim:      '#A8F5EA',
    litFlush:    '#EAFFFB',

    /* Doorways. */
    doorPurple:  '#C3A6F0',
    doorPurpleD: '#9C7FC9',
    doorLit:     '#66EBDA',

    /* Dewy. */
    dewy:        '#C4A8FC',
    dewyLine:    '#FFFFFF',

    /* Dewdrops. */
    drop:        '#68F3E0',
    dropDeep:    '#2FBFAE',
    dropShine:   '#FFFFFF',

    /* Grumpy cloud. */
    cloud:       '#8C8C8C',
    cloudLine:   '#141414',

    /* Type + chrome. */
    ink:         '#101010',
    paper:       '#FFFFFF',
    turquoise:   '#66EBDA',

    /* Navy — the score card's ground. The run happens in the purple
       temple; the payoff lands on navy. */
    navy:        '#0B375F',
    navyDeep:    '#062741',
    navyLine:    'rgba(102,235,218,0.22)',
    lilac:       '#C3A6F0',
    lilacDeep:   '#8B4FE0',

    /* Flashes. */
    boostFlash:  '#C9FFF6',
    hitFlash:    '#FF6B7A',
  },

  /* The shape set. Picked at random for doorways and totems.
     `kind` maps to a draw routine in shapes.js. */
  SHAPES: [
    { kind: 'domes',    color: '#F674E1' },
    { kind: 'diamond',  color: '#F7C100' },
    { kind: 'arrows',   color: '#C0E130' },
    { kind: 'circle',   color: '#4FC9F0' },
    { kind: 'triangle', color: '#F65B25' },
  ],

  /* ---------- Particles ---------- */
  PARTICLE_MAX: 520,
  PARTICLE_MAX_PX: 30,         // screen cap, or a near sparkle fills the frame
  SPARKLE_ON_COLLECT: 12,
  /* The app shape thrown out of a doorway as it connects. */
  BURST_LIFE: 1.5,             // seconds before it has faded out
  BURST_SPEED: 620,            // sideways launch, world units/second
  BURST_LIFT: 380,             // upward launch
  BURST_GRAVITY: 1500,
  BURST_SPIN: 5.0,             // radians/second while rolling
  BURST_BOUNCE: 0.42,          // how much of the fall it gives back

  SPARKLE_ON_CONNECT: 34,
  AMBIENT_SPARKLE_RATE: 10,    // per second, drifting off the lit trail
  BOOST_SPARKLE_RATE: 34,

  /* ---------- The wave that ends a run ---------- */
  WAVE_DROPS: 130,             // dewdrops raining down the screen
  WAVE_RAIN_TIME: 1.6,         // seconds of rain before the water rises
  WAVE_RISE_TIME: 1.5,         // seconds for the wave to fill the screen
  WAVE_CARD_DELAY: 0.45,       // beat between the wave landing and the card
  /* The water stops here rather than swallowing the screen: it laps
     along the bottom third and keeps moving under the card, so the
     payoff screen is alive rather than a static slate. */
  WAVE_REST_LEVEL: 0.34,

  /* ---------- Pose input ---------- */
  POSE_ENABLED: true,
  POSE_LIB_PATH: './js/lib/vision_bundle.mjs',
  POSE_WASM_PATH: './js/lib/wasm',
  POSE_MODEL_PATH: './models/pose_landmarker_lite.task',
  POSE_VIDEO_W: 640,
  POSE_VIDEO_H: 480,
  POSE_MIRROR: true,

  /* Thresholds are in shoulder-widths, so they hold at any distance
     from the camera. Steering is continuous now, not lane-snapped. */
  POSE_LEAN_RANGE: 0.55,       // lean this far to reach full steering
  POSE_LEAN_DEADZONE: 0.08,    // ignore this much wobble around neutral
  POSE_SMOOTHING_RATE: 10,
  POSE_JUMP_MARGIN: 0.04,      // wrist must clear the shoulder by this much
  POSE_JUMP_COOLDOWN: 0.45,
  POSE_CALIBRATE_TIME: 1.2,
  POSE_LOST_TIME: 1.0,
  POSE_RECALIBRATE_TIME: 3.0,
  SHOW_POSE_DEBUG: false,      // camera preview — operator aid, off for the floor
  POSE_PREVIEW_W: 180,

  /* ---------- Audio (synthesised in the browser, nothing streamed) ---------- */
  AUDIO_ENABLED: true,
  MUSIC_VOLUME: 0.22,
  SFX_VOLUME: 0.38,
  MUSIC_BPM: 104,

  /* ---------- Mist dispenser ---------- */
  MIST_LOG: false,             // log every mist fire — on for hardware bring-up
  MIST_COOLDOWN: 2.5,
  MIST_PULSE_MS: 350,
  MIST_FLASH_STRENGTH: 0.30,

  /* ---------- Screens ---------- */
  COUNTDOWN_TIME: 3.0,

  /* ---------- Attending the stand ----------
     The attract card is the resting state. Anything else on screen
     means somebody is stood in front of the machine; the moment that
     stops being true, the game goes back to attracting. */
  ATTRACT_TIMEOUT: 22,         // idle seconds on consent/score -> attract
  ABANDON_TIME: 8,             // seconds with nobody in frame mid-run

  /* ---------- Camera notice ----------
     The gate the player confirms before a run. The standing notice on
     the attract card matters more: by the time anyone can raise their
     hands, the camera has already watched them do it, so the
     disclosure has to be readable before they ever engage. */
  CONSENT_TITLE: 'Before you play',
  CONSENT_BODY: [
    'This game reads your body position from the camera in front of',
    'you (lean, jump, hands up) to move Dewy.',
    '',
    'All processing happens on this computer. No photo, video or',
    'recording of you is stored, uploaded, transmitted, or used to',
    'identify you.',
  ],
  CONSENT_ACCEPT: 'Raise both hands to start',
  CONSENT_ACCEPT_KEY: 'Press any key to start',

  /* The one-liner that sits on the attract card, always visible. */
  CREDIT_LINE: 'Experience by Glom Labs',
  ATTRACT_NOTICE: 'Camera in use for motion controls · No images or data are recorded, stored or uploaded',

  /* ---------- Social ---------- */
  /* Shown under the start button when set. Empty hides them. */
  SOCIAL_LINE: '',
  SOCIAL_TAGS: '',

  /* ---------- How to play ----------
     A taught run, not a wall of text: each card names one control and
     waits for the player to actually do it. Nobody at a stand reads
     instructions, but everybody copies a picture.

     Every card has a ceiling as well as a goal, so a player who
     cannot make the gesture work — or a camera that is not seeing
     them — still reaches the run instead of stalling the queue. */
  TUTORIAL_ENABLED: true,
  TUTORIAL_SPEED: 0.62,        // fraction of BASE_SPEED during the lesson
  TUTORIAL_HOLD: 1.5,          // a solved card stays up at least this long
  TUTORIAL_STEPS: [
    { id: 'steer',   title: 'Lean left and right',
      body: 'Keep Dewy on the path',        max: 11 },
    { id: 'collect', title: 'Run through the dewdrops',
      body: 'They mark the way to each app', max: 8 },
    { id: 'jump',    title: 'Raise one or both hands to jump',
      body: 'Hop the grumpy clouds',         max: 11 },
  ],
  TUTORIAL_STEER_MIN: 0.45,    // how far to lean before the card is satisfied
  TUTORIAL_DROPS: 3,           // drops to collect on the collect card
  TUTORIAL_CLOUD_AHEAD: 1500,  // where the practice cloud is laid down
  TUTORIAL_CLOUD_EVERY: 3.2,   // another one this often until they jump

  GAME_OVER_LOCKOUT: 1.6,      // ignore input this long on the score screen
  FLASH_DECAY: 2.6,

  /* ---------- Copy ---------- */
  CTA_LINE: 'Every app, one automated flow',

  /* ---------- Debug ---------- */
  /* The HUD is read from across a stand, not from a desk. One number
     scales the drop count and the app count
     together, so it can be dialled in on the actual screen. */
  /* Backing-store resolution cap. A rotated 2560x1080 panel is 2.8M
     CSS pixels; at devicePixelRatio 2 the canvas becomes 11.1M, which
     is four times the fill cost every frame for flat vector art that
     nobody is inspecting from six inches away, on a screen people
     stand two metres from. 1 is the right answer for the stand; raise
     it only if you are screenshotting for print. */
  MAX_DPR: 1,

  HUD_SCALE: 2.0,
  /* Everything typographic rides this. The screen is read from a
     couple of feet away by someone standing up, not from a desk. */
  UI_SCALE: 1.3,

  SHOW_FPS: false,
};

/* Small helper every module uses. Defined here so it exists before
   any other script runs. */
function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
