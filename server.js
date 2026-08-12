/* ═══════════════════════════════════════════════════════════════════
   COLLECTOR — serves the prototype, hands out balanced study groups, and
   saves each session to ./logs.

   Two endpoints:
     POST /assign-group  → the least-used of G1…G4 (see the ledger below).
                           This is the study's randomisation; without it the
                           client falls back to a local coin flip.
     POST /collect-logs  → session snapshot + event stream.

   Grown from a minimal express append-to-JSONL example, with four changes
   that the prototype's data shape forces:

   1. The client POSTs the WHOLE session at every step boundary (not new
      rows), so blindly appending would duplicate everything quadratically.
      The per-participant snapshot is the source of truth; only events the
      server has not seen yet are appended to the JSONL stream.
   2. One file per participant instead of one shared file, so two people
      running at once can never interleave inside a line.
   3. participantId is sanitised before it touches a path — an id like
      "../../etc/foo" must not escape ./logs.
   4. The JSON body limit is raised; a full 30-task session blows past
      express.json()'s 100 kb default and would start silently failing.

   No IP address is recorded anywhere (see below).

   Run:  npm install && npm start        (or: PORT=8080 node server.js)
   ═══════════════════════════════════════════════════════════════════ */
const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PORT = process.env.PORT || 8080;
const LOG_DIR = path.join(__dirname, "logs");
const SESSION_DIR = path.join(LOG_DIR, "sessions");
const EVENT_LOG = path.join(LOG_DIR, "events.jsonl");
const GROUP_FILE = path.join(LOG_DIR, "groups.json");

/* ═══ balanced group assignment ═══════════════════════════════════════
   The study is between-subjects and unattended: each participant runs ONE
   of the AI interactions, and the four cells have to come out even without
   anyone watching. Random per participant does not deliver that at n ≈ 40,
   so the tally lives here and every participant is handed the least-used
   group (ties broken at random).

   MUST match the keys of Config.GROUPS in js/config.js. Override without
   editing this file:  BDR_GROUPS=G1,G2,G3,G4,G5 node server.js */
const GROUPS = (process.env.BDR_GROUPS || "G1,G2,G3,G4")
  .split(",").map(s => s.trim()).filter(Boolean);

/* What counts towards a group's tally:
     - every FINISHED session, forever
     - every assignment still in flight, until it expires
   The expiry is what makes this dropout-proof. Someone who is handed G3 and
   closes the tab during the pre-survey holds the slot only until the window
   passes, after which the next participant can be sent to G3 — so the four
   cells even out in COMPLETED participants, which is what the analysis
   needs. Sessions forced from the dev picker never count at all. */
const RESERVE_MS = Number(process.env.BDR_RESERVE_MS || 45 * 60 * 1000);

/* No IP address is ever recorded. An IP is personal data under GDPR and
   would pull this study into heavier consent/retention obligations for no
   research benefit — the participant id already links the rows. */

fs.mkdirSync(SESSION_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "25mb" }));

/* The logs live inside the served directory, so serve nothing from them —
   otherwise GET /logs/<id>.json hands one participant another's data. */
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path).replace(/\\/g, "/");
  if (/^\/(logs|_archive|node_modules)(\/|$)/.test(p) || p.includes("..")) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  next();
});
app.use(express.static(__dirname, { dotfiles: "ignore", index: "index.html" }));

/* participantId → a safe, non-empty filename stem. */
function safeId(raw) {
  const id = String(raw == null ? "" : raw).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return id || "unknown";
}

/* Serialise writes per participant: two step boundaries can arrive close
   together, and read-then-write must not interleave. */
const chains = new Map();
function queue(id, job) {
  const prev = chains.get(id) || Promise.resolve();
  const next = prev.then(job, job);
  chains.set(id, next.catch(() => {}));
  return next;
}

// Write via temp file + rename so a crash can never leave a half-written snapshot.
async function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

/* ── the group ledger (logs/groups.json) ──────────────────────────────
   One record per participant: { group, at, completedAt, dev, source }.
   Every read-modify-write runs on the single "__groups__" chain, so two
   participants arriving in the same millisecond cannot both read a tally of
   3/3/3/3 and both be sent to the same cell. */
async function readGroups() {
  try {
    const g = JSON.parse(await fsp.readFile(GROUP_FILE, "utf8"));
    if (g && typeof g.records === "object" && g.records) return g;
  } catch (e) { /* first run */ }
  return { version: 1, records: {} };
}

function tally(records, now) {
  const counts = Object.fromEntries(GROUPS.map(g => [g, 0]));
  const detail = Object.fromEntries(GROUPS.map(g => [g, { completed: 0, pending: 0, dev: 0 }]));
  for (const rec of Object.values(records)) {
    if (!(rec.group in counts)) continue;          // a group that no longer exists
    if (rec.dev) { detail[rec.group].dev++; continue; }
    if (rec.completedAt) { counts[rec.group]++; detail[rec.group].completed++; }
    else if (now - rec.at < RESERVE_MS) { counts[rec.group]++; detail[rec.group].pending++; }
  }
  return { counts, detail };
}

/* Assign — or return the group this participant already holds. Idempotent on
   purpose: a reload during the consent screen must not consume a second slot. */
async function assignGroup(id) {
  return queue("__groups__", async () => {
    const now = Date.now();
    const g = await readGroups();
    const existing = g.records[id];
    if (existing && GROUPS.includes(existing.group)) {
      return { group: existing.group, reused: true, counts: tally(g.records, now).counts };
    }
    const { counts } = tally(g.records, now);
    const min = Math.min(...GROUPS.map(k => counts[k]));
    const candidates = GROUPS.filter(k => counts[k] === min);
    const group = candidates[Math.floor(Math.random() * candidates.length)];

    g.records[id] = { group, at: now, completedAt: null, dev: false, source: "server" };
    await writeAtomic(GROUP_FILE, JSON.stringify(g, null, 2));
    return { group, reused: false, counts: tally(g.records, now).counts };
  });
}

/* Keep the ledger honest with what actually happened. Called on every sync,
   so it also picks up sessions the server never assigned (the client's local
   fallback when this endpoint was unreachable) and sessions forced from the
   dev picker, which are recorded but excluded from the tally. */
async function noteSessionGroup(id, group, source, startedAt, completed) {
  if (!group) return;
  return queue("__groups__", async () => {
    const now = Date.now();
    const g = await readGroups();
    const rec = g.records[id] || {
      group, at: Date.parse(startedAt) || now, completedAt: null, dev: false, source: source || "unknown",
    };
    rec.group = group;                       // the dev picker may have changed it mid-session
    if (source) rec.source = source;
    if (source === "dev") rec.dev = true;    // sticky: a forced session never re-enters the tally
    if (completed && !rec.completedAt) rec.completedAt = now;
    g.records[id] = rec;
    await writeAtomic(GROUP_FILE, JSON.stringify(g, null, 2));
  });
}

app.post("/assign-group", async (req, res) => {
  const id = safeId(req.body && req.body.participantId);
  try {
    const out = await assignGroup(id);
    res.json({ ok: true, participantId: id, ...out });
  } catch (err) {
    console.error("assign failed for", id, err);
    res.status(500).json({ ok: false, error: "assign failed" });
  }
});

// How the cells are filling up — check this mid-study rather than counting files.
app.get("/assign-group/status", async (_req, res) => {
  const g = await readGroups();
  const now = Date.now();
  const { counts, detail } = tally(g.records, now);
  res.json({
    ok: true, groups: GROUPS, reserveMs: RESERVE_MS,
    counts, detail, participants: Object.keys(g.records).length,
  });
});

app.post("/collect-logs", async (req, res) => {
  const session = req.body;
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return res.status(400).json({ ok: false, error: "expected a session object" });
  }

  const id = safeId(session.participantId);
  const snapshot = path.join(SESSION_DIR, id + ".json");
  const receivedAt = new Date().toISOString();
  const events = Array.isArray(session.events) ? session.events : [];

  try {
    const appended = await queue(id, async () => {
      // How many of this participant's events are already on disk?
      let known = 0;
      try {
        const prev = JSON.parse(await fsp.readFile(snapshot, "utf8"));
        known = Array.isArray(prev.events) ? prev.events.length : 0;
      } catch (e) { /* first sync for this participant */ }

      // Snapshot first: it is the record of truth and is idempotent, so a
      // dropped request is healed by the next one (each carries everything).
      await writeAtomic(snapshot, JSON.stringify(
        { ...session, receivedAt, savedBy: "collector/1" }, null, 2
      ));

      // Then append only what is new, one JSON object per line.
      const fresh = events.slice(known);
      if (fresh.length) {
        const lines = fresh.map(ev => JSON.stringify({
          participantId: id,
          lang: session.lang,
          ...ev,
          serverTimestamp: receivedAt,
        })).join("\n") + "\n";
        await fsp.appendFile(EVENT_LOG, lines, "utf8");
      }
      return fresh.length;
    });

    // Outside the per-participant chain: it writes a different file on its own
    // chain, and a ledger hiccup must never fail a data sync.
    try {
      await noteSessionGroup(id, session.group, session.groupSource, session.startedAt, !!session.completed);
    } catch (e) { console.error("group ledger update failed for", id, e); }

    res.json({ ok: true, participantId: id, totalEvents: events.length, appendedEvents: appended });
  } catch (err) {
    console.error("save failed for", id, err);
    res.status(500).json({ ok: false, error: "write failed" });
  }
});

// Quick check that the collector is alive and where it is writing.
app.get("/collect-logs/health", async (_req, res) => {
  let sessions = 0;
  try { sessions = (await fsp.readdir(SESSION_DIR)).filter(f => f.endsWith(".json")).length; }
  catch (e) { /* none yet */ }
  res.json({ ok: true, logDir: LOG_DIR, sessions });
});

/* Clean JSON errors. Without this, malformed JSON or an oversized body gets
   Express's default HTML page — including a stack trace with absolute
   filesystem paths, which should never leave a machine that is port-forwarded. */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("collector error:", err.message);
  res.status(status).json({
    ok: false,
    error: status === 413 ? "payload too large"
         : status === 400 ? "malformed JSON"
         : "server error",
  });
});

app.listen(PORT, () => {
  console.log(`BDR x DFKI — prototype + collector on http://localhost:${PORT}`);
  console.log(`saving sessions to ${SESSION_DIR}`);
  console.log(`appending events to ${EVENT_LOG}`);
  console.log(`balancing groups ${GROUPS.join("/")} in ${GROUP_FILE} (reserve ${Math.round(RESERVE_MS / 60000)} min)`);
});
