import { auditAddress, auditValueEqual } from './audit-diff';
import { normalizeAddressPlace } from '@backend/domain';

const labels: Record<string, string> = {
  nombre_completo: 'Nombre', tipo_documento: 'Tipo de documento', documento: 'Documento',
  relacion_declarada: 'Vínculo declarado', descripcion: 'Descripción', tipo_consulta: 'Tipo de consulta',
  padron: 'Padrón', localidad_padron: 'Localidad del padrón',
  domicilio_calle: 'Calle original', domicilio_puerta: 'Puerta original', domicilio_block: 'Block original',
  domicilio_apto: 'Apartamento original', domicilio_localidad: 'Localidad original', domicilio_departamento: 'Departamento original',
};
for (let i = 1; i <= 5; i++) {
  labels[`telefono_${i}`] = `Teléfono ${i}`;
  labels[`tipo_telefono_${i}`] = `Tipo de teléfono ${i}`;
  labels[`mail_${i}`] = `Correo ${i}`;
}
const addressLabels: Record<string, string> = {
  CALLE: 'Calle', PUERTA: 'Puerta', LOCALIDAD: 'Localidad', DEPARTAMENTO: 'Departamento',
  BLOCK: 'Block', DEPTO: 'Depto / Apartamento', CODIGO_POSTAL: 'Código postal', MANZANA: 'Manzana', LOTE: 'Lote',
  NUMERO: 'Número original', BARRIO: 'Barrio original', PH: 'PH original',
  DOMICILIO_COMPLETO: 'Domicilio completo original', REFERENCIA: 'Referencia original', SECTOR: 'Sector original',
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const populated = (v: unknown) => (typeof v === 'string' && v !== '') || typeof v === 'number';
const typeLabels: Record<string, string> = { GENERAL: 'General', RECLAMO: 'Reclamo', FALTA_DOCUMENTACION: 'Falta de documentación', DECLARACION_METROS: 'Declaracion voluntaria de metros' };
function display(key: string, value: unknown) {
  const original = String(value);
  const label = (values: Record<string, string>) => Object.hasOwn(values, original) ? values[original] : original;
  if (key === 'tipo_consulta') return label(typeLabels);
  if (key === 'tipo_documento') return label({ CEDULA_IDENTIDAD: 'Cédula de identidad', CI: 'Cédula de identidad', RUT: 'RUT', OTROS: 'Otros' });
  if (key.startsWith('tipo_telefono_')) return label({ FIJO: 'Fijo', CELULAR: 'Celular' });
  return original;
}
function equivalentField(key: string, a: unknown, b: unknown) {
  const comparable = (v: unknown) => {
    if (typeof v === 'string' && ['LOCALIDAD','DEPARTAMENTO','localidad_padron'].includes(key)) return normalizeAddressPlace(v);
    return populated(v) ? display(key, v) : v;
  };
  return auditValueEqual(comparable(a), comparable(b));
}
/** Presentation only: explicit labels preserve snapshot values without exposing technical IDs. */
export function AuditSnapshot({ value, comparison }: { value: unknown; comparison?: unknown }) {
  const row = record(value), other = record(comparison), comparing = comparison !== undefined;
  const address = auditAddress(row.domicilio_declarado_json), otherAddress = auditAddress(other.domicilio_declarado_json);
  const fields = Object.entries(labels).filter(([key]) => populated(row[key]) || (comparing && populated(other[key])));
  const addressFields = Object.entries(addressLabels).filter(([key]) => populated(address[key]) || (comparing && populated(otherAddress[key])));
  if (!fields.length && !addressFields.length) return <p className="muted">No hay datos declarados disponibles en esta versión.</p>;
  return <dl className="audit-fields">
    {fields.map(([key, label]) => {
      const changed = comparing && !equivalentField(key, row[key], other[key]);
      return <div key={key} className={[key === 'descripcion' ? 'audit-wide' : '', changed ? 'audit-changed' : ''].filter(Boolean).join(' ') || undefined}>
        <dt>{label}{changed && <span className="audit-change-label">Modificado</span>}</dt><dd>{populated(row[key]) ? display(key, row[key]) : 'Sin informar'}</dd>
      </div>;
    })}
    {addressFields.length > 0 && <div className="audit-wide"><dt>Domicilio personal</dt><dd>
      <dl className="audit-fields">{addressFields.map(([key, label]) => {
        const changed = comparing && !equivalentField(key, address[key], otherAddress[key]);
        return <div key={key} className={changed ? 'audit-changed' : undefined}><dt>{label}{changed && <span className="audit-change-label">Modificado</span>}</dt><dd>{populated(address[key]) ? String(address[key]) : 'Sin informar'}</dd></div>;
      })}</dl>
    </dd></div>}
  </dl>;
}
