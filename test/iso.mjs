import { spawnSync } from "child_process";
import { createRequire } from "module";
const node = "C:/Users/caolg/.workbuddy/binaries/node/versions/22.22.2/node.exe";
const cases = [
  ["detectType", ""],
  ["extractNumber", ""],
  ["firstDateAfter", "ISSUE"],
  ["firstDateAfter", "EXPIRY"],
  ["detectSociety", ""],
];
for (const [name, arg2] of cases) {
  const res = spawnSync(node, ["test/run_one.mjs", name, arg2], { cwd: process.cwd(), encoding: "utf8", timeout: 30000 });
  const ok = res.status === 0 && /AFTER/.test(res.stdout || "");
  const out = (res.stdout || "").split("\n").filter((l) => l.startsWith("BEFORE") || l.startsWith("AFTER")).join(" | ");
  console.log(`[${ok ? "OK " : "XXXX"}] ${name} ${arg2}  (exit=${res.status})  ${out}`);
  if (!ok) console.log("   stderr:", (res.stderr || "").slice(0, 300));
}
