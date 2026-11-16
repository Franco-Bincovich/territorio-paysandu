-- EMPTY tables only. Run ONLY if the matching forward statement completed. Reverse dependency order required.
USE auxiliares;
ALTER TABLE FB_CIU_CONSULTAS_WEB DROP INDEX UK_71_QUERY_IDENTIDAD,DROP INDEX UK_71_QUERY_PERSONA;
