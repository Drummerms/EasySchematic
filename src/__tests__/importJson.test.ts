import { describe, it, expect } from "vitest";
import { parseJsonImport } from "../import/parseJson";

// ─────────────────────────────────────────────────────────────────────────────
// Modular-chassis import: slots[] (chassis) + slotFamily (expansion card)
// must survive the JSON importer (regression for the field-whitelist that used
// to strip them). Mirrors api/src/validate.ts rules.
// ─────────────────────────────────────────────────────────────────────────────

const chassis = {
  label: "Extron XTP II CrossPoint 1600",
  deviceType: "switcher",
  manufacturer: "Extron",
  modelNumber: "XTP II CrossPoint 1600",
  referenceUrl: "https://www.extron.com/product/xtp2cp1600",
  slots: [
    { id: "in-1", label: "Input Slot 1", slotFamily: "extron-xtp-ii-input" },
    { id: "out-1", label: "Output Slot 1", slotFamily: "extron-xtp-ii-output" },
  ],
  ports: [{ label: "AC Power", signalType: "power", direction: "input" }],
};

const card = {
  label: "XTP II CP 4i HD 4K PLUS",
  deviceType: "expansion-card",
  manufacturer: "Extron",
  modelNumber: "XTP II CP 4i HD 4K PLUS",
  referenceUrl: "https://www.extron.com/product/xtp2cp4ihd4kplus",
  slotFamily: "extron-xtp-ii-input",
  ports: [{ label: "Input 1", signalType: "hdmi", direction: "input", connectorType: "hdmi" }],
};

describe("parseJsonImport — modular chassis", () => {
  it("preserves chassis slots[] through import", () => {
    const { templates } = parseJsonImport(JSON.stringify(chassis));
    expect(templates).toHaveLength(1);
    const t = templates[0];
    expect(t.validation.ok).toBe(true);
    expect(t.template.slots).toHaveLength(2);
    expect(t.template.slots?.[0]).toMatchObject({ id: "in-1", label: "Input Slot 1", slotFamily: "extron-xtp-ii-input" });
    expect(t.template.slots?.[1].slotFamily).toBe("extron-xtp-ii-output");
  });

  it("preserves expansion-card slotFamily through import", () => {
    const { templates } = parseJsonImport(JSON.stringify(card));
    expect(templates[0].validation.ok).toBe(true);
    expect(templates[0].template.slotFamily).toBe("extron-xtp-ii-input");
  });

  it("links a chassis + card batch by the slotFamily string", () => {
    const { templates } = parseJsonImport(JSON.stringify([chassis, card]));
    expect(templates).toHaveLength(2);
    expect(templates.every((t) => t.validation.ok)).toBe(true);
    const families = new Set(templates[0].template.slots?.map((s) => s.slotFamily));
    expect(families.has(templates[1].template.slotFamily!)).toBe(true);
  });

  it("backfills missing slot id/label but keeps slotFamily verbatim", () => {
    const raw = { ...chassis, slots: [{ slotFamily: "extron-xtp-ii-input" }] };
    const { templates } = parseJsonImport(JSON.stringify(raw));
    const slot = templates[0].template.slots?.[0];
    expect(slot?.id).toBeTruthy();
    expect(slot?.label).toBe("Slot 1");
    expect(slot?.slotFamily).toBe("extron-xtp-ii-input");
    expect(templates[0].validation.ok).toBe(true);
  });

  it("rejects a slot with a blank slotFamily (the card→slot link)", () => {
    const raw = { ...chassis, slots: [{ id: "s1", label: "Slot 1", slotFamily: "  " }] };
    const { templates } = parseJsonImport(JSON.stringify(raw));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/slotFamily/i);
  });

  it("rejects a blank top-level slotFamily on a card", () => {
    const { templates } = parseJsonImport(JSON.stringify({ ...card, slotFamily: "" }));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/slotFamily/i);
  });

  it("rejects (does not silently drop) a malformed slot element", () => {
    const raw = { ...chassis, slots: [null, "x", { id: "s1", label: "Slot 1", slotFamily: "fam" }] };
    const { templates } = parseJsonImport(JSON.stringify(raw));
    // All three entries are preserved so the validator can reject the bad ones.
    expect(templates[0].template.slots).toHaveLength(3);
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/must be an object/i);
  });

  it("rejects more than MAX_SLOTS (128) slots", () => {
    const many = Array.from({ length: 129 }, (_, i) => ({ id: `s${i}`, label: `Slot ${i}`, slotFamily: "fam" }));
    const { templates } = parseJsonImport(JSON.stringify({ ...chassis, slots: many }));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/128/);
  });

  it("rejects a slotFamily longer than 100 chars", () => {
    const { templates } = parseJsonImport(JSON.stringify({ ...card, slotFamily: "x".repeat(101) }));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/100 characters/);
  });

  it("rejects a non-string defaultCardId", () => {
    const raw = { ...chassis, slots: [{ id: "s1", label: "Slot 1", slotFamily: "fam", defaultCardId: 42 }] };
    const { templates } = parseJsonImport(JSON.stringify(raw));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/defaultCardId/i);
  });

  it("rejects a non-string slotFamily (not silently dropped)", () => {
    const { templates } = parseJsonImport(JSON.stringify({ ...card, slotFamily: 42 }));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/slotFamily/i);
  });

  it("rejects a non-array slots value (not silently dropped)", () => {
    const { templates } = parseJsonImport(JSON.stringify({ ...chassis, slots: "oops" }));
    expect(templates[0].validation.ok).toBe(false);
    expect(templates[0].validation.errors.join(" ")).toMatch(/slots must be an array/i);
  });

  it("leaves a normal device unchanged (no slots field leaks in)", () => {
    const plain = {
      label: "Sony BRC-X400",
      deviceType: "ptz-camera",
      manufacturer: "Sony",
      modelNumber: "BRC-X400",
      referenceUrl: "https://pro.sony/product/brc-x400",
      ports: [{ label: "HDMI", signalType: "hdmi", direction: "output", connectorType: "hdmi" }],
    };
    const { templates } = parseJsonImport(JSON.stringify(plain));
    expect(templates[0].validation.ok).toBe(true);
    expect(templates[0].template.slots).toBeUndefined();
    expect(templates[0].template.slotFamily).toBeUndefined();
  });
});
