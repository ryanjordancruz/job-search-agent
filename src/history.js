import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const HISTORY_PATH = join(root, "history.json");

function normalize(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function loadHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  return JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
}

// Company names vary slightly between sources/runs ("EMCOR" vs "EMCOR Group",
// "cFocus Software" vs "cFocus Software Incorporated") — a substring match
// either direction on the normalized name handles the common cases without
// needing an exact-name registry.
function companyMatches(postingCompany, entryCompany) {
  const a = normalize(postingCompany);
  const b = normalize(entryCompany);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// Returns the matching history entry for a posting (company + optional title
// keywords), or null if it's not a previously-confirmed dead end. An entry
// with an empty/missing titleContains applies to any posting from that
// company; otherwise at least one keyword must appear in the posting title.
export function findHistoryMatch(posting, history) {
  const title = normalize(posting.title);
  for (const entry of history) {
    if (!companyMatches(posting.company, entry.company)) continue;
    if (!entry.titleContains || entry.titleContains.length === 0) return entry;
    if (entry.titleContains.some((t) => title.includes(normalize(t)))) return entry;
  }
  return null;
}
