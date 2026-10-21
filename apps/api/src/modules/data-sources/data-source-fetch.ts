import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { DataSourceDialect } from "@whatsatendende/types";

export interface FetchedTable {
  columns: string[];
  rows: Record<string, string>[];
  /** When the data itself was produced (the file's last modification), if the origin says. */
  modifiedAt: Date | null;
}

const MAX_ROWS = 500_000;
// Excel stores numbers with 15 significant digits: from 16 digits on, the value in the file is already rounded.
const EXCEL_SAFE_NUMBER = 1e15;
const FETCH_TIMEOUT_MS = 60_000;

/** Column names as tags use them: lowercase, no accents, words joined by "_". */
export function normalizeColumn(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A cell as the panel shows it. "NULL" is what SQL Server Management Studio writes for an empty cell when copying results. */
function cellValue(cell: string | undefined): string {
  const value = (cell ?? "").trim();
  return value === "NULL" ? "" : value;
}

function toTable(header: string[], body: string[][], modifiedAt: Date | null): FetchedTable {
  const columns = header.map(normalizeColumn);
  if (columns.some((c) => !c)) throw new Error("A primeira linha precisa ter o nome de todas as colunas");
  if (new Set(columns).size !== columns.length) throw new Error("Há colunas com o mesmo nome na primeira linha");
  if (body.length > MAX_ROWS) throw new Error(`A planilha tem mais de ${MAX_ROWS} linhas`);
  const rows = body
    .filter((cells) => cells.some((c) => c.trim() !== ""))
    .map((cells) => Object.fromEntries(columns.map((c, i) => [c, cellValue(cells[i])])));
  return { columns, rows, modifiedAt };
}

/** UTF-8, UTF-16 (SSMS "Salvar Resultados Como" may save Unicode) or Windows-1252 (Excel/SSMS in ANSI). */
function decodeCsv(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function parseCsv(buffer: Buffer, modifiedAt: Date | null): FetchedTable {
  const text = decodeCsv(buffer);
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0);
  // Excel in Portuguese saves with ";", SQL Server Management Studio with ",".
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: string[][] = parseCsvSync(text, { delimiter, relax_column_count: true, skip_empty_lines: true });
  if (records.length === 0) throw new Error("A planilha está vazia");
  return toTable(records[0], records.slice(1), modifiedAt);
}

/** Read row by row (streaming): a 250k-row sheet loaded whole takes minutes and gigabytes. Only the first sheet. */
async function parseXlsx(buffer: Buffer, modifiedAt: Date | null): Promise<FetchedTable> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), { sharedStrings: "cache", styles: "cache", hyperlinks: "ignore", worksheets: "emit" });
  const records: string[][] = [];
  for await (const sheet of reader) {
    for await (const row of sheet) {
      const width = records[0]?.length ?? row.cellCount;
      const cells: string[] = [];
      for (let i = 1; i <= width; i++) {
        const cell = row.getCell(i);
        // Excel keeps only 15 digits of a number: a longer code (a 17-digit nosso número) pasted into a General
        // cell is already rounded in the file. Taken as is it would build a boleto with the wrong number.
        if (records.length > 0 && typeof cell.value === "number" && Math.abs(cell.value) >= EXCEL_SAFE_NUMBER) {
          throw new Error(
            `A coluna "${records[0][i - 1]}" tem números com mais de 15 dígitos gravados como número, e o Excel arredonda os últimos dígitos. No Excel, formate as colunas como Texto antes de colar os dados e envie a planilha de novo.`
          );
        }
        cells.push(cell.value instanceof Date ? stringify(cell.value) : (cell.text ?? ""));
      }
      records.push(cells);
      if (records.length > MAX_ROWS + 1) throw new Error(`A planilha tem mais de ${MAX_ROWS} linhas`);
    }
    break;
  }
  if (records.length === 0) throw new Error("A planilha está vazia");
  return toTable(records[0], records.slice(1), modifiedAt);
}

/** CSV or XLSX, told apart by content (an XLSX is a zip: starts with "PK"). */
export async function parseSpreadsheet(buffer: Buffer, modifiedAt: Date | null): Promise<FetchedTable> {
  if (buffer.subarray(0, 2).toString("latin1") === "PK") return parseXlsx(buffer, modifiedAt);
  if (/^\s*<(!doctype|html)/i.test(buffer.subarray(0, 200).toString("utf8"))) {
    throw new Error("O link abriu uma página, não a planilha. Confira se o compartilhamento está como \"Qualquer pessoa com o link\".");
  }
  return parseCsv(buffer, modifiedAt);
}

function encodeShareUrl(url: string): string {
  return `u!${Buffer.from(url).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
}

/** The direct-download addresses to try for a shared link (OneDrive personal/business, Google Sheets or a file on Google Drive). */
export function downloadCandidates(link: string): string[] {
  const url = new URL(link);
  const google = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (google) {
    const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid");
    return [`https://docs.google.com/spreadsheets/d/${google[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`];
  }
  // An .xlsx/.csv file uploaded to Google Drive (not converted to Google Planilhas).
  const driveFile = url.hostname === "drive.google.com" ? (url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id")) : null;
  if (driveFile) return [`https://drive.google.com/uc?export=download&id=${driveFile}`];
  const withDownload = new URL(link);
  withDownload.searchParams.set("download", "1");
  if (/1drv\.ms|onedrive\.live\.com/.test(url.hostname)) {
    return [`https://api.onedrive.com/v1.0/shares/${encodeShareUrl(link)}/root/content`, withDownload.toString()];
  }
  return [withDownload.toString()];
}

/** Microsoft no longer lets anyone download from a new-style OneDrive share link (1drv.ms/x/c/…) without signing in. */
const ONEDRIVE_DENIED =
  'A Microsoft não permite mais baixar automaticamente planilhas pelo link de compartilhamento do OneDrive, mesmo com "Qualquer pessoa com o link". Use "Planilha privada (conta Microsoft)", um link do Google Planilhas ou "Enviar arquivo".';

export async function fetchFromLink(link: string): Promise<FetchedTable> {
  const isOneDrive = /1drv\.ms|onedrive\.live\.com/.test(new URL(link).hostname);
  let lastError: Error = new Error("Não foi possível baixar a planilha do link");
  for (const candidate of downloadCandidates(link)) {
    try {
      const res = await fetch(candidate, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        if (isOneDrive && (res.status === 401 || res.status === 403)) throw new Error(ONEDRIVE_DENIED);
        throw new Error(`O link respondeu ${res.status}. Confira se o compartilhamento está como "Qualquer pessoa com o link".`);
      }
      const modified = res.headers.get("last-modified");
      return await parseSpreadsheet(Buffer.from(await res.arrayBuffer()), modified ? new Date(modified) : null);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError;
}

// --- Microsoft (private OneDrive/SharePoint file) ---------------------------

export const MICROSOFT_SCOPE = "offline_access Files.Read.All User.Read";

export interface MicrosoftApp {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function microsoftAuthorizeUrl(app: MicrosoftApp, state: string): string {
  const params = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: app.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPE,
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(app.tenantId)}/oauth2/v2.0/authorize?${params}`;
}

/** Exchanges an authorization code or a refresh token; Microsoft rotates the refresh token on every use. */
export async function microsoftToken(app: MicrosoftApp, grant: { code: string } | { refreshToken: string }) {
  const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, scope: MICROSOFT_SCOPE });
  if ("code" in grant) {
    body.set("grant_type", "authorization_code");
    body.set("code", grant.code);
  } else {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", grant.refreshToken);
  }
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(app.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`A conta Microsoft recusou o acesso: ${json.error_description?.split("\r\n")[0] ?? res.status}. Entre de novo com a conta Microsoft.`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null };
}

export async function fetchFromMicrosoft(shareUrl: string, accessToken: string): Promise<FetchedTable> {
  const base = `https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(shareUrl)}/driveItem`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const meta = await fetch(base, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!meta.ok) throw new Error(`O arquivo não foi encontrado na conta Microsoft (${meta.status}). Confira o link e se a conta tem acesso a ele.`);
  const item = (await meta.json()) as { lastModifiedDateTime?: string };
  const content = await fetch(`${base}/content`, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!content.ok) throw new Error(`Não foi possível baixar o arquivo da conta Microsoft (${content.status})`);
  return parseSpreadsheet(Buffer.from(await content.arrayBuffer()), item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null);
}

// --- Database (read-only) ----------------------------------------------------

export interface DatabaseConfig {
  dialect: DataSourceDialect;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  query: string;
}

/** Only a single SELECT (or WITH … SELECT) — this integration never writes. */
export function assertReadOnlyQuery(query: string): void {
  const sql = query.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(sql) || sql.includes(";")) throw new Error("A consulta precisa ser um único SELECT");
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|into)\b/i.test(sql)) {
    throw new Error("A consulta só pode ler dados (SELECT), sem alterar nada");
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10).split("-").reverse().join("/");
  return String(value);
}

function rowsToTable(records: Record<string, unknown>[], columnNames: string[]): FetchedTable {
  return toTable(
    columnNames,
    records.map((r) => columnNames.map((c) => stringify(r[c]))),
    new Date()
  );
}

export async function fetchFromDatabase(config: DatabaseConfig): Promise<FetchedTable> {
  assertReadOnlyQuery(config.query);
  if (config.dialect === "sqlserver") {
    const mssql = await import("mssql");
    const pool = await new mssql.ConnectionPool({
      server: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      requestTimeout: FETCH_TIMEOUT_MS,
      options: { encrypt: false, trustServerCertificate: true, readOnlyIntent: true },
    }).connect();
    try {
      const result = await pool.request().query(config.query);
      return rowsToTable(result.recordset, Object.keys(result.recordset.columns ?? {}));
    } finally {
      await pool.close();
    }
  }
  if (config.dialect === "postgres") {
    const { Client } = await import("pg");
    const client = new Client({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, statement_timeout: FETCH_TIMEOUT_MS });
    await client.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(config.query);
      await client.query("ROLLBACK");
      return rowsToTable(result.rows, result.fields.map((f) => f.name));
    } finally {
      await client.end();
    }
  }
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, connectTimeout: FETCH_TIMEOUT_MS });
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const [rows, fields] = await connection.query({ sql: config.query, timeout: FETCH_TIMEOUT_MS });
    await connection.query("ROLLBACK");
    return rowsToTable(rows as Record<string, unknown>[], (fields as { name: string }[]).map((f) => f.name));
  } finally {
    await connection.end();
  }
}
