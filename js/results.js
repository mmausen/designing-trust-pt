/* ═══════════════════════════════════════════════════════════════════
   RESULTS — the final debrief / overall screen.
   (The per-task summary interstitial was removed; tasks flow straight on.)
   The overall grid is gated on Config.CONFIG.showCorrectnessFeedback and
   resolves each result's tiles from its own task (Tasks.get(taskId)).
   ═══════════════════════════════════════════════════════════════════ */
window.Results = (function () {
  const $ = id => document.getElementById(id);

  // Map of card id → tile for one task ("t"+key → {key,text,…}).
  function tilesById(taskId) {
    const t = Tasks.get(taskId);
    if (!t || !Array.isArray(t.tiles)) return {};
    return Object.fromEntries(t.tiles.map(tile => ["t" + tile.key, tile]));
  }

  /* ── final screen ── */
  function showDebrief(opts) {
    Flow.showScreen("screen-debrief");
    const d = Store.get();
    if (!(opts && opts.silent)) {
      Store.markComplete();
      Store.log("session_end", {});
      Store.sendRemote();
    }

    const fb = Config.CONFIG.showCorrectnessFeedback;
    $("db-title").textContent = I18n.t("ui.debrief.title");
    $("db-thanks").textContent = I18n.t("ui.debrief.thanks");
    $("db-sub").textContent = I18n.t("ui.debrief.sub", { id: d.participantId, n: d.results.length });
    $("db-sync-note").textContent = Config.ENDPOINT_URL
      ? I18n.t("ui.debrief.syncRemote")
      : I18n.t("ui.debrief.syncLocal");

    const grid = $("db-grid");
    grid.hidden = !fb;
    if (fb) {
      grid.innerHTML = "";
      d.results.forEach(r => {
        const tById = tilesById(r.taskId);
        const cnd = Config.CONDITIONS[r.level];
        const task = Tasks.get(r.taskId);
        const col = document.createElement("div");
        col.className = "or-col";
        col.innerHTML = `<div class="or-col-hd">${cnd.key.toUpperCase()}${r.taskId ? " · " + r.taskId : ""}</div>
          <div class="or-col-sub"></div>`;
        col.querySelector(".or-col-sub").textContent = task ? task.title : I18n.t(`conditions.${cnd.key}.label`);
        r.ranking.forEach((id, i) => {
          const tile = tById[id];
          const name = tile ? tile.text : (id || "—");
          const ok = tile ? (tile.key === i) : false;
          const row = document.createElement("div");
          row.className = "or-row";
          row.innerHTML = `<span class="or-pos">${i + 1}</span>
            <span class="or-name">${name}</span>
            <span class="or-dot ${ok ? "ok" : "err"}"></span>`;
          col.appendChild(row);
        });
        const score = document.createElement("div");
        score.className = "or-score";
        score.textContent = I18n.t("ui.debrief.correct", { score: r.score });
        if (r.overrides != null) score.textContent += " · " + I18n.t("ui.debrief.overrides", { n: r.overrides });
        col.appendChild(score);
        grid.appendChild(col);
      });
      $("db-note").textContent = I18n.t("ui.debrief.note");
    } else {
      $("db-note").textContent = "";
    }
  }

  // Re-render the debrief in the new language (without re-logging session_end).
  function relocalize() { if (Store.get()) showDebrief({ silent: true }); }

  return { showDebrief, relocalize };
})();
