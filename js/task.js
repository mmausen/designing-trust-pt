/* ═══════════════════════════════════════════════════════════════════
   TASK — the ranking interaction for one condition.

   Which mechanic runs is resolved per stage by Config.conditionFor(step,
   group): a "baseline" stage is always solo, an "ai" stage is whichever
   group this participant was assigned. `.ai` picks the mechanic:
     solo      — no assistance
     hint      — picking a step up cues the slot the AI suggests; the design
                 doing the cueing is a swappable variant (see js/hints.js)
     handoff   — shared cursor: the participant works normally, but while the
                 real cursor rests inside the activation zone the AI takes the
                 cursor and carries on. Leaving the zone hands it straight
                 back. With `thoughts: true` it also narrates what it is about
                 to do.

   The AI's suggestion always comes from `aiRanking`, so a scripted error
   (Config.BASELINE_TASKS / GROUP_TASKS → aiError) flows into both the hint and
   the reasoning. Scoring never consults it.

   All per-task state is module-scoped and reset in start().
   ═══════════════════════════════════════════════════════════════════ */
window.Task = (function () {
  const $ = id => document.getElementById(id);
  // Only the first and last slot are labelled; the rest show a dash.
  function slotLabel(i) {
    if (i === 0) return I18n.t("ui.task.firstStep");
    if (i === 5) return I18n.t("ui.task.lastStep");
    return "—";
  }
  const DRAG_THRESHOLD = 5;

  /* Fixed motion constants. The study-facing knobs (speed, pauseAfterPlaceMs,
     hesitate, userSpeedControl) live in Config.AI_CURSOR and are resolved per
     stage into `hcfg` — see resolveCursorCfg(). */
  const AUTO = {
    /* px/sec at slider 0 / 100. Halved twice on 2026-08-12 (230/3200 →
       115/1600 → here) to make the AI's movement slower. Both ends are halved
       each time rather than just lowering the default `speed`, so every
       position of the participant's speed slider moves with it — otherwise
       someone pushing the slider up would land straight back at the old pace.
       The pauses between moves (planJob's beats, and pauseAfterPlaceMs) are
       separate: this is travel speed, not deliberation. */
    speedMin: 57.5, speedMax: 800,
    fadeInMs: 420, fadeOutMs: 240, returnMs: 190,
  };
  let hcfg = null;        // this stage's resolved cursor settings

  // Config.AI_CURSOR, with any inline per-condition overrides applied.
  function resolveCursorCfg(condition) {
    const base = Object.assign({}, Config.AI_CURSOR);
    ["speed", "pauseAfterPlaceMs", "hesitate", "userSpeedControl"].forEach(k => {
      if (condition && condition[k] !== undefined) base[k] = condition[k];
    });
    return base;
  }

  // per-task state
  let stage, group, cond, aiMode, cards, byId, aiRanking, inbox, slots, taskStart;
  let taskId, taskDef, planIndex, aiError;
  let handoff = false;      // shared-cursor stage: the AI takes over from the activation zone
  let showThoughts = false; // handoff + reasoning panel while the AI acts
  let aiTakeovers = 0, userTakebacks = 0, aiPlacedCount = 0;

  /* ── timing ──────────────────────────────────────────────────────────
     The explainer opens on top of the task, so raw wall-clock time would
     fuse "reading the instructions" with "doing the task" — and reopening
     the ⓘ button mid-task would quietly inflate it further. These track the
     two separately; see confirm() for what each measure means. */
  let workStart = null;          // when the first explainer was dismissed
  let explainerOpenedAt = null;  // set while the explainer is on screen
  let explainerMs = 0;           // cumulative time it has been open
  let explainerOpens = 0;        // how many times it was opened
  let firstActionAt = null;      // first drag of the task
  let allPlacedAt = null;        // the AI finished the board — start of the review window

  // Explainer time so far, including a currently-open one.
  function explainerElapsed() {
    return Math.round(explainerMs + (explainerOpenedAt != null ? performance.now() - explainerOpenedAt : 0));
  }
  let drag = null;
  let aiState = "idle";         // the AI cursor: idle | running | done
  let pendingCursorStart = false; // the cursor engine waits until the explainer is dismissed
  let explainerTimer = null;    // pending close-animation cleanup timer
  let explainerSteps = null;    // multi-step onboarding (array) for this stage, or null for the plain single-window explainer
  let explainerStepIdx = 0;     // which onboarding step is currently showing
  let explainerAutoFlow = false; // true while the tile is walking through explainerSteps one at a time
                                  // (vs. showing the reopened, combined text) — relocalize() needs this
  let rightColRevealTimer = null; // pending "reveal the ladder column" timer — onboarding only
  let runId = 0;                // invalidates a stale cursor loop when the task changes

  // fake-cursor state (viewport coords); null outside a handoff stage
  let fc = null;
  let rafId = null, watchdog = null, prevTs = 0, lastStepTs = 0;
  let lastPointer = { x: 0, y: 0 };
  let pointerInZone = false;    // handoff: real cursor resting inside #ai-zone
  let zoneEl = null;

  // cached overlay elements (set in wire())
  let ghost, aiCursor;

  // The active hint variant for this stage (see js/hints.js), or null.
  // task.js deliberately never names a variant — the stage picks one by
  // name in the group definition, so variants can be added or deleted in isolation.
  let hintImpl = null;

  /* Everything a hint variant is allowed to see. Built here so a variant
     never reaches into task state, which is what keeps them swappable. */
  function hintContext(cardId) {
    const aiSlot = (aiMode === "solo") ? -1 : aiRanking.indexOf(cardId);
    const trueSlot = byId[cardId] ? byId[cardId].rank - 1 : -1;
    return {
      cardId, aiSlot, trueSlot,
      isWrongHint: aiSlot >= 0 && aiSlot !== trueSlot,
      taskId, aiError, lang: I18n.get(),
      reasoning: () => Tasks.thoughtFor(taskId, cardId, aiError),
      slotEl: i => document.querySelector(`#ladder [data-slot="${i}"]`),
      ladderEl: () => $("ladder"),
      card: () => document.querySelector(`[data-id="${cardId}"]`),
    };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t, s) => { s = s == null ? 1.1 : s; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
  const speedPPS = () => lerp(AUTO.speedMin, AUTO.speedMax, (hcfg ? hcfg.speed : 28) / 100);

  /* ── wire footer controls + cache overlays (once) ── */
  function wire() {
    ghost = $("drag-ghost"); aiCursor = $("ai-cursor");
    zoneEl = $("ai-zone");
    /* Handoff activation is now controlled by this zone, not by idle time.
       Cursor rests inside → the AI takes over; cursor leaves → control back. */
    if (zoneEl) {
      zoneEl.addEventListener("mouseenter", () => { pointerInZone = true; });
      zoneEl.addEventListener("mouseleave", () => {
        pointerInZone = false;
        if (handoff && fc && fc.active) autoHandBack();
      });
    }
    $("btn-confirm").addEventListener("click", confirm);
    $("explainer-ok").addEventListener("click", explainerOk);
    $("btn-explainer").addEventListener("click", function () { showExplainer(false); });

    /* Track the real pointer. Takeover and hand-back are governed by the
       activation zone (above), so this is not an activity detector — the
       position is what matters: the AI cursor sweeps back to it when the
       participant takes control, rather than blinking out where it stood. */
    document.addEventListener("mousemove", e => {
      lastPointer = { x: e.clientX, y: e.clientY };
    }, { passive: true });

    // Participant-facing speed control (Config.AI_CURSOR.userSpeedControl).
    const speed = $("ai-speed");
    if (speed) {
      speed.addEventListener("input", () => { if (hcfg) hcfg.speed = +speed.value; });
      // Log on release, not on every pixel of drag.
      speed.addEventListener("change", () => {
        if (!hcfg) return;
        Store.log("ai_speed_changed", { speed: hcfg.speed, taskId, condition: cond ? cond.key : null });
      });
    }
  }

  // Zone caption reflects whether the AI is currently driving.
  function updateZoneLabel() {
    if (!zoneEl || zoneEl.hidden) return;
    const label = $("ai-zone-label");
    if (label) label.textContent = I18n.t(
      fc && fc.active ? "ui.task.zone.active" : "ui.task.zone.idle"
    );
  }

  /* ── start a condition ── */
  function start(step) {
    stop();                        // halt any cursor loop from the previous task
    stage = step.stage;            // "baseline" (solo, everyone) | "ai" (this participant's group)
    taskId = step.taskId;
    planIndex = step.planIndex || 0;
    aiError = !!step.aiError;      // this stage's AI suggestion is scripted-wrong
    /* Read the group off the session at START time rather than off the step:
       the dev picker can change it between stages, and re-entering this task
       (Flow.render) then picks the new mechanic up with no plan rebuild. */
    group = (stage === "ai") ? Store.group() : null;
    cond = Config.conditionFor(step, group);
    aiMode = cond.ai;
    hintImpl = (aiMode === "hint") ? Hints.get(cond.hint) : null;
    handoff = (aiMode === "handoff");
    showThoughts = handoff && !!cond.thoughts;
    hcfg = resolveCursorCfg(cond);
    aiTakeovers = 0; userTakebacks = 0; aiPlacedCount = 0;
    aiHoverCard = null; aiHoverSince = 0;
    taskDef = Tasks.get(taskId);

    cards = Tasks.inboxCardsFor(taskId, Config.SHUFFLE_SEED); // deterministic per task
    byId = Object.fromEntries(cards.map(c => [c.id, c]));
    aiRanking = (aiMode === "solo") ? [] : Tasks.aiRankingFor(taskId, aiError);
    inbox = [...cards];
    slots = Array(6).fill(null);
    taskStart = performance.now();
    aiState = "idle";
    drag = null;
    pointerInZone = false;
    workStart = null; explainerOpenedAt = null; explainerMs = 0; explainerOpens = 0;
    firstActionAt = null; allPlacedAt = null;

    const newSection = isNewSection(step);

    // Multi-step onboarding — every condition has one: an array of { body, ok }
    // steps shown one at a time in the explainer tile. c1 introduces the board,
    // g1–g4 the AI interaction they are about to meet for the first time.
    // Re-fetched live (not cached) every time it's needed, so a language
    // switch mid-onboarding picks up the new translation — see relocalize().
    explainerSteps = onboardingStepsFor(cond.key);
    explainerStepIdx = 0;
    resetColumns();                // both columns start from a clean, visible state
    /* Hide the ladder for the reveal ONLY on the round that teaches the board
       (task 1), and only when its onboarding will actually run. On a repeat of
       the same condition the explainer never opens, so nothing would ever
       reveal it again and the participant would be left with nowhere to drop
       the steps. Every later round shows both columns from the start. */
    const colLadder = $("col-ladder");
    if (colLadder) colLadder.classList.toggle("col-pending-reveal", !!cond.teachBoard && !!explainerSteps && newSection);

    Store.log("task_start", {
      stage, group, condition: cond.key, aiMode, hintVariant: hintImpl ? hintImpl.name : null,
      taskId, aiError, lang: I18n.get(),
      newSection, explainerAutoShown: newSection,
      inboxOrder: cards.map(c => c.id),
      aiSuggestion: [...aiRanking],
      aiSwappedKeys: aiError ? Tasks.scriptedSwapKeys(taskId) : null,
    });

    Flow.showScreen("screen-task");
    setupChrome();
    render();

    /* The explainer describes the INTERACTION, not the task, so it only opens
       by itself on the first round of a stage. A later round (a second task id
       in BASELINE_TASKS / GROUP_TASKS) goes straight to work — re-reading the
       identical text is friction, and the ⓘ button is always there if they
       want it back.

       The cursor engine normally starts when the explainer is dismissed, so on
       a repeat it has to be started here instead. Nothing moves on its own
       either way — the AI only takes over once the cursor is parked in the
       activation zone. */
    pendingCursorStart = handoff;
    if (newSection) {
      showExplainer(true);
    } else {
      workStart = performance.now();     // no explainer to close, so the clock starts now
      if (pendingCursorStart) { pendingCursorStart = false; autoStart(); }
    }
  }

  /* First round of its stage? Compares against the PREVIOUS entry in the plan
     rather than remembering the last one, so it stays right after a resume or
     a dev skip. */
  function isNewSection(step) {
    const d = Store.get();
    const plan = (d && d.plan) || [];
    const prev = plan[(step.planIndex || 0) - 1];
    return !prev || prev.stage !== step.stage;
  }

  // Halt the current task's AI cursor and clear every transient overlay.
  // Called by the dev Skip button and at the top of start().
  function stop() {
    runId++;
    closeExplainerNow();           // never leave a half-open explainer over the next stage
    resetColumns();                // never leave a column hidden across a Skip / task switch
    driveStop();
    fc = null;
    aiState = "idle";
    pendingCursorStart = false;
    drag = null;
    const main = $("main");
    if (main) main.classList.remove("ai-driving");
    if (ghost) ghost.style.display = "none";
    clearSlotMarks();
    hideCursor();
  }

  /* Drop the explainer instantly — no animation, no logging. Used when the
     stage is torn down (task switch, dev Skip), where hideExplainer's 360 ms
     fly-down is wrong: stop() used to merely CANCEL that pending timer, so an
     explainer that was still open stayed on screen over the next round (a
     round which, being a repeat of the same stage, never reopens it). Only
     reachable with the dev Skip — a participant cannot finish a round with
     the explainer covering the board — but it made multi-round configs look
     broken while testing them. */
  function closeExplainerNow() {
    if (explainerTimer) { clearTimeout(explainerTimer); explainerTimer = null; }
    const overlay = $("explainer-overlay");
    if (!overlay) return;
    const card = overlay.querySelector(".explainer-card");
    overlay.hidden = true;
    overlay.style.transition = ""; overlay.style.opacity = "";
    if (card) { card.style.transition = ""; card.style.transform = ""; card.style.opacity = ""; }
    // Close the reading clock so a torn-down stage cannot leave it running.
    if (explainerOpenedAt != null) {
      explainerMs += Math.round(performance.now() - explainerOpenedAt);
      explainerOpenedAt = null;
    }
  }

  /* ── explainer tile (animates to/from the Explainer button) ── */
  // Transform that collapses the centred card into the Explainer button.
  function cornerTransform() {
    const card = $("explainer-overlay").querySelector(".explainer-card");
    const btn = $("btn-explainer");
    const c = card.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (c.left + c.width / 2);
    const dy = (b.top + b.height / 2) - (c.top + c.height / 2);
    return `translate(${dx}px, ${dy}px) scale(0.12)`;
  }

  // Look up the onboarding steps fresh (never cached) so a language switch
  // always sees the current translation — see relocalize(). Asked via
  // I18n.opt() rather than t() because a condition may instead define a single
  // `explainer` paragraph (showExplainer's last branch), so "no onboarding
  // here" is a legitimate answer rather than a missing string.
  function onboardingStepsFor(condKey) {
    const v = I18n.opt(`conditions.${condKey}.onboarding`);
    return Array.isArray(v) ? v : null;
  }

  // Fill in the explainer tile's text for the current explainerStepIdx.
  // Step 0 carries the "Task N of total" title; later steps don't repeat it.
  function renderExplainerStep() {
    const total = (Store.get().plan || []).length;
    const step = explainerSteps[explainerStepIdx];
    $("explainer-title").textContent = explainerStepIdx === 0
      ? I18n.t("ui.task.taskCounter", { n: planIndex + 1, total }) : "";
    $("explainer-body").textContent = step.body;
    $("explainer-ok").textContent = step.ok || I18n.t("ui.task.explainerOk");
  }

  // Guaranteed-clean state: both columns visible, no pending timer. Used at
  // the top of every start() and as a catch-all on Skip / task switch, so
  // nothing is ever left hidden by a half-finished onboarding sequence.
  function resetColumns() {
    if (rightColRevealTimer) { clearTimeout(rightColRevealTimer); rightColRevealTimer = null; }
    const colLadder = $("col-ladder"), colInbox = $("col-inbox");
    if (colLadder) colLadder.classList.remove("col-pending-reveal");
    if (colInbox) colInbox.classList.remove("col-pending-reveal");
  }

  // The onboarding "swap": reveal the ladder (right) and hide the inbox
  // (left) — used both by the timed 3s reveal and when the participant
  // clicks through step 0 before the timer fires.
  function revealRightHideLeft() {
    if (rightColRevealTimer) { clearTimeout(rightColRevealTimer); rightColRevealTimer = null; }
    const colLadder = $("col-ladder"), colInbox = $("col-inbox");
    if (colLadder) colLadder.classList.remove("col-pending-reveal");
    if (colInbox) colInbox.classList.add("col-pending-reveal");
  }

  function showExplainer(auto) {
    const total = (Store.get().plan || []).length;
    if (auto && explainerSteps) {
      // First-ever showing of a multi-step onboarding: start at step 0 with
      // only the left (inbox) column visible. The column swap — reveal the
      // right, hide the left — happens when the participant presses OK to
      // advance to step 1 ("drag them one by one…"), not on a timer.
      explainerAutoFlow = true;
      explainerStepIdx = 0;
      renderExplainerStep();
    } else if (explainerSteps) {
      // Reopened mid-task via the footer ⓘ button: show the full text as one
      // window — the ladder is already visible and placements already exist,
      // so re-running the step/reveal sequence would be disruptive.
      explainerAutoFlow = false;
      $("explainer-title").textContent = I18n.t("ui.task.taskCounter", { n: planIndex + 1, total });
      $("explainer-body").textContent = explainerSteps.map(s => s.body).join(" ");
      $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
    } else {
      explainerAutoFlow = false;
      $("explainer-title").textContent = I18n.t("ui.task.taskCounter", { n: planIndex + 1, total });
      $("explainer-body").textContent = I18n.t(`conditions.${cond.key}.explainer`);
      $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
    }

    const overlay = $("explainer-overlay");
    const card = overlay.querySelector(".explainer-card");
    // The onboarding sequence needs the columns behind the tile to actually
    // be visible when the ladder is revealed — the normal explainer look
    // (heavy white wash + blur) hides that almost completely.
    overlay.classList.toggle("explainer-overlay--light", !!explainerSteps);
    if (explainerTimer) { clearTimeout(explainerTimer); explainerTimer = null; }

    overlay.hidden = false;
    // Start collapsed at the button, then expand out to the centre.
    overlay.style.transition = "none";
    card.style.transition = "none";
    overlay.style.opacity = "0";
    card.style.opacity = "0";
    card.style.transform = cornerTransform();
    void card.offsetWidth; // force reflow so the start state is committed
    requestAnimationFrame(() => {
      overlay.style.transition = "";
      card.style.transition = "";
      overlay.style.opacity = "1";
      card.style.opacity = "1";
      card.style.transform = "";
    });
    if (explainerOpenedAt == null) { explainerOpenedAt = performance.now(); explainerOpens++; }
    Store.log("explainer_shown", { stage, group, taskId, auto: !!auto, reopen: explainerOpens > 1 });
  }

  function hideExplainer() {
    const overlay = $("explainer-overlay");
    const card = overlay.querySelector(".explainer-card");
    if (explainerTimer) clearTimeout(explainerTimer);
    // Fly the tile down into the Explainer button.
    overlay.style.transition = "";
    card.style.transition = "";
    card.style.transform = cornerTransform();
    card.style.opacity = "0";
    overlay.style.opacity = "0";
    explainerTimer = setTimeout(() => {
      overlay.hidden = true;
      card.style.transition = "none";
      card.style.transform = "";
      card.style.opacity = "";
      overlay.style.opacity = "";
      explainerTimer = null;
    }, 360);
    // Close the reading clock; the task's own clock starts on the first dismiss.
    const openMs = explainerOpenedAt != null ? Math.round(performance.now() - explainerOpenedAt) : null;
    if (openMs != null) explainerMs += openMs;
    explainerOpenedAt = null;
    if (workStart == null) workStart = performance.now();
    Store.log("explainer_dismissed", { stage, group, taskId, openMs, reopen: explainerOpens > 1 });
  }
  function explainerOk() {
    // Mid-onboarding: advance to the next step in place rather than closing.
    // On the board-teaching round only, swap the columns as we do — reveal the
    // right (ladder), hide the left (inbox) — because c1's step 1 ("drag them
    // one by one…") refers to the right column directly. The g1–g4 onboardings
    // describe the AI, not the board, so they leave both columns alone.
    if (explainerSteps && explainerStepIdx < explainerSteps.length - 1) {
      explainerStepIdx++;
      if (cond.teachBoard) revealRightHideLeft();
      renderExplainerStep();
      Store.log("explainer_step", { stage, group, taskId, step: explainerStepIdx });
      return;
    }
    // Closing for real: the actual task needs both columns, so undo the
    // onboarding swap before work begins.
    resetColumns();
    hideExplainer();
    if (pendingCursorStart) { pendingCursorStart = false; autoStart(); }
  }

  function setupChrome() {
    $("b-prox").textContent = "📍 " + I18n.t(`conditions.${cond.key}.banner`);

    // Task brief on top of the tile segment (title + description from the task).
    taskDef = Tasks.get(taskId);   // re-resolve: the active language may have changed
    $("task-title").textContent = taskDef ? (taskDef.title || "") : "";
    $("task-desc").textContent = taskDef ? (taskDef.description || "") : "";

    // A hint variant supplies its own badge + footer wording, so competing
    // variants can be told apart on screen without task.js knowing them.
    // handoff has two flavours (with/without the reasoning panel).
    const modeKey = (handoff && showThoughts) ? "handoff-thoughts" : aiMode;
    const hintKey = hintImpl ? hintImpl.hintKey : `ui.task.hints.${modeKey}`;
    const badgeKey = hintImpl ? hintImpl.badgeKey : `ui.task.badges.${modeKey}`;

    /* A handoff stage's footer line has two phases: sorting, and the review
       prompt once every step is placed. Resolved here (rather than only at the
       transition) so a language switch mid-stage picks the phase up correctly. */
    let hintText = I18n.t(hintKey);
    if (handoff && aiState === "done") hintText = I18n.t("ui.task.handoffDone");
    $("hint").textContent = hintText;

    const badge = $("b-badge");
    const badgeTxt = (aiMode === "solo") ? null : I18n.t(badgeKey);
    if (badgeTxt) { badge.hidden = false; badge.textContent = badgeTxt; }
    else badge.hidden = true;

    // Reasoning panel: present for the whole stage (so its space is reserved
    // and nothing shifts when it fills), revealed as the AI acts.
    const panel = $("ai-thought");
    if (panel) {
      panel.hidden = !showThoughts;
      panel.classList.remove("visible");
      $("ai-thought-txt").textContent = "";
      $("ai-thought-label").textContent = I18n.t("ui.task.thoughtLabel");
    }

    // Participant speed control — only where an AI cursor actually moves.
    const speedCtl = $("ai-speed-ctl");
    if (speedCtl) {
      const show = handoff && !!hcfg.userSpeedControl;
      speedCtl.hidden = !show;
      if (show) {
        $("ai-speed").value = hcfg.speed;
        $("ai-speed-label").textContent = I18n.t("ui.task.speedLabel");
      }
    }

    // AI activation zone — only in handoff stages, where a shared cursor exists.
    if (zoneEl) {
      zoneEl.hidden = !handoff;
      if (handoff) {
        const label = $("ai-zone-label");
        if (label) label.textContent = I18n.t(
          fc && fc.active ? "ui.task.zone.active" : "ui.task.zone.idle"
        );
      } else {
        zoneEl.classList.remove("active");
      }
    }

    $("btn-explainer").textContent = I18n.t("ui.task.explainerBtn");
    $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
    $("btn-confirm").textContent = I18n.t("ui.task.confirm");
    $("inbox-hd").textContent = I18n.t("ui.task.inboxHd", { n: inbox.length });
    $("ladder-hd").textContent = I18n.t("ui.task.ladderHd");
  }

  /* Re-render the whole task in the newly selected language. Safe at any
     moment: both task files share ids, tiles[].key and swapKeys, so `cards`,
     `inbox`, `slots` and `aiRanking` stay valid — only the text is replaced. */
  function relocalize() {
    if (!cond) return;
    const inboxIds = inbox.map(c => c.id);           // card ids survive the switch
    cards = Tasks.inboxCardsFor(taskId, Config.SHUFFLE_SEED);
    byId = Object.fromEntries(cards.map(c => [c.id, c]));
    inbox = inboxIds.map(id => byId[id]).filter(Boolean);  // keep the on-screen order
    setupChrome();
    render();
    // The onboarding steps were looked up in whatever language was active
    // when the task started (or last relocalized) — refresh them now so a
    // language switch actually translates the intro text and its buttons,
    // not just the surrounding chrome.
    explainerSteps = onboardingStepsFor(cond.key);
    // If the explainer is open, swap its text too — respecting whichever
    // onboarding step (if any) is currently showing, so a language switch
    // mid-onboarding doesn't jump back to the combined single-window text
    // or leave the button in the old language.
    const overlay = $("explainer-overlay");
    if (overlay && !overlay.hidden) {
      if (explainerSteps && explainerAutoFlow) {
        renderExplainerStep();
      } else if (explainerSteps) {
        const total = (Store.get().plan || []).length;
        $("explainer-title").textContent = I18n.t("ui.task.taskCounter", { n: planIndex + 1, total });
        $("explainer-body").textContent = explainerSteps.map(s => s.body).join(" ");
        $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
      } else {
        const total = (Store.get().plan || []).length;
        $("explainer-title").textContent = I18n.t("ui.task.taskCounter", { n: planIndex + 1, total });
        $("explainer-body").textContent = I18n.t(`conditions.${cond.key}.explainer`);
        $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
      }
    }
  }

  /* ── render ── */
  function render() {
    renderInbox();
    renderLadder();
    $("btn-confirm").disabled = !slots.every(Boolean);
  }

  function renderInbox() {
    const el = $("inbox");
    el.innerHTML = "";
    if (!inbox.length) {
      const n = document.createElement("div");
      n.className = "empty-note";
      n.textContent = I18n.t("ui.task.allPlaced");
      el.appendChild(n);
    } else {
      inbox.forEach(card => {
        const row = document.createElement("div");
        row.className = "inbox-slot";      // same row layout as a ladder slot
        row.appendChild(makeCardEl(card, "inbox"));
        el.appendChild(row);
      });
    }
    $("inbox-hd").textContent = I18n.t("ui.task.inboxHd", { n: inbox.length });
  }

  function renderLadder() {
    const el = $("ladder");
    el.innerHTML = "";
    slots.forEach((id, i) => {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.slot = i;
      const num = document.createElement("div");
      num.className = "slot-num";
      num.textContent = i + 1;
      slot.appendChild(num);
      if (id) {
        slot.appendChild(makeCardEl(byId[id], i));
      } else {
        const lbl = document.createElement("div");
        lbl.className = "slot-lbl";
        lbl.textContent = slotLabel(i);
        slot.appendChild(lbl);
      }
      el.appendChild(slot);
    });
  }

  function makeCardEl(card, from) {
    const div = document.createElement("div");
    div.className = "card";
    div.dataset.id = card.id;
    div.dataset.from = String(from);
    div.innerHTML = `<div class="card-txt"><div class="card-title">${card.title}</div></div>
      <div class="card-grip">⠿</div>`;
    div.addEventListener("mousedown", onMouseDown);
    // c3: hovering a step shows its reasoning, exactly as the AI passing over
    // it does. No-op unless the stage has the reasoning panel.
    div.addEventListener("mouseenter", () => showThought(card.id, "user"));
    return div;
  }

  /* ── custom mouse drag ── */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    const card = e.currentTarget;
    const id = card.dataset.id;
    const from = card.dataset.from === "inbox" ? "inbox" : +card.dataset.from;
    const rect = card.getBoundingClientRect();
    drag = {
      id, from, started: false,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      srcW: rect.width, srcH: rect.height,
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }

  function startDrag() {
    if (drag.started) return;
    drag.started = true;
    ghostShow(drag.id, drag.srcW);
    drag.ghostW = ghost.offsetWidth || drag.srcW || 280;
    drag.ghostH = ghost.offsetHeight || 58;
    const src = document.querySelector(`[data-id="${drag.id}"]`);
    if (src) src.classList.add("ghost");

    // Hand off to whichever hint variant this stage selected. `aiRanking`
    // already carries any scripted error, so a wrong stage hints — and
    // explains — the wrong slot, whatever the variant.
    if (hintImpl) {
      const ctx = hintContext(drag.id);
      try { hintImpl.onPickUp(ctx); }
      catch (e) { console.error(`hint "${hintImpl.name}".onPickUp failed`, e); }
      if (ctx.aiSlot >= 0) {
        Store.log("hint_shown", {
          cardId: drag.id, hintSlot: ctx.aiSlot, hintVariant: hintImpl.name,
          withThought: !!hintImpl.showsReasoning, isWrongHint: ctx.isWrongHint,
        });
      }
    }
    if (firstActionAt == null) firstActionAt = performance.now();
    Store.log("drag_start", { cardId: drag.id, from: drag.from });
  }

  function clearSlotMarks() {
    document.querySelectorAll(".slot").forEach(s =>
      s.classList.remove("drop-target"));
    Hints.clearAll();   // each variant removes its own traces
  }

  /* ── the floating ghost, shared by the participant's drag and the AI carry ── */
  function ghostShow(id, width) {
    const c = byId[id];
    $("ghost-title").textContent = c.title;
    ghost.style.maxWidth = "none";
    ghost.style.width = (width || 280) + "px"; // match the source tile — no compression
    ghost.style.display = "flex";
  }
  function ghostMoveTo(left, top) { ghost.style.left = left + "px"; ghost.style.top = top + "px"; }
  function ghostHide() { ghost.style.display = "none"; }

  function onMouseMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.started && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    startDrag();

    const gx = e.clientX - drag.offsetX;
    const gy = e.clientY - drag.offsetY;

    document.querySelectorAll(".slot").forEach(s => {
      const r = s.getBoundingClientRect();
      s.classList.toggle("drop-target",
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    });

    // Optional hook: a variant that reacts to pointer movement (proximity
    // cues, live confidence, …) implements onMove; the current two don't.
    if (hintImpl && hintImpl.onMove) {
      try { hintImpl.onMove(hintContext(drag.id), e.clientX, e.clientY); }
      catch (err) { console.error(`hint "${hintImpl.name}".onMove failed`, err); }
    }

    ghost.style.left = gx + "px";
    ghost.style.top = gy + "px";
  }

  function onMouseUp(e) {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    clearSlotMarks();

    if (!drag) return;
    if (!drag.started) { drag = null; return; }

    ghostHide();
    const src = document.querySelector(`[data-id="${drag.id}"]`);
    if (src) src.classList.remove("ghost");

    // Drop by the pointer position (not the ghost) so the item lands where the cursor is.
    const px = e.clientX, py = e.clientY;

    let targetSlot = null;
    document.querySelectorAll(".slot").forEach(s => {
      const r = s.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) targetSlot = +s.dataset.slot;
    });

    const ir = $("inbox").getBoundingClientRect();
    const droppedInInbox = px >= ir.left && px <= ir.right && py >= ir.top && py <= ir.bottom;

    const { id, from } = drag;
    drag = null;

    if (targetSlot != null) {
      Store.log("drag_drop", { cardId: id, from: from === "inbox" ? "inbox" : `slot_${from}`, to: `slot_${targetSlot}` });
      placeCard(id, from, targetSlot);
    } else if (droppedInInbox && from !== "inbox") {
      Store.log("drag_drop", { cardId: id, from: `slot_${from}`, to: "inbox" });
      returnToInbox(id, from);
    }
    render();
  }

  function placeCard(id, from, toSlot) {
    const displaced = slots[toSlot];
    slots[toSlot] = id;
    if (from === "inbox") {
      inbox = inbox.filter(c => c.id !== id);
      if (displaced) { inbox = inbox.filter(c => c.id !== displaced); inbox.push(byId[displaced]); }
    } else {
      slots[from] = displaced || null;
    }
  }

  function returnToInbox(id, fromSlot) {
    slots[fromSlot] = null;
    if (!inbox.find(c => c.id === id)) inbox.push(byId[id]);
  }

  /* ═══ the AI cursor ═══════════════════════════════════════════
     A fake cursor that plans human-ish motion: think → curve toward the
     step → grab → carry → drop. Driven by rAF (with a setInterval
     watchdog, because background tabs throttle rAF). It follows
     `aiRanking`, so a scripted error is placed exactly as suggested.
     ══════════════════════════════════════════════════════════════════ */

  function hideCursor() {
    if (!aiCursor) return;
    aiCursor.style.display = "none";
    aiCursor.style.opacity = "0";
  }

  /* ── geometry ── */
  function tileCenter(id) {
    const el = document.querySelector(`#inbox [data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }
  function slotCenter(i) {
    const el = document.querySelector(`#ladder [data-slot="${i}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function highlightSlotAt(x, y) {
    document.querySelectorAll(".slot.drop-target").forEach(s => s.classList.remove("drop-target"));
    document.querySelectorAll("#ladder .slot").forEach(s => {
      const r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) s.classList.add("drop-target");
    });
  }

  /* ── motion queue ── */
  function pushMove(tx, ty, ease, curve) {
    fc.queue.push({ type: "move", to: { x: tx, y: ty }, ease: ease || "cubic", curve: curve == null ? 0.12 : curve, t: 0 });
  }
  function pushPause(ms) { fc.queue.push({ type: "pause", dur: ms, t: 0 }); }
  function pushGrab(id) { fc.queue.push({ type: "grab", id }); }
  function pushDrop(slot) { fc.queue.push({ type: "drop", slot }); }

  // Plan one pick-up-and-place: nearest remaining step → the slot the AI wants.
  function planJob() {
    const free = inbox.filter(c => c.id !== fc.carrying && aiRanking.indexOf(c.id) !== -1);
    if (!free.length) { pushPause(300); return; }

    let target = free[0], best = Infinity;
    free.forEach(c => {
      const ctr = tileCenter(c.id);
      if (ctr) { const d = dist(fc.x, fc.y, ctr.x, ctr.y); if (d < best) { best = d; target = c; } }
    });
    const cc = tileCenter(target.id);
    const slotIdx = aiRanking.indexOf(target.id);
    if (!cc || slotIdx < 0) { pushPause(300); return; }
    const hes = !!(hcfg && hcfg.hesitate);

    // Say what it's about to do BEFORE it moves, so there is time to read it
    // while the cursor travels rather than only at the moment of the drop.
    showThought(target.id, "ai");

    pushPause(hes ? rand(350, 1000) : rand(120, 260));            // a beat of "thinking"
    if (hes && Math.random() < 0.6) {                             // second-guess approach
      pushMove(cc.x + rand(-40, 40), cc.y + rand(-44, -14), "cubic", 0.18);
      pushPause(rand(180, 480));
      pushMove(cc.x, cc.y, "back", 0.05);
    } else {
      pushMove(cc.x, cc.y, "back", 0.13);
    }
    pushGrab(target.id);
    pushPause(hes ? rand(160, 360) : rand(90, 170));

    const sc = slotCenter(slotIdx) || { x: fc.x, y: fc.y };
    if (hes && Math.random() < 0.5) {
      pushMove(sc.x + rand(-30, 30), sc.y - rand(40, 80), "cubic", 0.10);
      pushPause(rand(200, 520));
      pushMove(sc.x, sc.y, "cubic", 0.04);
    } else {
      pushMove(sc.x, sc.y, "back", 0.08);
    }
    pushDrop(slotIdx);
    // Rest after the placement (Config.AI_CURSOR.pauseAfterPlaceMs). A fixed,
    // configurable value rather than the old random beat, so "the AI waits a
    // second between steps" is something the study can state exactly.
    const rest = hcfg && hcfg.pauseAfterPlaceMs != null ? hcfg.pauseAfterPlaceMs : 0;
    if (rest > 0) pushPause(rest);
  }

  function startSegment() {
    fc.seg = fc.queue.shift() || null;
    if (!fc.seg || fc.seg.type !== "move") return;
    // Curve the travel: a quadratic bezier bowed off the straight line.
    const p0 = { x: fc.x, y: fc.y }, p1 = fc.seg.to;
    const d = Math.max(1, dist(p0.x, p0.y, p1.x, p1.y));
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    const nx = -(p1.y - p0.y) / d, ny = (p1.x - p0.x) / d;
    const amp = d * fc.seg.curve * (Math.random() < 0.5 ? -1 : 1);
    fc.seg.p0 = p0; fc.seg.p1 = p1;
    fc.seg.ctrl = { x: mx + nx * amp, y: my + ny * amp };
    /* The ceiling is a safety valve against nonsense geometry (a zero-size or
       off-screen rect would otherwise plan a minutes-long crawl), NOT a pacing
       device — it has to stay well above the slowest legitimate travel, or it
       would silently cap the speed setting on a large screen. At the default
       slider the longest realistic move is ~4.5 s. */
    fc.seg.dur = clamp(d / speedPPS() * 1000 * ((hcfg && hcfg.hesitate) ? 1.22 : 1), 170, 12000);
    fc.seg.t = 0;
  }
  function bezier(p0, ctrl, p1, t) {
    const u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x,
             y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p1.y };
  }

  function updateMotion(dt) {
    if (!fc.seg) {
      if (!fc.queue.length) planJob();
      startSegment();
      if (!fc.seg) return;
    }
    const s = fc.seg;

    if (s.type === "pause") {
      s.t += dt;
      if (s.t >= s.dur) fc.seg = null;

    } else if (s.type === "move") {
      s.t += dt / s.dur;
      const tt = clamp(s.t, 0, 1);
      const e = s.ease === "back" ? easeOutBack(tt) : easeInOutCubic(tt);
      const pos = bezier(s.p0, s.ctrl, s.p1, e);
      fc.x = pos.x; fc.y = pos.y;
      if (fc.carrying != null) { ghostMoveTo(fc.x - 26, fc.y - 20); highlightSlotAt(fc.x, fc.y); }
      // The AI cursor fires no real hover events, so hit-test what it is over.
      // While carrying it "holds" that step — show it straight away, since the
      // grab is deliberate; otherwise require a dwell so transit doesn't flicker.
      if (showThoughts) {
        if (fc.carrying != null) showThought(fc.carrying, "ai");
        else aiHoverThought(cardIdAt(fc.x, fc.y), performance.now());
      }
      if (s.t >= 1) { fc.x = s.p1.x; fc.y = s.p1.y; fc.seg = null; }

    } else if (s.type === "grab") {
      const ctr = tileCenter(s.id);
      if (ctr && inbox.some(c => c.id === s.id)) {
        fc.carrying = s.id;
        const src = document.querySelector(`#inbox [data-id="${s.id}"]`);
        if (src) src.classList.add("ghost");   // dim in place; it leaves the inbox on drop
        ghostShow(s.id, ctr.w);
        ghostMoveTo(fc.x - 26, fc.y - 20);
        clickPulse();
      }
      fc.seg = null;

    } else if (s.type === "drop") {
      const id = fc.carrying;
      fc.carrying = null;
      if (id != null) {
        ghostHide();
        clearSlotMarks();
        clickPulse();
        aiPlacedCount++;
        Store.log("ai_placement", { cardId: id, slot: s.slot, isError: byId[id].rank !== s.slot + 1 });
        placeCard(id, "inbox", s.slot);
        render();
      }
      fc.seg = null;
    }
  }

  function clickPulse() {
    if (!aiCursor) return;
    aiCursor.classList.remove("clicking");
    void aiCursor.offsetWidth;   // restart the ring animation
    aiCursor.classList.add("clicking");
  }

  /* ── lifecycle ── */
  /* Start the cursor engine. It starts dormant: the drive loop watches the
     activation zone and only then wakes the cursor. */
  function autoStart() {
    const main = $("main");
    const r = main.getBoundingClientRect();
    // Dormant at birth: the cursor comes alive on takeover, never by itself.
    fc = {
      run: runId, active: false, done: false, opacity: 0,
      x: lastPointer.x || (r.left + r.width * 0.25),
      y: lastPointer.y || (r.top + r.height * 0.5),
      carrying: null, seg: null, queue: [], returning: false, returnT: 0, returnFrom: { x: 0, y: 0 },
    };
    aiCursor.style.display = "block";
    aiCursor.style.opacity = "0";
    aiCursor.style.transform = `translate(${fc.x}px,${fc.y}px)`;
    aiState = "idle";                    // the participant has control first
    Store.log("handoff_armed", {
      taskId, speed: hcfg.speed, hesitate: !!hcfg.hesitate,
    });
    render();
    driveStart();
  }

  // The AI takes the cursor over (handoff only, from the activation zone).
  function activateFake() {
    fc.active = true;
    fc.returning = false;
    fc.queue.length = 0;
    fc.seg = null;
    if (lastPointer.x || lastPointer.y) { fc.x = lastPointer.x; fc.y = lastPointer.y; }
    aiState = "running";
    aiTakeovers++;
    $("main").classList.add("ai-driving");
    if (zoneEl) zoneEl.classList.add("active");
    updateZoneLabel();
    Store.log("ai_took_over", {
      taskId, nth: aiTakeovers, placedSoFar: slots.filter(Boolean).length,
      speed: hcfg.speed,
    });
  }

  // Everything placed → fade the cursor out and hand the result over for review.
  function autoFinish() {
    fc.active = false;
    fc.done = true;
    fc.queue.length = 0;
    fc.seg = null;
    fc.carrying = null;
    aiState = "done";
    $("main").classList.remove("ai-driving");
    // Everything is placed — the zone has no more work to hand off, so retire it.
    if (zoneEl) { zoneEl.classList.remove("active"); zoneEl.hidden = true; }
    ghostHide();
    clearSlotMarks();
    hideThought();
    $("hint").textContent = I18n.t("ui.task.handoffDone");
    render();
    allPlacedAt = performance.now();
    Store.log("handoff_done", {
      taskId, slots: [...slots],
      aiTakeovers, userTakebacks, placedByAi: aiPlacedCount,
    });
  }

  /* The participant moved/clicked/typed: give the cursor straight back.
     Any step the AI was mid-carry is dropped back into the inbox untouched —
     it is never half-placed. */
  function autoHandBack() {
    if (!fc || !fc.active) return;
    if (fc.carrying != null) {
      const src = document.querySelector(`#inbox [data-id="${fc.carrying}"]`);
      if (src) src.classList.remove("ghost");   // it never left the inbox
      ghostHide();
      fc.carrying = null;
    }
    fc.active = false;
    fc.queue.length = 0;
    fc.seg = null;
    // Sweep the cursor back to the real pointer before fading — a visible
    // "here, it's yours again" rather than a blink.
    fc.returning = true; fc.returnT = 0; fc.returnFrom = { x: fc.x, y: fc.y };
    aiState = "idle";
    userTakebacks++;
    $("main").classList.remove("ai-driving");
    if (zoneEl) zoneEl.classList.remove("active");
    updateZoneLabel();
    clearSlotMarks();
    hideThought();
    Store.log("user_took_back", {
      taskId, nth: userTakebacks, placedSoFar: slots.filter(Boolean).length,
    });
    render();
  }

  /* ── the AI's reasoning panel (handoff + thoughts) ──
     The panel always describes the step under the cursor — whichever cursor
     that is. The participant hovering a tile shows its reasoning just as the
     AI passing over one does, so the reasoning is readable on demand rather
     than only while the AI happens to be working.

     It stays on the last step shown rather than clearing on mouse-out, which
     would make it flicker as the pointer crosses gaps between tiles. */
  let shownThoughtFor = null;   // card id currently in the panel
  /* The AI cursor sweeps across tiles in transit. Swapping the panel for every
     tile it clips would flicker (~20× a task) and make the text unreadable, so
     a pass only counts once the cursor has settled on it. A real hover by the
     participant is deliberate and shows immediately. */
  const AI_HOVER_DWELL_MS = 220;
  let aiHoverCard = null, aiHoverSince = 0;

  function aiHoverThought(cardId, now) {
    if (cardId !== aiHoverCard) { aiHoverCard = cardId; aiHoverSince = now; return; }
    if (cardId && now - aiHoverSince >= AI_HOVER_DWELL_MS) showThought(cardId, "ai");
  }

  function showThought(cardId, source) {
    if (!showThoughts || !cardId) return;
    if (cardId === shownThoughtFor) return;         // already displayed — no re-render, no re-log
    const text = Tasks.thoughtFor(taskId, cardId, aiError);
    const panel = $("ai-thought");
    if (!panel || !text) return;
    shownThoughtFor = cardId;
    $("ai-thought-txt").textContent = text;
    panel.classList.add("visible");
    const trueSlot = byId[cardId] ? byId[cardId].rank - 1 : -1;
    const aiSlot = aiRanking.indexOf(cardId);
    Store.log("ai_thought_shown", {
      taskId, cardId, aiSlot, source: source || "ai",
      isWrongThought: aiSlot >= 0 && aiSlot !== trueSlot,
    });
  }
  function hideThought() {
    const panel = $("ai-thought");
    if (panel) panel.classList.remove("visible");
    shownThoughtFor = null;
  }

  // Which card sits under a viewport point (used for the AI cursor, which
  // generates no real hover events).
  function cardIdAt(x, y) {
    let found = null;
    document.querySelectorAll("#inbox .card, #ladder .card").forEach(el => {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = el.dataset.id;
    });
    return found;
  }
  function updateReturn(dt) {
    fc.returnT += dt / AUTO.returnMs;
    const e = easeInOutCubic(clamp(fc.returnT, 0, 1));
    fc.x = lerp(fc.returnFrom.x, lastPointer.x, e);
    fc.y = lerp(fc.returnFrom.y, lastPointer.y, e);
    if (fc.returnT >= 1) { fc.x = lastPointer.x; fc.y = lastPointer.y; fc.returning = false; }
  }

  /* ── drive loop (rAF primary; setInterval watchdog for throttled tabs) ── */
  function driveStart() {
    driveStop();
    prevTs = performance.now(); lastStepTs = prevTs;
    rafId = requestAnimationFrame(rafLoop);
    watchdog = setInterval(() => {
      const now = performance.now();
      if (now - lastStepTs > 90) step(now);
    }, 60);
  }
  function rafLoop(now) { step(now); if (rafId != null) rafId = requestAnimationFrame(rafLoop); }
  function driveStop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    if (watchdog != null) clearInterval(watchdog);
    watchdog = null;
  }

  function step(now) {
    if (!fc || fc.run !== runId) { driveStop(); return; }
    // Cap only against absurd gaps (tab hidden for minutes). Deliberately far
    // above one frame: when rAF is throttled the watchdog fires with a large
    // dt, and clamping it tightly would make the AI crawl in slow motion
    // instead of progressing at its real pace.
    const dt = Math.min(2000, now - prevTs);
    prevTs = now; lastStepTs = now;

    const complete = slots.every(Boolean);
    if (fc.active && complete) autoFinish();
    // Handoff: the AI steps in while the real cursor rests inside the
    // activation zone. Leaving the zone hands control back (see wire()).
    else if (handoff && !complete && !fc.active && !fc.returning && !drag
             && pointerInZone) activateFake();

    const targetOp = (fc.active || fc.returning) ? 1 : 0;
    const rate = fc.active ? dt / AUTO.fadeInMs : dt / AUTO.fadeOutMs;
    if (fc.opacity < targetOp) fc.opacity = Math.min(targetOp, fc.opacity + rate);
    else if (fc.opacity > targetOp) fc.opacity = Math.max(targetOp, fc.opacity - rate);

    if (fc.active && fc.opacity > 0.05) {
      // Consume dt in frame-sized slices so one long tick can advance several
      // queued segments rather than just one.
      let remaining = dt, guard = 0;
      while (remaining > 0 && fc.active && guard++ < 64 && !slots.every(Boolean)) {
        const slice = Math.min(remaining, 32);
        updateMotion(slice);
        remaining -= slice;
      }
    } else if (fc.returning) updateReturn(dt);

    if (fc.opacity > 0) {
      // a hair of organic jitter so the cursor never looks mechanically still
      const jx = Math.sin(now / 180) * 1.0 + Math.sin(now / 70) * 0.5;
      const jy = Math.cos(now / 160) * 1.0 + Math.cos(now / 90) * 0.5;
      aiCursor.style.opacity = fc.opacity.toFixed(3);
      aiCursor.style.transform = `translate(${(fc.x + jx).toFixed(1)}px,${(fc.y + jy).toFixed(1)}px)`;
    } else {
      aiCursor.style.opacity = "0";
      // Only tear the engine down once the task is finished. In a handoff
      // stage the cursor merely goes dormant between takeovers, so the loop
      // has to keep running to notice the next idle spell.
      if (fc.done) { hideCursor(); driveStop(); fc = null; }
    }
  }

  /* ── scoring ── */
  function scoreRanking(submitted) {
    let correct = 0;
    submitted.forEach((id, i) => { if (id && byId[id].rank === i + 1) correct++; });
    return correct;
  }
  function countOverrides() {
    if (aiMode === "solo") return null;
    let n = 0;
    slots.forEach((id, i) => {
      if (!id) return;
      const aiPos = aiRanking.indexOf(id);
      if (aiPos !== -1 && aiPos !== i) n++;
    });
    return n;
  }

  /* ── confirm → result → results screen ── */
  function confirm() {
    const now = performance.now();
    /* Four separate clocks, because one number can't answer the question:
         elapsedMs    total, screen shown → confirm (includes reading + AI)
         explainerMs  cumulative time the instructions were open
         workMs       elapsedMs minus explainerMs — actual time on the task
         reviewMs     every step placed → confirm, i.e. how long they looked
                      the finished order over before signing it off. Only a
                      handoff stage sets it: it starts when the AI cursor
                      completes the board, so it is null if the participant
                      placed the last step themselves.
       timeToFirstActionMs is measured from the first explainer dismissal. */
    const elapsed = Math.round(now - taskStart);
    const explainerTotal = explainerElapsed();
    const timing = {
      elapsedMs: elapsed,
      explainerMs: explainerTotal,
      explainerOpens,
      workMs: Math.max(0, elapsed - explainerTotal),
      timeToFirstActionMs: (firstActionAt != null && workStart != null)
        ? Math.round(firstActionAt - workStart) : null,
      reviewMs: allPlacedAt != null ? Math.round(now - allPlacedAt) : null,
    };
    if (aiMode !== "solo") {
      slots.forEach((id, i) => {
        if (!id) return;
        const aiPos = aiRanking.indexOf(id);
        if (aiPos !== -1 && aiPos !== i) Store.log("ai_override", { cardId: id, aiSlot: aiPos, participantSlot: i });
      });
    }
    const result = {
      stage, group, condition: cond.key, aiMode, hintVariant: hintImpl ? hintImpl.name : null,
      taskId, aiError, lang: I18n.get(),
      ranking: [...slots],
      score: scoreRanking(slots),   // vs. the true order — unaffected by aiError
      overrides: countOverrides(),
      // shared-control behaviour (handoff stages; 0/null elsewhere)
      aiTakeovers, userTakebacks, placedByAi: aiPlacedCount,
      cursorSpeed: hcfg ? hcfg.speed : null,
      cursorHesitate: hcfg ? !!hcfg.hesitate : null,
      ...timing,
    };
    Store.log("task_confirm", { stage, group, taskId, finalRanking: [...slots], ...timing });
    Store.addResult(result);
    hideCursor();
    // No per-task summary — go straight to the next stage.
    Store.sendRemote();
    Flow.next();
  }

  return { wire, start, stop, relocalize };
})();
