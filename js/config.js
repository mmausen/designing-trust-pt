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
    speed: 28,              // 0–100 → cursor travel speed (57.5–800 px/s)
    pauseAfterPlaceMs: 1000, // the cursor sits still for this long after dropping each
                            //   step, before it goes for the next one — a beat to take in
                            //   what just happened rather than a continuous sweep.
                            //   Applies whether or not `hesitate` is on, and replaces the
                            //   short random beat that used to sit there.
                            //   0 = sort straight through with no rest.
    hesitate: false,        // thinking pauses + second-guess approach curves
    userSpeedControl: false, // show the PARTICIPANT a speed slider. OFF for the study:
                            //   it makes AI speed a participant-controlled variable, so
                            //   timing stops being comparable across people and it may
                            //   interact with perceived agency. Set true if a pilot needs
                            //   it (fast cursor motion is disorienting for some people);
                            //   every change is logged as ai_speed_changed, and the value
                            //   in force is on each result as cursorSpeed either way.
  };

  /* ═══ study design: one baseline task, then ONE AI group ═══════════
     Between-subjects. Every participant runs the same unassisted baseline
     (task 1, ground truth), then exactly one of the four AI interactions
     (task 2). Which one is decided by the balanced draw — see ASSIGN_URL.

     Two switches describe every group, and they are the study's two factors:

       `ai` — the mechanic
         solo      — no assistance at all
         hint      — the AI suggests where a step goes, at pick-up time
         handoff   — shared cursor: the participant works normally, but while
                     the real cursor rests inside the activation zone the AI
                     takes the cursor and carries on. Leaving the zone hands
                     control straight back.

       `thoughts` — does the AI explain itself? The SAME switch in both
         mechanics, which is what makes G1:G2 and G3:G4 the same comparison:
           handoff + thoughts → the panel above the board narrates what it is
                                about to do
           hint    + thoughts → the suggested slot comes with the AI's stated
                                reasoning
         The two render differently because the mechanics differ, not because
         the manipulation does.

     Which hint DESIGN implements that is resolved by hintVariantFor() below,
     so the table never names a file. Variants are registered in js/hints.js:
       "slot"            — highlight the suggested slot            (js/hint_slot.js)
       "slot-reasoning"  — that, plus the AI's stated reasoning     (js/hint_slot_reasoning.js)
     Each variant is one file, referenced nowhere else, so dropping one
     leaves nothing behind.

     Label / banner / onboarding text lives in strings.json under
     conditions.<key>, in both languages — e.g. conditions.g1.onboarding, an
     array of { body, ok } steps shown one at a time when the participant first
     reaches that stage (a condition may instead define a single `explainer`
     paragraph, shown as one window). All four groups run the same three-step
     shape — what the AI does, how it works, who decides — so the wording
     differs only where the condition itself does.
     The onboardings deliberately never mention that the AI can be wrong, but
     always make clear the final order is the participant's responsibility. */

  /* Task 1 — the unassisted ground-truth run. Everyone does this one.
     `teachBoard` marks it as the round that introduces the BOARD itself: its
     onboarding hides the ladder column and reveals it as the participant steps
     through the tile. Only ever true for the very first task — by task 2 the
     board is familiar, and hiding it again would be nonsense. */
  const BASELINE = { key: "c1", ai: "solo", teachBoard: true };

  // Task 2 — the four AI groups. Exactly one per participant.
  // Read down the `thoughts` column and the 2×2 is the design: mechanic
  // (handoff / hint) × explanation (off / on).
  const GROUPS = {
    G1: { key: "g1", ai: "handoff" },
    G2: { key: "g2", ai: "handoff", thoughts: true },
    G3: { key: "g3", ai: "hint" },
    G4: { key: "g4", ai: "hint", thoughts: true },
  };
  const GROUP_KEYS = Object.keys(GROUPS);

  /* Which hint design a hint group runs. `thoughts` decides it, so the table
     above states the manipulation rather than a filename — the two hint
     variants ARE the explanation switch, one with reasoning and one without.
     A group may still pin a design explicitly with `hint: "<name>"`, which is
     how a third variant would be A/B'd without disturbing the table. */
  function hintVariantFor(cond) {
    if (!cond || cond.ai !== "hint") return null;
    return cond.hint || (cond.thoughts ? "slot-reasoning" : "slot");
  }

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
    buildTaskPlan, conditionFor, isGroup, hintVariantFor,
  };
})();
