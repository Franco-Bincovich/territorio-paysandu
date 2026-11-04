# Uploaded prototype objects — 2026-11-04

User confirmed uploading both originals and authorized integration and redeployment.
Only project kmimekswqpsuspkrxdet was changed. Both buckets remain private.

| Kind | Bucket | Actual object | Bytes | Multipart ETag |
| --- | --- | --- | --- | --- |
| historical | imagenes-satelitales | e97532ac-1593-4fb2-b6eb-1dad5775b43c.png | 1596745 | aef664e70fb4954bace5138b948f6fee-1 |
| survey | imagenes-catastro | d8eb600a-0cfb-40ca-b287-28424cac89f4.jpg | 352798 | fc70b04e120739644701967d95ddf533-1 |

Both sizes and single-part multipart ETags match local original bytes. SHA-256
of downloaded authenticated remote bytes is still pending; stored SHA-256 values
are the previously verified originals, not a claim of completed download QA.

Applied remote migration 20261104185136 support_uploaded_prototype_paths (local
20261104185042). It permits an exact root filename in addition to the original
canonical path. Filename, bucket/type, locality Paysandú, parcel 17718 constraints
and RLS remain in force. No Storage object was moved, overwritten or deleted.
Registered exactly two references; technical metadata copied only for survey.
Historical source explicitly records that exact attribution is pending.

Vercel IMAGE_PROVIDER changed from catalogue to supabase for production and
preview. This requires the next deployment to include the adapter patch in this
commit; coordinate one publication with design commit 1cf94f2. No deployment was
performed by this task.

Checks passed: TypeScript; storage adapter tests including root path rejection of
unrelated filenames/traversal; live SQL authenticated role without session sees
zero references and objects; direct HTTP public requests to both objects fail
(HTTP 400, NoSuchBucket/404 body); authenticated routes without authorization
fail HTTP 400 InvalidRequest. These do not prove authorized download or browser
rendering. Authorized session, downloaded SHA256, carousel/zoom, expiry, and
independent review remain required before completion.

Rollback: restore IMAGE_PROVIDER=catalogue and redeploy the prior release;
remove only these two reference rows if rolling back the schema, then restore
the original canonical-path check. Keep both private Storage objects intact.
