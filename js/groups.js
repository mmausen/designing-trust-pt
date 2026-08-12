/* ═══════════════════════════════════════════════════════════════════
   GROUPS — which AI interaction this participant gets (G1…G4).

   The study is between-subjects and unattended, so nobody is standing by
   to keep the four cells even. A coin flip per participant does not do it:
   with 40 people, a fair random draw still lands cells of 6 and 14 often
   enough to matter. So the SERVER holds the tally and hands back the
   least-used group (server.js → /assign-group).

   Three ways a group can be decided, all recorded as `groupSource` so the
   analysis can tell them apart:
     "server" — the balanced draw (the normal case)
     "local"  — the endpoint was unreachable; random pick in the browser, so
                a participant is never blocked by our infrastructure
     "dev"    — forced from the dev picker; the server excludes these from
                the counts, so testing never distorts the balance

   The draw happens ONCE, at the start of the session, and is then pinned
   into the session object — a reload or a resume reuses it and never draws
   again (the server is idempotent per participant id as a second guard).
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

  // Fallback when there is no server to ask. Balances only in the long run,
  // which is exactly why it is the fallback and not the mechanism.
  function pickLocal() {
    const k = keys();
    return k[Math.floor(Math.random() * k.length)];
  }

  /* Ask the server for a group. Never throws and never hangs: any failure
     (offline, no collector, slow network, nonsense response) degrades to a
     local random pick, because a participant sitting in front of a dead
     Begin button is a worse outcome than a slightly uneven cell. */
  async function draw(participantId) {
    if (forced) return { group: forced, source: "dev" };

    const url = Config.ASSIGN_URL;
    if (!url) return { group: pickLocal(), source: "local", reason: "no endpoint" };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Config.ASSIGN_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const out = await res.json();
      if (!isValid(out.group)) throw new Error("unknown group: " + out.group);
      return { group: out.group, source: "server", counts: out.counts || null };
    } catch (e) {
      console.warn("[BDR] group assignment failed — falling back to a local random pick:", e);
      return { group: pickLocal(), source: "local", reason: String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { keys, isValid, setOverride, override, pickLocal, draw };
})();
