# Roles v1 — propuesta MariaDB 11.8.9

> Documento histórico. La instalación y los permisos vigentes se describen en [la guía V1.3](../../RELEASE-V1.3.md). La migración original ya fue informada como ejecutada: no repetir roles-v1 ni aplicar su rollback temprano tras el bootstrap.

Estado: scripts generados y revisados estáticamente; **no ejecutados ni validados en un servidor**. No hay conexión real, despliegue, bootstrap ni cambios de usuarios. Estos scripts contienen UPDATE preparados para una futura ejecución autorizada; ninguno se ejecutó durante esta tarea.

## Orden de despliegue obligatorio

1. Aprobar ventana y responsable. Detener aplicación, jobs y cualquier escritor de `auxiliares`. No arrancar este código contra los diez `collaborator` antiguos: ahora ese rol recibe capacidades documentales adicionales. No arrancar el código anterior después del remapeo: no reconoce `atencion_publico`.
2. Backup consistente externo y restauración ensayada, incluyendo esquema, tablas relacionadas, triggers, credenciales y sesiones; protegerlo como secreto. Capturar versión del código/configuración anterior e inventario completo de objetos. No compartir contenidos del backup.
3. Ejecutar **00-preflight.sql** solo con autorización posterior. Confirmar nombres/tipos/motores, UNIQUE USERNAME, CHECK, diez usuarios habilitados, nueve cambios pendientes, cero consultas/historiales y los once triggers. Revisar cuerpos de triggers: aunque no se alteran, el UPDATE de ROLE los dispara. Si producen cambios no previstos, detenerse y rediseñar. Confirmar que TP_ADMIN_* no colisiona con tablas existentes. La confirmación recibida no incluye sus cuerpos, por lo que este paso sigue pendiente.
4. En una conexión exclusiva, establecer `@tp_roles_v1_approved=1` después de aprobación. Ejecutar **10-expand.sql**, **20-admin-structures.sql**, **30-migrate-baseline-users.sql**, en ese orden y deteniéndose ante cualquier error. El cliente debe soportar bloques `DELIMITER`/`BEGIN NOT ATOMIC`; en DBeaver usar ejecución de script y verificar el delimitador antes de aprobar.
5. Ejecutar **40-postflight.sql**. Exigir fase migrated, diez Atención al público, default correcto, CHECK de tres roles y cero diferencias. Comparar contenidos de credenciales/sesiones, triggers y demás tablas con el backup, no solamente conteos. Las consultas no devuelven hashes, tokens ni contraseñas.
6. Preparar versión nueva ya compilada, comprobar proveedor MariaDB y controles de configuración sin abrir tráfico. Administración permanece 503 hasta integrar persistencia y entrega privada. La generación institucional permanece sujeta a su contrato documental.
7. Solo después de aprobación de resultados, iniciar versión nueva y QA funcional local autorizado. Verificar sesiones preexistentes: el rol se recarga del usuario, no se conserva un claim `collaborator`. Se preservan filas de sesiones; su vencimiento natural no cambia.

No existe una ventana de ejecución simultánea segura entre versiones. Si se necesita cero downtime hay que implementar y validar primero una versión puente, fuera de este alcance.

## Qué preparan los scripts

- 10 captura exactamente los diez IDs originales y sus estados (sin contraseñas), conteos de credenciales/sesiones y huellas de los once triggers. Amplía CHECK y cambia default en un único ALTER. El registro de fase permite reconocer un reinicio después del DDL.
- 20 propone `ADMIN_REVISION BIGINT UNSIGNED DEFAULT 1` y `DELETED_AT DATETIME(6) NULL`. No son columnas confirmadas previamente. Crea `TP_ADMIN_AUDIT_V1` con el contrato de AuditEvent: actor/objetivo, acción, resultado, fecha, motivo, request ID, código opcional y snapshots públicos JSON. No almacena secretos. No modifica sesiones: el código existente ya utiliza REVOKED_AT, cuya definición en el esquema real se debe verificar en preflight. No añade triggers.
- 30 remapea solo IDs capturados y exactamente diez filas. Separa DML transaccional de DDL. Una repetición con fase migrated no cambia futuros colaboradores. Si los datos divergen se detiene, nunca adapta silenciosamente el baseline.
- No hay tablas documentales: no existe contrato institucional de creación/registro definido.
- IF NOT EXISTS permite reanudación limitada, **no sustituye validación de esquema**. Revisar SHOW CREATE de cada tabla TP_ADMIN_* y nuevas columnas ante una reejecución; un objeto incompatible o una fase desconocida requiere intervención, no borrado.

## Bootstrap y administración real pendientes

Después del remapeo quedan **cero administradores**. No se promociona arbitrariamente a ninguno ni se crea una cuenta. El responsable debe identificar y autorizar separadamente el primer administrador, con auditoría y revocación de sus sesiones bajo el protocolo de exclusión de escritores. Ese procedimiento requiere integrar y verificar primero persistencia administrativa; no se incluye un UPDATE ejecutable de bootstrap.

`configuredAdminHttp()` continúa devolviendo 503. El servicio aislado exige una transacción que revalida sesión/actor y serializa todos los escritores administrativos. El futuro adaptador deberá implementar mutex persistente, revisión optimista, unicidad, bajas, revocación, auditoría durable de éxitos/denegaciones, recibos idempotentes, expiración de credenciales temporales y outbox cifrado. El esquema definitivo de recibos/entrega y la coordinación con los locks de autenticación requieren integración; **20 no basta para habilitar altas/reset reales**. No se inventan claves, destinatarios ni canales de entrega.

Toda baja guarda DELETED_AT y ENABLED=0, preserva USER_ID y username, impide reactivación accidental y mantiene referencias históricas. El adaptador no expone DELETE físico. La cuenta DB de runtime debe carecer de permiso DELETE sobre usuarios y de UPDATE/DELETE sobre auditoría; revisar permisos con DBA, sin modificarlos en estos scripts.

## Rollback y recuperación

DDL puede hacer commit implícito antes de ejecutarse. No envolver todos los archivos en una transacción ni anunciar que ROLLBACK los revierte. El snapshot y las fases persisten intencionalmente.

**Antes de reabrir aplicación:** autorizar separadamente `@tp_roles_v1_rollback_approved=1`; ejecutar **90-rollback-before-reopen.sql** con todos los escritores detenidos. Solo acepta los diez IDs y estados originales sin administración, nuevas consultas, auditoría ni cambios de conteos. Restaura los roles del snapshot en una transacción, luego CHECK/default anteriores mediante otro ALTER. Deja nuevas columnas/tablas aditivas y evidencia intactas. Comparar nuevamente backup y metadatos antes de reiniciar código anterior.

Si se interrumpe 10 tras ALTER, phase=captured permite repetir el ALTER y avanzar. Si se interrumpe 20, repetir después de inspeccionar columnas/tablas. Si falla 30, su DML revierte; si perdió respuesta después del commit, phase=migrated evita remapeo. Si falla rollback después de restaurar roles, phase=rollback-data permite reintentar el ALTER. No usar ejecución que continúe tras error.

**Después de reabrir o bootstrap:** 90 no es una recuperación segura general; los conteos no detectan todas las modificaciones externas. Mantener detenido y preferir corrección hacia adelante con código compatible. Cualquier restauración de backup requiere conciliar cambios posteriores y autorización expresa para evitar perder historial o sesiones. Nunca convertir todos los nuevos colaboradores/administradores a un único rol ni eliminar auditoría para forzar rollback.

## Referencias de sintaxis consultadas

- [MariaDB: sentencias que hacen commit implícito](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit).
- [MariaDB: bloques fuera de procedimientos](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/using-compound-statements-outside-of-stored-programs).
- [MariaDB: ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table).

La revisión estática y las pruebas de texto no sustituyen parseo/ejecución en MariaDB 11.8.9 aislada, pendiente de autorización.

- [MariaDB: BEGIN END](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/begin-end).
- [MariaDB: START TRANSACTION](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction).
