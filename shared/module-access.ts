import { hasCapability, isRole, ROLES, type Role } from "./permissions";

export const MODULES = {
  search: "Buscar padrón",
  history: "Historial de consultas",
  notificationLots: "Lotes",
  expedientes: "Expedientes",
  administration: "Administración",
} as const;

export type Module = keyof typeof MODULES;
export const moduleKeys = Object.keys(MODULES) as Module[];
export type ModuleAccess = Record<Module, boolean>;
export type AccessMatrix = Record<Role, ModuleAccess>;
export type AccessSettings = { revision: number; matrix: AccessMatrix; writable: boolean };
export type AccessChange = { role: Role; module: Module; before: boolean; after: boolean };

export function defaultModuleAccess(role: unknown): ModuleAccess {
  return {
    search: hasCapability(role, "institutional.search"),
    history: hasCapability(role, "consultations.read"),
    notificationLots: hasCapability(role, "notification-lots.access"),
    expedientes: hasCapability(role, "expedientes.read"),
    administration: role === "administrator",
  };
}

export function defaultAccessMatrix(): AccessMatrix {
  return {
    atencion_publico: defaultModuleAccess("atencion_publico"),
    collaborator: defaultModuleAccess("collaborator"),
    administrator: defaultModuleAccess("administrator"),
  };
}

export function isModule(value: string | null): value is Module {
  return value !== null && Object.hasOwn(MODULES, value);
}

export function isAccessMatrix(value: unknown): value is AccessMatrix {
  if (!value || typeof value !== "object" || Object.keys(value).length !== ROLES.length) return false;
  return Object.entries(value).every(([role, row]) => isRole(role) && row && typeof row === "object"
    && Object.keys(row).length === moduleKeys.length
    && Object.entries(row).every(([key, allowed]) => isModule(key) && typeof allowed === "boolean")
    && row.administration === (role === "administrator"));
}

export function accessChanges(before: AccessMatrix, after: AccessMatrix): AccessChange[] {
  return ROLES.flatMap(role => moduleKeys
    .filter(module => before[role][module] !== after[role][module])
    .map(module => ({ role, module, before: before[role][module], after: after[role][module] })));
}
