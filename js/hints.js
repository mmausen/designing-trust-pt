/* ═══════════════════════════════════════════════════════════════════
   HINTS — registry of AI-hint designs, so competing variants can live
   side by side and be compared without task.js ever naming one.

   A group picks its variant in Config.GROUPS:
       G3: { key: "g3", ai: "hint", hint: "slot" }

   To ADD a variant: create js/hint_<name>.js, call Hints.register(...),
   add the <script> tag, point a condition at it.
   To DROP a variant: delete that file, its <script> tag, and any config
   that names it. Nothing else in the codebase refers to it — that is the
   whole point of this indirection.

   ── the contract ──────────────────────────────────────────────────
   Hints.register(name, {
     badgeKey,           // i18n key for the banner badge
     hintKey,            // i18n key for the footer instruction line
     showsReasoning,     // bool — recorded in the logs for analysis
     onPickUp(ctx),      // participant picked a step up
     onMove(ctx, x, y),  // optional — pointer moved during the drag
     onDrop(ctx),        // optional — step was released
     clear(),            // REQUIRED: remove every trace from the DOM
   })

   `ctx` (built by task.js, so a variant never reaches into its state):
     cardId       the step being dragged ("t0"…"t5")
     aiSlot       0-based slot the AI suggests, or -1 if it has no view.
                  Already carries any scripted error for this stage.
     trueSlot     the correct slot — for logging only. A variant must
                  NEVER show this: it is the answer.
     isWrongHint  aiSlot !== trueSlot
     taskId, aiError, lang
     reasoning()  the AI's justification text for this step (matches the
                  suggestion, so it is the wrong-order rationale when the
                  stage is scripted wrong)
     slotEl(i)    the ladder slot element at index i
     ladderEl()   the ladder container
     card()       the inbox/ladder element of the dragged step
   ══════════════════════════════════════════════════════════════════ */
window.Hints = (function () {
  const registry = {};

  function register(name, impl) {
    if (registry[name]) console.warn(`Hints: "${name}" registered twice`);
    if (typeof impl.clear !== "function") {
      console.error(`Hints: "${name}" must implement clear()`);
      return;
    }
    registry[name] = Object.assign({ name, showsReasoning: false }, impl);
  }

  function get(name) {
    if (!name) return null;
    const impl = registry[name];
    if (!impl) console.warn(`Hints: no variant named "${name}" — is its <script> tag present?`);
    return impl || null;
  }

  function names() { return Object.keys(registry); }

  // Clear every registered variant. Cheap, and means a half-finished drag
  // can never leave marks behind after the variant is switched.
  function clearAll() {
    Object.keys(registry).forEach(k => {
      try { registry[k].clear(); } catch (e) { console.error(`Hints: ${k}.clear() failed`, e); }
    });
  }

  return { register, get, names, clearAll };
})();
