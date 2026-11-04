# Imágenes privadas del prototipo — preparación, no integración completada

Base remota comprobada: `develop/g1-g2-foundation`, SHA `62d8e240cf63d2871311d0d99efeab0e92843170`. Checkout aislado, sin cambios a rama principal, Supabase, planes ni despliegues.

## Implementación

`ImageAdapter` sigue siendo el contrato portable. `IMAGE_PROVIDER=catalogue` conserva la fuente actual; `supabase` consulta `parcel_images` mediante el cliente de sesión, por localidad **Paysandú** + padrón **17718**, y resuelve únicamente `historical`/`survey`. Componentes visuales sin modificaciones. El backend mantiene títulos/carrusel/zoom y proyecta metadatos solo para relevamiento.

El navegador recibe únicamente `/api/parcel-image/historical` y `/api/parcel-image/survey`. Cada GET llama a `identity()` (perfil habilitado, cambio de contraseña, sesión vigente), vuelve a consultar la referencia bajo RLS y descarga por Storage con el JWT del usuario. La respuesta es `private, no-store`, no expone ruta interna, token, clave privilegiada ni URL firmada. Un archivo ya descargado no puede borrarse de la memoria del usuario al cerrar sesión; nuevas solicitudes requieren sesión vigente. Los errores no contienen detalles internos y el visor existente muestra indisponibilidad. No hay APIs de carga/reemplazo/eliminación para colaboradores.

La política de descarga exige `storage.allow_only_operation('object.get_authenticated')` para impedir que un usuario cree un enlace firmado mediante API directa. Verificar disponibilidad y comportamiento del helper en el proyecto antes de aplicar. Referencia oficial: https://supabase.com/docs/guides/storage/schema/helper-functions (consultada 2026-11-04). Documentación de permisos: https://supabase.com/docs/guides/storage/security/access-control. La descarga SDK fue verificada contra los tipos instalados de supabase-js 2.118.0. El índice changelog.md no pudo recuperarse: navegador rechazó content-type markdown y shell carece DNS; no se presume ausencia de cambios.

## SQL y asociaciones

`prepare-private-images.sql` es **borrador fuera del directorio de migraciones**, no aplicado. Crear la migración con CLI solo cuando DOT coordine secuencia. Usa la función de autorización existente `private.can_access()`, no un nuevo modelo de roles. Tabla única `parcel_images`: localidad, padrón, tipo, bucket, filename, object_path, source, metadata, sha256, hosting_authorized_at y authorization_reference. Máximo estructural dos filas, sin imágenes binarias en PostgreSQL. Rutas:

- Histórica: `imagenes-satelitales/paysandu/17718/historical/<filename-original-verificado>`.
- Relevamiento: `imagenes-catastro/paysandu/17718/survey/<filename-original-verificado>`.

Buckets privados, hasta 10 MiB por objeto y MIME PNG/JPEG/WebP. Si originales exceden estos límites o tienen nombres incompatibles con validación, detener esa carga y coordinar ajuste; no transcodificar ni modificar píxeles. No se han inventado nombres finales ni cargado objetos. No hay escrituras autenticadas sobre tabla de referencias ni Storage. Guardias restrictivas bloquean políticas permisivas accidentales en estos buckets y preservan otros buckets. Administrador de backend autorizado carga objetos via Storage API, nunca INSERT de binarios en storage.objects.

## Preflight coordinado obligatorio

1. Confirmar ID `kmimekswqpsuspkrxdet`, organización/plan Free y migraciones actuales; cotejar SHA de esquema base aplicado.
2. Inspeccionar `public.parcel_images`, `storage.buckets` para ambos nombres, objetos existentes, `pg_policies` sobre storage.objects y public.parcel_images, grants, `private.can_access()` y `to_regprocedure('storage.allow_only_operation(text)')`. Si aparecen estructuras/objetos/dependencias inesperadas, detener esta operación. Nunca sobrescribir buckets u objetos.
3. Guardar inventario y exportación de configuración/políticas sin secretos. El SQL crea objetos sin IF NOT EXISTS y en transacción: conflictos abortan en vez de esconder diferencias.
4. Revisar licencia/atribución de originales encontrados por DOT, comprobar localidad+padrón, bytes y SHA256. El usuario confirmó uso/alojamiento de ambas imágenes en mensaje transmitido por DOT; los archivos no se entregaron a este checkout. La autorización no inventa metadatos de licencia. No subir HTML del prototipo ni otros datos personales.
5. Aplicar migración una vez; subir solo dos originales con overwrite/upsert deshabilitado y obtener hashes de descargas. Insertar referencias administrativas exactas y evidencia de autorización. Inventariar buckets: exactamente dos objetos en total, uno por bucket. No insertar filas ni objetos de prueba extra en remoto.

## Reversión

Antes del commit SQL, cualquier fallo revierte toda la transacción. Tras aplicación, volver `IMAGE_PROVIDER=catalogue` y revertir el commit de aplicación permite retirar el nuevo proveedor sin eliminar datos. Mantener buckets privados y controles de acceso. La eliminación posterior de objetos, tabla, políticas o buckets requiere inventario actualizado, copia verificable de los dos originales y operación coordinada: no se entrega ni ejecuta un script destructivo automático. Si hay dependencias nuevas, no eliminar nada. No tocar el esquema base ni otras migraciones.

## Verificación y límites

- `local-check.log`: TypeScript PASS; 19 archivos de tests PASS; build optimizado PASS.
- Tests nuevos: asociación compuesta, buckets/rutas inválidos, duplicados, permisos de alojamiento ausentes, formato PostgREST +00:00, archivos ausentes, errores, bytes del proxy, sesión revocada simulada y no-store.
- PGlite: dos colaboradores simulados leen, perfiles no autorizados y anon no leen; INSERT/UPDATE/DELETE directos rechazados/no alteran filas, metadata sin escritura; objeto sin referencia invisible; creación de enlace firmado simulada rechazada; bucket ajeno conserva lectura anónima. Esto **no prueba** Supabase Auth/Storage real.
- `viewer-fixture-result.json` y `viewer-synthetic.png`: Chromium local, fixtures interceptados claramente sintéticos; carrusel, zoom 125%, cambio resetea zoom, Escape/foco y metadata solo relevamiento PASS. Imagen original nunca usada en esta prueba.
- `independent-review.md`: revisión independiente; correcciones incorporadas.
- Fallos corregidos: timestamp offset; guardia anon interfería con otros buckets; typing test. Primer build falló por symlink de dependencias fuera del root; copia local aislada resolvió el entorno. Primer arranque localhost requirió permiso de sandbox, luego QA pasó.

## Pendiente para DOT / backlog existente (sin duplicar tareas)

Actualizar tareas actuales de imágenes: fuente inmediata Supabase Storage; servicio institucional futuro como adaptador alternativo, no única dependencia. No modificar v2. Mantener parcial hasta evidencia remota. No se actualizó Notion desde este subtrabajo para evitar concurrencia: enlazar PR, este documento y resultados a tareas existentes.

Bloqueos: secuencia remota coordinada y aplicación del borrador; originales y verificación de hashes/atribución por DOT; catálogo aprobado que permita llegar a ficha 17718 (base actual solo devuelve tres registros sintéticos; no inventamos domicilio, superficies o personas); pruebas directas Storage con usuarios reales de prueba, logout/expiración, ausencia de objetos y denegaciones; QA visual de ambos originales; preview Vercel habilitado por DOT. La prueba de API directa debe incluir descarga permitida, signing/listing y mutaciones denegadas, y anónimo/no autorizado rechazado. No es entrega final de integración.

Cambiar proveedor: implementar `ImageAdapter.getImages` institucional en servidor, conservar DTO de dos slots y proxy autenticado, configurar composition en `imageProvider`. Ninguna dependencia Supabase entra en componentes visuales. No hay sincronización ni migración masiva.

## Revisión adicional — metadatos y acceso a 17718

La revisión adicional de 49fe126 confirmó una incompatibilidad: PostgreSQL acepta cualquier objeto JSON en metadata, pero el adaptador exigía valores string. Ahora acepta todos los tipos JSON bajo raíz objeto. La proyección para el visor conserva strings y serializa valores restantes como JSON (125.75 → "125.75", false → "false", null → "null", arrays/objetos → JSON). No agrega unidades, no deduce fechas ni sustituye nulos con datos; el jsonb persistido no se modifica. Metadatos históricos siguen excluidos del DTO. No requiere cambio SQL. Valores numéricos usan la representación recibida por el SDK JavaScript; si se necesita precisión arbitraria o ceros significativos, el contrato de origen debe proveer texto explícito, sin reconstruirlo por inferencia.

Pruebas de regresión incorporan números, cero, booleanos, null, arrays, objetos, texto literal, claves/textos extensos, descargas de ambos tipos, integridad de fuente y rechazo de raíces no objeto/no JSON. Evidencia: metadata-check.log.

El bloqueo del catálogo es real: handler exige findParcel antes de pedir imágenes. No se elimina esa validación ni se agrega una ficha ficticia. Propuesta de verificación independiente de catálogo, sin importación adicional:

1. Tras carga coordinada, usar una sesión de colaborador de prueba para GET /api/parcel-image/historical y /api/parcel-image/survey. Estos endpoints ya existen y no dependen de findParcel: identidad + referencias autorizadas compuestas + Storage/RLS. Comparar SHA256 de cada respuesta con el original; repetir tras logout/expiración y con sesión no autorizada para comprobar rechazo.
2. Preparar un harness de QA aislado que monte únicamente el visor existente con esos dos endpoints y los metadatos reales autorizados de relevamiento. Rotularlo «Prueba de imágenes Paysandú/17718 — no ficha catastral»; no incluir domicilio, personas, superficies, consultas ni contactos. Usar sesión real y bytes reales, sin interceptar API/Storage. Servirlo solo en loopback durante QA; no añadirlo a rutas públicas ni presentarlo como ficha funcional.
3. La prueba anterior acredita únicamente imágenes/visor. La navegación búsqueda → ficha 17718 y flujos de consultas siguen bloqueados hasta contar con catálogo/aprobación de datos correspondiente. No inventar registro ni importar los 421 casos. El harness propuesto no se implementó en esta revisión; no hay originales en el checkout ni permiso de secuencia remota.
