import { strFromU8, unzipSync } from 'fflate';

/** Formats whose text can be pulled out of their zipped XML without a script. */
export const ZIP_DOCUMENT_EXT = /\.(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pptm|potx|odt|ods|odp|epub)$/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (xml: string) => decodeEntities(xml.replace(/<[^>]+>/g, ''));

function tidy(text: string) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Numeric order for names like slide10.xml after slide9.xml. */
const byNumber = (a: string, b: string) => (parseInt(a.match(/(\d+)\.xml$/)?.[1] ?? '0') || 0) - (parseInt(b.match(/(\d+)\.xml$/)?.[1] ?? '0') || 0);

function wordText(xml: string) {
  return stripTags(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      // A table row reads as one line: paragraphs inside a cell join with spaces, cells with bars.
      .replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, ' ') + ' | ')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
  )
    .replace(/ +\| *\n/g, '\n')
    .replace(/ {2,}\| /g, ' | ');
}

function docx(files: Record<string, Uint8Array>) {
  const body = files['word/document.xml'];
  if (!body) throw new Error('word/document.xml is missing');
  const parts = [wordText(strFromU8(body))];
  for (const name of ['word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml']) {
    if (!files[name]) continue;
    const text = tidy(wordText(strFromU8(files[name])));
    if (text) parts.push(`--- ${name.slice(5, -4)} ---\n${text}`);
  }
  return parts.join('\n\n');
}

function columnIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function xlsx(files: Record<string, Uint8Array>) {
  const shared: string[] = [];
  const sst = files['xl/sharedStrings.xml'];
  if (sst) {
    for (const si of strFromU8(sst).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeEntities((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  // Sheet names in workbook order, resolved to their part names through the relationships file.
  const rels: Record<string, string> = {};
  const relsXml = files['xl/_rels/workbook.xml.rels'];
  if (relsXml) {
    for (const m of strFromU8(relsXml).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = m[0].match(/Id="([^"]+)"/)?.[1];
      const target = m[0].match(/Target="([^"]+)"/)?.[1];
      if (id && target) rels[id] = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }
  }
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  let sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeEntities(m[0].match(/name="([^"]*)"/)?.[1] ?? ''),
    path: rels[m[0].match(/r:id="([^"]+)"/)?.[1] ?? ''],
  }));
  if (!sheets.length || sheets.some((s) => !s.path)) {
    sheets = Object.keys(files)
      .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort(byNumber)
      .map((path, i) => ({ name: `Sheet${i + 1}`, path }));
  }

  const out: string[] = [];
  for (const sheet of sheets) {
    const xml = files[sheet.path];
    if (!xml) continue;
    const lines = [`## Sheet: ${sheet.name}`];
    for (const row of strFromU8(xml).match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const rowNum = row.match(/<row\b[^>]*\br="(\d+)"/)?.[1];
      const cells: string[] = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = c.match(/\br="([A-Z]+)\d+"/)?.[1] ?? String.fromCharCode(65 + cells.length);
        const type = c.match(/\bt="([^"]+)"/)?.[1];
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const f = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1];
        let value =
          type === 's' && v != null
            ? shared[parseInt(v)] ?? ''
            : type === 'inlineStr'
              ? stripTags(c.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '')
              : type === 'b'
                ? v === '1'
                  ? 'TRUE'
                  : 'FALSE'
                : decodeEntities(v ?? '');
        if (f) value = `${value} (=${decodeEntities(f)})`;
        cells[columnIndex(ref)] = value.replace(/\n/g, ' ');
      }
      if (cells.some((x) => x)) lines.push(`${rowNum ?? lines.length}: ${Array.from(cells, (x) => x ?? '').join(' | ')}`);
    }
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

function pptx(files: Record<string, Uint8Array>) {
  const slideText = (name: string) =>
    tidy(stripTags(strFromU8(files[name]).replace(/<a:br[^>]*\/>/g, '\n').replace(/<\/a:p>/g, '\n')));
  return Object.keys(files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort(byNumber)
    .map((name, i) => {
      const num = name.match(/(\d+)\.xml$/)?.[1];
      const notes = files[`ppt/notesSlides/notesSlide${num}.xml`] ? slideText(`ppt/notesSlides/notesSlide${num}.xml`) : '';
      return `## Slide ${i + 1}\n${slideText(name)}${notes ? `\n\nNotes: ${notes}` : ''}`;
    })
    .join('\n\n');
}

function openDocument(files: Record<string, Uint8Array>) {
  const content = files['content.xml'];
  if (!content) throw new Error('content.xml is missing');
  return stripTags(
    strFromU8(content)
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => ' '.repeat(parseInt(n ?? '1')))
      .replace(/<\/table:table-cell>/g, ' | ')
      .replace(/<\/table:table-row>/g, '\n')
      .replace(/<table:table table:name="([^"]*)"/g, '\n## $1\n<x')
      .replace(/<draw:page draw:name="([^"]*)"/g, '\n## $1\n<x')
      .replace(/<\/text:(p|h)>/g, '\n')
  );
}

function epub(files: Record<string, Uint8Array>) {
  return Object.keys(files)
    .filter((f) => /\.(x?html?)$/i.test(f))
    .sort()
    .map((f) =>
      stripTags(
        strFromU8(files[f])
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
          .replace(/<\/(p|div|h\d|li|tr)>|<br\s*\/?>/gi, '\n')
      )
    )
    .join('\n\n');
}

/** Extracts readable text from Office Open XML, OpenDocument and EPUB files. */
export function extractZipDocument(name: string, bytes: Uint8Array) {
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1] ?? '';
  // Media inside the archive is never read, so skip inflating it.
  const files = unzipSync(bytes, { filter: (f) => !/\.(png|jpe?g|gif|emf|wmf|bmp|tiff?|mp[34]|wav|bin|ttf|otf|woff2?)$/i.test(f.name) });
  let text: string;
  if (/^do[ct]/.test(ext)) text = docx(files);
  else if (ext.startsWith('xl')) text = xlsx(files);
  else if (ext.startsWith('p')) text = pptx(files);
  else if (ext === 'epub') text = epub(files);
  else text = openDocument(files);
  return tidy(text);
}
