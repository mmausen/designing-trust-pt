/* ═══════════════════════════════════════════════════════════════════
   CONFIG — study settings: the baseline + the four AI groups, how many
   rounds each runs, and the flow knobs.
   Backend-agnostic: fill ENDPOINT_URL later (e.g. a Power Automate /
   OneDrive HTTP flow). While it is empty, data is saved locally only.
   ═══════════════════════════════════════════════════════════════════ */
window.Config = (function () {
  const CONFIG = {
    resumeEnabled: true,           // offer to resume an interrupted session from localStorage
    devMode: true,                 // show the bottom-right dev bar: the "Skip ▸" button that
                                   // jumps to the next stage, and the group picker that forces
                                   // this session into G1/G2. Prototyping aid only — MUST stay
                                   // false for real participants (a forced group is excluded
                                   // from the balancing counts, so a live run under devMode
                                   // would also quietly skew nothing but confuse everyone).
                                   //   The bar also carries the character picker (bold /
                                   //   cautious), which overrides CHARACTER below for the
                                   //   running session only.
    loggingEnabled: false,          // MASTER SWITCH for study logging. false → no events are
                                   //   recorded and NOTHING is written to logs/ (no POST, no
                                   //   beacon). The session itself still runs and still
                                   //   autosaves to localStorage, so resume keeps working.
                                   //   ↳ For dry runs and demos, so test traffic never lands
                                   //     in the participant data. MUST be true for real runs —
                                   //     with it off, a completed session leaves no file.
  };

  /* ═══ which steps the session runs ════════════════════════════════
     Every non-task step can be switched off, so a pilot, a demo or a
     lab-supervised run can skip the parts it does not need. The task rounds
     themselves are never optional — they are the study.

     Order when all are on:
       anonId → pre → [baseline] → [AI block 1]
         → mid → [AI block 2] → post → debrief

     The RESUME offer is independent of all of these: it has its own screen,
     shown ahead of whatever the first one would have been, whenever an
     interrupted session for this build is in localStorage.

     ⚠ Changing a switch INVALIDATES any session saved under the old set — the
     resume offer is refused with a console warning, because `currentStep`
     indexes the steps array whose shape these switches decide. Finish or
     discard a pilot session before flipping one. */
  const STEPS = {
    anonId:     true,   // ask for the anonymised ID the research team issued, and log it
    preSurvey:  false,   // questionnaire before the first task
    midSurvey:  false,   // questionnaire between the two AI blocks
    postSurvey: false,   // questionnaire after the last task
  };

  // Fixed seed for the per-task tile shuffle. Because it is constant, every
  // participant sees the SAME inbox order for a given task; because the task id
  // is mixed in, each task is shuffled differently. Change this string to
  // reshuffle every task reproducibly.
  const SHUFFLE_SEED = "bdr-dfki-2026";

  /* ═══ the AI's CHARACTER ═══════════════════════════════════════════
     Which of the two authored rankings the AI follows. Every task in
     tasks.json carries an `ai-order` for each character, so this switch
     changes WHAT the AI recommends in every round:

       "bold"      — "act quick and move forward". Decisive, efficient,
                     more willing to let a subtle concern through.
       "cautious"  — "better safe than sorry". Thorough and risk-averse,
                     more willing to spend attention on a low-risk case.

     One character is in force for a WHOLE SESSION, deliberately: the point is
     that a participant can build up a mental model of how this AI prioritises
     across rounds, which a per-round switch would destroy. It is not set here
     — each GROUP names its character (see below), and the session pins it at
     creation. This list exists to validate that name.

     The character drives TWO things:
       · WHAT the AI recommends — the task's `ai-order` for this character.
       · HOW its cursor moves — a motion profile in cursors.json, tuned in the
         Cursor Gym (moveMe/gym) and applied by js/cursor.js. Bold and
         cautious differ in velocity profile, hesitation, curvature and
         restlessness, not only in the order they hand you.

     The motion half is visible in the HANDOFF mechanic only. The hidden one
     shows an outcome, not a process: six tiles fly at one constant speed with
     no cursor at all (HIDDEN_PLACE_MS). That difference is deliberate — it is
     most of what separates the two mechanics. */
  const CHARACTERS = ["bold", "cautious"];

  function isCharacter(c) { return CHARACTERS.indexOf(c) !== -1; }

  // Collector endpoint. The session JSON is POSTed here at each step boundary
  // (see store.js). "/collect-logs" is the local Node collector in server.js,
  // which writes ./logs — same origin, so no CORS and the response is readable.
  // Set "" to disable server-side saving entirely (localStorage only), or an
  // absolute URL to point at a hosted collector later.
  const ENDPOINT_URL = "/collect-logs";

  /* ═══ which setup this build runs ═════════════════════════════════
     ONE of the four setups below (G1–G4), fixed here and used by every
     participant this build serves. Set it before each batch of sessions and
     redeploy; the value is pinned onto each session at creation, so editing
     it can never retroactively change a run already in progress.

     There is no automatic assignment any more. The prototype used to ask the
     server for the least-used group and balance the four cells by itself
     (POST /assign-group, a ledger in logs/groups.json, a reservation window
     for sessions still in flight). That was removed on 2026-09-09: groups are
     now assigned by hand, outside the prototype, and a balancer that quietly
     disagreed with a hand-picked assignment would be worse than none.

     Balance is therefore YOURS to keep. Nothing here counts how many
     participants have run under a setup, and nothing warns when the cells go
     uneven — `group` on each session is the record to count.

     The dev picker still overrides this per session for testing; such
     sessions are marked groupSource "dev". */
  const FIXED_GROUP = "G1";

  /* ═══ the AI cursor is NOT configured here ════════════════════════
     There is deliberately nothing in this file that touches how the handoff
     cursor moves. All of it — pace (`travel`), the wait after a placement
     (`afterPlace`), hesitation, curvature, restlessness — is the session's
     character, in cursors.json. What is left in js/cursor.js is the shared
     baseline: the two dwells, the beat between cases, and the coefficients
     that decide what each dial's 0…1 MEANS. Those are shared by both
     characters by design, so none of them can separate bold from cautious.

     An AI_CURSOR block used to sit here with a `pauseAfterPlaceMs` of 400 ms.
     It was removed on 2026-09-08: it paced the cursor 4× slower between cases
     than the gym's own 90 ms beat, so what you tuned was not what the
     participant saw — and being overridable per group, it could have given the
     two characters different rhythms without that being visible in cursors.json.
     Do not reintroduce a knob here. If the pacing is wrong, it is wrong in the
     gym too: fix it there and re-export. */

  /* ═══ what the AI does about a slot the participant already filled ══
     Only reachable in the HANDOFF mechanic, and only once the participant
     has placed something themselves. The hidden mechanic commits a whole
     ranking in one press, so it always overrides — there is no per-case
     decision to make.

       "A"  Override. The AI places its case in the slot it wants and the
            case sitting there goes back to the inbox. Its ranking always
            comes out intact; the participant's work can be undone.

       "B"  Defer. The AI skips any case whose slot is taken, keeps going
            down its ranking, and finishes once nothing is left that it can
            place without overriding. It never undoes the participant, and
            the board may be left part-empty for them to finish.

       "C"  Defer, then override. Style B's pass first, so everything that
            fits alongside the participant lands first — then it goes back
            and takes the contested slots anyway, filling the board.

     A and C both end with the AI's full ranking on the board; they differ
     in the ORDER the participant watches it happen, which is the point.
     B is the only one that leaves the participant's placements standing.

     This is a placement POLICY, not cursor motion — how the cursor moves is
     the character, in cursors.json. Both characters use whichever style is
     set here; it is not part of a setup (G1–G4). */
  const PLACEMENT_STYLES = ["A", "B", "C"];
  const PLACEMENT_STYLE = "A";

  function isPlacementStyle(v) { return PLACEMENT_STYLES.indexOf(v) !== -1; }

  /* ═══ study design: unassisted baseline, then ONE AI mechanic ══════
     Every participant runs the unassisted baseline rounds first, then both
     AI mechanics in the order their setup fixes. Which setup they run is
     FIXED_GROUP above — set by hand, not drawn.

     One switch describes every group:

       `ai` — the mechanic
         solo      — no assistance at all
         handoff   — shared cursor: the participant works normally, but while
                     the real cursor rests inside the activation zone the AI
                     takes the cursor and carries on. Leaving the zone hands
                     control straight back.
         hidden    — no cursor at all. The activation zone is a "Start AI"
                     button instead; one press and every step flies from
                     wherever it sits to the slot the AI chose, all at once
                     (see HIDDEN_PLACE_MS). The participant can then rearrange
                     anything before confirming, exactly as after a handoff.

     The AI never explains itself: no reasoning panel, no narration. What it
     recommends is set by the group's CHARACTER, and nothing tells the
     participant why.

     Label / banner / onboarding text lives in strings.json under
     conditions.<key>, in both languages — e.g. conditions.handoff.onboarding,
     a REQUIRED array of { body, ok } steps shown one at a time when the
     participant first reaches that stage. Both mechanics run the same
     three-step shape — what the AI does, how it works, who decides — so the
     wording differs only where the condition itself does.
     The onboardings deliberately never mention that the AI can be wrong, but
     always make clear the final order is the participant's responsibility. */

  /* The unassisted baseline rounds. Everyone does these, with no AI at all.
     `teachBoard` marks the stage that introduces the BOARD itself: its
     onboarding hides the ladder column and reveals it as the participant steps
     through the tile. Only ever true for the baseline — by the AI rounds the
     board is familiar, and hiding it again would be nonsense. */
  const BASELINE = { key: "c1", ai: "solo", teachBoard: true };

  /* The two AI mechanics. These are the INTERACTIONS — what a round feels
     like — and every participant now meets both, so they are no longer groups.
     `key` is their strings.json entry (conditions.<key>: banner + onboarding),
     in both languages. */
  const MECHANICS = {
    handoff: { key: "handoff", ai: "handoff" },
    hidden:  { key: "hidden",  ai: "hidden" },
  };

  /* ═══ the four session setups ═════════════════════════════════════
     MIXED design. Each setup fixes two things for a whole session:

       `character` — BETWEEN subjects. The AI's strategy, unchanging all
                     session, so the participant can build a mental model of it.
       `order`     — the sequence of the two mechanics, WITHIN subjects. Every
                     participant meets both; the order is counterbalanced so
                     "second block" effects (practice, fatigue, having already
                     seen an AI act) don't load onto one mechanic.

     Crossing them gives exactly four cells. Which one this build runs is
     FIXED_GROUP above; character and order are not set separately, because a
     setup is one decision and the session pins both halves of it together.

     Counterbalancing is now a manual job: nothing here spreads participants
     across the four, so keep the tally yourself and change FIXED_GROUP
     between batches. */
  const GROUPS = {
    G1: { character: "bold",     order: ["hidden", "handoff"] },
    G2: { character: "bold",     order: ["handoff", "hidden"] },
    G3: { character: "cautious", order: ["hidden", "handoff"] },
    G4: { character: "cautious", order: ["handoff", "hidden"] },
  };
  const GROUP_KEYS = Object.keys(GROUPS);

  // The character a group runs, falling back to the first group so a session
  // can never end up with no character and therefore no AI suggestion.
  function characterFor(group) {
    const g = GROUPS[group] || GROUPS[GROUP_KEYS[0]];
    return g.character;
  }
  // The mechanic sequence a group runs, same fallback.
  function orderFor(group) {
    const g = GROUPS[group] || GROUPS[GROUP_KEYS[0]];
    return [...g.order];
  }

  /* How long the hidden mechanic's tiles take to fly to their slots, in ms.
     One linear, constant-speed run for all six at once — a study parameter
     (it is the whole visible extent of the interaction), so it lives here. */
  const HIDDEN_PLACE_MS = 1000;

  /* ═══ which tasks run where ════════════════════════════════════════
     One entry = one round, in the order listed. Values are task ids from
     tasks.json (T1–T13). This is the rounds knob: trim a list to shorten a
     pilot, extend it to add rounds.

     BASELINE_TASKS runs first, unassisted, for everyone. The two AI blocks
     then run in the order TASK_BLOCKS lists them.

     ── the task order is the same for every group ──────────────────
     TASK_BLOCKS is an ARRAY, not a map, because its order IS the running
     order: block [0] always runs first and block [1] second, in every one of
     the four setups. So the sequence of tasks a participant meets —
     T1…T3, then T4…T8, then T9…T13 — is identical whatever group they drew.

     What the group counterbalances is only WHICH MECHANIC sits on each block
     (see GROUPS). That is the whole point of the four setups: every block of
     tasks meets BOTH mechanics across participants, so a content effect can
     never be mistaken for a mechanic effect. Nothing here may be made to
     depend on the group — a mechanic that dragged its tasks along with it
     would tie content permanently to behaviour and confound the two.

     Each round still records its `taskBlock` name, so the analysis never has
     to re-derive which content set it came from. */
  const BASELINE_TASKS = ["T1", "T2", "T3"];

  const TASK_BLOCKS = [
    { name: "blockA", tasks: ["T4", "T5", "T6", "T7", "T8"] },
    { name: "blockB", tasks: ["T9", "T10", "T11", "T12", "T13"] },
  ];

  /* The study plan marks T6 and T11 as the tasks whose AI recommendation is
     questionable — one in each block above, so a participant meets one under
     each mechanic whichever way their group orders the two. There is no per-round error
     flag: with no correct order there is nothing to swap away from, so a
     questionable recommendation is authored into that task's `ai-order`.

     The explainer opens by itself on the first round of each BLOCK, since it
     describes the interaction rather than the task: later rounds in the same
     block go straight to work, and the second block opens with its own
     onboarding for the mechanic it introduces. The ⓘ button reopens it. */

  /* Expand the lists into a flat plan for ONE group:
       [{ stage:"baseline", taskId },
        { stage:"ai", mechanic, block:1, taskBlock, taskId }, …
        { stage:"ai", mechanic, block:2, taskBlock, taskId }, …]

     The TASKS do not depend on the group: block i is TASK_BLOCKS[i] for
     everyone. Only the MECHANIC on each block comes from the group, which is
     why this takes one at all — Store.newSession builds the plan once the
     draw is in and pins it onto the session. `block` (1 or 2) is the POSITION
     and is what tells the two AI sections apart for the onboarding;
     `taskBlock` is the content set's name; `mechanic` is what each round
     resolves its interaction through (see conditionFor). */
  function buildTaskPlan(group) {
    const plan = BASELINE_TASKS.map(taskId => ({ stage: "baseline", taskId }));
    orderFor(group).forEach((mechanic, i) => {
      const set = TASK_BLOCKS[i];
      if (!set) return;               // fewer blocks listed than mechanics ordered
      set.tasks.forEach(taskId =>
        plan.push({ stage: "ai", mechanic, block: i + 1, taskBlock: set.name, taskId }));
    });
    return plan;
  }

  function isGroup(g) { return Object.prototype.hasOwnProperty.call(GROUPS, g); }

  /* Which interaction one plan entry runs. Baseline entries are always solo;
     an AI entry names its own mechanic, so this no longer consults the group —
     the group's only job was to decide the ORDER, and buildTaskPlan already
     spent it. Falls back to the first mechanic if an entry somehow names none,
     so a round can never fail to render. */
  function conditionFor(step) {
    if (!step || step.stage !== "ai") return BASELINE;
    return MECHANICS[step.mechanic] || MECHANICS[Object.keys(MECHANICS)[0]];
  }

  // Surveys live in strings.json (surveys.pre / surveys.post), in both
  // languages, so the questionnaire can be edited without touching code.
  // Supported types: "likert" (1–5 radios) and "text" (free text).
  // Question ids are DATA KEYS — keep them identical across languages.

  /* Everything, including the settings no code reads back. This is the study's
     settings surface: BASELINE, BASELINE_TASKS and TASK_BLOCKS are spent inside
     buildTaskPlan and conditionFor and never fetched from outside, but they are
     what a run IS, so they stay readable from the console alongside the rest. */
  return {
    CONFIG, STEPS, ENDPOINT_URL, SHUFFLE_SEED,
    HIDDEN_PLACE_MS, CHARACTERS, isCharacter,
    FIXED_GROUP, BASELINE, MECHANICS, GROUPS, GROUP_KEYS,
    PLACEMENT_STYLE, PLACEMENT_STYLES, isPlacementStyle,
    BASELINE_TASKS, TASK_BLOCKS,
    buildTaskPlan, conditionFor, isGroup, characterFor, orderFor,
  };
})();
