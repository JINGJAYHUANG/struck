// Market rule profiles. Each option is tied to the text that allows it. Only DE and EU-BASE ship in v1;
// any other market is "custom" and Struck makes no claim about it.

export const SOURCES = {
  art6a: {
    id: 'art6a',
    title: 'Directive 98/6/EC, Article 6a (added by Directive (EU) 2019/2161)',
    url: 'https://eur-lex.europa.eu/eli/dir/1998/6/oj',
  },
  guidance: {
    id: 'guidance',
    title: 'Commission guidance on Article 6a, OJ C 526, 29.12.2021',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52021XC1229(06)',
  },
  cjeu: {
    id: 'cjeu',
    title: 'Court of Justice, C-330/23 Aldi Süd, judgment of 26 September 2024',
    url: 'https://curia.europa.eu/jcms/upload/docs/application/pdf/2024-09/cp240152en.pdf',
  },
  pangv11: {
    id: 'pangv11',
    title: 'Preisangabenverordnung (PAngV) § 11',
    url: 'https://www.gesetze-im-internet.de/pangv_2022/__11.html',
  },
};

export const PROFILES = {
  DE: {
    code: 'DE',
    name: 'Germany (PAngV § 11)',
    timeZone: 'Europe/Berlin',
    currency: 'EUR',
    locale: 'de-DE',
    windowDays: 30,
    progressive: { enabled: true, source: 'pangv11', note: '§ 11(2): a progressive reduction that increases without interruption may keep the lowest price from before it began.' },
    perishableExemption: { enabled: true, requiresNotice: true, source: 'pangv11', note: '§ 11(4) no. 2: perishable goods reduced because of imminent spoilage or expiry, when this is made clear to consumers.' },
    individualExemption: { enabled: true, source: 'pangv11', note: '§ 11(4) no. 1: individual price reductions.' },
    newProductShorterWindow: { enabled: false, source: 'pangv11', note: '§ 11 has no shorter period for newly launched goods.' },
    roundingMode: 'floor',
    status: 'verified',
    verifiedAt: '2026-11-20',
    sources: ['pangv11', 'art6a', 'guidance', 'cjeu'],
  },
  'EU-BASE': {
    code: 'EU-BASE',
    name: 'EU baseline (Article 6a without national options)',
    timeZone: 'Europe/Brussels',
    currency: 'EUR',
    locale: 'en-IE',
    windowDays: 30,
    progressive: { enabled: false, source: 'art6a', note: 'Article 6a(5) is a national option; the baseline does not use it.' },
    perishableExemption: { enabled: false, requiresNotice: true, source: 'art6a', note: 'Article 6a(3) is a national option; the baseline does not use it.' },
    individualExemption: { enabled: false, source: 'art6a', note: 'Not part of the baseline.' },
    newProductShorterWindow: { enabled: false, source: 'art6a', note: 'Article 6a(4) is a national option; the baseline does not use it.' },
    roundingMode: 'floor',
    status: 'baseline',
    verifiedAt: '2026-11-20',
    sources: ['art6a', 'guidance', 'cjeu'],
  },
};

export function getProfile(code, custom = {}) {
  const key = String(code || '').toUpperCase();
  if (PROFILES[key]) return PROFILES[key];
  if (custom[key]) return { ...custom[key], code: key, status: 'custom' };
  return null;
}

/** JSON with object keys sorted at every level, so equal data always gives the same text. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Short stable fingerprint (FNV-1a), stored with every result so a later change of rules or data is visible. */
export function fingerprint(value) {
  const s = stableStringify(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const profileHash = (profile) => fingerprint(profile);
