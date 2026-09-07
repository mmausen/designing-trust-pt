/* ═══════════════════════════════════════════════════════════════════
   TASKS — the task content, from the bilingual tasks.json.

   Every task is one PRIORITISATION problem: six incoming public-administration
   cases, to be ranked most urgent first. The task TYPE never changes across
   tasks — only the subject matter does — so the instruction text lives in
   strings.json (ui.task.brief) rather than on each task.

   That file shares its STRUCTURE and splits only its PROSE:

     { id,
       de:{title}, en:{title},
       "ai-order": { bold:[keys…], cautious:[keys…] },
       tiles:[{ key, de:{text,description}, en:{…} }] }

   `id`, `tiles[].key` and `ai-order` therefore exist exactly once and CANNOT
   diverge between languages — which is what keeps card ids ("t0"…"t5"), the
   seeded shuffle, the participant's placements and the AI's suggestion
   language-independent, and a mid-task language switch safe.

   ── there is no correct order ─────────────────────────────────────
   These are hierarchy/priority judgements, not process sequences: no
   objectively true ranking exists. So `tiles[].key` is ONLY a stable tile id
   — NOT a position — and nothing here computes a score. Do not add one: there
   is nothing to score against.

   ── the AI's suggestion ───────────────────────────────────────────
   `ai-order` is authored per CHARACTER: a "bold" ranking and a "cautious" one,
   each a permutation of the six tile keys, top to bottom. Which one a session
   uses comes from its GROUP (Config.characterFor) and is pinned onto the
   session — see aiRankingFor(). A task whose AI ranking is
   meant to be questionable simply says so in the array; there is no separate
   error mechanism any more, and nothing marks such a task as wrong.

   `resolve()` flattens one bilingual task into an ordinary single-language
   task ({id,title,tiles:[{key,text,description}],aiOrder}), so everything
   downstream stays unaware of the bilingual layout. Views are built once per
   language and cached.

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
    return {
      id: t.id,
      title: L.title || "",
      // Kept verbatim: the keys are characters ("bold" / "cautious"), and the
      // values are tile-key permutations, so neither is language-dependent.
      aiOrder: t["ai-order"] || {},
      tiles: (t.tiles || []).map(tile => {
        const tl = tile[lang] || {};
        return { key: tile.key, text: tl.text || "", description: tl.description || "" };
      }),
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

  /* Card model for one task's tiles. `id` is stable per tile ("t"+key) and is
     what placements, logs and the AI's suggestion are all expressed in.
     There is deliberately no `rank`: these tasks have no correct order. */
  function cardsFor(id) {
    const t = get(id);
    if (!t || !Array.isArray(t.tiles)) return [];
    return t.tiles.map(tile => ({
      id: "t" + tile.key,
      title: tile.text,
      description: tile.description || "",
    }));
  }

  /* The AI's suggested ranking for one task, as card ids top to bottom.
     `character` selects which authored order to use ("bold" | "cautious").
     Returns [] when the task or the character is unknown, which reads
     downstream as "this stage has no AI suggestion" rather than throwing. */
  function aiRankingFor(id, character) {
    const t = get(id);
    const order = t && t.aiOrder && t.aiOrder[character];
    if (!Array.isArray(order)) {
      if (t) console.warn(`[BDR] task ${id} has no ai-order for character "${character}"`);
      return [];
    }
    return order.map(k => "t" + k);
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

  return { load, get, aiRankingFor, inboxCardsFor };
})();
