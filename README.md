# job-search-agent

Discovers and ranks job postings against a candidate profile (`config.json`). It does **not** submit applications — it produces a ranked shortlist. Tailoring a resume/cover letter for any posting is a separate, manual step.

## Why no auto-submit

Auto-submitting applications is high-risk and hard to reverse: a bad match or a templated cover letter going out under your name can hurt more than help. This tool stops at "here's what's worth your time," and you decide from there.

## Sources

- **Adzuna** — broad job aggregator, free API tier.
- **USAJobs** — federal government postings, free API.
- **Remotive** — remote-only listings, free, no API key required. Queried once per search term (not per location) since every listing is already remote.
- **Jobicy** — remote-only listings, free, no API key required. Queried once per search term the same way as Remotive, scoped to `geo=usa`.
- **Greenhouse / Lever** — no API key needed, but only searches specific companies' boards you add to `config.json` (`search.greenhouseBoards`, `search.leverBoards`). Find a company's board token/site from their careers page URL, e.g. `boards.greenhouse.io/<token>` or `jobs.lever.co/<site>`.

LinkedIn and Indeed are deliberately excluded — both prohibit automated scraping in their terms of service and can flag or suspend accounts for bot-like activity.

**Jooble was tried and removed.** It was added as a source, then dropped after a single shortlist run: 4 of 4 Jooble-sourced postings that scored well and read clean turned out unusable once actually clicked through — two redirected to a jobleads.com paywall, one was mislabeled as remote when the real posting was onsite, and one was a dead/expired listing. The aggregator's own data quality was the failure, not the scoring or matching logic. Re-adding it would need an apply-link liveness check first (Jooble's redirect pages sit behind a Cloudflare bot-challenge, so that check can't be automated reliably — see `src/sources/adzuna.js`-style WAF issues for the same category of problem).

## Setup

1. Get free API keys:
   - Adzuna: https://developer.adzuna.com/ (instant)
   - USAJobs: https://developer.usajobs.gov/apirequest/ (key emailed within minutes)
   - Remotive: no key needed
2. Copy `.env.example` to `.env` and fill in the keys.
3. Run a search:

   ```
   npm run search
   ```

   Optional: `npm run search -- --limit=30` to change how many results are kept.

## Output

Each run prints a ranked list to the console and writes the same data to `data/shortlist-<date>.json`. Scoring rewards title relevance, matched skills/certifications, and entry-level language; it hard-excludes senior/lead/manager titles, postings that bar the candidate's state, and non-remote postings outside a configurable commute radius, and it penalizes postings requiring more experience or an active security clearance than the candidate has.

## Dedupe against past research

Postings that scored well but turned out to be dead ends after a manual careers-page/ATS check (expired, wrong seniority, wrong domain, resubmission-blocked, etc.) are recorded in `history.json` and automatically dropped from future runs — they'd otherwise resurface every time the source re-syndicates them with a fresh posted-date. Each entry matches on company name (fuzzy substring) plus optional `titleContains` keywords to scope it to the specific role rather than the whole company. Add an entry any time a promising-looking posting turns out to be a confirmed dead end.

## Tuning your profile

Edit `config.json`:
- `candidate.targetTitles` — job titles you're aiming for
- `candidate.skills` — keywords to match against posting descriptions
- `candidate.certifications` — certs to match
- `candidate.stateAbbreviation` — used to catch postings that explicitly exclude your state
- `candidate.location.metroTerms` / `stateTerms` / `remoteTerms` / `remoteOk` — place names for scoring location fit; `onsiteRadiusMiles` / `onsiteRadiusCenter` define the hard cutoff for non-remote postings
- `candidate.maxYearsExperienceComfortable` — flags postings whose stated experience requirement is a stretch
- `candidate.excludeIfTitleContains` — titles to hard-exclude regardless of everything else
- `search.queries` / `search.queryLocations` — the actual search terms and locations sent to Adzuna/USAJobs (Remotive uses `search.queries` only, since it's remote-only)

## Next step after a search

Bring `data/shortlist-<date>.json` (or just the postings you're interested in) into a Claude Code conversation and ask for a tailored resume and cover letter.
