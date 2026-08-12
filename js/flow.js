/* ═══════════════════════════════════════════════════════════════════
   FLOW — the step machine. One linear sequence:
     consent → pre-survey → [baseline rounds] → [AI rounds] → post-survey → debrief
   Surveys are ordinary steps; the task's per-level results screen is an
   interstitial owned by the task/results modules (it calls Flow.next()).
   ═══════════════════════════════════════════════════════════════════ */
window.Flow = (function () {
  let steps = [];
  let i = 0;

  // Build the sequence from the (already-created/restored) session plan.
  function build() {
    const plan = Store.get().plan || [];
    steps = [
      { type: "consent" },
      { type: "survey", id: "pre" },
      // The step carries the STAGE, not the group: the group lives on the
      // session, so the dev picker can change it without rebuilding the flow.
      ...plan.map((p, idx) => ({ type: "task", stage: p.stage, taskId: p.taskId, aiError: !!p.aiError, planIndex: idx })),
      { type: "survey", id: "post" },
      { type: "debrief" },
    ];
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = (s.id !== id); });
  }

  function render() {
    const step = steps[i];
    Store.setStep(i);
    switch (step.type) {
      case "consent": showScreen("screen-consent"); break;
      case "survey":  Survey.render(step.id); break;
      case "task":    Task.start(step); break;
      case "debrief": Results.showDebrief(); break;
    }
  }

  function go(n) { i = n; render(); }
  function next() { go(i + 1); }
  function peekNext() { return steps[i + 1] || null; }
  function current() { return steps[i] || null; }

  return { build, render, go, next, peekNext, current, showScreen };
})();
