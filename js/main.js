/* ═══════════════════════════════════════════════════════════════════
   MAIN — boot: load the task content, wire the consent screen, optional
   resume, survey + dev controls, task controls, then show the first screen.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);

  // Do two STEPS snapshots describe the same flow shape?
  function sameSteps(a, b) {
    if (!a || !b) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(k => !!a[k] === !!b[k]);
  }

  // Auto participant ID: 4 random letters + base36 timestamp (unique, no input needed).
  function genParticipantId() {
    let letters = "";
    for (let i = 0; i < 4; i++) letters += String.fromCharCode(65 + Math.floor(Math.random() * 26));
    return letters + "-" + Date.now().toString(36);
  }

  /* ── language ──────────────────────────────────────────────────────
     Switching is a live re-render, never a reload: both language views share
     ids, tiles[].key and ai-order, so placements, the seeded shuffle and the
     AI's suggestion survive untouched — only visible text changes. */
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
    if (!$("screen-resume").hidden) renderResume();
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
    else if (cur.type === "prolific") Prolific.relocalize();
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

  /* ── resume ────────────────────────────────────────────────────────
     Its own screen, shown instead of the normal first one when an
     interrupted session is in localStorage. It used to be a banner on the
     consent slide, which meant switching consent off (Config.STEPS) silently
     took resume with it. */
  let savedSession = null;

  // The first screen of a NORMAL start — whatever the toggles leave standing.
  function showFirstScreen() {
    if (Config.STEPS.consent) Flow.showScreen("screen-consent");
    else startSession();   // no consent gate: create the session and get going
  }

  // Fill the resume screen's text. Safe to call any time; no-ops without an offer.
  function renderResume() {
    if (!savedSession) return;
    $("resume-heading").textContent = I18n.t("ui.resume.heading");
    $("resume-body").textContent = I18n.t("ui.resume.body", {
      id: savedSession.participantId || "—", step: savedSession.currentStep,
    });
    $("btn-resume-sess").textContent = I18n.t("ui.resume.continue");
    $("btn-discard-sess").textContent = I18n.t("ui.resume.startNew");
  }

  function wireResume() {
    $("btn-resume-sess").addEventListener("click", () => {
      if (!savedSession) return;
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
      showFirstScreen();
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
        character: Store.character(),
        order: Store.order(),
        steps: Store.get().steps,
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
      Flow.begin();   // past the consent screen, into whatever comes first
    } finally {
      starting = false;
    }
  }

  // Dev-only: jump to the next stage from wherever we are.
  function devSkip() {
    const cur = Flow.current();
    if (!Store.get() || !cur) { startSession(); return; }   // from consent → begin
    if (cur.type === "debrief") return;                     // nothing after the end
    if (cur.type === "task") Task.stop();                   // halt any running AI cursor
    Store.log("dev_skip", { from: cur.type });
    Store.sendRemote();
    Flow.next();
  }

  /* ── dev group picker ───────────────────────────────────────────────
     Forces this session into one of the four setups, so a character/order
     combination can be tested without restarting until the balancer happens
     to hand it over. Sessions touched by it are marked groupSource:"dev" and
     the collector leaves them out of the balancing counts. */
  function fillDevGroup() {
    const sel = $("dev-group");
    if (!sel) return;
    sel.innerHTML = "";
    Groups.keys().forEach(g => {
      const cnd = Config.GROUPS[g];
      const opt = document.createElement("option");
      opt.value = g;
      // e.g. "G1 · bold · hidden→handoff" — the whole setup at a glance
      opt.textContent = `${g} · ${cnd.character} · ${cnd.order.join("→")}`;
      sel.appendChild(opt);
    });
  }

  // Keep the picker showing the setup that is actually in force.
  function syncDevGroup() {
    const sel = $("dev-group");
    if (!sel) return;
    const g = Store.group() || Groups.override();
    if (g) sel.value = g;
  }

  /* Switch the running session's setup. The group fixes the character AND the
     mechanic order, and the plan is built from that order — so Store.setGroup
     rebuilds the plan, and the flow has to be rebuilt from it before the
     current step is re-rendered, or the step would still point at the old
     round. Both orders run the same number of rounds, so the step index stays
     valid. Dev aid only; a real session draws once and never changes. */
  function devSetGroup(g) {
    if (!Config.isGroup(g)) return;
    Groups.setOverride(g);            // applies to this session and to any later one
    if (!Store.get()) return;         // before Begin: the draw will use the override
    Store.setGroup(g, "dev");
    Store.log("group_override", { group: g, character: Store.character(), order: Store.order() });
    const cur = Flow.current();
    if (cur && cur.type === "task") Task.stop();
    Flow.build();
    if (cur) Flow.render();
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

    /* Loud on purpose: a group naming a character with no `ai-order` in
       tasks.json, or a mechanic that does not exist, leaves its rounds with an
       empty suggestion or the wrong interaction — which looks like a broken
       mechanic rather than a config typo. */
    Config.GROUP_KEYS.forEach(g => {
      const c = Config.GROUPS[g];
      if (!Config.isCharacter(c.character)) {
        console.error(`[BDR] ${g}: character "${c.character}" is not one of ${Config.CHARACTERS.join(" / ")} — the AI will have nothing to suggest.`);
      }
      (c.order || []).forEach(m => {
        if (!Config.MECHANICS[m]) console.error(`[BDR] ${g}: "${m}" is not a known mechanic (${Object.keys(Config.MECHANICS).join(" / ")}).`);
      });
    });

    /* Same reasoning for the cursor's motion: a character with no preset in
       cursors.json still runs, with every dial off — a bland straight-line
       cursor that looks like a design choice rather than a missing file. The
       failure mode is "both conditions felt the same", discovered in analysis. */
    Config.CHARACTERS.forEach(c => {
      if (Cursor.has(c)) return;
      console.error(`[BDR] no cursor motion profile for "${c}" in cursors.json — ` +
                    `its handoff rounds will use a plain straight-line cursor.`);
    });

    Task.wire();
    Prolific.wire();

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
       Only offer a session this build can actually run. Two gates, because
       they catch different things:
         · SCHEMA_VERSION — the plan and the session fields have changed shape
           several times; its history is listed in store.js.
         · STEPS — `currentStep` is an index into the steps array Flow builds,
           and the toggles change that array's SHAPE. A session saved with the
           pre-survey on would resume into the wrong step once it is off, with
           nothing to signal that it had. */
    const saved = Store.load();
    if (Config.CONFIG.resumeEnabled && saved && !saved.completed) {
      if (saved.schemaVersion !== Store.SCHEMA_VERSION) {
        console.warn("[BDR] ignoring a saved session from an older build (schema", saved.schemaVersion, "≠", Store.SCHEMA_VERSION + ")");
      } else if (!sameSteps(saved.steps, Config.STEPS)) {
        console.warn("[BDR] ignoring a saved session: it ran under different Config.STEPS", saved.steps, "≠", Config.STEPS);
      } else {
        savedSession = saved;
      }
    }
    wireResume();

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

    /* An interrupted session takes precedence over everything: ask before
       starting a new one, whatever the first normal screen would have been.
       Otherwise go straight there — which, with no consent gate, means
       creating the session and dropping into the first enabled step. */
    if (savedSession) { renderResume(); Flow.showScreen("screen-resume"); }
    else showFirstScreen();
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

  // Load the interface strings, the bilingual task content and the AI
  // cursor's motion presets, then boot.
  // (fetch works while served over http; inline all three when baking to one file.)
  document.addEventListener("DOMContentLoaded", () => {
    // `no-cache` forces revalidation: these content files change often and the
    // server sends no ETag, so a plain fetch happily serves a stale copy.
    const grab = url => fetch(url, { cache: "no-cache" }).then(r => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.json();
    });
    Promise.all([grab("strings.json"), grab("tasks.json"), grab("cursors.json")])
      .then(([strings, tasks, cursors]) => {
        I18n.load(strings);
        Tasks.load(tasks);
        Cursor.load(cursors);
      })
      .catch(err => {
        console.error("Failed to load content:", err);
        I18n.load({ de: {}, en: {} });
        Tasks.load({ tasks: [] });
        Cursor.load({ presets: {} });
      })
      .finally(boot);
  });
})();
