// SmartRecruiters public Postings API — no key required.
// companyId = the internal SmartRecruiters identifier (not always the same as
// the public careers-page URL slug — verify via a direct API call before adding).

const BASE = "https://api.smartrecruiters.com/v1/companies";

export async function searchSmartrecruiters(companyId) {
  const listUrl = `${BASE}/${companyId}/postings?limit=100`;
  const listRes = await fetch(listUrl);
  if (!listRes.ok) {
    return { results: [], skipped: true, reason: `SmartRecruiters HTTP ${listRes.status} for company "${companyId}"` };
  }
  const list = await listRes.json();
  const postings = list.content || [];

  const results = await Promise.all(
    postings.map(async (p) => {
      const detailRes = await fetch(`${BASE}/${companyId}/postings/${p.id}`);
      const detail = detailRes.ok ? await detailRes.json() : null;
      const sections = detail?.jobAd?.sections || {};
      const description = Object.values(sections)
        .map((s) => s?.text ?? "")
        .join("\n")
        .replace(/<[^>]+>/g, "");

      return {
        id: `smartrecruiters:${companyId}:${p.id}`,
        source: `SmartRecruiters (${companyId})`,
        title: p.name ?? "",
        company: p.company?.name ?? companyId,
        location: p.location?.fullLocation ?? "",
        url: detail?.postingUrl ?? p.ref,
        description,
        postedDate: p.releasedDate ?? null,
        salaryMin: null,
        salaryMax: null,
      };
    })
  );

  return { results, skipped: false };
}
