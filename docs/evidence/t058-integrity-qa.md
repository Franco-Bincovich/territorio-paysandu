# PAY-T058 — QA independiente de integridad de originales

Revisor: agente domain, distinto del autor del extractor. Alcance: bytes, estructura, procedencia registrada y extracción inerte; no revisión semántica funcional, edición/render de DOCX ni certificación de autenticidad.

## Original y manifiesto

- Archivo: `docs/reference/t058/Territorio_Paysandu_7_Documentos_Actualizados_v0.3.zip`.
- Library ID: `libfile_0a8668e669c08191853f55de97cf48f5`; versión de Library **0** comprobada en xattr. La versión de Library no es la versión editorial.
- Tamaño: **165799 bytes**.
- SHA-256: `2561b4e84f1c417faadc063bedf1fe3849c805e0d605c78275345c243b34c434`.
- Inventario comprobado: **7 Markdown PAY + 7 DOCX PAY + LEEME_CAMBIOS_v0.3.md**. Códigos PRD-001, TRD-002, UX-003, FLOW-004, BE-005, PLAN-006 y BC-007 presentes en ambos formatos.
- Los 15 nombres, tamaños y SHA-256 coinciden con `t058-originals-manifest.json`. Los 7 hashes de texto XML DOCX y longitudes fueron comprobados mediante lectura inerte de `word/document.xml`.
- CRC de cada entrada verificado durante lectura con zipfile. No se ejecutó contenido ni se subió/reemplazó el original.

**Resultado de integridad del original recibido: PASS.** Los hashes identifican estos bytes; no prueban autoría, autenticidad institucional ni correspondencia con una versión histórica externa no suministrada.

## Versión editorial

Los nombres terminan en v0.3 y los siete Markdown y siete DOCX incluyen aviso de «ACTUALIZACIÓN VIGENTE — v0.3 (02/11/2026)», conservando historia y declarando borrador no aprobado.

PRD conserva subtítulo/tabla de versión **0.2**. Los otros seis conservan tabla/frontmatter de versión **0.1**. Esta coexistencia está expresamente explicada por el aviso de actualización; no se afirmó que todos los campos internos se hayan renumerado a 0.3. Tampoco se afirmó equivalencia exacta Markdown/DOCX ni identidad visual; la revisión semántica corresponde a los otros revisores y las decisiones v1.0 prevalecen.

## Pruebas del extractor

Pruebas en copias temporales aisladas, conservando el ZIP original. Salidas originales, aplicación, matriz y Notion no modificados por QA.

| Caso | Resultado inicial |
| --- | --- |
| Archivo válido | PASS; 22 archivos derivados: 15 entradas y 7 textos DOCX |
| Ruta `../escape.md` | Rechazo, cero escrituras |
| Ruta absoluta `/escape.md` | Rechazo, cero escrituras |
| Entrada de tipo symlink | Rechazo, cero escrituras |
| Nombre con separador invertido | Rechazo, cero escrituras |
| Directorio de salida preexistente symlink | Hallazgo: se siguió el enlace y escribió en su destino temporal |

No se encontró symlink en el directorio real `docs/reference/t058` ni sus ancestros inspeccionados. El hallazgo se reprodujo únicamente en un directorio de prueba bajo `/tmp`; no demuestra escape en la extracción real.

## Hallazgos de robustez comunicados al autor

1. Rechazar directorio de salida y ancestros symlink, además de las hojas. Comprobar todos los destinos antes de escribir para evitar salida parcial al detectar una hoja peligrosa.
2. Exigir explícitamente LEEME y exactamente un documento por código/formato. La validación inicial de conjuntos de códigos y 15 entradas no garantiza por sí sola la identidad del decimoquinto archivo.

Estos hallazgos afectan la robustez del extractor para entradas/entornos futuros, no la coincidencia de hashes ni el inventario del ZIP actual. Los dos hallazgos fueron corregidos por el autor y revalidados independientemente, según el cierre siguiente.


## Cierre de regresión del extractor

Tras la corrección del autor se repitieron cinco casos en temporales:

- ZIP válido: PASS, 22 archivos derivados.
- Salida symlink: rechazo antes de escribir; cero archivos nuevos.
- Ancestro de salida symlink: rechazo antes de escribir; cero archivos nuevos.
- LEEME sustituido por OTHER.md: rechazo de inventario antes de escribir.
- Hoja de salida symlink colocada en un documento final: rechazo en preflight, cero escrituras parciales y destino del enlace intacto.

**Resultado final: PASS para integridad y endurecimiento dirigido probado.** La fuente ahora exige el conjunto exacto de quince nombres y verifica directorio, ancestros y todas las hojas antes de la escritura. No se modificaron ZIP, aplicación, matriz ni Notion por este revisor. La revisión semántica y cualquier aceptación funcional v1.0 permanecen fuera de este informe.
