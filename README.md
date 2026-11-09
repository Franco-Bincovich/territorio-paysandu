# Territorio Paysandú

Una aplicación Next.js: interfaz en `Frontend/src/app/page.tsx` y API Node en
`Frontend/src/app/api/[...path]/route.ts`, que delega a `Backend/server/auth-dispatch.ts`.
`Backend/domain` contiene contratos compartidos; `Backend/server` contiene los
adaptadores. Las rutas de imágenes tienen su entrada en `api/parcel-image/[kind]`.

## Construcción y ejecución

Docker fija Node.js 26.13.0. El desarrollo local se verificó con Node.js 24.14.0;
las doce dependencias directas coinciden con el lockfile en Windows y Linux.
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

El launcher carga exclusivamente los dos archivos privados indicados, mediante
una lista de variables permitidas, sin propagar --env-file a NODE_OPTIONS.
No cambiar las credenciales ni generar usuarios automáticamente al iniciar.

## Docker institucional

La imagen no incluye certificados, secretos, SQL, herramientas, tests ni datos de
bases. Solo contiene el standalone de Next, sus dependencias trazadas, assets de
compilación y el logo de interfaz. No hay servidor de imágenes catastrales ficticio.
Los puntos institucionales de imágenes siguen indicando indisponibilidad.

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
El login limita intentos por cuenta; antes de exposición pública se requieren
límites globales y por origen en el proxy. Este paquete no instala ni publica ese proxy.

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
