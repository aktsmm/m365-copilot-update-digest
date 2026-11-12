import assert from "node:assert/strict";
import test from "node:test";
import { repairEnums } from "../scripts/lib/slide-repair.mjs";

test("repairEnums fixes case, spacing and common aliases to the allowed values", () => {
  const deck = { slides: [{ kind: "GA", audience: { changeNature: "Positive" }, action: { required: "Recommended" }, panels: [{ priority: "Primary", availability: "Not Stated" }] }] };
  const changes = repairEnums(deck);
  const s = deck.slides[0];
  assert.equal(s.kind, "ga");
  assert.equal(s.audience.changeNature, "benefit");
  assert.equal(s.action.required, "optional");
  assert.equal(s.panels[0].priority, "core");
  assert.equal(s.panels[0].availability, "not-stated");
  assert.equal(changes.length, 5);
});

test("repairEnums leaves valid values and unknown values alone", () => {
  const deck = { slides: [{ kind: "preview", audience: { changeNature: "mystery" }, action: { required: "yes" } }] };
  const changes = repairEnums(deck);
  assert.equal(changes.length, 0);
  assert.equal(deck.slides[0].audience.changeNature, "mystery");
});

test("every repair target is an allowed value in the schema", async () => {
  const fs = await import("node:fs");
  const { ALIASES } = await import("../scripts/lib/slide-repair.mjs");
  const schema = JSON.parse(fs.readFileSync("schema/slide.schema.json", "utf8"));
  const allowed = {};
  const walk = (node, name) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "enum" && Array.isArray(value)) (allowed[name] ??= new Set()), value.forEach((v) => allowed[name].add(v));
      else if (key === "properties" && value && typeof value === "object") for (const [prop, sub] of Object.entries(value)) walk(sub, prop);
      else walk(value, name);
    }
  };
  walk(schema, "");
  for (const [field, table] of Object.entries(ALIASES)) {
    assert.ok(allowed[field], `schema has no enum for ${field}`);
    for (const target of new Set(Object.values(table))) assert.ok(allowed[field].has(target), `${field}: "${target}" is not in the schema enum`);
  }
});
