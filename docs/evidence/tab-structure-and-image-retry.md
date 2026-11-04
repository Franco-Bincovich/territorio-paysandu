# Independent QA: parcel tabs and image retry

Date: 2026-11-04. Local application at port 3037, intercepted synthetic API responses only.

Result: PASS for local UI regression. The five sections follow the reference names/order: Datos catastrales, Imágenes, Contactos, Consultas, Adjuntos. Adjuntos explicitly reports that upload/download is unavailable; no persistence was invented.

`storage-viewer-fixture.mjs` verifies five tabs and one associated tabpanel, aria-selected/controls/labelledby, exclusive relevant section headings, active keyboard focus, ArrowLeft/Right wraparound and Home/End at 1440, 390 and 320 pixels. All tested widths have no document overflow. Historical and survey synthetic SVG images are decoded and have positive naturalWidth. An injected HTTP 503 displays Reintentar imagen; after transport recovery the explicit retry remounts and decodes the image. Zoom, carousel reset, Escape/focus return, hidden historical metadata, visible survey metadata, missing areas, absence of Tasa and enabled consultation action pass.

Additional local fixtures executed successfully:

- `responsive-navigation-fixture.mjs`: search/record/history responsive navigation; mobile menu focus/Escape/close; image-dialog keyboard containment; history scroll 800 → 800.
- `frontend-history-scroll-fixture.mjs`: scoped filters/page, vertical and horizontal scroll (1498/73 → 1498/73), and original consultation focus restored.
- `frontend-races-fixture.mjs`: late parcel response rejection, viewer keyboard behavior, return to originating parcel consultations, date handling and logout/late-response isolation.

Existing fixtures now select Imágenes and Consultas via role tab; primary parcel headings are scoped to level 1 because the new summary repeats the parcel label. Initial test failures arose from obsolete selectors and from the test leaving keyboard focus on the retry button; corrected selectors/focus setup pass. Application source was not edited by this reviewer.

The generated screenshot `tasa-removed-viewer-synthetic.png` contains synthetic fixture content only. Comparison-reference files remain private and outside Git.

Cloud limitation: these tests replace download endpoints and do not establish authenticated remote download, checksum or image rendering. The parent reports that reference reads succeed but remote download fails because the Storage info operation is blocked. That diagnosis was not independently executed by this local reviewer and remains unresolved here. No Storage policy, remote data, deployment or permission change was performed. A successful live authenticated decode and checksum are still needed after the separately approved fix.
