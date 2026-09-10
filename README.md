# BDR x DFKI — Triage Prototype

A **mixed-design** HCI study prototype. Participants act as caseworkers: each task
presents six incoming public-administration cases, to be **ranked by urgency**. They run
the unassisted baseline rounds first, then **both** AI mechanics, one block each.

| Factor | Type | Levels |
|---|---|---|
| **AI character** | between subjects | `bold` · `cautious` |
| **Mechanic order** | within subjects, counterbalanced | hidden-first · handoff-first |

Crossing them gives four setups; one is fixed per build (`FIXED_GROUP`):

| Setup | Character | Block 1 | Block 2 |
|---|---|---|---|
| **G1** | bold | hidden | handoff |
| **G2** | bold | handoff | hidden |
| **G3** | cautious | hidden | handoff |
| **G4** | cautious | handoff | hidden |

The two **mechanics** are the interaction itself — every participant meets both:

| Mechanic | What the participant sees |
|---|---|
| `handoff` | Shared cursor; the AI takes over while your cursor rests in the activation zone |
| `hidden` | A "Start AI" button; one press places every case at once |

The **character** is the AI's strategy, unchanging for a whole session:

| Character | Principle | Ranks like |
|---|---|---|
| `bold` | "act quick and move forward" | decisive, efficient, more willing to let a subtle concern through |
| `cautious` | "better safe than sorry" | thorough, risk-averse, more willing to spend attention on a low-risk case |

Every task in `tasks.json` carries an authored `ai-order` for **each** character, so it
changes what the AI recommends in every round. One character holds all session on
purpose: the point is that a participant can build a mental model of how this AI
prioritises, which a per-round switch would destroy.

> **There is no correct order.** These are priority judgements, not process sequences, so
> nothing is scored. The only ranking measure is `overrides` — how far the participant's
> final order departs from the AI's. The debrief shows the participant no feedback at all.

Flow: **Prolific ID → pre-survey → baseline rounds → AI block 1 → mid-survey
→ AI block 2 → post-survey → debrief → end**. Each block opens with its own onboarding
for the mechanic it introduces; later rounds in the same block go straight to work.
**Every non-task step can be switched off** in `Config.STEPS` — see below.

Plain static HTML/CSS/JS — no build step, no dependencies. Each module is a global
(`window.Config`, `window.Tasks`, …) loaded in dependency order by `index.html`.

## Running it

```sh
npm install     # once
npm start       # → http://localhost:8080
```

`server.js` serves the prototype **and** collects the logs on the same origin — no
CORS, and the client can read the response to confirm each save. It must be served
over http either way: `main.js` fetches `strings.json`, `tasks.json` and
`cursors.json`, which `file://` blocks.

Set a different port with `PORT=9000 npm start`.

**After editing any JS/CSS, bump the `?v=N` query on the `<script>`/`<link>` tags in
`index.html`.** The preview browser caches hard (the server sends no ETag) and will
otherwise serve stale code. These queries can be dropped when baking to a single file.

<details>
<summary><b>Two screens sit outside the flow</b> — the desktop gate and the end screen</summary>

- **Desktop gate** — shown instead of everything else on a touch device. The AI is
  embodied *as a cursor*, so a phone or tablet cannot run this study at all; this is a
  capability gate, not a layout problem a responsive tweak could fix. It keys off
  `(pointer: coarse)` / `(hover: none)` rather than screen width, so a desktop user
  with a small window is never blocked, and it re-checks on resize/orientation change.
- **End screen** — a terminal "Thank you for participating" reached by the button on
  the debrief. It has no way forward, so there is no doubt the session is over.

</details>

<details>
<summary><b>What each file does</b></summary>

| File | Role |
|---|---|
| `server.js` | Serves the app and collects logs (`/collect-logs`) |
| `logs/` | Participant data — session snapshots, the event stream, and the group ledger (never web-readable) |
| `index.html` | All screens as `<section class="screen">`, toggled via `[hidden]` |
| `styles-accessible.css` | The active stylesheet |
| `strings.json` | **All interface text + the questionnaires**, `de` and `en` side by side |
| `tasks.json` | Task content — 13 bilingual prioritisation tasks (T1–T13), each with a per-character `ai-order` |
| `cursors.json` | The AI cursor's motion presets, one per character — the seven dials this build implements |
| `moveMe/gym/` | The **Cursor Gym**: the sandbox those presets were tuned in. Its own repo, kept beside the prototype — not tracked here, and not part of the study build |
| `js/config.js` | **Study settings** — groups, rounds, task assignment, seed, endpoints |
| `js/groups.js` | Draws this participant's group from the server; local fallback + dev override |
| `js/i18n.js` | Active language + string lookup with cross-language fallback |
| `js/tasks.js` | Holds both languages; builds cards, the AI suggestion per character, seeded shuffle |
| `js/store.js` | Session state, localStorage autosave, sync to the collector |
| `js/flow.js` | The linear step machine |
| `js/survey.js` | Renders/validates the pre & post questionnaires |
| `js/cursor.js` | The AI cursor's motion **character** — seven tuned dials, driven by `cursors.json` |
| `js/task.js` | The ranking interaction: custom drag, the AI cursor engine (handoff), the one-second flight (hidden) |
| `js/results.js` | The final debrief screen (no feedback — see the note above) |
| `js/main.js` | Boot: fetch content, resume offer, wiring |
| `js/prolific.js` | The optional Prolific-ID step |

</details>

## Configuring a study

Everything you'd normally change lives in `js/config.js`.

**The design** — a baseline everyone runs, the two mechanics, and the four setups that
pair a character with a mechanic order:

```js
const BASELINE  = { key: "c1", ai: "solo", teachBoard: true };   // unassisted rounds

const MECHANICS = {                  // the interactions — everyone meets both
  handoff: { key: "handoff", ai: "handoff" },
  hidden:  { key: "hidden",  ai: "hidden"  },
};

const GROUPS = {                     // the four setups; FIXED_GROUP picks one
  G1: { character: "bold",     order: ["hidden", "handoff"] },
  G2: { character: "bold",     order: ["handoff", "hidden"] },
  G3: { character: "cautious", order: ["hidden", "handoff"] },
  G4: { character: "cautious", order: ["handoff", "hidden"] },
};
```

A group no longer names a mechanic — it fixes the **character** and the **order**, and
`buildTaskPlan(group)` spends both to lay out the rounds. Each plan entry then carries its
own `mechanic`, so `conditionFor(step)` resolves the interaction per round rather than per
session. `conditions.<key>` in `strings.json` is keyed by **mechanic** (`c1`, `handoff`,
`hidden`), not by group, since both groups sharing an order share their wording.

One switch describes every group. `ai` picks the mechanic:

| `ai` | What the participant sees |
|---|---|
| `solo` | No assistance. Establishes that they understood the task. |
| `handoff` | **Shared cursor.** The participant works normally, but while the cursor rests inside the activation zone the AI takes the cursor and carries on; leaving the zone hands it straight back. It works **strictly down its own ranking** — the case it rates first, then second, on to sixth — so the sequence of its moves is readable as its priority order. |
| `hidden` | **No cursor.** That same block under the board is a "Start AI" button instead. One press and every step flies from wherever it currently sits — inbox or ladder, already-sorted or not — to the slot the AI chose, all at once, linearly, in `Config.HIDDEN_PLACE_MS` (1000 ms). It runs once per task: like the handoff zone, the button retires when the board is full. |

The two AI mechanics deliberately share a layout and a lifecycle — the same block in the
same place under the board, the same review phase afterwards, the same footer line once
the board is full (`ui.task.aiDone`). What differs is only how control changes hands:
hover-and-hold versus one press.

### What the AI does about a slot you already filled

`Config.PLACEMENT_STYLE` — `"A"`, `"B"` or `"C"`, with a picker in the dev bar that
overrides it for testing and sticks across rounds. It applies to **both mechanics**. It is a
placement *policy*, not cursor motion — both characters use whichever style is set, and it
is not part of a setup (G1–G4).

| | |
|---|---|
| **A** *(default)* | **Override.** The AI places its case in the slot it wants; whatever sat there returns to the inbox. Its ranking always comes out intact; your work can be undone. |
| **B** | **Defer.** It skips any case whose slot is taken, carries on down its ranking, and finishes once nothing is left that it can place without overriding. It never undoes you, and may leave the board part-empty for you to finish. |
| **C** | **Defer, then override.** Style B's pass first, so everything that fits alongside you lands first — then it goes back and takes the contested slots anyway, filling the board. |

**A and C end with the same board**; they differ in the order you watch it happen, which
is the point. **B is the only one that leaves your placements standing.**

Worked example — you put the AI's 6th-ranked case in slot 2 and its 5th in slot 4, then
hand over. Ranking is `t2 t0 t1 t3 t5 t4`:

| | what the AI does | it ends with |
|---|---|---|
| A | `t2→1`, `t0→2` *(evicts t4)*, `t1→3`, `t3→4` *(evicts t5)*, `t5→5`, `t4→6` | the full ranking |
| B | `t2→1`, `t1→3`, then stops | `t2 · your t4 · t1 · your t5 · — · —`, two cases left in your inbox |
| C | `t2→1`, `t1→3`, `t0→2` *(evicts t4)*, `t4→6`, `t3→4` *(evicts t5)*, `t5→5` | the full ranking |

C's interleaving is the rule working as intended: a case the AI evicts returns to the
inbox and is picked up again **at its own position**, so it goes straight into its own
empty slot before the next contested one is taken.

**In the hidden mechanic** the same styles decide *which cases fly* on the one press:

| | |
|---|---|
| A | every case travels, from wherever it sits, over anything you had arranged |
| B | only cases still in the **inbox**, and only into slots you left **empty**. Everything you placed stays put, and the board can be left part-full |
| C | identical to A here — C means "what fits first, *then* the contested slots", and that is an **order**; a one-shot flight has no order to watch, so its end state is A's |

Under B a case whose slot you took stays in the inbox, and a case you placed is never
relocated even if the AI would rather have it elsewhere — the same rule the handoff cursor
follows, where the AI only ever picks up from the inbox. If nothing can move at all, the
press lands immediately rather than freezing the board for a second while nothing happens.
`hidden_done` records `boardFull` and the `placementStyle`, as `handoff_done` does.

Under B the round can end with the board part-empty, so the footer says
`ui.task.aiStopped` — "placed every case it could without changing what you had already
placed" — rather than claiming a finished board. `reviewMs` stays null in that case: there
is no finished order to review. Each result records the `placementStyle` that ran, and
`handoff_done` carries it alongside `boardFull`.

> **Both characters place in ranking order** (changed 2026-09-09). The handoff cursor used
> to reach for whichever case sat *nearest*, which is cheaper to travel but hid the AI's
> priority order behind the accident of where the cases happened to lie. It now goes for
> its top-ranked case first and works down to sixth, so a participant can read the
> ordering off the sequence of its moves — which is the thing they are being asked to
> form a view about. If the slot it wants is already occupied, the occupant returns to the
> inbox and is picked up again at its own position; each placement is final, so it still
> converges in at most six. The hidden mechanic already committed the whole ranking at
> once, so it is unchanged.

There is no longer a `thoughts` switch: **the AI never explains itself**. The
`#ai-thought` panel, `Config.explainsItself()`, the `ai_thought_shown` event, the
`showsReasoning` result field, `Tasks.thoughtFor()` and the `*-thoughts` strings are all
gone. The AI's recommendation is set by `CHARACTER` instead, which is a session-wide
setting rather than a group.

`teachBoard` is the baseline's alone: it marks the stage that introduces the board, so
the first round's onboarding hides the ladder column and reveals it as the participant
steps through. By the AI rounds the board is familiar and both columns stay put.

Adding or removing a setup is a one-entry edit: add its text under `conditions.<key>` in
`strings.json` (both languages). The server has no group list to keep in step any more.

**Rounds and which task runs in each** (`BASELINE_TASKS`, `TASK_BLOCKS`):

```js
const BASELINE_TASKS = ["T1", "T2", "T3"];        // unassisted, everyone

const TASK_BLOCKS = [                             // an ARRAY: its order IS the running order
  { name: "blockA", tasks: ["T4", "T5", "T6", "T7", "T8"] },
  { name: "blockB", tasks: ["T9", "T10", "T11", "T12", "T13"] },
];
```

**One entry = one round**, in the order listed — that is where you set how many rounds
each block runs.

**Every participant meets the same tasks in the same order**, whatever group they drew:

```
T1 T2 T3   T4 T5 T6 T7 T8   T9 T10 T11 T12 T13
└ baseline ┘└─  block 1  ─┘└─────  block 2  ────┘
```

`TASK_BLOCKS` is an array rather than a map precisely so this cannot drift: block `[0]`
runs first and block `[1]` second, and nothing in `buildTaskPlan` consults the group when
choosing them.

What the group counterbalances is **which mechanic sits on each block**:

| | block 1 — `blockA` | block 2 — `blockB` |
|---|---|---|
| G1, G3 | hidden | handoff |
| G2, G4 | handoff | hidden |

So each block of tasks meets **both** mechanics across participants, which is what lets a
mechanic effect be told apart from a content effect. Tying content to a mechanic instead
would make whatever is special about `blockA` permanently a property of that mechanic —
which is why there is no switch for it.

Every round still records its `taskBlock`, so the analysis never has to re-derive which
content set a round came from.

The study plan marks **T6 and T11** as the tasks whose AI recommendation is questionable —
one in each block, so a participant meets one under each mechanic either way.

**There is no per-round AI-error flag.** It used to be `{ id, aiError: true }`, which
swapped a task's `scriptedError.swapKeys` pair to manufacture a plausible-but-wrong
recommendation. That whole mechanism is gone: with no correct order there is nothing to
swap *away from*, so a questionable recommendation is now simply authored into that
task's `ai-order`. Nothing in the code marks such a task, and nothing scores the result —
`overrides` (how far the participant departed from the AI) is the only ranking measure.

**Which steps run** (`CONFIG` → `STEPS`) — every non-task step is optional:

```js
const STEPS = {
  prolificId: true,   // ask for the participant's Prolific ID, and log it
  preSurvey:  true,   // questionnaire before the first task
  midSurvey:  true,   // questionnaire between the two AI blocks
  postSurvey: true,   // questionnaire after the last task
};
```

The task rounds are never optional. `Flow.build()` simply leaves the disabled steps out,
and each session snapshots the switches it ran under (`session.steps`), so a run stays
interpretable after the toggles change — "no pre-survey answers" then reads as *the step
was off*, not as missing data.

There is **no consent screen** — it was removed on 2026-09-08 along with its `consent`
event and strings. The flow opens on whatever the first enabled step is; consent is handled
outside the prototype.

**Resume is independent of all of them.** An interrupted session gets its own screen,
shown ahead of whatever the first one would have been, rather than riding on whichever
slide happens to come first. `Resume` returns to the exact saved step; `Start new`
discards the session (archiving it — see *Nothing is overwritten* below) and continues.

> ⚠️ **Changing a switch invalidates any session saved under the old set.** `currentStep`
> indexes the steps array whose shape these switches decide, so resuming across a change
> would land on the wrong step. The offer is refused with a console warning instead —
> finish or discard a pilot session before flipping one.

The **mid-survey** sits on the seam between the two AI blocks — it asks about the mechanic
just finished, so it lands before the next one introduces itself. Its questions live in
`strings.json` under `surveys.mid`, in the same shape as `pre` and `post`.

**Prolific ID** (`STEPS.prolificId`) — a screen asking for the participant's Prolific ID,
stored on the session as `prolificId` and logged. It deliberately does **not** become the
`participantId`: that names the participant's **folder** under `logs/`, and is generated
before this screen is reached, so letting typed text take that role would put user input
on the filesystem as a path. The two ride side by side instead.
**There is no format check.** Any non-empty value is taken as given: a guess about
Prolific's format is not worth nagging a recruited participant at the door, and matching
ids against Prolific's own records is an analysis job. Only `length` is logged, never a
verdict.

**Tile shuffle** (`SHUFFLE_SEED`) — the inbox order is seeded, not random: identical
for every participant, different per task. Change the string to reshuffle all tasks
reproducibly.

**Character** — `"bold"` or `"cautious"`, named by the group and pinned onto each
session at creation, so a mid-study edit can never retroactively change a running
participant's condition. It drives two things:

* **What the AI recommends** — the task's `ai-order` for that character (`tasks.json`).
* **How its cursor moves** — a motion profile in `cursors.json`, applied by
  `js/cursor.js`. See *AI cursor character* below.

The motion half is visible in the **handoff** mechanic only. The hidden one shows an
outcome, not a process: six tiles fly at one constant speed with no cursor at all. That
difference is deliberate — it is most of what separates the two mechanics.

**Surveys** — in `strings.json` under `surveys.pre` / `surveys.post`, per language.
Question types are `likert` (1–5) and `text`. **Question ids are data keys**: keep them
identical in `de` and `en`, or answers will land in different columns per participant.

**Data collection** (`ENDPOINT_URL`) — defaults to `/collect-logs`, the local collector
in `server.js`. Set `""` for localStorage-only, or an absolute URL for a hosted
collector. See *Saving data* below.

### The onboarding tile

Every condition opens with a short **stepped onboarding** — one idea per tile, dismissed
with OK — held in `strings.json` under `conditions.<key>.onboarding` as an array of
`{ body, ok }`. G1 and G2 each explain their AI in three steps, following the same shape
(what the AI does → how it works → who decides) so the wording differs only where the
condition itself does.

Task 1 (`teachBoard`) instead introduces the screen **one region at a time**: while a
step is up, the region it talks about is the only one showing — the task brief alone,
then the inbox, then the ladder. The brief is never hidden; it simply stands alone while
both columns are, which is also why its step can promise it stays put.

> That mapping is **positional** — step 0 is the brief, step 1 the inbox, the last step
> the ladder — so c1's `onboarding` entries have to stay in that order, in both
> languages. It is the one place where the order of strings carries behaviour;
> `BOARD_INTRO` in `js/task.js` is the other half of it.

It **opens by itself only on the first round of a stage** — it describes the interaction,
not the task, so re-reading it before every round is friction. The ⓘ button reopens it
at any time, as one combined window rather than a re-run of the sequence. `task_start`
records `newSection` / `explainerAutoShown`, and each OK logs `explainer_step`, so the
reading path is visible in the data.

<details>
<summary><b>AI cursor character</b> (<code>cursors.json</code>, <code>js/cursor.js</code>) — how bold and cautious move</summary>

The handoff cursor's motion is a **tuned character**, not a speed setting. Each dial is a
toggle and one number, reaching the engine only through `Cursor.k(id)`, which returns `0`
when the toggle is off. Every dial off collapses to a plain min-jerk straight line, so a
missing or broken preset degrades to bland motion rather than to a broken cursor.

The dials, the parameter ids and the maths all come from the **Cursor Gym**
(`moveMe/gym`), the sandbox the two characters were actually tuned in. What did *not*
come across, deliberately: its take-over modes (the prototype has its own activation
zone) and its sorting strategies (the AI here does not choose *what* to place — that is
the task's `ai-order`). A preset's `strategy` field is read and ignored.

**Six of the gym's fifteen dials are implemented here** — these set the *shape* of the
motion, and are the part you can still tune in the gym:

| | |
|---|---|
| `B1` | velocity profile shape — flat ↔ impulse & glide |
| `B3` | submovement count — undershoot, then corrections |
| `B5` | coherent noise — smooth drift on the drawn glyph |
| `B8` | forethought & reaction **beats** — pull back before going, settle after |
| `A8` | path curvature bias — jagged ↔ smooth arc |
| `B10` | competing-target pull — leans toward the case it did not pick |

**Two more settings sit outside `params`**, because they are milliseconds rather than
0…1 knobs and the gym has no equivalent:

```json
"travel":     { "baseMs": 299, "slopeMs": 425.5 },
"afterPlace": { "seconds": 2.5, "jitter": 0.5 }
```

`travel` is the character's **pace** — a leg takes `baseMs + slopeMs × log2(distance /
target width + 1)`, so a 630 px reach at those numbers is about 1.6 s. Raise both to slow
the character overall; raise only `slopeMs` to make long reaches disproportionately slower
than short ones. Both fall back to the gym's 130 / 185 when absent, so a raw gym export
travels at gym pace.

> **`travel` replaced the `A9` dial on 2026-09-08.** A9 scaled a baseline shared by both
> characters, so at its floor (−1) a character could get no slower — which is exactly
> where cautious had ended up. Stating the constants outright has no such floor, and any
> A9 setting is expressible as a `travel` pair, so nothing was lost.
>
> **The cost is real:** pace is now the one thing the gym *cannot* tune. Shape still
> transfers exactly; speed must be set by editing these two numbers and reloading.

> **No dial lengthens a pause — the pauses are `afterPlace` and the two fixed dwells.**
> `B8` looks like it should, and does not: its beats are small *movements* around a
> placement (a pull-back before reaching, a 5–16 px drift after releasing), never a hold.
> The holds are the two `MOTION` dwells — 140 ms over a case before lifting, 120 ms over
> a slot before releasing, the same for both characters — and `afterPlace`, below.
> (`B13` scaled those two dwells and was implemented for part of 2026-09-08; it lengthens
> the hold *before* an action, which turned out not to be the wanted one.)

> **The pause after a placement is `afterPlace`**, authored in `cursors.json` outside
> `params` because nothing in the gym reaches that moment:
>
> ```json
> "afterPlace": { "seconds": 1.0, "jitter": 0.5 }
> ```
>
> Each placement draws its own wait — `seconds` give or take `jitter` of itself, uniform.
> `1.0 ± 50%` is 0.5–1.5 s, redrawn six times a round, because a fixed pause repeated six
> times reads as a machine ticking rather than as someone taking a moment. `jitter: 0`
> gives exactly `seconds`; `seconds: 0` or the key missing gives no wait at all, which is
> why a raw gym export still behaves exactly as it does in the gym.
>
> It sits outside `params` deliberately: it takes two numbers rather than a 0…1 knob, and
> it has no gym equivalent, so it must not look like something you can tune there. Both
> values are clamped (`seconds` 0–10, `jitter` 0–1) and anything outside is reported at
> boot.

> **`afterPlace` and `B5` belong together.** `B5`'s coherent drift is the only thing
> moving while the cursor waits, so a long `afterPlace` with `B5` off is a glyph frozen
> solid for seconds at a time — it reads as a crash, not as thinking. Keep `B5` well
> below the other character's value if that character is meant to be the restless one;
> the contrast is what carries the difference.

The other nine were cut on 2026-09-08 rather than left as code nothing runs: `A9` speed
scale (replaced by `travel`), `B2` speed–curvature coupling, `B7` intent broadcasting,
`B13` dwell duration, `B18` proxemics, `B19` response latency, `B21` idle behaviour,
`B22` arousal decay, `A13` glyph aim. All of them but `A9` were off
in both presets, so nothing about how the cursor moves changed. (`B13` came back for part
of that day and went again — see the note above.)

> The gym can still author all fifteen, so `Cursor.load` **reports any retired dial a
> preset switches on** — otherwise a preset that felt right in the gym would just be
> blander here, with nothing to say why. To bring one back, port it from
> `moveMe/gym/js/agent.js`; the ids and the maths are unchanged.

**What the two characters do**, as shipped:

| | bold | cautious |
|---|---|---|
| pace (`travel`) | 275 / 391 ms | 299 / 426 ms |
| idle drift (`B5`) | 0.96 — never still | 0.2 — breathes gently while it waits |
| after a placement (`afterPlace`) | 0.10–0.40 s | takes in what it just did |
| reads as | restless, quick, visibly tempted by the case it *didn't* pick | deliberate: winds up before each move, arcs, lingers, then corrects itself |

Check the live values with `Cursor.dials()` in the console rather than reading them off
this page — `cursors.json` is tuned often. A dial set outside its legal range is clamped
**and reported at boot**, so a preset asking for `A9` −1.8 will say so rather than
quietly behave like −1.

**The file holds exactly those seven**, same keys in the same order under both
characters, so the two presets read as a straight comparison and nothing in it is inert.
The gym's other eight dials — and its `strategy` field, which the prototype does not
implement — were stripped out; all of them were off, so nothing was lost. A top-level
`dials` array and a `note` record what is in force and why.

**To retune:** open `moveMe/gym/index.html`, dial it in **within the seven above**, save
the preset under the character's name (`bold` / `cautious`), export, and drop the file in
as `cursors.json`. Nothing in the code needs editing, and a raw fifteen-dial export drops
in unmodified — extra dials are ignored, a missing one falls back to off, a retired one
that is switched **on** is reported at boot, and a character with no preset at all is
reported too. Stripping it back to seven afterwards is tidiness, not a requirement.

**What is logged:** every handoff result carries `cursorCharacter`, the character's *on*
dials as `cursorDials`, and its two millisecond settings as `cursorTravel` and
`cursorAfterPlace` — so a row of data says how the AI moved without anyone having to work
out which `cursors.json` that build shipped with. `handoff_armed` carries the same at the
start of each round. (`cursorAfterPlace` records the authored `seconds`/`jitter`, not the
individual draws.)

**`cursors.json` is the only thing that decides how the cursor moves.** Nothing in
`config.js` touches it — there is no speed setting, no pacing knob, no per-group
override. Speed is the `A9` dial; the rhythm between cases is `Cursor.MOTION.beat`.

> **`Config.AI_CURSOR` is gone** (removed 2026-09-08). It held a `pauseAfterPlaceMs` of
> 400 ms — a second pacing parameter that `cursors.json` could not reach. It paced the
> cursor 4× slower between cases than the gym's own 90 ms beat, so what you tuned in the
> gym was not what the participant saw; and because a group could override it inline, it
> could have given the two characters different rhythms without that being visible
> anywhere in `cursors.json`. A full six-case round is now 1.9 s shorter for both
> characters (bold 11.0 s, cautious 21.9 s); nothing else about the motion changed.
> Do not reintroduce a knob there — if the pacing is wrong, it is wrong in the gym too.

**What is left in `js/cursor.js` is the shared baseline**, and all of it is the gym's,
unchanged. Three real timings — `grabDwell` 140 ms (the hold over a case before lifting),
`dropDwell` 120 ms (over a slot before releasing), `beat` 90 ms (between cases) — plus the
coefficients that decide what each dial's 0…1 *means*: the noise amplitude and frequency,
the curvature and pull amounts, the submovement figures, the `B8` beat sizes, the ease
curve, the leg clamp. They are shared by both characters by design, so none of them can
separate bold from cautious; editing one without the matching edit in
`moveMe/gym/js/agent.js` breaks the correspondence the shape dials rest on.

The only cursor motion the character does **not** govern is the hand-back: when the
participant takes control, the cursor sweeps to their pointer in `AUTO.returnMs` (190 ms,
`js/task.js`) on a plain ease. That is UI feedback — "here, it's yours again" — rather
than the AI doing its task, and the gym keeps its own homing outside the character too.
`AUTO.fadeInMs` / `fadeOutMs` are opacity only and move nothing.

> **The participant-facing speed slider is gone** (`userSpeedControl`, removed
> 2026-09-08). It was off for the study anyway — it made AI speed a participant-controlled
> variable, so `workMs` stopped being comparable across people — and with motion
> character as the manipulated variable it could no longer coexist honestly with it.
> The accessibility case it was written for is now served by lowering `A9` for both
> characters together.

> **There is no longer a reading window.** `startGraceMs` used to hold the AI back for
> the first few seconds of a stage, because the onboarding is dismissed at the same
> instant the task text first becomes visible. The activation zone made it redundant:
> nothing moves until the participant deliberately parks the cursor in the zone, so they
> read the task in their own time and the wait was only friction. Removed 2026-08-12.

The AI never blocks the participant: in every group the final order is theirs to set,
and `Confirm ranking` is the only way forward. In a handoff stage, moving the cursor out
of the zone takes control back mid-sort; in a hidden stage the board is frozen for the
one second the tiles are in the air and fully editable the moment they land. Either way
nothing the AI did is final.

</details>

<details>
<summary><b>The hidden mechanic</b> — how the one-second flight works</summary>

One press of **Start AI** and all six steps travel to the slots the AI chose, at
constant speed, in `Config.HIDDEN_PLACE_MS` (1000 ms). Wherever a step happens to be
at that moment is where it starts from, so a participant who has already sorted three
steps sees those three move too — the AI commits a whole order, not a set of additions.

It is FLIP (measure → commit → measure → animate back), but it moves **copies** on
`#fly-layer` rather than transforming the tiles in place. An inbox tile and a ladder
tile are not the same width — they carry different left margins so both line up with
the numbered slots — so a transform-only flight would pop to the destination width on
the very first frame. The clones interpolate `left`/`top`/`width` together, which is
not compositor-friendly but is six elements for one second. The real tiles wait it out
under `.in-flight` (`visibility:hidden`), holding their layout so nothing reflows when
they land.

While the tiles are in the air the board is frozen: `onMouseDown` bails, `Confirm` stays
disabled, and the button is disabled. A single timer lands the set rather than six
`transitionend` listeners — each clone fires that event once per animated property, and
a clone with nowhere to travel (a step already in its AI slot) never fires it at all.
The timer is guarded by `runId`, so a dev Skip mid-flight cannot land on the next task's
board.

Sequence in the logs: `hidden_started` (with `before`, what the participant had sorted
themselves) → six `ai_placement` → `hidden_done`.

> **Note for testing:** the in-app preview pane reports zero-size
> `getBoundingClientRect()`, which is exactly what this animation is built on, so the
> flight looks broken there while being correct in a real browser. Verify it in an
> ordinary browser tab, or stub the rects.

</details>

## Which setup a participant runs

**One line in `js/config.js`:**

```js
const FIXED_GROUP = "G1";     // G1 · G2 · G3 · G4 — see GROUPS
```

Every participant this build serves runs that setup. Set it before each batch of
sessions and redeploy. The value is pinned onto each session at creation, so editing it
can never retroactively change a run already in progress, and boot prints the setup in
force (`[BDR] setup G1: bold, hidden → handoff`) — or an error, if the name matches no
known setup.

**Balance is yours to keep.** Nothing counts how many participants have run under a
setup and nothing warns when the cells go uneven. `group` on each session file is the
record to count.

Each session still records **how** its setup was decided, as `groupSource`:

| Value | Meaning |
|---|---|
| `config` | `Config.FIXED_GROUP` — the normal case |
| `dev` | Forced from the dev picker, so a test session stays legible as one when the data is counted |

> **The automatic balancer was removed on 2026-09-09.** The prototype used to ask the
> server for the least-used cell (`POST /assign-group`), backed by a ledger in
> `logs/groups.json` and a reservation window so a dropout did not strand its slot.
> Groups are assigned by hand now, and a balancer quietly disagreeing with a hand-picked
> assignment would be worse than none. Gone with it: `ASSIGN_URL`, `ASSIGN_TIMEOUT_MS`,
> both `/assign-group` routes, `BDR_GROUPS`, `BDR_RESERVE_MS`, and the `local` random
> fallback — there is no longer anything to fall back *from*. A `logs/groups.json` still
> on disk is an old record; nothing reads or writes it.

### Dev controls

With `CONFIG.devMode: true`, a bottom-right bar appears: a **setup picker** reading
e.g. `G3 · cautious · hidden→handoff`, next to the **Skip ▸** button. Both vanish when
`devMode` is `false`. There is no separate character picker — the setup fixes the
character, so the four options already cover every combination.

Changing the setup mid-session rebuilds the plan (the order changed, so the rounds did
too) and re-renders the current step. Both orders run the same number of rounds, so the
step index stays valid; results already recorded keep their own `taskId`, `condition` and
`character`, so they stay readable even though they came from the previous plan. It marks
the session `groupSource: "dev"`, so a test run is recognisable as one in the data.

<details>
<summary><b>Languages</b> — DE/EN side by side, live switching, and why the switch is safe mid-task</summary>

German is the default (`DEFAULT_LANG` in `js/i18n.js`); a DE/EN switcher sits fixed
top-right on every screen.

All interface text lives in `strings.json` with **both languages side by side**, so a
missing or stale translation is obvious at a glance. Lookup is by dot path
(`I18n.t("ui.task.confirm")`); a key missing in the active language falls back to the
other one and logs a console warning rather than rendering blank. Keys that only *some*
stages define are asked for with `I18n.opt()` instead, which is silent when the key is
absent everywhere but still warns when one language has drifted from the other.

**Switching is a live re-render, never a reload**, and it is safe by construction:
`tasks.json` stores each task's *structure* once and only its *prose* per language (see
below). Card ids, the seeded shuffle, the participant's placements, their survey answers
and the AI's suggested order therefore cannot vary by language — only visible text
changes.

Everything that follows the language hangs off a single `I18n.onChange` listener, so
any call to `I18n.set` repaints the whole UI; the switcher can never show a different
language than the screen does. A switch mid-onboarding re-renders the step you are on,
in the new language, without restarting the sequence.

Because a mid-task switch is allowed, **the language is recorded as study data**:
`session.lang`, `lang` on every `task_start` and result, and a `language_switch` event
carrying the step it happened on — so participants who switched can be identified,
analysed separately, or excluded.

Adding a language: add a block to `strings.json`, add a matching key to each task's
`de`/`en` blocks, extend `LANGS` in `js/i18n.js`, and add a button to `#lang-switch`.

</details>

<details>
<summary><b>Task content format</b> — the bilingual <code>tasks.json</code></summary>

Every task is one **prioritisation** problem: six incoming cases, ranked most urgent
first. The task *type* never changes across the 13 tasks — only the subject matter does —
so the instruction sits once in `strings.json` (`ui.task.brief`) rather than on each task.
A task therefore carries only a title.

`tasks.json` is bilingual. **Structure is shared, prose is per language** — so `id`,
`tiles[].key` and `ai-order` exist exactly once and *cannot* diverge between languages.
That matters: if `ai-order` drifted, German and English participants would get different
recommendations from the "same" AI, and nothing would raise an error.

```jsonc
{
  "id": "T1",
  "de": { "title": "Transportwesen" },
  "en": { "title": "Transportation" },
  "ai-order": {                            // ← SHARED: tile keys, top to bottom
    "bold":     [0, 1, 3, 2, 5, 4],
    "cautious": [0, 1, 4, 3, 5, 2]
  },
  "tiles": [{
    "key": 0,                              // ← SHARED: a stable tile id, NOT a position
    "de": { "text": "Gefährliche Straßenschäden", "description": "…" },
    "en": { "text": "Dangerous road damage",      "description": "…" }
  }]
}
```

`js/tasks.js` flattens this into an ordinary single-language task on first use and caches
it per language, so the rest of the app never sees the bilingual layout. Both `text` and
`description` are rendered on the tile — a priority call needs the detail, not just the
label — and both go in via `textContent`, never as markup.

**`tiles[].key` is only an identifier.** In the previous format it was the correct
0-based position and the ground truth for scoring; here there is no correct order, so it
is nothing but the stable id behind `"t"+key` that placements, logs and `ai-order` are
all expressed in. Shuffling, resuming and the language switch all rely on it.

**`ai-order` must list all six keys**, once each, per character. It is what the AI
recommends, and the *only* place a questionable recommendation can come from — the old
`scriptedError` machinery that manufactured one by swapping a pair is gone. `Tasks
.aiRankingFor(id, character)` maps it to card ids; an unknown character logs a console
warning and yields an empty suggestion rather than throwing.

</details>

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

### Nothing is overwritten

A **server restart clears nothing.** Each participant has their own folder under `logs/`,
holding an atomically-written session snapshot and their own append-only `events.jsonl`;
ids are unique per run so two participants can never collide. Twenty participants leave
twenty folders, uncapped.

localStorage was the weak point: it held **one** session under one key, replaced wholesale
by the next run. With `loggingEnabled` off — or with the collector unreachable — that was
the only copy, so a second run destroyed the first silently. Since 2026-09-08 a session
being replaced is archived first, under `bdr_triage_archive`:

| | |
|---|---|
| archived on | starting a new run, and `Start new` on the resume screen — each stamped with `archivedBecause` |
| cap | newest **10**, and it sheds oldest entries if the browser refuses the write |
| `Store.archive()` | read them back from the console |
| `Store.downloadArchive()` | the live session plus every archived one, as one JSON file |
| `Store.flushArchive()` | runs at boot; re-POSTs anything the collector never acknowledged |

> **The cap is per browser, and has nothing to do with how many participants you collect.**
> `localStorage` is roughly a 5 MB box per site per browser, and a full session runs to a
> few hundred KB — an uncapped archive would eventually fill it, and a full box makes the
> browser refuse writes, which would break the *live* session's autosave. Losing the
> current run to preserve old copies would be exactly backwards. A real participant runs
> once and archives nothing; the cap only ever matters to whoever is testing.

A successful POST stamps `collectedAt`, so a later flush skips that session. The collector
is idempotent per `participantId` — it overwrites the snapshot and appends only unseen
events — so re-sending costs nothing.

> The archive is a **safety net, not a collector.** It keeps ~10 runs in one browser
> profile. If a participant's browser can never reach the collector and they never return
> to the URL, their data stays in their browser and you never see it — which is the
> argument for hosting the collector somewhere always-on rather than on a laptop.

<details>
<summary><b>What the server writes</b>, and the privacy guards around it</summary>

**One folder per participant** (changed 2026-09-09 — it used to be split by kind, one
shared `events.jsonl` plus a `sessions/` folder):

```
logs/<participantId>/events.jsonl
logs/<participantId>/sessions/<participantId>.json
```

- `<id>/sessions/<id>.json` — the full session, rewritten each sync (atomically, via temp
  file + rename). **The record of truth.**
- `<id>/events.jsonl` — that participant's append-only event stream, one event per line,
  tagged with `participantId`, `lang` and `serverTimestamp`. Only events the server
  hasn't seen are appended, so there are no duplicates.

Everything from one run sits together, so a participant can be handed on, archived or
**deleted as a unit** — which is what a withdrawal request needs. The cost is the
cross-participant read: `pd.read_json("logs/events.jsonl", lines=True)` becomes a glob
and concat over `logs/*/events.jsonl` (see `logs/README.md`). `participantId` now names a
**directory**, so the path sanitising that keeps a hostile id inside `logs/` matters more
than it did — verified against `../../etc/…`, `a/b/c` and friends, all flattened.

> Two files, not one, because the client re-sends the whole session every time —
> blindly appending would grow quadratically. The snapshot's event count tells the
> server where to resume appending.

Writes are serialised per participant, so two concurrent step boundaries can't
interleave inside a line.

**Privacy and safety**

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

</details>

<details>
<summary><b>What one session contains</b> — the saved object and every logged event</summary>

One session object, autosaved to `localStorage["bdr_triage_session"]`, resumable on
reload. `Store.download()` exports it as JSON from the console.

- `prolificId` — what the participant typed on the Prolific step (`null` if that step
  was off). Personal data: it identifies a payable account
- `steps` — which optional steps this session actually ran
- `group` / `groupSource` — the assigned setup (G1–G4) and how it was decided
- `character` — `"bold"` or `"cautious"`, pinned at session creation from the group
- `order` — the mechanic sequence, e.g. `["hidden","handoff"]`, pinned likewise
- `plan` — the expanded `[{stage, mechanic, block, taskBlock, taskId}]` rounds (`stage`
  is `"baseline"` or `"ai"`; the rest are set on AI rounds only — `block` is the position,
  `taskBlock` the content set)
- `lang` — the language the session ran in (last selected)
- `surveys` — pre/post answers
- `results` — per round: `stage`, `group`, `condition` (the mechanic), `character`,
  `block` (1 or 2 — which half of the session this round sat in), `ranking`,
  `aiSuggestion` (what they were departing from), `overrides` (how many tiles they placed
  somewhere other than the AI did), `lang`, the shared-control block below, the cursor
  block (`cursorCharacter`, `cursorDials`, `cursorTravel`, `cursorAfterPlace` — the motion
  character in force, its *on* dials and its two millisecond settings, all null wherever no
  cursor runs), plus the timing block below

  **Who did the work**, counted two ways because they answer different questions:

  | | |
  |---|---|
  | `aiTakeovers` / `userTakebacks` | how often control changed hands — a zone entry in a handoff round, the button press in a hidden one, so the two mechanics stay comparable |
  | `placedByAi` / `placedByUser` | **actions.** A case the AI placed and the participant then moved counts for both |
  | `finalPlacedByAi` / `finalPlacedByUser` | the **six confirmed slots**, so these sum to the board |
  | `slotAuthor` | array of 6 — `"ai"` or `"user"` per slot, the raw form of the two above |
  | `ladderReorders` | moves that never touched the inbox (slot → slot): revising a ranking rather than building one |

  > The two counts diverge more than you'd expect: a participant can place three cases and
  > still end with `finalPlacedByUser: 0`, because the AI displaces anything sitting in a
  > slot it wants back into the inbox and re-places it. Either number alone tells a
  > misleading story.
- `events` — timestamped log (`ts` absolute, `tRel` ms since page load):
  - session — `session_start`, `group_assigned` (group, source, and the counts at draw
    time — the study's randomisation record), `session_resumed`,
    `session_end`, `session_closed`, `dev_skip`, `group_override` (dev picker),
    `language_switch` (which language, and at which step)
  - task — `task_start` (incl. `inboxOrder`, `aiSuggestion`), `task_confirm` (incl. the
    who-did-what counts above)
  - interaction — `drag_start`, `drag_drop` (with `reorder` / `nthReorder`, so
    right-hand-side revisions are separable from placements), `explainer_shown`,
    `explainer_step` (which onboarding step they advanced to), `explainer_dismissed`

  > Every AI event also carries **`atMs`** — milliseconds into that round. `ts` and `tRel`
  > say when something happened in the session; `atMs` says *where in the round*, which is
  > the question a takeover timeline actually asks.
  - AI (handoff) — `handoff_armed` (stage ready — with the `character` and its
    `cursorDials`; the AI acts once the cursor enters the activation zone),
    `ai_took_over` / `user_took_back` (each with `nth`
    and `placedSoFar`, so the whole tug-of-war is reconstructable), `ai_placement`,
    `handoff_done`
  - AI (hidden) — `hidden_started` (with `before`: what the participant had sorted
    themselves before pressing the button, and `placedSoFar`), six `ai_placement`,
    `hidden_done`
  - `ai_override` — per tile the participant moved away from the AI's suggestion. With
    nothing scored, this and the `overrides` count are the ranking measure
  - surveys — `survey_view`, `survey_submit` (`id` is `pre` / `mid` / `post`)
  - Prolific — `prolific_view`, `prolific_id_entered` (`length` only — the value
    itself is on the session, not repeated into the event stream)

</details>

<details>
<summary><b>Task timing</b> — the five clocks on every round, and which one to watch</summary>

The onboarding tile opens *on top of* the task, so a single wall-clock number would fuse
"reading the instructions" with "doing the task" — and reopening the ⓘ button mid-task
would inflate it further. Each result (and `task_confirm`) therefore carries separate
clocks:

| Field | Measures |
|---|---|
| `elapsedMs` | Total: task screen shown → Confirm. Includes reading and AI time. |
| `explainerMs` | Cumulative time the tile was open (all opens summed) |
| `explainerOpens` | How many times it was opened — `> 1` means they went back to re-read |
| `workMs` | `elapsedMs − explainerMs` — **actual time on the task** |
| `timeToFirstActionMs` | First dismissal → first drag (hesitation before acting) |
| `reviewMs` | Every step placed → Confirm, i.e. **how long they reviewed the finished order before signing it off**. Set only when the AI cursor completed the board, so `null` if the participant placed the last step themselves. |

`workMs + explainerMs == elapsedMs` always holds. `explainer_shown` / `explainer_dismissed`
also carry `taskId`, `reopen`, and the per-open duration (`openMs`), so you can
reconstruct each reading episode individually rather than only the total.

`reviewMs` is the one to watch on an AI round: near-zero with `overrides: 0` means the
participant accepted the AI's order without inspecting it.

</details>

## Before the real study

- [ ] Confirm `CONFIG.devMode` is `false` — it hides the bottom-right dev bar (the
      "Skip ▸" button and the setup picker, which would override `FIXED_GROUP` and mark
      that session `groupSource: "dev"`)
- [ ] Confirm `CONFIG.loggingEnabled` is `true` — with it off a completed session leaves
      no file at all (already the default; the console warns on boot when it is off)
- [ ] Replace the placeholder group labels/onboarding steps and both surveys
- [ ] Clear the pilot data out of `logs/` — one folder per participant, so deleting the
      test runs is `rm -rf logs/<id>/` per pilot participant
- [ ] Decide where the collector runs (port-forwarded machine vs. hosted) and confirm
      `logs/` is backed up — it is the only copy once a participant clears their browser
- [ ] Set the number of rounds — `BASELINE_TASKS` runs 3 (`T1`–`T3`) and each
      `TASK_BLOCKS` block runs 5, so a session is 13 rounds. Every group runs them
      in the same order; only the mechanic on each block is counterbalanced
- [ ] Confirm `STEPS` matches how this run is administered — Prolific ID and
      the three questionnaires each switch off independently
- [ ] Replace the placeholder questions in `surveys.mid` alongside `pre` and `post`
- [ ] Set `FIXED_GROUP` to the setup this batch runs, and check the boot console says so
      (`[BDR] setup G1: bold, hidden → handoff`). Nothing balances the four cells any
      more — keep the tally yourself and change it between batches
- [ ] Decide whether mid-task language switching is acceptable, or should be locked
      once a task starts (it is currently allowed and logged)
