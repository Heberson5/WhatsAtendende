import PDFDocument from "pdfkit";

export interface BoletoPdfData {
  /** "001-9" — the bank code with its own check digit. */
  bankLabel: string;
  bankName: string;
  linha: string;
  barcode: string;
  due: string;
  value: string;
  /** The day the PDF is made — Data do documento / Data de processamento. */
  issued: string;
  ourNumber: string;
  document: string | null;
  contract: string;
  wallet: string;
  payeeName: string;
  payeeDocument: string | null;
  agencyAccount: string;
  payerName: string;
  payerDocument: string | null;
  payerAddress: string | null;
  /** CEP and city, the last line of the sacado. */
  payerLocality: string | null;
}

// Interleaved 2 of 5: each digit as 5 elements, 1 = wide. Narrow = 0.254 mm (FEBRABAN), the barcode ≈ 103 mm.
const I25 = ["00110", "10001", "01001", "11000", "00101", "10100", "01100", "00011", "10010", "01010"];
const NARROW = 0.72;
const WIDE = NARROW * 3;

// A4 in points: three boletos per page, one under the other, each cut along a dashed line.
const BOLETOS_PER_PAGE = 3;
const PAGE_MARGIN = 18;
const SLOT_HEIGHT = 268;
const STUB_X = PAGE_MARGIN;
const STUB_WIDTH = 100;
const SLIP_X = 126;
const SLIP_WIDTH = 451;
const SIDE_WIDTH = 112; // the slip's right column: vencimento, valores
const ROW = 18;
const SIDE_ROW = 17;

const LINE = "#4a6a9a";
const LABEL = "#333";
const HIGHLIGHT = "#fbf3a6";
const BANK_YELLOW = "#fcea16";
const BANK_BLUE = "#173c80";

function drawBarcode(doc: PDFKit.PDFDocument, code: string, x: number, y: number, height: number) {
  let cursor = x;
  const bar = (wide: boolean, black: boolean) => {
    const w = wide ? WIDE : NARROW;
    if (black) doc.rect(cursor, y, w, height).fill("#000");
    cursor += w;
  };
  [false, false, false, false].forEach((w, i) => bar(w, i % 2 === 0)); // start: narrow bar/space x2
  for (let i = 0; i < code.length; i += 2) {
    const bars = I25[Number(code[i])];
    const spaces = I25[Number(code[i + 1])];
    for (let j = 0; j < 5; j++) {
      bar(bars[j] === "1", true);
      bar(spaces[j] === "1", false);
    }
  }
  bar(true, true); // stop: wide bar, narrow space, narrow bar
  bar(false, false);
  bar(false, true);
}

function text(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  options: { bold?: boolean; align?: "left" | "right"; color?: string } = {}
) {
  doc
    .fillColor(options.color ?? "#000")
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(size)
    .text(value, x, y, { width, align: options.align ?? "left", lineBreak: false, ellipsis: true });
}

interface CellOptions {
  bold?: boolean;
  align?: "left" | "right";
  highlight?: boolean;
  /** Slip cells are boxed; stub cells only have a line under them. */
  boxed?: boolean;
}

function cell(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, label: string, value: string, options: CellOptions = {}) {
  if (options.highlight) doc.rect(x, y, w, h).fill(HIGHLIGHT);
  doc.lineWidth(0.6).strokeColor(LINE);
  if (options.boxed) doc.rect(x, y, w, h).stroke();
  else doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke();
  text(doc, label, x + 2, y + 1.5, w - 4, 5, { color: LABEL });
  if (value) text(doc, value, x + 3, y + h - 8.5, w - 6, 6.5, { bold: options.bold, align: options.align });
}

function bankHeader(doc: PDFKit.PDFDocument, data: BoletoPdfData, x: number, y: number, label: string) {
  doc.rect(x, y + 3, 72, 10).fill(BANK_YELLOW);
  text(doc, data.bankName.toUpperCase(), x + 2, y + 5.5, 68, 6.5, { bold: true, color: BANK_BLUE });
  doc.lineWidth(1).strokeColor(LINE).moveTo(x + 75, y + 1).lineTo(x + 75, y + 16).stroke();
  text(doc, label, x + 78, y + 4, 40, 9, { bold: true, color: "#666" });
}

/** Recibo do sacado: the narrow stub on the left, kept by the client. */
function drawStub(doc: PDFKit.PDFDocument, data: BoletoPdfData, top: number) {
  const x = STUB_X;
  const w = STUB_WIDTH;
  bankHeader(doc, data, x, top, data.bankLabel.split("-")[0]);
  doc.lineWidth(1).strokeColor(LINE).moveTo(x, top + 18).lineTo(x + w, top + 18).stroke();
  let y = top + 19;
  const stacked: [string, string, CellOptions?][] = [
    ["Vencimento", data.due, { align: "right" }],
    ["Agência / Código Cedente", data.agencyAccount, { align: "right" }],
    ["Nosso Número", data.ourNumber, { align: "right" }],
    ["Número do Documento", data.document ?? data.contract],
  ];
  for (const [label, value, options] of stacked) {
    cell(doc, x, y, w, ROW, label, value, options);
    y += ROW;
  }
  cell(doc, x, y, w * 0.45, ROW, "Espécie Moeda", "R$");
  cell(doc, x + w * 0.45, y, w * 0.55, ROW, "Carteira", data.wallet);
  y += ROW;
  cell(doc, x, y, w * 0.45, ROW, "Aceite", "N");
  y += ROW;
  const valueRow = SIDE_ROW - 2;
  const values: [string, string][] = [
    ["1 (=) Valor do Documento", data.value],
    ["2 (-) Desconto / Abatimento", ""],
    ["3 (-) Outras Deduções", ""],
    ["4 (+) Mora / Multa", ""],
    ["5 (+) Outros Acréscimos", ""],
    ["6 (=) Valor Cobrado", ""],
  ];
  for (const [label, value] of values) {
    cell(doc, x, y, w, valueRow, label, value, { align: "right" });
    y += valueRow;
  }
  cell(doc, x, y, w, 22, "Sacado", data.payerName);
  y += 25;
  text(doc, "Recibo do Sacado", x + 1, y, w, 5.5, { color: LABEL });
  text(doc, "autenticar no verso", x, y + 8, w, 4.5, { align: "right", color: LABEL });
}

/** Ficha de compensação: what the bank reads, with the barcode. */
function drawSlip(doc: PDFKit.PDFDocument, data: BoletoPdfData, top: number) {
  const x = SLIP_X;
  const main = SLIP_WIDTH - SIDE_WIDTH;
  const side = x + main;
  bankHeader(doc, data, x, top, data.bankLabel);
  text(doc, data.linha, x + 150, top + 4, SLIP_WIDTH - 150, 10, { bold: true, align: "right" });
  let y = top + 19;

  cell(doc, x, y, main, ROW, "Local de Pagamento", "Pagável em qualquer banco até o vencimento", { boxed: true });
  cell(doc, side, y, SIDE_WIDTH, ROW, "Vencimento", data.due, { boxed: true, align: "right", highlight: true });
  y += ROW;
  cell(doc, x, y, main, ROW, "Cedente", data.payeeName, { boxed: true });
  if (data.payeeDocument) text(doc, data.payeeDocument, x + main - 120, y + ROW - 8.5, 117, 6.5, { align: "right" });
  cell(doc, side, y, SIDE_WIDTH, ROW, "Agência / Código Cedente", data.agencyAccount, { boxed: true, align: "right" });
  y += ROW;
  const documentRow: [string, string, number][] = [
    ["Data do Documento", data.issued, 0.21],
    ["Número do Documento", data.document ?? data.contract, 0.22],
    ["Espécie Documento", "DM", 0.17],
    ["Aceite", "N", 0.13],
    ["Data Process.", data.issued, 0.27],
  ];
  let cx = x;
  for (const [label, value, share] of documentRow) {
    cell(doc, cx, y, main * share, ROW, label, value, { boxed: true });
    cx += main * share;
  }
  cell(doc, side, y, SIDE_WIDTH, ROW, "Nosso Número", data.ourNumber, { boxed: true, align: "right" });
  y += ROW;
  const bankRow: [string, string, number][] = [
    ["Uso do Banco", "", 0.12],
    ["Cip", "", 0.09],
    ["Carteira", data.wallet, 0.17],
    ["Espécie Moeda", "R$", 0.17],
    ["Quantidade", "", 0.17],
    ["Valor", "", 0.28],
  ];
  cx = x;
  for (const [label, value, share] of bankRow) {
    cell(doc, cx, y, main * share, ROW, label, value, { boxed: true });
    cx += main * share;
  }
  cell(doc, side, y, SIDE_WIDTH, ROW, "1 (=) Valor do Documento", data.value, { boxed: true, align: "right", highlight: true, bold: true });
  y += ROW;

  const instructionsHeight = SIDE_ROW * 5;
  cell(doc, x, y, main, instructionsHeight, "Instruções de responsabilidade do Cedente", "", { boxed: true });
  const instructions = [
    "-> Após o vencimento o banco pode cobrar juros e multa.",
    `-> Contrato: ${data.contract}${data.document ? ` · Documento: ${data.document}` : ""}`,
  ];
  instructions.forEach((line, i) => text(doc, line, x + 8, y + 10 + i * 8.5, main - 16, 6.5));
  ["2 (-) Desconto / Abatimento", "3 (-) Outras Deduções", "4 (+) Mora / Multa", "5 (+) Outros Acréscimos", "6 (=) Valor Cobrado"].forEach((label, i) =>
    cell(doc, side, y + i * SIDE_ROW, SIDE_WIDTH, SIDE_ROW, label, "", { boxed: true })
  );
  y += instructionsHeight;

  const payerHeight = 36;
  doc.lineWidth(0.6).strokeColor(LINE).rect(x, y, SLIP_WIDTH, payerHeight).stroke();
  text(doc, "Sacado:", x + 2, y + 1.5, 60, 5, { color: LABEL });
  text(doc, `${data.payerName}  (${data.contract})`, x + 8, y + 8, main - 70, 6.5, { bold: true });
  if (data.payerDocument) text(doc, data.payerDocument, side - 60, y + 8, 120, 6.5, { bold: true });
  if (data.payerAddress) text(doc, data.payerAddress, x + 8, y + 16.5, SLIP_WIDTH - 16, 6.5, { bold: true });
  if (data.payerLocality) text(doc, data.payerLocality, x + 8, y + 25, SLIP_WIDTH - 16, 6.5, { bold: true });
  y += payerHeight;
  text(doc, "Sacador / Avalista:", x + 2, y + 1.5, 100, 5, { color: LABEL });
  doc.lineWidth(1).strokeColor(LINE).moveTo(x, y + 8).lineTo(x + SLIP_WIDTH, y + 8).stroke();
  text(doc, "Ficha de Compensação", side - 20, y + 11, SIDE_WIDTH + 20, 8, { bold: true, align: "right", color: "#777" });
  drawBarcode(doc, data.barcode, x + 6, y + 11, 37);
}

/**
 * The boletos in one PDF, three to a page one under the other — each with the recibo do sacado on the left and the
 * ficha de compensação (whose barcode is the one the linha digitável encodes) on the right.
 */
export function renderBoletosPdf(boletos: BoletoPdfData[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    boletos.forEach((data, i) => {
      const slot = i % BOLETOS_PER_PAGE;
      if (slot === 0) doc.addPage();
      const top = PAGE_MARGIN + slot * SLOT_HEIGHT;
      drawStub(doc, data, top);
      drawSlip(doc, data, top);
      const cut = top + SLOT_HEIGHT - 6;
      doc.lineWidth(0.5).strokeColor("#888").dash(1, { space: 2.5 }).moveTo(PAGE_MARGIN, cut).lineTo(SLIP_X + SLIP_WIDTH, cut).stroke().undash();
    });
    doc.end();
  });
}
