/* ═══════════════════════════════════════════════════════════════════
   CONFIG — study settings, conditions, flow knobs, placeholder surveys.
   Backend-agnostic: fill ENDPOINT_URL later (e.g. a Power Automate /
   OneDrive HTTP flow). While it is empty, data is saved locally only.
   ═══════════════════════════════════════════════════════════════════ */
window.Config = (function () {
  const CONFIG = {
    showCorrectnessFeedback: true, // show ✓/✗ + "correct order" on the debrief grid.
                                   //   ↳ RECOMMEND setting FALSE for the real study to avoid
                                   //     a learning confound (participants memorising the answer).
    resumeEnabled: true,           // offer to resume an interrupted session from localStorage
    devSkip: true,                 // show the bottom-right "Skip ▸" button that jumps to the
                                   // next stage. Prototyping aid only — MUST stay false for
                                   // real participants. Set true to test a later stage quickly.
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

  /* AI cursor behaviour, shared by the "handoff" and "autopilot" mechanics.
     These are study parameters, so they live here rather than in task.js.
     Any condition may override a value inline, e.g.
         3: { key: "c3", ai: "handoff", speed: 40, hesitate: true } */
  const AI_CURSOR = {
    speed: 28,              // 0–100 → cursor travel speed
    hesitate: false,        // thinking pauses + second-guess approach curves
    idleMs: 1000,           // handoff only: no input for this long → the AI steps in
    firstIdleMs: 5000,      // handoff only: idle threshold used for the AI's very FIRST
                            //   activation in a stage (subsequent activations in the same
                            //   stage use idleMs). Longer on purpose — gives the participant
                            //   a moment to read the task/inbox before the AI ever moves.
    userSpeedControl: true, // show the PARTICIPANT a speed slider.
                            //   ↳ Good for accessibility (fast cursor motion is
                            //     disorienting for some people), but it makes AI speed
                            //     a participant-controlled variable: timing stops being
                            //     comparable across people and it may interact with
                            //     perceived agency. Every change is logged
                            //     (ai_speed_changed). Consider false for the real study.
  };

  // The four study conditions. `ai` drives the interaction mechanic:
  //   solo      — no assistance at all
  //   hint      — the AI suggests where a step goes; `hint` names WHICH
  //               design does the suggesting (see below)
  //   handoff   — shared cursor: the participant works normally, but after
  //               AI_CURSOR.idleMs of no input the AI takes the cursor and
  //               carries on. Any input hands control straight back.
  //               Add `thoughts: true` to show the AI's reasoning while it acts.
  //   autopilot — the AI places every step itself while the participant watches
  //
  // For ai:"hint", `hint` selects a variant registered in js/hints.js:
  //   "slot"            — highlight the suggested slot            (js/hint_slot.js)
  //   "slot-reasoning"  — that, plus the AI's stated reasoning     (js/hint_slot_reasoning.js)
  // Swap the value to A/B a different design; each variant is one file and
  // is referenced nowhere else, so dropping one leaves nothing behind.
  //
  // Their label / banner / explainer text lives in strings.json under
  // conditions.<key>, in both languages — look it up via I18n, e.g.
  // I18n.t("conditions.c2.explainer"). The explainers deliberately never
  // mention that the AI can be wrong, but always make clear the final order
  // is the participant's responsibility.
  // Design B (active): shared cursor. Swap the two commented lines back in to
  // A/B against design A, the pick-up hints — both designs stay fully working.
  const CONDITIONS = {
    1: { key: "c1", ai: "solo" },
    2: { key: "c2", ai: "handoff" },                    // A: { ai: "hint", hint: "slot" }
    3: { key: "c3", ai: "handoff", thoughts: true },    // A: { ai: "hint", hint: "slot-reasoning" }
    4: { key: "c4", ai: "autopilot" },
  };

  const BASE_ORDER = [1, 2, 3, 4];
  function buildOrder() { return [...BASE_ORDER]; }

  // Which task(s) each condition runs. Values are task ids from
  // the task files (e.g. "A01"). List MORE THAN ONE id to repeat that
  // condition's stage once per id (e.g. 1: ["A01", "A07"] → condition 1 runs
  // twice, first with A01 then with A07). Order within the list is kept.
  //
  // Two forms per entry:
  //   "A01"                      → the AI suggests the CORRECT order
  //   { id: "A01", aiError: true } → the AI suggests a WRONG order
  //
  // With aiError, the task's own scriptedError.swapKeys pair (defined in
  // the task files, with a rationale + wrongThought) is swapped in the AI's
  // suggestion — a plausible but objectively wrong recommendation, to observe
  // whether the participant catches it. Scoring is NOT affected: the original
  // tile order stays the ground truth, so following the bad suggestion costs
  // 2 points and is logged as 0 overrides on those two tiles.
  //
  // No effect on "solo" conditions — they show no AI suggestion at all.
  const CONDITION_TASKS = {
    1: ["A01"],
    2: ["A02"],
    3: [{ id: "A03", aiError: true }],
    4: ["A04"],
  };


  // Normalise one CONDITION_TASKS entry into { taskId, aiError }.
  function normalizeTaskEntry(entry) {
    if (typeof entry === "string") return { taskId: entry, aiError: false };
    return { taskId: entry.id, aiError: !!entry.aiError };
  }

  // Expand the conditions (in their counterbalanced order) into a flat plan of
  // { level, taskId, aiError } stages, repeating a condition once per entry.
  function buildTaskPlan() {
    const plan = [];
    buildOrder().forEach(level => {
      (CONDITION_TASKS[level] || []).forEach(entry => {
        const { taskId, aiError } = normalizeTaskEntry(entry);
        plan.push({ level, taskId, aiError });
      });
    });
    return plan;
  }

  // Surveys live in strings.json (surveys.pre / surveys.post), in both
  // languages, so the questionnaire can be edited without touching code.
  // Supported types: "likert" (1–5 radios) and "text" (free text).
  // Question ids are DATA KEYS — keep them identical across languages.

  return { CONFIG, ENDPOINT_URL, SHUFFLE_SEED, AI_CURSOR, CONDITIONS, buildOrder, CONDITION_TASKS, buildTaskPlan };
})();
