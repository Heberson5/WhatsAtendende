import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { logger } from "../../lib/logger";
import { computeMovableHolidays } from "../../lib/easter";
import type { HolidayScope } from "@prisma/client";

// States currently covered by the automatic municipal sync — see PROMPT:
// "por enquanto quero somente para o estado de MT". Extending coverage
// later is just adding a UF here; nothing else needs to change.
export const AUTO_SYNC_MUNICIPAL_STATES = ["MT"];

export interface HolidayFilter {
  scope?: HolidayScope;
  state?: string;
  year?: number;
}

export async function listHolidays(filter: HolidayFilter = {}) {
  return prisma.holiday.findMany({
    where: {
      scope: filter.scope,
      state: filter.state,
      year: filter.year,
    },
    orderBy: [{ date: "asc" }, { name: "asc" }],
  });
}

function dateKeyToDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export async function createManualHoliday(input: { date: string; name: string; scope: HolidayScope; state?: string | null; city?: string | null }) {
  validateScopeFields(input.scope, input.state ?? null, input.city ?? null);
  const date = dateKeyToDate(input.date);
  return prisma.holiday.create({
    data: {
      date,
      name: input.name,
      scope: input.scope,
      state: input.state ?? null,
      city: input.city ?? null,
      source: "MANUAL",
      year: date.getUTCFullYear(),
    },
  });
}

export async function updateManualHoliday(
  id: string,
  input: Partial<{ date: string; name: string; scope: HolidayScope; state: string | null; city: string | null }>
) {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound("Feriado nao encontrado");
  if (existing.source !== "MANUAL") {
    throw Errors.badRequest("Feriados importados automaticamente nao podem ser editados diretamente — exclua-o e cadastre manualmente se quiser alterar.");
  }
  const nextScope = input.scope ?? existing.scope;
  const nextState = "state" in input ? input.state ?? null : existing.state;
  const nextCity = "city" in input ? input.city ?? null : existing.city;
  validateScopeFields(nextScope, nextState, nextCity);
  const date = input.date ? dateKeyToDate(input.date) : existing.date;
  return prisma.holiday.update({
    where: { id },
    data: {
      date,
      name: input.name ?? existing.name,
      scope: nextScope,
      state: nextState,
      city: nextCity,
      year: date.getUTCFullYear(),
    },
  });
}

export async function deleteHoliday(id: string) {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound("Feriado nao encontrado");
  await prisma.holiday.delete({ where: { id } });
}

function validateScopeFields(scope: HolidayScope, state: string | null, city: string | null) {
  if (scope === "STATE" && !state) throw Errors.badRequest("Informe o estado para um feriado estadual");
  if (scope === "MUNICIPAL" && (!state || !city)) throw Errors.badRequest("Informe o estado e a cidade para um feriado municipal");
  if (scope === "NATIONAL" && (state || city)) throw Errors.badRequest("Feriado nacional nao deve ter estado/cidade");
}

/**
 * Whether `dateKey` (YYYY-MM-DD, already resolved to the caller's local
 * calendar day — see lib/access-schedule.ts) is a holiday that applies to
 * someone working in `state`/`city`. NATIONAL always applies; STATE only
 * when it matches `state`; MUNICIPAL only when both match — see PROMPT:
 * "já é automático identificando a cidade do usuário".
 */
export async function findApplicableHoliday(dateKey: string, state: string | null, city: string | null): Promise<{ name: string } | null> {
  const date = dateKeyToDate(dateKey);
  const holiday = await prisma.holiday.findFirst({
    where: {
      date,
      OR: [
        { scope: "NATIONAL" },
        ...(state ? [{ scope: "STATE" as const, state }] : []),
        ...(state && city ? [{ scope: "MUNICIPAL" as const, state, city }] : []),
      ],
    },
  });
  return holiday ? { name: holiday.name } : null;
}

/**
 * Inserts an AUTO holiday row unless an identical one (same
 * scope/state/city/date/name/source) already exists. Deliberately NOT a
 * Prisma `.upsert()`: the @@unique on Holiday includes nullable
 * state/city, and Postgres treats every NULL as distinct from every other
 * NULL in a unique index — an `ON CONFLICT` upsert would silently never
 * fire for NATIONAL (state/city both null) or STATE (city null) rows,
 * re-inserting a duplicate on every sync run. A findFirst-then-create
 * works correctly regardless of which fields are null.
 */
async function upsertAutoHoliday(input: { date: Date; name: string; scope: HolidayScope; state: string | null; city: string | null }) {
  const existing = await prisma.holiday.findFirst({
    where: { date: input.date, name: input.name, scope: input.scope, state: input.state, city: input.city, source: "AUTO" },
  });
  if (existing) return existing;
  return prisma.holiday.create({
    data: { ...input, source: "AUTO", year: input.date.getUTCFullYear() },
  });
}

// findFirst (not findUnique on the compound key) — Prisma's generated
// compound-unique-key input for HolidaySyncCursor doesn't accept null for
// its nullable members even though the columns themselves are nullable, so
// a plain filtered findFirst/upsert-by-hand is used instead throughout.
async function alreadySyncedThisYear(scope: HolidayScope, state: string | null, city: string | null, year: number): Promise<boolean> {
  const cursor = await prisma.holidaySyncCursor.findFirst({ where: { scope, state, city, year } });
  return Boolean(cursor);
}

async function markSynced(scope: HolidayScope, state: string | null, city: string | null, year: number) {
  const existing = await prisma.holidaySyncCursor.findFirst({ where: { scope, state, city, year } });
  if (existing) {
    await prisma.holidaySyncCursor.update({ where: { id: existing.id }, data: { syncedAt: new Date() } });
  } else {
    await prisma.holidaySyncCursor.create({ data: { scope, state, city, year } });
  }
}

interface BrasilApiHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  type: string;
}

/** Small, fixed set of Brazilian national holidays — used only if BrasilAPI is unreachable, so NATIONAL coverage never drops to zero. Movable ones come from computeMovableHolidays. */
function fixedNationalHolidays(year: number): { date: string; name: string }[] {
  return [
    { date: `${year}-01-01`, name: "Confraternização Universal" },
    { date: `${year}-04-21`, name: "Tiradentes" },
    { date: `${year}-05-01`, name: "Dia do Trabalho" },
    { date: `${year}-09-07`, name: "Independência do Brasil" },
    { date: `${year}-10-12`, name: "Nossa Senhora Aparecida" },
    { date: `${year}-11-02`, name: "Finados" },
    { date: `${year}-11-15`, name: "Proclamação da República" },
    { date: `${year}-11-20`, name: "Dia Nacional de Zumbi e da Consciência Negra" },
    { date: `${year}-12-25`, name: "Natal" },
  ];
}

/**
 * Fetches the current year's national holidays from BrasilAPI (free,
 * public, no key) and imports any not already on file — see PROMPT: "os
 * feriados nacionais... automaticamente". Falls back to a fixed list plus
 * our own Easter-based calculation if the API is unreachable, so this
 * never leaves NATIONAL coverage empty. Runs at most once per year (see
 * HolidaySyncCursor) regardless of how often it's called.
 */
export async function syncNationalHolidays(year: number): Promise<{ imported: number; skipped: boolean }> {
  if (await alreadySyncedThisYear("NATIONAL", null, null, year)) return { imported: 0, skipped: true };

  let holidays: { date: string; name: string }[];
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status}`);
    const data = (await res.json()) as BrasilApiHoliday[];
    if (!Array.isArray(data) || data.length === 0) throw new Error("BrasilAPI retornou uma lista vazia");
    holidays = data.map((h) => ({ date: h.date, name: h.name }));
  } catch (err) {
    logger.warn({ err, year }, "BrasilAPI indisponivel — usando lista nacional fixa + calculo de Pascoa como alternativa");
    const movable = computeMovableHolidays(year).map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name }));
    holidays = [...fixedNationalHolidays(year), ...movable];
  }

  let imported = 0;
  for (const h of holidays) {
    await upsertAutoHoliday({ date: dateKeyToDate(h.date), name: h.name, scope: "NATIONAL", state: null, city: null });
    imported++;
  }
  await markSynced("NATIONAL", null, null, year);
  return { imported, skipped: false };
}

/**
 * Municipal auto-sync, scoped to the cities users are actually registered
 * in for the states listed in AUTO_SYNC_MUNICIPAL_STATES — see PROMPT:
 * "Estas consultas na API será somente para as cidades que tem usuários
 * cadastrados... dentro do mesmo ano não irá realizar outra consulta de
 * cidades que já foram consultadas e já atualizadas... Só no próximo ano
 * que irá atualizar". Each (state, city) is synced at most once per
 * calendar year regardless of how often this function runs (see
 * HolidaySyncCursor) — the caller (server.ts's periodic check) is what
 * additionally caps actual invocations to roughly once a month.
 *
 * No municipal-holiday data provider is wired in yet — every third-party
 * candidate found (feriadosapi.com, feriados-brasil, calendario.com.br)
 * needs an account/API key and its exact contract wasn't verified from
 * this environment (outbound access to those domains is blocked here).
 * This still runs the city-selection/cursor logic for real so it's ready
 * to plug a provider into — see fetchMunicipalHolidaysFromProvider below.
 */
export async function syncMunicipalHolidays(year: number): Promise<{ citiesSynced: number; citiesSkipped: number }> {
  let citiesSynced = 0;
  let citiesSkipped = 0;

  for (const state of AUTO_SYNC_MUNICIPAL_STATES) {
    const citiesInUse = await prisma.user.findMany({
      where: { workState: state, workCity: { not: null } },
      select: { workCity: true },
      distinct: ["workCity"],
    });

    for (const { workCity: city } of citiesInUse) {
      if (!city) continue;
      if (await alreadySyncedThisYear("MUNICIPAL", state, city, year)) {
        citiesSkipped++;
        continue;
      }
      try {
        const holidays = await fetchMunicipalHolidaysFromProvider(state, city, year);
        for (const h of holidays) {
          await upsertAutoHoliday({ date: dateKeyToDate(h.date), name: h.name, scope: "MUNICIPAL", state, city });
        }
        await markSynced("MUNICIPAL", state, city, year);
        citiesSynced++;
      } catch (err) {
        // A failed city doesn't block the others, and doesn't mark this
        // city as synced — it's retried the next time this runs (still at
        // most monthly, per server.ts's cadence) instead of silently
        // giving up on it for the rest of the year.
        logger.warn({ err, state, city, year }, "falha ao sincronizar feriados municipais desta cidade");
      }
    }
  }

  return { citiesSynced, citiesSkipped };
}

/**
 * Not yet wired to a real provider — see syncMunicipalHolidays's doc
 * comment. Returns no holidays rather than fabricating data, so a city
 * with nothing here shows up in Configurações exactly as "sem feriados
 * municipais importados ainda", never as a false negative disguised as a
 * successful empty sync (this throws instead of returning [], so the
 * city is correctly retried next month rather than marked done).
 */
async function fetchMunicipalHolidaysFromProvider(_state: string, _city: string, _year: number): Promise<{ date: string; name: string }[]> {
  throw new Error("Nenhum provedor de feriados municipais configurado ainda");
}

export async function runHolidaySync(year: number) {
  const national = await syncNationalHolidays(year);
  const municipal = await syncMunicipalHolidays(year);
  return { national, municipal };
}

const SYNC_CADENCE_KEY = "holidaySyncLastRunAt";
const SYNC_CADENCE_DAYS = 30;

/**
 * Gate for server.ts's periodic check — see PROMPT: "será somente uma
 * consulta por mês". The per-city-per-year HolidaySyncCursor above already
 * keeps any single city from being queried more than once a year; this is
 * the separate, coarser cap on how often the whole sync job is even
 * allowed to run at all, independent of how often server.ts's own timer
 * ticks (daily — see server.ts — so this can check cheaply without doing
 * any real sync work most days).
 */
export async function runHolidaySyncIfDue(): Promise<boolean> {
  const marker = await prisma.systemSetting.findUnique({ where: { key: SYNC_CADENCE_KEY } });
  const lastRunAt = marker ? new Date((marker.value as { at: string }).at) : null;
  const dueAt = lastRunAt ? new Date(lastRunAt.getTime() + SYNC_CADENCE_DAYS * 86_400_000) : new Date(0);
  if (new Date() < dueAt) return false;

  await runHolidaySync(new Date().getUTCFullYear());
  await prisma.systemSetting.upsert({
    where: { key: SYNC_CADENCE_KEY },
    update: { value: { at: new Date().toISOString() } },
    create: { key: SYNC_CADENCE_KEY, value: { at: new Date().toISOString() } },
  });
  return true;
}
