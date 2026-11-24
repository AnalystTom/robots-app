import { useLingui } from "@lingui/react/macro";
import type { Bot, ModelTier } from "@robots/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  modelOptionKey,
  modelTierMenu,
  parseModelOptionKey,
} from "@robots/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  toast,
} from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import type { RpcClient } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

export type BotModelChange = { modelProvider: string | null; modelId: string | null };

export function botModelKey(bot: Pick<Bot, "modelProvider" | "modelId">) {
  return bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "";
}

export function botModelChange(key: string): BotModelChange {
  const parsed = key ? parseModelOptionKey(key) : null;
  return { modelProvider: parsed?.provider ?? null, modelId: parsed?.modelId ?? null };
}

export async function saveBotModel(
  rpc: RpcClient,
  setBots: Dispatch<SetStateAction<Bot[]>>,
  bot: Bot,
  change: BotModelChange,
  failure: string,
) {
  const shown = { ...bot, ...change, thinkingLevel: null };
  const replace = (next: Bot) =>
    setBots((current) => current.map((entry) => (entry.id === bot.id ? next : entry)));
  replace(shown);
  try {
    replace(await rpc.bots.update({ botId: bot.id, ...change, thinkingLevel: null }));
  } catch (error) {
    replace(bot);
    toast.error(errorText(error, failure));
  }
}

export function ComposerModelPicker({
  bot,
  onChange,
}: {
  bot: Pick<Bot, "modelProvider" | "modelId">;
  onChange: (change: BotModelChange) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const credentials = useQuery(queries.models.credentials.queryOptions()).data;
  const catalog = useQuery(queries.models.list.queryOptions()).data;
  const me = useQuery(queries.me.queryOptions()).data;
  const selectedKey = botModelKey(bot);
  const [advancedChoice, setAdvanced] = useState<boolean | null>(null);
  if (!credentials || !catalog || !me) return null;
  const choices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selectedKey,
    t`Space default`,
  );
  const menu = modelTierMenu({
    choices,
    catalog,
    defaultProvider: me.defaultProvider,
    selectedKey,
  });
  if (!menu.providers.length) return null;
  const advanced = advancedChoice ?? menu.tier === null;
  const tiers: Record<ModelTier, { title: string; detail: string }> = {
    lite: { title: t`Lite`, detail: t`Same speed, cheaper` },
    auto: { title: t`Auto`, detail: t`For everyday use` },
    pro: { title: t`Pro`, detail: t`Same speed, smarter` },
  };
  const runningKey =
    selectedKey ||
    (me.defaultProvider && me.defaultModel
      ? modelOptionKey(me.defaultProvider, me.defaultModel)
      : "");
  const selectedModel = menu.models.find((choice) => choice.key === runningKey);
  const label = menu.tier
    ? tiers[menu.tier].title
    : (selectedModel?.modelLabel ?? selectedModel?.label ?? t`Model`);
  const provider = menu.providers.find((entry) => entry.provider === menu.provider);
  const select = (key: string) => {
    if (key !== selectedKey) onChange(botModelChange(key));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t`Model: ${label}`}
        className="flex h-8 max-w-40 shrink-0 items-center gap-1 rounded-full px-2.5 text-body text-foreground/80 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-accent"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t`This bot's model`}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={menu.tier ?? ""}
            onValueChange={(tier: ModelTier) =>
              select(menu.keyFor(tier, menu.provider ?? undefined))
            }
          >
            {(["lite", "auto", "pro"] as const).map((tier) => (
              <DropdownMenuRadioItem key={tier} value={tier} closeOnClick className="py-2">
                <span className="flex flex-col">
                  <span>{tiers[tier].title}</span>
                  <span className="text-body-sm text-muted-foreground">{tiers[tier].detail}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          closeOnClick={false}
          role="menuitemcheckbox"
          aria-checked={advanced}
          className="justify-between py-2 text-muted-foreground"
          onClick={() => setAdvanced(!advanced)}
        >
          {t`Advanced`}
          <span
            aria-hidden="true"
            data-checked={advanced || undefined}
            className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-foreground/20 transition-colors data-checked:bg-primary dark:bg-input/80"
          >
            <span className="block size-4 translate-x-px rounded-full bg-background transition-transform in-data-checked:translate-x-[15px] dark:bg-foreground dark:in-data-checked:bg-primary-foreground" />
          </span>
        </DropdownMenuItem>
        {advanced ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="py-2">
                <span className="text-muted-foreground">{t`Provider`}</span>
                <span className="ml-auto truncate">{provider?.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80">
                <DropdownMenuRadioGroup
                  value={menu.provider ?? ""}
                  onValueChange={(next: string) => select(menu.keyFor("auto", next))}
                >
                  {menu.providers.map((entry) => (
                    <DropdownMenuRadioItem key={entry.provider} value={entry.provider} closeOnClick>
                      {entry.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="py-2">
                <span className="text-muted-foreground">{t`Model`}</span>
                <span className="ml-auto min-w-0 truncate">
                  {selectedModel?.modelLabel ?? tiers.auto.title}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80">
                <DropdownMenuRadioGroup value={runningKey} onValueChange={select}>
                  {menu.models.map((choice) => (
                    <DropdownMenuRadioItem key={choice.key} value={choice.key} closeOnClick>
                      {choice.modelLabel ?? choice.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
