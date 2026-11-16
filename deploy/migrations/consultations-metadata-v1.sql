-- REVIEW REQUIRED for institutional installation. Executed only in disposable QA.
-- Run with an authorized DBA. Deliberately no IF NOT EXISTS / OR REPLACE:
-- an existing account/view must be reviewed, never silently repurposed.
-- The locked definer cannot log in. The application must NEVER receive TRIGGER.
CREATE USER 'tp_consultation_metadata'@'localhost' ACCOUNT LOCK;
GRANT TRIGGER ON auxiliares.FB_PERSONAS TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_CIU_CONSULTAS_WEB TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_CONTACTOS TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_CONTACTOS_HISTORIAL TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_DOMICILIOS TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_DOMICILIOS_HISTORIAL TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_VINCULOS_DECLARADOS TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_CONSULTAS_HISTORIAL TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_CONSULTAS_IDEMPOTENCIA TO 'tp_consultation_metadata'@'localhost';
GRANT TRIGGER ON auxiliares.FB_MODELO_REVISION TO 'tp_consultation_metadata'@'localhost';
-- The user identifier is an FK target outside the ten business tables.
-- Metadata visibility needs a privilege on that target; no user rows are exposed
-- by any of the fixed views below.
GRANT REFERENCES (USER_ID) ON auxiliares.FB_USUARIOS TO 'tp_consultation_metadata'@'localhost';
CREATE ALGORITHM=TEMPTABLE
DEFINER='tp_consultation_metadata'@'localhost' SQL SECURITY DEFINER
VIEW auxiliares.TP_CONSULTATION_TRIGGERS_V1 AS
SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA='auxiliares' AND EVENT_OBJECT_TABLE IN (
 'FB_PERSONAS','FB_CIU_CONSULTAS_WEB','FB_CONTACTOS','FB_CONTACTOS_HISTORIAL',
 'FB_DOMICILIOS','FB_DOMICILIOS_HISTORIAL','FB_VINCULOS_DECLARADOS',
 'FB_CONSULTAS_HISTORIAL','FB_CONSULTAS_IDEMPOTENCIA','FB_MODELO_REVISION');
CREATE ALGORITHM=TEMPTABLE
DEFINER='tp_consultation_metadata'@'localhost' SQL SECURITY DEFINER
VIEW auxiliares.TP_CONSULTATION_CONSTRAINTS_V1 AS
SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA='auxiliares' AND TABLE_NAME IN (
 'FB_PERSONAS','FB_CIU_CONSULTAS_WEB','FB_CONTACTOS','FB_CONTACTOS_HISTORIAL',
 'FB_DOMICILIOS','FB_DOMICILIOS_HISTORIAL','FB_VINCULOS_DECLARADOS',
 'FB_CONSULTAS_HISTORIAL','FB_CONSULTAS_IDEMPOTENCIA','FB_MODELO_REVISION');
CREATE ALGORITHM=TEMPTABLE
DEFINER='tp_consultation_metadata'@'localhost' SQL SECURITY DEFINER
VIEW auxiliares.TP_CONSULTATION_REFERENCES_V1 AS
SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA='auxiliares' AND TABLE_NAME IN (
 'FB_PERSONAS','FB_CIU_CONSULTAS_WEB','FB_CONTACTOS','FB_CONTACTOS_HISTORIAL',
 'FB_DOMICILIOS','FB_DOMICILIOS_HISTORIAL','FB_VINCULOS_DECLARADOS',
 'FB_CONSULTAS_HISTORIAL','FB_CONSULTAS_IDEMPOTENCIA','FB_MODELO_REVISION');
-- DBA: grant SELECT on these views to the confirmed runtime account if it does not
-- already have schema SELECT. Account name intentionally not inferred here.
-- Enable CONSULTATIONS_SCHEMA_METADATA_VIEW=true only after verifying the view.
