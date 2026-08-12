# Logs

Written by `server.js`. **This folder is participant data — treat it as personal data.**
It is blocked from HTTP, so it is never reachable from the browser.

- `sessions/<participantId>.json` — the complete session, rewritten on every sync.
  This is the **record of truth**: each POST carries the whole session, so a dropped
  request is healed by the next one. Written atomically (temp file + rename), so a
  crash can never leave a half-written file.
- `events.jsonl` — append-only event stream across all participants, one JSON object
  per line, each tagged with `participantId`, `lang` and `serverTimestamp`. Only
  events the server has not already seen are appended, so there are no duplicates.
- `groups.json` — the group ledger behind the balanced G1–G4 assignment: one record
  per participant, `{group, at, completedAt, dev, source}`. The server reads it to
  decide which group the next participant gets, so **deleting it resets the balance**
  (existing sessions keep the group already pinned to them). `GET /assign-group/status`
  reports the current counts without opening the file.

Load the event stream for analysis:

```python
import pandas as pd
df = pd.read_json("logs/events.jsonl", lines=True)
```

Or the per-participant results:

```python
import json, glob, pandas as pd
rows = [r | {"participantId": s["participantId"]}
        for f in glob.glob("logs/sessions/*.json")
        for s in [json.load(open(f))] for r in s["results"]]
df = pd.DataFrame(rows)
```
