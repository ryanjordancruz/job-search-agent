// Jooble job search API — https://jooble.org/api/about
// Free tier, requires JOOBLE_API_KEY.

export async function searchJooble({ query, location, resultsPerQuery }) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    return { results: [], skipped: true, reason: "JOOBLE_API_KEY not set" };
  }

  const res = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keywords: query,
      location: location || "",
      ResultOnPage: String(resultsPerQuery),
    }),
  });
  if (!res.ok) {
    return { results: [], skipped: true, reason: `Jooble HTTP ${res.status}` };
  }
  const data = await res.json();

  const results = (data.jobs || []).map((j) => ({
    id: `jooble:${j.id}`,
    source: "Jooble",
    title: j.title ?? "",
    company: j.company || "Unknown",
    location: j.location ?? "",
    url: j.link,
    description: j.snippet ?? "",
    postedDate: j.updated ?? null,
    // Jooble returns salary as a free-text string (e.g. "$50,000 - $70,000"),
    // not numeric min/max, so we leave these unset rather than mis-parse it.
    salaryMin: null,
    salaryMax: null,
  }));

  return { results, skipped: false };
}
