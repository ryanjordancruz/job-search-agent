function norm(s) {
  return (s ?? "").toLowerCase();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary match so short/acronym terms (e.g. "SCA") don't false-positive
// inside unrelated words (e.g. "escalate", "scalable").
function containsTerm(haystack, term) {
  const escaped = escapeRegex(term.toLowerCase());
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
// Matches a digit ("5") or a spelled-out number word ("five") — postings
// mix both freely, especially for single-digit requirements.
const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;

function toYears(numToken) {
  const n = Number(numToken);
  if (!Number.isNaN(n)) return n;
  return NUMBER_WORDS[numToken] ?? null;
}

// Looks for patterns like "3+ years", "5-7 years", "minimum of 2 years",
// "five years' experience" and returns every distinct requirement found
// (deduped by position), not just one number. Postings routinely stack
// several of these — "5 years AD, 3 years Entra ID, 1 year PAM" — and
// they're a checklist, not alternatives, so the real bar is the highest
// one, not the lowest.
export function extractExperienceRequirements(description) {
  const text = norm(description);
  const patterns = [
    new RegExp(`${NUM}\\s*\\+\\s*years?`, "g"),
    new RegExp(`${NUM}\\s*-\\s*(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})\\s*years?`, "g"),
    new RegExp(`minimum\\s+of\\s+${NUM}\\s+years?`, "g"),
    new RegExp(`at\\s+least\\s+${NUM}\\s+years?`, "g"),
    // bare "N years' experience" / "N years of experience" with no qualifier word
    new RegExp(`${NUM}\\s+years?['’]?\\s*(?:of\\s+)?experience`, "g"),
    // bare "N years with/in/managing/working X" — e.g. "7 years with vulnerability
    // assessments" — no "+" or range, and doesn't end in the word "experience",
    // so none of the patterns above would otherwise catch it.
    new RegExp(`${NUM}\\s+years?['’]?\\s+(?:with|in|of|managing|working|leading|supporting|hands-on|hands on)\\b`, "g"),
  ];
  const requirements = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = toYears(m[1]);
      if (n === null) continue;
      // dedupe overlapping matches from different patterns describing the
      // same requirement (e.g. "minimum of" and the bare "N years experience"
      // pattern both matching "a minimum of five years' experience...", just
      // anchored at different offsets within the same phrase)
      if (requirements.some((r) => Math.abs(r.index - m.index) < 20)) continue;
      const start = Math.max(0, m.index - 45);
      const end = Math.min(text.length, m.index + m[0].length + 15);
      requirements.push({ years: n, index: m.index, context: text.slice(start, end).trim() });
    }
  }
  return requirements.sort((a, b) => a.index - b.index);
}

// Broad "is this even a security-flavored role" check, independent of the
// exact targetTitles phrases. Used to stop postings with an unrelated title
// (e.g. "Management and Program Analyst") from ranking well purely because
// the description happens to mention a few of the candidate's tools.
const TITLE_RELEVANCE_TERMS = [
  "security", "cyber", "cybersecurity", "soc", "vulnerability",
  "infosec", "information assurance", "incident response",
];

// "Compliance"/"GRC" alone are ambiguous — banking (loan/mortgage quality
// control), tax, HR, and environmental compliance analysts all use the exact
// same title as security/IT compliance roles. Unlike TITLE_RELEVANCE_TERMS,
// these words don't confirm the domain on their own, so a titleHit built
// purely on one of these needs corroboration (see isAmbiguousTitleHit below).
const AMBIGUOUS_COMPLIANCE_TERMS = ["compliance", "grc"];

const CLEARANCE_TERMS = [
  "security clearance", "ts/sci", "top secret", "secret clearance",
  "public trust", "clearable", "dod clearance", "government clearance",
  "clearance",
];

// Cues that the posting wants an active/current clearance already in hand.
const ACTIVE_REQUIRED_CUES = [
  "active", "current", "currently hold", "currently possess",
  "must possess", "must hold", "must have an", "in possession of",
];

// Cues that the posting is open to candidates without one yet.
const OBTAIN_CUES = [
  "obtain", "eligib", "willing", "able to acquire", "acquire a clearance",
  "ability to pass", "capable of obtaining",
];

// Defense-contractor postings (SAIC/Leidos/GovCIO templates) often carry a
// structured field: "Minimum Clearance Required: Top_Secret" alongside a
// separate "Clearance Level Must Be Able to Obtain: TS/SCI" field for an
// in-role upgrade path. That second field's "obtain" wording previously
// tripped OBTAIN_CUES below and got misread as openness to candidates without
// a clearance — but "Minimum Clearance Required" naming an actual level means
// one is required in hand, full stop, regardless of the upgrade-path field
// next to it. Caught in the wild on a SAIC "Cybersecurity Compliance Analyst"
// posting (Minimum Clearance Required: Top_Secret) that scored as merely
// "open to obtain." This structured field is authoritative and short-circuits
// the generic cue-window heuristic when it names a real clearance level.
const MIN_CLEARANCE_FIELD_PATTERN = /minimum clearance required:\s*([a-z0-9\/ ]+?)(?:[\n.]|clearance level|potential for remote|$)/i;
const NO_CLEARANCE_VALUES = new Set(["none", "n/a", "na", "not required", "none required"]);

// Looks for "clearance" mentions across the title AND description (Adzuna's
// description field is often truncated and drops the clearance language even
// when the title carries a "with Security Clearance" suffix — a standard
// defense-contractor listing convention) and classifies by nearby language:
// requiring one already active vs. being open to candidates willing/eligible
// to obtain one. A posting can only be penalized for the former.
export function detectClearanceRequirement(title, description) {
  // Templates use underscore-joined enum values ("Top_Secret") instead of
  // spaces — normalize so CLEARANCE_TERMS ("top secret") and the field
  // pattern above still match.
  const text = `${norm(title)} ${norm(description)}`.replace(/_/g, " ");

  const fieldMatch = MIN_CLEARANCE_FIELD_PATTERN.exec(text);
  if (fieldMatch && !NO_CLEARANCE_VALUES.has(fieldMatch[1].trim())) {
    return { mentioned: true, requiresActive: true, opennessToObtain: false };
  }

  const mentioned = CLEARANCE_TERMS.some((t) => containsTerm(text, t));
  if (!mentioned) {
    return { mentioned: false, requiresActive: false, opennessToObtain: false };
  }

  const windowRadius = 60;
  let opennessToObtain = false;
  let sawActiveCue = false;

  const re = /clearance/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - windowRadius);
    const end = Math.min(text.length, m.index + windowRadius);
    const window = text.slice(start, end);
    if (OBTAIN_CUES.some((c) => window.includes(c))) opennessToObtain = true;
    if (ACTIVE_REQUIRED_CUES.some((c) => window.includes(c))) sawActiveCue = true;
  }

  // "Must be willing to obtain an active clearance" trips both cue lists —
  // openness wins, since the posting is explicitly not requiring one in hand.
  // A bare, unqualified mention (e.g. a title's "with Security Clearance"
  // suffix with no clarifying language anywhere) defaults to "requires
  // active": in practice, postings open to candidates without one always say
  // so explicitly, so silence is the employer's default, not an exception.
  return {
    mentioned: true,
    requiresActive: !opennessToObtain,
    opennessToObtain,
  };
}

const STATE_ABBR_SET = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC", "PR",
]);

// Some remote postings (common with federal-contractor staffing agencies)
// exclude candidates in specific states for tax/employment-law reasons —
// a hard, binary disqualifier regardless of skill fit, distinct from a
// generic location mismatch. Best-effort: catches the common phrasing
// Adzuna postings use, not guaranteed to catch every wording.
// Captures a run of 2-letter tokens (state codes) rather than relying on
// punctuation to mark the end of the list — real postings often run
// straight into the next sentence with no period ("...WY Future Need -
// Actively Interviewing...").  Bogus trailing tokens (e.g. "Fu" from
// "Future") get filtered out downstream by the STATE_ABBR_SET check.
const STATE_LIST = "(?:[A-Za-z]{2}[,\\s]+)+[A-Za-z]{2}";
const STATE_EXCLUSION_PATTERNS = [
  new RegExp(`excluded (?:from this job ad|states?/districts?|states?)[:\\s]*(${STATE_LIST})`, "i"),
  new RegExp(`not eligible (?:to work |to apply )?in (?:the following states?|these states?)[:\\s]*(${STATE_LIST})`, "i"),
];

export function detectStateExclusion(description, candidateStateAbbr) {
  const text = description ?? "";
  for (const re of STATE_EXCLUSION_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const codes = m[1]
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => STATE_ABBR_SET.has(s));
      if (codes.length === 0) continue; // regex matched but nothing parseable — skip
      return { excluded: codes.includes(candidateStateAbbr.toUpperCase()), excludedStates: codes };
    }
  }
  return { excluded: false, excludedStates: [] };
}

// Some postings mention "remote" only as part of a split onsite/remote
// schedule — e.g. "3 Days Onsite - 2 day Remote in Columbia SC" or a title
// suffix like "(Partial Remote)" — which the plain remoteTerms match can't
// tell apart from genuine full remote work. Caught these in the wild: postings
// that read as clean remote matches but were actually hybrid roles hundreds
// of miles away.
const HYBRID_PHRASES = ["hybrid", "partial remote", "partially remote"];
const DAY_SCHEDULE_PATTERN = /\d+\s*days?\s*(?:onsite|on-site|in[\s-]office|in\s+the\s+office|remote)\b/i;

export function detectHybridSchedule(title, description) {
  const text = `${norm(title)} ${norm(description)}`;
  if (HYBRID_PHRASES.some((p) => containsTerm(text, p))) return true;
  return DAY_SCHEDULE_PATTERN.test(text);
}

const STATE_NAMES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

// "Remote" postings from staffing agencies sometimes still require the
// candidate to already live in a specific state (e.g. "Candidate MUST be a
// SC resident. No relocation allowed.") — a hard disqualifier distinct from
// the explicit excluded-states list above, since here only ONE state is
// acceptable rather than a barred list. Also catches the "Remote (Local to
// WI)" phrasing staffing agencies use as a location-suffix shorthand for the
// same requirement — caught in the wild on a Visionary Innovative Technology
// Solutions posting that read as clean nationwide-remote otherwise.
const RESIDENCY_PATTERNS = [
  /must be an? ([a-z .]+?) resident/i,
  /local to\s+([a-z][a-z .]*?)(?=[)\.,;]|\s+area\b|$)/i,
];

// The captured token often carries filler words ahead of the actual state
// ("must be a CURRENT Wisconsin resident") that don't match STATE_NAMES/
// STATE_ABBR_SET verbatim. Rather than require the whole token to be a state,
// check its trailing 1- or 2-word suffix (state names are at most two words)
// so filler prefixes like "current"/"legal"/"permanent" don't break the match.
function extractStateFromToken(token) {
  const words = token.split(/\s+/).filter(Boolean);
  for (let len = Math.min(2, words.length); len >= 1; len--) {
    const candidate = words.slice(words.length - len).join(" ");
    if (STATE_ABBR_SET.has(candidate.toUpperCase())) return candidate.toUpperCase();
    if (STATE_NAMES[candidate]) return STATE_NAMES[candidate];
  }
  return null;
}

export function detectResidencyRequirement(description, candidateStateAbbr) {
  const text = norm(description);
  for (const pattern of RESIDENCY_PATTERNS) {
    const m = pattern.exec(text);
    if (!m) continue;
    const state = extractStateFromToken(m[1].trim());
    if (!state) continue;
    return { required: true, requiredState: state, matchesCandidate: state === candidateStateAbbr.toUpperCase() };
  }
  return { required: false, requiredState: null, matchesCandidate: true };
}

export function scorePosting(posting, profile) {
  const title = norm(posting.title);
  const desc = norm(posting.description);
  const combined = `${title} ${desc}`;

  const flags = [];
  let score = 0;

  // Hard exclude: senior/lead/manager titles
  const excluded = profile.excludeIfTitleContains.some((kw) =>
    containsTerm(title, kw)
  );
  if (excluded) {
    return { score: -1, matchedSkills: [], flags: ["Excluded: senior/lead/management title"] };
  }

  // Hard exclude: posting explicitly bars candidates from the candidate's state
  if (profile.stateAbbreviation) {
    const stateExclusion = detectStateExclusion(posting.description, profile.stateAbbreviation);
    if (stateExclusion.excluded) {
      return {
        score: -1,
        matchedSkills: [],
        flags: [`Excluded: posting bars candidates in ${profile.stateAbbreviation} (excluded states: ${stateExclusion.excludedStates.join(", ")})`],
      };
    }

    // Hard exclude: posting requires residency in a specific state that
    // isn't the candidate's, regardless of any "remote" language elsewhere.
    const residency = detectResidencyRequirement(posting.description, profile.stateAbbreviation);
    if (residency.required && !residency.matchesCandidate) {
      return {
        score: -1,
        matchedSkills: [],
        flags: [`Excluded: posting requires ${residency.requiredState} residency (candidate is in ${profile.stateAbbreviation})`],
      };
    }
  }

  // Location gate: remote postings stay eligible nationwide, but anything
  // not explicitly remote is assumed onsite/hybrid and must fall within the
  // configured radius of the candidate's home base — otherwise it's a hard
  // exclude, not just a deprioritization, since an onsite/hybrid role 400+
  // miles away isn't something the candidate can actually take.
  const loc = norm(posting.location);
  const { metroTerms, remoteTerms, remoteOk, onsiteRadiusMiles, onsiteRadiusCenter } = profile.location;

  const isMetro = metroTerms.some((t) => containsTerm(loc, t));
  // Check title and location first (e.g. "(Remote)" in the title), then fall
  // back to the description body — many postings only state "this is a fully
  // remote position" in the text, not the title/location fields. Guard
  // against negation ("not remote", "no remote work available") so a denial
  // doesn't get read as a confirmation.
  const rawRemoteMatch = remoteOk && remoteTerms.some((t) => {
    if (containsTerm(loc, t) || containsTerm(title, t)) return true;
    const re = new RegExp(`\\b${escapeRegex(t)}\\b`, "i");
    const m = re.exec(desc);
    if (!m) return false;
    const before = desc.slice(Math.max(0, m.index - 20), m.index);
    return !/\b(not|no|non-|isn't|won't be|without)\s*$/.test(before);
  });
  // A "remote" mention paired with hybrid/day-count schedule language isn't
  // full remote work — unless the posting is also local, where a hybrid
  // schedule is still workable in person.
  const hybridSchedule = detectHybridSchedule(title, desc);
  const isRemote = rawRemoteMatch && !(hybridSchedule && !isMetro);

  if (!isRemote && !isMetro) {
    const reason =
      rawRemoteMatch && hybridSchedule
        ? `Excluded: hybrid/partial-remote schedule outside ${onsiteRadiusMiles}-mile radius of ${onsiteRadiusCenter} (location: ${posting.location || "unknown"})`
        : `Excluded: not remote and outside ${onsiteRadiusMiles}-mile radius of ${onsiteRadiusCenter} (location: ${posting.location || "unknown"})`;
    return { score: -1, matchedSkills: [], flags: [reason] };
  }

  if (isMetro) {
    score += 20;
    flags.push(`Within ${onsiteRadiusMiles} miles of ${onsiteRadiusCenter}`);
  } else if (isRemote) {
    score += 15;
    flags.push("Remote-eligible");
  }
  if (isMetro && isRemote) {
    flags.push("Also remote-eligible");
  }

  // Skill keyword overlap (computed before the title match so the ambiguous-
  // compliance-title corroboration check below can use it)
  const matchedSkills = profile.skills.filter((skill) => containsTerm(combined, skill));
  score += Math.min(matchedSkills.length * 3, 30);

  // Title match
  const rawTitleHit = profile.targetTitles.find((t) => title.includes(t.toLowerCase()));
  const hasSecurityTitleTerm = TITLE_RELEVANCE_TERMS.some((t) => containsTerm(title, t));
  // A titleHit built purely on an ambiguous compliance/GRC term (no other
  // security-specific title language) needs at least one matched security
  // skill/framework keyword in the body — otherwise it's treated the same as
  // no title match at all. Caught Pyramid Inc's mortgage-loan "Compliance
  // Analyst" and a "GRC Analyst" posting that never mentioned a single
  // security framework or tool, both of which scored well on title alone.
  const isAmbiguousTitleHit = Boolean(rawTitleHit) && !hasSecurityTitleTerm &&
    AMBIGUOUS_COMPLIANCE_TERMS.some((t) => containsTerm(rawTitleHit, t)) &&
    matchedSkills.length === 0;
  const titleHit = isAmbiguousTitleHit ? null : rawTitleHit;
  const titleRelevant = Boolean(titleHit) || hasSecurityTitleTerm;
  if (titleHit) {
    score += 30;
  } else if (titleRelevant) {
    // partial credit: title touches security, but isn't one of the exact target titles
    score += 15;
  } else if (isAmbiguousTitleHit) {
    flags.push("Title reads as compliance/GRC but no security skills/frameworks matched — likely a non-security compliance role (banking/tax/HR)");
  }

  // Certification match
  const certHit = profile.certifications.some((c) => containsTerm(combined, c));
  if (certHit) score += 10;

  // Experience requirement: use the HIGHEST stacked requirement, not the
  // lowest. A posting listing "5 years AD, 3 years Entra ID, 1 year PAM"
  // requires all of them, not just the easiest one — scoring off the min
  // would rank it as entry-friendly, which is exactly backwards.
  const experienceReqs = extractExperienceRequirements(desc);
  const maxYears = experienceReqs.length ? Math.max(...experienceReqs.map((r) => r.years)) : null;
  const highReqCount = experienceReqs.filter((r) => r.years >= 2).length;

  if (maxYears === null) {
    score += 5; // no explicit years requirement found — neutral/slightly favorable
  } else if (maxYears <= profile.maxYearsExperienceComfortable) {
    score += 15;
  } else if (maxYears <= profile.maxYearsExperienceComfortable + 2) {
    score += 0;
    flags.push(`Requires ~${maxYears}+ years — a stretch, but worth a look`);
  } else {
    score -= 20;
    flags.push(`Requires ${maxYears}+ years — likely not a fit yet`);
  }

  // Multiple stacked multi-year requirements is a specialist/senior-role
  // signature on its own, even when nothing in the title says so and even
  // when the single highest number isn't extreme.
  if (highReqCount >= 3) {
    score -= 15;
    flags.push(`Lists ${highReqCount} separate 2+ year technology requirements — reads like a senior/specialist role regardless of title`);
  }

  // Entry-level language bonus
  if (/entry.level|entry level|recent grad|no experience necessary/.test(desc)) {
    score += 10;
    flags.push("Posting explicitly welcomes entry-level candidates");
  }

  // Security clearance: only penalize when an active/current clearance is
  // actually required. Postings explicitly open to candidates willing or
  // eligible to obtain one aren't blockers and shouldn't be downranked.
  const clearance = detectClearanceRequirement(posting.title, desc);
  if (clearance.requiresActive) {
    score -= 25;
    flags.push("Requires an active security clearance — likely a blocker without one");
  } else if (clearance.opennessToObtain) {
    flags.push("Mentions clearance, but open to candidates willing/eligible to obtain one");
  }

  // Title relevance gate: don't let skill/cert keyword noise in the
  // description carry a posting whose title has nothing to do with security.
  if (!titleRelevant) {
    score = Math.min(score, 8);
    flags.push("Title doesn't read as a security role — kept low despite keyword matches in the description");
  }

  return { score, matchedSkills, flags };
}
