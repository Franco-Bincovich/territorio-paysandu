# Authorized prototype record

Scope: only Paysandú/17718 from Territorio_Paysandu_v03_Expediente_17718.html. One record, sixteen original string fields; no consultations/history in source. Personal values and original HTML remain outside Git. Data is prototype-derived, not institutionally verified. The declared percentage is preserved verbatim, not recomputed. Numeric surfaces parse Spanish notation; original strings remain visible.

Schema migration adds prototype_parcels with RLS and SELECT restricted by private.can_access. No client DML; no anonymous grants. Seed import separately and atomically adds the prototype record and its exact composite key to legacy private.synthetic_parcel_keys. This table name is historical: after import it contains synthetic keys plus the single authorized prototype key. Do not grant client writes or treat every key as synthetic.

Preflight: prototype table absent, exact key absent, can_access and allowlist present. Storage table exists and is managed separately. No Storage migration/upload in this change.

Rollback: disable PROTOTYPE_RECORD_ENABLED and redeploy approved code if necessary. Preserve source row, consultations, allowlist, migration history. Correct via a new migration; do not drop tables or remove referenced keys. Import uses INSERT, not overwrite; an unexpected preexisting row aborts the transaction. Recheck after uncertain outcomes before retrying.

Application branch based on Storage559c3c6, so existing imageProvider remains intact. New server adapter uses the authenticated caller client and no privileged key/cache. All original fields appear in the existing read-only detail layout; provenance label is mandatory. Logo/map redesign deferred.

## Actual result

Schema applied remotely: 20261104145823 authorized_prototype_record; 20261104145915 validate_prototype_fields. The second migration closes SQL NULL/type validation gaps identified by independent QA. Source document type is not confirmed, so prototype document is displayed verbatim but not matched as both CI and RUT. Exact name and locality/parcel search remain supported.

Personal-data import was DENIED by automatic review, with no retry or alternative route. Post-check: zero prototype rows and zero allowlist keys for Paysandú/17718. RLS enabled; anonymous SELECT false; authenticated INSERT false. Application activation and protected deployment remain pending integration; no source values loaded and no claim of real ficha availability.

Local validation: typecheck PASS; full npm test 23 files PASS, zero failed; production build PASS after replacing a dependency symlink unsupported by Turbopack with local dependencies. No changes to global configuration. Independent QA findings corrected with negative regression tests.

## Revised scope: fictitious personal fields loaded

User replaced the rejected personal-data scope with entirely fictional owner/contact/document/phones/email. Only the eleven other original fields were retained, without inventing missing source values. Five personal field values were replaced locally BEFORE constructing any remote query. A personalDataMode=synthetic marker and explicit field labels/provenance distinguish them. No original personal values were transmitted in this new operation.

New atomic import succeeded. Readback confirms one Paysandú/17718 row, payload equality to sanitized source, source digest equality, institutionally_verified=false, personalDataMode=synthetic, and exactly one allowlist key. No consultations or historical contacts were fabricated. The earlier rejected operations remain unexecuted.

Post-change tests: typecheck, adapter/HTTP regression and production build PASS. CI/RUT search remains disabled for this prototype record because no actual document type is attested. Use locality Paysandú and parcel17718 or the exact fictional name.
