import PDFDocument from "pdfkit";

export interface BoletoPdfData {
  /** "001-9" — the bank code with its own check digit. */
  bankLabel: string;
  bankName: string;
  linha: string;
  barcode: string;
  due: string;
  value: string;
  ourNumber: string;
  document: string | null;
  contract: string;
  payeeName: string;
  payeeDocument: string | null;
  agencyAccount: string;
  payerName: string;
  payerDocument: string | null;
  payerAddress: string | null;
}

// Interleaved 2 of 5: each digit as 5 elements, 1 = wide.
const I25 = ["00110", "10001", "01001", "11000", "00101", "10100", "01100", "00011", "10010", "01010"];
const NARROW = 0.96;
const WIDE = NARROW * 3;

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

function box(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, label: string, value: string, bold = false) {
  doc.rect(x, y, w, h).lineWidth(0.5).stroke("#000");
  doc.fillColor("#444").font("Helvetica").fontSize(6).text(label, x + 3, y + 2, { width: w - 6 });
  doc.fillColor("#000").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(value, x + 3, y + 11, { width: w - 6, ellipsis: true, lineBreak: false });
}

/** A one-page boleto (ficha de compensação) — the barcode is the same one the linha digitável encodes. */
export function renderBoletoPdf(data: BoletoPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 36;
    const width = 523;
    let y = 60;
    doc.font("Helvetica-Bold").fontSize(14).text(data.bankName, left, y);
    doc.fontSize(14).text(`| ${data.bankLabel} |`, left + 190, y);
    doc.fontSize(11).text(data.linha, left + 260, y + 2, { width: width - 260, align: "right" });
    y += 24;
    const row = 26;
    box(doc, left, y, 400, row, "Local de pagamento", "Pagável em qualquer banco, lotérica ou aplicativo de banco");
    box(doc, left + 400, y, 123, row, "Vencimento", data.due, true);
    y += row;
    box(doc, left, y, 400, row, "Beneficiário", `${data.payeeName}${data.payeeDocument ? ` — CNPJ ${data.payeeDocument}` : ""}`);
    box(doc, left + 400, y, 123, row, "Agência / Código do beneficiário", data.agencyAccount);
    y += row;
    box(doc, left, y, 140, row, "Número do documento", data.document ?? "");
    box(doc, left + 140, y, 140, row, "Contrato", data.contract);
    box(doc, left + 280, y, 120, row, "Espécie", "R$");
    box(doc, left + 400, y, 123, row, "Nosso número", data.ourNumber);
    y += row;
    doc.rect(left, y, 400, 70).lineWidth(0.5).stroke("#000");
    doc.fillColor("#444").font("Helvetica").fontSize(6).text("Instruções", left + 3, y + 2);
    doc
      .fillColor("#000")
      .fontSize(8)
      .text("Boleto enviado pelo atendimento. Depois do vencimento o banco pode cobrar juros e multa ou recusar o pagamento.", left + 3, y + 12, { width: 394 });
    box(doc, left + 400, y, 123, 35, "(=) Valor do documento", data.value, true);
    box(doc, left + 400, y + 35, 123, 35, "(=) Valor cobrado", "");
    y += 70;
    doc.rect(left, y, width, 46).lineWidth(0.5).stroke("#000");
    doc.fillColor("#444").font("Helvetica").fontSize(6).text("Pagador", left + 3, y + 2);
    doc.fillColor("#000").fontSize(9).text(`${data.payerName}${data.payerDocument ? ` — CPF/CNPJ ${data.payerDocument}` : ""}`, left + 3, y + 12, { width: width - 6 });
    if (data.payerAddress) doc.fontSize(8).text(data.payerAddress, left + 3, y + 26, { width: width - 6 });
    y += 58;
    drawBarcode(doc, data.barcode, left, y, 50);
    doc.fillColor("#444").fontSize(6).text("Autenticação mecânica — Ficha de compensação", left + 330, y + 54, { width: 193, align: "right" });
    doc.end();
  });
}
