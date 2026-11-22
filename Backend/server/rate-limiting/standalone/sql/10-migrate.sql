-- REVIEW ONLY. DDL implicitly commits. Do not run automatically on startup.
-- Exclusive maintenance window; no IF NOT EXISTS masking incompatible schema.
CREATE TABLE auxiliares.FB_SECURITY_STANDALONE_V1 (
 bucket VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 tokens DOUBLE NOT NULL,
 at_ms BIGINT UNSIGNED NOT NULL,
 CONSTRAINT FB_SECURITY_STANDALONE_TOKENS CHECK (tokens >= 0),
 CONSTRAINT FB_SECURITY_STANDALONE_BUCKET CHECK (bucket IN ('auth:global','auth:hour'))
) ENGINE=InnoDB;
-- Start empty, fail conservatively after installation; refill normally.
INSERT INTO auxiliares.FB_SECURITY_STANDALONE_V1 (bucket,tokens,at_ms)
 VALUES ('auth:global',0,UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000),
        ('auth:hour',0,UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000);
-- DBA: grant only SELECT, UPDATE on this table to the existing own-DB app user.
-- Do not grant DDL/INSERT/DELETE and do not alter institutional permissions.
