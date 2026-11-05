# Territorio Paysandú: ejecución Docker

Backend contiene lógica del servidor y dominio compartido. Frontend contiene React, estilos, recursos y los adaptadores de rutas API requeridos por Next.js. Es una sola aplicación Next.js y un solo contenedor, no dos servicios independientes. Los archivos raíz son necesarios para construir y ejecutar.

## Construcción y arranque

Desde la raíz: `docker build -t territorio-paysandu-organizado:70bef308 .`. La construcción no requiere credenciales.
Configure `RUNTIME_ENV_FILE` con la ruta a un archivo privado externo a esta entrega y luego ejecute `docker compose up -d`.
Compose requiere versión 2.30 o posterior. El servicio escucha en 127.0.0.1:3000. Para VPS, un administrador debe configurar HTTPS y proxy inverso antes de exponerlo. No incluya claves en la imagen, Git ni archivos enviados.

Variables del archivo privado:
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: configuración del servicio existente. La clave secreta es solo del servidor.
- `APP_ORIGIN`: origen exacto de acceso, incluido puerto en pruebas locales; HTTPS en servidor.
- `AUTH_USERNAME_EMAIL_MAP`: objeto JSON de correspondencia entre nombres de usuario y correos, conservando la configuración autorizada.
- `DATA_MODE=synthetic`: catálogo actual de prueba; no representa una integración institucional.
- `PROTOTYPE_RECORD_ENABLED=true` y `IMAGE_PROVIDER=supabase`: habilitan el padrón prototipo y las imágenes existentes, si la base actual está preparada para ello.
- Opcionales: `SYNTHETIC_CACHE_TTL_MS`, `SYNTHETIC_IMAGE_REFERENCE_DATE`. Mantener los valores previos cuando correspondan.

Supabase Auth, PostgreSQL y Storage continúan externos. Deben conservarse tablas, funciones, usuarios y políticas existentes. Esta entrega no inicializa una base vacía ni incluye migraciones. MariaDB no está implementada.

Cada cambio de código requiere reconstruir la imagen y recrear el contenedor que deba ejecutarlo. No cambia imágenes ya construidas. No se modificaron Vercel ni el repositorio compartido.