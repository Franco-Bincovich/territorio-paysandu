# Revisión dirigida de las 57 tareas pendientes

Base: commit 579401e; 55 parciales y 2 sin evidencia. Esta clasificación responde a las dependencias concretas, no aprueba gates ni modifica requisitos. Solo se desarrolla G0/G1/G2 autorizado; las tareas de G4/G5 quedan señaladas, sin ejecutar sus gates.

| Tarea | Gate | Disposición | Evidencia o dependencia pendiente en la base |
| --- | --- | --- | --- |
| PAY-T002 | G0 Definiciones | Originales o decisiones institucionales pendientes | Se leyeron los siete resúmenes v0.3 enlazados y contrastaron reglas reemplazadas por v1; todos declaran original íntegro no importado. No acredita revisión de los siete originales. |
| PAY-T004 | G0 Definiciones | Originales o decisiones institucionales pendientes | RPC transaccional y contrato local; falta validación institucional del contrato de escritura. |
| PAY-T005 | G0 Definiciones | Originales o decisiones institucionales pendientes | Interfaz y resolución local de imágenes; sin endpoint/licencia/contrato institucional. |
| PAY-T009 | G0 Definiciones | Originales o decisiones institucionales pendientes | Aprobación G0–G2 recibida; no acta de aceptación institucional final. |
| PAY-T011 | G1 Base técnica | Hosting, CI o configuración operativa pendientes | Repositorio privado remoto creado y commit1c5e130 confirmado por DOT; PR/protecciones/CI activas aún pendientes. |
| PAY-T014 | G1 Base técnica | Hosting, CI o configuración operativa pendientes | Workflow ejemplo inactivo; merge protection y rollback no ensayados. |
| PAY-T015 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Migración CLI local generada, esquema probado en WASM, ERD y reversión forward-only documentados; sin rollback/restore ensayado. |
| PAY-T016 | G1 Base técnica | Hosting, CI o configuración operativa pendientes | Eventos request allowlist/correlación/status/duración probados sin PII; no alertas/dashboard técnico desplegado. |
| PAY-T017 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Adaptador Auth real implementado; faltan login/refresh/revocación GoTrue reales. |
| PAY-T018 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Autorización y negativos SQL locales; sin prueba autenticada endpoint→Supabase. |
| PAY-T019 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Gate 60min DB y UI; tests locales, no sesión real vencida. |
| PAY-T023 | G2 Funcional | Contrato, conectividad o datos institucionales pendientes | Adaptador sintético; no consulta institucional ni timeout externo. |
| PAY-T024 | G2 Funcional | Contrato, conectividad o datos institucionales pendientes | Pruebas independientes de localidad+padrón, ceros y localidad equivocada; sin backend institucional ni E2E autenticado. |
| PAY-T025 | G2 Funcional | Brecha local abordada en esta continuación | Sin precarga/éxito/vacío/error probados con fixtures; QA responsive completo de búsquedas pendiente. |
| PAY-T026 | G2 Funcional | Contrato, conectividad o datos institucionales pendientes | Ficha sintética y nulls probados; sin contraste padrón oficial 17718 autorizado. |
| PAY-T027 | G2 Funcional | Contrato, conectividad o datos institucionales pendientes | Dos slots y ausencia probada; servicio institucional no integrado. |
| PAY-T028 | G2 Funcional | Brecha local abordada en esta continuación | Zoom/carrusel/Escape desktop probados con SVG; falta prueba zoom móvil. |
| PAY-T030 | G2 Funcional | Brecha local abordada en esta continuación | Cards y expansión probadas; prueba dedicada múltiples/titular/medios pendientes. |
| PAY-T034 | G2 Funcional | Brecha local abordada en esta continuación | Filtros compuestos y orden; falta prueba API autenticada y paginación UI completa. |
| PAY-T040 | G2 Funcional | Supabase real retenido y pruebas autenticadas | Historial único y detalle visual; permisos persistentes reales pendientes. |
| PAY-T046 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Matriz99 y tests existentes relacionados; casos cloud/criterios45 no completos. |
| PAY-T047 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Browser local falla cerrada y fixtures; no E2E real Auth→persistencia. |
| PAY-T048 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | QA SQL/servidor independiente, ataques locales; JWT real pendiente. |
| PAY-T049 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Sin medición P95/saturación ni carga representativa. |
| PAY-T050 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Inspección capturas y fixes a11y; no auditoría completa ni aceptación visual. |
| PAY-T052 | G5 Entrega | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Runbook borrador; sin RPO/RTO ni restauración ensayada. |
| PAY-T053 | G5 Entrega | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Estrategia descrita, rollback no ensayado. |
| PAY-T054 | G5 Entrega | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | README y guías técnicas; manual usuario/capacitación pendientes. |
| PAY-T058 | G0 Definiciones | Originales o decisiones institucionales pendientes | No hay contraste 7/7 archivos históricos con hash/versión. |
| PAY-T060 | G0 Definiciones | Originales o decisiones institucionales pendientes | Snapshot separado/contacto persistido local; política rectificación/privacidad pendiente. |
| PAY-T061 | G0 Definiciones | Originales o decisiones institucionales pendientes | Sin importación histórica implementada y datos sintéticos explícitos; falta decisión formal específica. |
| PAY-T062 | G0 Definiciones | Originales o decisiones institucionales pendientes | Tipos canónicos fijos y formato CI/RUT; checksum/reglas institucionales no confirmadas. |
| PAY-T065 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Env ejemplo y separación servidor; rotación y privilegios remotos no probados. |
| PAY-T066 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Migración versionada CLI y ejecución local WASM; reversión/cloud pendientes. |
| PAY-T067 | G1 Base técnica | Hosting, CI o configuración operativa pendientes | OpenAPI3.1 versionada, rutas/métodos/referencias comprobados; no contrato generado/validado en CI activa. |
| PAY-T068 | G1 Base técnica | Brecha local abordada en esta continuación | Inventario140 paquetes,78 licencias UNKNOWN y audit0 advisories; no SBOM SPDX/CycloneDX ni licencias resueltas. |
| PAY-T069 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Limiter SQL/API probado local; sin alertas y control endpoint Auth directo verificado. |
| PAY-T070 | G1 Base técnica | Hosting, CI o configuración operativa pendientes | Origin CSRF/cookies/cabeceras locales; HSTS/staging efectivo no probado. |
| PAY-T071 | G1 Base técnica | Hosting, CI o configuración operativa pendientes | Errores sanitizados y sin logs de PII app; retención cloud y revisión institucional pendiente. |
| PAY-T074 | G2 Funcional | Contrato, conectividad o datos institucionales pendientes | Composición localidad/padrón y preservación textual ceros comprobadas en catálogo; matriz institucional aún pendiente. |
| PAY-T076 | G2 Funcional | Brecha local abordada en esta continuación | Escape/foco/zoom desktop probados; móvil/focus trap exhaustivo pendientes; pinch/descarga históricos requieren aclarar alcance. |
| PAY-T077 | G2 Funcional | Contrato, conectividad o datos institucionales pendientes | Expiración y shape URL probados; renovación enlaces/denegación servicio no implementadas. |
| PAY-T082 | G2 Funcional | Brecha local abordada en esta continuación | Browser independiente filtros combinados/página2 sobreviven ida/vuelta; scroll restaurado no acreditado. |
| PAY-T089 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Negativos SQL/backend locales; excluye admin/export/restore de texto histórico v2. |
| PAY-T090 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Fallo config/imágenes/rollback local; DB caída/reinicio/restore no ensayado. |
| PAY-T091 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Chromium desktop/móvil probado; sin Edge/Safari ni matriz equipos institucionales. |
| PAY-T093 | G5 Entrega | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Procedimiento backup/incidentes borrador; sin simulacro ni contactos. |
| PAY-T094 | G5 Entrega | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Metadatos HTTP locales sin secretos; métricas por dependencia/alertas simuladas no implementadas. |
| PAY-T097 | G0 Definiciones | Originales o decisiones institucionales pendientes | Arquitectura/ERD/amenazas y adaptadores documentados; cloud y contratos institucionales sin verificar. |
| PAY-T101 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Proyecto retornado de origen incierto retenido; SQL solo local. |
| PAY-T102 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | Auth adaptador implementado, JWT/Auth real sin configurar/probar. |
| PAY-T104 | G1 Base técnica | Supabase real retenido y pruebas autenticadas | RLS efectivo en WASM con auth stubs; no ataques directos Supabase alojado. |
| PAY-T105 | G2 Funcional | Brecha local abordada en esta continuación | Pruebas independientes match exacto nombre/CI/RUT y transversal dos localidades; homónimos personas distintas y fuente real pendientes. |
| PAY-T106 | G2 Funcional | Brecha local abordada en esta continuación | Persona vacío/error y búsquedas visuales probados; múltiples resultados/teclado completo pendientes. |
| PAY-T114 | G2 Funcional | Supabase real retenido y pruebas autenticadas | Historial único y fecha sin hora en UI; permisos SQL locales, E2E real pendiente. |
| PAY-T115 | G4 QA piloto | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Matriz99 trazabilidad disponible; documento45 decisiones no contrastado íntegramente. |
| PAY-T119 | G5 Entrega | Gate posterior G4/G5: requiere entorno y aprobación correspondientes | Output standalone y separación dominio; sin ensayo alternativo/release final. |

Las brechas locales se reevalúan en traceability-v1.md después de sus pruebas. Las filas anteriores conservan el motivo inicial para mostrar qué se atendió. No se interpreta `evidence_local` como cierre.

T049 necesita un entorno representativo, objetivos/carga acordados y G4 autorizado: medir fixtures en una mini PC no acreditaría rendimiento institucional. T058 necesita los siete originales completos con versión/hash; los resúmenes de Notion no permiten sustituirlos.

## Resultado de esta continuación

Se atendió el trabajo local material identificado: T025/T028/T076/T082/T106, homónimos T105 y SBOM/licencias declaradas T068. T030 se corrigió por evidencia existente; T034 conserva pendiente la prueba API autenticada. Matriz final: 28 con evidencia local, 49 parciales, 20 bloqueadas y 2 sin evidencia. Entre las 51 aún parciales/sin evidencia: 28 dependencias externas, 8 trabajos condicionados a entorno/contrato y 15 de gates G4/G5. No queda una tarea clasificada como trabajo local material autónomo en esta revisión dirigida.

Las ocho condicionadas son T011/T014 (PR/protecciones/CI y cuota/plan aptos), T015/T066 (aplicación/recuperación en destino autorizado), T016 (alertas/observabilidad del hosting), T067 (contrato en CI activa), T069 (Auth directo/alertas del servicio) y T077 (renovación/denegación con contrato institucional). No se reemplazan esas evidencias por mocks ni se anticipan gates posteriores. T068 conserva pendiente revisar avisos y obligaciones de redistribución de los artefactos de entrega.
