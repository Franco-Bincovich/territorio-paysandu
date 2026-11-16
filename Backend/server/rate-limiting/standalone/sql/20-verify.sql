SHOW CREATE TABLE auxiliares.FB_SECURITY_STANDALONE_V1;
SELECT bucket,tokens,at_ms FROM auxiliares.FB_SECURITY_STANDALONE_V1 ORDER BY bucket;
-- Exactly two rows; primary key bucket; InnoDB; no TTL or scheduled cleanup.
-- Never reset/delete rows during recovery: that would reset attack budget.
