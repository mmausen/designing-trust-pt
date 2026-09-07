/* ═══════════════════════════════════════════════════════════════════
   PROLIFIC — the optional "enter your Prolific ID" step
   (Config.STEPS.prolificId).

   Why it does NOT become the participant id: `participantId` names a file in
   logs/sessions/ and keys the group ledger, and it is generated before this
   screen is ever reached (the group draw needs it). Letting participant-typed
   text take that role would put user input on the filesystem and make the
   ledger depend on a value that can be mistyped or entered twice. So the
   Prolific ID rides alongside on the session instead, and the two are linked
   in every export.

   Treat it as personal data: it identifies a payable account, so it lands in
   logs/ under the same handling as the rest of the session.

   Validation is deliberately soft. A Prolific ID is 24 hex characters today,
   but a participant who pastes something slightly different — or a format
   Prolific changes later — must not be locked out of a study they were
   recruited for. So a non-empty value always proceeds; a value that does not
   look like an ID is recorded with `looksValid: false` for the analysis to
   filter on, and the participant is warned once rather than blocked.
   ═══════════════════════════════════════════════════════════════════ */
window.Prolific = (function () {
  const $ = id => document.getElementById(id);
  const LOOKS_LIKE_ID = /^[A-Za-z0-9]{20,32}$/;   // 24 hex chars today; kept loose on purpose
  let warned = false;

  function render() {
    Flow.showScreen("screen-prolific");
    warned = false;
    const input = $("prolific-input");
    // Restore what they already typed — a language switch re-renders this screen.
    input.value = Store.prolificId() || "";
    input.placeholder = I18n.t("ui.prolific.placeholder");
    $("btn-prolific-next").textContent = I18n.t("ui.prolific.next");
    hideError();
    input.focus();
    Store.log("prolific_view", { lang: I18n.get() });
  }

  function showError(key) {
    const el = $("prolific-error");
    el.hidden = false;
    el.textContent = I18n.t(key);
  }
  function hideError() {
    const el = $("prolific-error");
    el.hidden = true;
    el.textContent = "";
  }

  function submit() {
    const value = ($("prolific-input").value || "").trim();
    if (!value) { showError("ui.prolific.required"); return; }

    const looksValid = LOOKS_LIKE_ID.test(value);
    // Warn once on an odd-looking id, then take it anyway on the second press.
    if (!looksValid && !warned) {
      warned = true;
      showError("ui.prolific.checkFormat");
      return;
    }
    hideError();
    Store.setProlificId(value);
    Store.log("prolific_id_entered", { looksValid, length: value.length });
    Store.sendRemote();
    Flow.next();
  }

  // Re-render in the new language, keeping whatever is typed.
  function relocalize() {
    const input = $("prolific-input");
    const typed = input ? input.value : "";
    render();
    if (input) input.value = typed;
  }

  function wire() {
    $("btn-prolific-next").addEventListener("click", submit);
    $("prolific-input").addEventListener("input", hideError);
    $("prolific-input").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
  }

  return { wire, render, relocalize };   // submit is reached through the wired handlers
})();
