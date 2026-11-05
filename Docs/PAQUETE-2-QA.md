# Paquete 2: formularios y validaciones

## Base y alcance

Rama aislada: `codex/paquete-2-formularios`, creada desde `19b86f2f05936de8a5ee033d1a18306cb84add8a`, última versión publicada del Paquete 1. La carpeta inicialmente tenía el commit local `0ed2e90` y la tipografía aprobada sin confirmar; se conservó primero en un commit local de la rama anterior. El contenido aprobado se comparó con la versión publicada antes de crear la rama.

No se modificaron los estilos premium globales, imágenes, navegación, usuarios, permisos, datos históricos, Dockerfile, Compose ni dependencias declaradas. Se conserva la eliminación del vínculo duplicado en las tarjetas de contactos. El único ajuste visual nuevo es CSS limitado a filas repetibles del formulario para evitar desbordamiento.

## Implementado

- FORM-03/04: entre una y tres entradas por contacto; agregar y quitar cualquier fila mientras quede al menos una; botón de agregar deshabilitado y protegido al llegar a tres. La API también rechaza listas mayores. No se recortan arrays históricos: se muestran completos y, si superan tres, se avisa al intentar guardar; ninguna entrada se elimina automáticamente.
- FORM-07: CI de siete u ocho dígitos y RUT de doce, con normalización de puntos/guiones y conservación de ceros iniciales. Se rechazan caracteres ajenos al formato. No se verifica identidad ni dígito de control.
- FORM-08: cada email se valida individualmente, sin espacios, con error asociado al campo. Se mantiene el contrato de listas de textos.
- FORM-06 parcial: opción Otros e identificador alfanumérico de hasta treinta caracteres, sin reglas CI/RUT. El formulario y la API bloquean su guardado con mensaje explícito porque la persistencia actual lo rechaza.
- FORM-05 pendiente: selector visible con Fijo/Celular, deshabilitado y explicado; teléfonos históricos visibles como Sin clasificar. No se infiere tipo ni se envían datos que no pueden almacenarse.

Se reutiliza el parser puro de dominio ya compartido por frontend/API. No se añade React Hook Form ni un segundo esquema Zod que duplique sus reglas.

## Persistencia inspeccionada, sin modificaciones

Proyecto Supabase: `territorio-paysandu`. Se inspeccionaron metadatos de tablas y definiciones de funciones, no contenidos de registros de personas. `consultations.person` y `contacts.person` son JSONB; `create_consultation` conserva una copia histórica, inserta contacto y revisión; `edit_consultation` guarda persona y revisión sin reescribir el contacto histórico. `private.validate_payload` permite exclusivamente los campos existentes y documentos CI/RUT. Las listas de teléfonos/correos ya están soportadas.

Cambios que requieren aprobación antes de implementarse:

1. Extender el validador privado para aceptar `documentType = Otros` y preservar su identificador sin normalización numérica.
2. Acordar la extensión compatible de JSONB para clasificar cada teléfono (por ejemplo, `phoneTypes`, lista opcional alineada con `phones` para registros nuevos). Validar cantidad coincidente y valores Fijo/Celular; permitir ausencia en históricos sin inventar clasificaciones. Adaptar contratos, parser, API de contactos y formulario conjuntamente cuando se apruebe.
3. Aplicar también el máximo de tres en la validación de RPC para escrituras nuevas, definiendo cómo se tratarán correcciones de registros históricos que superen el límite.

La estructura JSONB actual no exige nuevas tablas ni columnas; no se identifica necesidad de cambiar RLS. La modificación de funciones SQL de validación sí requiere aprobación. No se generó ni ejecutó migración. No se llamó a las RPC de creación/edición contra Supabase.

## QA y límites de evidencia

- `node tests/package-2.test.cjs`: 22 pruebas de parser, validación por campo y API con adaptadores simulados aprobadas. Se prueba que entradas inválidas y Otros no llegan a la RPC; para entradas válidas se conserva el contrato y la normalización. La prueba de éxito usa una RPC simulada: no demuestra persistencia real.
- `node tests/package-2.browser.cjs`: Edge sin interfaz a 375, 583 y 1280 px; aprobado agregar/quitar hasta tres, bloqueo del cuarto, errores de documento y email, selección Otros sin envío, contacto histórico sin clasificar, envío de tres teléfonos/correos a API interceptada y ausencia de desbordamiento. Capturas locales en `tests/artifacts/`; revisión visual de la captura móvil de 375 px.
- Prerrequisito opcional para repetir QA de navegador: `npm install --no-save --package-lock=false playwright@1.65.0`; Edge instalado; `npm run build` y `npm run start -- --port 3102`. Todas las rutas API son interceptadas. No se añade Playwright al producto ni al lockfile.
- `npm run typecheck`: aprobado.
- `npm run build`: aprobado.
- `docker build -t territorio-paysandu:paquete-2-qa .`: aprobado con la arquitectura existente.
- Consulta de solo lectura a `private.validate_payload` con datos sintéticos válidos: aprobada; no inserta ni actualiza datos. Esto comprueba aceptación del validador, no las transacciones de guardado.
- Paquete 1: comparación sin diferencias en `globals.css`, `prototype-art.css`, Dockerfile y Compose respecto de la base; se conserva el componente de ficha salvo el aviso Sin clasificar del teléfono.

Pendientes: persistencia real de Fijo/Celular y Otros, verificación de escrituras/lecturas reales de consultas/contactos y recorrido autenticado completo contra Supabase. No se declara verificación de extremo a extremo con persistencia real. No hubo push, merge ni despliegue; no se inició el Paquete 3.

Estado: **PARCIAL**, con partes independientes listas para validación local.
