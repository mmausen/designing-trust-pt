/* ═══════════════════════════════════════════════════════════════════
   FLOW — the step machine. One linear sequence:
     prolificId → pre-survey → [baseline rounds] → [AI block 1]
       → mid-survey → [AI block 2] → post-survey → debrief

   Every non-task step is optional — Config.STEPS switches each on or off, and
   build() simply leaves the disabled ones out. The task rounds are never
   optional. Both AI blocks run for every participant; which mechanic is in
   which block is the group's counterbalance (Config.GROUPS).

   Surveys are ordinary steps. A task advances the flow itself: Task.confirm
   calls Flow.next() when the participant confirms a ranking.
   ═══════════════════════════════════════════════════════════════════ */
window.Flow = (function () {
  let steps = [];
  let i = 0;

  // Build the sequence from the (already-created/restored) session plan.
  function build() {
    const plan = Store.get().plan || [];
    const S = Config.STEPS;
    steps = [];

    if (S.prolificId) steps.push({ type: "prolific" });
    if (S.preSurvey) steps.push({ type: "survey", id: "pre" });

    plan.forEach((p, idx) => {
      /* The mid-survey sits on the seam between the two AI blocks — it asks
         about the mechanic just finished, so it has to land before the next
         one introduces itself. Detected from the plan rather than counted, so
         it stays correct whatever the block lengths are. */
      const prev = plan[idx - 1];
      if (S.midSurvey && p.stage === "ai" && p.block === 2 && prev && prev.block === 1) {
        steps.push({ type: "survey", id: "mid" });
      }
      /* The step carries the round's own mechanic. planIndex indexes the PLAN,
         not this array, so inserting surveys never disturbs the task counter
         or Task.isNewSection. */
      steps.push({
        type: "task", stage: p.stage, taskId: p.taskId,
        mechanic: p.mechanic || null,   // which interaction THIS round runs
        block: p.block || 0,            // 1 or 2 for AI rounds; 0 for the baseline
        taskBlock: p.taskBlock || null, // which content set it came from
        planIndex: idx,
      });
    });

    if (S.postSurvey) steps.push({ type: "survey", id: "post" });
    steps.push({ type: "debrief" });
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = (s.id !== id); });
  }

  function render() {
    const step = steps[i];
    if (!step) return;
    Store.setStep(i);
    switch (step.type) {
      case "prolific": Prolific.render(); break;
      case "survey":   Survey.render(step.id); break;
      case "task":     Task.start(step); break;
      case "debrief":  Results.showDebrief(); break;
    }
  }

  // Enter the flow once the session exists.
  function begin() { go(0); }

  function go(n) { i = n; render(); }
  function next() { go(i + 1); }
  function current() { return steps[i] || null; }

  return { build, render, go, next, begin, current, showScreen };
})();
