# Paquete 2: formularios, validaciones y persistencia

Rama `codex/paquete-2-formularios`, basada en `19b86f2`, versión publicada del Paquete 1. El usuario autorizó completar Supabase y desplegar en Vercel después del informe parcial.

## Implementado

Máximo de tres teléfonos y tres emails con controles agregar/quitar y validación por entrada en formulario, API y Supabase. Los históricos no se recortan ni se eliminan; si tienen más de tres entradas, una corrección exige resolver explícitamente el exceso.

Cada teléfono nuevo o corregido exige Fijo/Celular en formulario y API. `phones` sigue siendo una lista de textos y `phoneTypes` es un campo aditivo alineado por índice. Agregar/quitar filas mantiene ambas listas juntas. La API de contactos devuelve ambos campos; la ficha muestra el tipo. Los históricos sin clasificación se muestran como Sin clasificar.

El parser y el validador SQL aceptan ausencia de `phoneTypes` para snapshots y clientes anteriores; cuando está presente exigen cantidad coincidente y valores válidos. La API actual exige clasificación al guardar.

Otros acepta un identificador alfanumérico de hasta treinta caracteres, conservando puntos y guiones. CI acepta siete u ocho dígitos y RUT doce, normalizando puntos/guiones sin perder ceros iniciales. Los correos se validan individualmente, sin espacios. No se verifica identidad ni existencia del email.

Se reutiliza el parser de dominio compartido sin agregar React Hook Form ni duplicar reglas con Zod. Los estilos globales premium, imágenes, navegación, Dockerfile, Compose y dependencias declaradas del Paquete 1 no cambiaron. Solo se agrega CSS para las filas repetibles.

## Supabase

Proyecto `territorio-paysandu` (`kmimekswqpsuspkrxdet`). Migración aplicada: `package_2_contact_classification_and_other_documents`.

Solo se reemplazó `private.validate_payload(jsonb)`: acepta Otros y phoneTypes, limita las listas y valida clasificación coherente. Las RPC existentes conservan el JSONB completo en consultas, contactos y revisiones. No se alteraron tablas, columnas, usuarios, permisos, políticas RLS ni registros de negocio.

SQL y respaldo del validador anterior en `Backend/sql/`. La migración incluyó pruebas que abortarían la transacción ante resultados inesperados. Se repitieron después de aplicarla. Las huellas de todas las filas de consultas/contactos coincidieron antes y después: un registro de cada tabla, sin modificaciones.

La revisión de seguridad mantiene los avisos preexistentes de [RLS sin políticas en tablas privadas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) y [protección de contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No se modificó configuración de autenticación ni seguridad fuera del alcance.

## QA

- `node tests/package-2.test.cjs`: 24 pruebas aprobadas de documentos, emails, límites, clasificación, históricos y POST/PATCH. Persistencia simulada.
- `node tests/package-2.browser.cjs`: aprobado en Edge a 375, 583 y 1280 px. Agregar/quitar, impedir el cuarto, clasificación obligatoria, asociación al quitar el segundo teléfono, errores por campo, Otros y ausencia de desbordamiento. Todas las API interceptadas; no demuestra persistencia real.
- Para repetir navegador: instalar temporalmente `playwright@1.65.0` con `npm install --no-save --package-lock=false playwright@1.65.0`; Edge instalado; `npm run build`, `npm run start -- --port 3102` y el script de navegador. Capturas ignoradas por Git en `tests/artifacts/`.
- TypeScript y build Next.js aprobados.
- `docker build -t territorio-paysandu:paquete-2-completo .`: aprobado.
- Validador real Supabase: cinco casos válidos y once inválidos aprobados, sin escrituras de negocio.
- Comparación sin diferencias en globals.css, prototype-art.css, Dockerfile, Compose, package.json y lockfile respecto del Paquete 1.

La prueba autenticada completa navegador → API → RPC → lectura queda para validación funcional con una sesión de usuario. No se crearon usuarios ni se guardaron consultas de prueba en la base real. Publicación autorizada en Vercel `territorio-paysandu-prueba`, sin merge de ramas ni inicio del Paquete 3.
