# Known issues

## Fixed: a crash during upload left a recovered file and a wrong duplicate row

**Cause:** the original is saved before the database hears of it. A kill in between leaves a file with no record, which recovery rebuilds as a document, without knowing which import row it came from. When the file was sent again, a matching hash was the only test, so its row was marked `duplicate`.

**Now:** a document named `Recovered file <the first 12 characters of its own hash>.pdf` is waiting for its upload. The first upload with those bytes takes it in one transaction: the row becomes `stored` with a note saying so, and the document gets its real name. That clears the name, so any later copy is a true duplicate. Nothing about the document is read again or changed apart from its name. `backend/tests/test_import_recovery.py` kills a real process at each stage, and `npm run readiness:recovery` does the same in Chrome.

### What this leaves

- **Until the folder is chosen again,** Documents lists a `Recovered file` the report still shows as not received. The two agree once it comes back. If it never does, the document keeps that name.
- **A new import can take it first.** If the same file is imported from a different folder before the first import resumes, the new report shows `stored`, and the old report shows `duplicate` when it resumes.
- **Reports already affected stay as they are.** A row marked `duplicate` by the old behaviour is not rewritten.

### Design limit: the filename is the recovered-state marker

Whether a document is still waiting for its upload is worked out from its name alone, which is a stopgap to avoid a migration. A name is display text and should not carry state. Replace it with an explicit database state, such as a column on the document or a record of the upload before its file is saved. A record made before the save would also let recovery link the row straight away, which closes the temporary discrepancy above.
