// Workday public career-site API ("cxs") — no key required.
// board = { host, tenant, site, company }, read off a careers URL like
// https://<host>/<site>, e.g. nshe.wd1.myworkdayjobs.com/UNLV-External
// (tenant "nshe"). Unlike the roster-style sources, Workday search returns
// titles only, so each query is searched server-side and only postings whose
// title passes titleKeywords get the (one-request-each) detail fetch.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function searchWorkday(board, queries, titleKeywords) {
  const { host, tenant, site, company } = board;
  const base = `https://${host}/wday/cxs/${tenant}/${site}`;
  const titleRe = new RegExp(`\\b(${titleKeywords.map(escapeRegex).join("|")})\\b`, "i");

  const paths = new Set();
  for (const query of queries) {
    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: query }),
    });
    if (!res.ok) {
      return { results: [], skipped: true, reason: `Workday HTTP ${res.status} for ${host}/${site}` };
    }
    const data = await res.json();
    for (const p of data.jobPostings ?? []) {
      if (titleRe.test(p.title ?? "")) paths.add(p.externalPath);
    }
  }

  const results = [];
  for (const path of paths) {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) continue;
    const j = (await res.json()).jobPostingInfo;
    if (!j) continue;
    results.push({
      id: `workday:${tenant}:${j.jobReqId ?? path}`,
      source: `Workday (${company})`,
      title: j.title ?? "",
      company,
      location: [j.location, ...(j.additionalLocations ?? [])].filter(Boolean).join("; "),
      url: j.externalUrl ?? `https://${host}/${site}${path}`,
      description: (j.jobDescription ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      postedDate: j.startDate ?? null,
      salaryMin: null,
      salaryMax: null,
    });
  }

  return { results, skipped: false };
}
