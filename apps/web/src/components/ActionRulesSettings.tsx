import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ACTION_RULE_CATEGORIES,
  ActionRule,
  ActionRuleEffect,
  ActionRuleInitiator,
  SettingsScope,
} from "@robots/contracts";
import { ACTION_RULE_EFFECTS, ActionRuleSchema } from "@robots/contracts";
import { connectorKindFromToolName, evaluateActionRules, humanizeToolName } from "@robots/core";
import { writeSaved } from "@robots/core/query";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@robots/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSave, useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const segmented = "rounded-lg bg-muted p-1";
const segment = "h-7 px-3 text-body-sm aria-pressed:bg-background aria-pressed:shadow-sm";
const ANYONE = "anyone";

type MatchKind = ActionRule["matchKind"];
type Option<Value extends string> = { value: Value; label: string };

function newRuleId(): string {
  return globalThis.crypto.randomUUID();
}

function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function useActionRuleLabels() {
  const { t } = useLingui();
  const effects: Option<ActionRuleEffect>[] = [
    { value: "allow", label: t`Allow` },
    { value: "ask", label: t`Ask` },
    { value: "deny", label: t`Deny` },
  ];
  const initiators: Option<ActionRuleInitiator | typeof ANYONE>[] = [
    { value: ANYONE, label: t`Anyone` },
    { value: "you", label: t`You in the app` },
    { value: "routine", label: t`A routine` },
    { value: "webhook", label: t`A webhook` },
    { value: "chat_app", label: t`A chat app` },
    { value: "bot", label: t`Another bot` },
  ];
  const kinds: Option<MatchKind>[] = [
    { value: "tool", label: t`Action` },
    { value: "connector", label: t`App` },
    { value: "category", label: t`Kind` },
  ];
  const categories: Option<(typeof ACTION_RULE_CATEGORIES)[number]>[] = [
    { value: "email", label: t`Email` },
    { value: "purchase", label: t`Purchases` },
  ];
  const effectLabel = (effect: ActionRuleEffect) =>
    effects.find((option) => option.value === effect)?.label ?? effect;
  const initiatorLabel = (initiator: ActionRuleInitiator | null) =>
    initiators.find((option) => option.value === (initiator ?? ANYONE))?.label ?? "";
  const actionLabel = (rule: ActionRule) => {
    if (rule.matchKind === "category") {
      return categories.find((option) => option.value === rule.matchValue)?.label ?? "";
    }
    if (rule.matchKind === "connector") return t`Any ${rule.matchValue} action`;
    return rule.matchValue.includes("*") ? rule.matchValue : humanizeToolName(rule.matchValue);
  };
  return {
    effects,
    initiators,
    kinds,
    categories,
    effectLabel,
    initiatorLabel,
    actionLabel,
  };
}

function Choice<Value extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: Value;
  options: Option<Value>[];
  disabled?: boolean;
  onChange: (value: Value) => void;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next);
        if (picked) onChange(picked.value);
      }}
      items={options}
    >
      <SelectTrigger aria-label={label} className={className} disabled={disabled}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function EffectPicker({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: ActionRuleEffect;
  disabled?: boolean;
  onChange: (effect: ActionRuleEffect) => void;
}) {
  const { effects } = useActionRuleLabels();
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={([next]) => {
        const effect = ACTION_RULE_EFFECTS.find((option) => option === next);
        if (effect && effect !== value) onChange(effect);
      }}
      disabled={disabled}
      spacing={1}
      className={segmented}
    >
      {effects.map((effect) => (
        <ToggleGroupItem key={effect.value} value={effect.value} className={segment}>
          {effect.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function ActionRulesSettings({ scope }: { scope: SettingsScope }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const input = { scope };
  const listKey = queries.actionRules.list.queryKey({ input });
  const rulesQuery = useQuery(queries.actionRules.list.queryOptions({ input }));
  const rules = rulesQuery.data ?? [];
  const labels = useActionRuleLabels();
  const save = useSave({
    save: async (next: ActionRule[], client) => {
      const saved = await client.actionRules.set({ scope, rules: next });
      await writeSaved(queryClient, listKey, () => saved);
    },
  });
  const disabled = rulesQuery.isPending || Boolean(rulesQuery.error) || save.pending;
  const shown = save.pending && save.input ? save.input : rules;

  return (
    <div data-testid="action-rules" className="space-y-3">
      <SettingsGroup title={<Trans>Rules</Trans>}>
        {shown.map((rule, index) => {
          const action = labels.actionLabel(rule);
          return (
            <SettingsRow
              key={rule.id}
              label={
                <span data-testid="action-rule">
                  {index + 1}. {action}
                  <span className="ml-2 text-body-sm text-muted-foreground">
                    {labels.initiatorLabel(rule.initiator)}
                  </span>
                </span>
              }
              control={
                <>
                  <EffectPicker
                    label={t`Effect of rule ${index + 1}`}
                    value={rule.effect}
                    disabled={disabled}
                    onChange={(effect) =>
                      save.run(
                        shown.map((other) => (other.id === rule.id ? { ...other, effect } : other)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Move rule ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={() => save.run(moved(shown, index, index - 1))}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Move rule ${index + 1} down`}
                    disabled={disabled || index === shown.length - 1}
                    onClick={() => save.run(moved(shown, index, index + 1))}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Delete rule ${index + 1}`}
                    className="text-destructive hover:text-destructive"
                    disabled={disabled}
                    onClick={() => save.run(shown.filter((other) => other.id !== rule.id))}
                  >
                    <Trash2 />
                  </Button>
                </>
              }
            />
          );
        })}
        <AddActionRule disabled={disabled} onAdd={(rule) => save.run([...shown, rule])} />
      </SettingsGroup>
      {shown.length > 0 ? <TestActionRule rules={shown} /> : null}
      {save.error ? (
        <p className="text-body-sm text-destructive">
          {errorText(save.error, t`Could not save rules`)}
        </p>
      ) : rulesQuery.error ? (
        <p className="text-body-sm text-destructive">
          {errorText(rulesQuery.error, t`Could not load rules`)}
        </p>
      ) : null}
    </div>
  );
}

function AddActionRule({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (rule: ActionRule) => void;
}) {
  const { t } = useLingui();
  const labels = useActionRuleLabels();
  const [matchKind, setMatchKind] = useState<MatchKind>("tool");
  const [matchText, setMatchText] = useState("");
  const [category, setCategory] = useState<(typeof ACTION_RULE_CATEGORIES)[number]>("email");
  const [initiator, setInitiator] = useState<ActionRuleInitiator | typeof ANYONE>(ANYONE);
  const [effect, setEffect] = useState<ActionRuleEffect>("ask");
  const draft = ActionRuleSchema.safeParse({
    id: "draft",
    matchKind,
    matchValue: matchKind === "category" ? category : matchText.trim(),
    initiator: initiator === ANYONE ? null : initiator,
    effect,
  });
  return (
    <SettingsRow label={<Trans>New rule</Trans>}>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.success) return;
          onAdd({ ...draft.data, id: newRuleId() });
          setMatchText("");
        }}
      >
        <Choice
          label={t`Match`}
          value={matchKind}
          options={labels.kinds}
          disabled={disabled}
          onChange={setMatchKind}
          className="w-28"
        />
        {matchKind === "category" ? (
          <Choice
            label={t`Kind of action`}
            value={category}
            options={labels.categories}
            disabled={disabled}
            onChange={setCategory}
            className="w-32"
          />
        ) : (
          <Input
            aria-label={matchKind === "tool" ? t`Action name` : t`App name`}
            placeholder={matchKind === "tool" ? "gmail_*" : "gmail"}
            className="w-40"
            value={matchText}
            disabled={disabled}
            onChange={(event) => setMatchText(event.target.value)}
          />
        )}
        <Choice
          label={t`Started by`}
          value={initiator}
          options={labels.initiators}
          disabled={disabled}
          onChange={setInitiator}
          className="w-36"
        />
        <EffectPicker label={t`Effect`} value={effect} disabled={disabled} onChange={setEffect} />
        <Button type="submit" size="sm" disabled={disabled || !draft.success}>
          <Trans>Add</Trans>
        </Button>
      </form>
    </SettingsRow>
  );
}

function TestActionRule({ rules }: { rules: readonly ActionRule[] }) {
  const { t } = useLingui();
  const labels = useActionRuleLabels();
  const [action, setAction] = useState("");
  const [initiator, setInitiator] = useState<ActionRuleInitiator>("you");
  const name = action.trim();
  const verdict = name
    ? evaluateActionRules({
        rules,
        actions: [{ name, connectorKind: connectorKindFromToolName(name) }],
        initiator,
      })
    : undefined;
  const testInitiators = labels.initiators.filter(
    (option): option is Option<ActionRuleInitiator> => option.value !== ANYONE,
  );
  return (
    <SettingsGroup title={<Trans>Test a rule</Trans>} data-testid="action-rule-test">
      <SettingsRow
        label={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={t`Action to test`}
              placeholder="send_email"
              className="w-40"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            />
            <Choice
              label={t`Started by`}
              value={initiator}
              options={testInitiators}
              onChange={setInitiator}
              className="w-36"
            />
          </div>
        }
      >
        {name ? (
          <p className="mt-2 text-body-sm text-muted-foreground" data-testid="action-rule-verdict">
            {verdict
              ? verdict.basis === "rule"
                ? t`Rule ${verdict.index + 1} matches: ${labels.effectLabel(verdict.effect)}.`
                : t`Rule ${verdict.index + 1} is invalid, so this asks.`
              : t`No rule matches. The approval mode decides.`}
          </p>
        ) : null}
      </SettingsRow>
    </SettingsGroup>
  );
}
