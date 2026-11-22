-- REVIEW ONLY. Run explicitly against the OWN auxiliaries DB after approval.
SELECT DATABASE() AS expected_auxiliares, VERSION() AS mariadb_version;
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'auxiliares' AND TABLE_NAME = 'FB_SECURITY_STANDALONE_V1';
SHOW GRANTS FOR CURRENT_USER;
-- STOP if wrong database, table already exists, or server is not the single
-- writable MariaDB primary shared by every application instance.
