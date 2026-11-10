# Territorio Paysandú V1.0: operación institucional

La entrega es una imagen Linux con frontend, backend y seguridad standalone. Se
ejecuta un contenedor de aplicación, sin Redis. MariaDB propia, MariaDB institucional,
imágenes y proxy HTTPS son sistemas externos existentes. Infraestructura recibe la
imagen validada; no necesita compilar ni instalar herramientas de desarrollo.

## Cargar y comprobar la entrega

1. Verificar el SHA-256 del archivo `.tar` contra `SHA256SUMS.txt` recibido por el
   canal de entrega aprobado: `sha256sum -c SHA256SUMS.txt`.
2. Cargar esa imagen con `docker load -i territorio-paysandu-v1.0.tar`.
3. Comparar `docker image inspect territorio-paysandu:v1.0-candidato --format '{{.Id}}'`
   con el identificador registrado en `release.json`. Usar esa misma imagen;
   recompilar produciría otro artefacto que requiere validación.
4. La revisión candidata se identifica por el árbol Git staged y el manifiesto de
   fuentes. El SHA base de HEAD no es el SHA de un commit nuevo. Después de autorizar
   commit/push, hay que repetir la validación desde el commit remoto de `Docker`.

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

Confirmar las dos rutas físicas del host de Docker: las rutas del chroot SFTP no
determinan las rutas reales. Verificar lectura y búsqueda con UID/GID 1001:1001,
ACL, SELinux, user namespaces y submontajes. No usar root como solución. El dataset
debe ser confiable y publicarse sin archivos parciales. Consultar `IMAGES.md` para
los controles de symlinks, submontajes, tamaños y límites.

```sh
export APP_IMAGE=territorio-paysandu:v1.0-candidato
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
QA autorizado. Volver a la imagen/configuración anterior si no supera las comprobaciones.
No mantener dos instancias activas: standalone posee un bloqueo exclusivo en MariaDB
y la segunda instancia debe fallar cerrada. La recuperación ante una caída abrupta
puede requerir esperar que MariaDB libere la conexión y su bloqueo; no se garantiza HA.

Backups bajo responsabilidad de los sistemas externos: MariaDB propia con auditoría,
sesiones, idempotencia y tabla standalone; dataset de imágenes; configuración privada
y certificados según política institucional. Conservar consistencia de restauración
y no restaurar selectivamente presupuestos de seguridad a un estado menos restrictivo
durante un incidente. No copiar secretos a Git, al `.tar` ni a carpetas de evidencia.
La base institucional de lectura se respalda por su administrador, no por este contenedor.
