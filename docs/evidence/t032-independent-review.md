# T032 — QA independiente del mínimo de descripción

Fecha: 2026-11-04. Alcance local sintético, sin cloud ni mutación Notion. No se aprueban gates completos.

## Regla y límites de la decisión

T032 conserva objetivo texto >=20; PRD original REQ-020/§11 también lo exige. Se verificó la corrección de mínimo20 tras trim. El máximo10000 existente permanece como límite técnico; no resuelve el máximo5000 provisional histórico ni constituye una nueva aprobación funcional. Padre mantiene esa conciliación pendiente.

## Pruebas propias y resultados

`tests/qa/description-parity.test.ts`: dos pruebas PASS,41 entradas por cada capa dominio/cliente/RPC SQL. Evidencia `t032-independent-parity.tap`.

- ASCII y emoji:19,20,21,10000,10001 codepoints. Se rechazan19/10001 y admiten20/21/10000.
- Trim en espacio, tabulación, LF, CR, NBSP, EM SPACE, separador de línea y BOM; solo whitespace se rechaza, padding no permite que19 alcance20.
- Caracteres combinantes se cuentan como codepoints, no graphemes;10 pares de letra+marca equivalen20. Controles raw U+0000/0001/0008/000B/000C/001F se rechazan, incluso antes de trim.
- Acceso directo a RPC pública omite cliente y HTTP: SQL rechaza entradas inválidas y persiste descripción canónica válida. Usa PGlite con identidades/sesiones stub, no GoTrue real.
- Creación, retry mismo idempotency key, conflicto con payload diferente, edición válida/inválida, versión obsoleta, snapshot original inmutable y cantidad de contactos sin extras por intentos fallidos.

`tests/qa/form-contacts-fixture.mjs` ampliada y ejecutada en Chromium loopback3001:19ASCII bloquea POST, activa error por campo y enlace enfoca descripción;20emoji permite POST con contenido preservado. Fixture503 conserva borrador y enfoca resumen; cero pageErrors. Resto de escenarios contactos/medios pasa. No acredita persistencia/Auth real.

## Revisión cruzada de implementación y pruebas de autores

Dominio exporta constantes y parseDescription; valida tipo/raw controles, aplica trimECMAScript y cuenta Array.from por codepoints. Cliente usa el mismo parser y muestra mínimo; se retira maxlengthUTF16 para no truncar10000emoji antes de validación. El control real no depende de atributos HTML.

SQL refuerza constraint20–10000 y valida RPC tras normalización; create/edit aplican trimECMAScript explícito antes de payload/idempotencia/snapshot. Rechazo de controles ocurre antes del trim, PostgreSQL rechaza NUL. La migración local no se aplicó a plataforma cloud durante esta QA.

Seam backend createHandler recibe dependencias explícitas congeladas; export handle compone adaptadores reales, sin flags de request/env para saltar autenticación. Ruta continúa usando handle. Pruebas de autor `tests/server/consultation-validation.test.ts` revisadas y reejecutadas por QA: seis PASS (`t032-http-review.tap`). POST/PATCH rechazan19,whitespace,10001 con400 sin RPC; aceptan20/10000 ASCII/emoji canónicos con201/200; sin sesión401 sin RPC. Dobles solo en adaptadores externos: Request/parsing/validación/Response reales, no prueba red alojada.

Límite real de body65536 bytes comprobado;10000emoji pasa HTTP en esa envolvente. No existe hallazgo pendiente de supuesto límite32768.

## Resultado

Mínimo20 y paridad de conteo/trim comprobados localmente en tres capas y HTTP. Continúan pendientes la decisión funcional de máximo, Auth/RLS alojados y E2E institucional. Sin modificaciones funcionales realizadas por QA; solo pruebas y evidencia.
