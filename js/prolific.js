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

   There is NO format check. A Prolific ID is 24 hex characters today, but a
   participant who pastes something slightly different — or a format Prolific
   changes later — must not be nagged or blocked in a study they were
   recruited for, and a guess about the format is not worth a moment of doubt
   at the door. Any non-empty value is taken as given; matching it up against
   Prolific's own records is an analysis job, not this screen's.
   ═══════════════════════════════════════════════════════════════════ */
window.Prolific = (function () {
  const $ = id => document.getElementById(id);

  function render() {
    Flow.showScreen("screen-prolific");
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
    // Empty is the only refusal: without an id the session cannot be paid out.
    if (!value) { showError("ui.prolific.required"); return; }

    hideError();
    Store.setProlificId(value);
    // Length only — the id itself is on the session, and nothing here judges it.
    Store.log("prolific_id_entered", { length: value.length });
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
