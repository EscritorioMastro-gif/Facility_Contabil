/**
 * Gerador mínimo de planilha Excel (.xlsx), sem biblioteca: uma aba, cabeçalho
 * em negrito fixo no topo, filtro nas colunas, largura de cada coluna, valores
 * como número (R$ com 2 casas) e datas como data. O .xlsx é um zip com alguns
 * XML do Office Open XML — aqui o zip vai sem compressão ("store"), o que o
 * Excel, o Google Planilhas e o LibreOffice abrem normalmente.
 */

export type TipoColuna = 'texto' | 'dinheiro' | 'inteiro' | 'data';
export type Coluna = { titulo: string; tipo?: TipoColuna; largura?: number };
/** data: "AAAA-MM-DD" */
export type Celula = string | number | null | undefined;

// estilos (styles.xml): 0 normal · 1 cabeçalho · 2 dinheiro · 3 inteiro · 4 data
const ESTILO: Record<TipoColuna, number> = { texto: 0, dinheiro: 2, inteiro: 3, data: 4 };

const escapar = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0 → "A", 25 → "Z", 26 → "AA" */
function letra(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "2026-11-24" → nº de série do Excel (dias desde 30/12/1899) */
function serialDaData(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function celula(ref: string, v: Celula, tipo: TipoColuna): string {
  if (v === null || v === undefined || v === '') return '';
  if (tipo === 'data' && typeof v === 'string') {
    const s = serialDaData(v);
    if (s !== null) return `<c r="${ref}" s="4"><v>${s}</v></c>`;
  }
  if ((tipo === 'dinheiro' || tipo === 'inteiro') && typeof v === 'number' && Number.isFinite(v)) {
    return `<c r="${ref}" s="${ESTILO[tipo]}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(v))}</t></is></c>`;
}

function planilhaXml(colunas: Coluna[], linhas: Celula[][]): string {
  const ultima = letra(colunas.length - 1);
  const cols = colunas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? Math.max(10, c.titulo.length + 2)}" customWidth="1"/>`)
    .join('');
  const cabecalho = colunas
    .map((c, i) => `<c r="${letra(i)}1" t="inlineStr" s="1"><is><t>${escapar(c.titulo)}</t></is></c>`)
    .join('');
  const corpo = linhas
    .map((l, r) => {
      const n = r + 2;
      return `<row r="${n}">${colunas.map((c, i) => celula(`${letra(i)}${n}`, l[i], c.tipo ?? 'texto')).join('')}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${cabecalho}</row>${corpo}</sheetData>` +
    `<autoFilter ref="A1:${ultima}${linhas.length + 1}"/>` +
    '</worksheet>'
  );
}

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEFEC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function arquivos(aba: string, colunas: Coluna[], linhas: Celula[][]): Array<[string, string]> {
  const nome = escapar(aba.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Planilha');
  const filtro = `'${nome.replace(/'/g, "''")}'!$A$1:$${letra(colunas.length - 1)}$${linhas.length + 1}`;
  return [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${nome}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${filtro}</definedName></definedNames>` +
        '</workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ],
    ['xl/worksheets/sheet1.xml', planilhaXml(colunas, linhas)],
    ['xl/styles.xml', ESTILOS],
  ];
}

// --------------------------------------------------------------------------- #
// zip sem compressão
// --------------------------------------------------------------------------- #
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entradas: Array<[string, string]>): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let pos = 0;
  // data/hora fixas (01/01/2026 00:00) — o conteúdo não depende do relógio
  const hora = 0;
  const dia = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [nome, texto] of entradas) {
    const n = enc.encode(nome);
    const d = enc.encode(texto);
    const crc = crc32(d);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true); // sem compressão
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, d.length, true);
    local.setUint32(22, d.length, true);
    local.setUint16(26, n.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), n, d);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, dia, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, d.length, true);
    c.setUint32(24, d.length, true);
    c.setUint16(28, n.length, true);
    c.setUint16(30, 0, true);
    c.setUint16(32, 0, true);
    c.setUint16(34, 0, true);
    c.setUint16(36, 0, true);
    c.setUint32(38, 0, true);
    c.setUint32(42, pos, true);
    central.push(new Uint8Array(c.buffer), n);
    pos += 30 + n.length + d.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, entradas.length, true);
  fim.setUint16(10, entradas.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, pos, true);

  const tudo = [...partes, ...central, new Uint8Array(fim.buffer)];
  const out = new Uint8Array(tudo.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of tudo) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Os bytes do .xlsx (uma aba). */
export function bytesXlsx(colunas: Coluna[], linhas: Celula[][], aba = 'Planilha'): Uint8Array {
  return zip(arquivos(aba, colunas, linhas));
}

/** A planilha pronta pra baixar. */
export function planilhaXlsx(colunas: Coluna[], linhas: Celula[][], aba = 'Planilha'): Blob {
  const b = bytesXlsx(colunas, linhas, aba);
  return new Blob([b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
