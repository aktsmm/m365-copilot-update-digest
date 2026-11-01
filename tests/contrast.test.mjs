import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// バッジの文字色が背景に対して読めること（WCAG AA 4.5:1）を、CSS の色から計算して守る。
const css = fs.readFileSync("public/assets/styles.css", "utf8");

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const textColor = (selector) => {
  const block = css.split("\n").filter((l) => l.includes(selector) && l.includes("{") && l.includes("color:")).pop();
  return (block.match(/(?<![-a-z])color:\s*(#[0-9a-fA-F]{6})/) || [])[1];
};

test("dark-mode kind badges stay readable on the dark card background", () => {
  const darkCard = "#1a2e3e";
  for (const kind of ["ga", "preview", "rolling-out", "in-development", "update", "retirement"]) {
    const color = textColor(`html[data-theme="dark"] .badge-kind-${kind}`);
    assert.ok(color, `dark override for ${kind} is missing`);
    assert.ok(ratio(color, darkCard) >= 4.5, `${kind} badge ${color} contrast is ${ratio(color, darkCard).toFixed(2)}`);
  }
});

test("light-mode importance and kind colors used as text/fill keep 4.5:1 against white", () => {
  for (const color of ["#9a5c00", "#166a30", "#0a5cb0", "#b02020"]) {
    assert.ok(ratio(color, "#ffffff") >= 4.5, `${color} on white is ${ratio(color, "#ffffff").toFixed(2)}`);
  }
});