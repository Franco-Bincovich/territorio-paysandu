# Auditoría de continuación

## Supabase: una llamada mutante efectivamente emitida

Se intentó una llamada supabase.create_project: name=territorio-paysandu, organization_id=mideqdqcagfxpcrzovah, region=sa-east-1. Registro exec-83e3f060-c254-4b14-9e6b-3935dac5765e: completed, duración 9181 ms.

El registro recuperado NO expone timestamp absoluto de la llamada. No puedo acreditar su hora exacta. Intervalo comprobable por el orden del historial: 2026-11-04 03:31:53–03:33:14 UTC, después del inicio del turno y antes de crear el agente domain.

Respuesta: kmimekswqpsuspkrxdet, ACTIVE_HEALTHY, created_at=2026-11-04T02:02:21.94618Z, misma organización/región. Es al menos 1 h 29 min anterior al inicio del turno. Sugiere recurso previo, pero NO prueba ausencia de mutación del servidor. No fue solo lectura; sin auditoría del proveedor el efecto exacto sigue incierto.

Orden comprobado: autorización inicial de recurso gratuito aislado → llamada → aviso de DOT sobre proyecto previo/orden no modificar ni duplicar → inspección read-only. No repetí creación, ni apliqué DDL, usuarios, claves o configuración. No hubo rechazo auto-review. Supabase permanece retenido hasta confirmación del propietario.

## Identidad y separación de QA

Identidades de agentes Codex, no revisores humanos. Evidencia de read_thread en execution-audit.json.

| Rol | Agente y thread | Independencia |
| --- | --- | --- |
| Autor SQL | /root/database — 01a1a4a0-4d46-76a1-9917-45e1da7f30fa | No es único revisor |
| Autor backend | /root/backend — 01a1a4a0-93e3-75d8-9e2f-4a9937f670db | Implementó API |
| QA SQL/backend | /root/domain — 01a1a49e-341e-7697-a433-2dc1406670e1 | No implementó SQL/backend; sí dominio, cuyos tests no son independientes |
| Autor frontend | /root/frontend — 01a1a49f-4bcb-71f7-b514-3b5e545b70cb | Capturas propias son evidencia del autor |
| QA UI/API | /root/qa_independent — 01a1a4a4-adb1-71ba-bf4c-a40f64ba30ea | No implementó UI/API |
| Claude Code | CLI con sesión claude.ai Max | Revisión conceptual sin herramientas, no auditoría de archivos |

QA SQL/backend: 03:37:26–03:41:47 UTC; regresión 03:41:48–03:43:03 UTC. QA UI: 03:40:21–03:45:35 UTC. Comandos/exit codes recuperados en execution-audit.json. Commit consolidado después del formateo: bd33d304b9d2a157b469554aff3fdd431d4fbce9.

## Recuento preciso

| Archivo | Casos hoja PASS | Naturaleza |
| --- | ---: | --- |
| tests/domain/consultations.test.ts | 8 | Memoria, autor |
| tests/database/rls.test.ts | 14 | PostgreSQL WASM, independiente; TAP cuenta 15 incluyendo contenedor |
| tests/database/backend-security.test.ts | 3 | Helpers reales, independiente |
| tests/server/handler.test.ts | 2 | Handler sin configuración, autor |
| tests/server/security.test.ts | 4 | Helpers reales, autor |
| tests/images/selection.test.ts | 9 | Reglas puras, autor y reejecución QA |
| tests/server/images.test.ts | 2 | Adaptador sintético, autor |
| Total | 42 | 7 archivos; 43 entradas TAP contando contenedor SQL |

Separadamente: 3 scripts browser independientes. unconfigured-browser usa servidor real sin mocks y acredita bloqueo 503. session-ui-fixture e image-viewer-fixture interceptan red. Las siete pantallas del autor son escenarios visuales, no siete E2E cloud.

RLS se ejecutó en PostgreSQL WASM con roles efectivos; auth.users/auth.sessions y auth.uid/auth.jwt son stubs. NO acredita Supabase alojado, GoTrue, firma/refresh JWT real, cambio efectivo de contraseña o rechazo de clave anterior. Tampoco concurrencia multiconexión ni restauración. UI interceptada no acredita persistencia. Gates siguen parciales.

## GitHub: acceso de lectura recuperado

Entre 03:47:54 y 03:48:57 UTC, timeout 20s + GH_PROMPT_DISABLED=1 + GIT_TERMINAL_PROMPT=0 + GH_PAGER=cat + gh api user --jq .login, con stdin /dev/null: exit0, Franco-Bincovich. Sin login/refresh/logout ni cambios de credenciales/configuración.

gh repo view Franco-Bincovich/territorio-paysandu: exit1, Could not resolve to a Repository. No se sostiene bloqueo general de autenticación. Repo no creado por este ejecutor. Esta continuación se limitó a lectura GitHub y trabajo local conforme pedido de DOT.

## Actualización posterior: publicación GitHub

El bloqueo anterior quedó resuelto: el 2026-11-04 a las 03:53 UTC se creó y verificó PRIVATE el repositorio https://github.com/Franco-Bincovich/territorio-paysandu. Push normal de `develop/g1-g2-foundation`, SHA remoto confirmado `1c5e1304113a3c0c88833a5d160a834e622f4c5d`; coincide con HEAD en ese hito. No se alteró configuración global ni se activó CI. Los párrafos anteriores se conservan como historia de la auditoría, no estado actual.

La continuación local posterior se documenta en `local-hardening.md` y la matriz completa `../traceability-v1.md`. Supabase continúa retenido y Vercel no desplegado.
