# Territorio Paysandú v1.0

Implementación en desarrollo de G0/G1/G2. **No es una v1.0 liberada.** G3, datos reales, recuperación verificada, UAT y GO del piloto siguen pendientes.

## Desarrollo

Node.js 22 o superior. Ejecutar `npm ci`, copiar `.env.example` a `.env.local` y completar valores mediante el mecanismo seguro del entorno. `npm run dev` escucha solamente en loopback. Sin configuración válida de Supabase las APIs fallan de forma cerrada; no hay login simulado ni persistencia de negocio en el navegador.

`npm run typecheck`, `npm test` y `npm run build` verifican el código. Las pruebas en memoria no sustituyen pruebas de Supabase Auth, RLS real ni integraciones institucionales.

## Estructura

- `src/domain`: reglas, contratos y casos de uso portables.
- `src/server`: adaptadores, validación de sesión y servicios.
- `src/app/api`: transporte HTTP para Vercel/Node.
- `src/components`: UI basada en el prototipo Paysandú Premium.
- `supabase`: esquema versionado y pruebas SQL locales.
- `tests`: comprobaciones automáticas con datos sintéticos.
- `docs`: decisiones, operación y evidencia.

Tipos fijos, un solo rol Colaborador, sin dashboard, adjuntos ni estados de trámite. Cada consulta crea un contacto; las ediciones no reemplazan el contacto original ni el snapshot inicial.

## Recursos y límites

El proyecto Supabase `kmimekswqpsuspkrxdet` fue autorizado explícitamente y recibió las migraciones inicial y de integridad sintética tras confirmación del conector. Se verificaron ocho tablas con RLS, FK compuesta y permisos restrictivos. Todavía no hay usuarios ni pruebas reales de Auth/persistencia de negocio; falta un canal seguro para la clave administrativa del backend. Ver `docs/evidence/supabase-migrations-applied.json`. Repositorio privado confirmado: [Franco-Bincovich/territorio-paysandu](https://github.com/Franco-Bincovich/territorio-paysandu), rama `develop/g1-g2-foundation`. Vercel no está desplegado; no hay URL operativa entregada.

El HTML de referencia proviene de Library, ID `libfile_d27f72d729d481919b0a68099b60f420`, SHA256 `87ef523e300d4d8fcf930eb31a0a4984a2806bfad00383d46750860da423f40b`. Está excluido del repositorio; solo se trasladan estilos, no datos ni funciones v2.

Fuentes: [alcance](https://app.notion.com/p/40e30c4074f781968bfdfc17d2fbf599), [backlog](https://app.notion.com/p/22527b521f1e4915a8f0c2d5b7f7e01c), [gates](https://app.notion.com/p/40e30c4074f781cdaa48d6a03498b1c7).

## Documentación verificable

- [Matriz de las 99 tareas v1](docs/traceability-v1.md): evidencia local, brechas y dependencias; no equivale a cierre.
- [Arquitectura y seguridad](docs/architecture-security.md), [base](docs/database.md) y [operación](docs/operations.md).
- [OpenAPI](docs/api-openapi.json): contrato del transporte actual.
- [Dependencias y controles](docs/dependency-policy.md): inventario, auditorías y límites.

La migración se generó con el CLI local fijado y `SUPABASE_HOME="$PWD/.supabase"`. No ejecutar db push/repair sin reconciliar el mapa de versiones local/remoto documentado; el conector asignó sus propias versiones. Las pruebas SQL locales usan PostgreSQL WASM con identidad Auth simulada; los tests de navegador con interceptación validan UI, no persistencia cloud.
