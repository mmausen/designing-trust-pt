/* ═══════════════════════════════════════════════════════════════════
   STORE — single source of truth for the session.
   - Holds one `data` object (participant, order, surveys, results, events).
   - Autosaves to localStorage after every mutation (crash/refresh safety).
   - `sendRemote()` is a stub for the OneDrive/Power-Automate POST (no-op
     until Config.ENDPOINT_URL is set).
   ═══════════════════════════════════════════════════════════════════ */
window.Store = (function () {
  const KEY = "bdr_triage_session";
  /* ── the archive ────────────────────────────────────────────────────
     KEY holds ONE session, and starting a run replaces it. That is fine while
     the collector is recording — logs/sessions/ keeps a file per participant
     forever, and a server restart clears nothing — but it is the only copy
     whenever the collector is not: logging switched off, or a POST that never
     landed. A second run would then destroy the first silently.

     So a session that is being replaced is pushed here first. Newest first,
     capped, and trimmed further if the browser refuses the write — an archive
     that fills the quota and breaks the live save would be worse than no
     archive. Read them back with Store.archive(), or Store.downloadArchive().

     flushArchive() re-POSTs anything the collector never acknowledged, the
     next time it is reachable. The collector is idempotent per participantId
     (it overwrites the snapshot and appends only unseen events), so sending a
     session twice costs nothing. */
  const ARCHIVE_KEY = "bdr_triage_archive";
  const ARCHIVE_MAX = 10;
  const perfStart = performance.now();
  let data = null;

  /* Master switch (Config.CONFIG.loggingEnabled). Off → no events are recorded
     and nothing leaves the browser: no POST, no beacon, so logs/ stays clean
     during dry runs. The session object itself still lives and still autosaves,
     so the flow, resume and the debrief are unaffected — the run simply leaves
     no trace. Defaults to on if the key is missing. */
  const logging = () => Config.CONFIG.loggingEnabled !== false;

  /* Bumped whenever the shape of a saved session changes incompatibly. The
     resume offer checks it, so a session saved by an older build is ignored
     instead of being restored into a flow that no longer matches it.
       1 → within-subjects: plan entries carried `level` (1–4)
       2 → between-subjects: plan entries carry `stage`, session carries `group`
       3 → prioritisation tasks (tasks.json): no `score` and no per-round
           `aiError`; the session carries `character` (bold / cautious)
       4 → mixed design: every participant runs BOTH mechanics, so plan
           entries carry `mechanic` + `block`, and the group fixes the
           character and the order rather than the mechanic
       5 → plan entries carry `taskBlock`; the session carries `prolificId`
           and the STEPS that were enabled for it
       6 → `prolificId` became `anonId` — the study stopped recruiting through
           Prolific, and the ID is now one the research team issues */
  const SCHEMA_VERSION = 6;

  function newSession(pid, assignment) {
    // Never let a previous run be overwritten without a copy surviving.
    archiveCurrent("replaced by a new session");
    const a = assignment || {};
    data = {
      schemaVersion: SCHEMA_VERSION,
      participantId: pid || "",
      /* The anonymised ID the research team issued, typed on the optional
         ID step. Never used as the participantId — see js/anon-id.js for
         why. Null when that step is switched off or not yet reached. */
      anonId: null,
      config: { ...Config.CONFIG },
      /* Which optional steps this session actually ran. Snapshotted rather
         than read live, so a run stays interpretable after the toggles are
         changed for the next one — "no pre-survey answers" then reads as
         "the step was off", not as missing data. */
      steps: { ...Config.STEPS },
      lang: window.I18n ? I18n.get() : "de",  // language the session runs in (study data)
      group: a.group || null,         // the setup this participant runs (G1–G4)
      groupSource: a.source || null,  // "config" (Config.FIXED_GROUP) | "dev" (forced)
      /* The group's two halves, spent here and then pinned, so a mid-study
         edit to Config.GROUPS can never retroactively alter a running
         participant: the AI's strategy all session, and the mechanic order
         that the plan below was built from. */
      character: Config.characterFor(a.group),
      order: Config.orderFor(a.group),
      plan: Config.buildTaskPlan(a.group),   // [{ stage, mechanic, block, taskId }]
      startedAt: new Date().toISOString(),
      currentStep: 0,
      surveys: {},
      results: [],
      events: [],
      completed: false,
    };
    save();
    return data;
  }

  function get() { return data; }
  function restore(saved) { data = saved; }

  function setStep(i) { if (data) { data.currentStep = i; save(); } }
  function setLang(l) { if (data) { data.lang = l; save(); } }
  /* Only the dev picker changes the group after the session has started.
     The group now decides the character AND the mechanic order, and the plan
     is built from that order — so all four move together or the session would
     contradict itself. The rebuilt plan has the same length (both orders run
     the same two blocks), so the current step index stays valid; results
     already recorded keep their own taskId and condition, so they stay
     readable even though they came from the previous plan. Dev aid only. */
  function setGroup(g, source) {
    if (!data || !Config.isGroup(g)) return;
    data.group = g;
    data.groupSource = source || data.groupSource;
    data.character = Config.characterFor(g);
    data.order = Config.orderFor(g);
    data.plan = Config.buildTaskPlan(g);
    save();
  }
  function group() { return data ? data.group : null; }

  function setAnonId(v) {
    if (!data) return;
    data.anonId = v || null;
    save();
  }
  function anonId() { return data ? data.anonId : null; }

  /* Falls back to the group's character rather than returning null: a round
     with no character would have no AI ranking at all, which would silently
     turn an AI round into a solo one. There is no separate character setter —
     the group is the one decision, and setGroup() spends it. */
  function character() {
    if (!data) return null;
    return data.character || Config.characterFor(data.group);
  }
  function order() { return (data && data.order) || []; }

  function log(type, payload) {
    if (!data || !logging()) return;
    data.events.push(Object.assign(
      { type, ts: Date.now(), tRel: Math.round(performance.now() - perfStart) },
      payload || {}
    ));
    save();
  }

  function addResult(r) { if (data) { data.results.push(r); save(); } }
  function setSurvey(id, answers) { if (data) { data.surveys[id] = answers; save(); } }
  function markComplete() { if (data) { data.completed = true; save(); } }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.warn("autosave failed:", e); }
  }
  function load() {
    try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }
  function clear() {
    archiveCurrent("discarded");
    try { localStorage.removeItem(KEY); } catch (e) {}
    data = null;
  }

  // ── archive ──
  function readArchive() {
    try { const a = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }

  /* Write, shedding the oldest entries until it fits. A browser that refuses
     even one entry gets an empty archive rather than a thrown save. */
  function writeArchive(list) {
    let keep = list.slice(0, ARCHIVE_MAX);
    for (;;) {
      try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(keep)); return keep.length; }
      catch (e) {
        if (!keep.length) { try { localStorage.removeItem(ARCHIVE_KEY); } catch (e2) {} return 0; }
        keep = keep.slice(0, keep.length - 1);
      }
    }
  }

  /* Move whatever is in KEY into the archive. `why` records how the run
     ended, since an archived session is by definition one nobody confirmed
     was safely collected. */
  function archiveCurrent(why) {
    const prev = load();
    if (!prev || !prev.participantId) return false;
    const list = readArchive().filter(s => s.participantId !== prev.participantId);
    list.unshift({ ...prev, archivedAt: new Date().toISOString(), archivedBecause: why });
    return writeArchive(list) > 0;
  }

  const archive = () => readArchive();

  /* Re-POST archived sessions the collector has not acknowledged. Marks each
     as sent so a later flush skips it; a failure simply leaves it for next
     time. Safe to call whenever — it no-ops with logging off. */
  async function flushArchive() {
    const url = Config.ENDPOINT_URL;
    if (!url || !logging()) return 0;
    const list = readArchive();
    const pending = list.filter(s => !s.collectedAt);
    if (!pending.length) return 0;
    let sent = 0;
    for (const sess of pending) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
                                       body: JSON.stringify(sess) });
        if (!res.ok) continue;
        sess.collectedAt = new Date().toISOString();
        sent++;
      } catch (e) { /* still offline; leave it for next time */ }
    }
    if (sent) writeArchive(list);
    return sent;
  }

  // Everything the browser still holds, live session included, as one file.
  function downloadArchive() {
    const all = { exportedAt: new Date().toISOString(), live: load(), archive: readArchive() };
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bdr-sessions-" + Date.now() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    return (readArchive().length + (load() ? 1 : 0));
  }

  function exportJSON() { return JSON.stringify(data, null, 2); }

  function download() {
    if (!data) return;
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([exportJSON()], { type: "application/json" })),
      download: `triage_${data.participantId || "anon"}_${Date.now()}.json`,
    });
    a.click();
  }

  /* Push the whole session to the collector (server.js → ./logs).
     Same origin, so the response is readable and a failure is visible —
     unlike the old no-cors fire-and-forget, which could never tell.

     Every POST carries the COMPLETE session, which makes this naturally
     self-healing: a dropped or failed sync is repaired by the next one, so
     a brief network drop mid-study costs nothing. */
  async function sendRemote() {
    const url = Config.ENDPOINT_URL;
    if (!url || !data || !logging()) return false;   // disabled → localStorage only
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: exportJSON(),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const out = await res.json().catch(() => ({}));
      // The collector has it, so the archive copy is a duplicate, not a rescue.
      data.collectedAt = new Date().toISOString();
      log("remote_sync", { ok: true, appendedEvents: out.appendedEvents });
      return true;
    } catch (e) {
      log("remote_sync", { ok: false, error: String(e) });
      return false;
    }
  }

  /* Last-gasp save when the tab is closed or hidden. fetch() is cancelled on
     unload; sendBeacon is queued by the browser and survives it — without
     this, everything since the last step boundary would be lost if a
     participant simply closed the tab. */
  function flush() {
    const url = Config.ENDPOINT_URL;
    if (!url || !data || !logging() || !navigator.sendBeacon) return false;
    try {
      return navigator.sendBeacon(url, new Blob([exportJSON()], { type: "application/json" }));
    } catch (e) { return false; }
  }

  /* `download` has no caller in the app on purpose — it is the console
     affordance for pulling a session out by hand (README: "Store.download()
     exports it as JSON from the console"). Everything else here is called. */
  return {
    SCHEMA_VERSION,
    newSession, get, restore, setStep, setLang, setGroup, group, character, order,
    setAnonId, anonId,
    log, addResult, setSurvey, markComplete,
    load, clear, download, sendRemote, flush,
    archive, flushArchive, downloadArchive,
  };
})();
