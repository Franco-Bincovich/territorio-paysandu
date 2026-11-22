# Territorio Paysandú V2 — operación institucional

La entrega es una imagen Linux con frontend, backend y seguridad standalone. Se
ejecuta un contenedor de aplicación, sin Redis. MariaDB propia, MariaDB institucional,
imágenes y proxy HTTPS son sistemas externos existentes. Infraestructura recibe la
imagen validada; no necesita compilar ni instalar herramientas de desarrollo.

## Empaquetar después de la confirmación del equipo

En Linux o en una terminal POSIX con Docker, usar un clon limpio. `RELEASE_SHA`
es el SHA completo de `origin/V2` confirmado en el informe de entrega. El
comando de comprobación detiene el proceso si esa revisión ya no es la punta de `V2`.

```sh
set -eu
git clone --branch V2 --single-branch https://github.com/Franco-Bincovich/territorio-paysandu.git territorio-paysandu-v2
cd territorio-paysandu-v2
: "${RELEASE_SHA:?Definir el SHA completo confirmado en el informe de entrega}"
test "$(git rev-parse origin/V2)" = "$RELEASE_SHA"
git checkout --detach "$RELEASE_SHA"
test -z "$(git status --porcelain)"
SHORT_SHA=$(git rev-parse --short=12 HEAD)
APP_IMAGE="territorio-paysandu:v2-$SHORT_SHA"
ARCHIVE="territorio-paysandu-v2-$SHORT_SHA.tar"
docker build --platform linux/amd64 --build-arg "SOURCE_TREE=$RELEASE_SHA" --tag "$APP_IMAGE" .
docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$APP_IMAGE"
docker save --output "$ARCHIVE" "$APP_IMAGE"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
sha256sum -c "$ARCHIVE.sha256"
```

Antes de transferir el paquete, registrar SHA Git, ID de imagen y checksum.
En el host de destino, verificar el checksum y cargar con
`docker load --input "$ARCHIVE"`. Verificar el ID y la etiqueta de revisión
contra el registro de la entrega. Levantar la imagen con `--no-build`.

Para reproducir QA desde Git, usar `npm ci`, `npm run typecheck`, `npm test` y
`npm run build` con Node 26. Para la integración aislada, disponer de
`mariadb:11.8.9` en Docker y ejecutar `npm run test:audit:integration`. El
runner crea un contenedor descartable con un puerto de loopback.

## Configuración externa y arranque

Copiar `runtime.env.example` fuera del repositorio, con permisos restringidos, y
completar ambos endpoints MariaDB. La base propia debe ser `auxiliares`; la cuenta
institucional debe ser exclusivamente SELECT, sin rol heredado no verificado ni
permisos de escritura. Conservar los privilegios aprobados del modelo propio y su
esquema existente `FB_SECURITY_STANDALONE_V1`, con `auth:global` y `auth:hour`.
El contenedor no instala ni migra SQL automáticamente.

Completar `AUTH_PROVIDER=mariadb`, `MARIADB_ENABLED=true`,
`INSTITUTIONAL_ENABLED=true`, `SECURITY_RATE_LIMIT_PROVIDER=standalone`, el origen
HTTPS definitivo y `SECURITY_PROXY_SECRET` de 32–256 caracteres imprimibles.
Activar `CONSULTATIONS_WRITE_ENABLED` según la autorización de entrega existente.
Las dos conexiones usan TLS con verificación. Si requieren CA privadas, montar
certificados **públicos** y definir `MARIADB_TLS_CA_FILE` y
`INSTITUTIONAL_TLS_CA_FILE` bajo `/run/territorio-ca/`.

Para Expedientes, conservar el proveedor y aplicar el overlay documental solo
cuando el directorio autorizado esté disponible. Ver [Expedientes](EXPEDIENTES.md)
y [configuración de Nginx de ejemplo](nginx.conf.example).

Con `APP_IMAGE` exportada y `RUNTIME_ENV_FILE` apuntando al archivo externo aprobado,
validar con `docker compose -f compose.yaml config --quiet`. En la ventana autorizada,
recrear con `docker compose -f compose.yaml up -d --no-build` y comprobar el estado con
`docker compose -f compose.yaml ps`. Agregar los mismos overlays aprobados a cada comando.

Confirmar las dos rutas físicas del host de Docker: las rutas del chroot SFTP no
determinan las rutas reales. Verificar lectura y búsqueda con UID/GID 1001:1001,
ACL, SELinux, user namespaces y submontajes. No usar root como solución. El dataset
debe ser confiable y publicarse sin archivos parciales. Consultar `IMAGES.md` para
los controles de symlinks, submontajes, tamaños y límites.

```sh
export APP_IMAGE="territorio-paysandu:v2-$SHORT_SHA"
export RUNTIME_ENV_FILE=/RUTA_PRIVADA/runtime.env
export TLS_CA_DIRECTORY=/RUTA_REAL/ca-publicas
export IMAGES_SURVEY_HOST_DIRECTORY=/RUTA_REAL/ACTUALES
export IMAGES_HISTORICAL_HOST_DIRECTORY=/RUTA_REAL/HISTORICAS
sh deploy/run-images.sh filesystem
```

Ese script prepara un `docker run` completo, con loopback 3000, UID 1001, raíz y
bind mounts readonly, tmpfs, una CPU, 1 GiB, 128 pids, capacidades retiradas,
no-new-privileges, rotación de logs y parada de 30 s. Una imagen; no requiere Compose.
La configuración inicial recomienda un lector, seis peticiones de imágenes activas,
cola de 40 y espera máxima de 10 s. Dimensionar con el disco y tamaños reales.

Para SFTP, completar su configuración externa y pin verificado; usar contraseña o
clave privada, nunca ambas. Con la misma imagen ejecutar `sh deploy/run-images.sh sftp`.
No hay fallback automático. Cambiar variables o montajes requiere recrear el contenedor;
`docker restart` conserva su configuración anterior.

## Auditoría y secuencia de publicación

1. Mantener `PLATFORM_AUDIT_ENABLED=false` en el archivo privado del despliegue inicial.
   En `auxiliares` ya se aplicó `002`. Consultar la
   [verificación de solo lectura](auditoria-transversal-verificacion.sql).
   El [ALTER](../Backend/server/mariadb/migrations/002-platform-audit.sql) se conserva
   para reproducir el esquema en QA o preparar otro entorno autorizado.
   La aplicación necesita `SELECT` e `INSERT` en `TP_ADMIN_AUDIT_V1`.
2. Confirmar la fila de configuración de permisos si se usa la matriz editable.
   Su [SQL de instalación](../Backend/server/mariadb/migrations/001-module-access.sql)
   se ejecuta manualmente donde corresponda y con autorización.
3. Publicar el backend compatible con auditoría transversal apagada. Validar el
   listado administrativo y confirmar que todos sus lectores usan el filtro
   `ADMIN_VISIBLE` antes de autorizar el cambio de la bandera.
4. Con autorización, recrear el servicio con `PLATFORM_AUDIT_ENABLED=true`.
   Verificar el registro con actividad normal y las consultas de solo lectura.
5. Para revertir, recrear el servicio con la bandera apagada y el lector
   compatible con el filtro. Conservar el esquema ampliado y todas las filas.
   Una imagen que pagina toda la tabla queda fuera de la reversión después
   de que existan eventos transversales.

## HTTPS y acceso

El proxy HTTPS existente es el único punto de entrada. La aplicación publica
`127.0.0.1:3000` y exige el origen configurado. El proxy debe quitar los encabezados
de cliente no confiables e insertar `x-tp-client-ip` y `x-tp-proxy-token` con el
secreto configurado, además de conservar Host/esquema según la configuración aprobada.
No exponer 3000 directamente ni publicar los directorios de imágenes como archivos
estáticos. No registrar cuerpos de login, cookies, búsquedas personales o secretos.

## Comprobación inicial sin mostrar secretos

```sh
sh deploy/diagnose.sh territorio-paysandu
```

Muestra usuario, readonly, límites, healthcheck y destino/lectura de mounts; comprueba
permisos de carpetas y conectividad TCP de ambas DB. TCP no prueba autenticación,
TLS ni permisos SELECT. Una llamada interna sin sesión debe devolver 401 después
del guard standalone de la base propia. No muestra variables, rutas de origen,
credenciales ni nombres de archivos. No hace login ni escribe sesiones o depósitos
persistentes; esa llamada consume una petición de las cuotas API en memoria.
Para verificar TLS/SELECT institucional se requiere el preflight autorizado o el
visor con usuario válido. Una configuración SFTP presente tampoco demuestra acceso SSH.

Después, desde el navegador HTTPS: login/cambio obligatorio si corresponde, búsqueda,
ficha e información relevada, imágenes, registro/edición/historial de una consulta
de prueba autorizada y logout. No crear datos QA institucionales sin autorización.
El healthcheck HTTP certifica el proceso; no acredita que el índice ya terminó ni
que las DB o imágenes estén disponibles. Revisar los eventos sanitizados del índice.

## Detener, reiniciar, actualizar y recuperar

`docker stop --time 30 territorio-paysandu` detiene la aplicación;
`docker start territorio-paysandu` la inicia con la misma configuración;
`docker restart --time 30 territorio-paysandu` reinicia sin cambiarla. Confirmar
healthcheck y diagnóstico después. El índice se reconstruye; la caché por ficha
es efímera. La protección global de login reside en MariaDB y sobrevive al reinicio.

Para actualizar: aprobar la nueva versión, verificar checksum/ID, conservar la imagen
anterior y la configuración externa, programar una ventana para detener y recrear
el único contenedor con el comando aprobado, y ejecutar nuevamente diagnóstico y
QA autorizado. Para una reversión con eventos transversales, aplicar el procedimiento de auditoría de esta guía.
No mantener dos instancias activas: standalone posee un bloqueo exclusivo en MariaDB
y la segunda instancia debe fallar cerrada. La recuperación ante una caída abrupta
puede requerir esperar que MariaDB libere la conexión y su bloqueo; no se garantiza HA.

Backups bajo responsabilidad de los sistemas externos: MariaDB propia con auditoría,
sesiones, idempotencia y tabla standalone; dataset de imágenes; configuración privada
y certificados según política institucional. Conservar consistencia de restauración
y no restaurar selectivamente presupuestos de seguridad a un estado menos restrictivo
durante un incidente. No copiar secretos a Git, al `.tar` ni a carpetas de evidencia.
La base institucional de lectura se respalda por su administrador, no por este contenedor.
