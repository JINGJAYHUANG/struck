// Pure helper (no Forge imports), so it can be tested offline.

/**
 * Lines from the agent's linesJson. Agents sometimes wrap the JSON in backticks or a code fence, or send it as a
 * JSON string with escaped quotes; accept those forms, and nothing looser. Returns undefined when it is not JSON.
 */
export function parseLinesJson(raw) {
  let s = String(raw ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    .replace(/^`+/, '').replace(/`+$/, '')
    .trim();
  for (let i = 0; i < 3; i += 1) {
    try {
      const v = JSON.parse(s);
      if (typeof v !== 'string') return v;
      s = v.trim();
    } catch {
      if (!s.includes('\\"')) return undefined;
      s = s.replace(/\\"/g, '"');
    }
  }
  return undefined;
}
