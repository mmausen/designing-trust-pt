# BDR x DFKI — Triage Prototype

A within-subjects HCI study prototype. Participants order six process steps per task
across four conditions, with varying degrees of AI assistance.

Flow: **consent → pre-survey → task × plan → post-survey → debrief**

Plain static HTML/CSS/JS — no build step, no dependencies. Each module is a global
(`window.Config`, `window.Tasks`, …) loaded in dependency order by `index.html`.

## Running it

```sh
npm install     # once
npm start       # → http://localhost:8080
```

`server.js` serves the prototype **and** collects the logs on the same origin — no
CORS, and the client can read the response to confirm each save. It must be served
over http either way: `main.js` fetches `strings.json` and `task_thought.json`, which
`file://` blocks.

Set a different port with `PORT=9000 npm start`.

**After editing any JS/CSS, bump the `?v=N` query on the `<script>`/`<link>` tags in
`index.html`.** The preview browser caches hard (the server sends no ETag) and will
otherwise serve stale code. These queries can be dropped when baking to a single file.

## Files

| File | Role |
|---|---|
| `server.js` | Serves the app **and** the `/collect-logs` collector that writes `logs/` |
| `logs/` | Participant data — session snapshots + the event stream (never web-readable) |
| `index.html` | All screens as `<section class="screen">`, toggled via `[hidden]` |
| `styles-accessible.css` | The active stylesheet |
| `strings.json` | **All interface text + the questionnaires**, `de` and `en` side by side |
| `task_thought.json` | Task content — 30 bilingual process-ordering tasks (A01–A30) |
| `_archive/` | The pre-merge single-language task files + the merge script |
| `js/config.js` | **Study settings** — conditions, task assignment, seed, endpoint |
| `js/i18n.js` | Active language + string lookup with cross-language fallback |
| `js/tasks.js` | Holds both languages; builds cards, correct order, AI suggestion, seeded shuffle |
| `js/store.js` | Session state, localStorage autosave, remote-POST stub |
| `js/flow.js` | The linear step machine |
| `js/survey.js` | Renders/validates the pre & post questionnaires |
| `js/task.js` | The ranking interaction: custom drag, AI gravity, autopilot |
| `js/results.js` | The final debrief grid |
| `js/main.js` | Boot: fetch content, consent, resume, wiring |

`styles.css` is an unreferenced leftover from an earlier version.

## Configuring a study

Everything you'd normally change lives in `js/config.js`.

**Conditions** (`CONDITIONS`) — `ai` picks the mechanic:

| `ai` | What the participant sees |
|---|---|
| `solo` | No assistance. Establishes that they understood the task. |
| `hint` | Picking up a step highlights the slot the AI suggests. |
| `thought` | The same highlight, plus the AI's reasoning shown at that slot. |
| `autopilot` | An AI cursor sorts all six steps; the participant then reviews and may rearrange. |
| `gravity` | Supported but unused — the drag is pulled toward the suggested slot. |

The AI never blocks the participant: in every condition the final order is theirs to
set, and `Confirm ranking` is the only way forward. Autopilot cannot be interrupted
mid-run (by design), but everything is editable once it finishes.

Autopilot behaviour is tuned by `AUTO` at the top of `js/task.js`. Two behaviours are
implemented but **switched off** for the study — set either to `true` to restore it:
`hesitate` (thinking pauses and second-guess approach curves) and `allowTakeover`
(participant input grabs the cursor back mid-run, as in the lab handoff experiment).

**Which task runs in which condition** (`CONDITION_TASKS`):

```js
const CONDITION_TASKS = {
  1: ["A01"],                         // AI suggests the correct order
  2: ["A02", "A07"],                  // repeats the condition — one stage per id
  3: [{ id: "A03", aiError: true }],  // AI suggests a WRONG order
  4: ["A04"],
};
```

With `aiError`, the AI's suggestion swaps that task's `scriptedError.swapKeys` pair —
a plausible-but-wrong recommendation, to observe whether participants catch it. It
flows into whichever mechanic the condition uses: the highlighted slot (`hint`), the
reasoning text (`thought` — the swapped pair gets the task's `wrongThought`), and the
places the autopilot drops steps into.

**Scoring is unaffected**: the original tile order stays ground truth, so accepting a
bad suggestion verbatim scores 4/6 with 0 overrides, while spotting and fixing it
scores 6/6 with 2 overrides. Inert on `solo` conditions.

**Tile shuffle** (`SHUFFLE_SEED`) — the inbox order is seeded, not random: identical
for every participant, different per task. Change the string to reshuffle all tasks
reproducibly.

**Surveys** — in `strings.json` under `surveys.pre` / `surveys.post`, per language.
Question types are `likert` (1–5) and `text`. **Question ids are data keys**: keep them
identical in `de` and `en`, or answers will land in different columns per participant.

**Data collection** (`ENDPOINT_URL`) — defaults to `/collect-logs`, the local collector
in `server.js`. Set `""` for localStorage-only, or an absolute URL for a hosted
collector. See *Saving data* below.

## Languages

German is the default (`I18n.DEFAULT_LANG`); a DE/EN switcher sits fixed top-right on
every screen.

All interface text lives in `strings.json` with **both languages side by side**, so a
missing or stale translation is obvious at a glance. Lookup is by dot path
(`I18n.t("ui.task.confirm")`); a key missing in the active language falls back to the
other one and logs a console warning rather than rendering blank.

**Switching is a live re-render, never a reload**, and it is safe by construction:
`task_thought.json` stores each task's *structure* once and only its *prose* per
language (see below). Card ids, the seeded shuffle, the participant's placements,
their survey answers and any scripted error therefore cannot vary by language — only
visible text changes.

Everything that follows the language hangs off a single `I18n.onChange` listener, so
any call to `I18n.set` repaints the whole UI; the switcher can never show a different
language than the screen does.

Because a mid-task switch is allowed, **the language is recorded as study data**:
`session.lang`, `lang` on every `task_start` and result, and a `language_switch` event
carrying the step it happened on — so participants who switched can be identified,
analysed separately, or excluded.

Adding a language: add a block to `strings.json`, add a matching key to each task's
`de`/`en` blocks, extend `LANGS` in `js/i18n.js`, and add a button to `#lang-switch`.

## Task content

`task_thought.json` is bilingual. **Structure is shared, prose is per language** — so
`id`, `tiles[].key` and `scriptedError.swapKeys` exist exactly once and *cannot*
diverge between languages. That matters: if `swapKeys` drifted, German and English
participants would get different scripted errors; if `tiles[].key` drifted, scoring
itself would differ by language. Neither would raise an error.

```jsonc
{
  "id": "A01",
  "de": { "title": "Die Post muss raus", "description": "…" },
  "en": { "title": "The Mail Has to Go Out", "description": "…" },
  "scriptedError": {
    "swapKeys": [3, 4],                    // ← SHARED: the pair swapped when aiError is on
    "de": { "pair": ["…","…"], "rationale": "…", "wrongThought": "…" },
    "en": { "pair": ["…","…"], "rationale": "…", "wrongThought": "…" }
  },
  "tiles": [{
    "key": 0,                              // ← SHARED: correct 0-based position
    "de": { "text": "Brief am Computer schreiben", "thought": "…" },
    "en": { "text": "Write the letter on the computer", "thought": "…" }
  }]
}
```

`js/tasks.js` flattens this into an ordinary single-language task on first use and
caches it per language, so the rest of the app never sees the bilingual layout.
`rationale` is documentation only — it explains why the scripted error is tempting and
is never shown to participants.

`tiles[].key` is the **correct 0-based position** and is the ground truth for all
scoring. `thought` / `wrongThought` are not surfaced in the UI yet.

## Saving data

Two layers, so a single failure never loses a participant:

1. **localStorage** — autosaved after every event, resumable on reload.
2. **`logs/` on the server** — the session is POSTed to `/collect-logs` at every step
   boundary, plus a `sendBeacon` flush on `pagehide`/`visibilitychange` so closing the
   tab mid-task doesn't lose the run.

The client always sends the **complete session**, which makes syncing self-healing: a
failed POST is repaired by the next one, so a network drop costs nothing. Verified by
killing the server mid-session — 12 events accumulated locally and were recovered
intact, in order, with no duplication (including the failed-sync records themselves).

The server writes two things:

- `logs/sessions/<participantId>.json` — the full session, rewritten each sync
  (atomically, via temp file + rename). **The record of truth.**
- `logs/events.jsonl` — append-only stream across participants, one event per line,
  tagged with `participantId`, `lang` and `serverTimestamp`. Only events the server
  hasn't seen are appended, so there are no duplicates.

> Two files, not one, because the client re-sends the whole session every time —
> blindly appending would grow quadratically. The snapshot's event count tells the
> server where to resume appending.

Writes are serialised per participant, so two concurrent step boundaries can't
interleave inside a line.

### Privacy and safety

- **`logs/` is blocked from HTTP** (403). It sits inside the served directory, so
  without that guard `GET /logs/<id>.json` would hand one participant another's data.
- **No IP address is ever recorded.** An IP is personal data under GDPR and would pull
  the study into heavier consent/retention obligations for no research benefit — the
  participant id already links the rows.
- `participantId` is sanitised before it touches a path — an id like `../../etc/foo`
  cannot escape `logs/`.
- `logs/.gitignore` keeps participant data out of version control.
- Errors return plain JSON; Express's default HTML error page leaks stack traces with
  absolute filesystem paths, which matters once the port is forwarded.

## Data

One session object, autosaved to `localStorage["bdr_triage_session"]`, resumable on
reload. `Store.download()` exports it as JSON from the console.

- `plan` — the expanded `[{level, taskId, aiError}]` stages
- `lang` — the language the session ran in (last selected)
- `surveys` — pre/post answers
- `results` — per task: `ranking`, `score` (/6, vs. the true order), `overrides`
  (deviations from the AI), `aiError`, `lang`, plus the timing block below
- `events` — timestamped log (`ts` absolute, `tRel` ms since page load):
  - session — `session_start`, `consent`, `session_resumed`, `session_end`, `dev_skip`,
    `language_switch` (which language, and at which step)
  - task — `task_start` (incl. `inboxOrder`, `aiSuggestion`, `aiSwappedKeys`), `task_confirm`
  - interaction — `drag_start`, `drag_drop`, `explainer_shown`, `explainer_dismissed`
  - AI — `hint_shown` (per pickup: which slot was hinted, whether reasoning was shown,
    and `isWrongHint`), `autopilot_start`, `ai_placement`, `autopilot_done`, `takeover`
    (only if `AUTO.allowTakeover` is on), and `ai_override` (per tile the participant
    moved away from the AI's suggestion — the key measure when `aiError` is on)
  - surveys — `survey_view`, `survey_submit`

### Task timing

The explainer opens *on top of* the task, so a single wall-clock number would fuse
"reading the instructions" with "doing the task" — and reopening the ⓘ button mid-task
would inflate it further. Each result (and `task_confirm`) therefore carries four
separate clocks:

| Field | Measures |
|---|---|
| `elapsedMs` | Total: task screen shown → Confirm. Includes reading and AI time. |
| `explainerMs` | Cumulative time the explainer was open (all opens summed) |
| `explainerOpens` | How many times it was opened — `> 1` means they went back to re-read |
| `workMs` | `elapsedMs − explainerMs` — **actual time on the task** |
| `timeToFirstActionMs` | First explainer dismissal → first drag (hesitation before acting) |
| `autopilotMs` | c4 only: how long the AI took to place all six |
| `reviewMs` | c4 only: autopilot finished → Confirm, i.e. **how long they reviewed the AI's result before signing it off** |

`workMs + explainerMs == elapsedMs` always holds. `explainer_shown` / `explainer_dismissed`
also carry `taskId`, `reopen`, and the per-open duration (`openMs`), so you can
reconstruct each reading episode individually rather than only the total.

`reviewMs` is the one to watch when `aiError` is on: near-zero means the participant
accepted the AI's order without inspecting it.

## Before the real study

- [ ] **Remove the `#dev-skip` button** — `index.html`, its CSS, and the handler in `main.js`
- [ ] Replace the placeholder consent text, condition labels/explainers, and both surveys
- [ ] Set `showCorrectnessFeedback: false` — the debrief currently reveals correct answers,
      a learning confound if participants ever repeat
- [ ] Keep `logs/` empty until the real runs (it is cleared now)
- [ ] Decide where the collector runs (port-forwarded machine vs. hosted) and confirm
      `logs/` is backed up — it is the only copy once a participant clears their browser
- [ ] Decide the counterbalancing — `buildOrder()` currently returns a fixed `[1,2,3,4]`
      for every participant
- [ ] Decide whether mid-task language switching is acceptable, or should be locked
      once a task starts (it is currently allowed and logged)
