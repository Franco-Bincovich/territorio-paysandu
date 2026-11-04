# PostgreSQL y autorización

Estado actual: dos migraciones aplicadas mediante el conector y confirmadas por historial/catálogo. Proyecto exclusivo `kmimekswqpsuspkrxdet`, Free. Ocho tablas con RLS y FK de tres claves sintéticas; sin usuarios/Auth real todavía. Los registros de intentos pendientes abajo se conservan como historia, no como estado vigente.

Mapa de versiones (MCP asignó timestamp remoto):

| Archivo local | Versión remota | Nombre |
| --- | --- | --- |
| 20261104035645_initial_collaborator_schema.sql | 20261104130855 | initial_collaborator_schema |
| 20261104125456_enforce_synthetic_parcel_keys.sql | 20261104130930 | enforce_synthetic_parcel_keys |

No ejecutar `db push` ni `migration repair` automáticamente: primero reconciliar este mapa y evitar reaplicar DDL. No se modificó el historial remoto para ocultar la diferencia.


## Modelo

- `profiles`: identidad Auth, nombre visible único sin distinción de mayúsculas, único rol collaborator, habilitación y bloqueo de cambio inicial.
- `consultations`: padrón compuesto localidad/número; datos actuales editables; snapshot original inmutable; creador y fechas; versión optimista.
- `contacts`: un contacto independiente por consulta. Ediciones posteriores no alteran contactos ni el snapshot original.
- Esquema no expuesto `private`: actividad de sesiones, revisiones completas, idempotencia y límites de login.

Los tres objetos públicos tienen RLS. `authenticated` solo tiene SELECT: no puede crear contactos, modificar snapshots ni eludir la transacción con DML directo. Las mutaciones usan funciones públicas `SECURITY INVOKER` que delegan a funciones privadas `SECURITY DEFINER`, cada una con validación explícita de `auth.uid()` y acceso. Las privadas requieren definer para mantener atomicidad sin conceder DML y para inspeccionar `auth.sessions`; fijan `search_path=''`, califican objetos y revocan EXECUTE de PUBLIC/anon. No se confía en user_metadata. No agregar `private` a los esquemas expuestos por PostgREST.

## RPC

| Función pública | Acceso | Resultado |
|---|---|---|
| `touch_auth_session()` | authenticated | boolean, valida sesión incluso con cambio de contraseña pendiente |
| `touch_session()` | authenticated | boolean, valida sesión y gate de acceso a negocio |
| `create_consultation(p_payload jsonb, p_idempotency_key uuid)` | authenticated | fila consulta JSON snake_case |
| `edit_consultation(p_id uuid, p_expected_version integer, p_payload jsonb)` | authenticated | fila actualizada JSON snake_case |
| `consume_login_attempt(p_key text)` | service_role únicamente | boolean, 5 intentos/15 minutos |
| `finalize_password_change(p_user_id uuid, p_session_id uuid)` | service_role únicamente | boolean, cierra gate tras cambio iniciado por usuario y reautenticación verificada |

Payload de consulta: `{locality,parcel,type,description,person:{name,documentType,document,relationship,phones:[],emails:[]}}`. Tipos: General, Reclamo, Falta de documentación. Documentos: CI/RUT. Tanto teléfonos como correos deben contener al menos un valor. Los números no se convierten a enteros para preservar ceros iniciales. La validación institucional del dígito verificador no se presume resuelta.

Idempotencia serializa el par usuario/UUID; repetir el mismo payload devuelve la consulta existente, pero cambiarlo produce `23505 IDEMPOTENCY_CONFLICT`. La transacción incorpora consulta, contacto, revisión inicial e idempotencia o no guarda ninguno. No hay deduplicación de personas. Editar exige propietario y versión; conflicto `40001 VERSION_CONFLICT`. No cambia localidad/padrón, creador, fecha original o snapshot. Revisiones guardan el registro completo en cada versión.

## Sesiones y primera contraseña

Provisionar perfiles mediante el canal administrativo autorizado con `must_change_password=true`; el frontend no puede modificarlo. La lectura del propio perfil se permite antes de completar el cambio; los datos de negocio no.

Un trigger en `auth.users` detecta un cambio real del hash de contraseña mediante `IS DISTINCT FROM`, activa el bloqueo y fija `password_changed_at`. Borra actividad anterior. No procesa contraseñas en texto plano. El cambio de hash por sí solo nunca demuestra elección de contraseña por el usuario (puede ser reset administrativo o rehash). La aplicación debe cerrar las sesiones y volver a autenticar con la contraseña nueva. Tras `getUser` y claims verificados del cliente recién autenticado, el backend llama con su clave de servicio a `finalize_password_change`. Los IDs provienen exclusivamente de esa identidad verificada, nunca del input. La función exige perfil habilitado, cambio ocurrido en los últimos cinco minutos y sesión perteneciente al usuario creada después del cambio; solo entonces limpia el bloqueo. La clave de servicio no se entrega al navegador. La sesión de negocio debe existir en `auth.sessions`, pertenecer al usuario, no superar `not_after` y haber sido creada después del cambio. Esto impide que un JWT anterior retome acceso aunque todavía no haya expirado.

`touch_auth_session()` inicializa únicamente sesiones creadas en los últimos cinco minutos. Actualiza actividad solo si aún no han transcurrido sesenta minutos. Una sesión inactiva no puede revivirse con este RPC: exige nuevo login. `touch_session()` añade el bloqueo de negocio por cambio de contraseña. Las rutas de autenticación deben llamar `touch_auth_session()` incluso con ese cambio pendiente: nunca deben aceptar un JWT revocado/expirado por saltarse el gate de negocio. RLS revisa el plazo persistido, incluso en acceso directo a PostgREST. La aplicación debe invocarlo por actividad real del usuario, no por un heartbeat automático que prolongue sesiones abandonadas.

## Prevención de abuso

El backend calcula SHA-256 del nombre de usuario normalizado con NFKC, trim y minúsculas; no almacena el identificador en claro como clave. Este hash **no es anonimización fuerte**: identificadores de baja entropía pueden recuperarse por diccionario. La implementación actual no incluye limitación por IP ni secreto HMAC. Consulta el límite persistente antes de llamar Auth y falla cerrado si no está disponible. La cuota se consume también si el login es correcto para evitar reintentos sin control.

Los rate limits nativos de Supabase Auth y CAPTCHA requieren configuración y verificación antes de la liberación. El límite por usuario permite que un tercero provoque bloqueo temporal de una cuenta conocida; es un riesgo pendiente para QA de abuso. Incorporar límite por IP requeriría definir proxy confiable y tratamiento de IP, sin confiar en cabeceras arbitrarias.

La limpieza de entradas caducadas del limitador y la retención de revisiones requieren configuración operativa aprobada. No hay borrado programado ni retención inventada en este esquema.

## Aplicación y pruebas pendientes

Antes de aplicar: confirmar proyecto aislado, backup requerido si no está vacío, inspeccionar todos los esquemas y Auth, revisar asesores, ejecutar pruebas SQL en entorno descartable y revisar grants de nuevos objetos. El trigger de `auth.users` requiere verificar compatibilidad con la versión de Supabase y el flujo Auth real; una emulación no prueba el servicio remoto.

El usuario inicial Paysandu, correo, cambio seguro de contraseña, configuración Auth (sin signups públicos), revocación real, RLS con JWT reales y restauración permanecen pendientes hasta habilitar el entorno. No utilizar usuarios o datos institucionales reales para estas pruebas.

## Delta T032 — descripción

Las RPC de alta/edición normalizan whitespace exterior equivalente a ECMAScript trim antes de validar y guardar descripción, snapshot e idempotencia. Mínimo20 puntos de código Unicode confirmado por T032. Se conserva máximo técnico10000 pendiente de conciliación con5000provisional histórico; no se declara aprobado. Controles inválidos se rechazan antes del trim; solo whitespace y19caracteres con padding no pasan. El CHECK local también exige20–10000. Migración no aplicada a cloud; pruebas locales no sustituyen E2E real. Ver evidence/t032-description-validation.md.

## Reutilización autorizada y reversión de la primera migración

Franco autorizó exclusivamente `kmimekswqpsuspkrxdet` en plan Free, con usuarios/datos sintéticos. La retención histórica anterior queda reemplazada por esta autorización específica. Preflight: proyecto ACTIVE_HEALTHY, PostgreSQL17.11, organización mideqdqcagfxpcrzovah Free; sin tablas/funciones public/private, sin esquema private, sin usuarios/sesiones/buckets/triggers personalizados en Auth y sin migraciones.

Antes de aplicar: repetir preflight y comparar esos objetos. La migración inicial es transaccional (BEGIN/COMMIT); un error debe abortar todo el lote, y se verifican catálogo e historial antes de cualquier reintento. No suponer éxito a partir de una respuesta incierta.

Reversión segura después de COMMIT: detener el backend local y conservar tablas/datos e historial; bloquear la promoción y preparar una migración correctiva versionada. Nunca usar DROP CASCADE, reset cloud ni eliminar usuarios/datos para ocultar fallos. Si se necesita restaurar estructura previa, primero exportar datos/configuración por canal seguro y ensayar en un destino aislado autorizado; no ejecutar una reversión destructiva sobre este proyecto. Para esta aplicación inicial la línea base está vacía, por lo que no hay registros previos que transformar. Un rollback de código no revierte SQL automáticamente.

La conectividad del conector SQL no entrega una credencial administrativa al backend. Las pruebas Auth reales requieren un canal seguro para SUPABASE_SECRET_KEY y la publishable key del mismo proyecto; no obtener claves desde tablas internas ni guardar contraseñas en evidencias. El correo definitivo de Paysandu y recuperación siguen pendientes: las cuentas QA serán exclusivamente sintéticas.

Resultado del intento: apply_migration fue interrumpido antes de recibir respuesta. Verificación posterior: historial vacío y ninguna tabla public/private. No se reintentó. No se crearon usuarios ni se probaron Auth/persistencia reales; la autorización específica está recibida, pero esta operación permanece pendiente.

## Integridad de padrón y confirmaciones de reintento

Franco pidió volver a presentar la migración inicial. Se repitió preflight: proyecto saludable Free, sin migraciones ni objetos de aplicación. Dos confirmaciones de apply_migration expiraron sin aprobación efectiva; las consultas posteriores volvieron a confirmar cero migraciones/tablas/funciones/private/usuarios. No se aplicó ninguna migración. No es una denegación de la autorización funcional: falta completar la confirmación operativa del conector.

Nueva migración local `20261104125456_enforce_synthetic_parcel_keys.sql`: tabla privada con las tres claves sintéticas del adaptador y FK compuesta desde consultations. Impide eludir la validación HTTP llamando create_consultation directamente. RLS habilitado; anon/authenticated sin permisos sobre claves. No hay alta de claves desde el cliente. La FK restringe este entorno a esos tres padrones; un catálogo institucional requiere otro diseño/migración explícitos bajo G3 autorizado.

`tests/database/parcel-integrity.test.ts` PASS y typecheck PASS. QA independiente ejecutó el test y confirmó localidad inexistente, padrón cruzado y cero inicial rechazados, ausencia de registros parciales y relación 1:1 de consultas/contactos/revisiones/idempotencias válidas. No prueba JWT real ni GoTrue. La migración falla transaccionalmente si encuentra consultas previas fuera del catálogo; antes de aplicarla verificar claves existentes y no borrar datos para forzar éxito. Reversión: detener backend y corregir mediante nueva migración; conservar datos y no ejecutar DROP CASCADE.

## Confirmación efectiva y verificación cloud

Tras el nuevo pedido de Franco ambas tarjetas fueron confirmadas y apply_migration devolvió success=true. Historial remoto: 20261104130855 y 20261104130930. Catálogo: ocho tablas RLS, tres políticas SELECT públicas, FK compuesta y tres claves sintéticas. Sin usuarios. Comprobaciones de privilegios reales: anon no puede leer consultas/ejecutar alta; authenticated no puede escribir directamente consultas/claves ni finalizar cambio de contraseña; touch_auth_session/touch_session sin claims devuelven false. Esto verifica configuración PostgreSQL; no sustituye solicitudes JWT ni login GoTrue.

Advisors: cinco INFO rls_enabled_no_policy en tablas private; es denegación por defecto intencional para que solo accedan las funciones privilegiadas acotadas. No se agregaron políticas permisivas para ocultar esos avisos. La exposición efectiva de esquemas en PostgREST no se certifica mediante current_setting nulo; verificarla con API al conectar el backend.

Bloqueo restante: el canal disponible no entrega SUPABASE_SECRET_KEY; CLI sin sesión y navegador no disponible. Proveerla por gestor seguro/archivo local excluido, nunca por chat. No crear usuarios insertando manualmente en auth.users ni falsificar JWT para sustituir Auth real.
