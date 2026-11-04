# Private download metadata operation — 2026-11-04

User explicitly authorized the minimum correction of both read policies.
Applied remote migration 20261104190622 allow_private_image_download_info
(local file 20261104190606). It changes only prototype_images_read and
prototype_images_guard to admit object.get_authenticated_info plus
object.get_authenticated. It retains private.can_access(), authenticated uid,
exact reference match, private buckets, anonymous guard and all write guards.
No listing or signed URL operation is admitted. No redeployment is required.

Prior live evidence: PostgREST parcel_images returned HTTP 200 and two rows;
Storage byte routes returned 400 while internal operation logs showed
object.get_authenticated_info / Object not found. Current Supabase access-control
documentation uses both operations for object reading.

After migration: inspected both policy definitions and unchanged write/anonymous
guards; actual unauthenticated HTTP requests to both public routes remain 400
(NoSuchBucket) and authenticated routes without JWT remain 400 (InvalidRequest).
Live authenticated SQL role without session sees zero references and objects.

Authenticated HTTP byte SHA256 and visual rendering remain pending: this executor
has no available authenticated browser/session (browser inventory empty). No
credentials were requested, copied, generated or extracted. Reopen the parcel
after refreshing the page to reset the viewer's previous failed-image state.

Rollback: in both read-policy definitions replace allow_any_operation array with
the former allow_only_operation('object.get_authenticated'); preserve every other
predicate. This restores the former behavior, including its download failure.
