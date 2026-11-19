const SHAPES: { pattern: RegExp; random?: boolean }[] = [
  {
    pattern: /(?<![\w-])sk-(?:ant-(?:api\d\d-)?|or-v1-|proj-)?([A-Za-z0-9_-]{20,})/g,
    random: true,
  },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { pattern: /\bhf_[A-Za-z0-9]{30,}/g },
  { pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}/g },
  { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { pattern: /\bbearer\s+([A-Za-z0-9._~+/-]{24,}=*)/gi, random: true },
];

function random(value: string): boolean {
  return /[A-Za-z]/.test(value) && /\d/.test(value) && new Set(value).size > 4;
}

export function looksLikeCredential(text: string): boolean {
  for (const { pattern, random: needsRandom } of SHAPES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!needsRandom || random(match[1] ?? match[0])) return true;
    }
  }
  return false;
}

export const REDACTED_CREDENTIAL = "[removed]";

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

export function redactCredentials(text: string): string {
  let result = text.replace(PRIVATE_KEY_BLOCK, REDACTED_CREDENTIAL);
  for (const { pattern, random: needsRandom } of SHAPES) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match, group: unknown) =>
      !needsRandom || random(typeof group === "string" ? group : match)
        ? REDACTED_CREDENTIAL
        : match,
    );
  }
  return result;
}
