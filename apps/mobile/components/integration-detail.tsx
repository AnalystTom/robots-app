import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { Connection, ConnectionCatalogItem, RpcOutput } from "@robots/contracts";
import { CONNECTION_LABEL_MAX_LENGTH } from "@robots/contracts";
import type {
  PermissionTool,
  RiskyCapability,
  ToolPermission,
  ToolPermissionState,
} from "@robots/core";
import {
  appToolLabel,
  catalogItemKey,
  groupToolsByEffect,
  guardedCapabilities,
  riskyCapability,
  TOOL_PERMISSIONS,
  toolPermissionChoices,
} from "@robots/core";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { native, useThemedStyles } from "../lib/native";
import type { ToolPermissions } from "../lib/tool-permissions";
import { usePermissionCopy, useToolPermissions } from "../lib/tool-permissions";
import { ConnectorIcon } from "./connector-icon";
import { createIntegrationsStyles } from "./integrations-styles";
import { MenuPicker } from "./menu-picker";
import { NativeActionButton } from "./native-action-button";
import { NativeSymbol } from "./native-symbol";
import type { PermissionSheetGrant } from "./permission-sheet";
import { PermissionSheet } from "./permission-sheet";
import { Chevron } from "./row-accessories";

export type ConnectionTool = RpcOutput<"connections/tools">[number];

const HERO_ICON_SIZE = 56;

export function IntegrationDetail({
  item,
  accounts,
  pending,
  labelDrafts,
  setLabelDrafts,
  tools,
  toolsLoading,
  botName,
  onBack,
  onUninstall,
  onRename,
  onRevoke,
  onConnect,
}: {
  item: ConnectionCatalogItem;
  accounts: Connection[];
  pending: string | null;
  labelDrafts: Record<string, string>;
  setLabelDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  tools: ConnectionTool[];
  toolsLoading: boolean;
  botName: string;
  onBack: () => void;
  onUninstall: () => void;
  onRename: (row: Connection) => void;
  onRevoke: (row: Connection) => void;
  onConnect: () => void;
}) {
  const styles = useThemedStyles(createIntegrationsStyles);
  const { t } = useLingui();
  const key = catalogItemKey(item);
  const connecting = pending === key;
  const uninstalling = pending === `uninstall:${key}`;
  const permissionTools: PermissionTool[] = tools.map((tool) => ({
    name: tool.name,
    label: appToolLabel(tool.name, item.slug),
    readOnly: tool.readOnly,
  }));
  const { actions } = groupToolsByEffect(permissionTools);
  const description =
    accounts.length === 0
      ? t`Connect an account so ${ph({ bot: botName })} can use ${ph({ name: item.name })}.`
      : permissionTools.length === 0
        ? null
        : actions.length > 0
          ? t`Look things up and take actions in ${ph({ name: item.name })}.`
          : t`Look things up in ${ph({ name: item.name })}.`;

  return (
    <View testID="connection-page" style={styles.detail}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Back`}
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.link}>{t`Back`}</Text>
      </Pressable>

      <View style={styles.hero}>
        <ConnectorIcon logo={item.logo} name={item.name} size={HERO_ICON_SIZE} />
        <View style={styles.grow}>
          <Text numberOfLines={1} style={styles.heroTitle}>
            {item.name}
          </Text>
          <View style={styles.placement}>
            <NativeSymbol android="cloud" color={native.secondaryLabel} ios="cloud" size={14} />
            <Text style={styles.secondary}>{t`Cloud`}</Text>
            <Text style={styles.tertiary}>{t`Always on`}</Text>
          </View>
        </View>
      </View>
      {description ? <Text style={styles.explanation}>{description}</Text> : null}

      <Text style={styles.section}>{t`Access`}</Text>
      <View testID="connection-accounts" style={styles.groupCard}>
        {accounts.length === 0 ? (
          <View style={styles.groupRow}>
            <Text style={[styles.rowLabel, styles.grow]}>
              {t`${ph({ name: item.name })} account`}
            </Text>
            <NativeActionButton
              accessibilityLabel={t`Connect ${ph({ name: item.name })}`}
              disabled={connecting}
              fill={false}
              label={connecting ? t`Working…` : t`Connect`}
              onPress={onConnect}
              prominence="secondary"
            />
          </View>
        ) : (
          <>
            {accounts.map((row, index) => (
              <View key={row.id} style={[styles.groupRow, index > 0 && styles.groupDivider]}>
                <View style={styles.grow}>
                  <TextInput
                    value={labelDrafts[row.id] ?? row.displayName}
                    maxLength={CONNECTION_LABEL_MAX_LENGTH}
                    onChangeText={(value) =>
                      setLabelDrafts((current) => ({ ...current, [row.id]: value }))
                    }
                    onEndEditing={() => onRename(row)}
                    accessibilityLabel={t`Account label`}
                    style={styles.rowInput}
                  />
                  <Text style={styles.secondary}>
                    {row.status === "connected" ? t`Connected` : t`Waiting for sign-in`}
                  </Text>
                </View>
                <NativeActionButton
                  accessibilityLabel={t`Remove ${ph({ name: row.displayName })}`}
                  disabled={pending === row.id || uninstalling}
                  fill={false}
                  label={pending === row.id ? t`Working…` : t`Remove`}
                  onPress={() => onRevoke(row)}
                  prominence="plain"
                />
              </View>
            ))}
            <View style={[styles.groupRow, styles.groupDivider]}>
              <NativeActionButton
                accessibilityLabel={t`Add another ${ph({ name: item.name })}`}
                disabled={connecting || uninstalling}
                fill={false}
                label={connecting ? t`Working…` : t`Add another`}
                onPress={onConnect}
                prominence="plain"
              />
            </View>
          </>
        )}
      </View>

      {accounts.length > 0 && (toolsLoading || permissionTools.length > 0) ? (
        <ToolsSection
          appName={item.name}
          appSlug={item.slug}
          appLogo={item.logo}
          tools={permissionTools}
          loading={toolsLoading}
          botName={botName}
        />
      ) : null}

      {accounts.length > 0 ? (
        <NativeActionButton
          accessibilityLabel={t`Uninstall`}
          disabled={uninstalling || connecting}
          fill={false}
          label={uninstalling ? t`Working…` : t`Uninstall`}
          onPress={onUninstall}
          prominence="destructive"
        />
      ) : null}
    </View>
  );
}

export function ToolsSection({
  appName,
  appSlug,
  appLogo,
  tools,
  loading,
  botName,
  grantsFor,
}: {
  appName: string;
  appSlug: string;
  appLogo: string | null;
  tools: PermissionTool[];
  loading: boolean;
  botName: string;
  grantsFor?: (tool: PermissionTool) => PermissionSheetGrant[];
}) {
  const styles = useThemedStyles(createIntegrationsStyles);
  const { t, i18n } = useLingui();
  const permissions = useToolPermissions();
  const copy = usePermissionCopy(botName);
  const [lookupsOpen, setLookupsOpen] = useState(false);
  const [risky, setRisky] = useState<{
    tool: PermissionTool;
    capability: RiskyCapability;
  } | null>(null);
  const { lookups, actions } = groupToolsByEffect(tools);
  const guarded = permissions.policy ? guardedCapabilities(tools, appSlug, permissions.policy) : [];
  const choices = TOOL_PERMISSIONS.filter((permission) =>
    lookups.every((tool) => toolPermissionChoices(tool).includes(permission)),
  ).map((permission) => ({ key: permission, label: copy.state[permission] }));
  const labels = copy.state;
  const lookupStates = new Set(lookups.map((tool) => permissions.stateOf(tool)));
  const [onlyLookupState] = lookupStates;
  const lookupState = lookupStates.size > 1 ? "mixed" : (onlyLookupState ?? null);
  const pick = (picked: string): ToolPermission | undefined =>
    TOOL_PERMISSIONS.find((permission) => permission === picked);

  return (
    <>
      <Text style={styles.section}>{t`Tools`}</Text>
      <View testID="connection-tools" style={styles.groupCard}>
        {loading ? (
          <View style={styles.groupRow}>
            <ActivityIndicator
              color={native.secondaryLabel}
              accessibilityLabel={t`Loading tools…`}
            />
          </View>
        ) : (
          <>
            {lookups.length > 0 ? (
              <>
                <Pressable
                  testID="tool-row-lookups"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: lookupsOpen }}
                  onPress={() => setLookupsOpen((open) => !open)}
                  style={styles.groupRow}
                >
                  <View style={styles.grow}>
                    <Text style={styles.rowLabel}>{t`Find and read`}</Text>
                    <Text style={styles.secondary}>
                      {lookups.length === 1 ? t`1 tool` : t`${ph({ count: lookups.length })} tools`}
                    </Text>
                  </View>
                  <Text style={styles.secondary}>{lookupState ? copy.state[lookupState] : ""}</Text>
                  <Chevron expanded={lookupsOpen} />
                </Pressable>
                {lookupsOpen ? (
                  <View style={styles.groupDivider}>
                    <MenuPicker
                      label={t`Find and read`}
                      choices={choices}
                      value={lookupState ?? ""}
                      disabled={!lookups.some(permissions.editable) || permissions.pending}
                      onChange={(picked) => {
                        const permission = pick(picked);
                        if (permission) permissions.set(lookups, permission);
                      }}
                    />
                    {lookups.map((tool) => (
                      <ToolRow
                        key={tool.name}
                        tool={tool}
                        labels={labels}
                        permissions={permissions}
                        onOpen={null}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
            {actions.map((tool, index) => {
              const capability = riskyCapability(tool, appSlug);
              return (
                <View
                  key={tool.name}
                  style={index > 0 || lookups.length > 0 ? styles.groupDivider : undefined}
                >
                  <ToolRow
                    tool={tool}
                    labels={labels}
                    permissions={permissions}
                    onOpen={capability ? () => setRisky({ tool, capability }) : null}
                  />
                </View>
              );
            })}
          </>
        )}
      </View>
      {permissions.error ? <Text style={styles.error}>{permissions.error}</Text> : null}
      {guarded.length > 0 ? (
        <Text style={styles.caption}>
          {copy.asksBefore(
            new Intl.ListFormat(i18n.locale, { type: "disjunction" }).format(
              guarded.map((capability) => copy.noun[capability]),
            ),
          )}
        </Text>
      ) : null}
      {risky ? (
        <PermissionSheet
          appName={appName}
          appLogo={appLogo}
          botName={botName}
          tool={risky.tool}
          capability={risky.capability}
          grants={grantsFor?.(risky.tool) ?? []}
          permissions={permissions}
          onClose={() => setRisky(null)}
        />
      ) : null}
    </>
  );
}

function ToolRow({
  tool,
  labels,
  permissions,
  onOpen,
}: {
  tool: PermissionTool;
  labels: Record<ToolPermissionState, string>;
  permissions: ToolPermissions;
  onOpen: (() => void) | null;
}) {
  const state = permissions.stateOf(tool);
  const offered: readonly ToolPermissionState[] = toolPermissionChoices(tool);
  const shown = state && !offered.includes(state) ? [...offered, state] : offered;
  return (
    <View testID={onOpen ? "tool-row-risky" : "tool-row"}>
      <MenuPicker
        label={tool.label}
        choices={shown.map((key) => ({ key, label: labels[key] }))}
        value={state ?? ""}
        disabled={!permissions.editable(tool) || permissions.pending}
        onPress={onOpen ?? undefined}
        onChange={(picked) => {
          const permission = TOOL_PERMISSIONS.find((option) => option === picked);
          if (permission) permissions.set([tool], permission);
        }}
      />
    </View>
  );
}
