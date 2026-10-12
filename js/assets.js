/* ============================================================
   ASSETS — the manifest, and a loader that never blocks the game.

   Only the hand-drawn pieces ship as PNGs: Dewy's body and the four
   limbs of the run cycle. Everything else the game draws is vector work in shapes.js and path.js,
   because the corridor and the path have to recolour from purple to
   turquoise on the fly and a flat PNG cannot do that.

   If an image is missing the game still runs — Dewy falls back to a
   drawn blob. Nothing here is fetched from the network.
   ============================================================ */

const Assets = {
  images: {},
  loaded: 0,
  total: 0,
  fontReady: false,

  /* Back-view rigs. `c-1`..`c-4` are the centre run, a four-frame
     cycle drawn over one shared body; `left`/`right` are the R2 poses
     that turn into the turn. Only the turned pair carry a `legFar` —
     the centre frames put every limb over the body, as the artwork
     does, so a missing part there is expected rather than an error.

     All six are exported onto one shared canvas, so the game can swap
     between them mid-stride without Dewy jumping or resizing. */
  /* Which parts each back rig actually ships.

     The centre cycle's four poses flatten both legs into one `legs`
     image, because the source draws them as a single stack per frame.
     The turned pair keep a separate `legFar` behind the body. Listing
     the parts per rig rather than assuming a common set stops the
     loader asking for four files that were never exported. */
  BACK_RIGS: {
    'c-1':   ['body', 'legs', 'armBack', 'armFront'],
    'c-2':   ['body', 'legs', 'armBack', 'armFront'],
    'c-3':   ['body', 'legs', 'armBack', 'armFront'],
    'c-4':   ['body', 'legs', 'armBack', 'armFront'],
    'left':  ['body', 'legFar', 'legs', 'armBack', 'armFront'],
    'right': ['body', 'legFar', 'legs', 'armBack', 'armFront'],
  },

  /* Front-on run, for the title and score cards. Two poses, and the
     face is its own layer so it can be held level while the body
     tilts. */
  FRONT_RIGS: { 'f1': ['body', 'face', 'legs', 'armBack', 'armFront'],
                'f2': ['body', 'face', 'legs', 'armBack', 'armFront'] },

  MANIFEST: {
    dewyFront:  'assets/dewy-front.png',
    dewdrop:    'assets/dewdrop.png',
  },

  /* Every part of a rig shares one canvas, so one part's natural size
     is the whole rig's size. Filled in when the first body lands. */
  rigWidth: 665,
  rigHeight: 768,
  frontWidth: 737,
  frontHeight: 567,

  /* Build the per-part manifest entries. Listing 31 files by hand is
     just an opportunity to mistype one. */
  _expand() {
    for (const rig of Object.keys(this.BACK_RIGS)) {
      for (const part of this.BACK_RIGS[rig]) {
        this.MANIFEST[`rig:${rig}:${part}`] = `assets/rig-${rig}-${part}.png`;
      }
    }
    for (const rig of Object.keys(this.FRONT_RIGS)) {
      for (const part of this.FRONT_RIGS[rig]) {
        this.MANIFEST[`fr:${rig}:${part}`] = `assets/fr-${rig}-${part}.png`;
      }
    }
  },

  load() {
    this._expand();
    const keys = Object.keys(this.MANIFEST);
    this.total = keys.length;

    for (const key of keys) {
      const img = new Image();
      img.onload = () => {
        this.images[key] = img;
        this.loaded++;
        if (key === 'rig:c-1:body') {
          this.rigWidth = img.naturalWidth;
          this.rigHeight = img.naturalHeight;
        } else if (key === 'fr:f1:body') {
          this.frontWidth = img.naturalWidth;
          this.frontHeight = img.naturalHeight;
        }
      };
      img.onerror = () => {
        // A missing file is survivable: the drawn fallback takes over.
        console.warn('[assets] missing', this.MANIFEST[key]);
        this.loaded++;
      };
      img.src = this.MANIFEST[key];
    }

    this._loadFont();
  },

  /* Chewy is the display face across the whole mockup set. It is
     loaded from this folder — no Google Fonts, no network. */
  _loadFont() {
    if (typeof FontFace === 'undefined' || !document.fonts) return;
    const face = new FontFace('Chewy', "url('assets/Chewy-Regular.ttf')");
    face.load().then((f) => {
      document.fonts.add(f);
      this.fontReady = true;
    }).catch((e) => console.warn('[assets] Chewy unavailable:', e));
  },

  get(key) { return this.images[key] || null; },

  /* A back rig's part, e.g. part('left', 'armFront'). */
  part(rig, name) { return this.images[`rig:${rig}:${name}`] || null; },
  frontPart(rig, name) { return this.images[`fr:${rig}:${name}`] || null; },
  ready() { return this.total > 0 && this.loaded >= this.total; },
};
