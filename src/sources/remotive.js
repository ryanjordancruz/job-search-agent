// Remotive remote jobs API — https://remotive.com/remote-jobs/api
// Free, no API key required. Every listing is inherently remote, so this is
// queried once per search term rather than once per (term, location) pair.

export async function searchRemotive({ query, resultsPerQuery }) {
  const url = new URL("https://remotive.com/api/remote-jobs");
  if (query) url.searchParams.set("search", query);
  if (resultsPerQuery) url.searchParams.set("limit", String(resultsPerQuery));

  const res = await fetch(url);
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Remotive HTTP ${res.status}` };
  }
  const data = await res.json();

  const results = (data.jobs || []).map((j) => ({
    id: `remotive:${j.id}`,
    source: "Remotive",
    title: j.title ?? "",
    company: j.company_name ?? "Unknown",
    location: j.candidate_required_location || "Remote",
    url: j.url,
    description: (j.description ?? "").replace(/<[^>]+>/g, ""),
    postedDate: j.publication_date ?? null,
    // Remotive returns salary as a free-text string, not numeric min/max.
    salaryMin: null,
    salaryMax: null,
  }));

  return { results, skipped: false };
}
