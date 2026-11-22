# Paquete 7.1 — versión final revisada

> Mantenimiento v1.3.0 (16/11/2026): este paquete conserva sus identificadores y
> precondiciones históricas. La instalación y operación vigentes se describen en
> [la guía V1.3](../../../deploy/RELEASE-V1.3.md). Las menciones a funcionalidades
> deshabilitadas reflejan la preparación original del paquete, no el estado actual
> de la aplicación. No repetir estas migraciones sobre un esquema ya instalado:
> comprobar su estado y aplicar únicamente el procedimiento revisado por el DBA.

**Preparación final, sin aplicar a auxiliares. Guardar consulta continúa deshabilitado.**

## Reglas incluidas

- CI/RUT: identidad por tipo y documento normalizado. Un índice único condicional
  usa DOCUMENTO_IDENTIDAD_UNICA; para OTROS ese valor es NULL y no impide duplicados.
- OTROS: no se busca/reutiliza una persona por documento. Sin ID local explícito
  se crea otra persona; un reintento con la misma clave idempotente no la duplica.
  Para reutilizar OTROS se selecciona expresamente confirmedPersonId y se valida
  que exista y corresponda al tipo/documento declarado. Editar una consulta usa su
  ID_PERSONA inmutable, sin crear otra identidad ni cambiar el propietario.
- Un contacto y un domicilio vigente por ID_PERSONA, con historial. Se conserva
  ID_PERSONA_CP únicamente con correspondencia institucional verificada.
- Una consulta histórica puede corregir su snapshot, pero no modifica persona,
  contacto o domicilio vigentes. Se determina contra la última consulta de esa
  persona, incluso si esa consulta posterior omitió domicilio.
- PadCod identifica al padrón. Las FK no tienen dependencias circulares. Las
  referencias de contacto/domicilio/vínculo apuntan hacia consulta/persona.

## Antes de ejecutar

1. Usar la conexión autorizada a auxiliares y MariaDB 11.8.9.
2. Exportar DDL y los 11 triggers vigentes desde DBeaver. Conservar respaldo.
3. Detener TODOS los escritores de negocio durante la ventana. Login/búsquedas no
   se modifican; nadie debe ejecutar DML ni DDL externo sobre estas ocho tablas.
4. Ejecutar 01-preflight.sql. Exigir cero filas en las ocho tablas, 11 triggers
   originales y DDL coincidente con el baseline. Si hay filas o diferencias, parar.
5. Configurar la ejecución de scripts para detenerse ante el primer error. No
   ejecutar la carpeta completa, no omitir errores y no ejecutar ambos formatos de 02/03.

## Orden final, una sentencia/archivo por vez

| Paso | Archivo | Qué ejecutar |
|---|---|---|
| 1 | 01-preflight.sql | Solo SELECT; revisar todos los resultados. |
| 2 | 00-maintenance.sql | Cada uno de los 24 CREATE OR REPLACE de guardas, en orden. |
| 3 | steps/02a-personas.sql | Un ALTER. |
| 4 | steps/02b-consultas.sql | Un ALTER. |
| 5 | steps/02c-indices-consulta.sql | Un ALTER; crea los índices antes de las FK dependientes. |
| 6 | steps/02d-contactos.sql | Un ALTER. |
| 7 | steps/02e-domicilios.sql | Un ALTER. |
| 8 | steps/02f-vinculos.sql | Un ALTER. |
| 9 | steps/03a-idempotencia.sql | Un CREATE TABLE. |
| 10 | steps/03b-revision.sql | Un CREATE TABLE; todavía sin marca. |
| 11 | 10…20-TRG_*.sql | Un archivo de trigger por vez, en orden numérico. |
| 12 | 30-verify.sql | Solo SELECT y revisión de DDL completo. |
| 13 | 31-mark-reviewed.sql | Un INSERT de metadatos; debe insertar exactamente una fila. |
| 14 | 32-release-maintenance.sql | Primero validar el bloque inicial completo; luego cada DROP de guarda. |
| 15 | 33-final-verify.sql | Exigir 11 triggers de negocio, cero guardas y revisión 7.1. |

Los ALTER y CREATE de los pasos 02 y 03 están en `steps/`.
Cada archivo 10…20 contiene un CREATE OR REPLACE con BEGIN/END y DELIMITER: usar
la ejecución de ese script completo; no enviar fragmentos del cuerpo del trigger.

Las 24 guardas temporales impiden INSERT/UPDATE/DELETE en las ocho tablas de negocio
mientras cambia el esquema. No tocan autenticación ni la base institucional. Durante
la migración hay 35 triggers; al finalizar vuelven a ser 11. Las guardas no son un
sustituto de detener escritores, ni protegen contra DDL externo como TRUNCATE.

31 verifica hashes de las once definiciones, índice de identidad condicional,
las ocho FK nuevas, 24 guardas presentes y tablas de negocio/recibos vacíos. Falla
si quedó un reemplazo parcial; no registrar una revisión manual alternativa para
saltear el control. Preservar el formato de los archivos: se admiten LF/CRLF, no
reformatear los cuerpos después de generar sus hashes.

32 comprueba otra vez definiciones, índice, FK y revisión antes de retirar las
protecciones. Si su bloque inicial falla, NO ejecutar los DROP siguientes. Si se
interrumpe retirando guardas, corregir la causa y repetir 32: los DROP son IF EXISTS.

MariaDB hace commits implícitos por DDL. No existe rollback global de estos ALTER.
La secuencia queda bloqueada para escrituras mientras está incompleta y tiene
recuperación por cada paso, no una promesa de atomicidad de toda la migración.

## Recuperación de una ejecución interrumpida

Aplicable SOLO si las ocho tablas siguen vacías y no hay recibos de consultas.
No borra personas, consultas ni datos para forzar ese estado. Si hay datos, detener
la recuperación y elaborar restauración/conciliación desde el respaldo revisado.

1. Mantener detenidos los escritores. Completar/reaplicar 00-maintenance.sql para
   asegurar las 24 guardas. Registrar exactamente qué sentencias sí terminaron.
2. Ejecutar recovery/00-preflight.sql. Si existe FB_CONSULTAS_IDEMPOTENCIA, comprobar
   aparte SELECT COUNT(*) FROM auxiliares.FB_CONSULTAS_IDEMPOTENCIA; exigir cero.
3. Ejecutar recovery/01-drop-business-triggers.sql: retira solo las once definiciones
   de negocio; conserva las guardas. Así los triggers nuevos no referencian columnas
   mientras se revierten.
4. Ejecutar SOLO los undo de pasos efectivamente completados, en orden inverso:
   - recovery/undo-03b-revision.sql, si se creó esa tabla.
   - recovery/undo-03a-idempotencia.sql, si se creó esa tabla y está vacía.
   - recovery/undo-02f-vinculos.sql, si terminó 02f.
   - recovery/undo-02e-domicilios.sql, si terminó 02e.
   - recovery/undo-02d-contactos.sql, si terminó 02d.
   - recovery/undo-02c-indices-consulta.sql, si terminó 02c.
   - recovery/undo-02b-consultas.sql, si terminó 02b.
   - recovery/undo-02a-personas.sql, si terminó 02a.
5. Restaurar las once definiciones mediante baseline-triggers-restore.sql y comparar
   con el respaldo tomado antes de migrar. No habilitar escritores todavía.
6. Ejecutar recovery/98-verify.sql. Debe confirmar definiciones originales, ausencia
   de columnas/tablas nuevas y cero registros de negocio. Comparar también DDL,
   índices y FK con el respaldo; no basta con contar triggers.
7. Ejecutar recovery/99-release-maintenance.sql: primero su bloque de comprobación;
   únicamente si pasa, retirar las guardas. No usar 32 para recuperar el modelo viejo.
8. No ejecutar 31 sobre el esquema recuperado. Una nueva instalación empieza por 01.

No usar FOREIGN_KEY_CHECKS=0, DROP DATABASE ni el fixture de esquema de `tests/fixtures/` en la
base compartida. Este último archivo solo crea el entorno Docker descartable.

## Validación mantenida

```powershell
node --test --test-isolation=none tests/consultation-model.test.cjs
npm run typecheck
```

La prueba del modelo es aislada y no acredita por sí sola una migración real.
Los generadores y laboratorios usados durante la preparación histórica no forman
parte de esta distribución mínima. Los SQL de steps/, mantenimiento y recovery/
son los artefactos revisables conservados. Validar su ejecución en una base
desechable compatible antes de autorizar cambios institucionales. Conservar el
conjunto de la misma revisión; no mezclar archivos de versiones distintas.
