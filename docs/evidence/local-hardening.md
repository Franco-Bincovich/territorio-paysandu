# Continuación local G0/G1/G2 — 2026-11-04

Base: commit 1c5e130. Sin operaciones Supabase cloud, Vercel ni gastos durante esta continuación. G0/G1/G2 siguen parciales; G3 y piloto bloqueados. Repo privado ya verificado en el hito anterior.

## Cambios y revisión cruzada

- Backend: logs allowlist con requestId propio, rutas plantilla, status y duración; no cuerpos, query, IP, identidad ni tokens. Filtros estrictos y contrato OpenAPI 3.1 con prueba de paridad. Cache sintética bounded TTL/LRU implementada por domain y revisada por backend.
- Seguridad: QA domain detectó falta de verificación de sesión durante gate de contraseña. Database implementó touch_auth_session y backend lo invoca siempre. QA domain independiente del autor verificó sesión ajena, revocada, expirada, inactiva y anterior al cambio. Los datos de negocio permanecen bloqueados hasta finalizar cambio.
- UI: respuestas tardías descartadas, logout limpia datos inmediatamente, contexto al volver desde consulta, foco/teclado y fechas UTC explícitas. Autor frontend y QA independiente ejercitan browser con interceptación sintética; no acreditan Auth o persistencia alojada.
- Migración local: CLI 3.0.0 generó 20261104035645_initial_collaborator_schema.sql usando SUPABASE_HOME local ignorado. Fuente única versionada, sin aplicación remota. Referencia oficial de configuración: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/local-development/docker-and-native-runtimes.mdx.
- Arquitectura/ERD/superficie ataque y reversión forward-only documentadas. Inventario de 140 paquetes, 78 licencias UNKNOWN: no SBOM certificado ni aceptación legal. Audit npm all/prod cero advisories reportados al ejecutar, sin garantía futura.
- Scanner heurístico no imprime hallazgos sensibles y falla si un archivo no puede leerse (regresión reproducida con ruta inexistente, exit 1). Binarios excluidos del análisis textual y revisados por procedencia; ocho capturas existentes sintéticas, sin nuevas capturas en esta fase.
- Matriz independiente de 99 fichas, cuerpos consultados: evidencia local no equivale Terminado. Ambigüedades históricas T004/T076/T089/T090 anotadas para DOT, sin ejecutar v2.

## Límites

El limitador real usa SHA256 del usuario normalizado, sin HMAC ni IP. Documentación corregida, sin presumir anonimización fuerte. Auth nativo contra abuso, JWT/GoTrue reales, login/cambio Paysandu y persistencia UI→Supabase siguen pendientes. RLS se ejecuta en PostgreSQL WASM con tablas/funciones Auth simuladas. No se ensayó restore ni concurrencia multiconexión. CI sigue plantilla inactiva y preview no desplegado.

Validación final y SHA de entrega se registran en Notion y en el resultado de este turno; los archivos TAP/logs complementan esta evidencia.

## Resultado final local

`npm run check`: exit 0 (TypeScript, 14 archivos de tests, build Next optimizado). Ejecución directa adicional de los 14 archivos: 71 casos hoja PASS, 72 entradas TAP al contar el contenedor SQL, cero fallos (`local-hardening-cases.tap`). No se suman pantallas ni scripts browser al conteo de casos unitarios/SQL.

Browser adicional: autor frontend 5 regresiones con fixtures PASS; QA independiente verificó historial/filtros/retorno, búsquedas vacías/fallo, T032 resumen/validación por campo y T111 contactos múltiples/titular primero/teclado. Cero errores de página reportados. Servidor loopback de QA cerrado antes del build. Scripts reproducibles en tests/qa; no Auth real ni persistencia remota.

T032 usa validación del dominio, errores asociados y resumen enfocable; descripción alineada a 10.000 caracteres del contrato técnico. Las siete fuentes históricas disponibles contienen resúmenes que reconocen originales íntegros faltantes: se documenta el contraste accesible, no se acredita verificación de hash/versiones originales.
