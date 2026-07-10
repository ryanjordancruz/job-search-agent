// Greenhouse public job board API — no key required.
// Board token = the slug in a company's careers.<company>.com or boards.greenhouse.io/<token> URL.

export async function searchGreenhouse(boardToken) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Greenhouse HTTP ${res.status} for board "${boardToken}"` };
  }
  const data = await res.json();

  const results = (data.jobs || []).map((j) => ({
    id: `greenhouse:${boardToken}:${j.id}`,
    source: `Greenhouse (${boardToken})`,
    title: j.title ?? "",
    company: boardToken,
    location: j.location?.name ?? "",
    url: j.absolute_url,
    description: (j.content ?? "").replace(/<[^>]+>/g, ""),
    postedDate: j.updated_at ?? null,
    salaryMin: null,
    salaryMax: null,
  }));

  return { results, skipped: false };
}
