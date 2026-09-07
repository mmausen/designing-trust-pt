/* ═══════════════════════════════════════════════════════════════════
   STORE — single source of truth for the session.
   - Holds one `data` object (participant, order, surveys, results, events).
   - Autosaves to localStorage after every mutation (crash/refresh safety).
   - `sendRemote()` is a stub for the OneDrive/Power-Automate POST (no-op
     until Config.ENDPOINT_URL is set).
   ═══════════════════════════════════════════════════════════════════ */
window.Store = (function () {
  const KEY = "bdr_triage_session";
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
           and the STEPS that were enabled for it */
  const SCHEMA_VERSION = 5;

  function newSession(pid, assignment) {
    const a = assignment || {};
    data = {
      schemaVersion: SCHEMA_VERSION,
      participantId: pid || "",
      /* Typed by the participant on the optional Prolific step, never used as
         the participantId — see js/prolific.js for why. Null when that step is
         switched off or not yet reached. */
      prolificId: null,
      config: { ...Config.CONFIG },
      /* Which optional steps this session actually ran. Snapshotted rather
         than read live, so a run stays interpretable after the toggles are
         changed for the next one — "no pre-survey answers" then reads as
         "the step was off", not as missing data. */
      steps: { ...Config.STEPS },
      lang: window.I18n ? I18n.get() : "de",  // language the session runs in (study data)
      group: a.group || null,         // the setup this participant runs (G1–G4)
      groupSource: a.source || null,  // "server" (balanced) | "local" (fallback) | "dev" (forced)
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

  function setProlificId(v) {
    if (!data) return;
    data.prolificId = v || null;
    save();
  }
  function prolificId() { return data ? data.prolificId : null; }

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
    try { localStorage.removeItem(KEY); } catch (e) {}
    data = null;
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
    setProlificId, prolificId,
    log, addResult, setSurvey, markComplete,
    load, clear, download, sendRemote, flush,
  };
})();
