// Lever public postings API — no key required.
// Site = the slug in a company's jobs.lever.co/<site> URL.

export async function searchLever(site) {
  const url = `https://api.lever.co/v0/postings/${site}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Lever HTTP ${res.status} for site "${site}"` };
  }
  const data = await res.json();

  const results = (Array.isArray(data) ? data : []).map((j) => ({
    id: `lever:${site}:${j.id}`,
    source: `Lever (${site})`,
    title: j.text ?? "",
    company: site,
    location: j.categories?.location ?? "",
    url: j.hostedUrl,
    description: (j.descriptionPlain ?? j.description ?? "").replace(/<[^>]+>/g, ""),
    postedDate: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    salaryMin: j.salaryRange?.min ?? null,
    salaryMax: j.salaryRange?.max ?? null,
  }));

  return { results, skipped: false };
}
