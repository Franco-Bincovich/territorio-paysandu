# Administración MariaDB y credenciales manuales

`configuredAdminHttp()` compone el repositorio SQL compartido de auxiliares cuando
`ADMINISTRATION_ENABLED=true`. El guard verifica el esquema; no ejecuta DDL.

## Alta y restablecimiento

POST `/api/admin/users`: `{username,role,reason,temporalPassword,confirmPassword}`.
POST `/api/admin/users/:id/reset-password`: `{expectedRevision,reason,temporalPassword,confirmPassword}`.
La política compartida valida ambos campos antes de hash. La contraseña ingresada no
se normaliza ni se devuelve. El Administrador conoce solamente la temporal que ingresa;
no puede recuperar el hash ni la contraseña definitiva desde listados/respuestas.

Se guarda únicamente Argon2id. Alta inserta usuario habilitado, MUST_CHANGE_PASSWORD=1,
revisión1 y credencial con CREATED_AT/PASSWORD_UPDATED_AT del reloj UTC de MariaDB.
Reset actualiza hash y PASSWORD_UPDATED_AT, exige cambio, incrementa revisión y revoca
sesiones. Usuario, credencial, revocación y auditoría confirman en una sola transacción.
El motivo de auditoría se redacta si repite literalmente la contraseña temporal.

Hash fuera de locks, después de una revalidación de sesión; la transacción de escritura
revalida otra vez antes de confirmar. Concurrencia Argon2 limitada y cuotas HTTP vigentes.
El mutex administrativo, orden de locks, revisión y último administrador se conservan.

Ya no existe entrega externa, outbox, recibo ni fingerprint del cuerpo de credenciales.
`Idempotency-Key` no se exige ni almacena: una alta repetida entra en conflicto por
username único; un reset repetido entra en conflicto por expectedRevision. No hay éxito
reproducido ni segundo cambio silencioso. Ante commit incierto se concilia listado,
revisión y auditoría antes de repetir; nunca se reintenta automáticamente.

## Expiración y compatibilidad

La contraseña temporal no vence por tiempo. Permanece válida hasta cambio o reset.
MUST_CHANGE_PASSWORD impide usar funciones de negocio hasta reemplazarla. Se conservan
las sesiones de ocho horas y la inactividad máxima de una hora, sin extensión.
No se cambiaron cuentas ni claves reales en esta tarea.
Después de cambiar contraseña, el flag deja de ser temporal; no hay vencimiento periódico
arbitrario para contraseñas definitivas. Nunca se accede a funciones de negocio mientras
el cambio sea obligatorio.

## Persistencia y errores

El repositorio usa pool existente, UTC, Repeatable Read y mutex de conexión
`tp.auxiliares.admin.v1` en un único primary. Requiere usuarios actor/objetivo, credenciales
y sesión bloqueados en orden estable. El guard comprueba columnas/índices/InnoDB,
incluyendo fechas de credenciales y capacidad de PASSWORD_HASH. No certifica grants ni
triggers, pendientes de QA autorizado.

Denegaciones se auditan fuera del rollback. Commit incierto no se declara rechazado ni
se reintenta. Limpieza fallida de lock destruye conexión conservando commit confirmado.
La baja lógica mantiene identidad e historial. No existe eliminación física.

## Validación

Pruebas controladas: `npm run test:isolated`. No conexiones MariaDB ni QA de navegador
en esta tarea. La integración SQL debe comprobarse en la próxima etapa de QA.
