# Independent QA — simplified parcel view

2026-11-04, local port 3037, synthetic intercepted API only. PASS.

Updated and executed `tests/qa/storage-viewer-fixture.mjs` after the requested removals. Exactly four tabs remain: Datos catastrales, Imágenes, Contactos and Consultas. Adjuntos, the summary sidebar/heading and surface cards are absent. The record panel spans the full detail-grid width.

Verified keyboard ArrowLeft/Right wraparound, Home/End, selection/focus, one relevant tabpanel and no document overflow at 1440, 390 and 320 pixels. Screenshots reviewed: `four-tabs-record-1440-synthetic.png` and `four-tabs-record-390-synthetic.png`.

Data preservation: ordinary definition-list fields retain land area 125.5 rendered as 125,5 m², built area zero rendered as 0 m², and missing detected area as No disponible. A second fixture supplies the three original area text fields; each original string appears exactly once and the derived surface fields are omitted. No original values are replaced or guessed.

Image regression remains PASS: historical and survey synthetic images decode with positive naturalWidth; injected 503 exposes retry and recovery decodes; zoom125%, carousel reset, Escape/focus restoration, historical metadata suppression and survey metadata display pass. Registrar consulta stays enabled and Tasa stays absent. No page errors.

Limit: local fixtures do not establish remote Storage availability, authenticated download or checksum. No cloud action, deployment, app-source edit, commit or push was performed by this reviewer. This report supersedes the earlier five-tab layout expectation only.
