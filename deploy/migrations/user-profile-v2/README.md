# Perfil de usuarios v2 — instalación revisable

No se ejecutó sobre bases reales. Requiere ventana de mantenimiento, backup verificado y revisión DBA. La aplicación nueva y el esquema anterior no deben operar simultáneamente: el guard administrativo falla cerrado y el login requiere USERNAME_KEY. No ejecutar hasta coordinar versión compatible y recuperación.

## Contrato

FIRST_NAME y LAST_NAME (100), EMAIL (254), CI (8), nullable para conservar cuentas históricas sin inventar datos. Nuevas altas requieren nombre, apellido y correo. La edición parcial conserva campos null de cuentas antiguas si no se envían. CI opcional: 7–8 dígitos, o presentación usual con puntos/guion; solo formato, sin checksum ni reinterpretación histórica. El contrato institucional definitivo de CI debe confirmarse antes de ampliar reglas.

USERNAME conserva escritura original. shared/user-profile.ts calcula clave NFKC + trim + minúsculas; MariaDB compara sus bytes UTF-8 VARBINARY, evitando equivalencias por acentos/collation. EMAIL se normaliza del mismo modo. USERNAME_KEY y EMAIL_KEY son únicos para cuentas no dadas de baja; cuentas deshabilitadas conservan reserva para evitar suplantación. Baja lógica libera las claves en la misma transacción, mantiene USERNAME/perfil/USER_ID, revoca sesiones y registra snapshots. Recreación tiene USER_ID nuevo, hash nuevo y cambio obligatorio. No hay borrado físico ni restauración implícita.

Auditoría añade ACTOR_USERNAME y TARGET_USERNAME en nuevos eventos; los históricos no se reescriben. Cuando falte snapshot, la lectura enlaza el USER_ID retenido. Los UUID permanecen en DTO. Las descripciones son generadas por el backend; reason legado se acepta por compatibilidad pero se ignora.

## Preflight y ejecución

1. Detener escritores de aplicación. Exportar DDL, grants, usuarios/credenciales/sesiones/auditoría y los once triggers; proteger el backup como sensible. No imprimir contraseñas ni hashes en logs.
2. Ejecutar 00-preflight.sql: cualquier fila es bloqueo. Resolver colisiones de username con autorización explícita antes de migrar. No elegir ganadores ni renombrar automáticamente.
3. El backfill SQL solo acepta usernames ASCII sin padding: para ellos LOWER equivale exactamente al algoritmo NFKC+lower del runtime. El procedimiento bloquea entradas no ASCII/padded antes de cualquier DDL. Si existen, preparar claves con shared/user-profile.ts sobre exportación controlada y revisión de conflictos; no ejecutar el script ASCII ni aproximar Unicode usando LOWER. La migración se detiene para revisión, no rechaza ni altera esas cuentas históricas automáticamente.
4. Ejecutar 10-migrate.sql una sola vez. DDL autocommit; si falla, inspeccionar avance y aplicar recuperación DBA. No reejecutar ciegamente. El índice único antiguo de USERNAME se retira por nombre descubierto en information_schema únicamente después de crear claves únicas activas. No se modifican collations institucionales.
5. Ejecutar 20-postflight.sql; todos los contadores de inconsistencias deben ser cero. Comparar cuentas, IDs, roles, spelling, hashes y sesiones byte a byte contra backup; comparar definiciones de once triggers. No se añaden nombres/emails ficticios a cuentas reales.
6. Revisar permisos runtime: SELECT nuevas columnas y UPDATE/INSERT existentes; no otorgar DELETE, DDL ni privilegios para alterar auditoría. Activar aplicación compatible y realizar QA manual con cuentas sintéticas autorizadas.

## Recuperación

90-recovery.sql explica escenarios y no elimina datos. ROLLBACK convencional no revierte DDL. Antes de reapertura puede restaurarse backup verificado bajo DBA. Tras nuevos registros, restaurar sin conciliar puede perder historial y romper recreaciones; preferir reparación hacia adelante. No reinstalar unicidad sobre USERNAME si ya hay bajas y recreaciones con el mismo nombre. No descartar perfiles ni snapshots.

## Evidencia

QA prepara un contenedor nuevo MariaDB11.8.9 y ejecuta scripts solo en esa base sintética, incluyendo bloqueo preflight y comparación de identidades originales. La integración administrativa prueba collations ascii_bin/unicode_ci/uca1400 y concurrencia. El esquema real sigue pendiente de ejecución autorizada; las funcionalidades nuevas no deben declararse operativas allí antes de migrar.
