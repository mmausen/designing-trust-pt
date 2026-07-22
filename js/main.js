/* ═══════════════════════════════════════════════════════════════════
   MAIN — boot: load the task content, wire the consent screen, optional
   resume, survey + dev controls, task controls, then show the first screen.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);

  // Auto participant ID: 4 random letters + base36 timestamp (unique, no input needed).
  function genParticipantId() {
    let letters = "";
    for (let i = 0; i < 4; i++) letters += String.fromCharCode(65 + Math.floor(Math.random() * 26));
    return letters + "-" + Date.now().toString(36);
  }

  /* ── language ──────────────────────────────────────────────────────
     Switching is a live re-render, never a reload: both task files share
     ids, tiles[].key and swapKeys, so placements, the seeded shuffle and
     any scripted error survive untouched — only visible text changes. */
  function applyStaticText() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = I18n.t(el.getAttribute("data-i18n"));
    });
    document.documentElement.lang = I18n.get();
    document.querySelectorAll("#lang-switch .lang-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.lang === I18n.get());
      b.setAttribute("aria-pressed", String(b.dataset.lang === I18n.get()));
    });
    renderResumeNote();
  }

  /* Everything that must follow the active language hangs off this one
     listener, so ANY call to I18n.set repaints the UI — the switcher can
     never end up showing a different language than the screen does. */
  function onLanguageChanged() {
    applyStaticText();
    const cur = Flow.current();
    if (!cur) return;
    if (cur.type === "survey") Survey.relocalize();
    else if (cur.type === "task") Task.relocalize();
    else if (cur.type === "debrief") Results.relocalize();
  }

  // The switcher additionally records the change as study data.
  function switchLanguage(lang) {
    const cur = Flow.current();
    if (!I18n.set(lang)) return;          // fires onLanguageChanged
    if (Store.get()) {
      Store.setLang(lang);
      Store.log("language_switch", { lang, atStep: cur ? cur.type : "consent" });
    }
  }

  // The resume offer sits on the consent screen and is language-dependent.
  let savedSession = null;
  function renderResumeNote() {
    const note = $("resume-note");
    if (!note) return;
    if (!savedSession) { note.hidden = true; note.innerHTML = ""; return; }
    note.hidden = false;
    note.innerHTML =
      `<span class="rn-txt"></span> ` +
      `<button class="btn" id="btn-resume-sess"></button>` +
      `<button class="btn" id="btn-discard-sess"></button>`;
    note.querySelector(".rn-txt").textContent =
      I18n.t("ui.consent.resumeFound", { id: savedSession.participantId || "—", step: savedSession.currentStep });
    $("btn-resume-sess").textContent = I18n.t("ui.consent.resume");
    $("btn-discard-sess").textContent = I18n.t("ui.consent.startNew");
    $("btn-resume-sess").addEventListener("click", () => {
      Store.restore(savedSession);
      if (savedSession.lang) I18n.set(savedSession.lang);   // repaints via onLanguageChanged
      Store.log("session_resumed", { atStep: savedSession.currentStep });
      Flow.build();
      Flow.go(savedSession.currentStep);
    });
    $("btn-discard-sess").addEventListener("click", () => {
      Store.clear();
      savedSession = null;
      renderResumeNote();
    });
  }

  // Create the session and jump to the pre-survey (shared by Begin + dev Skip).
  function startSession() {
    const pid = genParticipantId();
    Store.newSession(pid);
    Store.log("session_start", {
      participantId: pid,
      plan: Store.get().plan,
      config: Store.get().config,
      lang: I18n.get(),
    });
    Store.log("consent", { agreed: true });
    Flow.build();
    Flow.go(1); // skip consent step → pre-survey
  }

  // Dev-only: jump to the next stage from wherever we are.
  function devSkip() {
    const cur = Flow.current();
    if (!Store.get() || !cur) { startSession(); return; }   // from consent → begin
    if (cur.type === "debrief") return;                     // nothing after the end
    if (cur.type === "task") Task.stop();                   // halt any running autopilot
    Store.log("dev_skip", { from: cur.type });
    Store.sendRemote();
    Flow.next();
  }

  function boot() {
    Task.wire();

    // ── language switcher ──
    I18n.onChange(onLanguageChanged);
    document.querySelectorAll("#lang-switch .lang-btn").forEach(btn => {
      btn.addEventListener("click", () => switchLanguage(btn.dataset.lang));
    });

    // ── consent gating (just the agreement checkbox now) ──
    const agree = $("consent-agree");
    const begin = $("btn-begin");
    const updateBegin = () => { begin.disabled = !agree.checked; };
    agree.addEventListener("change", updateBegin);
    begin.addEventListener("click", startSession);

    // ── resume offer ──
    const saved = Store.load();
    if (Config.CONFIG.resumeEnabled && saved && !saved.completed) savedSession = saved;

    // ── survey continue ──
    $("btn-survey-next").addEventListener("click", () => Survey.submit());

    // ── dev Skip button (prototyping only — remove before the real study) ──
    $("dev-skip").addEventListener("click", devSkip);

    // ── last-gasp save if the tab is closed or backgrounded mid-task ──
    // pagehide is the reliable one on Safari/iOS; visibilitychange covers
    // app-switching, where the tab may never fire pagehide at all.
    window.addEventListener("pagehide", () => Store.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") Store.flush();
    });

    applyStaticText();
    Flow.showScreen("screen-consent");
  }

  // Load the interface strings and the bilingual task content, then boot.
  // (fetch works while served over http; inline both when baking to one file.)
  document.addEventListener("DOMContentLoaded", () => {
    // `no-cache` forces revalidation: these content files change often and the
    // server sends no ETag, so a plain fetch happily serves a stale copy.
    const grab = url => fetch(url, { cache: "no-cache" }).then(r => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.json();
    });
    Promise.all([grab("strings.json"), grab("task_thought.json")])
      .then(([strings, tasks]) => {
        I18n.load(strings);
        Tasks.load(tasks);
      })
      .catch(err => {
        console.error("Failed to load content:", err);
        I18n.load({ de: {}, en: {} });
        Tasks.load({ tasks: [] });
      })
      .finally(boot);
  });
})();
