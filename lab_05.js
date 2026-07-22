/* ═══════════════════════════════════════════════════════════════════
   LAB · Experiment 05 — HANDOFF (mechanism from wizard-of-oz-sorter.html).
   A shared cursor. The participant drags tiles into their correct slot by
   hand; the moment they stop moving (CFG.idleMs), a fake AI cursor fades
   in, takes over, and finishes the sort — planning a human-ish motion
   (think → curve toward the tile → grab → carry → drop). Any real input
   (move, click, key, wheel) hands control straight back. Two behaviour
   knobs: Speed and Hesitation. The AI never makes an error at this stage
   (no "worse" logic) — it always drops each tile in its correct slot.
   Fully self-contained: does NOT touch the study code base (js/*,
   styles*.css). Loaded by lab.html (?exp=05).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!window.LAB) { console.error("lab_05.js needs the lab.html harness"); return; }
  var LAB = window.LAB;

  /* ── tunable design parameters ── */
  var CFG = {
    idleMs: 1000,        // ms of no user input before the AI takes over
    speed: 28,           // 0–100 slider → travel speed (default ≈ half of the old 55)
    hesitate: true,      // adds thinking pauses + second-guess approaches (on by default)
    speedMin: 230,       // px/sec at slider 0
    speedMax: 3200,      // px/sec at slider 100
    fadeInMs: 500,
    fadeOutMs: 220,
    returnMs: 190,       // ms to sweep the cursor back to the user's pointer on takeover
    dragThreshold: 5,    // px before a press becomes a manual drag
  };

  /* ── data: placeholder items A–F, correct urgency order A→F ── */
  var ITEMS = [
    { id: "A", rank: 1, icon: "A", title: "Item A", detail: "Placeholder description for item A." },
    { id: "B", rank: 2, icon: "B", title: "Item B", detail: "Placeholder description for item B." },
    { id: "C", rank: 3, icon: "C", title: "Item C", detail: "Placeholder description for item C." },
    { id: "D", rank: 4, icon: "D", title: "Item D", detail: "Placeholder description for item D." },
    { id: "E", rank: 5, icon: "E", title: "Item E", detail: "Placeholder description for item E." },
    { id: "F", rank: 6, icon: "F", title: "Item F", detail: "Placeholder description for item F." },
  ];
  var SLOT_LABELS = ["Most urgent", "", "", "", "", "Least urgent"];
  var CURSOR_SVG =
    '<svg viewBox="0 0 26 30" width="26" height="30"><path d="M2 2 L2 22 L8 17 L12 25 L15.5 23.5 L11.5 15.5 L19 15.5 Z" ' +
    'fill="#fff" stroke="#1d1d1f" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  /* ── helpers ── */
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var distp = function (ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); };
  var easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var easeOutBack = function (t, s) { s = s == null ? 1.1 : s; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
  function speedPPS() { return lerp(CFG.speedMin, CFG.speedMax, CFG.speed / 100); }

  var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = 0 | (Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  function logEvent(type, data) { var e = Object.assign({ type: type, t: Math.round(performance.now()) }, data || {}); log.push(e); LAB.log(type, data || {}); }

  /* ── per-run state & elements ── */
  var cards, byId, inbox, slots, drag, log;
  var root, ghost, confirmBtn, inboxEl, ladderEl, inboxHd, cursorEl, modeEl, modeTxt, speedEl, hesEl;

  // fake-cursor / autopilot state (viewport coordinates)
  var fc = { x: 0, y: 0, opacity: 0, active: false, carrying: null, srcW: 280, seg: null, queue: [], returning: false, returnT: 0, returnFrom: { x: 0, y: 0 } };
  var lastActivity = performance.now();
  var lastPointer = { x: 0, y: 0 };
  var prev = 0, rafId = null, watchdog = null, lastStepTs = 0;

  injectStyles();
  LAB.setTitle("Experiment 05 · HANDOFF");
  addGlobalListeners();
  LAB.onRestart(build);
  build();

  /* ── build one run ── */
  function build() {
    driveStop();
    cards = shuffle(ITEMS.map(function (it) { return Object.assign({}, it); }));
    byId = {}; cards.forEach(function (c) { byId[c.id] = c; });
    inbox = cards.slice();
    slots = [null, null, null, null, null, null];
    drag = null;
    log = [];
    fc.opacity = 0; fc.active = false; fc.carrying = null; fc.seg = null; fc.queue.length = 0; fc.returning = false; fc.returnT = 0;
    lastActivity = performance.now();
    logEvent("run_start", { inboxOrder: cards.map(function (c) { return c.id; }) });

    root = LAB.root;
    root.innerHTML =
      '<div class="lab-task">' +
        '<div class="t-banner">' +
          '<span class="b-badge">HANDOFF</span>' +
          '<span class="t-hint">Drag a tile into its correct slot. Stop moving and the AI takes the cursor and finishes the sort — move again to take back control.</span>' +
          '<span class="ai-mode" id="ai-mode"><span class="dot"></span><span id="ai-mode-txt">You’re in control</span></span>' +
        '</div>' +
        '<div class="t-main">' +
          '<div class="t-col"><div class="t-col-hd" id="t-inbox-hd">Inbox — incoming items</div><div class="t-scroll" id="t-inbox"></div></div>' +
          '<div class="t-col"><div class="t-col-hd">Urgency ranking — drag items here</div><div class="t-ladder" id="t-ladder"></div></div>' +
        '</div>' +
        '<div class="t-footer">' +
          '<div class="t-tune" id="lab-05-controls">' +
            '<label>Speed <input type="range" id="ai-speed" min="0" max="100" value="' + CFG.speed + '"></label>' +
            '<label class="opt"><input type="checkbox" id="ai-hes"' + (CFG.hesitate ? " checked" : "") + '> Hesitation</label>' +
          '</div>' +
          '<button class="t-btn t-primary" id="t-confirm" disabled>Confirm ranking</button>' +
        '</div>' +
      '</div>' +
      '<div id="t-ghost" class="t-ghost"><div class="card-icon" id="t-ghost-icon"></div>' +
        '<div><div class="card-title" id="t-ghost-title"></div><div class="card-detail" id="t-ghost-detail"></div></div></div>' +
      '<div id="lab-05-cursor"><div class="ring"></div>' + CURSOR_SVG + '</div>';

    inboxEl = root.querySelector("#t-inbox");
    ladderEl = root.querySelector("#t-ladder");
    inboxHd = root.querySelector("#t-inbox-hd");
    confirmBtn = root.querySelector("#t-confirm");
    ghost = root.querySelector("#t-ghost");
    cursorEl = root.querySelector("#lab-05-cursor");
    modeEl = root.querySelector("#ai-mode");
    modeTxt = root.querySelector("#ai-mode-txt");
    speedEl = root.querySelector("#ai-speed");
    hesEl = root.querySelector("#ai-hes");

    confirmBtn.addEventListener("click", confirmRanking);
    speedEl.addEventListener("input", function () { CFG.speed = +speedEl.value; });
    hesEl.addEventListener("change", function () { CFG.hesitate = hesEl.checked; });

    render();
    driveStart();
  }

  /* ── render ── */
  function render() {
    renderInbox();
    renderLadder();
    confirmBtn.disabled = !slots.every(Boolean);
  }
  function renderInbox() {
    inboxEl.innerHTML = "";
    if (!inbox.length) {
      var n = document.createElement("div"); n.className = "t-empty"; n.textContent = "All items placed."; inboxEl.appendChild(n);
    } else {
      inbox.forEach(function (c) { inboxEl.appendChild(makeCardEl(c, "inbox")); });
    }
    inboxHd.textContent = "Inbox — incoming items (" + inbox.length + " remaining)";
  }
  function renderLadder() {
    ladderEl.innerHTML = "";
    slots.forEach(function (id, i) {
      var slot = document.createElement("div"); slot.className = "t-slot"; slot.dataset.slot = i;
      var num = document.createElement("div"); num.className = "t-slot-num"; num.textContent = i + 1; slot.appendChild(num);
      if (id) {
        slot.appendChild(makeCardEl(byId[id], i));
      } else {
        var lbl = document.createElement("div"); lbl.className = "t-slot-lbl"; lbl.textContent = SLOT_LABELS[i] || "—"; slot.appendChild(lbl);
      }
      ladderEl.appendChild(slot);
    });
  }
  function makeCardEl(card, from) {
    var div = document.createElement("div");
    div.className = "card"; div.dataset.id = card.id; div.dataset.from = String(from);
    div.innerHTML = '<div class="card-icon">' + card.icon + '</div>' +
      '<div class="card-txt"><div class="card-title">' + card.title + '</div>' +
      '<div class="card-detail">' + card.detail + '</div></div><div class="card-grip">⠿</div>';
    div.addEventListener("pointerdown", function (e) { onCardPointerDown(e, card.id, from); });
    return div;
  }

  /* ── ghost (shared by user drag + AI carry) ── */
  function ghostShow(id, width) {
    var c = byId[id];
    root.querySelector("#t-ghost-icon").textContent = c.icon;
    root.querySelector("#t-ghost-title").textContent = c.title;
    root.querySelector("#t-ghost-detail").textContent = c.detail;
    ghost.style.width = (width || 280) + "px";
    ghost.style.display = "flex";
  }
  function ghostMoveTo(left, top) { ghost.style.left = left + "px"; ghost.style.top = top + "px"; }
  function ghostHide() { ghost.style.display = "none"; }

  /* ── user dragging (pointer-based; drop by pointer position) ── */
  function onCardPointerDown(e, id, from) {
    if (e.button != null && e.button !== 0) return;
    registerActivity(e);                       // the user is taking control
    var card = e.currentTarget;
    var rect = card.getBoundingClientRect();
    drag = { id: id, from: from, started: false,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, srcW: rect.width };
    if (card.setPointerCapture) { try { card.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
  }
  function startUserDrag() {
    if (drag.started) return;
    drag.started = true;
    ghostShow(drag.id, drag.srcW);
    var src = root.querySelector('[data-id="' + drag.id + '"]');
    if (src) src.classList.add("ghost");
    logEvent("drag_start", { cardId: drag.id, from: drag.from });
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.started && distp(e.clientX, e.clientY, drag.startX, drag.startY) < CFG.dragThreshold) return;
    startUserDrag();
    highlightSlotAt(e.clientX, e.clientY);
    ghostMoveTo(e.clientX - drag.offsetX, e.clientY - drag.offsetY);
  }
  function onDragUp(e) {
    if (!drag) return;
    var d = drag;
    if (!d.started) { drag = null; return; }
    ghostHide();
    clearSlotHighlight();
    var src = root.querySelector('[data-id="' + d.id + '"]');
    if (src) src.classList.remove("ghost");

    var targetSlot = slotAt(e.clientX, e.clientY);
    var inInbox = inInboxAt(e.clientX, e.clientY);
    drag = null;

    if (targetSlot != null) { logEvent("drop", { cardId: d.id, to: "slot_" + targetSlot, method: "manual" }); placeCard(d.id, d.from, targetSlot); }
    else if (inInbox && d.from !== "inbox") { logEvent("drop", { cardId: d.id, to: "inbox" }); returnToInbox(d.id, d.from); }
    render();
    registerActivity(e);
  }

  /* ── hit-testing ── */
  function slotAt(x, y) {
    var found = null;
    root.querySelectorAll(".t-slot").forEach(function (s) {
      var r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = +s.dataset.slot;
    });
    return found;
  }
  function inInboxAt(x, y) {
    var r = inboxEl.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  function highlightSlotAt(x, y) {
    clearSlotHighlight();
    var i = slotAt(x, y);
    if (i != null) { var el = root.querySelector('.t-slot[data-slot="' + i + '"]'); if (el) el.classList.add("drop-target"); }
  }
  function clearSlotHighlight() { root.querySelectorAll(".t-slot.drop-target").forEach(function (s) { s.classList.remove("drop-target"); }); }

  function tileCenter(id) {
    var el = root.querySelector('#t-inbox [data-id="' + id + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }
  function slotCenter(i) {
    var el = root.querySelector('.t-slot[data-slot="' + i + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ── placement (state) ── */
  function placeCard(id, from, toSlot) {
    var displaced = slots[toSlot];
    slots[toSlot] = id;
    if (from === "inbox") {
      inbox = inbox.filter(function (c) { return c.id !== id; });
      if (displaced) { inbox = inbox.filter(function (c) { return c.id !== displaced; }); inbox.push(byId[displaced]); }
    } else {
      slots[from] = displaced || null;
    }
  }
  function returnToInbox(id, fromSlot) {
    slots[fromSlot] = null;
    if (!inbox.some(function (c) { return c.id === id; })) inbox.push(byId[id]);
  }

  /* ── activity / hand-off ── */
  function inControls(e) { return !!(e.target && e.target.closest && e.target.closest("#lab-05-controls")); }
  function registerActivity(e) {
    lastActivity = performance.now();
    if (e && e.clientX != null) lastPointer = { x: e.clientX, y: e.clientY };
    if (fc.active) deactivateFake();
  }
  function activateFake() {
    fc.active = true;
    fc.returning = false;
    fc.x = lastPointer.x || (root.getBoundingClientRect().left + root.clientWidth / 2);
    fc.y = lastPointer.y || (root.getBoundingClientRect().top + root.clientHeight / 2);
    logEvent("autopilot_on", {});
  }
  function deactivateFake() {
    fc.active = false;
    fc.queue.length = 0;
    fc.seg = null;
    if (fc.carrying != null) {
      var src = root.querySelector('#t-inbox [data-id="' + fc.carrying + '"]');
      if (src) src.classList.remove("ghost");   // it was never removed from the inbox — just un-dim it
      ghostHide();
      fc.carrying = null;
    }
    clearSlotHighlight();
    // if the cursor is still on screen, sweep it back to the user's pointer before
    // fading out — a visible "here, it's yours again" hand-back.
    if (fc.opacity > 0.05) { fc.returning = true; fc.returnT = 0; fc.returnFrom = { x: fc.x, y: fc.y }; }
    else fc.returning = false;
    logEvent("autopilot_off", {});
  }

  /* ── AI motion planning (queue of pause / move / grab / drop) ── */
  function pushMove(tx, ty, ease, curve) { fc.queue.push({ type: "move", to: { x: tx, y: ty }, ease: ease || "cubic", curve: curve == null ? 0.12 : curve, t: 0 }); }
  function pushPause(ms) { fc.queue.push({ type: "pause", dur: ms, t: 0 }); }
  function pushGrab(id) { fc.queue.push({ type: "grab", id: id }); }
  function pushDrop(slot) { fc.queue.push({ type: "drop", slot: slot }); }

  function planJob() {
    var free = inbox.filter(function (c) { return c.id !== fc.carrying; });
    if (!free.length) { pushPause(400); return; }

    // nearest unplaced tile to the cursor
    var target = free[0], best = Infinity;
    free.forEach(function (c) {
      var ctr = tileCenter(c.id);
      if (ctr) { var d = distp(fc.x, fc.y, ctr.x, ctr.y); if (d < best) { best = d; target = c; } }
    });
    var cc = tileCenter(target.id);
    if (!cc) { pushPause(300); return; }
    var hes = CFG.hesitate;

    // 1. a beat of "thinking"
    pushPause(hes ? rand(350, 1000) : rand(120, 260));

    // 2. travel to the tile (optional second-guess approach when hesitating)
    if (hes && Math.random() < 0.6) {
      pushMove(cc.x + rand(-40, 40), cc.y + rand(-44, -14), "cubic", 0.18);
      pushPause(rand(180, 480));
      pushMove(cc.x, cc.y, "back", 0.05);
    } else {
      pushMove(cc.x, cc.y, "back", 0.13);
    }

    // 3. grab
    pushGrab(target.id);
    pushPause(hes ? rand(160, 360) : rand(90, 170));

    // 4. carry to the correct slot (AI never errs — always the right one)
    var slotIdx = byId[target.id].rank - 1;
    var sc = slotCenter(slotIdx);
    if (!sc) sc = { x: fc.x, y: fc.y };
    if (hes && Math.random() < 0.5) {
      pushMove(sc.x + rand(-30, 30), sc.y - rand(40, 80), "cubic", 0.10);
      pushPause(rand(200, 520));
      pushMove(sc.x, sc.y, "cubic", 0.04);
    } else {
      pushMove(sc.x, sc.y, "back", 0.08);
    }

    // 5. drop into that slot
    pushDrop(slotIdx);
    pushPause(hes ? rand(260, 520) : rand(160, 300));
  }

  function startSegment() {
    fc.seg = fc.queue.shift() || null;
    if (!fc.seg) return;
    if (fc.seg.type === "move") {
      var p0 = { x: fc.x, y: fc.y }, p1 = fc.seg.to;
      var d = Math.max(1, distp(p0.x, p0.y, p1.x, p1.y));
      var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
      var nx = -(p1.y - p0.y) / d, ny = (p1.x - p0.x) / d;
      var amp = d * fc.seg.curve * (Math.random() < 0.5 ? -1 : 1);
      fc.seg.p0 = p0; fc.seg.p1 = p1;
      fc.seg.ctrl = { x: mx + nx * amp, y: my + ny * amp };
      var durMul = CFG.hesitate ? 1.22 : 1;
      fc.seg.dur = clamp(d / speedPPS() * 1000 * durMul, 170, 4000);
      fc.seg.t = 0;
    }
  }
  function bezier(p0, ctrl, p1, t) {
    var u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p1.y };
  }

  function updateMotion(dt) {
    if (!fc.seg) {
      if (fc.queue.length) startSegment();
      else { planJob(); startSegment(); }
      if (!fc.seg) return;
    }
    var s = fc.seg;

    if (s.type === "pause") {
      s.t += dt;
      if (s.t >= s.dur) fc.seg = null;

    } else if (s.type === "move") {
      s.t += dt / s.dur;
      var tt = clamp(s.t, 0, 1);
      var e = s.ease === "back" ? easeOutBack(tt) : easeInOutCubic(tt);
      var pos = bezier(s.p0, s.ctrl, s.p1, e);
      fc.x = pos.x; fc.y = pos.y;
      if (fc.carrying != null) { ghostMoveTo(fc.x - 26, fc.y - 20); highlightSlotAt(fc.x, fc.y); }
      if (s.t >= 1) { fc.x = s.p1.x; fc.y = s.p1.y; fc.seg = null; }

    } else if (s.type === "grab") {
      var ctr = tileCenter(s.id);
      if (ctr && inbox.some(function (c) { return c.id === s.id; })) {
        fc.carrying = s.id;
        fc.srcW = ctr.w;
        var src = root.querySelector('#t-inbox [data-id="' + s.id + '"]');
        if (src) src.classList.add("ghost");
        ghostShow(s.id, ctr.w);
        ghostMoveTo(fc.x - 26, fc.y - 20);
        clickPulse();
      }
      fc.seg = null;

    } else if (s.type === "drop") {
      var id = fc.carrying;
      fc.carrying = null;
      if (id != null) {
        ghostHide();
        clearSlotHighlight();
        clickPulse();
        logEvent("ai_drop", { cardId: id, slot: s.slot });
        placeCard(id, "inbox", s.slot);
        render();
      }
      fc.seg = null;
    }
  }

  function clickPulse() {
    if (!cursorEl) return;
    cursorEl.classList.remove("clicking");
    void cursorEl.offsetWidth;   // restart the ring animation
    cursorEl.classList.add("clicking");
  }

  // On takeover: quickly slide the fake cursor to the user's live pointer, then release.
  function updateReturn(dt) {
    fc.returnT += dt / CFG.returnMs;
    var e = easeInOutCubic(clamp(fc.returnT, 0, 1));
    fc.x = lerp(fc.returnFrom.x, lastPointer.x, e);
    fc.y = lerp(fc.returnFrom.y, lastPointer.y, e);
    if (fc.returnT >= 1) { fc.x = lastPointer.x; fc.y = lastPointer.y; fc.returning = false; }
  }

  /* ── drive loop (rAF primary; setInterval watchdog for throttled tabs) ── */
  function driveStart() {
    prev = performance.now(); lastStepTs = prev;
    rafId = requestAnimationFrame(rafLoop);
    watchdog = setInterval(function () { var now = performance.now(); if (now - lastStepTs > 90) step(now); }, 60);
  }
  function rafLoop(now) { step(now); rafId = requestAnimationFrame(rafLoop); }
  function driveStop() { if (rafId) cancelAnimationFrame(rafId); rafId = null; if (watchdog) clearInterval(watchdog); watchdog = null; }

  function step(now) {
    var dt = Math.min(50, now - prev); prev = now; lastStepTs = now;
    var complete = slots.every(Boolean);

    if (!complete && !fc.active && !fc.returning && !drag && (now - lastActivity) > CFG.idleMs) activateFake();
    if (complete && fc.active) deactivateFake();

    // opacity fade — stay visible while returning, then fade out
    var targetOp = (fc.active || fc.returning) ? 1 : 0;
    var rate = fc.active ? dt / CFG.fadeInMs : dt / CFG.fadeOutMs;
    if (fc.opacity < targetOp) fc.opacity = Math.min(targetOp, fc.opacity + rate);
    else if (fc.opacity > targetOp) fc.opacity = Math.max(targetOp, fc.opacity - rate);

    if (fc.active && fc.opacity > 0.05) updateMotion(dt);
    else if (fc.returning) updateReturn(dt);

    // render the fake cursor (with a hair of organic jitter)
    if (cursorEl) {
      if (fc.opacity > 0) {
        var jx = Math.sin(now / 180) * 1.0 + Math.sin(now / 70) * 0.5;
        var jy = Math.cos(now / 160) * 1.0 + Math.cos(now / 90) * 0.5;
        cursorEl.style.opacity = fc.opacity.toFixed(3);
        cursorEl.style.transform = "translate(" + (fc.x + jx).toFixed(1) + "px," + (fc.y + jy).toFixed(1) + "px)";
      } else {
        cursorEl.style.opacity = "0";
      }
    }

    // mode UI + hide the real cursor while the AI drives
    var autoOn = fc.active && fc.opacity > 0.6;
    if (modeEl) modeEl.classList.toggle("auto", autoOn);
    if (modeTxt) modeTxt.textContent = autoOn ? "Autopilot engaged" : "You’re in control";
    var taskEl = root.querySelector(".lab-task");
    if (taskEl) taskEl.classList.toggle("ai-driving", autoOn);
  }

  /* ── global listeners (added once; reference the live module state) ── */
  function addGlobalListeners() {
    window.addEventListener("pointermove", function (e) { if (!inControls(e)) registerActivity(e); onDragMove(e); }, { passive: true });
    window.addEventListener("pointerdown", function (e) { if (!inControls(e)) registerActivity(e); }, { passive: true });
    window.addEventListener("pointerup", function (e) { onDragUp(e); });
    window.addEventListener("keydown", function (e) { registerActivity(e); });
    window.addEventListener("wheel", function (e) { if (!inControls(e)) registerActivity(e); }, { passive: true });
  }

  /* ── confirm → result readout ── */
  function confirmRanking() {
    var score = 0;
    slots.forEach(function (id, i) { if (id && byId[id].rank === i + 1) score++; });
    logEvent("confirm", { ranking: slots.slice(), score: score });
    showResults(score);
  }
  function showResults(score) {
    var correct = ITEMS.slice().sort(function (a, b) { return a.rank - b.rank; });
    var yours = slots.map(function (id, i) {
      var it = byId[id], ok = it.rank === i + 1;
      return '<div class="t-rc-row"><b>' + (i + 1) + '</b><span class="ri">' + it.icon + '</span>' + it.title +
        '<span class="' + (ok ? "ok" : "err") + '">' + (ok ? "✓" : "✗") + '</span></div>';
    }).join("");
    var right = correct.map(function (p, i) {
      return '<div class="t-rc-row"><b>' + (i + 1) + '</b><span class="ri">' + p.icon + '</span>' + p.title + '</div>';
    }).join("");

    var overlay = document.createElement("div");
    overlay.className = "t-results";
    overlay.innerHTML =
      '<div class="t-results-card">' +
        '<h2>Result — ' + score + '/6 correct</h2>' +
        '<p class="muted">Left idle, the AI sorts every tile into its correct slot.</p>' +
        '<div class="t-results-cols"><div><div class="t-rc-hd">Your ranking</div>' + yours + '</div>' +
          '<div><div class="t-rc-hd">Correct order</div>' + right + '</div></div>' +
        '<button class="t-btn t-primary" id="t-again">Run again</button>' +
      '</div>';
    root.querySelector(".lab-task").appendChild(overlay);
    overlay.querySelector("#t-again").addEventListener("click", function () { LAB.restart(); });
  }

  /* ── styles (edit freely — scoped to this experiment) ── */
  function injectStyles() {
    if (document.getElementById("lab-05-style")) return;
    var css =
      ".lab-task{flex:1;display:flex;flex-direction:column;overflow:hidden;color:#0a0a0a;font-size:15px;position:relative}" +
      ".t-banner{display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid #cfcfcf;flex-shrink:0}" +
      ".t-banner .b-badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:4px;letter-spacing:.04em;background:#e6f6f2;color:#0d9488;border:1px solid #99ddd0}" +
      ".t-hint{font-size:13.5px;color:#383838;flex:1}" +
      ".ai-mode{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;padding:5px 11px;border-radius:999px;border:1px solid #cfcfcf;background:#fff;white-space:nowrap;color:#383838}" +
      ".ai-mode .dot{width:8px;height:8px;border-radius:50%;background:#16a34a;transition:background .3s}" +
      ".ai-mode.auto{border-color:#bcd4ff}.ai-mode.auto .dot{background:#2563eb;animation:l5pulse 1.1s infinite}" +
      "@keyframes l5pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}" +
      ".t-main{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}" +
      ".t-col{display:flex;flex-direction:column;overflow:hidden;padding:22px 26px}" +
      ".t-col+.t-col{border-left:1px solid #cfcfcf}" +
      ".t-col-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;padding-bottom:14px;flex-shrink:0}" +
      ".t-scroll,.t-ladder{display:flex;flex-direction:column;overflow-y:auto;flex:1;padding:2px 8px 2px 2px;position:relative}" +
      ".card{background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;margin-bottom:11px;display:flex;align-items:flex-start;gap:13px;cursor:grab;box-shadow:0 1px 2px rgba(0,0,0,.06),0 3px 8px rgba(0,0,0,.07);transition:box-shadow .12s,transform .08s,opacity .1s;position:relative;touch-action:none}" +
      ".card:hover{box-shadow:0 3px 8px rgba(0,0,0,.1),0 8px 20px rgba(0,0,0,.12);transform:translateY(-1px)}" +
      ".card:active{cursor:grabbing}.card.ghost{opacity:.25}" +
      ".lab-task.ai-driving .t-main,.lab-task.ai-driving .t-main *{cursor:none!important}" +
      ".card-icon{font-size:17px;font-weight:800;width:26px;text-align:center;color:#0a0a0a;flex-shrink:0}" +
      ".card-txt{flex:1;min-width:0}.card-title{font-size:15px;font-weight:700}" +
      ".card-detail{font-size:13.5px;color:#383838;margin-top:3px;line-height:1.5}" +
      ".card-grip{color:#9a9a9a;font-size:15px;align-self:center;flex-shrink:0}" +
      ".t-slot{border-bottom:1px solid #cfcfcf;min-height:72px;display:flex;align-items:center;transition:background .08s}" +
      ".t-slot:last-child{border-bottom:none}" +
      ".t-slot.drop-target{background:#e6f6f2}" +
      ".t-slot-num{font-size:14px;font-weight:700;color:#565656;width:32px;text-align:center;flex-shrink:0}" +
      ".t-slot-lbl{font-size:13px;color:#565656;padding:0 8px}" +
      ".t-slot .card{flex:1;margin:9px 10px 9px 2px}" +
      ".t-ghost{position:fixed;pointer-events:none;z-index:9000;background:#fff;border:1px solid #cfcfcf;border-radius:10px;padding:14px 16px;display:none;align-items:flex-start;gap:12px;box-shadow:0 10px 32px rgba(0,0,0,.22)}" +
      ".t-ghost .card-icon{font-size:17px;font-weight:800}.t-ghost .card-title{font-size:15px;font-weight:700}.t-ghost .card-detail{font-size:13.5px;color:#383838;margin-top:3px}" +
      "#lab-05-cursor{position:fixed;left:0;top:0;width:26px;height:30px;z-index:9600;pointer-events:none;opacity:0;will-change:transform,opacity}" +
      "#lab-05-cursor svg{display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}" +
      "#lab-05-cursor .ring{position:absolute;left:-9px;top:-9px;width:22px;height:22px;border:2px solid #2563eb;border-radius:50%;opacity:0}" +
      "#lab-05-cursor.clicking .ring{animation:l5clickRing .4s ease}" +
      "@keyframes l5clickRing{from{opacity:.7;transform:scale(.4)}to{opacity:0;transform:scale(1.8)}}" +
      ".t-footer{border-top:1px solid #cfcfcf;padding:12px 28px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-shrink:0;flex-wrap:wrap}" +
      ".t-tune{display:flex;align-items:center;gap:20px;font-size:12.5px;color:#383838;flex-wrap:wrap}" +
      ".t-tune label{display:flex;align-items:center;gap:9px;font-weight:600;color:#565656}" +
      ".t-tune .opt{cursor:pointer}.t-tune .opt input{width:15px;height:15px;cursor:pointer}" +
      ".t-tune input[type=range]{-webkit-appearance:none;appearance:none;width:130px;height:4px;border-radius:4px;background:#cfcfcf;outline:none}" +
      ".t-tune input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#0a0a0a;cursor:pointer;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}" +
      ".t-tune input[type=range]::-moz-range-thumb{width:16px;height:16px;border:2px solid #fff;border-radius:50%;background:#0a0a0a;cursor:pointer}" +
      ".t-btn{padding:8px 18px;border-radius:7px;border:1px solid #cfcfcf;font-size:13.5px;font-weight:600;cursor:pointer;background:#fff;color:#0a0a0a}" +
      ".t-btn:disabled{opacity:.45;cursor:default}" +
      ".t-primary{background:#111;color:#fff;border-color:#111}.t-primary:disabled{background:#cfcfcf;border-color:#cfcfcf;color:#fff}" +
      ".t-empty{font-size:13.5px;color:#565656;text-align:center;padding:18px 0}" +
      ".t-results{position:absolute;inset:0;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:9800}" +
      ".t-results-card{background:#fff;border:1px solid #cfcfcf;border-radius:14px;box-shadow:0 14px 46px rgba(0,0,0,.2);padding:28px 32px;max-width:620px;width:90%}" +
      ".t-results-card h2{font-size:19px;font-weight:700;margin-bottom:4px}" +
      ".t-results-card .muted{color:#565656;font-size:13px;margin-bottom:18px}" +
      ".t-results-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:20px}" +
      ".t-rc-hd{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#565656;font-weight:700;margin-bottom:10px}" +
      ".t-rc-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}" +
      ".t-rc-row b{color:#565656;width:18px}.t-rc-row .ri{font-weight:800;width:18px;text-align:center}" +
      ".t-rc-row .ok{color:#157f3b;margin-left:auto;font-weight:800}.t-rc-row .err{color:#b00020;margin-left:auto;font-weight:800}";
    var st = document.createElement("style"); st.id = "lab-05-style"; st.textContent = css;
    document.head.appendChild(st);
  }
})();
