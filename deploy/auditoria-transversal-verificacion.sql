-- Solo lectura. Ejecutar con permiso SELECT sobre auxiliares.TP_ADMIN_AUDIT_V1.
-- Antes del ALTER: capturar SHOW CREATE y repetir el conteo histórico sin el
-- filtro MODULE. La línea base informada es 109, más las escrituras posteriores.

-- Esperado: PK EVENT_ID, columnas generadas, índices y CHECK del formato nuevo.
SHOW CREATE TABLE auxiliares.TP_ADMIN_AUDIT_V1;

-- Esperado: mismos grupos históricos. Las escrituras normales del backend
-- anterior pueden incrementar sus conteos.
SELECT ACTION, RESULT, COUNT(*) AS eventos_historicos
FROM auxiliares.TP_ADMIN_AUDIT_V1
WHERE MODULE IS NULL
GROUP BY ACTION, RESULT
ORDER BY ACTION, RESULT;

-- Esperado: cero escrituras transversales antes de la activación y luego un
-- evento visible solo si el servicio declaró explícitamente su acción administrativa.
SELECT MODULE, ACTION, RESULT, ADMIN_VISIBLE, COUNT(*) AS eventos
FROM auxiliares.TP_ADMIN_AUDIT_V1
WHERE MODULE IS NOT NULL
GROUP BY MODULE, ACTION, RESULT, ADMIN_VISIBLE
ORDER BY MODULE, ACTION, RESULT, ADMIN_VISIBLE;

-- Esperado: cero. Los REQUEST_ID repetidos preexistentes quedan fuera del índice.
SELECT COUNT(*) AS claves_nuevas_repetidas
FROM (
    SELECT AUDIT_REQUEST_ID
    FROM auxiliares.TP_ADMIN_AUDIT_V1
    WHERE AUDIT_REQUEST_ID IS NOT NULL
    GROUP BY AUDIT_REQUEST_ID
    HAVING COUNT(*) > 1
) AS repetidas;

-- Esperado: cero permisos exitosos sin revisión, referencia o detalle.
SELECT COUNT(*) AS cambios_de_permisos_incompletos
FROM auxiliares.TP_ADMIN_AUDIT_V1
WHERE MODULE = 'administration'
  AND ACTION = 'update_permissions' AND RESULT = 'success'
  AND NOT (
      (ADMIN_ACTION <=> 'permissions-update')
      AND (OBJECT_TYPE <=> 'permissions')
      AND (OBJECT_ID <=> '1')
      AND OBJECT_VERSION IS NOT NULL
      AND (JSON_TYPE(AFTER_JSON) <=> 'ARRAY')
      AND COALESCE(JSON_LENGTH(AFTER_JSON), 0) > 0
  );
