import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma";

export interface ReportParams {
  from: Date;
  to: Date;
  agentId?: string;
  /** Empty/undefined = every WhatsApp connection — see PROMPT: filtro podendo selecionar várias ou todas. */
  connectionIds?: string[];
}

function minutes(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 60000);
}

export async function getAttendanceReport({ from, to, agentId, connectionIds }: ReportParams) {
  const connectionFilter = connectionIds?.length ? { in: connectionIds } : undefined;
  const conversations = await prisma.conversation.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      assignedAgentId: agentId,
      ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}),
    },
    include: {
      contact: true,
      assignedAgent: true,
      whatsappConnection: true,
      messages: { select: { direction: true } },
      transfers: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return conversations.map((c) => {
    const received = c.messages.filter((m) => m.direction === "INBOUND").length;
    const sent = c.messages.filter((m) => m.direction === "OUTBOUND").length;
    const acceptMs = c.acceptedAt ? c.acceptedAt.getTime() - c.enteredQueueAt.getTime() : null;
    const firstResponseMs = c.acceptedAt && c.firstResponseAt ? c.firstResponseAt.getTime() - c.acceptedAt.getTime() : null;
    const totalMs = c.closedAt ? c.closedAt.getTime() - c.enteredQueueAt.getTime() : null;

    return {
      date: c.createdAt.toISOString(),
      connection: c.whatsappConnection.name,
      clientName: c.contact.name ?? c.contact.phone,
      phone: c.contact.phone,
      agentName: c.assignedAgent?.displayName ?? "-",
      enteredQueueAt: c.enteredQueueAt.toISOString(),
      acceptedAt: c.acceptedAt ? c.acceptedAt.toISOString() : null,
      acceptMinutes: minutes(acceptMs),
      firstResponseMinutes: minutes(firstResponseMs),
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      totalMinutes: minutes(totalMs),
      messagesReceived: received,
      messagesSent: sent,
      transfersCount: c.transfers.length,
      status: c.status,
    };
  });
}

export async function getPerAgentReport({ from, to, connectionIds }: ReportParams) {
  const connectionFilter = connectionIds?.length ? { in: connectionIds } : undefined;
  const agents = await prisma.user.findMany({ where: { role: "AGENT" }, orderBy: { displayName: "asc" } });

  return Promise.all(
    agents.map(async (agent) => {
      const conversations = await prisma.conversation.findMany({
        where: { assignedAgentId: agent.id, createdAt: { gte: from, lte: to }, ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}) },
      });
      const messagesSent = await prisma.message.count({
        where: {
          senderAgentId: agent.id,
          createdAt: { gte: from, lte: to },
          ...(connectionFilter ? { conversation: { whatsappConnectionId: connectionFilter } } : {}),
        },
      });
      const transfersReceived = await prisma.conversationTransfer.count({
        where: { toAgentId: agent.id, createdAt: { gte: from, lte: to }, ...(connectionFilter ? { conversation: { whatsappConnectionId: connectionFilter } } : {}) },
      });
      const transfersMade = await prisma.conversationTransfer.count({
        where: { fromAgentId: agent.id, createdAt: { gte: from, lte: to }, ...(connectionFilter ? { conversation: { whatsappConnectionId: connectionFilter } } : {}) },
      });

      const acceptDiffs = conversations.filter((c) => c.acceptedAt).map((c) => c.acceptedAt!.getTime() - c.enteredQueueAt.getTime());
      const firstResponseDiffs = conversations
        .filter((c) => c.acceptedAt && c.firstResponseAt)
        .map((c) => c.firstResponseAt!.getTime() - c.acceptedAt!.getTime());
      const handlingDiffs = conversations.filter((c) => c.acceptedAt && c.closedAt).map((c) => c.closedAt!.getTime() - c.acceptedAt!.getTime());

      const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 60000) : null);

      return {
        agentName: agent.displayName,
        conversations: conversations.length,
        messagesSent,
        avgAcceptMinutes: avg(acceptDiffs),
        avgFirstResponseMinutes: avg(firstResponseDiffs),
        avgHandlingMinutes: avg(handlingDiffs),
        transfersReceived,
        transfersMade,
      };
    })
  );
}

export async function getMessagesReport({ from, to, agentId, connectionIds }: ReportParams) {
  const connectionFilter = connectionIds?.length ? { in: connectionIds } : undefined;
  const conversationFilter = {
    ...(agentId ? { assignedAgentId: agentId } : {}),
    ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}),
  };
  const [received, sent] = await Promise.all([
    prisma.message.count({ where: { direction: "INBOUND", createdAt: { gte: from, lte: to }, conversation: conversationFilter } }),
    prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: from, lte: to }, conversation: conversationFilter } }),
  ]);
  return { received, sent, total: received + sent };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))];
  return lines.join("\n");
}

/** Spreadsheet export — see PROMPT: "Relatórios poder extrair em ... xlsx." */
export async function toXlsx(rows: Record<string, unknown>[], sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WhatsAtendende";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31)); // Excel's own sheet-name length limit

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    sheet.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(Math.max(h.length + 4, 14), 40) }));
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0097B4" } };
    rows.forEach((row) => sheet.addRow(row));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** PDF export — see PROMPT: "Relatórios poder extrair em PDF". A plain, readable tabular layout — no external headless-browser dependency. */
export function toPdf(rows: Record<string, unknown>[], title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).fillColor("#14202b").text(title);
    doc.fontSize(9).fillColor("#64748b").text(`Gerado em ${new Date().toLocaleString("pt-BR")}`);
    doc.moveDown();

    if (rows.length === 0) {
      doc.fontSize(11).fillColor("#14202b").text("Nenhum dado para o periodo selecionado.");
      doc.end();
      return;
    }

    const headers = Object.keys(rows[0]);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / headers.length;
    const rowHeight = 20;
    let y = doc.y;

    const drawRow = (values: string[], opts: { header?: boolean; shaded?: boolean }) => {
      if (opts.header) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill("#0097B4");
      } else if (opts.shaded) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill("#f4f7f9");
      }
      doc.fontSize(8).fillColor(opts.header ? "#ffffff" : "#14202b");
      values.forEach((value, i) => {
        doc.text(value, doc.page.margins.left + i * colWidth + 4, y + 6, { width: colWidth - 8, height: rowHeight, ellipsis: true });
      });
      y += rowHeight;
    };

    drawRow(headers, { header: true });
    rows.forEach((row, idx) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawRow(headers, { header: true });
      }
      drawRow(
        headers.map((h) => (row[h] === null || row[h] === undefined ? "-" : String(row[h]))),
        { shaded: idx % 2 === 1 }
      );
    });

    doc.end();
  });
}
