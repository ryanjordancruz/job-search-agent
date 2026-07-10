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

// Looks for patterns like "3+ years", "5-7 years", "minimum of 2 years"
export function extractMinYearsRequired(description) {
  const text = norm(description);
  const patterns = [
    /(\d{1,2})\s*\+\s*years?/g,
    /(\d{1,2})\s*-\s*\d{1,2}\s*years?/g,
    /minimum\s+of\s+(\d{1,2})\s+years?/g,
    /at\s+least\s+(\d{1,2})\s+years?/g,
  ];
  let min = null;
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (!Number.isNaN(n) && (min === null || n < min)) min = n;
    }
  }
  return min;
}

// Broad "is this even a security-flavored role" check, independent of the
// exact targetTitles phrases. Used to stop postings with an unrelated title
// (e.g. "Management and Program Analyst") from ranking well purely because
// the description happens to mention a few of the candidate's tools.
const TITLE_RELEVANCE_TERMS = [
  "security", "cyber", "cybersecurity", "soc", "vulnerability",
  "infosec", "information assurance", "incident response",
];

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

// Looks for "clearance" mentions across the title AND description (Adzuna's
// description field is often truncated and drops the clearance language even
// when the title carries a "with Security Clearance" suffix — a standard
// defense-contractor listing convention) and classifies by nearby language:
// requiring one already active vs. being open to candidates willing/eligible
// to obtain one. A posting can only be penalized for the former.
export function detectClearanceRequirement(title, description) {
  const text = `${norm(title)} ${norm(description)}`;
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

  // Title match
  const titleHit = profile.targetTitles.find((t) => title.includes(t.toLowerCase()));
  const titleRelevant = Boolean(titleHit) || TITLE_RELEVANCE_TERMS.some((t) => containsTerm(title, t));
  if (titleHit) {
    score += 30;
  } else if (titleRelevant) {
    // partial credit: title touches security, but isn't one of the exact target titles
    score += 15;
  }

  // Skill keyword overlap
  const matchedSkills = profile.skills.filter((skill) => containsTerm(combined, skill));
  score += Math.min(matchedSkills.length * 3, 30);

  // Certification match
  const certHit = profile.certifications.some((c) => containsTerm(combined, c));
  if (certHit) score += 10;

  // Experience requirement
  const minYears = extractMinYearsRequired(desc);
  if (minYears === null) {
    score += 5; // no explicit years requirement found — neutral/slightly favorable
  } else if (minYears <= profile.maxYearsExperienceComfortable) {
    score += 15;
  } else if (minYears <= profile.maxYearsExperienceComfortable + 2) {
    score += 0;
    flags.push(`Requires ~${minYears}+ years — a stretch, but worth a look`);
  } else {
    score -= 20;
    flags.push(`Requires ${minYears}+ years — likely not a fit yet`);
  }

  // Location: tiered so in-state and remote postings both stay visible and
  // ranked sensibly, instead of a single "Las Vegas, NV" substring check
  // that misses Adzuna's city/county-only location strings (e.g. "Henderson,
  // Clark County" never contains "Las Vegas" or "Nevada" as text).
  const loc = norm(posting.location);
  const { metroTerms, stateTerms, remoteTerms, remoteOk } = profile.location;

  const isMetro = metroTerms.some((t) => containsTerm(loc, t));
  // Check title too — remote is often only stated in the title (e.g. "(Remote)"),
  // not in the location field.
  const isRemote = remoteOk && remoteTerms.some((t) => containsTerm(loc, t) || containsTerm(title, t));
  const isState = !isMetro && stateTerms.some((t) => containsTerm(loc, t));

  if (isMetro) {
    score += 20;
    flags.push("Las Vegas metro area");
  } else if (isRemote) {
    score += 15;
    flags.push("Remote-eligible");
  } else if (isState) {
    score += 8;
    flags.push(`Elsewhere in Nevada: ${posting.location}`);
  } else if (loc) {
    flags.push(`Location: ${posting.location}`);
  }
  if (isMetro && isRemote) {
    flags.push("Also remote-eligible");
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
