# Paquete 4: implementación visual y preparación de integración

## Base y alcance

Rama aislada `codex/paquete-4-visual`, creada desde `95d657adbfa1e1b7818554b5121ca01a51646f96`. Esa versión contiene los paquetes 1, 2 y 3. Se conservan Next.js, React, TypeScript, Node.js, Docker, Supabase y el diseño premium existente.

No se cambiaron backend, contratos de API, validaciones, SQL, fuentes de datos, usuarios, permisos, dependencias, Dockerfile, Compose ni estilos globales. No se consultó ni modificó Supabase/MariaDB. No hubo migraciones, push, merge, despliegue ni cambios sobre producción.

## Componentes visuales

- `OptionalDomicileSection`: sección Domicilio dentro de Persona que realiza la consulta, con indicador Opcional y aviso Disponible próximamente. Es un contenedor reutilizable mediante children; actualmente no contiene controles, formatos, validaciones, estado de formulario ni serialización. No agrega datos al guardado y no impide registrar consultas.
- `ParcelSearchResults`: presentación reutilizable de carga, vacío, error y resultados. Cada tarjeta muestra localidad, padrón y domicilios informados. Si no hay domicilio, se indica No informado; no se completa por inferencia.
- `groupParcelResults`: agrupación estricta por el identificador compuesto JSON de localidad y padrón, sin normalizar nombres, localidades ni números. Conserva el orden, todas las entradas originales y todos los domicilios distintos de cada grupo. No modifica el array recibido.
- `package-4-visual.css`: estilos acotados a los componentes nuevos, reutilizando colores, bordes, superficies y tipografía aprobados. Etiquetas en negrita y mayores que los valores.

La búsqueda mantiene su endpoint, parámetros, cancelación y selección individual. El popup del Paquete 3 sigue evaluando la respuesta original, antes de la agrupación visual.

## Identidad, homónimos y respuestas extensas

No se agrupan personas por nombre ni se afirma que todos los inmuebles pertenecen a una misma persona. Ante varias coincidencias de nombre, se informa que pueden corresponder a personas distintas. Los tres padrones de los homónimos sintéticos existentes siguen siendo tarjetas independientes.

Solo se evita repetir visualmente una tarjeta del mismo inmueble. Las entradas de origen permanecen en el grupo y se muestra su cantidad como coincidencias, no como cantidad de personas. Domicilios diferentes para la misma clave se muestran todos.

El contrato actual de resultados no contiene identidad ni atributos de persona. Si una futura API incorpora ese detalle, su representación debe acordarse expresamente y conservarse por entrada; no se podrá tratar el identificador del inmueble como identificador de persona. Actualmente no se descarta ningún dato personal que la interfaz anterior mostrara.

No se recortan resultados ni se aplica paginación supuesta del servidor. En pantallas amplias hay una región de resultados con altura acotada, desplazamiento y acceso por teclado; en móviles se usa el desplazamiento natural de la página. Todas las tarjetas permanecen disponibles.

## QA ejecutado

- `npm run typecheck`: aprobado.
- `npm run build`: aprobado.
- `docker build -t territorio-paysandu:paquete-4-visual-qa .`: aprobado, sin cambiar la configuración Docker.
- `node tests/package-4.test.cjs`: 10 pruebas aprobadas. Agrupación estricta, clave compuesta, conservación de metadatos y domicilios distintos, ausencia de mutaciones, 300 entradas repetidas sin truncamiento, estados visuales, texto escapado, contenedor vacío sin controles y ranura de contenido futuro.
- `node tests/package-2.test.cjs`: 24 pruebas aprobadas.
- `node tests/package-3.test.cjs`: 17 pruebas aprobadas.
- `node tests/package-4.browser.cjs`: aprobado en Edge a 375, 583 y 1280 px. Carga controlada, vacío, error, recuperación, múltiples coincidencias y homónimos del catálogo existente, duplicado de la misma clave, campos de cada tarjeta, desplazamiento y teclado, apertura de un padrón, Domicilio opcional sin controles y guardado con exactamente las claves anteriores del payload.
- `node tests/package-2.browser.cjs` y `node tests/package-3.browser.cjs`: regresión aprobada a los mismos tres tamaños. Se mantienen límites y clasificación de teléfonos, emails, documentos Otros, guardado, localidades, popup, Escape y foco.
- Sin desbordamiento horizontal en los tamaños probados. El desplazamiento interno de listas se verificó con viewport corto y teclado. Revisión visual de capturas móvil y escritorio.

Las pruebas de navegador interceptan todas las llamadas API. Usan los homónimos y padrones ya presentes en el catálogo sintético; las variantes de duplicado y conflicto de domicilio son exclusivamente fixtures de presentación, sin persistencia ni afirmaciones de relaciones reales. No se agregaron fixtures a los catálogos de producción. Estas pruebas no demuestran una consulta institucional ni escrituras reales de Supabase.

Para repetir QA de navegador: Edge y Playwright 1.65.0 temporal, sin cambios en package.json/lockfile; `npm run build`, `npm run start -- --port 3102` y los scripts correspondientes.

## Evidencia local

Capturas excluidas de Git en `tests/artifacts/`:

- `package-4-results-375.png`, `package-4-results-583.png`, `package-4-results-1280.png`.
- `package-4-domicile-375.png`, `package-4-domicile-583.png`, `package-4-domicile-1280.png`.

## Pendientes precisos de integración

### Domicilio

Campos definitivos: ninguno recibido; no se inventó ni agregó ningún nombre, formato o validación. Hace falta definir qué domicilio representa, campos, opcionalidad individual, longitudes, valores vacíos, reglas de corrección y visibilidad histórica.

Contratos a evaluar cuando se reciban esas definiciones: Person/Consultation en `contracts.ts`, ConsultationDraft y validación compartida, PersonSnapshot/ConsultationData del dominio y payload de POST/PATCH `/api/consultations`. Ninguno se modificó en este paquete.

Persistencia existente a revisar, sin cambio propuesto todavía: JSONB de `public.consultations.person`, `public.contacts.person`, `public.consultations.original_snapshot` y `private.consultation_revisions.snapshot`, junto con `private.validate_payload` y las RPC create/edit de consultas. La ubicación definitiva depende del significado del domicilio. Deben conservarse snapshots originales y permitir ausencia en históricos. No se ha definido una tabla nueva ni una migración.

### Relación institucional persona–inmueble

Faltan la fuente autorizada, esquema o contrato institucional, identificador estable de persona, relación verificable con cada inmueble, vigencia, reglas de nombre exacto/homonimia, permisos, límites y paginación de la fuente.

Contratos existentes a revisar para una integración futura: PersonSearch, CadastreAdapter.findPerson, ParcelRecord, ParcelRef y respuesta `GET /api/search`. Se reutilizará la presentación actual si esos datos pueden representarse sin pérdida; cualquier ampliación de identidad requerirá un contrato aprobado.

Tablas institucionales: no se proporcionaron nombres ni estructuras. No se presume ninguna tabla, columna o relación de MariaDB/PostgreSQL, ni se prepararon consultas sobre ellas. El domicilio del inmueble ya mostrado procede del `address` actual y no se confunde con el domicilio opcional de la persona.

## Estado

**LISTO PARA VALIDACIÓN**, limitado al alcance visual solicitado. La integración institucional y la integración con MariaDB permanecen pendientes de definiciones y autorización expresa.
