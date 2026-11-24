/**
 * Monta um .xlsx de teste (zip + XML) a partir de abas em grade — pra testar o
 * leitor dos relatórios do marketplace sem arquivo de verdade (que tem dado do
 * comprador). Texto vai como string compartilhada (ou inline, com `inline`),
 * número como número, null como célula vazia.
 */
import { deflateRawSync } from 'node:zlib';

type Valor = string | number | boolean | null;

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer) {
  let c = 0xffffffff;
  for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letra = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function zip(arquivos: Array<[string, string]>, comprimir: boolean): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [nome, conteudo] of arquivos) {
    const dados = Buffer.from(conteudo, 'utf8');
    const corpo = comprimir ? deflateRawSync(dados) : dados;
    const n = Buffer.from(nome, 'utf8');
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(comprimir ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(n.length, 26);
    locais.push(local, n, corpo);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(comprimir ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(corpo.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrais.push(central, n);
    offset += 30 + n.length + corpo.length;
  }
  const cd = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cd.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, cd, fim]);
}

export function xlsxDeTeste(
  abas: Record<string, Valor[][]>,
  { comprimir = true, inline = false }: { comprimir?: boolean; inline?: boolean } = {},
): Buffer {
  const compartilhadas: string[] = [];
  const indice = new Map<string, number>();
  const nomes = Object.keys(abas);
  const sheets = nomes.map((nome) => {
    const linhas = abas[nome]!.map((linha, i) => {
      const cels = linha
        .map((v, j) => {
          const ref = `${letra(j)}${i + 1}`;
          if (v === null) return '';
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          if (inline) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
          if (!indice.has(v)) {
            indice.set(v, compartilhadas.length);
            compartilhadas.push(v);
          }
          return `<c r="${ref}" t="s"><v>${indice.get(v)}</v></c>`;
        })
        .join('');
      return `<row r="${i + 1}">${cels}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${linhas.join('')}</sheetData></worksheet>`;
  });
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes
    .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nomes
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}</Relationships>`;
  const ss = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${compartilhadas
    .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
    .join('')}</sst>`;
  return zip(
    [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
      ['xl/workbook.xml', workbook],
      ['xl/_rels/workbook.xml.rels', rels],
      ...(compartilhadas.length ? ([['xl/sharedStrings.xml', ss]] as Array<[string, string]>) : []),
      ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, s]),
    ],
    comprimir,
  );
}
