# PostgreSQL y autorización

Estado: migración local generada por CLI 3.0.0 en `supabase/migrations/20261104035645_initial_collaborator_schema.sql`. **No aplicada a Supabase**. No se modifica el proyecto `kmimekswqpsuspkrxdet` hasta resolver su origen y autorización. El primer intento falló por `/home/franco/.supabase` de solo lectura; se resolvió usando `SUPABASE_HOME="$PWD/.supabase"` para configuración exclusivamente local. Inspeccionar el destino aprobado y ejecutar QA antes de aplicar.

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
