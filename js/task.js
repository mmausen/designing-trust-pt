/* ═══════════════════════════════════════════════════════════════════
   TASK — the ranking interaction for one condition.

   Which mechanic runs is resolved per ROUND by Config.conditionFor(step): a
   "baseline" entry is always solo, and an "ai" entry names its own mechanic —
   every participant meets both, in the order their group fixes. `.ai` picks
   the mechanic:
     solo      — no assistance
     handoff   — shared cursor: the participant works normally, but while the
                 real cursor rests inside the activation zone the AI takes the
                 cursor and carries on. Leaving the zone hands it straight
                 back.
     hidden    — no cursor. That same block is a "Start AI" button; one press
                 and every step flies from wherever it sits to the slot the AI
                 chose, all at once, in one linear second.

   The two AI mechanics share a layout and a lifecycle on purpose: the same
   block under the board, the same review phase afterwards, the same footer
   line once the board is full. What differs is how control changes hands.

   The AI's suggestion always comes from `aiRanking`, which is the task's
   authored `ai-order` for this session's CHARACTER (bold / cautious).

   Nothing here scores a ranking. These tasks are priority judgements with no
   correct order, so the only ranking measure is `overrides` — how far the
   participant's final order departs from the AI's.

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
  let taskId, taskDef, planIndex, character, block;
  let handoff = false;      // shared-cursor stage: the AI takes over from the activation zone
  let hiddenAi = false;     // "Start AI" stage: one press places everything, no cursor
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
  let runId = 0;                // invalidates a stale cursor loop when the task changes

  // fake-cursor state (viewport coords); null outside a handoff stage
  let fc = null;
  let rafId = null, watchdog = null, prevTs = 0, lastStepTs = 0;
  let lastPointer = { x: 0, y: 0 };
  let pointerInZone = false;    // handoff: real cursor resting inside #ai-zone
  let zoneEl = null;

  // cached overlay elements (set in wire())
  let ghost, aiCursor;

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
    /* One block, read two ways — which one is live depends on the mechanic:
         handoff — an activation ZONE, governed by hover, not by idle time.
                   Cursor rests inside → the AI takes over; cursor leaves →
                   control back.
         hidden  — a BUTTON. The hover listeners still fire but nothing reads
                   `pointerInZone` outside a handoff stage, so they are inert. */
    if (zoneEl) {
      zoneEl.addEventListener("mouseenter", () => { pointerInZone = true; });
      zoneEl.addEventListener("mouseleave", () => {
        pointerInZone = false;
        if (handoff && fc && fc.active) autoHandBack();
      });
      zoneEl.addEventListener("click", () => { if (hiddenAi) startHiddenPlacement(); });
    }

    /* A tab hidden mid-flight throttles the landing timer AND freezes the
       clones' transition, so a participant who switches away and back would
       return to tiles hanging in mid-air over an invisible board. Land them
       the moment the page is visible again — the AI's placement is over, they
       simply weren't watching. Same reasoning as the cursor engine's watchdog:
       nothing in this prototype may depend on the tab staying in front. */
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && hiddenFlying) finishHiddenPlacement(runId);
    });
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

  /* The block's caption. In a hidden stage it is a button and always says the
     same thing; in a handoff stage it reflects whether the AI is driving. */
  function updateZoneLabel() {
    if (!zoneEl || zoneEl.hidden) return;
    const label = $("ai-zone-label");
    if (!label) return;
    label.textContent = hiddenAi
      ? I18n.t("ui.task.startAi")
      : I18n.t(fc && fc.active ? "ui.task.zone.active" : "ui.task.zone.idle");
  }

  /* ── start a condition ── */
  function start(step) {
    stop();                        // halt any cursor loop from the previous task
    stage = step.stage;            // "baseline" (solo, everyone) | "ai" (one of the two mechanics)
    taskId = step.taskId;
    planIndex = step.planIndex || 0;
    block = step.block || 0;       // which AI block this round belongs to (1 or 2)
    /* Character and group come off the SESSION, not the step: the dev picker
       can change the group between rounds, and re-entering this task
       (Flow.render) then picks the new setup up. The mechanic, by contrast,
       comes off the STEP — it is a property of the round now, not the session. */
    character = Store.character();
    group = Store.group();
    cond = Config.conditionFor(step);
    aiMode = cond.ai;
    handoff = (aiMode === "handoff");
    hiddenAi = (aiMode === "hidden");
    hcfg = resolveCursorCfg(cond);
    aiTakeovers = 0; userTakebacks = 0; aiPlacedCount = 0;
    taskDef = Tasks.get(taskId);

    cards = Tasks.inboxCardsFor(taskId, Config.SHUFFLE_SEED); // deterministic per task
    byId = Object.fromEntries(cards.map(c => [c.id, c]));
    aiRanking = (aiMode === "solo") ? [] : Tasks.aiRankingFor(taskId, character);
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
    resetColumns();                // the whole board starts from a clean, visible state
    /* Run the region-by-region intro ONLY on the round that teaches the board
       (task 1), and only when its onboarding will actually open. On a repeat of
       the same condition the tile never opens, so nothing would ever reveal the
       columns again and the participant would be left with nowhere to drop the
       steps. Every later round shows the whole board from the start. */
    if (cond.teachBoard && explainerSteps && newSection) focusBoardRegion(0);

    Store.log("task_start", {
      stage, group, condition: cond.key, aiMode, character, block,
      taskId, lang: I18n.get(),
      newSection, explainerAutoShown: newSection,
      inboxOrder: cards.map(c => c.id),
      aiSuggestion: [...aiRanking],
    });

    Flow.showScreen("screen-task");
    setupChrome();
    render();

    /* The explainer describes the INTERACTION, not the task, so it only opens
       by itself on the first round of a stage. A later round (a second task id
       in BASELINE_TASKS / TASK_BLOCKS) goes straight to work — re-reading the
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

  /* First round of its SECTION? A section is the baseline block, or one of
     the two AI blocks — so both mechanics get their own onboarding, and the
     second block introduces itself rather than arriving unexplained. Keyed on
     the mechanic rather than on `block`, so it stays right even if the two
     blocks were ever configured to run the same one.

     Compares against the PREVIOUS entry in the plan rather than remembering
     the last one, so it stays right after a resume or a dev skip. */
  function sectionKey(entry) {
    if (!entry) return null;
    return entry.stage === "ai" ? "ai:" + entry.mechanic : entry.stage;
  }
  function isNewSection(step) {
    const d = Store.get();
    const plan = (d && d.plan) || [];
    const prev = plan[(step.planIndex || 0) - 1];
    return !prev || sectionKey(prev) !== sectionKey(step);
  }

  // Halt the current task's AI cursor and clear every transient overlay.
  // Called by the dev Skip button and at the top of start().
  function stop() {
    runId++;
    closeExplainerNow();           // never leave a half-open explainer over the next stage
    resetColumns();                // never leave a column hidden across a Skip / task switch
    driveStop();
    stopHiddenPlacement();         // never let a flight land on the next task's board
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
  // I18n.opt() so a missing array comes back as null and renderExplainerBody
  // can report it, rather than t() rendering the key path into the tile.
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

  // Guaranteed-clean state: the whole board visible. Used at the top of every
  // start() and as a catch-all on Skip / task switch, so nothing is ever left
  // hidden by a half-finished onboarding sequence.
  function resetColumns() {
    const colLadder = $("col-ladder"), colInbox = $("col-inbox");
    if (colLadder) colLadder.classList.remove("col-pending-reveal");
    if (colInbox) colInbox.classList.remove("col-pending-reveal");
  }

  /* Task 1 only (cond.teachBoard). Its onboarding introduces the screen one
     region at a time, so while a step is up, the region it talks about is the
     only one showing — the task brief alone, then the inbox, then the ladder.
     (The brief is never hidden; it simply stands alone while both columns are.)

     The mapping is POSITIONAL: step 0 is the brief, step 1 the inbox, the last
     step the ladder — so c1's onboarding entries in strings.json have to stay
     in that order, in both languages. Extra steps stay on the ladder. */
  const BOARD_INTRO = ["brief", "inbox", "ladder"];

  function focusBoardRegion(stepIdx) {
    const region = BOARD_INTRO[Math.min(stepIdx, BOARD_INTRO.length - 1)];
    const colInbox = $("col-inbox"), colLadder = $("col-ladder");
    if (colInbox) colInbox.classList.toggle("col-pending-reveal", region !== "inbox");
    if (colLadder) colLadder.classList.toggle("col-pending-reveal", region !== "ladder");
  }

  /* Fill the tile in whichever of its two shapes applies, then animate it in.
     `auto` is the first showing of a stage; a reopen via the ⓘ button is not. */
  function renderExplainerBody(auto) {
    if (!explainerSteps) {
      // Every condition defines an onboarding array; missing one is a content
      // bug, so say so rather than opening an empty tile on a participant.
      console.error(`[BDR] conditions.${cond.key}.onboarding is missing — the explainer has nothing to show.`);
      return;
    }
    if (auto) {
      // First showing: walk the steps one at a time. On the board-teaching
      // round the column reveal moves with them (see explainerOk), which is
      // why this cannot just render the combined text.
      explainerAutoFlow = true;
      explainerStepIdx = 0;
      renderExplainerStep();
      return;
    }
    /* Reopened mid-task: show the full text as one window. The ladder is
       already visible and placements already exist, so re-running the
       step/reveal sequence would be disruptive. */
    explainerAutoFlow = false;
    const total = (Store.get().plan || []).length;
    $("explainer-title").textContent = I18n.t("ui.task.taskCounter", { n: planIndex + 1, total });
    $("explainer-body").textContent = explainerSteps.map(s => s.body).join(" ");
    $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
  }

  function showExplainer(auto) {
    renderExplainerBody(!!auto);

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
    // On the board-teaching round only, move the spotlight with it — each of
    // c1's steps points at a different region of the screen. The g1–g4
    // onboardings describe the AI, not the board, so they leave it alone.
    if (explainerSteps && explainerStepIdx < explainerSteps.length - 1) {
      explainerStepIdx++;
      if (cond.teachBoard) focusBoardRegion(explainerStepIdx);
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

    /* Task brief on top of the tile segment. The task supplies only its
       subject ("Transportation"); the instruction underneath is the same in
       every round — the task TYPE never varies, only its content — so it
       lives in strings.json rather than being repeated 13 times. */
    taskDef = Tasks.get(taskId);   // re-resolve: the active language may have changed
    $("task-title").textContent = taskDef ? (taskDef.title || "") : "";
    $("task-desc").textContent = I18n.t("ui.task.brief");

    /* An AI stage's footer line has two phases: sorting, and the review prompt
       once every step is placed. Resolved here (rather than only at the
       transition) so a language switch mid-stage picks the phase up correctly. */
    let hintText = I18n.t(`ui.task.hints.${aiMode}`);
    if (aiState === "done") hintText = I18n.t("ui.task.aiDone");
    $("hint").textContent = hintText;

    const badge = $("b-badge");
    const badgeTxt = (aiMode === "solo") ? null : I18n.t(`ui.task.badges.${aiMode}`);
    if (badgeTxt) { badge.hidden = false; badge.textContent = badgeTxt; }
    else badge.hidden = true;

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

    /* The AI control block: the handoff activation zone, or the hidden
       mechanic's "Start AI" button. Both mechanics retire it once the board is
       full — there is no more work to hand over — which is also why a hidden
       stage that has already run shows nothing here. */
    if (zoneEl) {
      const showZone = (handoff || hiddenAi) && aiState !== "done";
      zoneEl.hidden = !showZone;
      zoneEl.classList.toggle("ai-zone--btn", hiddenAi);
      zoneEl.disabled = hiddenAi && (hiddenPlaced || hiddenFlying);
      if (showZone) updateZoneLabel();
      else zoneEl.classList.remove("active");
    }

    $("btn-explainer").textContent = I18n.t("ui.task.explainerBtn");
    $("explainer-ok").textContent = I18n.t("ui.task.explainerOk");
    $("btn-confirm").textContent = I18n.t("ui.task.confirm");
    $("inbox-hd").textContent = I18n.t("ui.task.inboxHd", { n: inbox.length });
    $("ladder-hd").textContent = I18n.t("ui.task.ladderHd");
  }

  /* Re-render the whole task in the newly selected language. Safe at any
     moment: both language views share ids, tiles[].key and ai-order, so
     `cards`, `inbox`, `slots` and `aiRanking` stay valid — only text changes. */
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
    /* If the explainer is open, swap its text too — through the same renderer
       showExplainer uses, so the two can never drift. `explainerAutoFlow` says
       which shape is on screen, so a language switch mid-onboarding re-renders
       the step the participant is on rather than jumping to the combined text. */
    const overlay = $("explainer-overlay");
    if (overlay && !overlay.hidden) renderExplainerBody(explainerAutoFlow);
  }

  /* ── render ── */
  function render() {
    renderInbox();
    renderLadder();
    /* Mid-flight the real tiles are already sitting in their final slots —
       it is the clones on #fly-layer that are still travelling — so hide them
       until they land, and keep Confirm shut until the board is settled.
       Re-applied on every render so a language switch mid-flight (relocalize)
       cannot reveal them early. */
    if (hiddenFlying) {
      document.querySelectorAll("#ladder .card").forEach(el => el.classList.add("in-flight"));
    }
    $("btn-confirm").disabled = hiddenFlying || !slots.every(Boolean);
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
    /* Title plus the case description — a priority judgement needs the detail,
       not just the label. textContent throughout: task prose is authored
       content, never markup. */
    div.innerHTML = `<div class="card-txt">
        <div class="card-title"></div>
        <div class="card-desc"></div>
      </div>
      <div class="card-grip">⠿</div>`;
    div.querySelector(".card-title").textContent = card.title;
    div.querySelector(".card-desc").textContent = card.description || "";
    div.addEventListener("mousedown", onMouseDown);
    return div;
  }

  /* ── custom mouse drag ── */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (hiddenFlying) return;      // the tiles are in the air; nothing to grab yet
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
    if (firstActionAt == null) firstActionAt = performance.now();
    Store.log("drag_start", { cardId: drag.id, from: drag.from });
  }

  function clearSlotMarks() {
    document.querySelectorAll(".slot").forEach(s =>
      s.classList.remove("drop-target"));
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

  /* ═══ the hidden mechanic (G2) ════════════════════════════════════
     No cursor and no narration. The block under the board is a "Start AI"
     button; one press and every step travels from wherever it currently sits
     — inbox or ladder, already-sorted or not — to the slot the AI chose, all
     six at once, linearly, in Config.HIDDEN_PLACE_MS. The AI's whole visible
     contribution is that one second; everything after it is the participant's
     review, exactly as after a handoff.

     It runs ONCE per task. Like the handoff zone at autoFinish(), the button
     retires when the board is full: there is no more work to hand over, and a
     second press could only undo the participant's own corrections.

     ── why clones rather than the real tiles ──
     This is FLIP (measure, commit, measure, animate back), but it moves copies
     on #fly-layer instead of transforming the tiles in place. An inbox tile and
     a ladder tile are not the same WIDTH — they carry different left margins so
     both line up with the numbered slots — so a transform-only flight would pop
     to the destination width on the very first frame. The clones interpolate
     left/top/width together, which is not compositor-friendly but is six
     elements for one second. */
  let hiddenPlaced = false;   // the button has been pressed for this task
  let hiddenFlying = false;   // a flight is in the air: the board is frozen
  let hiddenTimer = null;     // landing callback

  // Viewport rects of the tiles matching `sel`, keyed by card id.
  function cardRects(sel) {
    const out = {};
    document.querySelectorAll(sel).forEach(el => { out[el.dataset.id] = el.getBoundingClientRect(); });
    return out;
  }

  // A copy of one tile, parked exactly over where the real one sits.
  function makeFlyClone(id, rect) {
    const el = document.createElement("div");
    el.className = "card fly-card";
    el.innerHTML = `<div class="card-txt"><div class="card-title"></div></div>
      <div class="card-grip">⠿</div>`;
    el.querySelector(".card-title").textContent = byId[id].title;
    el.style.left = rect.left + "px";
    el.style.top = rect.top + "px";
    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
    return el;
  }

  // Empty the flight layer and let every real tile be seen again.
  function clearFlyLayer() {
    const layer = $("fly-layer");
    if (layer) layer.innerHTML = "";
    document.querySelectorAll(".card.in-flight").forEach(el => el.classList.remove("in-flight"));
  }

  /* Abandon a flight without landing it — task switch, dev Skip. The board's
     model is already the AI's order by then (startHiddenPlacement commits it
     before the clones move), so there is nothing to roll back: the next
     start() rebuilds everything anyway. */
  function stopHiddenPlacement() {
    if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
    hiddenPlaced = false;
    hiddenFlying = false;
    clearFlyLayer();
  }

  function startHiddenPlacement() {
    if (!hiddenAi || hiddenPlaced || hiddenFlying || drag) return;
    const myRun = runId;
    hiddenPlaced = true;
    hiddenFlying = true;
    /* Pressing the button IS this participant's first move on the task, and it
       is also the moment they hand the work over — so it counts on both
       clocks, and aiTakeovers stays comparable with the handoff stages. */
    if (firstActionAt == null) firstActionAt = performance.now();
    aiTakeovers++;

    Store.log("hidden_started", {
      taskId, nth: aiTakeovers,
      before: [...slots],                        // what they had sorted themselves
      placedSoFar: slots.filter(Boolean).length,
      aiSuggestion: [...aiRanking],
    });

    // Where everything is now …
    const from = cardRects("#inbox .card, #ladder .card");

    // … commit the AI's order, and find out where everything landed.
    const order = [...aiRanking];
    slots = order;
    inbox = [];
    render();                                    // hides the real tiles: hiddenFlying is set
    const to = cardRects("#ladder .card");

    const layer = $("fly-layer");
    const clones = [];
    order.forEach((id, i) => {
      if (!id) return;
      aiPlacedCount++;
      Store.log("ai_placement", { cardId: id, slot: i });
      const a = from[id], b = to[id];
      const real = document.querySelector(`#ladder [data-id="${id}"]`);
      if (!a || !b) {
        // No geometry to fly between (shouldn't happen — all six tiles are
        // always on screen). Land it instantly rather than leaving it invisible.
        if (real) real.classList.remove("in-flight");
        return;
      }
      const clone = makeFlyClone(id, a);
      layer.appendChild(clone);
      clones.push({ clone, b });
    });

    // One reflow for the whole set, so every clone starts from its own rect
    // rather than from wherever the transition happened to be armed.
    void layer.offsetWidth;
    const dur = Config.HIDDEN_PLACE_MS;
    clones.forEach(({ clone, b }) => {
      clone.style.transition = `left ${dur}ms linear, top ${dur}ms linear, width ${dur}ms linear`;
      clone.style.left = b.left + "px";
      clone.style.top = b.top + "px";
      clone.style.width = b.width + "px";
    });

    /* One timer for the set rather than six transitionend listeners: each
       clone fires that event once per animated property, and a clone that has
       nowhere to travel (a step already in its AI slot) never fires it at all. */
    if (zoneEl) zoneEl.disabled = true;
    hiddenTimer = setTimeout(() => finishHiddenPlacement(myRun), dur + 40);
  }

  /* The tiles have landed: drop the clones, retire the button, open the review.
     Idempotent — two paths race to call it (the landing timer and the
     visibility catch in wire()), and calling it twice would re-stamp
     allPlacedAt and log a second hidden_done. */
  function finishHiddenPlacement(forRun) {
    if (forRun !== runId || !hiddenFlying) return;   // a newer task owns the board, or already landed
    if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
    hiddenFlying = false;
    clearFlyLayer();
    aiState = "done";
    if (zoneEl) { zoneEl.hidden = true; zoneEl.disabled = false; }
    $("hint").textContent = I18n.t("ui.task.aiDone");
    render();
    allPlacedAt = performance.now();
    Store.log("hidden_done", {
      taskId, slots: [...slots], placedByAi: aiPlacedCount, durationMs: Config.HIDDEN_PLACE_MS,
    });
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
        Store.log("ai_placement", { cardId: id, slot: s.slot });
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
    $("hint").textContent = I18n.t("ui.task.aiDone");
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
    Store.log("user_took_back", {
      taskId, nth: userTakebacks, placedSoFar: slots.filter(Boolean).length,
    });
    render();
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

  /* ── the one ranking measure left ──
     No score: these tasks have no correct order. `overrides` counts the steps
     the participant's final ranking places somewhere other than the AI put
     them — i.e. how far they departed from the recommendation. Null in a solo
     round, where there was no recommendation to depart from. */
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
      stage, group, condition: cond.key, aiMode, character, block,
      taskId, lang: I18n.get(),
      ranking: [...slots],
      aiSuggestion: [...aiRanking],   // what they were departing from, on the result itself
      overrides: countOverrides(),
      /* Shared-control behaviour. aiTakeovers counts every time the AI was
         handed the work — a zone entry in a handoff stage, the button press in
         a hidden one — so the two mechanics stay comparable; the rest is 0
         outside them. The cursor settings are null wherever no cursor runs,
         rather than reporting the speed of a cursor that never appeared. */
      aiTakeovers, userTakebacks, placedByAi: aiPlacedCount,
      cursorSpeed: (handoff && hcfg) ? hcfg.speed : null,
      cursorHesitate: (handoff && hcfg) ? !!hcfg.hesitate : null,
      ...timing,
    };
    Store.log("task_confirm", { stage, group, character, block, taskId, finalRanking: [...slots], ...timing });
    Store.addResult(result);
    hideCursor();
    // No per-task summary — go straight to the next stage.
    Store.sendRemote();
    Flow.next();
  }

  return { wire, start, stop, relocalize };
})();
