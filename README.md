# BDR x DFKI — Triage Prototype

A within-subjects HCI study prototype. Participants order six process steps per task
across four conditions, with varying degrees of AI assistance.

Flow: **consent → pre-survey → task × plan → post-survey → debrief → end**

Two screens sit *outside* that flow:

- **Desktop gate** — shown instead of everything else on a touch device. The AI is
  embodied *as a cursor*, so a phone or tablet cannot run this study at all; this is a
  capability gate, not a layout problem a responsive tweak could fix. It keys off
  `(pointer: coarse)` / `(hover: none)` rather than screen width, so a desktop user
  with a small window is never blocked, and it re-checks on resize/orientation change.
- **End screen** — a terminal "Thank you for participating" reached by the button on
  the debrief. It has no way forward, so there is no doubt the session is over.

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
| `js/config.js` | **Study settings** — conditions, task assignment, seed, endpoint |
| `js/i18n.js` | Active language + string lookup with cross-language fallback |
| `js/tasks.js` | Holds both languages; builds cards, correct order, AI suggestion, seeded shuffle |
| `js/hints.js` | Registry of AI-hint designs; `js/hint_*.js` is one variant each |
| `js/store.js` | Session state, localStorage autosave, remote-POST stub |
| `js/flow.js` | The linear step machine |
| `js/survey.js` | Renders/validates the pre & post questionnaires |
| `js/task.js` | The ranking interaction: custom drag, AI cursor engine (handoff + autopilot) |
| `js/results.js` | The final debrief grid |
| `js/main.js` | Boot: fetch content, consent, resume, wiring |

## Configuring a study

Everything you'd normally change lives in `js/config.js`.

**Conditions** (`CONDITIONS`) — `ai` picks the mechanic:

| `ai` | What the participant sees |
|---|---|
| `solo` | No assistance. Establishes that they understood the task. |
| `hint` | The AI suggests where a step goes; `hint:` names which design does it (below). |
| `handoff` | **Shared cursor.** The participant works normally, but after `idleMs` of no input the AI takes the cursor and carries on; any input hands it straight back. Add `thoughts: true` to narrate its reasoning as it acts. |
| `autopilot` | An AI cursor sorts all six steps uninterrupted; the participant then reviews and may rearrange. |

### AI cursor settings (`Config.AI_CURSOR`)

Shared by `handoff` and `autopilot`. Any condition can override a value inline,
e.g. `{ ai: "handoff", speed: 40, hesitate: true }`.

| Key | Meaning |
|---|---|
| `speed` | 0–100 → cursor travel speed (maps to 230–3200 px/s) |
| `hesitate` | Thinking pauses and second-guess approach curves — makes the AI look deliberative |
| `idleMs` | `handoff` only: no input for this long → the AI steps in |
| `startGraceMs` | **Reading window** — the AI stays out for this long after the explainer is dismissed (default 5000) |
| `userSpeedControl` | Show the **participant** a speed slider in the footer |

> **On `startGraceMs`:** the explainer is dismissed at the same instant the task text
> first becomes visible, so without a pause the AI would be moving before anyone had
> read what the task is — and in `autopilot` the participant could miss the task
> entirely. During the window nothing moves: `handoff` cannot take over however idle
> the participant is, and `autopilot` has not started (its footer says so, and
> `autopilotMs` still measures only the sorting). The explainers tell participants the
> AI will step in "after a few seconds" rather than naming a number, so changing this
> value keeps them truthful. `0` disables the wait.

> **On `userSpeedControl`:** good for accessibility — fast cursor motion is genuinely
> disorienting for some people — but it makes AI speed a participant-controlled
> variable, so `workMs` stops being comparable across people and it may interact with
> perceived agency. Every change is logged (`ai_speed_changed`), and the value in force
> is stored on each result as `cursorSpeed`. Consider setting it `false` for the real
> study once piloting is done.

The two designs are **not** the same abstraction: a hint is a suggestion at pick-up
time, a handoff is shared control. That's why handoff is a mechanic rather than a hint
variant — forcing it into the `onPickUp` contract would have made that contract
meaningless. To A/B the two designs, swap the `ai:` value in `CONDITIONS`; both remain
fully working.

The AI never blocks the participant: in every condition the final order is theirs to
set, and `Confirm ranking` is the only way forward. Autopilot cannot be interrupted
mid-run (by design), but everything is editable once it finishes.

### Hint variants (A/B testing a design)

Competing hint designs live side by side so you can compare them without a branch,
and drop the loser without leftovers. Each variant is **one self-contained file**
registered by name; `task.js` calls the active one through a fixed interface and
never names a variant.

| Variant | File | Behaviour |
|---|---|---|
| `slot` | `js/hint_slot.js` | Highlights the slot the AI suggests |
| `slot-reasoning` | `js/hint_slot_reasoning.js` | That, plus the AI's stated reasoning |

A stage picks one in `CONDITIONS`, so swapping designs is a one-value change:

```js
2: { key: "c2", ai: "hint", hint: "slot" },
3: { key: "c3", ai: "hint", hint: "slot-reasoning" },
```

**Add** a variant: create `js/hint_<name>.js` calling `Hints.register(name, {...})`,
add its `<script>` tag, point a condition at it. The contract (`onPickUp`, optional
`onMove`/`onDrop`, required `clear`, plus its own `badgeKey`/`hintKey`) is documented
at the top of `js/hints.js`. The `ctx` it receives exposes the AI's suggestion — which
already carries any scripted error — but **never show `ctx.trueSlot`**: that's the
answer, and it exists for logging only.

**Remove** a variant: delete its file, its `<script>` tag, and any config naming it.
Nothing else refers to it. A stage pointing at a missing variant warns in the console
and simply renders no hint — it does not break the task.

The active variant is recorded on `task_start`, on each result (`hintVariant`), and on
every `hint_shown` event, so runs stay attributable to the design they used.

**Which task runs in which condition** (`CONDITION_TASKS`):

```js
const CONDITION_TASKS = {
  1: ["A01"],                         // AI suggests the correct order
  2: ["A02", "A07"],                  // repeats the condition — one stage per id
  3: [{ id: "A03", aiError: true }],  // AI suggests a WRONG order
  4: ["A04"],
};
```

Listing several ids repeats the condition, one stage per id. The **explainer opens by
itself only on the first stage of a condition** — it describes the mechanic, not the
task, so re-reading it before every repeat is friction. The ⓘ button reopens it at any
time, and `task_start` records `newSection` / `explainerAutoShown` so the difference is
visible in the data.

With `aiError`, the AI's suggestion swaps that task's `scriptedError.swapKeys` pair —
a plausible-but-wrong recommendation, to observe whether participants catch it. It
flows into whichever mechanic the condition uses: the highlighted slot (`hint`), the
reasoning text (each swapped tile gets its own `wrongThought`, arguing for the slot the
AI actually put it in), and the places the autopilot drops steps into.

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
    "de": { "pair": ["…","…"],             // ← both arrays are positional: [key 3, key 4]
            "rationale": "…",
            "wrongThought": ["…","…"] },   // ← one per swapped tile
    "en": { "pair": ["…","…"], "rationale": "…", "wrongThought": ["…","…"] }
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

**`pair` and `wrongThought` are positional arrays aligned to `swapKeys`**, so which tile
a sentence belongs to is fixed by the shared structure and cannot drift between
languages. `wrongThought` needs **one entry per swapped tile**: the swap moves both of
them, and each has to argue for *its own* wrong slot. A single shared sentence
inevitably speaks for the tile that jumps earlier ("I'll set the out-of-office note up
right away…"), so on the other tile it reads as a non sequitur — and a participant
reading the AI's reasoning would notice the seam rather than the error. (A plain string
is still accepted and applies to both tiles, but the two-entry form is the norm.)

`tiles[].key` is the **correct 0-based position** and is the ground truth for all
scoring. `thought` / `wrongThought` are not surfaced in the UI yet.

## Saving data

**Master switch: `CONFIG.loggingEnabled`.** With it `false`, no events are recorded and
nothing leaves the browser — no POST, no `sendBeacon` — so dry runs and demos never land
in the participant data. The session still runs and still autosaves to localStorage, so
the flow, resume and the debrief behave normally; the run simply leaves no file, and the
debrief drops its "uploaded" wording. Boot prints a console warning while it is off.
**It must be `true` for real runs.**

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
  (deviations from the AI), `aiError`, `lang`, `hintVariant`, the shared-control
  counts (`aiTakeovers`, `userTakebacks`, `placedByAi`, `cursorSpeed`,
  `cursorHesitate`), plus the timing block below
- `events` — timestamped log (`ts` absolute, `tRel` ms since page load):
  - session — `session_start`, `consent`, `session_resumed`, `session_end`, `dev_skip`,
    `language_switch` (which language, and at which step)
  - task — `task_start` (incl. `inboxOrder`, `aiSuggestion`, `aiSwappedKeys`), `task_confirm`
  - interaction — `drag_start`, `drag_drop`, `explainer_shown`, `explainer_dismissed`
  - AI (hint) — `hint_shown` (which slot was hinted, the variant, whether reasoning
    was shown, `isWrongHint`)
  - AI (cursor) — `handoff_armed` / `autopilot_armed` (stage ready, AI still holding
    off for `startGraceMs`), `autopilot_start` (the window has passed — it begins),
    `ai_took_over` / `user_took_back` (each with `nth`
    and `placedSoFar`, so the whole tug-of-war is reconstructable), `ai_placement`,
    `ai_thought_shown` (incl. `isWrongThought`), `handoff_done` / `autopilot_done`,
    `ai_speed_changed`
  - `ai_override` — per tile the participant moved away from the AI's suggestion; the
    key measure when `aiError` is on
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
| `autopilotMs` | c4 only: how long the AI took to place all six (the reading window is not counted) |
| `reviewMs` | c4 only: autopilot finished → Confirm, i.e. **how long they reviewed the AI's result before signing it off** |

`workMs + explainerMs == elapsedMs` always holds. `explainer_shown` / `explainer_dismissed`
also carry `taskId`, `reopen`, and the per-open duration (`openMs`), so you can
reconstruct each reading episode individually rather than only the total.

`reviewMs` is the one to watch when `aiError` is on: near-zero means the participant
accepted the AI's order without inspecting it.

## Before the real study

- [ ] Confirm `CONFIG.devSkip` is `false` — it hides the bottom-right "Skip ▸" button
      that jumps past stages (already the default)
- [ ] Confirm `CONFIG.loggingEnabled` is `true` — with it off a completed session leaves
      no file at all (already the default; the console warns on boot when it is off)
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
