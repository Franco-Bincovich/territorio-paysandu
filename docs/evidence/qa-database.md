# QA independiente de backend y base — G1/G2

Revisor: agente domain (no implementó backend ni schema SQL). Alcance local con datos sintéticos. No autoriza G3, piloto ni cierre de v1.0.

## Método

`tests/database/rls.test.ts` ejecuta `supabase/schema.sql` **sin modificaciones** en PostgreSQL WASM mediante PGlite. El arnés crea roles anon/authenticated/service_role y stubs mínimos de auth.users, auth.sessions, auth.uid() y auth.jwt(). Cambia el rol SQL efectivo para comprobar grants/RLS, y establece claims solo en el arnés. Los stubs no representan validación criptográfica JWT ni GoTrue.

`tests/database/backend-security.test.ts` prueba helpers reales del backend, independientemente de los tests del autor. Revisión estática de handler, cookies, identidad y cambio de contraseña.

Comandos reproducibles:

```sh
node --import tsx tests/database/rls.test.ts
node --import tsx tests/database/backend-security.test.ts
npx tsc --noEmit
```

Usar ejecución directa para ver cada subtest: en este runtime `--test` puede resumir solamente el archivo worker.

## Cobertura y resultado

- 14 controles SQL (15 PASS contando suite): creación atómica, snapshot, contacto único por solicitud, retry idempotente/conflicto de payload, denegación de escrituras directas y tablas privadas, lectura global, edición solo propia, versión optimista, historial original preservado, gate de cambio de contraseña, límite exacto 60 minutos no revivible, revocación de sesión, invalidación posterior a contraseña, rollback real ante fallo de contacto, grants anónimos, límite persistente service-only, perfil deshabilitado, session_id de otro usuario, vencimiento auth independiente y validación adversarial por RPC directa.
- 3 controles backend PASS: CSRF por origen ausente/null/parecido, cuerpo streaming sin content-length abortado al superar límite, variantes normalizadas de username comparten bucket antiabuso.
- TypeScript estricto sin errores en la ejecución de revisión.

## Defectos detectados y corregidos por autores

1. Backend comparaba rol `Colaborador` contra SQL `collaborator`: corregido por backend, revisado en fuente.
2. Límite de cuerpo se aplicaba después de `request.text()`: backend cambió a lectura streaming acotada y cancelación; prueba independiente PASS.
3. RPC SQL aceptaba documento `-`, teléfono no numérico y campos extra como `status`: primer run de QA falló; autor SQL incorporó allowlists y validación alineada; regresión PASS.
4. Teléfono compuesto solo por signos: encontrado en revisión cruzada por autor SQL; ajustado mínimo de seis dígitos en SQL y dominio, con regresión. Los tests de dominio son del implementador y no constituyen QA independiente de ese módulo.

5. Revisión Claude detectó que un cambio de hash administrativo/rehash podía liberar el primer cambio sin elección del usuario. El autor SQL ahora vuelve a exigir el cambio e invalida actividad ante cualquier cambio de hash. Solo una RPC service-role puede finalizar tras cambio reciente y sesión nueva del mismo usuario; el backend verifica getUser y getClaims del token recién emitido después de updateUser y reautenticación. QA SQL: hash reset NO libera acceso, anon/authenticated NO pueden finalizar, sesión anterior/ajena y cambio de hace diez minutos se rechazan, sesión nueva sola sigue bloqueada y solo finalización privilegiada válida habilita. **15 PASS contando suite**, TypeScript PASS. La revisión del backend es estática: el flujo GoTrue real continúa pendiente.

## Pendientes y límites materiales

- Falta ejecutar contra Supabase real: configuración expuesta de schemas, grants del proyecto y privilegios de trigger sobre auth.users deben confirmarse allí.
- Falta probar login real, refresh, cookies en navegador, cambio de contraseña con GoTrue, rechazo efectivo de contraseña anterior y revocación real de JWT/sesiones. El arnés comprueba el trigger SQL con hashes sintéticos; no comprueba contraseñas.
- El limiter de la aplicación no cubre por sí solo llamadas directas a Supabase Auth; configurar y verificar protección nativa contra abuso antes de liberación.
- PGlite usa una única conexión. La serialización/advisory lock se revisó, pero queda pendiente prueba concurrente real con múltiples conexiones.
- CI/RUT tiene validación estructural; checksum institucional no confirmado.
- RPC no puede comprobar existencia en Catastro externo sin la integración autorizada. Backend valida contra el adaptador sintético; se debe definir integridad referencial institucional antes de G3.
- No se ejecutaron backup/restore, carga, UAT ni integración institucional. Ningún resultado local reemplaza esos gates.
