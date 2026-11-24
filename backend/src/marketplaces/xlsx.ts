/**
 * Leitor mínimo de .xlsx (zip + XML), sem dependência: o suficiente pros
 * relatórios da Central do Vendedor. Lê o arquivo em memória e devolve cada
 * aba como uma grade de células (texto, número, booleano ou vazio). Quem chama
 * escolhe as colunas pelo NOME do cabeçalho — as que não pede (dados do
 * comprador, por exemplo) nunca saem daqui.
 *
 * Proteções: tamanho descompactado limitado (zip-bomb), só os arquivos do
 * pacote que interessam são descompactados.
 */
import { inflateRawSync } from 'node:zlib';

export type Celula = string | number | boolean | null;
export type Aba = Celula[][];

export class XlsxInvalido extends Error {
  constructor(msg = 'O arquivo não é uma planilha .xlsx válida.') {
    super(msg);
    this.name = 'XlsxInvalido';
  }
}

/** Soma do que se descompacta de um arquivo (um relatório grande tem ~20 MB de XML). */
const LIMITE_DESCOMPACTADO = 200 * 1024 * 1024;

type Entrada = { metodo: number; comprimido: number; tamanho: number; inicio: number };

/** Índice do zip (diretório central): nome → onde estão os dados. */
function indiceZip(buf: Buffer): Map<string, Entrada> {
  if (buf.length < 22) throw new XlsxInvalido();
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxInvalido();
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map<string, Entrada>();
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxInvalido();
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);
    p += 46 + nomeLen + extraLen + comLen;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new XlsxInvalido();
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (inicio + comprimido > buf.length) throw new XlsxInvalido();
    entradas.set(nome, { metodo, comprimido, tamanho, inicio });
  }
  return entradas;
}

function extrair(buf: Buffer, e: Entrada, orcamento: { resta: number }): string {
  if (e.tamanho > orcamento.resta) throw new XlsxInvalido('A planilha é grande demais para ler.');
  const dados = buf.subarray(e.inicio, e.inicio + e.comprimido);
  let saida: Buffer;
  if (e.metodo === 0) saida = dados;
  else if (e.metodo === 8) {
    try {
      saida = inflateRawSync(dados, { maxOutputLength: Math.max(1, Math.min(orcamento.resta, e.tamanho + 1024)) });
    } catch {
      throw new XlsxInvalido();
    }
  } else throw new XlsxInvalido();
  orcamento.resta -= saida.length;
  return saida.toString('utf8');
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const cod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cod) ? String.fromCodePoint(cod) : '';
    }
    return ENTIDADES[e.toLowerCase()] ?? '';
  });
}

function atributos(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decodificar(m[2]!);
  return out;
}

/** O texto de um <si>/<is>: junta os <t>, sem a parte fonética (<rPh>). */
function texto(xml: string): string {
  const semFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of semFonetica.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodificar(out);
}

function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function lerAba(xml: string, compartilhadas: string[]): Aba {
  const linhas: Aba = [];
  let proxLinha = 0;
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = atributos(r[1] ?? '');
    const iLinha = ra.r ? Number(ra.r) - 1 : proxLinha;
    proxLinha = iLinha + 1;
    const linha: Celula[] = [];
    let proxCol = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = atributos(c[1] ?? '');
      const iCol = ca.r ? coluna(ca.r) : proxCol;
      proxCol = iCol + 1;
      const corpo = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let valor: Celula = null;
      switch (ca.t) {
        case 's':
          valor = v !== undefined ? (compartilhadas[Number(v)] ?? null) : null;
          break;
        case 'inlineStr': {
          const is = /<is>([\s\S]*?)<\/is>/.exec(corpo)?.[1];
          valor = is !== undefined ? texto(is) : null;
          break;
        }
        case 'str':
          valor = v !== undefined ? decodificar(v) : null;
          break;
        case 'b':
          valor = v === '1';
          break;
        case 'e':
          valor = null;
          break;
        default:
          valor = v === undefined || v === '' ? null : Number(v);
          if (typeof valor === 'number' && !Number.isFinite(valor)) valor = null;
      }
      while (linha.length < iCol) linha.push(null);
      linha[iCol] = valor;
    }
    while (linhas.length < iLinha) linhas.push([]);
    linhas[iLinha] = linha;
  }
  return linhas;
}

/** Lê a planilha: { nome da aba → grade }. */
export function lerXlsx(buf: Buffer): Map<string, Aba> {
  const zip = indiceZip(buf);
  const orcamento = { resta: LIMITE_DESCOMPACTADO };
  const ler = (nome: string) => {
    const e = zip.get(nome);
    return e ? extrair(buf, e, orcamento) : null;
  };

  const workbook = ler('xl/workbook.xml');
  const rels = ler('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new XlsxInvalido();

  const alvo = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = atributos(m[1] ?? '');
    if (a.Id && a.Target) alvo.set(a.Id, a.Target);
  }

  const compartilhadas: string[] = [];
  const ss = ler('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) compartilhadas.push(m[1] !== undefined ? texto(m[1]) : '');

  const abas = new Map<string, Aba>();
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = atributos(m[1] ?? '');
    const rid = a['r:id'] ?? Object.entries(a).find(([k]) => k.endsWith(':id'))?.[1];
    const t = rid ? alvo.get(rid) : undefined;
    if (!a.name || !t) continue;
    const caminho = t.startsWith('/') ? t.slice(1) : t.startsWith('xl/') ? t : `xl/${t}`;
    const xml = ler(caminho);
    if (xml !== null) abas.set(a.name, lerAba(xml, compartilhadas));
  }
  if (!abas.size) throw new XlsxInvalido();
  return abas;
}
