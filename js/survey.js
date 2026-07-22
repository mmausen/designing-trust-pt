/* ═══════════════════════════════════════════════════════════════════
   SURVEY — renders a survey step (pre / post) from strings.json
   (surveys.<id> in the active language), validates required fields,
   stores answers, then advances the flow.

   Question ids are data keys and are identical in both languages, so a
   language switch re-renders the questions and restores what the
   participant already typed or selected (see relocalize).
   ═══════════════════════════════════════════════════════════════════ */
window.Survey = (function () {
  const $ = id => document.getElementById(id);
  let currentId = null;

  function def(id) { return I18n.block("surveys." + id) || { questions: [] }; }

  function render(id, opts) {
    currentId = id;
    const s = def(id);
    Flow.showScreen("screen-survey");
    $("survey-kicker").textContent = s.kicker || "";
    $("survey-title").textContent = s.title || "";
    $("survey-note").textContent = s.note || "";
    $("btn-survey-next").textContent = I18n.t("ui.survey.continue");

    const form = $("survey-form");
    form.innerHTML = "";
    (s.questions || []).forEach(q => form.appendChild(field(q)));

    if (!(opts && opts.silent)) Store.log("survey_view", { id, lang: I18n.get() });
  }

  function field(q) {
    const wrap = document.createElement("div");
    wrap.className = "q";

    const lbl = document.createElement("div");
    lbl.className = "q-label";
    lbl.textContent = q.label + (q.required ? " *" : "");
    wrap.appendChild(lbl);

    if (q.type === "likert") {
      const row = document.createElement("div");
      row.className = "likert";
      for (let n = 1; n <= 5; n++) {
        const opt = document.createElement("label");
        opt.className = "likert-opt";
        opt.innerHTML = `<input type="radio" name="${q.id}" value="${n}"/><span>${n}</span>`;
        row.appendChild(opt);
      }
      wrap.appendChild(row);
      const anc = document.createElement("div");
      anc.className = "likert-anchors";
      anc.innerHTML = `<span></span><span></span>`;
      anc.children[0].textContent = I18n.t("ui.survey.likertLow");
      anc.children[1].textContent = I18n.t("ui.survey.likertHigh");
      wrap.appendChild(anc);
    } else { // text
      const ta = document.createElement("textarea");
      ta.name = q.id;
      ta.rows = 2;
      ta.className = "q-text";
      wrap.appendChild(ta);
    }
    return wrap;
  }

  // Current answers straight off the form (no validation) — used to carry
  // the participant's input across a language switch.
  function snapshot() {
    const out = {};
    (def(currentId).questions || []).forEach(q => {
      if (q.type === "likert") {
        const el = document.querySelector(`input[name="${q.id}"]:checked`);
        if (el) out[q.id] = el.value;
      } else {
        const el = document.querySelector(`textarea[name="${q.id}"]`);
        if (el && el.value) out[q.id] = el.value;
      }
    });
    return out;
  }
  function restore(vals) {
    Object.keys(vals || {}).forEach(id => {
      const radio = document.querySelector(`input[name="${id}"][value="${vals[id]}"]`);
      if (radio) { radio.checked = true; return; }
      const ta = document.querySelector(`textarea[name="${id}"]`);
      if (ta) ta.value = vals[id];
    });
  }

  // Re-render the current survey in the new language, keeping the answers.
  function relocalize() {
    if (!currentId) return;
    const vals = snapshot();
    render(currentId, { silent: true });
    restore(vals);
  }

  function collect() {
    const s = def(currentId);
    const out = {};
    let ok = true;
    (s.questions || []).forEach(q => {
      let v;
      if (q.type === "likert") {
        const el = document.querySelector(`input[name="${q.id}"]:checked`);
        v = el ? +el.value : null;
      } else {
        const el = document.querySelector(`textarea[name="${q.id}"]`);
        v = el ? el.value.trim() : "";
      }
      if (q.required && (v === null || v === "")) ok = false;
      out[q.id] = v;
    });
    return { ok, out };
  }

  function submit() {
    const { ok, out } = collect();
    if (!ok) {
      $("survey-note").textContent = I18n.t("ui.survey.required");
      return;
    }
    Store.setSurvey(currentId, out);
    Store.log("survey_submit", { id: currentId, lang: I18n.get() });
    Store.sendRemote();
    Flow.next();
  }

  function current() { return currentId; }

  return { render, submit, relocalize, current };
})();
