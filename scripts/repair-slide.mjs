import { repairFile, slidePath } from "./lib/slide-repair.mjs";

// node scripts/repair-slide.mjs <slide-id>  : 列挙値の軽微な取り違えを直す（直した箇所を表示。何もなければ何もしない）
const id = process.argv[2];
if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
  console.error("usage: node scripts/repair-slide.mjs <slide-id>");
  process.exit(2);
}
try {
  const changes = repairFile(slidePath(id));
  for (const c of changes) console.log(`repaired ${c.path}: "${c.from}" -> "${c.to}"`);
  console.log(`repair: ${changes.length} change(s)`);
} catch (error) {
  console.log(`repair skipped: ${error.message}`);
}