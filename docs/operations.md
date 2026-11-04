# Operación y portabilidad — borrador G1

## Promoción

Ramas cortas por tarea, PR con referencia PAY-T, diff, pruebas y revisión por identidad distinta. No fusionar con fallos críticos. `main` debe contener únicamente cambios revisados; esta primera implementación local se conserva en una rama de desarrollo y no implica aprobación de QA. No configurar producción automática antes del GO. Repositorio exclusivamente privado.

Vercel preview requiere proyecto nuevo autorizado, plan apto verificado, entorno sintético y protección de acceso. No inferir que Hobby admite uso institucional. Variables por entorno; nunca subir `.env.local`. El pipeline no se activa en GitHub hasta verificar cuota gratuita y presupuesto. Restaurar una release anterior no revierte automáticamente migraciones.

## Migración institucional

Next.js genera salida standalone para Node; no usa servicios Vercel en el dominio. PostgreSQL conserva transacciones y políticas. Supabase Auth requiere adaptador y plan explícito de migración de identidades; no asumir traslado de passwords. Adaptadores de Catastro e imágenes deben recibir contratos/red autorizados antes de G3. No abrir puertos institucionales ni crear túneles para saltar dependencias.

## Respaldo y recuperación

Definir propietario, destino cifrado, retención, RPO/RTO y presupuesto antes de piloto. Exportar PostgreSQL con herramienta compatible; respaldar configuración Auth y secretos por separado en almacenamiento autorizado. La base no incluye bytes del servicio externo de imágenes. No considerar Free equivalente a backup gestionado.

Ensayar restauración solo en destino nuevo vacío autorizado: aplicar versiones, restaurar datos sintéticos, verificar recuentos/relaciones, probar RLS con dos colaboradores, recuperar consultas y validar login. Registrar tiempos y evidencia; prohibido declarar recuperación comprobada antes de ese ensayo. No ejecutar restore destructivo sobre el origen.

## Credenciales

Definir correo controlado, recuperación y canal seguro antes de provisionar Paysandu. No pedir ni registrar contraseña por chat, Notion, git o logs. No incluir service-role en cliente. Usuarios de QA deben ser sintéticos y aislados. Para el primer acceso probar que no se pueden consultar datos mediante API o PostgREST antes del cambio y que la clave anterior falla después. La pantalla por sí sola no acredita el gate.
