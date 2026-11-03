# Data model

## Today

| Table | Holds |
| --- | --- |
| `documents` | One row per unique original file: `sha256` (unique), `original_filename`, `media_type`, `byte_size`, `storage_key`, `imported_at`, and the three statuses `extraction_status`, `review_status`, `verification_status` |
| `import_events` | One row per arrival of a file, including duplicates: `document_id`, `submitted_filename`, `outcome`, `occurred_at` |
| `extraction_runs` | One row per attempt to read a file: `method`, `status`, page counts, `truncated`, `text_sha256`, `patient_found` (names and birth dates printed under a patient label) |
| `metadata_proposals` | What a run inferred: `field`, `value`, `confidence`, `reason`, `source_page`, `source_snippet` |
| `metadata_decisions` | What a person decided, append-only: `field`, `action`, `value`, `proposal_id`, `decided_at`. The latest row per field is current. |

| `lab_observations` | One laboratory result: name, value, unit and range as printed, optional `test_code`, normalized value when safely convertible, flag, the dates `collected_on`, `reported_on`, `documented_on` and `imported_at`, source page, line and text, `origin`, `extraction_status` and `verification_status` |
| `lab_observation_revisions` | Append-only history of a result. The first row is what was first read or entered. |
| `import_batches` | One folder or set of files a person chose: `label`, `created_at`. `hidden` is no longer used: removing a report deletes its rows. |
| `import_items` | One file of a batch, including refused ones: `path` (display text, never opened), `byte_size`, `state`, `message`, `document_id`, `attempts`. Changes in the same transaction as its document. |
| `identity_profile` | One row at most: `full_name`, `date_of_birth`, `previous_names`. Only ever used to raise a flag. |
| `auth_credential` | One row at most: the salted scrypt hash of the passphrase. Never in a backup. |
| `auth_sessions` | Signed-in devices, as hashes of their tokens, with `created_at` and `last_seen_at`. Never in a backup. |

A document's verified type, date, provider and title are read from `metadata_decisions`, and from nowhere else. Rereading a file adds a run and new proposals and leaves decisions alone. The full text of a document is not stored, only a hash of it and the short source lines behind each proposal.

## Rules future tables should follow

None of the tables under "Planned tables" exist yet. `extraction_runs`, `metadata_proposals` and `metadata_decisions` already follow these rules for document details. They are a design to build toward, and they may change when real data arrives.

1. **Every fact points at its source.** Each record has a `source_document_id` foreign key. Nothing exists in the archive without a document behind it, or an explicit record that a person entered it.
2. **Two dates, always.** `effective_at` is when something happened. `recorded_at` is when it was documented. The time machine depends on this: "As known then" filters on `recorded_at`, and "As understood now" filters on `effective_at`. Neither may be guessed; unknown stays `NULL`.
3. **Corrections never overwrite.** A correction is a new row with `supersedes_id` pointing at the old one. Reviewing keeps the extracted value next to the corrected one, so any change can be traced and any past snapshot can be rebuilt.
4. **Values stay as printed.** Keep the value, unit, reference range and flag exactly as the source states them, each result with its own range. Never convert units or merge ranges in storage.
5. **Originals are never touched.** Derived data can be deleted and regenerated from `originals/`. The reverse is not possible.

## Planned tables

| Table | Holds | FHIR resource |
| --- | --- | --- |
| `observations` | Other measurements: weight, vital signs, device readings | `Observation` |
| `diagnostic_reports` | Imaging and pathology reports, kept as written | `DiagnosticReport` |
| `medications` | Medications with dated dose periods | `MedicationStatement` |
| `conditions` | Diagnoses, with onset, documented and resolved dates | `Condition` |
| `procedures` | Procedures and surgery | `Procedure` |

`lab_observations` corresponds to FHIR `Observation` (category `laboratory`), though its identifiers are not LOINC yet. `documents` itself corresponds to FHIR `DocumentReference`, and proposals with decisions correspond to `Provenance`.

For structured imports, each planned table would also carry `fhir_resource_type`, `fhir_id` and the original resource as JSON, so an import can be repeated or checked without losing fields the app does not yet use. A FHIR bundle is stored as a document first, like any other file, and its contents are records that point back to it.

Historical snapshots need no table of their own. A snapshot is a query: everything whose `recorded_at` or `effective_at` is on or before the chosen date, excluding rows that a later row in the same snapshot supersedes.

The frontend's `HealthEvent`, `LabResult`, `Medication` and `Diagnosis` types in `src/domain/types.ts` already have this shape, with `date` as `effective_at` and `documented` as `recorded_at`.
