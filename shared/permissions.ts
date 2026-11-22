/** Portable permission contract. Only trusted authentication adapters assign roles. */
export const ROLES = ['atencion_publico', 'collaborator', 'administrator'] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABELS: Readonly<Record<Role, string>> = Object.freeze({
  atencion_publico: 'Atención al público', collaborator: 'Colaborador', administrator: 'Administrador',
});
const publicCapabilities = [
  'password.self', 'institutional.search', 'institutional.read', 'histories.read',
  'consultations.read', 'consultations.write',
] as const;
const collaboratorCapabilities = [...publicCapabilities, 'expedientes.read', 'expedientes.download', 'expedientes.export'] as const;
const administratorCapabilities = [...collaboratorCapabilities, 'users.manage', 'audit.read', 'consultations.edit.any', 'notification-lots.access'] as const;
// Reserved legacy capability is deliberately assigned to no role: institutional files are read-only.
export type Capability = typeof administratorCapabilities[number] | 'expedientes.generate';
export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = Object.freeze({
  atencion_publico: Object.freeze(publicCapabilities),
  collaborator: Object.freeze(collaboratorCapabilities),
  administrator: Object.freeze(administratorCapabilities),
});
export const isRole = (value: unknown): value is Role => typeof value === 'string' && ROLES.some(role => role === value);
export function hasCapability(role: unknown, capability: Capability): boolean {
  return isRole(role) && ROLE_CAPABILITIES[role].includes(capability);
}
