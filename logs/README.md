# Logs

Written by `server.js`. **This folder is participant data — treat it as personal data.**
It is blocked from HTTP, so it is never reachable from the browser.

## One folder per participant

```
logs/
  ABCD-msq4v1sh/                     ← participantId: 4 random letters + a base36 timestamp
    events.jsonl                     ← that person's events, append-only
    sessions/
      ABCD-msq4v1sh.json             ← that person's session
  JKLM-mtsw3a1x/
    events.jsonl
    sessions/
      JKLM-mtsw3a1x.json
```

Everything from one run sits together, so a single participant can be handed on,
archived or **deleted as a unit** — which is what a withdrawal request actually needs.
The folder is created on that participant's first sync and never touched again by anyone
else, so two people running at once cannot share a file.

- `<id>/sessions/<id>.json` — the complete session, rewritten on every sync. This is the
  **record of truth**: each POST carries the whole session, so a dropped request is
  healed by the next one. Written atomically (temp file + rename), so a crash can never
  leave a half-written file.
- `<id>/events.jsonl` — that participant's event stream, one JSON object per line, each
  tagged with `participantId`, `lang` and `serverTimestamp`. Only events the server has
  not already seen are appended, so there are no duplicates.

> Before 2026-09-09 these were split by **kind** instead of by participant: one shared
> `logs/events.jsonl` across everybody, and `logs/sessions/<id>.json` beside it. The
> `participantId` is sanitised before it touches a path, so a hostile id cannot escape
> `logs/` — it now names a directory, which makes that guard matter more, not less.

## Reading it

The event stream, across everyone — a glob rather than a single file now:

```python
import glob, pandas as pd
df = pd.concat([pd.read_json(f, lines=True) for f in glob.glob("logs/*/events.jsonl")],
               ignore_index=True)
```

One participant on their own:

```python
df = pd.read_json("logs/ABCD-msq4v1sh/events.jsonl", lines=True)
```

The per-round results:

```python
import json, glob, pandas as pd
rows = [r | {"participantId": s["participantId"]}
        for f in glob.glob("logs/*/sessions/*.json")
        for s in [json.load(open(f))] for r in s["results"]]
df = pd.DataFrame(rows)
```

`groups.json` is gone: it was the ledger behind the automatic G1–G4 assignment, removed
on 2026-09-09. The setup is fixed by hand in `js/config.js` (`FIXED_GROUP`), and which
setup a participant ran is on their own session file as `group` and `groupSource`.
