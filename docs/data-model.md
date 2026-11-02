# Data model

## Today

| Table | Holds |
| --- | --- |
| `documents` | One row per unique original file: `sha256` (unique), `original_filename`, `media_type`, `byte_size`, `document_type`, `processing_status`, `storage_key`, `imported_at` |
| `import_events` | One row per arrival of a file, including duplicates: `document_id`, `submitted_filename`, `outcome`, `occurred_at` |

`document_type` is `unclassified` until something can classify documents. `processing_status` is `uploaded` until something can read them.

## Rules future tables should follow

None of the tables below exist yet. They are a design to build toward, and they may change when real data arrives.

1. **Every fact points at its source.** Each record has a `source_document_id` foreign key. Nothing exists in the archive without a document behind it, or an explicit record that a person entered it.
2. **Two dates, always.** `effective_at` is when something happened. `recorded_at` is when it was documented. The time machine depends on this: "As known then" filters on `recorded_at`, and "As understood now" filters on `effective_at`. Neither may be guessed; unknown stays `NULL`.
3. **Corrections never overwrite.** A correction is a new row with `supersedes_id` pointing at the old one. Reviewing keeps the extracted value next to the corrected one, so any change can be traced and any past snapshot can be rebuilt.
4. **Values stay as printed.** Keep the value, unit, reference range and flag exactly as the source states them, each result with its own range. Never convert units or merge ranges in storage.
5. **Originals are never touched.** Derived data can be deleted and regenerated from `originals/`. The reverse is not possible.

## Planned tables

| Table | Holds | FHIR resource |
| --- | --- | --- |
| `observations` | Measurements: weight, vital signs, device readings | `Observation` |
| `lab_results` | Laboratory values, with their printed unit, range and flag | `Observation` (category `laboratory`) |
| `diagnostic_reports` | Imaging and pathology reports, kept as written | `DiagnosticReport` |
| `medications` | Medications with dated dose periods | `MedicationStatement` |
| `conditions` | Diagnoses, with onset, documented and resolved dates | `Condition` |
| `procedures` | Procedures and surgery | `Procedure` |
| `extractions` | Which method produced a record, when, at what confidence, and how a person reviewed it | `Provenance` |

`documents` itself corresponds to FHIR `DocumentReference`.

For structured imports, each planned table would also carry `fhir_resource_type`, `fhir_id` and the original resource as JSON, so an import can be repeated or checked without losing fields the app does not yet use. A FHIR bundle is stored as a document first, like any other file, and its contents are records that point back to it.

Historical snapshots need no table of their own. A snapshot is a query: everything whose `recorded_at` or `effective_at` is on or before the chosen date, excluding rows that a later row in the same snapshot supersedes.

The frontend's `HealthEvent`, `LabResult`, `Medication` and `Diagnosis` types in `src/domain/types.ts` already have this shape, with `date` as `effective_at` and `documented` as `recorded_at`.
