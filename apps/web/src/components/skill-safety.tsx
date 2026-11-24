import { Trans, useLingui } from "@lingui/react/macro";
import type { SkillSafetyFinding, SkillSafetyRule } from "@robots/contracts";
import { ConfirmDialog } from "./ConfirmDialog";

export type RiskySkill = { name: string; findings: readonly SkillSafetyFinding[] };

function useRuleText() {
  const { t } = useLingui();
  const text: Record<SkillSafetyRule, string> = {
    download_and_run: t`Downloads a script and runs it`,
    decode_and_run: t`Decodes hidden content and runs it`,
    credential_exfiltration: t`Sends credential files over the network`,
    credential_access: t`Reads credential files`,
    destructive_command: t`Deletes a whole disk or home folder`,
    instruction_override: t`Tells the bot to ignore instructions or keep things from you`,
    hidden_comment: t`Has instructions in a hidden comment`,
    encoded_blob: t`Contains a long encoded blob`,
    bidi_unicode: t`Contains invisible characters that reorder text`,
    tag_unicode: t`Contains invisible characters that can hide text`,
    zero_width_unicode: t`Contains zero-width characters`,
  };
  return (finding: SkillSafetyFinding) => {
    const line = finding.line;
    const reason = text[finding.rule];
    return t`Line ${line}: ${reason}`;
  };
}

export function SkillSafetyList({
  findings,
  className = "",
}: {
  findings: readonly SkillSafetyFinding[];
  className?: string;
}) {
  const findingText = useRuleText();
  if (!findings.length) return null;
  return (
    <ul data-testid="skill-safety-findings" className={`text-body-sm ${className}`}>
      {findings.map((finding) => (
        <li
          key={`${finding.line}:${finding.rule}`}
          data-severity={finding.severity}
          className={finding.severity === "high" ? "text-destructive" : "text-muted-foreground"}
        >
          {findingText(finding)}
        </li>
      ))}
    </ul>
  );
}

export function SkillRiskDialog({
  skills,
  busy = false,
  onCancel,
  onConfirm,
}: {
  skills: readonly RiskySkill[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      busy={busy}
      title={<Trans>Risky content found</Trans>}
      confirmLabel={<Trans>Install anyway</Trans>}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div data-testid="skill-risk-dialog" className="max-h-72 space-y-3 overflow-auto">
        {skills.map((skill) => (
          <section key={skill.name}>
            <h3 className="text-body text-foreground" dir="auto">
              {skill.name}
            </h3>
            <SkillSafetyList findings={skill.findings} className="mt-1" />
          </section>
        ))}
      </div>
    </ConfirmDialog>
  );
}
