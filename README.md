# Territorio Paysandú

Una aplicación Next.js: interfaz en `Frontend/src/app/page.tsx` y API Node en
`Frontend/src/app/api/[...path]/route.ts`, que delega a `Backend/server/auth-dispatch.ts`.
`Backend/domain` contiene contratos compartidos; `Backend/server` contiene los
adaptadores. Las rutas de imágenes tienen su entrada en `api/parcel-image/[kind]`.

## Construcción y ejecución

Docker fija Node.js 26.13.0. El desarrollo local se verificó con Node.js 24.14.0;
las dependencias directas están fijadas en el lockfile para Windows y Linux.
Para construir o ejecutar fuera de Docker, instalar una versión Node compatible
con esas dependencias y usar npm ci. Desde la raíz:

```powershell
npm ci
npm run build
npm run typecheck
npm start
```

Next genera `Frontend/next-env.d.ts` y sus declaraciones de rutas. No se versionan.
La compilación no necesita credenciales ni acceso a bases. `next.config.ts` produce
el paquete standalone. Dockerfile construye esa misma aplicación como usuario
sin privilegios. `compose.yaml` obtiene variables de un archivo privado externo
mediante RUNTIME_ENV_FILE y publica solo en loopback; requiere proxy HTTPS externo.
No ejecutar Compose ni desplegar sin revisar la configuración de infraestructura.
La imagen oficial Node 26 está fijada por digest en Dockerfile; npm ci usa el lockfile.
Los binarios nativos se instalan dentro de Linux, sin reutilizar node_modules de Windows.
La compilación Docker acota el heap Node a 768 MiB, un worker de Next y dos hilos
Rayon para evitar sobredimensionar por las CPU visibles del host. Esas variables
se aplican solo al build, sin propagarse a la imagen de ejecución.

## Configuración sin secretos

Las plantillas `.env.example` enumeran las variables, sin credenciales. Todos los
archivos privados .env y certificados se mantienen fuera de Git y de la imagen.
Nunca usar NEXT_PUBLIC_ para credenciales. En ejecución definitiva, inyectar las
variables desde el administrador de secretos de la infraestructura.

El proveedor predeterminado continúa siendo Supabase. Su plantilla está en
`Frontend/.env.example`; conservar la configuración autorizada existente.

El modo local `mariadb-test` conserva sus restricciones. El modo de entrega utiliza
AUTH_PROVIDER=mariadb, NODE_ENV=production y MARIADB_ENABLED=true; exige un origen
HTTPS fijo, TLS validado para ambas bases y un flag independiente de escritura.
No se activa por disponer de credenciales. La plantilla de entrega mantiene
MARIADB_ENABLED, INSTITUTIONAL_ENABLED y CONSULTATIONS_WRITE_ENABLED desactivados.

Para ejecutar el entorno MariaDB local ya autorizado:

1. Completar `Backend/server/mariadb/.env.local` y
   `Backend/server/institutional/.env.local` a partir de sus plantillas.
2. Mantener TLS y validación de certificados. Configurar AUTH_PROVIDER=mariadb-test,
   MARIADB_AUTH_TEST_ENABLED=true, INSTITUTIONAL_ENABLED=true y
   APP_ORIGIN=http://127.0.0.1:3105. La conexión institucional es exclusivamente SELECT.
3. Ejecutar `npm run consultations:check`: solo lectura, comprueba esquema 7.1 y TLS.
4. Habilitar CONSULTATIONS_WRITE_ENABLED=true únicamente después de aprobar la
   prueba de escritura y el chequeo. Reiniciar con `npm run dev:mariadb`.

El launcher carga los archivos privados indicados y, si existe,
`Backend/server/sftp-images/.env.local`, mediante
una lista de variables permitidas, sin propagar --env-file a NODE_OPTIONS.
No cambiar las credenciales ni generar usuarios automáticamente al iniciar.

## Docker institucional

La imagen no incluye certificados, secretos, SQL, herramientas, tests ni datos de
bases. Solo contiene el standalone de Next, sus dependencias trazadas, assets de
compilación y el logo de interfaz. Las imágenes institucionales se leen por SFTP
desde el backend cuando se configura explícitamente el proveedor siguiente.

Copiar `deploy/runtime.env.example` a una ubicación privada EXTERNA al repositorio.
Completar sus variables con la configuración autorizada: host/puerto/base/usuario/
contraseña independientes para auxiliares y la base institucional; los tres flags
solo se habilitan al aprobar la configuración. El usuario institucional debe tener
SELECT sin privilegios de escritura ni roles heredados; se comprueba por conexión.
APP_ORIGIN debe ser el origen HTTPS exacto de acceso, sin rutas ni credenciales.
Para CA privada, usar rutas Linux dentro del contenedor, por ejemplo
/run/territorio-ca/auxiliares-ca.pem. El directorio montado debe contener solo CA
públicas; no claves privadas. No se cargan los archivos .env.local del desarrollo.

Desde PowerShell, una vez autorizado el arranque con la configuración real:

```powershell
$env:RUNTIME_ENV_FILE='C:\config-privada\territorio-runtime.env'
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail 50 app
```

Si se necesita CA privada, definir además TLS_CA_DIRECTORY con la ruta al directorio
de CA y agregar `-f compose.yaml -f compose.tls.yaml` a cada comando compose.
No ejecutar `docker compose config` sin --quiet: puede imprimir valores privados.
El env_file usa format: raw: escribir valores literales, sin comillas de dotenv
salvo que las comillas formen parte real del valor. Se preservan $ y #.

El contenedor escucha HTTP solo en 127.0.0.1:3000. El proxy HTTPS del host debe
reenviar Host sin alterarlo, sobrescribir X-Forwarded-Proto=https y descartar
encabezados de forwarding aportados por el cliente. Usar el navegador sobre el
APP_ORIGIN HTTPS configurado: las cookies Secure no funcionan accediendo al puerto
HTTP directamente. No publicar el backend sin ese proxy. El healthcheck de `/`
es de vida; la disponibilidad del esquema se valida al acceder a Consultas.
El login combina intentos por cuenta y cuotas Redis; antes de exposición pública
el proxy debe añadir límites globales/origen, buffering y timeouts. Este paquete
no instala ni publica ese proxy.

La red debe resolver ambos hosts MariaDB y permitir salida a sus puertos TLS
(normalmente 3306). VPN, rutas de Windows y túneles de DBeaver no se trasladan
automáticamente al contenedor. Los nombres deben coincidir con los certificados.
La cuenta de auxiliares necesita SELECT/INSERT/UPDATE y visibilidad de las
definiciones de triggers para el guard de esquema. En MariaDB 11.8 esto requiere
TRIGGER; no es un permiso puramente de lectura. Debe revisarlo el DBA, sin otorgarlo
automáticamente a cuentas compartidas. Sin él, Consultas responde 503 y no escribe.
Referencia: [metadatos de triggers de MariaDB](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-triggers-table).
Las bases existentes mantienen la persistencia y los respaldos; Compose no crea
servicios de base de datos. Solo /tmp y caché efímera son escribibles (tmpfs).
Se ejecuta con UID 1001, filesystem de solo lectura, sin capabilities y con
no-new-privileges. El reinicio es unless-stopped; la parada concede 30 segundos.
El archivo compose no introduce redes o volúmenes persistentes para datos de negocio.

## Controles de seguridad V1.0

Producción requiere un **Redis externo**, con credencial de servicio y TLS validado.
No se crea un contenedor Redis de producción ni se reutilizan tablas MariaDB para
cuotas. Completar `SECURITY_REDIS_HOST`, `SECURITY_REDIS_PORT` (6380 por defecto),
`SECURITY_REDIS_USER`, `SECURITY_REDIS_PASSWORD`, `SECURITY_REDIS_TLS=true` y, si
corresponde, `SECURITY_REDIS_CA_FILE` en el archivo privado externo. La plantilla
adicional es `Backend/server/security/.env.example`. Para desarrollo, el launcher
lee opcionalmente `Backend/server/security/.env.local` mediante allowlist.
Sin Redis configurado, solo desarrollo usa memoria local; producción nunca hace
ese fallback. Redis ausente, sin identidad válida o caído produce 503 sanitizado.

El proxy del mismo host debe **sobrescribir**, nunca conservar del cliente,
`X-TP-Client-IP` con una IP canónica y `X-TP-Proxy-Token` con el valor privado de
`SECURITY_PROXY_SECRET` (aleatorio de al menos 32 caracteres, máximo 256). Backend
valida esa credencial en tiempo constante. No se confía en X-Forwarded-For ni se
devuelve/registra esa IP. Mantener Host y esquema HTTPS como se describe arriba.
No activar producción sin preparar este contrato en el proxy autorizado.

Las cuotas usan buckets de tokens atómicos con reloj Redis: capacidad inicial
acotada, reposición continua, sin reinicio del cupo al reiniciar la aplicación.
Las claves contienen hashes de identidad, no documentos/username/IP en claro.
Una petición debe cumplir todas las cuotas y recibe 429 con Retry-After si falla.

| Operación | Capacidad / reposición | Control adicional |
| --- | --- | --- |
| Login/cambio de contraseña | Global 30/min y 300/h; origen 10/min | Dos operaciones simultáneas por proceso, sin cola; se conserva 5 intentos/cuenta/15 min en MariaDB |
| API general | Global 600/min y origen 180/min | Doce solicitudes simultáneas por proceso |
| Usuario autenticado | 120/min agregadas | Búsqueda, catálogos, lectura de consultas y otras lecturas: 60/min y 300/h por categoría |
| Escrituras de Consultas | 10/min y 60/h por usuario | También consumen cuota los rechazos; autorización y transacciones se conservan |
| Descarga de imágenes | 20/min y 100/h por usuario | Presupuesto 200 MiB/h: se reservan conservadoramente 20 MiB por intento antes de SFTP, sin reembolso por error |

Son capacidades de ráfaga y tasas de reposición, no ventanas fijas. Los límites
son iniciales y conservadores: cualquier ajuste debe revisarse y medirse en QA.
El logout conserva una ruta de revocación si Redis cae, con 120 solicitudes/min
y concurrencia acotada localmente; sigue validando Origin/Host e identidad de proxy.
No existe flag para desactivar estas protecciones en producción.

Infraestructura debe provisionar Redis dedicado por entorno, ACL sobre
`~tp:security:*` y comandos `EVAL`, `TIME`, `HMGET`, `HSET`, `PEXPIRE` y los comandos
de handshake del cliente (`AUTH`/`HELLO`, `CLIENT SETINFO`/`SETNAME` según versión).
No conceder administración, FLUSHALL/FLUSHDB, CONFIG ni acceso a otros espacios.
Requiere persistencia AOF/recuperación aprobada, `maxmemory-policy noeviction`,
capacidad y monitorización; un Redis vacío permite la ráfaga inicial nuevamente.
Una cuenta/Redis independiente de MariaDB y SFTP conserva la separación.
No se ejecutó esta provisión sobre servicios institucionales.

Compose fija 1 CPU, 1 GiB y 128 procesos por contenedor, además del usuario 1001,
filesystem de solo lectura y restricciones anteriores. Son valores de partida;
deben ajustarse tras medición aislada. El healthcheck de `/` sigue siendo de vida:
no demuestra disponibilidad de Redis/DB ni habilita automáticamente tráfico.

El historial de detalle usa `historyPageSize` (20 por defecto, máximo 50) y cursor
`historyBefore` por versión descendente; `historyPagination.nextBeforeVersion`
indica la siguiente página. La UI permite «Ver versiones anteriores» sin descargar
todo el historial de una vez. No se borra ni modifica ningún snapshot en DB; la API
proyecta campos de negocio y omite referencias/flags internos. Parámetros extra
o duplicados se rechazan con 400. Las mutaciones no aceptan query parameters.

Todas las rutas MariaDB, heredadas y de imágenes emiten telemetría HTTP con ID
aleatorio generado en servidor, plantilla de ruta, estado y duración; nunca URL
completa, parámetros, cuerpo, cookie, credenciales, documentos ni IP. La retención,
acceso, alertas y recolección de estos eventos requieren configuración operativa.

La CSP se aplica con nonce aleatorio por documento y render dinámico de Next.
Scripts sin nonce se bloquean; producción no permite unsafe-eval ni unsafe-inline
en scripts. Conexiones de frontend solo al mismo origen, imágenes same-origin y
blobs; atributos de estilo inline se permiten explícitamente para conservar el
visor/zoom existente. WebSocket/eval solo se habilitan en desarrollo para HMR.
La CSP no sustituye HTTPS, autorización ni validación de parámetros.

Con variables de entrega ya inyectadas en un entorno Node autorizado, el comando
`npm run consultations:check` también valida el modo producción sin depender de
.env.local. Es una herramienta del repositorio, no una dependencia de la imagen.

## Esquema y recuperación

La aplicación requiere una base `auxiliares` previamente provisionada, con modelo
de Consultas 7.1. `Backend/server/consultations/schema-7.1.json` es el contrato de
metadatos que usa la API para rechazar esquemas incompatibles; es imprescindible.
Los SQL operativos se conservan para mantenimiento manual, no se ejecutan al iniciar.

Para una actualización 7.1 expresamente autorizada, únicamente desde el esquema
anterior compatible y con las ocho tablas de negocio vacías: respaldar DDL/triggers,
detener escritores y ejecutar cada paso deteniéndose ante el primer error:

1. `Backend/sql/package-7.1/01-preflight.sql` y revisar resultados.
2. `00-maintenance.sql`: instalar las 24 guardas.
3. `steps/02a-personas.sql`, `02b-consultas.sql`, `02c-indices-consulta.sql`,
   `02d-contactos.sql`, `02e-domicilios.sql`, `02f-vinculos.sql`.
4. `steps/03a-idempotencia.sql`, `03b-revision.sql`.
5. Triggers `10` a `20`, un script completo por vez respetando DELIMITER.
6. `30-verify.sql`, `31-mark-reviewed.sql`, `32-release-maintenance.sql`,
   `33-final-verify.sql`. En 32 validar el bloque inicial antes de ejecutar los DROP.

No repetir esta instalación sobre el modelo 7.1 ya aplicado. DDL hace commits
implícitos: no hay rollback global. Ante interrupción, mantener las guardas y
escritores detenidos; recovery/00-preflight.sql debe confirmar tablas/recibos vacíos.
Retirar solo los once triggers de negocio con recovery/01; ejecutar únicamente los
undo de pasos completados en orden inverso 03b, 03a, 02f…02a; restaurar los once
triggers originales con baseline-triggers-restore.sql; verificar con recovery/98
y retirar guardas solo después de aprobar el bloque inicial de recovery/99.
Si existen datos, detenerse y diseñar restauración/conciliación desde respaldo.
No borrar registros para forzar un estado vacío ni desactivar FOREIGN_KEY_CHECKS.

Los SQL `package-2-validation.sql` y su rollback corresponden al proveedor Supabase
existente; se conservan para mantenimiento autorizado, sin ejecutarlos ni alterar
ese servicio. La creación completa de una base nueva requiere provisión revisada
por el administrador: este repositorio no incluye dumps ni fixtures de bases.

Las pruebas, diagnósticos, informes de trabajo y evidencias permanecen únicamente
en la copia local del equipo de desarrollo. No son dependencias de ejecución.

## Imágenes institucionales SFTP

El proveedor es opcional (`IMAGE_PROVIDER=sftp`) y exige sesión autenticada y
usuario habilitado mediante el circuito MariaDB existente. No cambia el proveedor
de autenticación predeterminado. El backend resuelve el PadCod contra
AGM_CIU_PADRONES mediante SELECT parametrizado antes de buscar archivos: el número
del nombre del archivo corresponde al padrón, no al PadCod.

Para pruebas locales, completar `Backend/server/sftp-images/.env.local` usando
`.env.example` de esa carpeta. El archivo privado está ignorado por Git y Docker.
Configurar host, puerto 22, usuario exclusivo `sftp-lectura`, contraseña y huella
SHA-256 de la clave ED25519. Confirmar la huella con infraestructura por un canal
independiente antes de establecer `SFTP_IMAGES_HOST_KEY_VERIFIED=true` y
`SFTP_IMAGES_ENABLED=true`. Una huella observada en una primera conexión no basta.
El lector compara estrictamente la clave presentada con la huella configurada;
no acepta automáticamente claves nuevas ni utiliza el agente SSH o sftp-admin.

```powershell
npm run images:check -- --config-only
npm run images:check
npm run dev:mariadb
```

El primer comando informa únicamente presencia de configuración, sin valores.
El segundo autentica y lista ambos directorios, sin descargar ni escribir archivos;
no prueba permisos de escritura. Reiniciar Next después de cambiar configuración.
En Docker, inyectar las mismas variables en el archivo privado externo de Compose;
no copiar `.env.local` ni contraseñas a la imagen. Permitir salida TCP 22 hacia
el servidor desde el contenedor; las rutas/VPN del host no garantizan esa salida.

En `/Satelitales`, la convención confirmada es
`AÑO_LOCALIDAD_PADRON[_SUFIJO].png`. Se compara exactamente localidad y padrón
institucionales, sin coincidencias parciales. La localidad se convierte a mayúsculas,
sin tildes, con espacios o guiones bajos consecutivos convertidos en un guion bajo;
se admiten localidades compuestas. El padrón conserva sus dígitos originales.
Se prioriza el token ANTES (sin distinguir mayúsculas y delimitado por `_` o `-`),
después el año más antiguo. DESPUES no tiene prioridad especial. Empates de año y
prioridad se resuelven por orden ordinal del nombre en mayúsculas. Nombres que
solo difieren por mayúsculas generan ambigüedad y no se seleccionan.

La convención de relevamiento sigue pendiente de ejemplos reales. Mantener
`SFTP_IMAGES_SURVEY_MAPPING_CONFIRMED=false` y basename vacío. Si `/PDFs` está
vacío se informa ausencia de relevamiento; si contiene archivos sin una convención
aprobada se informa asociación pendiente. No se infieren correspondencias.
La visualización de futuros PDF requiere validar esa convención y su visor.

Los títulos son «Imagen histórica» e «Imagen de relevamiento». Sin archivos:
«Este padrón aún no registra imágenes históricas» y
«Este padrón aún no registra imágenes de relevamiento». El visor consulta
disponibilidad cada 30 segundos mientras está montado y la página visible;
también permite reintentar. No exige reconstruir Docker al cargar nuevos archivos.
La API entrega referencias por PadCod, sin nombres ni rutas internas. Las descargas
usan sesión y no-store; no se guarda material institucional en disco o caché pública.
Errores de ausencia, conexión, autenticación, identidad SSH, permisos y ambigüedad
tienen códigos separados y mensajes sin datos sensibles.

Límites predeterminados: 10 MiB por archivo (máximo configurable 20 MiB), 10 segundos
por operación completa (máximo 15), 10.000 entradas históricas (máximo 100.000),
y tres conexiones simultáneas por proceso. Se rechazan enlaces simbólicos,
salidas del directorio, extensiones o firmas de contenido incompatibles.
