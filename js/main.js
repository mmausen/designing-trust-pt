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
    const endBtn = $("btn-end");
    if (endBtn) endBtn.textContent = I18n.t("ui.end.button");
    // keep the terminal screen in sync if the language is switched on it
    if ($("end-title") && !$("screen-end").hidden) {
      $("end-title").textContent = I18n.t("ui.end.title");
      $("end-note").textContent = I18n.t("ui.end.note");
    }
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
    // Terminal and gate screens sit outside the Flow; re-rendering the step
    // underneath would yank the participant back to it.
    if (!$("screen-end").hidden || !$("screen-mobile").hidden) return;
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
      // The group was drawn when the session started and is pinned to it —
      // resuming must never draw again, or one participant would occupy two cells.
      syncDevGroup();
      Store.log("session_resumed", { atStep: savedSession.currentStep, group: savedSession.group || null });
      Flow.build();
      Flow.go(savedSession.currentStep);
    });
    $("btn-discard-sess").addEventListener("click", () => {
      Store.clear();
      savedSession = null;
      renderResumeNote();
    });
  }

  /* Create the session and jump to the pre-survey (shared by Begin + dev Skip).

     Async because the AI group comes from the server's balanced draw. The
     draw has its own timeout and its own fallback, so this resolves quickly
     whatever happens — but Begin is disabled meanwhile, so a double click
     cannot start two sessions and burn two group slots. */
  let starting = false;
  async function startSession() {
    if (starting || Store.get()) return;
    starting = true;
    const begin = $("btn-begin");
    if (begin) begin.disabled = true;
    try {
      const pid = genParticipantId();
      const assignment = await Groups.draw(pid);
      Store.newSession(pid, assignment);
      Store.log("session_start", {
        participantId: pid,
        group: assignment.group,
        groupSource: assignment.source,
        plan: Store.get().plan,
        config: Store.get().config,
        lang: I18n.get(),
      });
      // Kept as its own event: the assignment is the study's randomisation
      // record, and it must be legible without parsing session_start.
      Store.log("group_assigned", {
        group: assignment.group,
        source: assignment.source,
        counts: assignment.counts || null,
        reason: assignment.reason || null,
      });
      Store.log("consent", { agreed: true });
      syncDevGroup();
      Flow.build();
      Flow.go(1); // skip consent step → pre-survey
    } finally {
      starting = false;
    }
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

  /* ── dev group picker ───────────────────────────────────────────────
     Forces this session into one of G1–G4 so a mechanic can be tested
     without restarting until the balancer happens to hand it over.
     Sessions touched by it are marked groupSource:"dev" and the collector
     leaves them out of the balancing counts. */
  function fillDevGroup() {
    const sel = $("dev-group");
    if (!sel) return;
    sel.innerHTML = "";
    Groups.keys().forEach(g => {
      const cnd = Config.GROUPS[g];
      const opt = document.createElement("option");
      opt.value = g;
      // e.g. "G2 · handoff+reasoning" — enough to tell the four apart at a glance.
      opt.textContent = `${g} · ${cnd.ai}${cnd.thoughts ? "+reasoning" : ""}${cnd.hint ? "/" + cnd.hint : ""}`;
      sel.appendChild(opt);
    });
  }

  // Keep the picker showing the group that is actually in force.
  function syncDevGroup() {
    const sel = $("dev-group");
    if (!sel) return;
    const g = Store.group() || Groups.override();
    if (g) sel.value = g;
  }

  function devSetGroup(g) {
    if (!Config.isGroup(g)) return;
    Groups.setOverride(g);            // applies to this session and to any later one
    if (!Store.get()) return;         // before Begin: the draw will use the override
    Store.setGroup(g, "dev");
    Store.log("group_override", { group: g });
    // Standing on the AI task? Restart it so the new mechanic is visible now,
    // rather than after the next stage boundary.
    const cur = Flow.current();
    if (cur && cur.type === "task" && cur.stage === "ai") {
      Task.stop();
      Flow.render();
    }
  }

  /* ── desktop gate ───────────────────────────────────────────────────
     The AI is embodied *as a cursor*, so a device without a precise
     pointer cannot run this study — it is not a layout problem that a
     responsive tweak could fix. Gate on input capability rather than
     screen width, so a desktop user with a small window is not blocked.
     Re-checked on resize/orientation change, which also catches a tablet
     that starts in a mode reporting a fine pointer. */
  function isUnsupportedDevice() {
    if (!window.matchMedia) return false;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const noHover = window.matchMedia("(hover: none)").matches;
    return coarse || noHover;
  }

  function enforceDesktopGate() {
    if (!isUnsupportedDevice()) return false;
    Flow.showScreen("screen-mobile");
    return true;
  }

  function boot() {
    // Loud on purpose: with logging off a completed session leaves no file at
    // all, which is easy to discover only after a real participant has left.
    if (Config.CONFIG.loggingEnabled === false) {
      console.warn("[BDR] LOGGING IS OFF (Config.CONFIG.loggingEnabled = false) — no events are recorded and nothing is written to logs/.");
    }

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

    /* ── resume offer ──
       Only offer a session this build can actually run: an older save has a
       plan shaped for the within-subjects flow (entries with `level`, four
       conditions) and no group, so restoring it would drop the participant
       into a flow that no longer exists. */
    const saved = Store.load();
    if (Config.CONFIG.resumeEnabled && saved && !saved.completed) {
      if (saved.schemaVersion === Store.SCHEMA_VERSION) savedSession = saved;
      else console.warn("[BDR] ignoring a saved session from an older build (schema", saved.schemaVersion, "≠", Store.SCHEMA_VERSION + ")");
    }

    // ── survey continue ──
    $("btn-survey-next").addEventListener("click", () => Survey.submit());

    // ── dev bar (Skip + group picker) — hidden for participants, on via Config.CONFIG.devMode ──
    if (Config.CONFIG.devMode) {
      $("dev-bar").hidden = false;
      $("dev-skip").addEventListener("click", devSkip);
      fillDevGroup();
      syncDevGroup();
      $("dev-group").addEventListener("change", e => devSetGroup(e.target.value));
    }

    // ── last-gasp save if the tab is closed or backgrounded mid-task ──
    // pagehide is the reliable one on Safari/iOS; visibilitychange covers
    // app-switching, where the tab may never fire pagehide at all.
    window.addEventListener("pagehide", () => Store.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") Store.flush();
    });

    // ── end button on the debrief → terminal thank-you screen ──
    $("btn-end").addEventListener("click", endSession);

    applyStaticText();

    // Nothing below matters on an unsupported device — show the gate instead.
    if (enforceDesktopGate()) {
      window.addEventListener("resize", enforceDesktopGate);
      window.addEventListener("orientationchange", enforceDesktopGate);
      return;
    }
    window.addEventListener("resize", enforceDesktopGate);
    window.addEventListener("orientationchange", enforceDesktopGate);

    Flow.showScreen("screen-consent");
  }

  /* Terminal screen. Deliberately has no way forward: the participant should
     be in no doubt the study is over. A final flush covers anything logged
     after the debrief's own sync. */
  function endSession() {
    if (Store.get()) {
      Store.log("session_closed", {});
      Store.sendRemote();
    }
    $("end-title").textContent = I18n.t("ui.end.title");
    $("end-note").textContent = I18n.t("ui.end.note");
    Flow.showScreen("screen-end");
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
