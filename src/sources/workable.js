// Workable public widget API — no key required.
// subdomain = the slug in a company's apply.workable.com/<subdomain> board URL.
// Returns the company's full current roster (no server-side keyword filtering);
// score.js does the relevance filtering, same as the Greenhouse/Lever sources.

export async function searchWorkable(subdomain) {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${subdomain}?details=true`;
  const res = await fetch(url);
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Workable HTTP ${res.status} for account "${subdomain}"` };
  }
  const data = await res.json();

  const results = (data.jobs || []).map((j) => ({
    id: `workable:${subdomain}:${j.shortcode}`,
    source: `Workable (${subdomain})`,
    title: j.title ?? "",
    company: data.name ?? subdomain,
    location: [j.city, j.state, j.country].filter(Boolean).join(", "),
    url: j.application_url ?? j.url,
    description: (j.description ?? "").replace(/<[^>]+>/g, ""),
    postedDate: j.published_on ?? j.created_at ?? null,
    salaryMin: null,
    salaryMax: null,
  }));

  return { results, skipped: false };
}
