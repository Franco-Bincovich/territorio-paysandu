# Verificación de esquema con privilegios mínimos

QA sobre MariaDB 11.8.9 comprobó que el usuario runtime limitado puede ver nombres de triggers pero recibe `ACTION_STATEMENT = NULL`. También obtiene una vista parcial de constraints y referencias. El guard original rechaza correctamente ese esquema incompleto, bloqueando las consultas.

La opción `CONSULTATIONS_SCHEMA_METADATA_VIEW=true` hace que el guard lea tres vistas de nombres fijos: `TP_CONSULTATION_TRIGGERS_V1`, `TP_CONSULTATION_CONSTRAINTS_V1` y `TP_CONSULTATION_REFERENCES_V1`. No cambia el resto de la inspección ni el esquema esperado. Una vista ausente o una definición distinta continúan bloqueando la operación. No existe fallback que omita comparaciones.

El script `migrations/consultations-metadata-v1.sql` queda preparado para revisión institucional; solo se ejecutó en QA sintético. Un DBA debe revisar nombres, permisos y objetos existentes antes de instalarlo. No usar `OR REPLACE` para sustituir objetos desconocidos. No se requiere dar `TRIGGER` a la aplicación.

El definer dedicado permanece `ACCOUNT LOCK`, tiene privilegio `TRIGGER` solamente sobre las diez tablas de negocio y `REFERENCES (USER_ID)` sobre la tabla referenciada. Las vistas proyectan únicamente metadatos del esquema `auxiliares` y esas diez tablas, sin parámetros, SQL dinámico ni filas de usuarios. El runtime solo requiere `SELECT` sobre las vistas; carece de permisos para cambiarlas o cambiar sus triggers. Los permisos de creación de objetos y gestión del definer permanecen en el DBA.

La documentación oficial describe tanto la [visibilidad condicionada de ACTION_STATEMENT](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-triggers-table) como el contexto de permisos de [SQL SECURITY DEFINER](https://mariadb.com/docs/server/server-usage/views/create-view). La evidencia efectiva de esta instalación sintética se registra en `qa/evidence/`.

Para una instalación existente, no activar la opción hasta verificar las tres vistas y sus resultados con el usuario runtime. La reversión de código/configuración vuelve a la inspección directa y puede bloquear escrituras con un usuario limitado; no se deben eliminar objetos ni permisos de producción automáticamente para intentar habilitarlas.
