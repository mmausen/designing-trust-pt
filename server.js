/* ═══════════════════════════════════════════════════════════════════
   COLLECTOR — serves the prototype and saves each session to ./logs.

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
});
