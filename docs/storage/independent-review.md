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

## Revisión adicional — compatibilidad de metadatos JSONB

Base del delta: `49fe126`. Revisé `src/server/storage-images.ts` y los nuevos casos de `tests/server/storage-images.test.ts`. El esquema de lectura ahora acepta un objeto JSON con valores JSON, compatible con la restricción `jsonb_typeof(metadata) = 'object'`. La proyección al visor conserva strings y convierte números, booleanos, null, arrays y objetos mediante `JSON.stringify`, sin mutar referencias ni escribir metadatos a la base. No inventa unidades o fechas, y la respuesta histórica sigue sin exponer metadatos técnicos.

Verificación independiente: `npm run typecheck` **PASS**; ejecución dirigida de storage-images, images y storage-rls **3 archivos PASS, 0 FAIL**. Incluye mezcla de tipos, ceros/falso/null, arrays/objetos, texto y claves largas, fuente original intacta, descarga de ambos tipos y rechazo de raíz no-objeto o valores no-JSON. No encontré un defecto bloqueante en este delta.

La conversión es una presentación textual de valores JSON ya decodificados por JavaScript; no implica preservar la representación textual exacta del JSON original ni precisión decimal arbitraria. La base conserva su JSONB sin cambios.

La evidencia ejecutada en esta revisión es sintética. La propuesta de verificación futura es distinta: un harness aislado del visor con sesión autorizada y bytes REALES de Supabase Storage para localidad Paysandú + padrón 17718, sin interceptar APIs ni inventar una ficha catastral. Si se ejecuta con esos requisitos, podrá acreditar recuperación y visualización efectiva de las imágenes autorizadas, junto con el proxy directo. No acreditará búsqueda ni ficha completa: el catálogo sigue sin ese padrón. Esta revisión no ejecutó ese harness real, servicios remotos ni despliegues.

## Revisión previa a aplicación — base integrada 165d86fa

Revisé la integración pendiente de commit con la base principal de desarrollo informada por el autor y la migración oficial `20261104144022_private_prototype_images.sql`. Confirmé por comparación exacta que el cuerpo desde `begin;` coincide con el borrador SQL previamente revisado. Solo cambió el encabezado. No se altera la migración inicial ni las restricciones de consultas sintéticas; `parcel_images` mantiene su asociación independiente y exclusiva a Paysandú/17718.

El cambio a description-parity usa una clave sintética admitida por la nueva FK de consultas y conserva los escenarios de límites Unicode, normalización, edición, concurrencia e idempotencia. Excluye únicamente `_private_prototype_images.sql`, que requiere el esquema Storage y ahora es cargada por storage-rls desde su ubicación oficial. No se detectó reducción de las comprobaciones del propósito de esa suite.

Verificación independiente ejecutada:

- TypeScript **PASS**.
- **7 archivos dirigidos PASS, 0 FAIL**: backend-security, parcel-integrity, rls, storage-rls, description-parity, storage-images y username-login.
- Prueba adicional PGlite aplicando **las tres migraciones en secuencia**, con la implementación real de `private.can_access()` de la inicial (solo Auth y Storage de plataforma simulados): lectura autorizada PASS, `object.sign` denegado PASS, cambio obligatorio de contraseña impide referencias/descarga PASS, anon sin objetos PASS. Esto verifica interacción local entre migraciones; no emula el servicio HTTP remoto.

El padre informó preflight remoto de solo lectura: proyecto Free, dos migraciones previas, ningún bucket/objeto/política Storage, tabla parcel_images ausente, can_access coincidente y helper por operación disponible. No ejecuté ni validé ese inventario remoto por mi cuenta. Bajo ese estado comprobado por el ejecutor, **no encuentro regresiones ni un bloqueo de código para aplicar esta migración transaccional**. No constituye confirmación de aplicación ni autorización para omitir preflight actualizado o modificar otro proyecto. Después de aplicar siguen siendo necesarias las comprobaciones reales de buckets privados, políticas, permisos directos y recuperación de originales autorizados. La ficha 17718 y la integración de extremo a extremo continúan con los límites ya documentados.

Observación documental: README de Storage aún describe el SQL como borrador fuera de migraciones y secuencia no coordinada; actualizar esa sección al registrar la aplicación y sus evidencias, conservando la distinción entre preparado y realmente ejecutado.

## Revisión de rutas raíz — migración 20261104185042

El adaptador admite exclusivamente `filename` raíz o la ruta compuesta original; conserva validación estricta de nombre, bucket/tipo y localidad+padrón. La migración reemplaza solo el CHECK de ruta, sin alterar políticas ni escrituras administrativas. Confirmé en PGlite que `parcel_images_check1` es el nombre generado por la migración original y que el nuevo CHECK acepta ambas formas mientras rechaza rutas ajenas/traversal. El ejecutor debe cotejar nombre/definición remotos antes de aplicar; esta revisión no hizo operaciones remotas.

Encontré una regresión de pruebas: description-parity incluía la nueva migración aunque excluía la creación de parcel_images. A pedido del autor corregí la exclusión con los dos nombres exactos y amplié storage-rls para aplicar ambas migraciones en secuencia. La prueba preserva la referencia anidada existente al migrar, cambia administrativamente una referencia a raíz, conserva otra anidada y comprueba acceso de dos colaboradores; rechaza rutas distintas, cambio de bucket, localidad y padrón, y mantiene comprobaciones de RLS/escrituras/firma.

Resultado independiente después de corregir: TypeScript **PASS**; storage-rls, description-parity y storage-images **3 archivos PASS, 0 FAIL**. Archivos de pruebas modificados sin commit para integración del padre. No se detecta ampliación de lectura a objetos sin referencia: la asociación sigue siendo exacta por bucket+object_path y las referencias están restringidas a dos tipos para Paysandú/17718.

Riesgos pendientes: verificar constraint remoto antes de ALTER; cotejar nombre/hash/atribución de los dos objetos subidos por usuario; no ejecutar literalmente el comentario de rollback sin evaluar referencias raíz actuales, porque su eliminación retiraría asociaciones. La base de diseño `1cf94f2` no está disponible en este checkout, por lo que no se acreditó todavía compatibilidad de cherry-pick sobre esa rama.

## Compatibilidad de descarga autenticada/info — 20261104190606

Revisé la nueva migración: modifica únicamente las expresiones USING de las dos políticas existentes para admitir `object.get_authenticated_info` y `object.get_authenticated`. Conserva rol authenticated, guardia restrictiva, autorización de sesión, asociación exacta bucket/ruta y protección de los dos buckets. No habilita listado, firma ni escritura. El autor informa aplicación remota; no la ejecuté ni confirmé remotamente desde esta revisión.

Actualicé storage-rls para cargar las tres migraciones Storage en orden, implementar el helper simulado allow_any_operation y verificar ambos modos de lectura para dos colaboradores sobre referencia raíz y referencia anidada. Se rechazan object.sign, object.list, object.get_public y operación vacía; ambos modos de lectura rechazan perfiles no autorizados. Siguen pasando controles de escritura, anónimo, objetos sin referencia y bucket ajeno. Los helpers simulados ahora fallan cerrados cuando no hay operación, sin asumir descarga por defecto. description-parity excluye la nueva migración por nombre exacto, conservando su cobertura en la suite Storage.

Resultado: TypeScript **PASS** y **3 archivos dirigidos PASS, 0 FAIL** (storage-rls, description-parity, storage-images). Sin hallazgos bloqueantes adicionales en este delta. Los tests son simulación PostgreSQL/SDK; no sustituyen las solicitudes HTTP reales de descarga/info y rechazos al servicio remoto. Cambios locales sin commit, según encargo.
