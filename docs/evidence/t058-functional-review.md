# T058 — Revisión independiente funcional de originales PRD, UX y FLOW

Fecha: 2026-11-04. Revisión documental de solo lectura; sin cambios en aplicación, Notion ni matriz. No aprueba requisitos ni gates.

## Fuentes, método y precedencia

Paquete recuperado por el orquestador mediante Library: `libfile_0a8668e669c08191853f55de97cf48f5`, versión Library `0`; identificación de bytes en `docs/evidence/t058-originals-manifest.json`. Originales locales ignorados por Git en `docs/reference/t058/extracted/`.

Se leyeron completos los Markdown maestros PRD (444 líneas), UX (94) y FLOW (131). Se revisaron los cuerpos extraídos de sus DOCX: PRD919 líneas, UX72, FLOW75 (splitlines; wc sin salto final puede dar una menos). Para PRD se comparó cada párrafo DOCX completo con MD normalizado solo en espacios/marcadores Markdown; todos los párrafos no vacíos aparecen en el maestro, sin párrafos adicionales. Esto ayuda a revisar contenido repetido; no prueba equivalencia bidireccional, conservación de tablas/estructura, objetos, headers/footers ni diseño del DOCX. UX/FLOW extraídos se leyeron completos por separado. No se ejecutó contenido, Mermaid ni enlaces del archivo.

LEEME_CAMBIOS_v0.3.md establece que MD son maestros y DOCX lectura rápida. Por tanto **no se declara MD=DOCX**, aunque haya coincidencia textual. Verificados independientemente SHA256 de los seis originales PRD/UX/FLOW contra manifest: seis coincidencias. Hash identifica bytes recuperados, no firma/autenticidad del autor ni prueba de aprobación.

Fuente vigente consultada nuevamente en Notion: [PAY-V1-DEC — Alcance y contrato de entrega v1.0](https://app.notion.com/p/40e30c4074f781968bfdfc17d2fbf599), `page_last_edited_at=2026-11-04T02:55:25.068Z`. Sus secciones2–5 y mandato/autorización del propietario prevalecen sobre v0.3. Se contrastaron también los cuerpos de T031/T032/T062/T113 conservados en la matriz de99 fichas. Los tres resúmenes históricos Notion previamente leídos están en `historical-documents-review.json`; describían el contenido anterior sin sustituir originales.

## Versiones declaradas y trazabilidad interna

| Original                      | Evidencia de versión histórica                                                   | Actualización explícita                                                  | Observación                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| PAY-PRD-001_PRD_v0.3.md       | Frontmatter líneas1–6: subtítulo versión0.2,29oct2026; control17–19:0.2/borrador | Aviso8; sección407–444: actualización0.3,02nov2026, aprobación pendiente | Nombre de archivo v0.3 no elimina historia0.2. DOCX control conserva0.2 y final850–919 contiene actualización0.3. |
| PAY-UX-003_UI_UX_v0.3.md      | Frontmatter1–6 y control17–19:0.1,29oct2026,borrador                             | Aviso8; sección61–94:0.3,02nov2026                                       | DOCX líneas11–16 conserva0.1;41–72 actualización0.3. Verde/oscuro se rectifica expresamente.                      |
| PAY-FLOW-004_App_Flow_v0.3.md | Frontmatter1–6 y control17–19:0.1,29oct2026,borrador                             | Aviso8; sección85–131:0.3,02nov2026                                      | DOCX líneas11–16 conserva0.1;47–75 actualización0.3.                                                              |

PRD reutiliza IDs REQ-050…053: adenda0.2 líneas372–375 (exportar auditoría/tema/login/UAT) frente a actualización0.3 líneas427–430 (sin estados/historial/dashboard/sin relleno). No interpretar ID aislado como requisito unívoco: citar documento, sección, versión y línea. No se renumeró ni corrigió el original.

## Coincidencias que permanecen aplicables

| Tema                       | Original y líneas                      | Conformidad con v1 vigente                                                                                                                                                                |
| -------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Búsqueda y datos oficiales | PRD93–98,125–128; FLOW46–48            | Localidad+padrón, carga tras buscar, datos fuente sin inventar y manejo de faltantes. V1 agrega búsqueda personal exacta transversal.                                                     |
| Permisos efectivos         | PRD56,67–68,174; FLOW42–44,58–60       | Autorización backend por recurso y edición propia permanecen; el bypass Administrador queda fuera de v1.                                                                                  |
| Integridad de consultas    | PRD103–114,178,199–208; FLOW50–60      | Alta explícita, validación, fallo sin falso éxito, preservar identificadores/autor/creación y evitar sobrescritura concurrente. V1 concreta snapshot+contacto transaccional/idempotencia. |
| Sin seguimiento            | PRD414,427; UX68,83; FLOW76,92,121–122 | Estados técnicos carga/error no son estados de trámite. No agregar resolución, asignación ni SLA.                                                                                         |
| Identidad visual           | PRD412,433,436; UX66,79–88; FLOW90     | Azul/blanco Premium UI, sidebar/topbar/cards y responsive. Se descartan propuestas históricas verde/oscuro y nuevo rediseño.                                                              |
| Imágenes y acceso          | PRD97–99,419; UX40,73,82,86; FLOW48,97 | Dos slots, ausencia explícita, zoom/carrusel y servicio externo; no mapa satelital navegable.                                                                                             |
| QA y aceptación            | PRD249,379–382,438; UX48,86; FLOW76,89 | Prototipo/fixtures no prueban backend ni integración; requiere QA independiente y aceptación. Recursos/supuestos no son SLA ni dimensionamiento medido.                                   |

## Divergencias resueltas por decisiones v1 y autorización vigente

| Histórico                                                                | Ubicación original                                                     | Regla que prevalece                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operador+Administrador, login propio y administración UI                 | PRD30,48,56–75,87–92; UX32,36,84–85; FLOW36–39,70–72,115–125           | Colaborador único y Supabase Auth/JWT/RLS, usuarios por procedimiento autorizado. Dashboard, gestión usuarios y auditoría administrativa avanzada son v2.                                                        |
| Contacto independiente limitado teléfono1/2 y correo                     | PRD100–102,161–164,418; UX44,72,82; FLOW62–64,96                       | Cards múltiples, titular primero, medios variables; solo alta al registrar consulta. No sobrescribir/editar/eliminar contactos existentes desde ficha.                                                           |
| Aviso/deduplicación                                                      | PRD109,150,178,357,370; FLOW52                                         | V1 permite registros repetidos con snapshots independientes, sin deduplicación/fusión. No introducir aviso basado en regla no aprobada.                                                                          |
| Adjuntos/exportaciones/analítica                                         | PRD116–122,416–417,429,432,434; UX70–71,82,84; FLOW66–72,94–95,121,123 | Fuera v1, no condicionan entrega funcional v1.                                                                                                                                                                   |
| Metadatos de todas las imágenes y arrastre                               | PRD348,367; UX44,82; FLOW32,48                                         | Solo metadatos de relevamiento; histórica Google Earth con selección temporal definida en v1. Zoom/carrusel v1; arrastre avanzado v2.                                                                            |
| Muestra real17718 exclusiva para maqueta, no datos ficticios precargados | PRD413,431; UX67,81; FLOW91,124                                        | Regla histórica de maqueta no autoriza datos institucionales cloud. Usuario autorizó exclusivamente fixtures sintéticas claramente identificadas en G0–G2; sin resultados precargados ni falsa integración real. |
| DB/hosting aún sin elección                                              | PRD355,358,388–394,420; UX74–75; FLOW98–99                             | Supabase operativo y Vercel autorizados bajo gates/costos; adaptadores institucionales siguen bloqueados. No asumir red, motor externo, licencias o permisos resueltos por recuperar ZIP.                        |

## Divergencias que requieren resolución documentada

1. **Longitud de descripción.** PRD REQ-020 línea106 exige mínimo20 y máximo5000 provisional; §11 línea178 repite20–5000; OPEN-007 línea310 mantiene máximo por ratificar. UX44 y FLOW52 también indican20–5000; DOCX UX33/FLOW31 conservan esa regla. La fuente v1§2 solo pide descripción validada, no declara otro rango. T032 objetivo conserva «texto >=20» y su callout reemplaza únicamente criterios incompatibles: el mínimo no resulta explícitamente derogado. Implementación actual admite1–10000 según revisión anterior. Registrar diferencia y solicitar/conciliar regla antes de declarar conformidad; no cambiar silenciosamente código o requisitos. Mínimo20 tiene soporte documental más fuerte; máximo5000 sigue provisional.
2. **Catálogo de vínculo.** PRD349,368 propone seis valores y rechazo de otros; v1 solicita vínculo sin catálogo explícito. T062 refiere vínculos/reglas institucionales sin enumeración final. Implementación de texto libre no debe presentarse como catálogo institucional confirmado. Mantener decisión pendiente sin inventar lista nueva.
3. **Especificidad de contacto/documentos.** PRD107,309 y355–357 deja algoritmos CI/RUT, normalización y contratos externos pendientes. La recuperación no valida checksum, acceso real ni retención. Las pruebas sintéticas de formato no cierran estas dependencias.
4. **Requisitos UX propuestos.** Objetivo WCAG2.2AA/touch44px y lista de navegadores en UX48 son propuestas/pendientes; la revisión local no prueba certificación de accesibilidad ni compatibilidad institucional completa.

No aparecen nuevas autorizaciones: los marcadores «confirmado» dentro de originales históricos no prevalecen sobre v1 ni sobre gates aprobados. Esta revisión cubre tres documentos funcionales; el contraste de los otros cuatro y consolidación7/7 corresponden al orquestador y revisión backend.

## Revisión auxiliar del inspector y regresión de catálogo

Lectura de `scripts/inspect-originals.py`: ZIP limitado a15 archivos regulares de un nivel, sin traversal/symlinks de archivo, cifrado, macros o embeddings; tamaños/ratios acotados; CRC leído antes de escritura; XML sin DTD/ENTITY; sin ejecución/red. Límites correctos: extrae solo cuerpo DOCX, no certifica layout ni equivalencia. Destino local aislado provisto por orquestador; no afirmar que sea un extractor genérico protegido frente a todos los ancestros symlink ni que inspeccione toda parte XML externa.

Revisión de commit56f16eb en `tests/server/security.test.ts`: único cambio2→3 en conteo de nombre exacto, coherente con tercer homónimo sintético; no altera aserción de substring ni funcionalidad. QA independiente en catalogue.test.ts ya distingue documentos2vs1.
