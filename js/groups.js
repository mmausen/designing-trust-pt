/* ═══════════════════════════════════════════════════════════════════
   GROUPS — which setup this participant runs (G1–G4: the AI's character,
   and the order of the two mechanics).

   There is nothing to draw. The setup is Config.FIXED_GROUP, the same for
   every participant this build serves, set by hand before each batch.

   The prototype used to balance the four cells itself: it asked the server
   for the least-used group (POST /assign-group), which kept a ledger in
   logs/groups.json and a reservation window so two people starting at once
   could not both be sent to the same cell. All of that was removed on
   2026-09-09 — groups are assigned outside the prototype now, and a
   balancer quietly disagreeing with a hand-picked assignment would be worse
   than no balancer at all.

   `groupSource` still rides on every session, because it still has two
   values worth telling apart:
     "config" — Config.FIXED_GROUP, the normal case
     "dev"    — forced from the dev picker, so a test session is legible as
                one when the data is counted

   The setup is resolved ONCE, at the start of the session, and pinned into
   the session object; a reload or a resume reuses it and never re-resolves,
   so editing FIXED_GROUP mid-study cannot alter a run already going.
   ═══════════════════════════════════════════════════════════════════ */
window.Groups = (function () {
  let forced = null;   // dev picker override, set before or during a session

  function keys() { return Config.GROUP_KEYS; }
  function isValid(g) { return Config.isGroup(g); }

  function setOverride(g) {
    forced = isValid(g) ? g : null;
    return forced;
  }
  function override() { return forced; }

  /* The setup for a new session. Synchronous — nothing is asked of anyone.
     A FIXED_GROUP that names no known setup falls back to the first one
     rather than leaving the session without a plan; boot reports it (see
     main.js), because a typo here would otherwise run the whole batch under
     the wrong condition without a word. */
  function resolve() {
    if (forced) return { group: forced, source: "dev" };
    if (isValid(Config.FIXED_GROUP)) return { group: Config.FIXED_GROUP, source: "config" };
    return { group: keys()[0], source: "config", invalid: Config.FIXED_GROUP };
  }

  return { keys, setOverride, override, resolve };
})();
