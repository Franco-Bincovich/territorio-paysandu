# Revisión conceptual de Claude Code

Ejecutada en esta sesión con Claude Code, autenticación reportada claude.ai/Max, sin API key, sin herramientas y sin persistencia de sesión. La primera ejecución en sandbox falló por DNS EAI_AGAIN; un intento con red autorizada terminó exit 0. No fue una revisión completa del código ni aprobación de gate.

Hallazgo relevante: un trigger sobre encrypted_password puede dispararse por un reset administrativo o rehash y no acredita que la persona haya elegido una clave nueva. El diseño original limpiaba el gate automáticamente.

Corrección coordinada: todo cambio de hash mantiene/activa must_change_password, actualiza la fecha e invalida actividad. Solo una RPC accesible al servidor privilegiado finaliza el cambio tras reautenticación y comprobación de identidad/sesión posterior. El backend verifica token con getUser/getClaims antes de finalizar. Pruebas SQL independientes cubren que authenticated no puede finalizar y que un cambio de hash por sí solo no desbloquea.

Otros riesgos señalados: claims desactualizados, grants de perfiles, RPC definer, carreras idempotencia y revisión atómica de versión. El código usa perfiles consultados en DB, sin DML directo, funciones con search_path vacío y controles explícitos de sesión/autor; se prueba localmente con PGlite.

Pendiente obligatorio: probar GoTrue real, rechazo de contraseña anterior, configuración de antiabuso nativo y comportamiento ante upgrades de Auth. No se confunde evidencia conceptual con esos resultados.
