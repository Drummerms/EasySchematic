import type { DeviceTemplate, Port, SlotDefinition } from "../types";
import { DEVICE_TYPE_TO_CATEGORY } from "../deviceTypeCategories";
import { validateTemplate } from "./validate";
import { generatePortId, generateTemplateId, type ParseResult, type ParsedTemplate } from "./types";

/** Parse a JSON string into one or more device templates.
 * Accepts either a single object or an array. Unknown fields are stripped. */
export function parseJsonImport(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return {
      templates: [],
      fatalErrors: [`Not valid JSON: ${(e as Error).message}`],
    };
  }

  const items: unknown[] = Array.isArray(json) ? json : [json];
  const templates: ParsedTemplate[] = [];
  const fatalErrors: string[] = [];

  items.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      fatalErrors.push(`Item ${idx}: not an object`);
      return;
    }
    const normalized = normalizeTemplate(item as Record<string, unknown>);
    const validation = validateTemplate(normalized);
    templates.push({
      template: normalized as DeviceTemplate,
      validation,
      source: items.length > 1 ? `entry ${idx + 1}` : undefined,
    });
  });

  return { templates, fatalErrors };
}

function normalizeTemplate(raw: Record<string, unknown>): Partial<DeviceTemplate> {
  const ports = Array.isArray(raw.ports)
    ? (raw.ports as Array<Record<string, unknown>>).map((p, i) => normalizePort(p, i))
    : [];

  // Derive category from deviceType if not provided (or if user gave a freeform value)
  const deviceType = typeof raw.deviceType === "string" ? raw.deviceType : "";
  const derivedCategory = DEVICE_TYPE_TO_CATEGORY[deviceType];
  const category = typeof raw.category === "string" && raw.category.trim()
    ? raw.category
    : derivedCategory ?? "Uncategorized";

  return {
    id: typeof raw.id === "string" ? raw.id : generateTemplateId(),
    label: str(raw.label),
    deviceType,
    category,
    manufacturer: str(raw.manufacturer),
    modelNumber: str(raw.modelNumber),
    referenceUrl: str(raw.referenceUrl),
    color: str(raw.color),
    imageUrl: str(raw.imageUrl),
    searchTerms: Array.isArray(raw.searchTerms)
      ? raw.searchTerms.filter((s): s is string => typeof s === "string")
      : undefined,
    powerDrawW: num(raw.powerDrawW),
    powerCapacityW: num(raw.powerCapacityW),
    voltage: str(raw.voltage),
    thermalBtuh: num(raw.thermalBtuh),
    poeBudgetW: num(raw.poeBudgetW),
    unitCost: num(raw.unitCost),
    heightMm: num(raw.heightMm),
    widthMm: num(raw.widthMm),
    depthMm: num(raw.depthMm),
    weightKg: num(raw.weightKg),
    isVenueProvided: typeof raw.isVenueProvided === "boolean" ? raw.isVenueProvided : undefined,
    // Modular chassis (slots[]) + expansion-card (slotFamily) fields. Preserved so a
    // chassis and its cards can be bulk-imported and assembled into slots in-app; the
    // card↔slot link is the slotFamily string. slotFamily is kept even when blank so the
    // validator can reject it (a card with no family is unusable), mirroring api/src/validate.ts.
    slotFamily: raw.slotFamily != null ? (raw.slotFamily as string) : undefined,
    slots: normalizeSlots(raw.slots),
    ports: ports as Port[],
  };
}

/** Normalize an imported chassis's slot definitions. Backfills id/label (internal
 * details a user shouldn't have to author) but keeps slotFamily verbatim — including
 * blank — so validation flags a missing family. Malformed (non-object) entries are
 * PRESERVED, not dropped, so the validator rejects them and the user is told, rather
 * than silently losing data (parity with api/src/validate.ts). */
function normalizeSlots(raw: unknown): SlotDefinition[] | undefined {
  if (raw == null) return undefined;                       // absent → no slots
  if (!Array.isArray(raw)) return raw as SlotDefinition[];  // non-array preserved so the validator rejects it
  if (raw.length === 0) return undefined;                  // empty → no slots (validator-equivalent)
  return (raw as unknown[]).map((s, i): SlotDefinition => {
    if (!s || typeof s !== "object") return s as SlotDefinition; // kept so validation rejects it
    const obj = s as Record<string, unknown>;
    const slot: SlotDefinition = {
      id: typeof obj.id === "string" && obj.id.trim() !== "" ? obj.id : `slot-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
      label: typeof obj.label === "string" && obj.label.trim() !== "" ? obj.label : `Slot ${i + 1}`,
      slotFamily: typeof obj.slotFamily === "string" ? obj.slotFamily : "",
    };
    // Keep defaultCardId verbatim when present so the validator rejects a non-string
    // (parity with the API), rather than silently sanitizing it away.
    if (obj.defaultCardId != null) slot.defaultCardId = obj.defaultCardId as string;
    if (typeof obj.hideWhenEmpty === "boolean") slot.hideWhenEmpty = obj.hideWhenEmpty;
    return slot;
  });
}

function normalizePort(raw: Record<string, unknown>, index: number): Partial<Port> {
  return {
    id: typeof raw.id === "string" ? raw.id : generatePortId(index),
    label: str(raw.label) ?? "",
    signalType: (typeof raw.signalType === "string" ? raw.signalType : "") as Port["signalType"],
    direction: (typeof raw.direction === "string" ? raw.direction : "input") as Port["direction"],
    connectorType: typeof raw.connectorType === "string" ? raw.connectorType as Port["connectorType"] : undefined,
    section: str(raw.section),
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return undefined;
}
