# Independent local visual QA — 2026-11-04

Reference: Territorio_Paysandu_v03_Expediente_17718.html, Library libfile_40fd99f1d93881918ec60bc6edc14bdd. SHA-256: `6de5d360898bef5839dbf4384e25fce15c08670f8eb2c0061384494bf2429d2e`.

Result: PASS for the scoped local visual alignment and mocked UI regressions. This is not acceptance of hosted authentication, institutional integration or v1.0 completion.

Compared search, parcel record, consultation form and consultation history at 1440×1000 and 390×1000. All eight current app views have no horizontal document overflow. Desktop content padding is 27px 30px 36px; mobile is 22px 16px. Shared palette, rounded panels, sidebar, hero map composition, stacked search panels, record/contact columns and tab hierarchy now follow the reference. Mobile uses the compact header and navigation disclosure rather than a full sidebar above content. Original logo decodes correctly.

Executed against local port 3037 with synthetic API fixtures:

- `settings-password-fixture.mjs`: PASS. Keyboard-accessible visibility toggles do not submit; initial password gate, mismatch rejection, settings navigation and password-only endpoint payload preserved. Responsive widths 1440, 768, 390 and 320 have no overflow. Map visible above 550px and hidden below that breakpoint.
- `responsive-navigation-fixture.mjs`: PASS. Keyboard search result traversal, record opening, zoom, image switching, focus containment and Escape in image viewer, history scroll restoration (800px to 800px), mobile menu opening focus, Escape returning focus and closure after navigation. No page errors.
- `storage-viewer-fixture.mjs`: PASS. Tasa absent, Registrar consulta enabled, unavailable areas, historical metadata suppression, survey metadata, zoom reset and restored focus.

Tests were adjusted only to open mobile navigation when needed and to reflect the reference map breakpoint. No application code was edited by the reviewer. Initial settings rerun timed out because its selector attempted the now-hidden profile before opening Menú; the corrected navigation test passed.

Screenshots of both reference and app for all four screens and both widths, plus computed geometry and the comparison script, remain outside Git in `../private-visual-reference/`. External requests were blocked for comparison; reference identity/contact fields were replaced with synthetic values in memory before capture. Original reference imagery remains private. Repository screenshots `qa-settings-*.png` and `tasa-removed-viewer-synthetic.png` contain only synthetic fixtures or empty password fields, and were regenerated for the current layout.

Remaining differences and limits:

- Consultation entry remains a full page containing the approved v1 person/contact and description fields; the reference's smaller modal has a different field set. Recreating that modal literally would remove required functionality.
- Reference-only KPI, administration, attachments and export features were not restored. No fabricated values or images were introduced.
- Local image-viewer tests use synthetic SVG images. Real image availability and hosted services are not established by this QA.
- No cloud writes, deployment, commit or push were performed by this reviewer. No blocking visual defect found within the tested scope; final user acceptance remains pending.
