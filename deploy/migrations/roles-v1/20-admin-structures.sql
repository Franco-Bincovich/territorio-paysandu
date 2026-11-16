-- BORRADOR NO EJECUTADO. Misma ventana sin escritores y autorización de 10-expand.
-- Columnas nuevas definidas por esta propuesta, NO afirmación de esquema existente.
USE auxiliares;
DELIMITER //
BEGIN NOT ATOMIC
  IF COALESCE(@tp_roles_v1_approved,0)<>1 OR
     NOT EXISTS(SELECT 1 FROM TP_ADMIN_ROLES_V1_STATE WHERE ID=1 AND PHASE IN ('expanded','admin-ready','migrated')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Falta expansion aprobada';
  END IF;
  IF (EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='FB_USUARIOS' AND COLUMN_NAME='ADMIN_REVISION') AND
      NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='FB_USUARIOS' AND COLUMN_NAME='ADMIN_REVISION' AND COLUMN_TYPE IN ('bigint(20) unsigned','bigint unsigned') AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='1')) OR
     (EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='FB_USUARIOS' AND COLUMN_NAME='DELETED_AT') AND
      NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='FB_USUARIOS' AND COLUMN_NAME='DELETED_AT' AND COLUMN_TYPE='datetime(6)' AND IS_NULLABLE='YES')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Columnas administrativas existentes incompatibles';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='TP_ADMIN_AUDIT_V1' AND TABLE_COMMENT<>'territorio-paysandu admin-audit-v1') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Colision de tabla de auditoria; no continuar';
  END IF;
  ALTER TABLE FB_USUARIOS
    ADD COLUMN IF NOT EXISTS ADMIN_REVISION BIGINT UNSIGNED NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS DELETED_AT DATETIME(6) NULL DEFAULT NULL;
  -- La baja lógica aplica enabled=false; adaptador debe revocar sesiones atómicamente.
  -- Sin ALTER de sesiones: REVOKED_AT integra el código actual de autenticación.
  -- Su definición real todavía debe verificarse con SHOW CREATE en preflight.
  -- Auditoría append-only por permisos del FUTURO adaptador, sin triggers nuevos.
  CREATE TABLE IF NOT EXISTS TP_ADMIN_AUDIT_V1 (
    EVENT_ID CHAR(36) PRIMARY KEY,
    ACTOR_ID VARCHAR(100) NOT NULL,
    TARGET_ID CHAR(36) NULL,
    ACTION VARCHAR(30) NOT NULL,
    RESULT VARCHAR(10) NOT NULL,
    OCCURRED_AT DATETIME(6) NOT NULL,
    REASON VARCHAR(500) NOT NULL,
    REQUEST_ID VARCHAR(100) NOT NULL,
    ERROR_CODE VARCHAR(100) NULL,
    BEFORE_JSON LONGTEXT NULL,
    AFTER_JSON LONGTEXT NULL,
    CONSTRAINT CHK_TP_ADMIN_AUDIT_ACTION CHECK(ACTION IN ('create','update','reset-password','list','delete','audit-list')),
    CONSTRAINT CHK_TP_ADMIN_AUDIT_RESULT CHECK(RESULT IN ('success','denied')),
    CONSTRAINT CHK_TP_ADMIN_AUDIT_BEFORE CHECK(BEFORE_JSON IS NULL OR JSON_VALID(BEFORE_JSON)),
    CONSTRAINT CHK_TP_ADMIN_AUDIT_AFTER CHECK(AFTER_JSON IS NULL OR JSON_VALID(AFTER_JSON)),
    INDEX IX_TP_ADMIN_AUDIT_TIME(OCCURRED_AT,EVENT_ID)
  ) ENGINE=InnoDB COMMENT='territorio-paysandu admin-audit-v1';
  -- Sin FK a usuarios: preserva denegaciones y auditoría incluso ante actor desconocido.
  -- No guardar hashes, contraseñas, tokens ni payload de entrega en JSON.
  -- Outbox, recibos, mutex y expiración de credenciales siguen pendientes de contrato
  -- de entrega e integración. Este DDL NO habilita configuredAdminHttp.
  UPDATE TP_ADMIN_ROLES_V1_STATE SET PHASE='admin-ready' WHERE ID=1 AND PHASE='expanded';
  COMMIT;
END//
DELIMITER ;
