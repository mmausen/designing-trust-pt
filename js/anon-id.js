/* ═══════════════════════════════════════════════════════════════════
   ANON ID — the optional "enter your participant ID" step
   (Config.STEPS.anonId).

   The research team running the study hands each participant an anonymised
   ID beforehand. This screen collects it so a run can be matched to that
   person on the researchers' own list — the prototype itself never learns
   who anyone is.

   Why it does NOT become the participantId: `participantId` names the
   participant's folder under logs/, and it is generated before this screen
   is ever reached. Letting participant-typed text take that role would put
   user input on the filesystem as a path, and a mistyped or reused ID would
   merge two people's runs into one folder. So the anonymised ID rides
   alongside on the session as `anonId`, and the two are linked in every
   export.

   There is NO format check. The format is whatever the research team
   issues, and it may change between batches; a guess about it is not worth
   blocking someone at the door. Any non-empty value is taken as given;
   matching it against the researchers' list is an analysis job.

   This replaced a Prolific-ID step on 2026-10-20, when the study stopped
   recruiting through Prolific.
   ═══════════════════════════════════════════════════════════════════ */
window.AnonId = (function () {
  const $ = id => document.getElementById(id);

  function render() {
    Flow.showScreen("screen-anon-id");
    const input = $("anon-id-input");
    // Restore what they already typed — a language switch re-renders this screen.
    input.value = Store.anonId() || "";
    input.placeholder = I18n.t("ui.anonId.placeholder");
    $("btn-anon-id-next").textContent = I18n.t("ui.anonId.next");
    hideError();
    input.focus();
    Store.log("anon_id_view", { lang: I18n.get() });
  }

  function showError(key) {
    const el = $("anon-id-error");
    el.hidden = false;
    el.textContent = I18n.t(key);
  }
  function hideError() {
    const el = $("anon-id-error");
    el.hidden = true;
    el.textContent = "";
  }

  function submit() {
    const value = ($("anon-id-input").value || "").trim();
    // Empty is the only refusal: without an ID the run cannot be matched.
    if (!value) { showError("ui.anonId.required"); return; }

    hideError();
    Store.setAnonId(value);
    // Length only — the ID itself is on the session, and nothing here judges it.
    Store.log("anon_id_entered", { length: value.length });
    Store.sendRemote();
    Flow.next();
  }

  // Re-render in the new language, keeping whatever is typed.
  function relocalize() {
    const input = $("anon-id-input");
    const typed = input ? input.value : "";
    render();
    if (input) input.value = typed;
  }

  function wire() {
    $("btn-anon-id-next").addEventListener("click", submit);
    $("anon-id-input").addEventListener("input", hideError);
    $("anon-id-input").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
  }

  return { wire, render, relocalize };   // submit is reached through the wired handlers
})();
