-- DBA only, maintenance window. SELECT-only preflight; never modifies users.
-- Any row returned is a blocker requiring an explicit reviewed resolution.
SELECT USER_ID,USERNAME FROM auxiliares.FB_USUARIOS WHERE DELETED_AT IS NULL AND (BINARY USERNAME REGEXP '[^ -~]' OR BINARY USERNAME<>BINARY TRIM(USERNAME));
SELECT LOWER(TRIM(USERNAME)) AS conflicting_key,COUNT(*) AS n FROM auxiliares.FB_USUARIOS WHERE DELETED_AT IS NULL GROUP BY BINARY LOWER(TRIM(USERNAME)) HAVING COUNT(*)>1;
-- Non-ASCII legacy usernames need canonical NFKC keys computed by shared/user-profile.ts
-- and reviewed before migration; do not silently approximate them with SQL LOWER.
