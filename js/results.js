/* ═══════════════════════════════════════════════════════════════════
   RESULTS — the final debrief screen.

   Deliberately shows the participant NOTHING about their rankings, and should
   stay that way for two reasons — the first decisive:
     · These are priority judgements. There IS no correct order to mark a
       ranking against, so a right/wrong display could only be a lie.
     · Any feedback at all would teach across rounds — a learning confound,
       and a reason to distrust the trust measures that follow it.

   The rankings are still fully recorded on each result (`ranking`,
   `aiSuggestion`, `overrides`); this screen simply does not report them back.
   ═══════════════════════════════════════════════════════════════════ */
window.Results = (function () {
  const $ = id => document.getElementById(id);

  function showDebrief(opts) {
    Flow.showScreen("screen-debrief");
    const d = Store.get();
    if (!(opts && opts.silent)) {
      Store.markComplete();
      Store.log("session_end", {});
      Store.sendRemote();
    }

    $("db-title").textContent = I18n.t("ui.debrief.title");
    $("db-thanks").textContent = I18n.t("ui.debrief.thanks");
    $("db-sub").textContent = I18n.t("ui.debrief.sub", { id: d.participantId, n: d.results.length });
    // Never claim an upload that didn't happen: with logging switched off
    // nothing was POSTed, so fall back to the local wording.
    $("db-sync-note").textContent = (Config.ENDPOINT_URL && Config.CONFIG.loggingEnabled !== false)
      ? I18n.t("ui.debrief.syncRemote")
      : I18n.t("ui.debrief.syncLocal");
  }

  // Re-render the debrief in the new language (without re-logging session_end).
  function relocalize() { if (Store.get()) showDebrief({ silent: true }); }

  return { showDebrief, relocalize };
})();
