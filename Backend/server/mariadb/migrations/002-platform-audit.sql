-- MariaDB 11.8. Compare SHOW CREATE TABLE with the approved source schema first.
-- An ALTER can rebuild the table. WAIT bounds lock acquisition, not DDL duration.
-- Existing rows and old writers retain MODULE=NULL and remain visible in Administration.
ALTER TABLE auxiliares.TP_ADMIN_AUDIT_V1 WAIT 10
    DROP CONSTRAINT IF EXISTS CHK_TP_ADMIN_AUDIT_ACTION,
    DROP CONSTRAINT IF EXISTS CHK_TP_ADMIN_AUDIT_RESULT,
    DROP CONSTRAINT IF EXISTS CHK_TP_ADMIN_AUDIT_REQUEST_V2,

    MODIFY COLUMN ACTION VARCHAR(48) NOT NULL,

    ADD COLUMN IF NOT EXISTS MODULE VARCHAR(24) NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS OBJECT_TYPE VARCHAR(24) NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS OBJECT_ID VARCHAR(128) NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS OBJECT_VERSION BIGINT UNSIGNED NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS ADMIN_ACTION VARCHAR(30) NULL DEFAULT NULL,

    ADD COLUMN IF NOT EXISTS AUDIT_REQUEST_ID
        VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin
        GENERATED ALWAYS AS (
            CASE WHEN MODULE IS NOT NULL THEN REQUEST_ID ELSE NULL END
        ) PERSISTENT,

    ADD COLUMN IF NOT EXISTS ADMIN_VISIBLE TINYINT UNSIGNED
        GENERATED ALWAYS AS (
            CASE WHEN MODULE IS NULL OR ADMIN_ACTION IS NOT NULL THEN 1 ELSE 0 END
        ) PERSISTENT,

    ADD CONSTRAINT CHK_TP_ADMIN_AUDIT_ACTION CHECK (
        (
            MODULE IS NULL
            AND ADMIN_ACTION IS NULL
            AND ACTION IN (
                'create', 'update', 'reset-password', 'list',
                'delete', 'audit-list', 'permissions-update'
            )
        )
        OR (
            MODULE IS NOT NULL
            AND BINARY ACTION REGEXP '^[a-z][a-z0-9_]{0,47}$'
            AND (
                ADMIN_ACTION IS NULL
                OR (
                    MODULE = 'administration'
                    AND ADMIN_ACTION IN (
                        'create', 'update', 'reset-password', 'list',
                        'delete', 'audit-list', 'permissions-update'
                    )
                )
            )
        )
    ),

    ADD CONSTRAINT CHK_TP_ADMIN_AUDIT_RESULT CHECK (
        (MODULE IS NULL AND RESULT IN ('success', 'denied'))
        OR (
            MODULE IS NOT NULL
            AND RESULT IN ('success', 'no_change', 'denied', 'invalid', 'error')
        )
    ),

    ADD CONSTRAINT CHK_TP_ADMIN_AUDIT_REQUEST_V2 CHECK (
        MODULE IS NULL
        OR (
            CHAR_LENGTH(REQUEST_ID) = 36
            AND BINARY REQUEST_ID REGEXP
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND (
                (OBJECT_TYPE IS NULL AND OBJECT_ID IS NULL AND OBJECT_VERSION IS NULL)
                OR (OBJECT_TYPE IS NOT NULL AND OBJECT_ID IS NOT NULL)
            )
        )
    ),

    ADD UNIQUE INDEX IF NOT EXISTS UX_TP_ADMIN_AUDIT_REQUEST_V2 (AUDIT_REQUEST_ID),
    ADD INDEX IF NOT EXISTS IX_TP_ADMIN_AUDIT_VISIBLE_TIME
        (ADMIN_VISIBLE, OCCURRED_AT, EVENT_ID),
    ADD INDEX IF NOT EXISTS IX_TP_ADMIN_AUDIT_ACTOR_TIME
        (ACTOR_ID, OCCURRED_AT, EVENT_ID);
