# job-search-agent

Discovers and ranks job postings against Ryan Cruz's resume profile (`config.json`). It does **not** submit applications — it produces a ranked shortlist. Tailoring a resume/cover letter for any posting you like is a separate step done with Claude Code, the same way we've done manually.

## Why no auto-submit

Auto-submitting applications is high-risk and hard to reverse: a bad match or a templated cover letter going out under your name can hurt more than help. This tool stops at "here's what's worth your time," and you decide from there.

## Sources

- **Adzuna** — broad job aggregator, free API tier.
- **USAJobs** — federal government postings, free API, relevant given your DHS interest.
- **Greenhouse / Lever** — no API key needed, but only searches specific companies' boards you add to `config.json` (`search.greenhouseBoards`, `search.leverBoards`). Find a company's board token/site from their careers page URL, e.g. `boards.greenhouse.io/<token>` or `jobs.lever.co/<site>`.

LinkedIn and Indeed are deliberately excluded — both prohibit automated scraping in their terms of service and can flag or suspend accounts for bot-like activity.

## Setup

1. Get free API keys:
   - Adzuna: https://developer.adzuna.com/ (instant)
   - USAJobs: https://developer.usajobs.gov/apirequest/ (key emailed within minutes)
2. Copy `.env.example` to `.env` and fill in the keys.
3. Run a search:

   ```
   npm run search
   ```

   Optional: `npm run search -- --limit=30` to change how many results are kept.

## Output

Each run prints a ranked list to the console and writes the same data to `data/shortlist-<date>.json`. Scoring rewards title match, matched skills/tools from your resume, certifications, entry-level language, and Las Vegas / remote location; it penalizes postings that clearly require more years of experience than you have and excludes senior/lead/manager titles outright.

## Tuning your profile

Edit `config.json`:
- `candidate.targetTitles` — job titles you're aiming for
- `candidate.skills` — keywords pulled from your resume; add/remove as your skillset changes
- `candidate.locations` / `remoteOk` — where you'll work
- `candidate.maxYearsExperienceComfortable` — used to flag postings whose stated experience requirement is a stretch
- `search.queries` — the actual search terms sent to Adzuna/USAJobs

## Next step after a search

Bring `data/shortlist-<date>.json` (or just the postings you're interested in) into a Claude Code conversation and ask for a tailored resume and cover letter, the same way we did for Boutique Recruiting and The Palms.
