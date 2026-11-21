export const ROLES = ["atencion_publico", "collaborator", "administrator"] as const;
export type Role = typeof ROLES[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = Object.freeze({
  atencion_publico: "Atención al público",
  collaborator: "Colaborador",
  administrator: "Administrador",
});

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && ROLES.some(role => role === value);
