# Territorio Paysandú v1.3.0

Plataforma territorial con Next.js, React, TypeScript y backend Node.js. La entrega
V1.3 utiliza MariaDB, un proxy HTTPS y almacenamiento de imágenes/documentos de solo
lectura. El tag Git de versión es `v1.3.0` y la imagen es `territorio-paysandu:1.3.0`.

La ficha territorial contiene Datos catastrales, Imágenes, Contactos y Consultas.
Expedientes es un módulo independiente del sidebar: Colaborador y Administrador
pueden buscar por localidad y padrón, descargar el DOCX original, visualizar PDF y
exportarlo. Atención al público no tiene acceso, tampoco mediante las APIs.

## Instalación y operación

Consultar [la guía V1.3](deploy/RELEASE-V1.3.md) para cargar el TAR, configurar el
servicio, verificar su funcionamiento y revertir una actualización. La imagen final
se identifica por commit, tag y checksum en el paquete de entrega.

- [Infraestructura, MariaDB, TLS y proxy](deploy/INFRAESTRUCTURA.md).
- [Configuración privada de ejemplo](deploy/runtime.env.example).
- [Imágenes y proveedores de almacenamiento](deploy/IMAGES.md).
- [Expedientes, contrato de nombres y controles DOCX/PDF](deploy/EXPEDIENTES.md).

El `.env` institucional debe completarse externamente con datos aprobados. No guardar
credenciales en Git, `NEXT_PUBLIC_*` ni en imágenes Docker. Los mounts institucionales
son de solo lectura; la carpeta documental y sus archivos reales los publica
infraestructura. La aplicación no crea, modifica ni elimina esos originales.

## Desarrollo y validación

Docker fija Node.js 26 por digest y `npm ci` respeta `package-lock.json`. Instalar una
versión local de Node compatible con las dependencias o utilizar el build Docker.
Desde la raíz:

```sh
npm ci
npm run typecheck
npm run test:isolated
npm run build
```

La compilación no necesita credenciales ni acceso a bases. `npm run dev` inicia
Next localmente o reutiliza el launcher MariaDB si existe su configuración privada
explícita. `npm run dev:mariadb` utiliza las plantillas de
`Backend/server/mariadb`, `Backend/server/institutional` y, si corresponde,
`Backend/server/sftp-images`. Mantener TLS, permisos mínimos y destinos de prueba
aprobados; no usar bases o cuentas institucionales para pruebas destructivas.

`npm run test:isolated` ejecuta regresiones automatizadas. `npm run test:admin:mariadb`
requiere Docker y crea un entorno MariaDB sintético aislado. Los scripts de chequeo
`consultations:check` e `images:check` usan las conexiones configuradas: confirmar el
destino antes de ejecutarlos. Las pruebas de conversión real deben correr en Linux
Docker; el servidor de desarrollo directo sobre Windows no incorpora LibreOffice.

## Estructura y mantenimiento

- `Frontend/src`: interfaz, navegación y entradas API Next.js.
- `Backend/domain`, `shared`: contratos y permisos compartidos.
- `Backend/server`: autenticación, administración, consultas, imágenes y expedientes.
- `tests`: regresiones mantenibles; `scripts`: comandos operativos y de desarrollo.
- `deploy`: configuración externa, documentación y migraciones versionadas.

No ejecutar migraciones automáticamente al iniciar ni modificar sus identificadores
históricos. Revisar los procedimientos de instalación/recuperación de cada migración
antes de aplicarla. El contenedor se ejecuta sin root, con límites de recursos y raíz
de solo lectura. Conservar autenticación, autorización backend, controles de rutas,
TLS y límites de concurrencia al introducir cambios.

No versionar `.env` privados, caches, `node_modules`, `.next`, logs, capturas, dumps,
artefactos temporales ni TAR de entrega. Las pruebas sintéticas no acreditan acceso
al servidor institucional; la instalación real requiere su propia verificación.
