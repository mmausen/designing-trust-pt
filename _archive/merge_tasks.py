#!/usr/bin/env python3
"""Merge task_thought_DE.json + task_thought_EN.json into one bilingual file.

Structural fields (id, tiles[].key, scriptedError.swapKeys) are hoisted so they
exist exactly once and cannot diverge. Prose sits side by side per task.
Refuses to write if the two inputs disagree on anything structural.
"""
import json, sys
from collections import OrderedDict

LANGS = ("de", "en")
SRC = {"de": "task_thought_DE.json", "en": "task_thought_EN.json"}
OUT = "task_thought.json"

src = {l: json.load(open(SRC[l], encoding="utf-8")) for l in LANGS}
tasks = {l: {t["id"]: t for t in src[l]["tasks"]} for l in LANGS}

# ── refuse to merge anything that isn't structurally identical ──
errors = []
ids_de, ids_en = list(tasks["de"]), list(tasks["en"])
if ids_de != ids_en:
    errors.append(f"task id lists differ: only-DE={set(ids_de)-set(ids_en)} only-EN={set(ids_en)-set(ids_de)}")
for tid in ids_de:
    if tid not in tasks["en"]:
        continue
    d, e = tasks["de"][tid], tasks["en"][tid]
    kd = [t["key"] for t in d["tiles"]]
    ke = [t["key"] for t in e["tiles"]]
    if kd != ke:
        errors.append(f"{tid}: tiles[].key differ {kd} vs {ke}")
    if d["scriptedError"]["swapKeys"] != e["scriptedError"]["swapKeys"]:
        errors.append(f"{tid}: swapKeys differ {d['scriptedError']['swapKeys']} vs {e['scriptedError']['swapKeys']}")
if errors:
    print("REFUSING TO MERGE — structural mismatch:", file=sys.stderr)
    for x in errors:
        print("  ", x, file=sys.stderr)
    sys.exit(1)

# ── build the merged document ──
def task_entry(tid):
    per = {l: tasks[l][tid] for l in LANGS}
    out = OrderedDict()
    out["id"] = tid
    for l in LANGS:                                    # title/description per language
        out[l] = OrderedDict(title=per[l]["title"], description=per[l]["description"])

    se = OrderedDict()
    se["swapKeys"] = per["de"]["scriptedError"]["swapKeys"]     # shared
    for l in LANGS:
        s = per[l]["scriptedError"]
        se[l] = OrderedDict(pair=s["pair"], rationale=s["rationale"], wrongThought=s["wrongThought"])
    out["scriptedError"] = se

    by_key = {l: {t["key"]: t for t in per[l]["tiles"]} for l in LANGS}
    tiles = []
    for key in sorted(by_key["de"]):
        tile = OrderedDict(key=key)                              # shared
        for l in LANGS:
            t = by_key[l][key]
            tile[l] = OrderedDict(text=t["text"], thought=t.get("thought", ""))
        tiles.append(tile)
    out["tiles"] = tiles
    return out

meta = OrderedDict()
meta["name"] = OrderedDict((l, src[l]["meta"].get("name", "")) for l in LANGS)
meta["languages"] = list(LANGS)
meta["revision"] = src["de"]["meta"].get("revision")
meta["variant"] = src["de"]["meta"].get("variant")
meta["tileCount"] = src["de"]["meta"].get("tileCount")
meta["notes"] = (
    "Bilingual. STRUCTURE IS SHARED, PROSE IS PER LANGUAGE: id, tiles[].key and "
    "scriptedError.swapKeys appear exactly once, so they can never diverge between "
    "languages. tiles[].key = correct 0-based target position; the prototype shuffles "
    "the tiles deterministically. tiles[].<lang>.thought = plausible first-person "
    "reasoning for the correct placement. scriptedError.swapKeys = the position pair "
    "swapped when a stage sets aiError; <lang>.wrongThought = the convincing but wrong "
    "justification for that swapped order."
)
meta["sourceNotes"] = OrderedDict((l, src[l]["meta"].get("notes", "")) for l in LANGS)

doc = OrderedDict(meta=meta, tasks=[task_entry(t) for t in ids_de])
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"wrote {OUT}: {len(doc['tasks'])} tasks, languages {list(LANGS)}")
