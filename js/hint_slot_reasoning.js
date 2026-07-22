/* ═══════════════════════════════════════════════════════════════════
   HINT VARIANT · "slot-reasoning" — the current condition 3.

   On pick-up, highlight the slot the AI suggests AND show its stated
   reasoning anchored over that slot. The reasoning always matches the
   suggestion: on a stage with a scripted error it is the plausible-but-
   wrong justification, never the true one.

   Deliberately duplicates the few lines of highlight logic from
   hint_slot.js rather than importing it, so either file can be deleted
   without breaking the other.

   Styling: `.slot.slot-hint` and `.slot-thought` in styles-accessible.css.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const MARK = "slot-hint";
  const BOX = "slot-thought";

  function clear() {
    document.querySelectorAll("#ladder .slot." + MARK)
      .forEach(s => s.classList.remove(MARK));
    document.querySelectorAll("." + BOX).forEach(n => n.remove());
  }

  Hints.register("slot-reasoning", {
    badgeKey: "ui.task.badges.thought",
    hintKey: "ui.task.hints.thought",
    showsReasoning: true,

    onPickUp(ctx) {
      if (ctx.aiSlot < 0) return;
      const el = ctx.slotEl(ctx.aiSlot);
      if (!el) return;
      el.classList.add(MARK);

      const text = ctx.reasoning();
      if (!text) return;
      const box = document.createElement("div");
      box.className = BOX;
      box.innerHTML = `<span class="st-tag">AI</span><span class="st-txt"></span>`;
      box.querySelector(".st-txt").textContent = text;   // textContent: never inject markup
      el.appendChild(box);
    },

    clear,
  });
})();
