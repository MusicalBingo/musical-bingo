// Minimal .xlsx reader and writer: just enough for quiz spreadsheets.
// Reads files saved by Excel, LibreOffice, Numbers and Google Sheets; writes plain workbooks
// with a styled header row, frozen panes, column widths and drop-down lists.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type CellValue = string | number | boolean | null;
export interface SheetData {
  name: string;
  rows: CellValue[][];
}

// ---------- reading ----------

const decode = (s: string) =>
  s
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
      const k = e.toLowerCase();
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'amp') return '&';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    })
    // Excel escapes control characters as _xHHHH_
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : null;
};

/** Text of every <t> inside a fragment (rich text runs joined), ignoring phonetic hints. */
const textOf = (xml: string) =>
  [...xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((m) => decode(m[1]))
    .join('');

/** Column letters of a cell reference ("BC12") to a 0-based index. */
function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() || '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolvePath(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

function relationships(files: Record<string, Uint8Array>, relsPath: string, basePath: string) {
  const out: { id: string; type: string; target: string }[] = [];
  const xml = files[relsPath] ? strFromU8(files[relsPath]) : '';
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) out.push({ id, type: attr(m[1], 'Type') || '', target: resolvePath(basePath, target) });
  }
  return out;
}

export function readXlsx(data: Uint8Array): SheetData[] {
  if (data[0] === 0xd0 && data[1] === 0xcf) throw new Error('This is an old .xls file. Open it in Excel and save it as .xlsx first.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch {
    throw new Error('This file is not an Excel (.xlsx) file.');
  }
  const wbPath = Object.keys(files).find((f) => /^xl\/workbook\d*\.xml$/i.test(f)) || 'xl/workbook.xml';
  if (!files[wbPath]) throw new Error('This file is not an Excel (.xlsx) file.');
  const rels = relationships(files, wbPath.replace(/[^/]+$/, (n) => `_rels/${n}.rels`), wbPath);

  const ssRel = rels.find((r) => r.type.endsWith('/sharedStrings'));
  const ssXml = files[ssRel?.target || 'xl/sharedStrings.xml'];
  const shared = ssXml ? [...strFromU8(ssXml).matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g)].map((m) => textOf(m[1] || '')) : [];

  const sheets: SheetData[] = [];
  for (const m of strFromU8(files[wbPath]).matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name') || `Sheet${sheets.length + 1}`;
    const rid = m[1].match(/\s[\w-]+:id\s*=\s*"([^"]*)"/)?.[1];
    const path = rels.find((r) => r.id === rid)?.target;
    const xml = path && files[path] ? strFromU8(files[path]) : null;
    if (xml) sheets.push({ name, rows: readSheet(xml, shared) });
  }
  return sheets;
}

function readSheet(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  let rowNo = 0;
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const r = Number(attr(rm[1], 'r'));
    rowNo = r > 0 ? r - 1 : rowNo;
    const row: CellValue[] = [];
    let col = 0;
    for (const cm of (rm[2] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cm[1], 'r');
      if (ref) col = colIndex(ref);
      const type = attr(cm[1], 't') || 'n';
      const body = cm[2] || '';
      const v = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      let value: CellValue = null;
      if (type === 'inlineStr') value = textOf(body);
      else if (v != null) {
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'b') value = v.trim() === '1';
        else if (type === 'str' || type === 'e' || type === 'd') value = decode(v);
        else value = Number(v);
      }
      if (typeof value === 'number' && Number.isNaN(value)) value = null;
      if (value !== null && value !== '') row[col] = value;
      col++;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[rowNo] = row;
    rowNo++;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

// ---------- writing ----------

export interface WriteColumn {
  width: number;
  /** keep what people type as text (so Excel doesn't turn 1:30 into a time or 3/4 into a date) */
  text?: boolean;
  /** drop-down choices (typing something else is still allowed) */
  list?: string[];
  /** header colour, e.g. '#E8590C'; the header text turns white */
  color?: string;
}
export interface WriteSheet {
  name: string;
  columns: WriteColumn[];
  rows: CellValue[][];
  /** first row is a styled header, frozen at the top */
  header?: boolean;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // characters XML 1.0 doesn't allow
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const colName = (i: number): string => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function writeXlsx(sheets: WriteSheet[]): Uint8Array {
  // styles: 0 normal, 1 header, 2 text, then one coloured header style per distinct colour
  const colors = [...new Set(sheets.flatMap((s) => s.columns.map((c) => c.color).filter(Boolean) as string[]))];
  const argb = (c: string) => `FF${c.replace('#', '').toUpperCase()}`;
  const styles =
    XML_HEAD +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>` +
    `<fills count="${3 + colors.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE9E3F5"/><bgColor indexed="64"/></patternFill></fill>` +
    colors.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${argb(c)}"/><bgColor indexed="64"/></patternFill></fill>`).join('') +
    `</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${3 + colors.length}">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    colors
      .map((_, i) => `<xf numFmtId="49" fontId="2" fillId="${3 + i}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`)
      .join('') +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const sheetXml = (s: WriteSheet) => {
    const rows = s.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            if (v === null || v === undefined || v === '') return '';
            const ref = `${colName(c)}${r + 1}`;
            const col = s.columns[c];
            const style = s.header && r === 0 ? (col?.color ? 3 + colors.indexOf(col.color) : 1) : col?.text ? 2 : 0;
            const sAttr = style ? ` s="${style}"` : '';
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
            if (typeof v === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
            return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
          })
          .join('');
        return `<row r="${r + 1}"${s.header && r === 0 ? ' ht="32" customHeight="1"' : ''}>${cells}</row>`;
      })
      .join('');
    const cols = s.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.text ? ' style="2"' : ''}/>`).join('');
    const lists = s.columns
      .map((c, i) => (c.list ? `<dataValidation type="list" allowBlank="1" sqref="${colName(i)}2:${colName(i)}1000"><formula1>"${esc(c.list.join(','))}"</formula1></dataValidation>` : ''))
      .filter(Boolean);
    return (
      XML_HEAD +
      `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      (s.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '') +
      `<sheetFormatPr defaultRowHeight="15"/>` +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${rows}</sheetData>` +
      (lists.length ? `<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>` : '') +
      `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
    );
  };

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      XML_HEAD +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      XML_HEAD +
        `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>` +
        sheets.map((s, i) => `<sheet name="${esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(styles),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}
