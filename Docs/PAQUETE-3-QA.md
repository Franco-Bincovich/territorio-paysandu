# Paquete 3: búsqueda de padrones

## Base y cambios

Rama aislada `codex/paquete-3-busqueda`, creada desde `3313f6cd4d7e1806d3c9be079cfb5f1e454148bb`, versión publicada con los paquetes 1 y 2. Se revisaron el estado local y los contratos antes de implementar.

BUS-01: el formulario de localidad/padrón ahora muestra exactamente Paysandú y Paysandú Chacras en un desplegable. El número de padrón sigue independiente. El sistema usa `locality` como texto; se conserva Paysandú y se envía el nombre Paysandú Chacras solicitado sin inventar códigos numéricos ni alias. No hay catálogo institucional de Chacras configurado en el repositorio: el resultado depende de que el adaptador encuentre datos para ese identificador.

BUS-02: popup azul/blanco con el mensaje exacto «Este tipo de padrón aún no ha sido relevado.», botón Entendido, Escape, foco inicial en el botón, Tab/Shift+Tab contenidos y retorno de foco al buscador. No cambia ni elimina resultados. Se limita a búsquedas por localidad/padrón; nombre/CI/RUT mantienen parámetros, resultados y comportamiento.

## Dependencia institucional y contrato faltante

El backend actual devuelve `results[]` con localidad, padrón, domicilio e indicador sintético. `ParcelRecord` no declara clasificación catastral, y los adaptadores actual y prototipo no la producen. El campo `type` del prototipo significa vínculo declarado: no es clasificación y no se reutiliza. Tampoco se deduce PH/UH/RURAL a partir del número, zona o sección.

Se preparó un contrato aditivo propuesto en `parcel-classification.ts`:

```json
{
  "classification": {
    "code": "PH",
    "evidence": {
      "source": "institutional",
      "verified": true,
      "reference": "REFERENCIA-SINTETICA-SOLO-PARA-QA"
    }
  }
}
```

Este ejemplo y todos los fixtures son sintéticos. La API real todavía no emite el campo y por ello no dispara el popup sobre datos actuales. El guard exige código PH/UH/RURAL exacto, fuente institucional, verificación explícita y referencia no vacía. Campos ausentes, desconocidos, sin evidencia o sintéticos no lo activan.

Para completar BUS-02 con datos reales, hace falta una fuente institucional y adaptar el contrato de servidor para emitir clasificación y referencia verificables en cada resultado. No se agregó una fuente falsa ni una activación por configuración. No se modificó el backend.

## QA

- `node tests/package-3.test.cjs`: 17 pruebas aprobadas de guard de clasificación y API existente con adaptadores simulados. Incluyen PH/UH/RURAL, otros tipos, desconocidos, evidencia incompleta y búsquedas por nombre/CI/RUT. Confirman que el backend actual no inventa clasificación.
- `node tests/package-2.test.cjs`: 24 pruebas de regresión aprobadas.
- `node tests/package-3.browser.cjs`: pruebas con Edge a 375, 583 y 1280 px; selector exacto y valores enviados, popup para cada clasificación con evidencia simulada, ausencia para otros/desconocidos, conservación de resultados, botón, Escape, Tab/Shift+Tab, retorno de foco, búsqueda por persona y selección de resultados.
- `node tests/package-2.browser.cjs`: regresión de formularios, clasificación telefónica, Otros, límites y errores aprobada a 375, 583 y 1280 px. Solo se adaptó el selector del test de input a select; el código del Paquete 2 no cambió.
- TypeScript y build Next.js aprobados.
- `docker build -t territorio-paysandu:paquete-3-qa .`: aprobado.
- Capturas locales del popup en `tests/artifacts/search-notice-375.png`, `search-notice-583.png` y `search-notice-1280.png`. Los artefactos están excluidos de Git.

Las pruebas de navegador interceptan todas las API y utilizan exclusivamente fixtures identificados como SYNTHETIC QA. No equivalen a una búsqueda institucional de extremo a extremo. Para repetirlas: Playwright 1.65.0 instalado temporalmente sin cambios en package.json/lockfile, Edge instalado, `npm run build`, `npm run start -- --port 3102` y los scripts de navegador.

Durante QA se corrigió el nombre accesible del desplegable y se agregó contención explícita de Tab en el popup después de detectar que podía salir hacia la barra del navegador. La comprobación del retorno de foco espera el evento nativo de cierre.

## Conservación y estado

Sin diferencias desde la base en Backend, formularios/validaciones/contactos del Paquete 2, contratos anteriores, estilos globales premium, Dockerfile, Compose, package.json y lockfile. En `territory-app.tsx` los cambios se limitan a imports y SearchView.

No se utilizaron herramientas de Supabase ni se consultaron o modificaron bases en este paquete. Supabase, PostgreSQL, MariaDB, datos, usuarios y permisos permanecieron intactos. No hubo migraciones, push, merge ni despliegue en Vercel/VPS. No se inició otro paquete.

BUS-01 completo en interfaz; BUS-02 preparado y verificable con fixtures, pendiente de fuente institucional real. Estado general: **PARCIAL**.
