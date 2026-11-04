# Dependencias y licencias — PAY-T068

Las dependencias directas están fijadas exactamente; `npm ci` usa el lockfile. El inventario reproducible se genera con `node scripts/dependency-inventory.mjs`; incluye dependencias transitivas, opcionales, integridad del registro y licencias declaradas disponibles. Su hash vincula el resultado al lockfile. El generador también produce CycloneDX 1.6 validado contra esquema oficial y lockfile; no es una certificación. Las 78 licencias inicialmente UNKNOWN se resolvieron con metadatos npm exactos, sin modificar npm global. Los paquetes opcionales no instalados no se presumen ausentes de otros despliegues. Fuentes, validación y límites: [dependencias](dependencies.md).

Antes de cada release: regenerar inventario, revisar cambios de dependencias, ejecutar `npm audit --json` y `npm audit --omit=dev --json`, conservar fecha y resultado, verificar licencias de paquetes realmente distribuidos y avisos requeridos. El análisis del registro es puntual, no garantiza ausencia de vulnerabilidades. No ejecutar `npm audit fix --force` automáticamente. Revisar actualizaciones en rama y repetir pruebas; conservar lockfile e integridades.

No hay excepciones aprobadas. Una excepción necesita identificador del advisory, versión, alcance explotable, mitigación comprobada, responsable, vencimiento y autorización de seguridad; nunca permite liberar un defecto crítico conocido. Los paquetes de desarrollo también se evalúan por riesgo de cadena de suministro. El inventario no autoriza legalmente redistribución: revisar obligaciones y avisos antes del piloto.

La plantilla CI queda inactiva hasta verificar cuota gratuita. Su activación no habilita gastos ni despliegues. No se cargan secretos en herramientas de análisis externas.

Antes de publicar, ejecutar `git ls-files -z --cached --others --exclude-standard | node scripts/check-secrets.mjs`, revisar diff completo e historial nuevo y confirmar repositorio privado. El detector no imprime valores y reconoce formatos comunes de claves, JWT y URLs firmadas; no garantiza ausencia de secretos arbitrarios ni datos personales. Los binarios requieren inspección visual/procedencia aparte. No agregar excepciones silenciosas para hacer pasar el control.

Auditoría del registro realizada el 2026-11-04: cero advisories reportados en los ámbitos completo y producción; resultados JSON en `docs/evidence/npm-audit-*.json`. Es evidencia temporal, no un certificado de seguridad.
