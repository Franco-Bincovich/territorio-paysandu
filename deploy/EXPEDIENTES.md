# Expedientes institucionales — contrato definitivo

Esta guía reemplaza los contratos documentales preliminares de las fases anteriores. No se genera ni se registra ningún expediente institucional desde la aplicación.

## Acceso y configuración

Carpeta institucional: `/Satelitales/EXPEDIENTES_GENERADOS`, hermana de las carpetas de imágenes. Infraestructura debe crearla y publicar los DOCX; la aplicación nunca crea esa carpeta ni escribe en ella. Su ausencia devuelve un error controlado al consultar expedientes y no impide iniciar los demás módulos.

- `EXPEDIENTES_PROVIDER=filesystem`: directorio montado de solo lectura; `EXPEDIENTES_DIRECTORY` indica la ruta dentro del contenedor. Overlay opcional `compose.expedientes.yaml`: monta `EXPEDIENTES_HOST_DIRECTORY` en `/data/expedientes`, sin crear el directorio origen. No aplicar el overlay antes de que exista.
- `EXPEDIENTES_PROVIDER=sftp`: requiere `IMAGE_PROVIDER=sftp`; reutiliza el lector, usuario `sftp-lectura`, credenciales y verificación independiente de host key `SFTP_IMAGES_*` existentes. No se agrega otro usuario ni conexión institucional configurada. `EXPEDIENTES_DIRECTORY=/Satelitales/EXPEDIENTES_GENERADOS`.
- Si no se especifica proveedor documental, se utiliza `IMAGE_PROVIDER`. No hay fallback entre proveedores ni credenciales embebidas.

El archivo `runtime.env.example` es una plantilla. No contiene la configuración definitiva ni debe sustituir automáticamente el `.env` institucional. Revisar permisos de lectura y traversal de directorios con el usuario de servicio, y permisos readonly del montaje/CIFS/SFTP existentes.

## Nombre, búsqueda y asociación

Nombre exacto: `Expediente_NUMEROCASO_PADRON_LOCALIDAD.docx`.
Ejemplo: `Expediente_264893_3389_PAYSANDU_CHACRAS.docx`.
Solo `PAYSANDU` y `PAYSANDU_CHACRAS`; no se infieren equivalencias. Padrón documental no es `PadCod`. Los números son positivos, de hasta 19 dígitos y no superiores a 9223372036854775807; espacios externos y ceros iniciales de entradas numéricas se normalizan. Nombres con prefijos, extensión o localidad distintos se ignoran. Dos nombres que normalicen al mismo caso/padrón/localidad producen error 409, nunca selección arbitraria.

`GET /api/expedientes?localidad=PAYSANDU_CHACRAS&padron=3389` devuelve todos los casos coincidentes. La interfaz busca exclusivamente por localidad y padrón, ambos obligatorios: no muestra filtro ni columna de caso. Conserva el nombre completo del archivo. El contrato backend mantiene `caso` opcional para uso interno. Sin coincidencias se devuelve una lista vacía; la UI muestra “No se encontraron expedientes para los datos ingresados.”

Cada resultado tiene ID SHA256 del nombre y metadatos públicos. No incluye rutas físicas. Para cada `GET /api/expedientes/{id}/descarga`, `/contenido` o `/exportar` son obligatorios los tres filtros `localidad`, `padron`, `caso`; el backend revalida sesión, rol, asociación actual y archivo. Un ID conocido no sustituye autorización.

El catálogo de nombres se conserva 30 segundos en memoria, con carga compartida entre solicitudes simultáneas. Las incorporaciones externas aparecen tras vencer ese plazo; las descargas fuerzan actualización para detectar reemplazos/ambigüedad. Se limita a 100.000 entradas/16 MiB de nombres y 1.000 coincidencias por consulta. No se agrega tabla MariaDB ni índice permanente. Publicar archivos terminados mediante renombrado atómico del lado institucional reduce lecturas durante copias externas.

## Roles y documentos

Atención al público: sin búsqueda, lectura ni descarga, incluso por URL. Colaborador y Administrador: buscar, visualizar PDF, descargar Word original y exportar PDF. Ningún rol tiene `expedientes.generate`. Los contratos legacy se conservan para regresión, pero el runtime utiliza exclusivamente el adaptador institucional de solo lectura.

Word descarga los bytes originales, sin reescribir ZIP, contenido o metadatos. Límite de entrada: 20 MiB. Se valida estructura ZIP, CRC, tamaño descomprimido y contenido compatible. Se rechazan archivos corruptos, enlaces simbólicos, archivos especiales, rutas arbitrarias, macros, objetos incrustados y referencias externas.

PDF y visualización utilizan LibreOffice Writer headless dentro de la imagen. Cada ejecución tiene copia temporal de entrada readonly, perfil propio y limpieza al finalizar. No se conserva un PDF permanente ni se llama a servicios externos. El launcher seccomp bloquea sockets de red del conversor y sus descendientes; la aplicación conserva su conexión de base/SFTP. Una conversión simultánea por proceso; saturación devuelve 429 con Retry-After. Límites: 30 s de reloj, 25 s CPU, 768 MiB de espacio de direcciones, salida máxima del conversor 20 MiB y techo HTTP 20 MiB; contenedor además limita CPU, memoria, PIDs y tmpfs. Validación de firma y fin PDF antes de servirlo.

La conversión puede cambiar saltos de página, fuentes no instaladas, tablas o elementos complejos. No equivale a fidelidad binaria de Word. La política conservadora rechaza documentos con vínculos externos (incluso algunos hipervínculos ordinarios), XML no UTF-8, objetos activos o paquetes Office fuera del subconjunto validado. Revisar documentos representativos reales durante aceptación institucional. No existe análisis antivirus ni promesa de reproducir cualquier variante DOCX.

## Verificación y entrega

Consultar `qa/expedientes-final/INFORME.md` para resultados efectivos, imagen exacta y limitaciones; los informes previos no acreditan la integración final. Pruebas usan documentos y cuentas ficticios aislados. La verificación institucional de documentos reales, permisos del servidor, `.env`, TLS y despliegue sigue a cargo de instalación final autorizada.
