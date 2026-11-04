# Seguimiento dirigido de pendientes — 2026-11-04

Base 579401e: revisión concreta de las 2 tareas sin evidencia y 55 parciales. La disposición de las 57 está en `../pending-task-disposition.md`; la matriz actual conserva evaluación inicial y pendientes por tarea. No se ejecutan gates G4/G5, ni se marca terminado lo parcial.

## Trabajo material local realizado

- T082: restauración de filtros, página, scroll vertical/horizontal y foco tras detalle global o del padrón; estado solo en memoria, limpiado al salir de sesión.
- T076: QA detectó que Tab salía al BODY desde el modal nativo. Se implementó contención explícita de foco y se reprobó Tab/ShiftTab/Escape.
- T025/T028/T106: QA independiente responsive 320/390/768/1440, múltiples resultados por teclado y zoom de ambas imágenes en móvil. Sin cambio de identidad visual ni funciones históricas pinch/descarga.
- T105: tercer registro sintético deliberado, mismo nombre con documento diferente; pruebas distinguen nombre (3 padrones) de CI/RUT (2 de una persona y 1 de otra). No modifica el algoritmo ni carga datos reales.
- T030: corregida evaluación desactualizada; ya existía QA de múltiples contactos/titular/medios en T111.
- T068: metadatos públicos de versiones exactas permiten resolver licencias opcionales; SBOM y validación quedan sujetos a revisión cruzada registrada en evidencia específica. No se cambiaron dependencias ni planes.

## Verificación

`npm run check` final exit0: TypeScript, 14 archivos de tests y build Next. El primer intento detectó una expectativa anterior de 2 resultados por nombre en security.test.ts; se actualizó a 3 conforme al nuevo fixture homónimo. El algoritmo no falló. QA independiente ya verificó separadamente las dos identidades.

QA browser independiente: scroll global 1289→1289; autor frontend: scroll de padrón 1677→1677 y horizontal98→98, filtros/página2/foco conservados. Cero errores de página reportados; todas las respuestas de negocio son fixtures interceptadas. Servidor loopback cerrado antes del check. Evidencia scripts y resultados en tests/qa y docs/evidence.

## Dependencias concretas restantes

- T049: P95/saturación requieren entorno y carga representativos, objetivos acordados y gate G4; medir fixtures locales no acredita ese criterio.
- T058: faltan siete originales íntegros con versión/hash. Resúmenes de Notion no los sustituyen.
- Auth/persistencia/RLS reales y migración/restore: proyecto Supabase retenido; no hay autorización para usarlo en esta continuación.
- T023/T027/T074/T077 y otros de Catastro/imágenes: faltan contrato, conectividad, licencia y autorización. En particular T077 necesita contrato de renovación/denegación de enlaces antes de implementar ese comportamiento.
- CI/hosting/alertas y secretos: requieren entorno, cuota/plan aptos y canal seguro; no se despliega ni se habilita gasto.
- Criterios institucionales, privacidad, retención, recuperación, aceptación y gates posteriores siguen pendientes; detalle por tarea en la matriz.

No se hicieron llamadas a Supabase, despliegues, compras ni cambios globales. No se prolonga esta tanda con auditorías generales ni evidencia simulada presentada como integración real.

T068 final: 140 componentes, 0 licencias UNKNOWN. SBOM CycloneDX 1.6 validado offline contra esquema oficial y lock/grafo. QA independiente: cuatro regresiones PASS (válido; versión, hash y edge alterados rechazados). Cuatro peers opcionales no instalados explícitos. Dependencias/lock sin cambios; aceptación de licencias/avisos pendiente, no certificación.
