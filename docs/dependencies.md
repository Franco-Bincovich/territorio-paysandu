# Dependencias y SBOM — evidencia local T068

Estado: **parcial**. Se completaron inventario, licencias declaradas y SBOM técnico; faltan revisión de obligaciones de redistribución y avisos, aceptación de riesgos y controles de CI en GitHub. No hay aprobación jurídica ni certificación del SBOM.

## Alcance y fuentes

- `docs/evidence/dependency-inventory.json`: 140 entradas de `package-lock.json`, incluyendo desarrollo y paquetes opcionales para otras plataformas. No representa exclusivamente el runtime desplegado.
- 62 manifiestos instalados/fuentes del lock aportan licencias; las 78 faltantes se obtuvieron del registro público npm para **nombre y versión exactos**, comprobando que `dist.integrity` coincida con el lock. Resultado: **0 UNKNOWN**.
- `docs/evidence/npm-license-metadata.json` conserva nombre, versión, licencia declarada, integridad, URL consultada, fecha y SHA256 de la respuesta. Es una selección de metadatos; no un archivo íntegro de cada respuesta ni verificación de los binarios opcionales no instalados.
- `docs/evidence/sbom.cyclonedx.json`: CycloneDX **1.6**, 140 componentes y 141 nodos contando la aplicación. Cada entrada incluye origen de licencia, ruta del lock, indicador instalado/desarrollo/opcional y hash SRI convertido cuando está disponible.
- `docs/evidence/sbom-validation.json`: validación real con `jsonschema.Draft7Validator` y `FormatChecker` contra esquemas oficiales descargados, además de cobertura y referencias del grafo. No es certificación.
- Los esquemas oficiales y sus URLs/hashes se conservan en `docs/evidence/cyclonedx-schema/`. Fuente: [CycloneDX 1.6 JSON](https://cyclonedx.org/docs/1.6/json/) y [esquema oficial](https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/bom-1.6.schema.json).

## Límites y pendientes de liberación

El grafo registra cuatro referencias pares **opcionales**, declaradas pero ausentes del lock: `@opentelemetry/api` para Supabase y Next, `babel-plugin-react-compiler` y `sass` para Next. Se conservan en `sbom-unresolved-dependencies.json`; no se instalaron para rellenar el grafo.

Las licencias declaradas incluyen MIT, Apache-2.0, ISC, BSD-3-Clause, 0BSD, LGPL-3.0-or-later y CC-BY-4.0, además de expresiones compuestas. Hay paquetes `@img/sharp-libvips-*`, `@img/sharp-wasm32` y `@img/sharp-win32-*` con LGPL en la declaración; `caniuse-lite` declara CC-BY-4.0. Algunos están instalados y otros son opcionales de otras plataformas. Antes de liberar o redistribuir, revisar los artefactos efectivamente distribuidos, sus textos de licencia/NOTICE, atribuciones y obligaciones aplicables. Este inventario no resuelve ni aprueba esas obligaciones.

Un hash del lock o una declaración npm no demuestra que un paquete sea seguro, que se hayan inspeccionado sus binarios o que todas sus dependencias embebidas estén inventariadas. Los resultados de auditoría de vulnerabilidades son evidencia separada y tienen fecha propia.

## Reproducción

Desde la raíz del proyecto, sin cambiar `package.json` ni el lock:

```sh
# Offline: usa evidencia npm exacta ya conservada.
node scripts/dependency-inventory.mjs
python3 scripts/validate-sbom.py
```

La regeneración crea un nuevo serial/fecha de SBOM; repetir luego la validación para actualizar su hash. El validador utiliza `jsonschema` y `referencing` ya disponibles en el host; no instala paquetes.

Consultas públicas explícitas, solo cuando sea necesario actualizar evidencia:

```sh
node scripts/dependency-inventory.mjs --refresh-metadata
python3 scripts/validate-sbom.py --fetch-schemas
```

Estas opciones consultan únicamente npm público y el repositorio oficial de esquemas. No incluyen credenciales, no descargan binarios de dependencias, no instalan software y no modifican configuraciones globales. Un cambio de versión o integridad invalida la evidencia cacheada; las licencias desconocidas requieren revisión. Mantener en CI futuro generación, validación y revisión del cambio de lock.
