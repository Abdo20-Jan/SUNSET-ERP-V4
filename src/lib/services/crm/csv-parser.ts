import "server-only";

export type CsvRow = Record<string, string>;

export type CsvParseSuccess = {
  ok: true;
  headers: string[];
  rows: CsvRow[];
  delimiter: "," | ";";
};

export type CsvParseError = {
  ok: false;
  error: string;
};

export type CsvParseResult = CsvParseSuccess | CsvParseError;

const MAX_DATA_ROWS = 5000;

function detectDelimiter(headerLine: string): "," | ";" {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

function splitCsvLine(line: string, delimiter: "," | ";"): string[] | null {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      fields.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (inQuotes) return null;
  fields.push(current);
  return fields.map((f) => f.trim());
}

function parseHeaders(text: string):
  | {
      ok: true;
      headers: string[];
      delimiter: "," | ";";
      body: string;
    }
  | CsvParseError {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstNewline = normalized.indexOf("\n");
  const headerLine = firstNewline === -1 ? normalized : normalized.slice(0, firstNewline);
  const body = firstNewline === -1 ? "" : normalized.slice(firstNewline + 1);

  if (headerLine.trim().length === 0) {
    return { ok: false, error: "CSV vacío o sin cabecera." };
  }

  const delimiter = detectDelimiter(headerLine);
  const rawHeaders = splitCsvLine(headerLine, delimiter);
  if (!rawHeaders) {
    return { ok: false, error: "Cabecera con comilla no cerrada." };
  }
  const headers = rawHeaders.map((h) => h.toLowerCase());
  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    return { ok: false, error: "Cabecera vacía." };
  }
  return { ok: true, headers, delimiter, body };
}

function parseDataRows(
  body: string,
  headers: string[],
  delimiter: "," | ";",
): { ok: true; rows: CsvRow[] } | CsvParseError {
  const lines = body.split("\n");
  const rows: CsvRow[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line === undefined || line.trim().length === 0) continue;
    if (rows.length >= MAX_DATA_ROWS) {
      return {
        ok: false,
        error: `CSV excede el límite de ${MAX_DATA_ROWS} filas de datos.`,
      };
    }
    const fields = splitCsvLine(line, delimiter);
    if (!fields) {
      return {
        ok: false,
        error: `Comilla no cerrada en la línea ${idx + 2}.`,
      };
    }
    if (fields.length !== headers.length) {
      return {
        ok: false,
        error: `Línea ${idx + 2}: ${fields.length} columnas, esperaba ${headers.length}.`,
      };
    }
    const row: CsvRow = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      const val = fields[c];
      if (key !== undefined && val !== undefined) {
        row[key] = val;
      }
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

export function parseCsv(text: string): CsvParseResult {
  const headerResult = parseHeaders(text);
  if (!headerResult.ok) return headerResult;
  const dataResult = parseDataRows(headerResult.body, headerResult.headers, headerResult.delimiter);
  if (!dataResult.ok) return dataResult;
  return {
    ok: true,
    headers: headerResult.headers,
    rows: dataResult.rows,
    delimiter: headerResult.delimiter,
  };
}
