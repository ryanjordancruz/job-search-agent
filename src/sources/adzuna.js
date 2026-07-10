// Adzuna job search API — https://developer.adzuna.com/
// Free tier, requires ADZUNA_APP_ID + ADZUNA_APP_KEY.

export async function searchAdzuna({ query, location, country, resultsPerQuery, maxDaysOld }) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return { results: [], skipped: true, reason: "ADZUNA_APP_ID / ADZUNA_APP_KEY not set" };
  }

  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("what", query);
  if (location) url.searchParams.set("where", location);
  url.searchParams.set("results_per_page", String(resultsPerQuery));
  url.searchParams.set("max_days_old", String(maxDaysOld));
  url.searchParams.set("content-type", "application/json");

  const res = await fetch(url);
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Adzuna HTTP ${res.status}` };
  }
  const data = await res.json();

  const results = (data.results || []).map((r) => ({
    id: `adzuna:${r.id}`,
    source: "Adzuna",
    title: r.title?.replace(/<[^>]+>/g, "") ?? "",
    company: r.company?.display_name ?? "Unknown",
    location: r.location?.display_name ?? "",
    url: r.redirect_url,
    description: (r.description ?? "").replace(/<[^>]+>/g, ""),
    postedDate: r.created ?? null,
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
  }));

  return { results, skipped: false };
}
