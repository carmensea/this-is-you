# Known issues

## Priority: fix before more bulk imports

### A crash during upload can leave a recovered file and a wrong duplicate row

**Status:** open. Found on 2026-11-03 by `npm run readiness`, on fictional records. It appears only when the crash lands in a narrow window, so most runs pass.

**What happens**

1. The service saves an uploaded file to `originals`, and is killed before recording it in the database.
2. On the next start, `reconcile` finds the file with no record and keeps it as a document named `Recovered file ...`. That document is linked to no import row.
3. The person chooses the folder again, and the file is re-sent. Its hash matches the recovered document, so its row is marked `duplicate` instead of `stored`.

**Effect**

- No file or record is lost, and the file is stored once.
- The import report is off by one: stored one too low, duplicate one too high, and one more document than stored rows.
- The document keeps the `Recovered file` name, not its real filename.
- A person checking the report against their folder sees a duplicate that is not one.

**Evidence from the failing run:** `71 rows, 72 documents` after the crash, then `category read: 349 of 350`, `category duplicate: 31 of 30`, and `stored originals match the source: 439 of 440`.

**Where to look:** `upload_item` in `backend/this_is_you/api/imports.py`, `record_upload` in `backend/this_is_you/documents.py`, and `backend/this_is_you/reconcile.py`.

**Done when:** a re-sent file whose only match is a recovered document with no import row is marked `stored`, takes the row's filename, and links to that document. A test covers it with a crash forced inside this window, and the readiness counts match.
