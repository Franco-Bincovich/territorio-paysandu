import { crc32, deflateRawSync } from "node:zlib";
import type { NotificationLot } from "../../domain/notification-lots";
import type { NotificationLotExport } from "./repository";

const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const documentRels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRels = "http://schemas.openxmlformats.org/package/2006/relationships";
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

const xmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
function xmlText(value: string) {
  return value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "\ufffd")
    .replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match}`)
    .replace(/[&<>"']/g, character => xmlEntities[character]);
}

// ZIP32, using the standard Node CRC and raw DEFLATE for each OOXML member.
function zip(files: Record<string, string>) {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  const entries = Object.entries(files);
  let offset = 0;
  let directorySize = 0;
  for (const [name, xml] of entries) {
    const filename = Buffer.from(name);
    const content = Buffer.from(xmlHeader + xml);
    const data = deflateRawSync(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); // DOS date: 1980-01-01.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, filename, data);
    directory.push(entry, filename);
    offset += local.length + filename.length + data.length;
    directorySize += entry.length + filename.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

const headings: Record<string, string> = {
  CUIT: "RUT",
  NOMBRE_IMAGEN_ACTUAL: "Imagen actual",
  NOMBRE_IMAGEN_HISTORICA: "Imagen histórica",
};
const decimalTypes = new Set(["decimal", "numeric", "float", "double", "real"]);
const msPerDay = 86_400_000;
const excelEpoch = Date.UTC(1899, 11, 30);

function columnName(index: number) {
  let label = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + (value - 1) % 26) + label;
  }
  return label;
}

function textCell(ref: string, value: string, style = 0) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function numericCell(ref: string, value: string, style: number) {
  return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
}

function imageLocation(value: unknown) {
  const locality = String(value ?? "").trim();
  const key = locality.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[\s_-]+/g, " ");
  if (key === "PAYSANDU") return "Paysandú";
  if (key === "PAYSANDU CHACRAS") return "Paysandú Chacras";
  return locality || "Sin localidad informada";
}

function imageLabel(name: string, value: unknown, row: Record<string, unknown>) {
  const source = String(value ?? "").trim();
  if (!source) return "";
  const parcel = String(row.OBSERVACIONES_TIPO_OBJETOS ?? "").trim();
  const basename = source.split(/[\\/]/).at(-1) ?? "";
  const candidate = /^((?:19|20)\d{2})[_-]/.exec(basename)?.[1];
  const historicalYear = candidate &&
    (candidate !== parcel || basename.slice(5).split(/[_.-]+/).includes(parcel)) ? candidate : "Sin año informado";
  const year = name === "NOMBRE_IMAGEN_ACTUAL" ? "2026" : historicalYear;
  return `${year} · ${imageLocation(row.ZONA)} · ${parcel || "Sin padrón informado"}`;
}

function excelDate(value: unknown) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(`${String(value)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  const serial = Math.floor((timestamp - excelEpoch) / msPerDay);
  return serial < 61 ? serial - 1 : serial;
}

function valueText(value: unknown) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.length ? value.toString("base64") : "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value);
}

const styles = `<styleSheet xmlns="${spreadsheet}">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF24476E"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function notificationLotWorkbook(lot: NotificationLot, { columns, rows }: NotificationLotExport) {
  const indexed = columns.map((column, index) => ({ ...column, letter: columnName(index), heading: headings[column.name] ?? column.name }));
  const widths = indexed.map(column => column.heading.length);
  const head = `<row r="1">${indexed.map(column => textCell(`${column.letter}1`, column.heading, 1)).join("")}</row>`;
  const sheetRows = rows.map((row, index) => {
    const rowNumber = index + 2;
    const cells = indexed.map((column, columnIndex) => {
      const ref = `${column.letter}${rowNumber}`;
      const value = row[column.name];
      const text = column.name === "NOMBRE_IMAGEN_ACTUAL" || column.name === "NOMBRE_IMAGEN_HISTORICA"
        ? imageLabel(column.name, value, row)
        : valueText(value);
      widths[columnIndex] = Math.max(widths[columnIndex], text.length);
      if (!text) return "";
      if (column.dataType === "date") {
        const serial = excelDate(value);
        if (serial !== null) return numericCell(ref, String(serial), 2);
      }
      if (decimalTypes.has(column.dataType) && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))) {
        return numericCell(ref, text, 3);
      }
      return textCell(ref, text);
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  });
  const range = `A1:${indexed.at(-1)!.letter}${rows.length + 1}`;
  const sizes = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(12, width + 3))}" customWidth="1"/>`).join("");
  return zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
    "_rels/.rels": `<Relationships xmlns="${packageRels}"><Relationship Id="rId1" Type="${documentRels}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${spreadsheet}" xmlns:r="${documentRels}"><bookViews><workbookView/></bookViews><sheets><sheet name="${lot.label}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageRels}"><Relationship Id="rId1" Type="${documentRels}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${documentRels}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${spreadsheet}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sizes}</cols><sheetData>${head}${sheetRows.join("")}</sheetData><autoFilter ref="${range}"/></worksheet>`,
  });
}
