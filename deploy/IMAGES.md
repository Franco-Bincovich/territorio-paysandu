# Imágenes institucionales: filesystem y SFTP

Una misma imagen y un contenedor de aplicación soportan `IMAGE_PROVIDER=filesystem`
o `IMAGE_PROVIDER=sftp`. La configuración pertenece al proceso, nunca al navegador.
No hay fallback automático. Para cambiar variables o montajes hay que recrear el
contenedor con la misma imagen; `docker restart` no modifica su configuración.

## Preparación de infraestructura

1. Confirmar las dos rutas **físicas** del host Docker. Las rutas SFTP
   `/Satelitales/IMAGENES_ACTUALES` y `/Satelitales/IMAGENES_HISTORICAS` pueden
   pertenecer a un chroot. No montar `/Satelitales` completo ni `/PDFs` por inferencia.
2. Copiar `runtime.env.example` fuera del repositorio y completar configuración
   existente de ambas MariaDB, TLS, `APP_ORIGIN` HTTPS y `SECURITY_PROXY_SECRET`.
   Habilitar los flags institucionales/MariaDB según la entrega aprobada y mantener
   las políticas existentes de consultas. El esquema standalone ya revisado debe
   estar instalado; este cambio no instala ni modifica SQL.
3. Verificar lectura de archivos y búsqueda en directorios con UID/GID 1001:1001,
   incluyendo ACL/SELinux y el mapeo de UID si Docker usa user namespaces. No cambiar
   la aplicación a root. Las raíces y sus padres no pueden ser symlinks ni ser
   reemplazables por actores no confiables. Publicar archivos por reemplazo atómico.
4. Montar únicamente carpetas aprobadas, como solo lectura. Verificar `Mounts.RW=false`
   con `docker inspect`. Revisar submontajes: si existen, exigir solo lectura
   recursiva (`bind-recursive=readonly`, kernel Linux >=5.12) o excluirlos si procede.
   El script básico asume que las carpetas no contienen submontajes adicionales.
5. Conservar el proxy HTTPS existente en el mismo host. Solo se publica el puerto
   3000 sobre loopback. El proxy conserva los encabezados confiables de IP y secreto;
   no se entrega un contenedor nuevo de proxy, DB, Redis ni SFTP.

## Ejecución Linux

El script usa `docker run` y exige rutas físicas explícitas. La carpeta de CA debe
contener exclusivamente certificados públicos. Configurar en el archivo privado
`MARIADB_TLS_CA_FILE=/run/territorio-ca/auxiliares-ca.pem` e
`INSTITUTIONAL_TLS_CA_FILE=/run/territorio-ca/institutional-ca.pem` según sus nombres.

```sh
export APP_IMAGE=territorio-paysandu:VERSION_APROBADA
export RUNTIME_ENV_FILE=/RUTA_PRIVADA/runtime.env
export TLS_CA_DIRECTORY=/RUTA_REAL/ca-publicas
export IMAGES_SURVEY_HOST_DIRECTORY=/RUTA_REAL/ACTUALES
export IMAGES_HISTORICAL_HOST_DIRECTORY=/RUTA_REAL/HISTORICAS
sh deploy/run-images.sh filesystem
```

Para SFTP, completar sus variables existentes en el mismo archivo externo:
`SFTP_IMAGES_ENABLED=true`, host/puerto, usuario `sftp-lectura`, pin SHA256 y
`SFTP_IMAGES_HOST_KEY_VERIFIED=true` tras verificación independiente; usar contraseña
**o** clave privada, no ambas. Mantener las dos rutas SFTP originales.

```sh
# Si usa clave, dejar SFTP_IMAGES_PASSWORD sin valor y dar lectura al UID 1001.
# export SFTP_PRIVATE_KEY_HOST_FILE=/RUTA_PRIVADA/clave-sftp
sh deploy/run-images.sh sftp
```

No ejecutar ambos comandos con el mismo nombre simultáneamente. La recreación y
el cambio de proveedor requieren la aprobación operativa habitual. El script no
reemplaza ni elimina un contenedor existente.

## Límites y comportamiento

| Variable | Predeterminado | Rango |
|---|---:|---:|
| `FILESYSTEM_IMAGES_CONCURRENCY` | 4 | 1–6 |
| `IMAGES_HTTP_CONCURRENCY` | 6 | 1–6 |
| `IMAGES_QUEUE_LIMIT` | 40 | 0–100 |
| `IMAGES_QUEUE_TIMEOUT_MS` | 10000 | 100–15000 |
| `FILESYSTEM_IMAGES_TIMEOUT_MS` | 10000 | 500–15000 |
| `FILESYSTEM_IMAGES_MAX_BYTES` | 10485760 | 1024–20971520 |

Son límites de runtime. El archivo de ejemplo recomienda **un lector** para el
perfil de una CPU y 1 GiB: en las pruebas HTTP, uno y cuatro completaron 30/30
solicitudes sin rechazos, con tiempos totales cercanos (3,28 y 3,15 s). Una corrida
por configuración no demuestra una ventaja estable de cuatro. El valor de respaldo
del código, si se omite la variable, es cuatro. Conservar seis peticiones de imágenes
activas y medir con el disco y tamaños reales antes de ajustar. Se mantiene el techo
global de 12 peticiones API y las dos plazas separadas de autenticación. Imágenes
ocupan como máximo seis plazas; si otras consultas ocupan las 12, imágenes esperan.
La cola guarda metadatos, tiene capacidad y tiempo máximos, y elimina esperas
canceladas. Saturación/espera vencida: 503 con `Retry-After`; cuotas agotadas: 429.
Las cuotas globales, de IP, de usuario y la reserva de bytes permanecen vigentes.
La plaza HTTP se conserva hasta consumir/cancelar el cuerpo; la transferencia tiene
un límite adicional de 15 s para que un cliente lento no retenga indefinidamente
los recursos. La cola no garantiza admisión si las cuotas están agotadas. SFTP conserva su
límite de tres operaciones y su política anterior de rechazo; no usa la cola HTTP
filesystem. No se comparten bytes entre usuarios en el servidor; el frontend
deduplica solicitudes pendientes y reutiliza blobs únicamente dentro de cada ficha.

`IMAGES_METRICS=true` emite espera de admisión y ocupación API sin nombres, rutas ni
identidades. Desactivarlo si no se necesita. El índice conserva la renovación de
60 minutos, publicación atómica y último snapshot válido. Puede haber indisponibilidad
histórica inicial mientras termina la primera construcción; el healthcheck HTTP
existente comprueba el proceso, no disponibilidad de imágenes ni permisos del dataset.

## Seguridad y límites operativos

Se usan nombres derivados de PadCod autorizado, padrón y localidad, PNG según el
contrato actual, `lstat`/canonicalización, `O_NOFOLLOW`, descriptor verificado, límites
de bytes, lectura por bloques y cierre en `finally`. Se rechazan symlinks, dispositivos
y FIFOs. Las rutas no se exponen como archivos estáticos; cada descarga mantiene
sesión, autorización institucional y `EN_CATASTRO`.

La aplicación no modifica archivos ni crea índices sobre el dataset. `--read-only`
se complementa con mounts `readonly`; las únicas áreas escribibles son tmpfs de
trabajo de Next. El timeout de lectura cancela entre operaciones asíncronas y no
puede interrumpir una llamada bloqueada dentro del kernel de un filesystem averiado.
Los padres del dataset deben ser estables; canonicalizar no sustituye ese control
frente a carreras originadas por escritores privilegiados del host. La firma PNG
no valida toda la estructura: se conserva además la detección de errores de decode
del visor. No se requieren nuevas dependencias ni cambios del Dockerfile.

El conjunto de build sigue siendo Dockerfile, package*.json, Backend/domain,
Backend/server, Frontend/src/config/public y .dockerignore. Los módulos nuevos deben
incluirse en la entrega; no publicar únicamente el staging anterior. `Docs`, pruebas,
certificados, claves y archivos de imágenes de QA no forman parte de la imagen.
