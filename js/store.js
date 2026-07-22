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

  function newSession(pid) {
    data = {
      schemaVersion: 1,
      participantId: pid || "",
      config: { ...Config.CONFIG },
      lang: window.I18n ? I18n.get() : "de",  // language the session runs in (study data)
      plan: Config.buildTaskPlan(),   // [{ level, taskId, aiError }] — stages, incl. repeats
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

  function log(type, payload) {
    if (!data) return;
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
  let lastSync = { ok: null, at: null, error: null };

  async function sendRemote() {
    const url = Config.ENDPOINT_URL;
    if (!url || !data) return false;          // disabled → localStorage only
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: exportJSON(),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const out = await res.json().catch(() => ({}));
      lastSync = { ok: true, at: Date.now(), error: null };
      log("remote_sync", { ok: true, appendedEvents: out.appendedEvents });
      return true;
    } catch (e) {
      lastSync = { ok: false, at: Date.now(), error: String(e) };
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
    if (!url || !data || !navigator.sendBeacon) return false;
    try {
      return navigator.sendBeacon(url, new Blob([exportJSON()], { type: "application/json" }));
    } catch (e) { return false; }
  }

  function syncStatus() { return { ...lastSync }; }

  return {
    newSession, get, restore, setStep, setLang, log, addResult, setSurvey, markComplete,
    save, load, clear, exportJSON, download, sendRemote, flush, syncStatus,
  };
})();
