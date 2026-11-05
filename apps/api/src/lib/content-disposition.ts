/**
 * A Content-Disposition value that keeps the file's real name, accents included: `filename*` (RFC 5987/6266) carries
 * it in UTF-8 for every current browser, and `filename` a plain-ASCII version ("Manutencao.xlsx") for anything older.
 * Putting the percent-encoded name in plain `filename` — as before — made a saved file come out as
 * "Manuten%C3%A7%C3%A3o.pdf".
 */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
