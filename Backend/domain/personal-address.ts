/** Personal address contract. PUERTA is the street number; NUMERO remains legacy data. */
export const personalLocalities = [
  { value: 'PAYSANDU', label: 'Paysandú' },
  { value: 'PAYSANDU CHACRAS', label: 'Paysandú Chacras' },
] as const;
export const personalAddressFields = [
  ['CALLE', 'Calle', 250], ['PUERTA', 'Puerta', 50],
  ['LOCALIDAD', 'Localidad', 250], ['DEPARTAMENTO', 'Departamento', 150],
  ['BLOCK', 'Block', 50], ['DEPTO', 'Depto / Apartamento', 50],
  ['CODIGO_POSTAL', 'Código postal', 50], ['MANZANA', 'Manzana', 50], ['LOTE', 'Lote', 50],
] as const;
export const retiredAddressFields = ['NUMERO','BARRIO','PH','DOMICILIO_COMPLETO','REFERENCIA','SECTOR'] as const;
export const normalizeAddressPlace = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase();
export function personalAddressErrors(address: Record<string, string | null | undefined> | null | undefined): Record<string, string> {
  if (!address || !Object.values(address).some(v => typeof v === 'string' && v.trim())) return {};
  const errors: Record<string, string> = {};
  for (const key of ['CALLE','PUERTA','LOCALIDAD']) if (!address[key]?.trim()) errors[key] = 'Completá este campo al informar domicilio.';
  const locality = address.LOCALIDAD;
  if (locality?.trim() && !personalLocalities.some(l => l.value === normalizeAddressPlace(locality))) errors.LOCALIDAD = 'Elegí Paysandú o Paysandú Chacras.';
  if (address.DEPARTAMENTO?.trim() && normalizeAddressPlace(address.DEPARTAMENTO) !== 'PAYSANDU') errors.DEPARTAMENTO = 'El departamento debe ser Paysandú.';
  return errors;
}
