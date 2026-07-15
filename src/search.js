import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { searchAdzuna } from "./sources/adzuna.js";
import { searchUsajobs } from "./sources/usajobs.js";
import { searchRemotive } from "./sources/remotive.js";
import { searchGreenhouse } from "./sources/greenhouse.js";
import { searchLever } from "./sources/lever.js";
import { scorePosting } from "./score.js";
import { loadHistory, findHistoryMatch } from "./history.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const { candidate, search } = config;

function dedupe(postings) {
  const seen = new Set();
  const out = [];
  for (const p of postings) {
    // Prefer the stable source id — some providers (Adzuna) append a unique
    // tracking token to the URL on every request, so the same posting would
    // otherwise look "different" each time it matches another search query.
    const key = p.id || p.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function collectAll() {
  const all = [];
  const notes = [];

  for (const query of search.queries) {
    for (const location of search.queryLocations) {
      const adzuna = await searchAdzuna({
        query,
        location,
        country: search.adzuna.country,
        resultsPerQuery: search.adzuna.resultsPerQuery,
        maxDaysOld: search.adzuna.maxDaysOld,
      });
      if (adzuna.skipped) notes.push(`[Adzuna] ${adzuna.reason}`);
      all.push(...adzuna.results);

      const usajobs = await searchUsajobs({
        query,
        location,
        resultsPerQuery: search.usajobs.resultsPerQuery,
      });
      if (usajobs.skipped) notes.push(`[USAJobs] ${usajobs.reason}`);
      all.push(...usajobs.results);
    }

    const remotive = await searchRemotive({
      query,
      resultsPerQuery: search.remotive.resultsPerQuery,
    });
    if (remotive.skipped) notes.push(`[Remotive] ${remotive.reason}`);
    all.push(...remotive.results);
  }

  for (const board of search.greenhouseBoards ?? []) {
    const gh = await searchGreenhouse(board);
    if (gh.skipped) notes.push(`[Greenhouse] ${gh.reason}`);
    all.push(...gh.results);
  }

  for (const site of search.leverBoards ?? []) {
    const lv = await searchLever(site);
    if (lv.skipped) notes.push(`[Lever] ${lv.reason}`);
    all.push(...lv.results);
  }

  // dedupe notes
  return { postings: dedupe(all), notes: [...new Set(notes)] };
}

function formatSalary(min, max) {
  if (!min && !max) return "";
  const fmt = (n) => `$${Math.round(n / 1000)}k`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  return fmt(min || max);
}

async function main() {
  console.log(`Searching for ${candidate.name}: ${search.queries.join(", ")}...\n`);

  const { postings, notes } = await collectAll();

  if (notes.length) {
    console.log("Notes:");
    for (const n of notes) console.log(`  - ${n}`);
    console.log();
  }

  const scored = postings
    .map((p) => ({ posting: p, ...scorePosting(p, candidate) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score);

  // Drop postings already confirmed as dead ends in a prior review (expired,
  // clearance-blocked, wrong seniority, wrong domain, resubmission-blocked,
  // etc.) — see history.json. The scorer's filters catch systematic textual
  // patterns; this catches specific reqs/companies that needed a manual
  // careers-page/ATS check to rule out and would otherwise resurface under a
  // fresh posted-date every run.
  const history = loadHistory();
  const known = scored.filter((r) => findHistoryMatch(r.posting, history));
  const fresh = scored.filter((r) => !findHistoryMatch(r.posting, history));

  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 20;
  const top = fresh.slice(0, limit);

  const repeatNote = known.length ? `, ${known.length} already ruled out (skipped)` : "";
  console.log(`Found ${postings.length} postings, ${scored.length} passed filters${repeatNote}. Top ${top.length} new:\n`);
  if (scored.length > 0 && fresh.length === 0) {
    console.log("Every passed-filter posting today is a previously-confirmed dead end — no new candidates.\n");
  }

  top.forEach((r, i) => {
    const p = r.posting;
    const salary = formatSalary(p.salaryMin, p.salaryMax);
    console.log(`${i + 1}. [${r.score}] ${p.title} — ${p.company}`);
    console.log(`   ${p.location || "location unknown"}${salary ? " · " + salary : ""} · ${p.source}`);
    console.log(`   ${p.url}`);
    if (r.matchedSkills.length) console.log(`   Matched: ${r.matchedSkills.join(", ")}`);
    if (r.flags.length) console.log(`   Flags: ${r.flags.join(" | ")}`);
    console.log();
  });

  mkdirSync(join(root, "data"), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = join(root, "data", `shortlist-${stamp}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      top.map((r) => ({ ...r.posting, score: r.score, matchedSkills: r.matchedSkills, flags: r.flags })),
      null,
      2
    )
  );
  console.log(`Shortlist saved to ${outPath}`);
  console.log(`\nThis script only ranks and saves postings — nothing was submitted anywhere.`);
  console.log(`Bring the shortlist to Claude Code to tailor a resume/cover letter for any posting you like.`);
}

main().catch((err) => {
  console.error("Search failed:", err);
  process.exit(1);
});
