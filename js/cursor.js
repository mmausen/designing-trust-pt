/* ═══════════════════════════════════════════════════════════════════
   CURSOR — the AI cursor's motion CHARACTER.

   Ported from the Cursor Gym (moveMe/gym), the testbed where the two
   characters were actually tuned. The gym is a sandbox: an agent sorts
   shapes into boxes while fifteen dials shape how it moves. This module is
   the motion half of that agent, lifted out and pointed at our board.

   What did NOT come across, deliberately:
     · take-over mode (shared / parallel) — the prototype has its own
       handoff semantics, and its own activation zone, already.
     · sorting strategy (random / rarest / nearest) — the AI here does not
       choose WHAT to place. That is the task's authored `ai-order`. The
       preset files still carry a `strategy` field, because they are raw gym
       exports; it is read and ignored.

   ── the contract every dial keeps ────────────────────────────────
   Each parameter is a toggle and one number, reached only through k(id),
   which returns 0 when the toggle is off. Zero always means "this effect is
   doing nothing", so a profile with everything off collapses to a plain
   min-jerk straight line — the motion this cursor had before any of it.
   Unipolar dials run 0 → 1; bipolar ones run −1 → +1 about a neutral centre.

   ── only the six dials the study actually uses ───────────────────
   The gym has fifteen. The other nine and all their machinery were cut on
   2026-09-08 rather than left as code nothing runs: B2 speed–curvature
   coupling, B7 intent broadcasting, B13 dwell duration, B18 proxemics, B19
   response latency, B21 idle behaviour, B22 arousal decay, A13 glyph aim,
   and A9 speed scale.

   A9 went last and for a different reason than the rest. It was a multiplier
   on a baseline shared by both characters, so at its floor (−1) a character
   could get no slower. Its job now belongs to `travel` in cursors.json, which
   states the two timing constants outright, per character — see below. Any
   A9 setting is expressible as a `travel` pair, so nothing was lost.

   B13 was restored briefly that day and dropped again once the pause it
   gives turned out not to be the wanted one: it lengthens the hold BEFORE an
   action (over a case before lifting, over a slot before releasing). The
   pause after a placement is `afterPlace` — see below.

   That leaves the gym able to author a dial this file will not run, so
   load() reports any ON dial it does not implement — the failure is loud
   instead of a preset that quietly does less here than it did in the gym.
   To bring one back, port it from moveMe/gym/js/agent.js; the ids and the
   maths are unchanged.

   ── where the numbers come from ──────────────────────────────────
   cursors.json, in the gym's own export format, with the presets named
   after the two characters. To retune: open moveMe/gym, dial it in, save the
   preset under the character's name, export, and drop the file in. Nothing
   here needs editing — an unknown dial in the file is ignored, and a missing
   one falls back to off.

   One profile is live at a time — use(character) pins it — because a session
   pins one character for its whole length (see Config.CHARACTERS).

   ── what it does NOT touch ───────────────────────────────────────
   The hidden mechanic. That one shows an OUTCOME, not a process: six tiles
   fly at one constant speed with no cursor at all (Config.HIDDEN_PLACE_MS).
   Motion character is what separates the two mechanics, so it stays out.
   ═══════════════════════════════════════════════════════════════════ */
window.Cursor = (function () {

  /* ── the parameter catalogue ──────────────────────────────────────
     Ids are the gym's, so a row here is the same row there. `def` is only
     the fallback for a dial a preset never mentions; a loaded profile
     normally supplies both halves. */
  const PARAMS = [
    { id: "B1",  bipolar: true,  def: 0.55 },  // velocity profile shape (flat ↔ impulse & glide)
    { id: "B3",  bipolar: false, def: 0.5  },  // submovement count
    { id: "B5",  bipolar: false, def: 0.4  },  // coherent noise
    { id: "A8",  bipolar: true,  def: 0.5  },  // path curvature bias (jagged ↔ smooth arc)
    { id: "B10", bipolar: false, def: 0.5  },  // competing-target pull
    { id: "B8",  bipolar: false, def: 0.5  },  // forethought & reaction beats
  ];

  /* The gym's other eight. Named only so load() can tell "a dial we dropped"
     apart from "a typo in the preset file" when it reports one that is on. */
  const RETIRED = ["A9", "B2", "B7", "B13", "B18", "B19", "B21", "B22", "A13"];

  /* ── the motion baseline, before any dial touches it ──
     Gym values. Everything a dial does is expressed relative to these, so
     changing one here moves both characters together. The two dwells are
     fixed values: B13, which used to scale them per character, is retired.

     Every number below is the GYM's, unchanged. That is the whole point: a
     dial value means the same thing in both places, so a character tuned in
     the gym moves the same way here. Do not edit one without editing
     moveMe/gym/js/agent.js to match. */
  const MOTION = {
    grabDwell: 140,   // ms   settle before a case is lifted
    dropDwell: 120,   // ms   settle before it is released
    beat:       90,   // ms   pause between cases
  };

  /* The travel pair moved OUT of MOTION and into cursors.json, one per
     character — see cleanTravel(). These are the fallbacks for a preset that
     does not state them (a raw gym export), and they are the gym's own
     values, so such a preset travels at exactly gym pace. */
  const TRAVEL_DEFAULT = { baseMs: 130, slopeMs: 185 };
  const TRAVEL_MAX_MS = 5000;      // sanity bound; a longer leg is a typo

  /* Safety valve, not a pacing device: a zero-size or off-screen rect would
     otherwise plan a minutes-long crawl. The gym's range, so a leg that the
     clamp bites there is bitten identically here. On our board the longest
     legitimate travel is ~1.5 s, so it never bites in practice. */
  const LEG_MIN_MS = 70, LEG_MAX_MS = 3000;

  const ZERO = { x: 0, y: 0 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const unit = (x, y) => { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; };

  /* ═══ coherent noise ═══════════════════════════════════════════════
     The substrate B5 needs. Smooth pseudo-random signal, not randomness, is
     what reads as personality; two octaves is enough, and the second keeps it
     from looking like a sine. ══════════════════════════════════════════ */
  function lane(seed) {
    const t = new Float32Array(512);
    let s = seed >>> 0;
    for (let i = 0; i < 512; i++) { s = (s * 1664525 + 1013904223) >>> 0; t[i] = s / 4294967296 * 2 - 1; }
    const smooth = f => f * f * (3 - 2 * f);
    const one = x => {
      const i = Math.floor(x), f = x - i;
      const a = t[i & 511], b = t[(i + 1) & 511];
      return a + (b - a) * smooth(f);
    };
    return x => one(x) * 0.68 + one(x * 2.17 + 31.7) * 0.32;
  }
  const noise = { x: lane(0x5eed11), y: lane(0xbeef23) };

  /* ═══ paths ════════════════════════════════════════════════════════
     Every leg is a sampled polyline through control points. Straight is just
     "no intermediate control points"; each path-shaping dial (A8, B7, B10)
     contributes an offset at a position along the leg, and they sum.

     Sampling up front also gives arc length, which is what at() walks to turn
     eased progress into a point. (It used to compute per-sample curvature too,
     for B2's two-thirds-power-law time warp; that went with B2.) ══════════ */
  const SAMPLES = 72;
  const catmull = (a, b, c, d, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };

  function buildPath(pts) {
    const c = [pts[0], ...pts, pts[pts.length - 1]];   // duplicate the ends
    const out = [];
    const segs = c.length - 3;
    for (let i = 0; i < segs; i++) {
      const steps = i === segs - 1 ? SAMPLES : SAMPLES - 1;
      for (let s = 0; s <= steps; s++) {
        const t = s / SAMPLES;
        out.push({
          x: catmull(c[i].x, c[i + 1].x, c[i + 2].x, c[i + 3].x, t),
          y: catmull(c[i].y, c[i + 1].y, c[i + 2].y, c[i + 3].y, t),
        });
      }
    }

    const arc = [0];
    for (let i = 1; i < out.length; i++)
      arc.push(arc[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
    const len = arc[arc.length - 1] || 1;

    // progress 0..1 (already eased) → the point that far along the arc
    function at(progress) {
      const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
      let lo = 0, hi = out.length - 1;
      const key = i => arc[i] / len;
      while (lo < hi - 1) { const m = (lo + hi) >> 1; (key(m) <= p) ? lo = m : hi = m; }
      const k0 = key(lo), k1 = key(hi);
      const f = k1 > k0 ? (p - k0) / (k1 - k0) : 0;
      return { x: out[lo].x + (out[hi].x - out[lo].x) * f,
               y: out[lo].y + (out[hi].y - out[lo].y) * f };
    }

    return { pts: out, arc, len, at };
  }

  /* ═══ travel timing — NOT a gym dial ═══════════════════════════════
     How long a leg takes: Fitts' law on the distance and the target's short
     side, with these two constants. Authored per character in cursors.json,
     outside `params`, because they are milliseconds rather than a 0…1 knob:

         "travel": { "baseMs": 299, "slopeMs": 425.5 }

       baseMs   the fixed cost of any move, however short
       slopeMs  added per bit of Fitts difficulty — log2(distance / width + 1),
                which is about 3 for a typical reach across our board

     A 630 px reach at those numbers takes 299 + 425.5 × 2.98 ≈ 1.6 s. Raise
     both together to slow a character down overall; raise only `slopeMs` to
     make long reaches disproportionately slower than short ones.

     This replaced the A9 dial on 2026-09-08. A9 scaled a shared baseline, so
     at its floor a character could get no slower; stating the constants
     outright has no floor and no ceiling worth the name.

     ── the cost, which is real ──
     Speed is now the one thing the gym CANNOT tune. Everything else here is
     still a gym dial, so shape — curvature, submovements, noise, beats —
     transfers as it always did; pace does not, and must be set by editing
     these numbers and reloading. */
  function cleanTravel(raw, name) {
    if (!raw || typeof raw !== "object") return TRAVEL_DEFAULT;
    const num = (v, fallback, field) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      const kept = clamp(n, 0, TRAVEL_MAX_MS);
      if (n !== kept) {
        console.warn(`[BDR] cursor preset "${name}": travel.${field} is ${n}, outside its ` +
                     `0…${TRAVEL_MAX_MS} range — running at ${kept}.`);
      }
      return kept;
    };
    const t = {
      baseMs:  num(raw.baseMs,  TRAVEL_DEFAULT.baseMs,  "baseMs"),
      slopeMs: num(raw.slopeMs, TRAVEL_DEFAULT.slopeMs, "slopeMs"),
    };
    /* LEG_MAX_MS used to be unreachable — A9 could only slow a leg so far.
       With the constants stated outright it is a real ceiling, and a pair
       that crosses it makes every long reach the SAME length however much
       further the numbers are pushed. TYPICAL_BITS is a reach across our
       board: log2(630px / 58px + 1) ≈ 3.5. */
    const TYPICAL_BITS = 3.5;
    const longLeg = t.baseMs + t.slopeMs * TYPICAL_BITS;
    if (longLeg > LEG_MAX_MS) {
      console.warn(`[BDR] cursor preset "${name}": travel ${t.baseMs}/${t.slopeMs} puts a ` +
                   `long reach at ~${Math.round(longLeg)}ms, past the ${LEG_MAX_MS}ms leg ceiling — ` +
                   `long reaches will all clamp to ${LEG_MAX_MS}ms. Raise LEG_MAX_MS in js/cursor.js ` +
                   `if the character really is meant to be this slow.`);
    }
    return t;
  }

  /* ═══ the after-place wait — NOT a gym dial ════════════════════════
     How long the cursor sits still after letting a case go, before it starts
     on the next one. Deliberately not one of the fifteen: it takes two
     numbers, not a 0…1 knob, and the gym has no equivalent — so it is
     authored in cursors.json OUTSIDE `params`, where it cannot be mistaken
     for something you can tune in the gym.

         "afterPlace": { "seconds": 1.0, "jitter": 0.5 }

     Each placement draws its own wait, `seconds` give or take `jitter` of
     itself — 1.0 ± 50% is a uniform 0.5…1.5 s. A fixed pause repeated six
     times a round reads as a machine ticking; a varying one reads as
     someone taking a moment. `jitter: 0` gives exactly `seconds` every time.

     Absent (a raw gym export has no such key) it is zero, so the cursor
     behaves exactly as it does in the gym. That is the point of keeping it
     out of `params`. */
  const AFTER_PLACE_MAX_S = 10;         // sanity bound; a longer wait is a typo
  const NO_WAIT = { seconds: 0, jitter: 0 };

  function cleanAfterPlace(raw, name) {
    if (!raw || typeof raw !== "object") return NO_WAIT;
    const num = (v, lo, hi, field) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return lo;
      const kept = clamp(n, lo, hi);
      if (n !== kept) {
        console.warn(`[BDR] cursor preset "${name}": afterPlace.${field} is ${n}, outside ` +
                     `its ${lo}…${hi} range — running at ${kept}.`);
      }
      return kept;
    };
    return {
      seconds: num(raw.seconds, 0, AFTER_PLACE_MAX_S, "seconds"),
      // above 1 the wait would go negative on a low draw, so that is the ceiling
      jitter: num(raw.jitter, 0, 1, "jitter"),
    };
  }

  /* ═══ profiles ═════════════════════════════════════════════════════ */
  let profiles = {};        // character → { params: { id: {on,v} }, afterPlace }
  let activeName = null;
  let active = null;

  /* A preset file is authored elsewhere and dropped in, so take only the
     dials we know, coerce their types, and clamp each into its own legal
     range. `strategy` is read and discarded — see the header. */
  function cleanPreset(raw, name) {
    if (!raw || typeof raw !== "object") return null;
    const src = (raw.params && typeof raw.params === "object") ? raw.params : {};
    const out = {};
    for (const p of PARAMS) {
      const got = src[p.id];
      if (!got || typeof got !== "object") continue;
      const v = Number(got.v);
      const lo = p.bipolar ? -1 : 0;
      const kept = Number.isFinite(v) ? clamp(v, lo, 1) : p.def;
      /* Say so rather than clamp in silence: a file asking for A8 1.8 and a
         file asking for 1 produce exactly the same cursor, and someone
         turning the number further to get more effect deserves to be told
         that it stopped having any. */
      if (got.on && Number.isFinite(v) && v !== kept) {
        console.warn(`[BDR] cursor preset "${name}": ${p.id} is ${v}, outside its ` +
                     `${lo}…1 range — running at ${kept}. Turning it further has no effect.`);
      }
      out[p.id] = { on: !!got.on, v: kept };
    }
    return Object.keys(out).length ? out : null;
  }

  /* Accepts the gym's export bundle: { presets: { <character>: {...} } }.
     Characters with no preset simply have no profile, and use(...) then falls
     back to the plain baseline — loudly, because a character silently losing
     its motion is exactly the bug that looks like "the AI feels the same in
     both conditions". */
  function load(json) {
    profiles = {};
    const src = (json && json.presets && typeof json.presets === "object") ? json.presets : {};
    for (const [name, raw] of Object.entries(src)) {
      const p = cleanPreset(raw, name);
      if (p) profiles[name] = { params: p,
                                travel: cleanTravel(raw.travel, name),
                                afterPlace: cleanAfterPlace(raw.afterPlace, name) };
      /* The gym can still author all fifteen. A dial that is ON in the file but
         retired here would otherwise just not happen — a preset that feels
         right in the gym and blander in the study, with nothing to say why. */
      const params = (raw && raw.params) || {};
      const live = RETIRED.filter(id => params[id] && params[id].on);
      if (live.length) {
        console.error(`[BDR] cursor preset "${name}" switches on ${live.join(", ")}, ` +
                      `which this build does not implement — ${live.length === 1 ? "it" : "they"} will have no effect. ` +
                      `Port from moveMe/gym/js/agent.js, or switch ${live.length === 1 ? "it" : "them"} off in the gym and re-export.`);
      }
    }
    if (activeName) use(activeName);          // a reload re-pins whatever was live
    return Object.keys(profiles);
  }

  function use(character) {
    activeName = character || null;
    active = (character && profiles[character]) || null;
    if (character && !active) {
      console.error(`[BDR] no cursor profile for character "${character}" in cursors.json — ` +
                    `the AI cursor will move with every dial off (a plain straight line).`);
    }
    return !!active;
  }

  const character = () => activeName;
  const has = name => !!profiles[name];          // is this character tuned at all?
  const characters = () => Object.keys(profiles);

  /* The single accessor every effect reads through. 0 always means
     "this effect is doing nothing". */
  function k(id) {
    const s = active && active.params[id];
    return s && s.on ? s.v : 0;
  }

  /* The dials that are actually ON, as { id: value }. Small enough to sit on
     every result, so a row of data says what the cursor was doing without
     anyone having to find the preset file this build shipped with. */
  function dials() {
    const out = {};
    if (!active) return out;
    for (const p of PARAMS) if (active.params[p.id] && active.params[p.id].on) out[p.id] = active.params[p.id].v;
    return out;
  }

  /* This character's authored timings, for the log. */
  const travel = () => (active ? active.travel : TRAVEL_DEFAULT);
  const afterPlace = () => (active ? active.afterPlace : NO_WAIT);

  /* One draw: `seconds` ± `jitter` of itself, uniform, in ms. Called once per
     placement so every case gets its own. */
  function afterPlaceMs() {
    const { seconds, jitter } = afterPlace();
    if (!seconds) return 0;
    return seconds * 1000 * (1 + (Math.random() * 2 - 1) * jitter);
  }

  /* ═══ B5 coherent noise — the per-frame offset ═════════════════════
     Displaces the DRAWN position without touching where the cursor believes
     it is, so no amount of drift can make it miss a tile. */
  function offset(now) {
    const a = k("B5");
    if (!a) return ZERO;
    const f = 0.0007 + a * 0.0026;
    const amp = a * 15;
    return { x: noise.x(now * f) * amp, y: noise.y(now * f) * amp };
  }

  /* ═══ B1 velocity profile · travel timing ══════════════════════════ */
  const bell = u => u * u * u * (10 + u * (-15 + 6 * u));    // min-jerk
  function ease(u) {
    const v = k("B1");
    if (!v) return bell(u);
    if (v < 0) return bell(u) + (u - bell(u)) * -v;                  // toward constant velocity
    return bell(u) + ((1 - Math.pow(1 - u, 2.6)) - bell(u)) * v;     // toward impulse & glide
  }

  /* Fitts' law on the distance and the target's width, with this character's
     own travel pair. `w` is the target's short side — for our cases and slots
     that is the height, which is what the accuracy demand actually is. */
  function legMs(dist, w) {
    const t = travel();
    return clamp(t.baseMs + t.slopeMs * Math.log2(dist / (w || 56) + 1), LEG_MIN_MS, LEG_MAX_MS);
  }
  // A correction leg is shorter than the ballistic one it is fixing.
  const correctionMs = ms => clamp(ms * 0.55, 60, 420);

  /* ═══ A8 curvature · B10 competing pull ═══════════════════════════ */
  /* The perpendicular unit vector pointing TOWARD the goals not chosen. (It
     used to hand back the outward one too, for B7's legibility bow; that went
     with B7.) */
  function towardBow(p0, p1, competitors) {
    if (!competitors || !competitors.length) return null;
    const u = unit(p1.x - p0.x, p1.y - p0.y);
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    let cx = 0, cy = 0;
    for (const c of competitors) { cx += c.x; cy += c.y; }
    cx /= competitors.length; cy /= competitors.length;
    const raw = { x: mid.x - cx, y: mid.y - cy };
    const along = raw.x * u.x + raw.y * u.y;
    const perp = unit(raw.x - along * u.x, raw.y - along * u.y);
    return { x: -perp.x, y: -perp.y };
  }

  /* One leg, as a path. `competitors` are the targets it is NOT going to —
     the other tiles when reaching, the other free slots when carrying — which
     is what B10 leans toward. */
  function buildLeg(p0, p1, competitors) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dist = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / dist, y: dx / dist };
    const parts = [];

    const curve = k("A8");
    if (curve > 0) parts.push(t => { const a = curve * 0.30 * dist * Math.sin(Math.PI * t);
                                     return [n.x * a, n.y * a]; });
    if (curve < 0) parts.push(t => { const a = curve * 0.13 * dist * Math.sin(3 * Math.PI * t);
                                     return [n.x * a, n.y * a]; });

    const pull = k("B10");
    const toward = pull ? towardBow(p0, p1, competitors) : null;
    if (toward) {
      const a = pull * 0.30 * dist;
      parts.push(t => { const b = Math.exp(-Math.pow((t - 0.30) / 0.24, 2));
                        return [toward.x * a * b, toward.y * a * b]; });
    }

    if (!parts.length) return buildPath([p0, p1]);
    const cps = [p0];
    for (const t of [0.25, 0.5, 0.75]) {
      let x = p0.x + dx * t, y = p0.y + dy * t;
      for (const p of parts) { const [ox, oy] = p(t); x += ox; y += oy; }
      cps.push({ x, y });
    }
    cps.push(p1);
    return buildPath(cps);
  }

  /* ═══ B3 submovements ══════════════════════════════════════════════
     One ballistic throw that undershoots, then corrections. None reads as
     skilled and faintly arrogant; three or four small ones read as fussy or
     unsure where the target is. Returns the leg ENDPOINTS, the last of which
     is always the true target — the cursor must not end up short of it. */
  function subTargets(p0, p1) {
    const a = k("B3");
    if (!a) return [p1];
    const n = Math.max(1, Math.round(a * 4));
    const dx = p1.x - p0.x, dy = p1.y - p0.y, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    const under = 0.05 + a * 0.16;
    const jitter = d * 0.05 * a;
    let cur = { x: p0.x + dx * (1 - under) + nx * (Math.random() - .5) * jitter,
                y: p0.y + dy * (1 - under) + ny * (Math.random() - .5) * jitter };
    const out = [cur];
    for (let i = 1; i < n; i++) {
      const f = 0.55 + Math.random() * 0.25;
      cur = { x: cur.x + (p1.x - cur.x) * f + (Math.random() - .5) * 6,
              y: cur.y + (p1.y - cur.y) * f + (Math.random() - .5) * 6 };
      out.push(cur);
    }
    out.push(p1);
    return out;
  }

  /* ═══ B8 forethought & reaction beats ══════════════════════════════ */
  /* A small counter-move away from the target before reaching, and a settle
     after the drop. The difference between a move that happens and a move
     that was decided. Null when the dial is off. */
  function forethought() {
    const a = k("B8");
    if (!a) return null;
    return {
      backPx:  5 + a * 16,      // how far it pulls back before going
      glideMs: 110 + a * 180,
      holdMs:  50 + a * 150,
      beatPx:  4 + a * 12,      // the settle upward after letting go
      beatMs:  90 + a * 130,
    };
  }

  return {
    // used by the prototype
    MOTION, load, use, has, dials, travel, afterPlace, afterPlaceMs,
    offset, ease, legMs, correctionMs, buildLeg, buildPath, subTargets, forethought,

    /* Console seam. Nothing in the prototype calls these — they are here so
       the live state can be read from the browser console while tuning, which
       is what the README tells you to do rather than trusting cursors.json to
       match what is running: PARAMS and RETIRED say which dials exist and
       which were cut, k(id) gives one dial's live value, character() and
       characters() say what is pinned and what loaded. */
    PARAMS, RETIRED, k, character, characters,
  };
})();
