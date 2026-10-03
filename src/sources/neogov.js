// NEOGOV / GovernmentJobs.com public RSS feed — no key required.
// agency = the slug in governmentjobs.com/careers/<agency> (e.g. "lasvegas",
// "clarkcounty"). Most US city/county governments post here. The feed returns
// the agency's full current roster with duties + minimum qualifications, so
// score.js does the relevance filtering, same as the Greenhouse/Lever sources.

const ANNUAL_MULTIPLIER = {
  hour: 2080, hourly: 2080, biweekly: 26, weekly: 52, month: 12, monthly: 12,
  semimonthly: 24, year: 1, yearly: 1, annually: 1,
};

function decode(s) {
  return (s ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function stripHtml(s) {
  return decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function field(item, tag) {
  const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : "";
}

function annualize(amount, interval) {
  const n = Number(amount);
  if (!amount || Number.isNaN(n)) return null;
  const mult = ANNUAL_MULTIPLIER[(interval || "").toLowerCase().replace(/[^a-z]/g, "")] ?? 1;
  return Math.round(n * mult);
}

// "Tue, 22 Sep 2026 08:00:00:0" — NEOGOV appends a non-standard ":0".
function parseNeogovDate(s) {
  const t = Date.parse((s || "").replace(/:0$/, ""));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export async function searchNeogov(agency) {
  const url = `https://www.governmentjobs.com/SearchEngine/JobsFeed?agency=${encodeURIComponent(agency)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    return { results: [], skipped: true, reason: `NEOGOV HTTP ${res.status} for agency "${agency}"` };
  }
  const xml = await res.text();
  const agencyName = decode(field(xml, "title")) || agency;
  // Channel titles end in the state code, e.g. "City of Las Vegas, NV".
  const agencyState = agencyName.match(/,\s*([A-Z]{2})\s*$/)?.[1] ?? "";
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  if (items.length === 0 && !/<channel/.test(xml)) {
    return { results: [], skipped: true, reason: `NEOGOV feed for agency "${agency}" isn't a job feed (wrong slug?)` };
  }

  const results = items.map((item) => {
    const interval = field(item, "joblisting:salaryInterval");
    const description = [
      field(item, "joblisting:examplesofduties"),
      field(item, "joblisting:qualifications"),
      field(item, "joblisting:supplementalinformation"),
    ].map(stripHtml).join("\n\n");
    return {
      id: `neogov:${agency}:${field(item, "joblisting:jobId")}`,
      source: `NEOGOV (${agency})`,
      title: decode(field(item, "title")),
      company: agencyName,
      // Government jobs are on-site at the agency unless the posting says
      // otherwise; the zip keeps the location filter honest.
      location: [stripHtml(field(item, "joblisting:location")), agencyState, field(item, "joblisting:employerzipcode")]
        .filter(Boolean).join(", "),
      url: field(item, "link"),
      description,
      // advertiseFromDate is when the job opened; pubDate changes on edits.
      postedDate: parseNeogovDate(field(item, "joblisting:advertiseFromDateUTC")) ?? parseNeogovDate(field(item, "pubDate")),
      salaryMin: annualize(field(item, "joblisting:minimumSalary"), interval),
      salaryMax: annualize(field(item, "joblisting:maximumSalary"), interval),
    };
  });

  return { results, skipped: false };
}
