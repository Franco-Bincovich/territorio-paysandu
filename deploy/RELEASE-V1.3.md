# Territorio Paysandú V1.3 — versión 1.3.0

Código: rama `feat/paysandu-administracion-expedientes`, tag Git `v1.3.0`.
Imagen: `territorio-paysandu:1.3.0`, arquitectura `linux/amd64`.
El README y los metadatos del paquete entregado registran el commit exacto publicado,
el identificador de imagen y el SHA256 del TAR. No usar etiquetas ambiguas como única referencia.

## Requisitos y configuración

Docker Engine compatible con imágenes Linux amd64 y Docker Compose 2.30 o posterior
(se usa `env_file.format: raw`). El servicio se ejecuta como UID/GID1001, con filesystem
de solo lectura, CPU1, memoria1GiB y128 procesos. Dimensionar además MariaDB y Nginx
según la infraestructura; el conversor permite una tarea simultánea por aplicación.

El operador debe preparar un archivo privado externo basado en `runtime.env.example`.
El `.env` institucional definitivo sigue pendiente. No incluirlo en Git ni dentro de la imagen.
Configurar autenticación MariaDB, `APP_ORIGIN`, credenciales/CA TLS y limitación de
solicitudes según `INFRAESTRUCTURA.md`; conservar los controles del proxy de confianza.
Las conexiones `MARIADB_*` e `INSTITUTIONAL_*` son configurables: comprobar destinos,
cuentas de privilegio mínimo, certificados y disponibilidad antes de iniciar.
No ejecutar migraciones ni cambios de usuarios por el mero hecho de actualizar la imagen.

Para imágenes, conservar el proveedor y sus variables existentes según `IMAGES.md`.
Para expedientes, consultar `EXPEDIENTES.md`: `EXPEDIENTES_PROVIDER=filesystem|sftp`
y `EXPEDIENTES_DIRECTORY`. SFTP reutiliza la conexión y usuario del lector de imágenes.
La carpeta institucional esperada es `/Satelitales/EXPEDIENTES_GENERADOS`; infraestructura
debe crearla y publicar los DOCX. La aplicación nunca escribe los originales.

## Carga y arranque

Desde la carpeta de entrega, en Linux:

```sh
sha256sum -c territorio-paysandu-v1.3.0.tar.sha256
docker load --input territorio-paysandu-v1.3.0.tar
export APP_IMAGE=territorio-paysandu:1.3.0
# Definir RUNTIME_ENV_FILE con la ruta real del archivo privado aprobado.
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml up -d --no-build
docker compose -f compose.yaml ps
```

El puerto se publica únicamente en `127.0.0.1:3000`. Nginx institucional debe terminar
HTTPS conforme `nginx.conf.example`; no exponer directamente el puerto3000 a Internet.
La configuración de certificados, dominio y secretos debe aprobarla infraestructura.

Cuando la carpeta local documental exista, definir `EXPEDIENTES_HOST_DIRECTORY` y
añadir `-f compose.expedientes.yaml` en cada comando Compose. Ese overlay monta
`/data/expedientes` como solo lectura y no crea el directorio del host. Antes de que
exista, omitir el overlay: Expedientes mostrará indisponibilidad controlada, sin
impedir el arranque del resto de la plataforma. Para SFTP no aplicar ese montaje.

## Verificación

Comprobar healthcheck, acceso HTTPS, login, administración, consultas e imágenes.
La ficha territorial tiene Datos catastrales, Imágenes, Contactos y Consultas.
Expedientes permanece exclusivamente en el sidebar para Colaborador y Administrador;
Atención al público tampoco puede utilizar sus APIs mediante URL directa.

Buscar por Localidad y Padrón; descargar Word y comparar SHA256 con el original;
visualizar y descargar PDF. LibreOffice convierte dentro del contenedor Linux, con
perfil temporal aislado, controles de recursos y sockets de Internet denegados.
La ejecución directa de desarrollo sobre Windows no proporciona ese conversor.
Las fuentes alternativas y funciones avanzadas de Word pueden afectar paginación;
documentos activos o con vínculos externos no compatibles se rechazan por seguridad.
Verificar también limpieza temporal, logs, límites y reinicio del contenedor.

Para repetir validaciones técnicas desde el checkout, después de `npm ci` y con
Docker disponible (no ejecutarlas sobre contenedores institucionales):

```sh
docker build --platform linux/amd64 --target dependencies --tag territorio-paysandu:expedientes-test-dependencies .
node qa/expedientes-qa-final/linux-tests.cjs territorio-paysandu:expedientes-test-dependencies
node qa/expedientes-qa-final/docker-conversion.cjs territorio-paysandu:1.3.0
node qa/expedientes-qa-final/negative-container.cjs territorio-paysandu:1.3.0
```

La imagen de dependencias se usa únicamente para tests: la imagen standalone de
producción contiene solo los módulos trazados que necesita la aplicación.
La suite Linux comprueba regresiones con dependencias completas; por sí sola no
acredita conversión PDF. Los otros dos comandos usan el runner de producción para
la conversión real y sus controles de fallo.
Estos scripts crean contenedores y archivos sintéticos temporales. Sus directorios
`.runtime` y evidencias generadas están excluidos de Git; no requieren credenciales
institucionales ni modifican la base real.

## Reversión

Conservar la imagen anterior validada y su configuración privada antes de actualizar.
Para revertir, asignar `APP_IMAGE` al tag/digest anterior y ejecutar el mismo comando
`docker compose ... up -d --no-build` con los overlays previamente utilizados.
Comprobar healthcheck, login y lectura. No borrar volúmenes, ejecutar `down -v`,
sobrescribir documentos ni revertir esquemas automáticamente. Si hubo una migración
aprobada por separado, seguir su procedimiento específico de recuperación.

La validación QA utiliza usuarios, MariaDB y documentos ficticios. La configuración
real, los archivos institucionales y la comprobación posterior al despliegue quedan
a cargo del procedimiento de instalación autorizado; esta entrega no despliega en Paysandú.
