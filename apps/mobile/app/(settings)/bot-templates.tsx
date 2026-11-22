import { useLingui } from "@lingui/react/macro";
import type { Bot, BotTemplateListing } from "@robots/contracts";
import { isBotTemplateChanged } from "@robots/contracts";
import { BOT_TEMPLATE_TEAMS, botTemplateAppMarks } from "@robots/core";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BotAvatar } from "../../components/bot-avatar";
import { ConnectorIcon } from "../../components/connector-icon";
import { NativeActionButton } from "../../components/native-action-button";
import { botTemplateCopy } from "../../lib/bot-template-copy";
import { native, useThemedStyles } from "../../lib/native";
import { queryClient, rpcQuery, useSave } from "../../lib/query";
import type { SearchInboxSession } from "../../lib/search-inbox";
import { addToSearchInbox, searchInboxSession } from "../../lib/search-inbox";
import { openFromSettingsSheet } from "../../lib/settings-sheet";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

type TemplatePick = (
  | { kind: "bot"; template: BotTemplateListing }
  | { kind: "team"; teamId: string }
) & { askedIn: SearchInboxSession };

export default function BotTemplatesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const { t } = useLingui();
  const templates = useQuery(rpcQuery("bots/templates"), queryClient);
  const catalog = useQuery(rpcQuery("connections/catalog", {}), queryClient);
  const { refetch } = templates;

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const open = useSave({
    save: async (pick: TemplatePick, send): Promise<Bot> => {
      if (pick.kind === "team") {
        const { bots, failed } = await send("bots/createTeamFromTemplate", {
          teamId: pick.teamId,
        });
        if (failed.length)
          throw new Error(
            t`Created ${bots.length} of ${bots.length + failed.length} bots. Try again to finish the team.`,
          );
        return bots[0]!;
      }
      const { template } = pick;
      if (template.botId) {
        return queryClient.fetchQuery({
          ...rpcQuery("bots/get", { botId: template.botId }),
          staleTime: 0,
        });
      }
      const { bot } = await send("bots/createFromTemplate", {
        templateId: template.id,
        version: template.version,
        name: botTemplateCopy(template).name,
      });
      return bot;
    },
    onSaved: (bot: Bot, { askedIn }) => {
      if (!navigation.isFocused()) return;
      addToSearchInbox({ kind: "bot", bot }, askedIn);
      openFromSettingsSheet(router, {
        pathname: "/thread",
        params: { botId: bot.id, name: bot.name },
      });
    },
    onFailed: (cause, pick) => {
      if (!navigation.isFocused()) return;
      if (pick.kind === "bot" && pick.template.botId)
        Alert.alert(t`Could not load bot`, errorText(cause, t`Try again.`));
      else if (isBotTemplateChanged(cause)) {
        Alert.alert(t`This template was just updated. Try again.`);
        void refetch();
      } else if (pick.kind === "team") {
        void refetch();
        Alert.alert(t`Could not create the team`, errorText(cause, t`Try again.`), [
          { text: t`Retry`, onPress: () => open.run(pick) },
          { text: t`Cancel`, style: "cancel" },
        ]);
      } else Alert.alert(t`Could not create the bot`, errorText(cause, t`Try again.`));
    },
  });

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {templates.error && !templates.data ? (
          <View style={styles.failure}>
            <Text style={styles.summary}>
              {errorText(templates.error, t`Could not load templates`)}
            </Text>
            <NativeActionButton
              fill={false}
              label={t`Retry`}
              onPress={() => void refetch()}
              prominence="secondary"
            />
          </View>
        ) : null}
        {templates.isPending ? (
          <ActivityIndicator color={native.secondaryLabel} accessibilityLabel={t`Loading…`} />
        ) : null}
        {templates.data
          ? BOT_TEMPLATE_TEAMS.map((team) => {
              const crew = team.templateIds.flatMap(
                (id) => templates.data.find((template) => template.id === id) ?? [],
              );
              const name = t`Autopilot team`;
              const [lead, ...others] = crew.map((member) => botTemplateCopy(member).name);
              const otherNames = others.join(", ");
              return (
                <View key={team.id} testID="bot-template-team" style={styles.card}>
                  <View style={styles.crew}>
                    {crew.map((member) => (
                      <BotAvatar key={member.id} color={member.avatar} size={36} />
                    ))}
                  </View>
                  <View>
                    <Text accessibilityRole="header" style={styles.name}>
                      {name}
                    </Text>
                    <Text style={styles.summary}>{t`${lead} runs ${otherNames}.`}</Text>
                  </View>
                  <NativeActionButton
                    fill={false}
                    size="compact"
                    label={t`Create team`}
                    accessibilityLabel={t`Create ${name}`}
                    busy={open.pending && open.input?.kind === "team"}
                    disabled={open.pending}
                    onPress={() =>
                      open.run({ kind: "team", teamId: team.id, askedIn: searchInboxSession() })
                    }
                  />
                </View>
              );
            })
          : null}
        {templates.data?.map((template) => {
          const { name, summary } = botTemplateCopy(template);
          const marks = botTemplateAppMarks(template, catalog.data ?? []);
          return (
            <View key={template.id} testID="bot-template-card" style={styles.card}>
              <View style={styles.header}>
                <BotAvatar color={template.avatar} size={48} />
                <View style={styles.grow}>
                  <Text accessibilityRole="header" style={styles.name}>
                    {name}
                  </Text>
                  <Text style={styles.summary}>{summary}</Text>
                </View>
              </View>
              <View style={styles.footer}>
                <View style={[styles.grow, styles.marks]}>
                  {marks.map((mark) => (
                    <View key={mark.key} accessible accessibilityLabel={mark.name}>
                      <ConnectorIcon name={mark.name} logo={mark.logo} size={22} />
                    </View>
                  ))}
                </View>
                <NativeActionButton
                  fill={false}
                  size="compact"
                  prominence={template.botId ? "secondary" : "primary"}
                  label={template.botId ? t`Open` : t`Create`}
                  accessibilityLabel={template.botId ? t`Open ${name}` : t`Create ${name}`}
                  busy={
                    open.pending &&
                    open.input?.kind === "bot" &&
                    open.input.template.id === template.id
                  }
                  disabled={open.pending}
                  onPress={() => open.run({ kind: "bot", template, askedIn: searchInboxSession() })}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    content: { padding: 16, gap: 12 },
    failure: { gap: 8 },
    card: {
      gap: 14,
      padding: 16,
      borderRadius: 20,
      borderCurve: "continuous",
      backgroundColor: native.groupedCell,
    },
    header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    grow: { flex: 1, minWidth: 0 },
    name: { color: native.label, fontSize: 17, fontWeight: "600" },
    summary: { color: native.secondaryLabel, fontSize: 15, marginTop: 2 },
    footer: { flexDirection: "row", alignItems: "center", gap: 10 },
    marks: { flexDirection: "row", alignItems: "center", gap: 6 },
    crew: { flexDirection: "row", gap: 4 },
  });
}
