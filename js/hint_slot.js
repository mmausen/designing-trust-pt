/* ═══════════════════════════════════════════════════════════════════
   HINT VARIANT · "slot" — the current condition 2.

   On pick-up, highlight the slot the AI suggests for that step. Nothing
   else: no reasoning, no movement assistance, and the participant can
   still drop the step anywhere.

   Self-contained on purpose — deleting this file removes the variant
   completely. Styling: `.slot.slot-hint` in styles-accessible.css.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const MARK = "slot-hint";

  function clear() {
    document.querySelectorAll("#ladder .slot." + MARK)
      .forEach(s => s.classList.remove(MARK));
  }

  Hints.register("slot", {
    badgeKey: "ui.task.badges.hint",
    hintKey: "ui.task.hints.hint",
    showsReasoning: false,

    onPickUp(ctx) {
      if (ctx.aiSlot < 0) return;              // no suggestion for this step
      const el = ctx.slotEl(ctx.aiSlot);
      if (el) el.classList.add(MARK);
    },

    clear,
  });
})();
