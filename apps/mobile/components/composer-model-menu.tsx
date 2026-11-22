import type { MenuAction } from "@expo/ui/community/menu";
import { MenuView } from "@expo/ui/community/menu";
import { useLingui } from "@lingui/react/macro";
import type { ModelTier } from "@robots/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  MODEL_TIERS,
  modelOptionKey,
  modelTierMenu,
  parseModelOptionKey,
  supportsFastMode,
} from "@robots/core";
import { useQuery } from "@tanstack/react-query";
import { Alert, Text, View } from "react-native";
import { useMobileTokens, useResolvedAppearance } from "../lib/native";
import { queryClient, rpcQuery, useSave } from "../lib/query";
import { errorText } from "../lib/user-error";
import { NativeSymbol } from "./native-symbol";

export function ComposerModelMenu({ botId }: { botId: string }) {
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const botRead = rpcQuery("bots/get", { botId });
  const bot = useQuery(botRead, queryClient).data;
  const me = useQuery(rpcQuery("me"), queryClient).data;
  const catalog = useQuery(rpcQuery("models/list"), queryClient).data;
  const credentials = useQuery(rpcQuery("models/credentials"), queryClient).data;
  const save = useSave<string>({
    save: async (key, send) => {
      const parsed = key ? parseModelOptionKey(key) : null;
      await send("bots/update", {
        botId,
        modelProvider: parsed?.provider ?? null,
        modelId: parsed?.modelId ?? null,
        thinkingLevel: null,
      });
    },
    stale: [botRead.queryKey],
    onFailed: (error) => Alert.alert(errorText(error, t`Could not change the model`)),
  });
  const saveFast = useSave<boolean>({
    save: async (fastMode, send) => {
      await send("bots/update", { botId, fastMode });
    },
    stale: [botRead.queryKey],
    onFailed: (error) => Alert.alert(errorText(error, t`Could not change Fast mode`)),
  });
  if (!bot || !me || !catalog || !credentials) return null;
  const savedKey =
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "";
  const selectedKey = save.pending && save.input !== undefined ? save.input : savedKey;
  const menu = modelTierMenu({
    choices: chatModelChoices(
      connectedModelChoices(credentials, catalog),
      selectedKey,
      t`Space default`,
    ),
    catalog,
    defaultProvider: me.defaultProvider,
    selectedKey,
  });
  if (!menu.providers.length) return null;
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
  const modelLabel = menu.tier
    ? tiers[menu.tier].title
    : (selectedModel?.modelLabel ?? selectedModel?.label ?? t`Model`);
  const fastAvailable = supportsFastMode(menu.provider);
  const fast =
    fastAvailable &&
    (saveFast.pending && saveFast.input !== undefined ? saveFast.input : bot.fastMode);
  const label = fast ? t`${modelLabel} · Fast` : modelLabel;
  const provider = menu.providers.find((entry) => entry.provider === menu.provider);
  const actions: MenuAction[] = [
    {
      id: "tiers",
      title: t`This bot's model`,
      displayInline: true,
      subactions: MODEL_TIERS.map((tier) => ({
        id: `tier:${tier}`,
        title: `${tiers[tier].title}\n${tiers[tier].detail}`,
        state: menu.tier === tier ? ("on" as const) : ("off" as const),
      })),
    },
    ...(fastAvailable
      ? [
          {
            id: "fast",
            title: `${t`Fast`}\n${t`Faster replies, uses more of your plan`}`,
            state: fast ? ("on" as const) : ("off" as const),
          },
        ]
      : []),
    {
      id: "advanced",
      title: t`Advanced`,
      subactions: [
        {
          id: "providers",
          title: provider ? t`Provider: ${provider.label}` : t`Provider`,
          subactions: menu.providers.map((entry) => ({
            id: `provider:${entry.provider}`,
            title: entry.label,
            state: entry.provider === menu.provider ? ("on" as const) : ("off" as const),
          })),
        },
        {
          id: "models",
          title: selectedModel
            ? t`Model: ${selectedModel.modelLabel ?? selectedModel.label}`
            : t`Model`,
          subactions: menu.models.map((choice) => ({
            id: `model:${choice.key}`,
            title: choice.modelLabel ?? choice.label,
            state: choice.key === runningKey ? ("on" as const) : ("off" as const),
          })),
        },
      ],
    },
  ];
  const choose = (event: string) => {
    if (event === "fast") {
      saveFast.run(!fast);
      return;
    }
    const [kind, ...rest] = event.split(":");
    const value = rest.join(":");
    const key =
      kind === "tier"
        ? menu.keyFor(value as ModelTier, menu.provider ?? undefined)
        : kind === "provider"
          ? menu.keyFor("auto", value)
          : kind === "model"
            ? value
            : undefined;
    if (key !== undefined && key !== selectedKey) save.run(key);
  };
  return (
    <MenuView
      actions={actions}
      colorScheme={colorScheme}
      onPressAction={({ nativeEvent }) => choose(nativeEvent.event)}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={t`Model: ${label}`}
        style={{
          height: 28,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          paddingHorizontal: 6,
        }}
      >
        <Text
          numberOfLines={1}
          style={{ color: tokens.mutedForeground, fontSize: 15, maxWidth: 96 }}
        >
          {label}
        </Text>
        <NativeSymbol
          ios="chevron.down"
          android="chevron-down"
          size={11}
          color={tokens.mutedForeground}
        />
      </View>
    </MenuView>
  );
}
