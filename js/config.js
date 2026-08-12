/* ═══════════════════════════════════════════════════════════════════
   CONFIG — study settings: the baseline + the four AI groups, how many
   rounds each runs, and the flow knobs.
   Backend-agnostic: fill ENDPOINT_URL later (e.g. a Power Automate /
   OneDrive HTTP flow). While it is empty, data is saved locally only.
   ═══════════════════════════════════════════════════════════════════ */
window.Config = (function () {
  const CONFIG = {
    showCorrectnessFeedback: true, // show ✓/✗ + "correct order" on the debrief grid.
                                   //   ↳ RECOMMEND setting FALSE for the real study to avoid
                                   //     a learning confound (participants memorising the answer).
    resumeEnabled: true,           // offer to resume an interrupted session from localStorage
    devMode: true,                 // show the bottom-right dev bar: the "Skip ▸" button that
                                   // jumps to the next stage, and the group picker that forces
                                   // this session into G1–G4. Prototyping aid only — MUST stay
                                   // false for real participants (a forced group is excluded
                                   // from the balancing counts, so a live run under devMode
                                   // would also quietly skew nothing but confuse everyone).
    loggingEnabled: true,          // MASTER SWITCH for study logging. false → no events are
                                   //   recorded and NOTHING is written to logs/ (no POST, no
                                   //   beacon). The session itself still runs and still
                                   //   autosaves to localStorage, so resume keeps working.
                                   //   ↳ For dry runs and demos, so test traffic never lands
                                   //     in the participant data. MUST be true for real runs —
                                   //     with it off, a completed session leaves no file.
  };

  // Fixed seed for the per-task tile shuffle. Because it is constant, every
  // participant sees the SAME inbox order for a given task; because the task id
  // is mixed in, each task is shuffled differently. Change this string to
  // reshuffle every task reproducibly.
  const SHUFFLE_SEED = "bdr-dfki-2026";

  // Collector endpoint. The session JSON is POSTed here at each step boundary
  // (see store.js). "/collect-logs" is the local Node collector in server.js,
  // which writes ./logs — same origin, so no CORS and the response is readable.
  // Set "" to disable server-side saving entirely (localStorage only), or an
  // absolute URL to point at a hosted collector later.
  const ENDPOINT_URL = "/collect-logs";

  /* Group assignment endpoint (server.js → /assign-group). The server keeps
     the global tally and hands back the least-used group, so four unattended
     participants spread evenly instead of four coin flips landing on G2.
     Set "" to disable the draw entirely — every participant is then assigned
     a group at random in the browser, which balances only in the long run.

     NOTE: this is the ONLY part of the study that needs a live server of our
     own. If the collector is ever moved to a Power-Automate / OneDrive flow,
     this endpoint has to move with it, or balancing silently degrades to the
     local random fallback (visible in the data as groupSource: "local"). */
  const ASSIGN_URL = "/assign-group";
  const ASSIGN_TIMEOUT_MS = 4000;   // never leave a participant staring at a dead Begin button

  /* AI cursor behaviour for the "handoff" mechanic (G1/G2).
     These are study parameters, so they live here rather than in task.js.
     Any group may override a value inline, e.g.
         G1: { key: "g1", ai: "handoff", speed: 40, hesitate: true } */
  const AI_CURSOR = {
    speed: 28,              // 0–100 → cursor travel speed
    hesitate: false,        // thinking pauses + second-guess approach curves
    idleMs: 1000,           // NO LONGER DRIVES ANYTHING. Handoff takeover moved to the
                            //   hover activation zone (#ai-zone) — the cursor resting
                            //   inside is what hands control over, not idle time. Kept
                            //   only because it is still written to the logs; delete
                            //   both once no analysis depends on the field.
                            //
                            // (There was also a startGraceMs "reading window" here that
                            //  held the AI back for the first few seconds of a stage. The
                            //  activation zone made it redundant — nothing moves until the
                            //  participant parks the cursor in the zone, so they read the
                            //  task in their own time — and it was removed 2026-08-12.)
    userSpeedControl: true, // show the PARTICIPANT a speed slider.
                            //   ↳ Good for accessibility (fast cursor motion is
                            //     disorienting for some people), but it makes AI speed
                            //     a participant-controlled variable: timing stops being
                            //     comparable across people and it may interact with
                            //     perceived agency. Every change is logged
                            //     (ai_speed_changed). Consider false for the real study.
  };

  /* ═══ study design: one baseline task, then ONE AI group ═══════════
     Between-subjects. Every participant runs the same unassisted baseline
     (task 1, ground truth), then exactly one of the four AI interactions
     (task 2). Which one is decided by the balanced draw — see ASSIGN_URL.

     `ai` picks the mechanic:
       solo      — no assistance at all
       hint      — the AI suggests where a step goes; `hint` names WHICH
                   design does the suggesting (see below)
       handoff   — shared cursor: the participant works normally, but while
                   the real cursor rests inside the activation zone the AI
                   takes the cursor and carries on. Leaving the zone hands
                   control straight back. `thoughts: true` adds the panel
                   where it narrates what it is about to do.

     For ai:"hint", `hint` selects a variant registered in js/hints.js:
       "slot"            — highlight the suggested slot            (js/hint_slot.js)
       "slot-reasoning"  — that, plus the AI's stated reasoning     (js/hint_slot_reasoning.js)
     Each variant is one file, referenced nowhere else, so dropping one
     leaves nothing behind.

     Label / banner / explainer text lives in strings.json under
     conditions.<key>, in both languages — e.g. I18n.t("conditions.g1.explainer").
     The explainers deliberately never mention that the AI can be wrong, but
     always make clear the final order is the participant's responsibility. */

  // Task 1 — the unassisted ground-truth run. Everyone does this one.
  const BASELINE = { key: "c1", ai: "solo" };

  // Task 2 — the four AI groups. Exactly one per participant.
  const GROUPS = {
    G1: { key: "g1", ai: "handoff" },
    G2: { key: "g2", ai: "handoff", thoughts: true },
    G3: { key: "g3", ai: "hint", hint: "slot" },
    G4: { key: "g4", ai: "hint", hint: "slot-reasoning" },
  };
  const GROUP_KEYS = Object.keys(GROUPS);

  /* How many ROUNDS each stage runs, and on which task.
     One entry = one round, in the order listed. Values are task ids from
     task_thought.json (A01–A30). All groups run the SAME task-2 ids, so the
     only thing that differs between groups is the AI mechanic.

     Two forms per entry:
       "A01"                        → the AI suggests the CORRECT order
       { id: "A01", aiError: true } → the AI suggests a WRONG order

     With aiError, the task's own scriptedError.swapKeys pair (defined in the
     task file, with a rationale + wrongThought) is swapped in the AI's
     suggestion — a plausible but objectively wrong recommendation, to observe
     whether the participant catches it. Scoring is NOT affected: the original
     tile order stays the ground truth, so following the bad suggestion costs
     2 points and is logged as 0 overrides on those two tiles.

     aiError has no effect on the baseline rounds — solo shows no suggestion.

     The explainer opens by itself only on the FIRST round of a stage, since it
     describes the interaction rather than the task: later rounds go straight
     to work. The ⓘ button reopens it at any time. */
  const BASELINE_TASKS = ["A01"];
  const GROUP_TASKS = ["A02"];

  // Normalise one task entry into { taskId, aiError }.
  function normalizeTaskEntry(entry) {
    if (typeof entry === "string") return { taskId: entry, aiError: false };
    return { taskId: entry.id, aiError: !!entry.aiError };
  }

  /* Expand the two lists into a flat plan of { stage, taskId, aiError }.
     The plan deliberately does NOT name the group: the group lives on the
     session (Store), so the dev picker can switch it mid-run without the plan
     and the flow having to be rebuilt. Task.start resolves stage + session
     group into an interaction via conditionFor(). */
  function buildTaskPlan() {
    const plan = [];
    BASELINE_TASKS.forEach(entry => {
      const { taskId, aiError } = normalizeTaskEntry(entry);
      plan.push({ stage: "baseline", taskId, aiError });
    });
    GROUP_TASKS.forEach(entry => {
      const { taskId, aiError } = normalizeTaskEntry(entry);
      plan.push({ stage: "ai", taskId, aiError });
    });
    return plan;
  }

  function isGroup(g) { return Object.prototype.hasOwnProperty.call(GROUPS, g); }

  /* Which interaction a plan stage runs. Baseline stages ignore the group
     entirely; AI stages fall back to the first group if the session somehow
     carries none, so a task can never fail to render. */
  function conditionFor(step, group) {
    if (!step || step.stage !== "ai") return BASELINE;
    return GROUPS[group] || GROUPS[GROUP_KEYS[0]];
  }

  // Surveys live in strings.json (surveys.pre / surveys.post), in both
  // languages, so the questionnaire can be edited without touching code.
  // Supported types: "likert" (1–5 radios) and "text" (free text).
  // Question ids are DATA KEYS — keep them identical across languages.

  return {
    CONFIG, ENDPOINT_URL, ASSIGN_URL, ASSIGN_TIMEOUT_MS, SHUFFLE_SEED, AI_CURSOR,
    BASELINE, GROUPS, GROUP_KEYS, BASELINE_TASKS, GROUP_TASKS,
    buildTaskPlan, conditionFor, isGroup,
  };
})();
