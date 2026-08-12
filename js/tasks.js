/* ═══════════════════════════════════════════════════════════════════
   TASKS — the real task content, from the bilingual task_thought.json.

   That file shares its STRUCTURE and splits only its PROSE:

     { id, tiles:[{ key, de:{text,thought}, en:{…} }],
       scriptedError:{ swapKeys, de:{pair,rationale,wrongThought[2]}, en:{…} },
       de:{title,description}, en:{…} }

   `pair` and `wrongThought` are 2-element arrays positionally aligned to the
   SHARED swapKeys, so which tile a sentence belongs to cannot diverge between
   languages either.

   `id`, `tiles[].key` and `scriptedError.swapKeys` therefore exist exactly
   once and CANNOT diverge between languages — which is what keeps card ids
   ("t0"…"t5"), the seeded shuffle, the participant's placements, scoring
   and the scripted error language-independent, and a mid-task language
   switch safe.

   `resolve()` flattens one bilingual task into an ordinary single-language
   task ({id,title,description,tiles:[{key,text,thought}],scriptedError}),
   so everything downstream stays unaware of the bilingual layout. Views are
   built once per language and cached.

   When the prototype is baked into a single file, inline the JSON here.
   ═══════════════════════════════════════════════════════════════════ */
window.Tasks = (function () {
  let raw = [];        // the merged bilingual tasks, as authored
  let views = {};      // lang → { list, byId } of language-resolved tasks

  function load(json) {
    raw = (json && Array.isArray(json.tasks)) ? json.tasks : [];
    views = {};        // drop cached views — content changed
  }

  // Flatten a bilingual task into a plain single-language one.
  function resolve(t, lang) {
    const L = t[lang] || {};
    const se = t.scriptedError || {};
    const seL = se[lang] || {};
    return {
      id: t.id,
      title: L.title || "",
      description: L.description || "",
      tiles: (t.tiles || []).map(tile => {
        const tl = tile[lang] || {};
        return { key: tile.key, text: tl.text || "", thought: tl.thought || "" };
      }),
      scriptedError: {
        swapKeys: se.swapKeys,
        pair: seL.pair,
        rationale: seL.rationale,
        wrongThought: seL.wrongThought,
      },
    };
  }

  // The resolved task set for the active language (built on first use).
  function active() {
    const l = (window.I18n && I18n.get()) || "de";
    if (!views[l]) {
      const list = raw.map(t => resolve(t, l));
      views[l] = { list, byId: Object.fromEntries(list.map(t => [t.id, t])) };
    }
    return views[l];
  }

  function get(id) { return active().byId[id] || null; }
  function has(id) { return !!active().byId[id]; }
  function all() { return active().list; }

  // Card model for one task's tiles. `id` is stable per correct slot ("t"+key),
  // `rank` = key+1 to match the app's 1-based scoring. Text goes in the title;
  // the tile's reasoning is kept on `thought` for later AI features (not shown).
  function cardsFor(id) {
    const t = get(id);
    if (!t || !Array.isArray(t.tiles)) return [];
    return t.tiles.map(tile => ({
      id: "t" + tile.key,
      rank: tile.key + 1,
      title: tile.text,
      thought: tile.thought || "",
    }));
  }

  // Correct order = card ids sorted by slot (["t0","t1",…,"t5"]).
  function correctOrderFor(id) {
    return cardsFor(id).slice().sort((a, b) => a.rank - b.rank).map(c => c.id);
  }

  // The tile-key pair this task's scripted error swaps, or null if it has none.
  function scriptedSwapKeys(id) {
    const t = get(id);
    const keys = t && t.scriptedError && t.scriptedError.swapKeys;
    return (Array.isArray(keys) && keys.length === 2) ? keys : null;
  }

  // The AI's suggested ranking. Normally the correct order; with `withError`
  // the task's scriptedError.swapKeys pair is swapped, so the AI suggests a
  // plausible-but-wrong order (turned on per round via Config.GROUP_TASKS).
  // correctOrderFor stays the ground truth for scoring either way.
  function aiRankingFor(id, withError) {
    const order = correctOrderFor(id);
    if (!withError) return order;
    const keys = scriptedSwapKeys(id);
    if (!keys) return order;
    const a = order.indexOf("t" + keys[0]);
    const b = order.indexOf("t" + keys[1]);
    if (a === -1 || b === -1) return order;
    [order[a], order[b]] = [order[b], order[a]];
    return order;
  }

  // The AI's stated reasoning for one card, shown in the "thought" condition.
  // Normally the tile's own `thought` (why it belongs in its correct slot).
  // With `withError`, the two tiles of the scripted swap instead get the task's
  // `wrongThought` — the plausible-sounding justification for the wrong order,
  // so the explanation matches what the AI is actually suggesting.
  //
  // `wrongThought` is a 2-element array positionally aligned to `swapKeys`,
  // exactly like `pair`: EACH swapped tile argues for its own wrong slot. (One
  // shared sentence cannot: it is written from the perspective of the tile that
  // moves earlier, so on the other tile it reads as a non sequitur.) A plain
  // string is still accepted and means "same justification for both".
  function thoughtFor(id, cardId, withError) {
    const t = get(id);
    if (!t) return "";
    const key = parseInt(String(cardId).replace(/^t/, ""), 10);
    if (Number.isNaN(key)) return "";
    if (withError) {
      const keys = scriptedSwapKeys(id);
      if (keys && (keys[0] === key || keys[1] === key)) {
        const wt = (t.scriptedError && t.scriptedError.wrongThought) || "";
        if (Array.isArray(wt)) return wt[keys[0] === key ? 0 : 1] || "";
        return wt;
      }
    }
    const tile = (t.tiles || []).find(x => x.key === key);
    return tile ? (tile.thought || "") : "";
  }

  // ── deterministic shuffle: same inbox order for every participant (fixed
  //    seed), different per task (task id mixed into the seed) ──
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, seedStr) {
    const rng = mulberry32(hashStr(seedStr));
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Cards for a task in the deterministic inbox order (seed + task id).
  function inboxCardsFor(id, seed) {
    return seededShuffle(cardsFor(id), String(seed == null ? "" : seed) + ":" + id);
  }

  return { load, get, has, all, cardsFor, correctOrderFor, aiRankingFor, scriptedSwapKeys, thoughtFor, inboxCardsFor };
})();
