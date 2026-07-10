// USAJobs API — https://developer.usajobs.gov/
// Free, requires USAJOBS_API_KEY + a User-Agent (your email, per their terms).

export async function searchUsajobs({ query, location, resultsPerQuery }) {
  const apiKey = process.env.USAJOBS_API_KEY;
  const userAgent = process.env.USAJOBS_USER_AGENT;
  if (!apiKey || !userAgent) {
    return { results: [], skipped: true, reason: "USAJOBS_API_KEY / USAJOBS_USER_AGENT not set" };
  }

  const url = new URL("https://data.usajobs.gov/api/search");
  url.searchParams.set("Keyword", query);
  if (location) url.searchParams.set("LocationName", location);
  url.searchParams.set("ResultsPerPage", String(resultsPerQuery));

  const res = await fetch(url, {
    headers: {
      Host: "data.usajobs.gov",
      "User-Agent": userAgent,
      "Authorization-Key": apiKey,
    },
  });
  if (!res.ok) {
    return { results: [], skipped: true, reason: `USAJobs HTTP ${res.status}` };
  }
  const data = await res.json();

  const items = data?.SearchResult?.SearchResultItems ?? [];
  const results = items.map((item) => {
    const d = item.MatchedObjectDescriptor;
    const pay = d?.PositionRemuneration?.[0];
    return {
      id: `usajobs:${d?.PositionID}`,
      source: "USAJobs",
      title: d?.PositionTitle ?? "",
      company: d?.OrganizationName ?? "Federal Government",
      location: d?.PositionLocationDisplay ?? "",
      url: d?.PositionURI,
      description: `${d?.UserArea?.Details?.JobSummary ?? ""}\n${d?.QualificationSummary ?? ""}`,
      postedDate: d?.PublicationStartDate ?? null,
      salaryMin: pay?.MinimumRange ? Number(pay.MinimumRange) : null,
      salaryMax: pay?.MaximumRange ? Number(pay.MaximumRange) : null,
    };
  });

  return { results, skipped: false };
}
