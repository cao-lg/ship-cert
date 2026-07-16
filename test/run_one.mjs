import { readFileSync } from "fs";
import * as H from "../src/helpers.js";
const name = process.argv[2];
const arg2 = process.argv[3]; // for firstDateAfter: "ISSUE" | "EXPIRY"
const raw = readFileSync("test/g0.txt", "utf8");
console.log("BEFORE", name, arg2 || "");
let r;
if (name === "firstDateAfter") {
  const phrases = arg2 === "EXPIRY" ? H.EXPIRY_PHRASES : H.ISSUE_PHRASES;
  r = H.firstDateAfter(raw, phrases);
} else {
  r = H[name](raw);
}
console.log("AFTER", name, arg2 || "", JSON.stringify(String(r)).slice(0, 100));
