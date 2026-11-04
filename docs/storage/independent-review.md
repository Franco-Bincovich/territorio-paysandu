# Revisión independiente — preparación de Storage

Fecha: 2026-11-04. Base: 62d8e240cf63d2871311d0d99efeab0e92843170. Revisión del diff y archivos nuevos en checkout separado; sin llamadas ni mutaciones a Supabase remoto. Los hallazgos describen la versión inspeccionada, anterior a las correcciones del autor.

## Hallazgos reproducidos

1. **P1 — Timestamp real rechazado.** `hosting_authorized_at: z.string().datetime()` rechaza offsets de PostgREST (`2026-11-04T10:00:00+00:00`). Repro local Zod: offset=false, Z=true. La respuesta de metadatos real puede devolver 503 antes de firmar URLs. Recomendación: aceptar offsets explícitos y probar una fila con formato PostgREST.
2. **P2 — Guardia pública afecta consultas anónimas a otros buckets.** `prototype_images_guard ... TO public` referencia `parcel_images`, sin SELECT para anon. Repro PGlite con esquema Storage mínimo, migración inicial y borrador Storage; una política adicional permite a anon leer bucket `other`, pero SELECT falla con `permission denied for table parcel_images`. Recomendación: guardia para anon limitada a excluir los dos buckets, y guardia para authenticated con predicado completo. No ampliar permisos de anon a tablas privadas.

## Límites funcionales explícitos

- La ficha 17718 no existe en el catálogo sintético actual. La composición de imágenes ocurre después de `findParcel`, por lo que configurar IMAGE_PROVIDER=supabase no permite alcanzar esa ficha. Falta el catálogo aprobado o una adaptación explícita autorizada para el prototipo.
- URLs firmadas duran 60 segundos; no hay renovación en el visor. Abrir zoom después de su vencimiento puede fallar. El manejo actual muestra indisponibilidad, pero no distingue sesión vencida de archivo ausente ni obtiene un URL nuevo. No se verificó con navegador/Storage real.
- No hay objetos originales, asociación/hash comprobados, autorizaciones individuales de alojamiento, buckets ni políticas remotas aplicadas en esta revisión. Ninguna prueba acredita recuperación o visualización real.
- SQL es borrador fuera de migraciones, no aprobado como migración aplicada. Requiere preflight, revisión del esquema/políticas remotos, rollback y coordinación del ejecutor.

## Verificación independiente

`npm test`: 17 archivos PASS, 0 FAIL (suite previa; aún no incluía tests nuevos de Storage al ejecutar). SQL de borrador compila en PGlite con stubs Auth/Storage. Repro adicional confirma el segundo hallazgo. Esto no emula las rutas HTTP, firma ni servicio Storage de Supabase.

Aspectos favorables: cliente de sesión por request (sin service-role para lectura), combinación localidad+padrón estricta, validación de bucket/tipo/ruta, límite máximo de dos referencias con tipo único, sin métodos de escritura en el adaptador, proyección histórica sin metadatos, y restricciones de INSERT/UPDATE/DELETE para roles sometidos a RLS.

## Segunda revisión — correcciones del autor

Revisé el nuevo diff, incluyendo `src/app/api/parcel-image/[kind]/route.ts`, `tests/server/storage-images.test.ts` y `tests/database/storage-rls.test.ts`.

- **P1 resuelto:** validador usa `datetime({ offset: true })`; test incluye timestamp con `+00:00` y pasa.
- **P2 resuelto:** la guardia SELECT distingue anon/authenticated. La guardia anon solo evalúa bucket; la regresión verifica lectura anónima permitida de bucket ajeno sin acceso a `parcel_images`.
- **Expiración de URL resuelta arquitectónicamente:** se eliminaron URLs firmadas entregadas al navegador. Un proxy propio revalida `identity()` por solicitud, descarga con el cliente JWT del usuario y devuelve `Cache-Control: private, no-store, max-age=0`. La lista de referencias solo expone rutas exactas `/api/parcel-image/historical|survey`; no recibe rutas de objetos arbitrarias. Este flujo aún necesita pruebas HTTP/Storage reales.
- **Fallo nuevo detectado durante verificación:** `npm run typecheck` falló con TS2571 en storage-rls.test.ts:31 por `rows[0].n` de tipo unknown. Se informó al autor para tipar la consulta; no afecta la evaluación runtime de RLS.
- `npm test` reejecutado: **19 archivos PASS, 0 FAIL**, incluidos ambos nuevos archivos de Storage. La simulación cubre dos identidades autorizadas, desautorización, rechazo anónimo, objetos no listados y prohibición de insert/update/delete, incluso ante política permisiva amplia. Auth y Storage son stubs, no servicios reales.

No encontré otro defecto bloqueante de seguridad en el código inspeccionado. Continúan los límites de entrega: catálogo no expone 17718, archivos originales ausentes en el checkout y no hay prueba real de recuperación/visualización ni despliegue. El padre informó autorización de alojamiento; esta revisión no verificó su evidencia ni disponibilidad física de los archivos. La integración permanece preparación local, no completada.

Cierre de tipado: el autor corrigió el tipo de consulta y reejecuté `npm run typecheck`: **PASS, exit 0**. TS2571 queda resuelto. No quedan hallazgos de código abiertos de esta revisión; permanecen los bloqueos de integración real descritos arriba.

## Revisión final — proxy y restricción por operación

Revisé extracción de `createImageDownloadHandler` y composición real de la ruta con `identity`. El nuevo test de respuesta comprueba bytes, encabezado no-store y rechazo 401 tras revocación simulada sin otra descarga. La política permisiva y la guardia authenticated exigen `storage.allow_only_operation('object.get_authenticated')`, evitando que otra política permisiva habilite firma o listado de los objetos protegidos. La documentación oficial confirma el helper y equivalencia del prefijo `storage.`: https://supabase.com/docs/guides/storage/schema/helper-functions. La disponibilidad y permisos reales del helper deben comprobarse en preflight; no sustituirlo por una política SELECT amplia.

Reejecuté los dos archivos de pruebas Storage tras este delta: **2 PASS, 0 FAIL**, incluida operación `object.sign` denegada en la simulación. Revisé `viewer-fixture-result.json`: contiene PASS con `mocked:true`, carrusel, zoom, foco y metadatos; no constituye evidencia Storage real ni de las imágenes originales. El autor informó `npm run check` completo PASS (19 archivos y build) tras reemplazar enlace de dependencias fuera del root por copia local; no repetí ese build independiente, sí la batería dirigida del delta final.

Sin nuevos hallazgos bloqueantes en el diff revisado. Se mantienen condiciones de entrega real y disponibilidad de catálogo/archivos. No se realizó mutación remota ni despliegue durante la revisión.
