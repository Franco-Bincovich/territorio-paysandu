# Estado de gates — ejecución local

## G0: parcial, reconocimiento realizado

Leídas las cuatro fuentes vigentes y exportadas las 99 filas V1.0 a backlog-v1-snapshot.json. Workspace aislado y referencia visual recuperados. Roles de trabajo separados, revisión cruzada realizada. DOT coordina conciliación del backlog. No cerrar requisitos de responsables institucionales, redes ni privacidad por tener arquitectura local.

## G1: implementación local; bloqueado para validación remota

Next/React/TypeScript con dependencias exactas, lockfile, API modular y salida standalone; repo Git local. SQL de RLS y RPC probado en PostgreSQL WASM con stubs Auth. Auth servidor implementado, pero sin configuración real ni usuario provisionado. CI preparada como ejemplo inactivo hasta comprobar cuota/remote. No hay PR remoto ni despliegue.

## G2: implementación sintética, verificación parcial

Búsquedas, ficha, contactos, consulta y edición, historial, imágenes ausentes, gates de sesión y password implementados. Pruebas unitarias/SQL, build y navegador con fixtures pasan según evidencias. Fixtures browser no equivalen a persistencia/Auth real. G2 no se declara cerrado mientras falte integración UI→API→Supabase real y revisión completa de las 99 tareas.

## Bloqueos precisos

| Acción/target | Evidencia y estado | Continuación segura |
| --- | --- | --- |
| Crear/subir Franco-Bincovich/territorio-paysandu | Conector identifica cuenta pero no expone create-repository; gh reportó invalid token en sandbox y timeout en keyring con red autorizada. Pendiente, no ejecutado. | Git local, restaurar acceso CLI por canal seguro. |
| Aplicar esquema a kmimekswqpsuspkrxdet | Llamada create_project devolvió proyecto ACTIVE_HEALTHY con created_at anterior (02:02 UTC). Origen no acreditado; DOT ordenó no modificar ni duplicar. Inspección read-only vacía. Resultado de creación no se atribuye a esta ejecución. | SQL local y QA; coordinar procedencia antes de mutar. |
| Generar migración por Supabase CLI 3.0.0 | EROFS al intentar crear /home/franco/.supabase incluso con --help. Falló antes de generar migración, no denegación auto-review. | Conservar schema.sql; resolver ruta de config soportada sin cambios globales. |
| Deploy Vercel | Equipo accesible; respuesta no acredita plan apto/cupo. Hobby solo permite uso personal no comercial según docs. Pendiente sin creación ni despliegue. | Build/QA loopback; confirmar plan compatible sin contratar. |
| Login Paysandu y clave inicial | Correo/canal seguro aún sin definir; proyecto remoto retenido. Pendiente, no usuario creado. | Configuración de ejemplo, no secretos en chat/git/Notion. |
| G3 y piloto | Sin permiso institucional/red/datos reales; piloto sin GO. Bloqueado por mandato. | Adaptadores sintéticos, no acceso institucional. |

No hubo rechazo de auto-review. Las escalaciones de descarga de dependencias/prototipo, Claude suscripción y servidor loopback fueron aprobadas. No se modificaron configuraciones globales ni se aprobaron gastos. Inventario de navegador CUA vacío: no había sesión alternativa para crear el repo remoto.

## Incidencias de verificación local

`tsx --test` no pudo abrir su socket IPC en sandbox; se usa el loader oficial `node --import tsx --test`, sin necesitar ese socket. Durante formateo el dev server regeneró tipos mientras corría typecheck y produjo TS2306 transitorio en `.next/dev/types/routes.d.ts`; se detuvo el servidor y se repitieron typecheck, tests y build en estado estable. No se alteraron pruebas para ocultar fallos funcionales.

Referencia de condiciones Vercel: https://vercel.com/docs/plans/hobby (consultada en esta ejecución).
