// Jobicy remote jobs API — https://jobicy.com/jobs-rss-feed (docs: https://jobi.cy/apidocs)
// Free, no API key required. Remote-only, so queried once per search term
// rather than once per (term, location) pair, same as Remotive.

export async function searchJobicy({ query, resultsPerQuery }) {
  const url = new URL("https://jobicy.com/api/v2/remote-jobs");
  url.searchParams.set("geo", "usa");
  if (query) url.searchParams.set("tag", query);
  if (resultsPerQuery) url.searchParams.set("count", String(resultsPerQuery));

  const res = await fetch(url);
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Jobicy HTTP ${res.status}` };
  }
  const data = await res.json();

  const results = (data.jobs || []).map((j) => ({
    id: `jobicy:${j.id}`,
    source: "Jobicy",
    title: j.jobTitle ?? "",
    company: j.companyName ?? "Unknown",
    location: j.jobGeo || "Remote",
    url: j.url,
    description: (j.jobDescription ?? j.jobExcerpt ?? "").replace(/<[^>]+>/g, ""),
    postedDate: j.pubDate ?? null,
    salaryMin: j.salaryMin ?? null,
    salaryMax: j.salaryMax ?? null,
  }));

  return { results, skipped: false };
}
