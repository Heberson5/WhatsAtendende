import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { BOLETO_SAMPLES_REQUIRED, type BoletoBankValidationDTO, type BoletoPreviewDTO, type BoletoPreviewItemDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { env } from "../../config/env";
import { buildContracts, clientRows, parseBrDate, usableSource, type ColumnMap, type ConversationForData, type Row } from "../data-sources/data-sources.service";
import { barcodeFromLinha, buildBarcode, freeFieldBB, linhaFromBarcode } from "./boleto-code";
import { renderBoletoPdf } from "./boleto-pdf";

// Only Banco do Brasil boletos are sent.
export const BANKS: Record<string, { name: string; label: string }> = {
  "001": { name: "Banco do Brasil", label: "001-9" },
};

// Payment methods (forma_pagamento) that never get a boleto.
const NO_BOLETO_METHODS = [/cart[aã]o recorrente/i, /sem boleto/i];

const VALIDATION_KEY = "boleto-validation";
type ValidationState = Record<string, { matched: string[]; lastFailure: string | null }>;

async function readValidation(): Promise<ValidationState> {
  const row = await prisma.systemSetting.findUnique({ where: { key: VALIDATION_KEY } });
  return (row?.value as ValidationState | undefined) ?? {};
}

async function writeValidation(state: ValidationState) {
  const value = state as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({ where: { key: VALIDATION_KEY }, update: { value }, create: { key: VALIDATION_KEY, value } });
}

export async function getValidation(): Promise<BoletoBankValidationDTO[]> {
  const state = await readValidation();
  return Object.entries(BANKS).map(([code, bank]) => {
    const matched = state[code]?.matched.length ?? 0;
    return { code, name: bank.name, matched, required: BOLETO_SAMPLES_REQUIRED, enabled: matched >= BOLETO_SAMPLES_REQUIRED, lastFailure: state[code]?.lastFailure ?? null };
  });
}

function digits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** "1.234,56", "1234.56" or "89,9" → cents. */
export function parseMoneyCents(value: string | undefined): number | null {
  const raw = (value ?? "").replace(/[^\d.,-]/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface BuiltBoleto {
  bank: string;
  due: Date;
  cents: number;
  ourNumber: string;
  barcode: string;
  linha: string;
}

/** The boleto of one source row — or the reason it can't be generated. Nothing typed by a person goes in. */
export function buildBoletoFromRow(data: Row, map: ColumnMap): BuiltBoleto {
  const col = (role: keyof ColumnMap) => (map[role] ? data[map[role]!] : undefined);
  const method = col("paymentMethod") ?? "";
  if (NO_BOLETO_METHODS.some((re) => re.test(method))) throw new Error(`Parcela sem boleto: ${method}`);
  const bank = digits(col("bankCode")).padStart(3, "0");
  if (!BANKS[bank]) throw new Error(`Banco ${bank || "não informado"} não tem envio de boleto`);
  const due = parseBrDate(col("boletoDue")) ?? parseBrDate(col("parcelDue"));
  if (!due) throw new Error("Parcela sem vencimento");
  const cents = parseMoneyCents(col("boletoValue")) ?? parseMoneyCents(col("parcelValue"));
  if (!cents) throw new Error("Parcela sem valor");
  const ourNumber = col("ourNumber") ?? "";
  if (!digits(ourNumber)) throw new Error("Parcela sem nosso número");
  const free = freeFieldBB(col("agreement") ?? "", ourNumber, col("wallet") ?? "");
  const barcode = buildBarcode(bank, due, cents, free);
  const linha = linhaFromBarcode(barcode);
  if (barcodeFromLinha(linha) !== barcode) throw new Error("A linha digitável não passou na conferência dos dígitos");
  return { bank, due, cents, ourNumber, barcode, linha };
}

/**
 * Admin check before a bank is enabled: the nosso número and the linha of a
 * REAL boleto. The system builds it from the source row with that nosso
 * número; it only counts when the two linhas are identical.
 */
export async function submitValidationSample(ourNumber: string, realLinha: string): Promise<BoletoBankValidationDTO[]> {
  const source = await usableSource();
  if (!source) throw Errors.badRequest("Ative uma fonte de dados funcionando antes de validar boletos");
  const map = source.columnMap as ColumnMap;
  if (!map.ourNumber) throw Errors.badRequest("A fonte não tem a coluna do nosso número");
  const realBarcode = barcodeFromLinha(realLinha);
  if (!realBarcode) throw Errors.badRequest("A linha digitável informada tem dígitos verificadores errados — confira a digitação");
  const bank = realBarcode.slice(0, 3);
  if (!BANKS[bank]) throw Errors.badRequest("Banco sem envio de boleto");
  const wanted = digits(ourNumber);
  const rows = await prisma.dataSourceRow.findMany({
    where: { dataSourceId: source.id, data: { path: [map.ourNumber], equals: ourNumber.trim() } },
    take: 1,
  });
  const row = rows[0] ?? (await prisma.dataSourceRow.findMany({ where: { dataSourceId: source.id } })).find((r) => digits((r.data as Row)[map.ourNumber!]) === wanted);
  if (!row) throw Errors.badRequest("Nenhuma parcela da fonte de dados tem esse nosso número");

  const state = await readValidation();
  const bankState = state[bank] ?? { matched: [], lastFailure: null };
  let failure: string | null = null;
  try {
    const built = buildBoletoFromRow(row.data as Row, map);
    if (built.barcode !== realBarcode) failure = `A linha gerada (${built.linha}) é diferente da linha real`;
  } catch (err) {
    failure = (err as Error).message;
  }
  if (failure) bankState.lastFailure = failure;
  else if (!bankState.matched.includes(wanted)) bankState.matched.push(wanted);
  state[bank] = bankState;
  await writeValidation(state);
  if (failure) throw Errors.badRequest(`Não confere: ${failure}. O envio deste banco continua bloqueado.`);
  return getValidation();
}

export async function resetValidation(bank: string): Promise<BoletoBankValidationDTO[]> {
  const state = await readValidation();
  delete state[bank];
  await writeValidation(state);
  return getValidation();
}

interface SelectedParcel {
  rowId: string;
  data: Row;
  contract: string;
  document: string | null;
  boleto: BuiltBoleto;
}

/**
 * The parcels picked, checked: same client, every older open parcel of the
 * same contract included (no skipping), bank validated, boleto generated.
 */
async function resolveSelection(conversation: ConversationForData, parcelIds: string[]): Promise<{ map: ColumnMap; parcels: SelectedParcel[] }> {
  const source = await usableSource();
  if (!source) throw Errors.badRequest("Dados do cliente indisponíveis no momento");
  const { map, byClient, selectedKey } = await clientRows(source, conversation);
  if (!selectedKey) throw Errors.badRequest("Escolha o cliente primeiro");
  const rows = byClient.get(selectedKey)!;
  const contracts = buildContracts(rows, map);
  const validation = await getValidation();
  const selected = new Set(parcelIds);
  const parcels: SelectedParcel[] = [];
  for (const contract of contracts) {
    const picked = contract.parcels.filter((p) => selected.has(p.id));
    if (picked.length === 0) continue;
    const lastPicked = contract.parcels.findIndex((p) => p.id === picked[picked.length - 1].id);
    const skipped = contract.parcels.slice(0, lastPicked).find((p) => !selected.has(p.id));
    if (skipped) throw Errors.badRequest(`Envie primeiro a parcela de ${skipped.due} — não é possível pular parcelas mais antigas`);
    for (const parcel of picked) {
      const row = rows.find((r) => r.id === parcel.id)!;
      let boleto: BuiltBoleto;
      try {
        boleto = buildBoletoFromRow(row.data, map);
      } catch (err) {
        throw Errors.badRequest(`Parcela de ${parcel.due}: ${(err as Error).message}`);
      }
      if (!validation.find((v) => v.code === boleto.bank)?.enabled) {
        throw Errors.badRequest(`O envio de boleto do ${BANKS[boleto.bank].name} ainda não foi liberado (falta validar com boletos reais)`);
      }
      parcels.push({ rowId: row.id, data: row.data, contract: contract.number, document: parcel.document, boleto });
    }
    parcelIds = parcelIds.filter((id) => !picked.some((p) => p.id === id));
  }
  if (parcelIds.length > 0 || parcels.length === 0) throw Errors.badRequest("Parcela não encontrada para este cliente");
  return { map, parcels };
}

function previewItem(p: SelectedParcel, today: Date): BoletoPreviewItemDTO {
  return {
    parcelId: p.rowId,
    contract: p.contract,
    document: p.document,
    due: format(p.boleto.due, "dd/MM/yyyy"),
    value: formatMoney(p.boleto.cents),
    overdue: p.boleto.due < today,
    linha: p.boleto.linha,
  };
}

function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function previewBoletos(conversation: ConversationForData & { contact: { name: string | null; phone: string | null } }, parcelIds: string[]): Promise<BoletoPreviewDTO> {
  const { map, parcels } = await resolveSelection(conversation, parcelIds);
  const today = todayStart();
  const items = parcels.map((p) => previewItem(p, today));
  const clientName = (map.clientName && parcels[0].data[map.clientName]) || conversation.contact.name || "";
  const firstName = clientName.split(" ")[0];
  return {
    items,
    message:
      items.length === 1
        ? `Olá${firstName ? `, ${firstName}` : ""}! Segue o boleto da parcela com vencimento em ${items[0].due}, no valor de ${items[0].value}. Logo abaixo vai a linha digitável para pagar pelo aplicativo do banco.`
        : `Olá${firstName ? `, ${firstName}` : ""}! Seguem os boletos de ${items.length} parcelas. Depois de cada arquivo vai a linha digitável para pagar pelo aplicativo do banco.`,
    warnings: items.filter((i) => i.overdue).map((i) => `Boleto vencido em ${i.due} — o banco pode cobrar juros ou recusar`),
  };
}

export interface PreparedBoleto {
  item: BoletoPreviewItemDTO;
  pdf: Buffer;
  fileName: string;
  storageKey: string;
}

/** Builds the PDFs (saved to uploads) for sending; the caller sends and records them. */
export async function prepareBoletos(
  conversation: ConversationForData & { contact: { name: string | null; phone: string | null } },
  parcelIds: string[],
  confirmOverdue: boolean
): Promise<PreparedBoleto[]> {
  const { map, parcels } = await resolveSelection(conversation, parcelIds);
  const today = todayStart();
  const col = (data: Row, role: keyof ColumnMap) => (map[role] ? data[map[role]!] : undefined) || null;
  const prepared: PreparedBoleto[] = [];
  for (const p of parcels) {
    const item = previewItem(p, today);
    if (item.overdue && !confirmOverdue) throw Errors.badRequest(`Boleto vencido em ${item.due} — confirme o envio`);
    const pdf = await renderBoletoPdf({
      bankLabel: BANKS[p.boleto.bank].label,
      bankName: BANKS[p.boleto.bank].name,
      linha: p.boleto.linha,
      barcode: p.boleto.barcode,
      due: item.due,
      value: item.value,
      ourNumber: p.boleto.ourNumber,
      document: p.document,
      contract: p.contract,
      payeeName: col(p.data, "payeeName") ?? "",
      payeeDocument: col(p.data, "payeeDocument"),
      agencyAccount: [col(p.data, "agency"), col(p.data, "account")].filter(Boolean).join(" / "),
      payerName: col(p.data, "clientName") ?? conversation.contact.name ?? "",
      payerDocument: col(p.data, "cpf"),
      payerAddress: [col(p.data, "payerAddress"), col(p.data, "payerCity"), col(p.data, "payerZip")].filter(Boolean).join(" — ") || null,
    });
    const storageKey = `${randomUUID()}.pdf`;
    fs.writeFileSync(path.join(env.UPLOAD_DIR, storageKey), pdf);
    prepared.push({ item, pdf, storageKey, fileName: `boleto-${p.contract}-${item.due.replace(/\//g, "-")}.pdf` });
  }
  return prepared;
}

