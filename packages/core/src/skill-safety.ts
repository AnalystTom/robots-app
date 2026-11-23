import type { SkillSafetyFinding, SkillSafetyRule, SkillSafetySeverity } from "@robots/contracts";

const SEVERITY: Record<SkillSafetyRule, SkillSafetySeverity> = {
  download_and_run: "high",
  decode_and_run: "high",
  credential_exfiltration: "high",
  credential_access: "low",
  destructive_command: "high",
  instruction_override: "high",
  hidden_comment: "low",
  encoded_blob: "low",
  bidi_unicode: "high",
  tag_unicode: "high",
  zero_width_unicode: "low",
};

const REASON: Record<SkillSafetyRule, string> = {
  download_and_run: "Downloads a script and runs it in a shell.",
  decode_and_run: "Decodes hidden content and runs it.",
  credential_exfiltration: "Reads credential files and sends them over the network.",
  credential_access: "Reads credential files such as SSH keys, .env files or keychains.",
  destructive_command: "Deletes or overwrites a whole disk or home folder.",
  instruction_override: "Tells the bot to ignore its instructions or to keep things from you.",
  hidden_comment: "Holds instructions in a comment that is hidden when the skill is shown.",
  encoded_blob: "Contains a long encoded blob that cannot be read.",
  bidi_unicode: "Contains invisible characters that reorder text.",
  tag_unicode: "Contains invisible characters that can hide instructions.",
  zero_width_unicode: "Contains zero-width characters.",
};

const SHELL = String.raw`(?:sudo\s+(?:-\S+\s+)*)?(?:env\s+)?(?:ba|z|da|k|c|tc|fi)?sh\b`;
const INTERPRETER = String.raw`(?:sudo\s+)?(?:python[\d.]*|perl|ruby|node|php|iex|Invoke-Expression)\b`;
const FETCHER = String.raw`(?:curl|wget|fetch|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)`;

const LINE_RULES: [Exclude<SkillSafetyRule, "credential_access">, RegExp[]][] = [
  [
    "download_and_run",
    [
      new RegExp(String.raw`\b${FETCHER}\b[^\n]*\|\s*(?:${SHELL}|${INTERPRETER})`, "i"),
      new RegExp(String.raw`\b(?:ba|z)?sh\s+(?:-c\s+)?["']?\$\(\s*${FETCHER}\b`, "i"),
      new RegExp(String.raw`\b(?:ba|z)?sh\s+<\(\s*${FETCHER}\b`, "i"),
      /\b(?:iex|Invoke-Expression)\b[^\n]*\b(?:DownloadString|irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\b/i,
    ],
  ],
  [
    "decode_and_run",
    [
      new RegExp(
        String.raw`\bbase64\s+(?:-d|-D|--decode)\b[^\n]*\|\s*(?:${SHELL}|${INTERPRETER})`,
        "i",
      ),
      /\b(?:eval|exec|Function)\s*\(\s*(?:atob|Buffer\.from|(?:base64\.)?b64decode|codecs\.decode|bytes\.fromhex|unescape)\b/i,
      /\bexec\s*\(\s*__import__\(\s*["'](?:base64|codecs|zlib)["']\s*\)/i,
      /\beval\s+["'`]?\$\(\s*echo\b[^\n]*\bbase64\s+(?:-d|-D|--decode)\b/i,
    ],
  ],
  [
    "destructive_command",
    [
      /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)(?:-{1,2}[\w-]+\s+)*["']?(?:\/|\/\*|~|~\/\*?|\$HOME\/?\*?|\$\{HOME\}\/?\*?)["']?(?:\s|$|;|&)/,
      /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
      /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|disk|hd|mmcblk)/,
      /\bmkfs(?:\.\w+)?\s+\/dev\//,
    ],
  ],
  [
    "instruction_override",
    [
      /\b(?:ignore|disregard|forget|override|bypass)\b[^\n.]{0,40}\b(?:previous|prior|above|earlier|all|any|other|your|the)\b[^\n.]{0,30}\b(?:instructions?|prompts?|rules|guidelines|directives|system messages?)\b/i,
      /\b(?:ignore|disregard|override)\s+(?:what\s+)?(?:the\s+)?(?:user|owner|system prompt|system message|developer message)\b/i,
      /\b(?:do not|don't|never)\s+(?:tell|inform|notify|alert|warn)\s+(?:the\s+)?(?:user|owner|human)\b/i,
      /\bwithout\s+(?:telling|informing|asking|notifying|alerting)\s+(?:the\s+)?(?:user|owner|human)\b/i,
      /\b(?:hide|conceal|keep)\b[^\n.]{0,40}\bfrom\s+(?:the\s+)?(?:user|owner|human)\b/i,
      /\bnew system prompt\b|\byou are no longer bound\b/i,
    ],
  ],
  [
    "encoded_blob",
    [
      /(?=[A-Za-z0-9+/]{120,})(?=[^\s]*\d)(?=[^\s]*[a-z])(?=[^\s]*[A-Z])[A-Za-z0-9+/]{120,}={0,2}/,
      /(?:\\x[0-9a-fA-F]{2}){24,}/,
      /\b[0-9a-fA-F]{200,}\b/,
      /\bString\.fromCharCode\s*\((?:\s*\d+\s*,){20,}/,
    ],
  ],
  ["bidi_unicode", [/[‪-‮⁦-⁩]/]],
  ["tag_unicode", [/[\u{E0000}-\u{E007F}]/u]],
  ["zero_width_unicode", [/[​⁠-⁤᠎]|(?<!^)﻿|(?<=[\x21-\x7E])[‌‍]|[‌‍](?=[\x21-\x7E])/]],
];

const CREDENTIAL_FILE =
  /(?:^|[\s"'`/=(:])(?:~\/|\$HOME\/|\/root\/|\/home\/[^/\s]+\/)?\.ssh\/|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|(?:^|[\s"'`/=(:])\.env(?!\.(?:example|sample|template)\b)(?:\.[\w-]+)?\b|\.aws\/credentials|\.netrc\b|\.git-credentials\b|\.npmrc\b|\.pypirc\b|\.docker\/config\.json|\.kube\/config\b|\.config\/gh\/hosts\.yml|\.gnupg\/|\bkeychains?\b|\bsecurity\s+(?:find|dump)-(?:generic|internet)-password|\/etc\/shadow\b|\bwallet\.dat\b/i;
const NETWORK_SEND =
  /\b(?:curl|wget|nc|ncat|netcat|scp|rsync|sftp|ftp|socat|telnet)\b|\bInvoke-(?:WebRequest|RestMethod)\b|\bfetch\s*\(|\b(?:requests|axios|httpx)\.(?:post|put|patch)\b|\/dev\/(?:tcp|udp)\//i;
const SEND_WORDS =
  /\b(?:send|upload|post|exfiltrate|transmit|forward|email|paste)\b[^\n]{0,80}\b(?:to|into|at)\b/i;
const CREDENTIAL_WINDOW = 3;

const HIDDEN_COMMENT = /<!--([\s\S]*?)-->/g;
const IMPERATIVE =
  /\b(?:you|must|always|never|ignore|assistant|agent|AI|model|execute|run|send|do not|don't|instead)\b/i;

export function scanSkillSafety(content: string): SkillSafetyFinding[] {
  const text = content.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const found = new Map<string, SkillSafetyFinding>();
  const add = (rule: SkillSafetyRule, line: number) => {
    const key = `${line}:${rule}`;
    if (!found.has(key)) {
      found.set(key, { rule, severity: SEVERITY[rule], line, reason: REASON[rule] });
    }
  };
  const sends = lines.map((line) => NETWORK_SEND.test(line));
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    for (const [rule, patterns] of LINE_RULES) {
      if (patterns.some((pattern) => pattern.test(line))) add(rule, number);
    }
    if (CREDENTIAL_FILE.test(line)) {
      const from = Math.max(0, index - CREDENTIAL_WINDOW);
      const to = Math.min(lines.length, index + CREDENTIAL_WINDOW + 1);
      const sent = SEND_WORDS.test(line) || sends.slice(from, to).some(Boolean);
      add(sent ? "credential_exfiltration" : "credential_access", number);
    }
  }
  for (const match of text.matchAll(HIDDEN_COMMENT)) {
    if (!IMPERATIVE.test(match[1] ?? "")) continue;
    add("hidden_comment", lineAt(text, match.index));
  }
  return [...found.values()].sort(
    (left, right) =>
      left.line - right.line || RULE_ORDER.indexOf(left.rule) - RULE_ORDER.indexOf(right.rule),
  );
}

export function skillSafetyBlocks(findings: readonly SkillSafetyFinding[]): boolean {
  return findings.some((finding) => finding.severity === "high");
}

export function unacceptedRiskySkills(
  skills: readonly { name: string; content: string; acceptRisk: boolean }[],
): { name: string; findings: SkillSafetyFinding[] }[] {
  return skills.flatMap(({ name, content, acceptRisk }) => {
    if (acceptRisk) return [];
    const findings = scanSkillSafety(content);
    return skillSafetyBlocks(findings) ? [{ name, findings }] : [];
  });
}

const RULE_ORDER = Object.keys(SEVERITY) as SkillSafetyRule[];

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < index; at = text.indexOf("\n", at + 1)) {
    line += 1;
  }
  return line;
}
