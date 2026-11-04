# QA independiente local — G0/G1/G2

Revisor: agente `qa_independent`, distinto de los autores frontend/backend. Fecha: 2026-11-04. Alcance: revisión de código UI/API y navegación real sin configuración cloud. No es aceptación institucional ni cierre de gate.

## Prueba de navegador real

Comando: `node tests/qa/unconfigured-browser.mjs` contra `http://127.0.0.1:3000`, Playwright Chromium headless. Ejecutado con permiso de red loopback fuera del sandbox, porque el sandbox deniega sockets. Sin interceptaciones ni mocks.

Resultado PASS:

- API de sesión real devuelve 503 CONFIGURATION y Cache-Control no-store.
- Login muestra el mensaje de entorno no configurado.
- Enviar identidad sintética no desbloquea la navegación de negocio.
- No hubo excepciones de página.
- Login de 390×844 no tiene desbordamiento horizontal.

Esto acredita cierre seguro ante configuración ausente. **No acredita login, contraseña, RLS cloud ni persistencia real.**

Prueba separada con fixtures de sesión interceptadas: `node tests/qa/session-ui-fixture.mjs` PASS. Verifica que el cambio obligatorio no muestra navegación de negocio y que un 401 del historial elimina la UI autenticada. La primera corrida falló por un selector de prueba que ignoraba el icono del nombre accesible; se corrigió el selector, sin alterar la aplicación para satisfacer el test. Esta prueba no acredita autenticación real.

## Hallazgos y correcciones solicitadas

1. Reloj de inactividad cliente arrancaba al montar la página, no al ingresar: una pantalla de login abierta por más de una hora podía cerrar una sesión nueva. Autor frontend corrigió `loadSession` para resetear actividad; verificado por lectura.
2. Selector de ficha usaba roles tab sin interacción de teclado correspondiente. Autor cambió a botones aria-pressed y regiones; verificado por lectura.
3. Contrato del dominio permite superficies null; UI llamaba toLocaleString sobre null. Autor amplió tipos y usa `value == null`; verificado por lectura. La corrida con datos null corresponde a prueba de componente con red interceptada, separada del flujo real.

## Evidencia visual revisada

Inspección independiente de `ui-parcel.png`, generada por frontend con fixtures sintéticas: identificación visible de datos de prueba, superficies separadas, tasa deshabilitada, ausencia de imagen explícita, contacto desplegable y navegación sin dashboard/admin. No se observa corte del contenido en la captura desktop. No se considera evidencia de conexión institucional ni equivalencia pixel a pixel con el prototipo.

También se inspeccionó `ui-mobile-history.png`: navegación y filtros caben en ancho móvil; la tabla usa desplazamiento horizontal interno para las columnas restantes. No se observa desbordamiento de la página completa. Las capturas contienen fixtures, no datos institucionales.

## Pendientes que impiden aprobar gates o v1

- Supabase Auth real, refresh, login con Paysandu, primer cambio, contraseña anterior inválida y revocación de sesiones no probados.
- Limiter de la API no protege por sí solo el endpoint directo de Supabase Auth; configurar y verificar controles nativos antes del piloto.
- SQL y API necesitan integración sobre un proyecto aislado de origen confirmado y configuración segura. QA SQL local independiente se documenta aparte.
- El adaptador actual de imágenes devuelve ausencia. El módulo portable de selección histórica y caducidad URL ya está implementado; revisión independiente de código y sus nueve tests PASS. Falta conectar estas reglas al adaptador institucional y verificar la interpretación de la ventana temporal en G3. No contar el servicio real como completo.
- Conectividad y permisos institucionales, backup/restore, UAT y GO siguen pendientes.
- No se ha auditado automáticamente el árbol de accesibilidad completo ni probado navegadores institucionales.

Conclusión: mejora local comprobada y falla cerrada comprobada. G1/G2 no aprobados como completos; v1.0 no liberada.

## Revisión adicional de imágenes

`node --import tsx tests/images/selection.test.ts`: 9/9 PASS. Revisión de módulo: valida fechas canónicas, ventana de diez años, cronología, IDs únicos, desempate estable, fuente Google Earth y fecha anterior estricta; fallback dentro de ventana explícito, sin afirmar anterioridad desconocida. Caducidad igual al instante actual ya no es válida; URL exige HTTPS sin credenciales. Esta función no prueba disponibilidad del servicio ni autorización de host.

`node tests/qa/image-viewer-fixture.mjs`: PASS con imágenes SVG y respuestas exclusivamente sintéticas interceptadas. Verificados zoom al 125%, cambio de imagen y reset al 100%, Escape y retorno de foco, ocultación de metadatos históricos aunque el payload los contenga, metadatos del relevamiento visibles y tres superficies null sin error. Cero excepciones de página. No hay imágenes institucionales ni petición externa real en esa prueba.

## Segunda ronda independiente: trazabilidad y formularios

Auditadas 99 fichas V1.0 únicas con cuerpos y criterios actuales de Notion; matriz `docs/traceability-v1.{json,md}` conserva baseline, cambios y bloqueos. Se revisaron siete resúmenes históricos; ninguno contiene el original íntegro, por lo que no se validan hashes/versiones originales.

`tests/qa/catalogue.test.ts`: tres pruebas PASS de exactitud nombre/documento, localidades, identidad compuesta/ceros y modo fail closed. No acredita homónimos con identificadores distintos ni catálogo institucional.

`node tests/qa/history-navigation-fixture.mjs`: PASS filtros combinados/página al volver de detalle, vacío/error de búsqueda personal y retorno al historial del padrón. No se comprobó restauración exacta del scroll.

`node tests/qa/form-contacts-fixture.mjs`: PASS en Chromium loopback3001, cero pageErrors. Titular ordenado primero, cards por teclado, múltiples medios y ausencias; envío inválido bloquea red, seis errores requeridos con resumen enfocado/enlaces y aria-invalid, quitar correo2 elimina enlace obsoleto, payload conserva dos teléfonos/correos, error remoto conserva formulario y enfoca resumen. Primer intento corrigió una expectativa del test (seis campos vacíos, no siete: catálogos tienen valores iniciales válidos); aplicación sin modificaciones de QA. Son respuestas interceptadas sintéticas, no persistencia/Auth real.

Revisión cruzada de OpenAPI, logs, caché, RequestScope, arquitectura/amenazas, inventario y scanner: límites documentados. Se corrigieron por sus autores descripción HMAC→SHA256 y scanner que ahora falla ante archivo ilegible y distingue binarios. Scanner heurístico no acredita ausencia exhaustiva de secretos; inventario no es SBOM certificado. Logs locales no prueban alertas remotas. Cancelación UI no garantiza rollback servidor. No se aprueban G1/G2 completos ni liberación.
