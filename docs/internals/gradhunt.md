# gradhunt

gradcode reads and writes `~/Personal/gradhunt` (override with `GRADHUNT_DIR`). gradhunt's
own spec, `loopany/prof-scout/README.md`, owns the data model, funding models, contact rules and
outreach wording. Read it there; don't restate it here.

## Reads

The professor sheet is `loopany/prof-scout/data/professors.json`: an array keyed by name plus
university. `excluded.json` holds removed records with their reasons. Drafts are
`loopany/prof-scout/drafts/*.md` with front-matter. Program deadlines and funding are tables
in `loopany/prof-scout/deadlines.md`. Reading any of these directly is fine.

## Writes

`scout.py` is the only writer. Run it from the gradhunt root:

| Change          | Command                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Add records     | `./scout.py add` with a JSON object or array on stdin. It validates, refuses excluded people, and exits 1 on any rejection. |
| Change fields   | `./scout.py set <name> <university> field=value ...`. It needs exactly one match and validates like `add`.                  |
| Remove a record | `./scout.py exclude <name> <university> "<reason>"`. Its drafts move into `excluded.json`.                                  |
| File a signal   | `./scout.py signal -` with JSON on stdin (writes to hq's signals).                                                          |
| Check drafts    | `./scout.py lint-drafts` must exit 0 before a draft is shown.                                                               |

Free lookups worth reusing: `./scout.py grants <name> <university>` returns active NSF and NIH
awards for a PI, and `./scout.py verify` checks emails (paid, through treg).

## Traps

- **No lock.** Every write loads and rewrites the whole JSON file. gradcode must run its
  `scout.py` writes one at a time, through one queue in the server.
- **Other writers.** Scout's nightly run (23:00 Asia/Dhaka) and `sync.sh` touch the same files.
  `sync.sh` commits and merges the cloud outreach routine's branch every 10 minutes and stops
  on a conflict. Small, field-level `set` calls conflict far less than rewriting records.
- **Facts about Siam** come from hq (`~/Personal/hq`), read-only. A draft may only claim what
  hq records; Scout's README lists the wording rules.
