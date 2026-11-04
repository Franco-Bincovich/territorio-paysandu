# T032 — Mínimo de descripción y límites

## Fuente y decisión pendiente

Cotejado PAY-V1-DEC §2 (Notion 40e30c4074f781968bfdfc17d2fbf599, edición 2026-11-04T02:55:25.068Z): exige descripción validada pero no fija máximo. T032 (40c30c4074f78184872bdc19b2fb965f) conserva objetivo «texto >=20»; el callout vigente no lo contradice. PRD original REQ-020/§11 indica20–5000 y OPEN-007 mantiene el máximo pendiente; contraste y hashes en t058-originals-review.md.

Se corrige el mínimo confirmado de20. Se conserva10000 como límite técnico preexistente para no elegir silenciosamente un nuevo máximo; **no se declara10000 requisito aprobado**. El propietario debe conciliar5000provisional frente10000local. No se cambia el alcance ni se usan funcionalidades v2. La regla/catálogo de vínculo y demás decisiones señaladas por T058 permanecen aparte.

## Comportamiento

Se rechazan descripciones de menos de20 puntos de código Unicode después de quitar whitespace exterior equivalente a ECMAScript trim. Los espacios y saltos interiores se conservan y cuentan; padding externo no convierte19 en20. No se realiza normalización Unicode ni se cuenta por unidades UTF-16 o por grafemas. El conteo coincide con length(text) de PostgreSQL. Se mantiene el rechazo de controles inválidos antes de trim; tab/LF/CR interiores válidos no se eliminan.

Dominio exporta parseDescription y constantes compartidas. El cliente muestra errores por campo/resumen y usa el mismo parser; se elimina maxlengthHTML porque cuenta UTF-16 y podría truncar Unicode válido. La validación del cliente es ayuda: POST/PATCH siempre validan en servidor antes de persistir. La composición real del handler conserva identidad y adaptadores reales; una fábrica explícita de dependencias permite tests aislados, sin flags de entorno ni bypass por request.

SQL local normaliza antes de validar y persiste el valor canónico en consulta, snapshot y recibo de idempotencia. Reintentos equivalentes con padding no generan contactos nuevos. Edición inválida no altera consulta, versión ni snapshot. La migración inicial aún no aplicada se actualiza solo en Git; ninguna operación Supabase se ejecuta.

## Evidencia y límites

Tests dirigidos de dominio, cliente, handler HTTP y SQL cubren19/20/21/10000/10001, espacios exteriores, entradas de solo whitespace, tabulaciones/saltos/NBSP y Unicode suplementario. Tests HTTP usan Request/Response reales con adaptadores Auth/persistencia simulados; no prueban GoTrue o acceso remoto. SQL usa PostgreSQL WASM y Auth stubs; navegador usa respuestas interceptadas sintéticas. Regresiones vigentes actualizan descripciones de éxito cortas sin alterar sus objetivos de permisos, concurrencia o navegación.

Los resultados finales, revisión independiente, conteos y commit se registran al cerrar esta tanda. T032 conserva estado parcial por máximo pendiente y falta de E2E remoto; este delta corrige el mínimo, no aprueba v1 ni gates.

## Resultado final local

npm run check exit0: TypeScript,17 archivos de tests PASS y buildNext optimizado. Dominio5 límites dirigidos, servidor6 casos HTTP y cliente5unit+11browser PASS. QA independiente:2tests con41entradas por capa dominio/cliente/SQL y reejecución6HTTP PASS; browser propio para bloqueo19 y aceptación20emoji con foco/borrador PASS. SQL del autor16subtests+suite=17PASS. Estos conteos describen grupos distintos; no se suman inputs/escenarios como si fueran E2Ecloud.

Informe independiente: t032-independent-review.md. No se aplicó migración ni se usó Supabase; no se modificaron dependencias institucionales. Los fixtures de éxito anteriores que tenían descripciones cortas se alargaron para conservar sus objetivos originales. Máximo definitivo sigue pendiente, sin cambio numérico del límite técnico.
