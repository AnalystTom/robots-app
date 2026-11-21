import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { canDeleteOrganization } from "@robots/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadFailure } from "../../components/load-failure";
import { SettingsGroup, SettingsInputRow, SettingsRow } from "../../components/settings-group";
import { mobileTokens } from "../../lib/appearance";
import { native, useThemedStyles } from "../../lib/native";
import type { Organization } from "../../lib/organizations";
import {
  activeOrganization,
  leaveDeletedOrganization,
  organizationsQuery,
  useOrganizations,
} from "../../lib/organizations";
import { useSave } from "../../lib/query";
import { openFromSettingsSheet } from "../../lib/settings-sheet";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

export default function OrganizationSettings() {
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const query = useOrganizations();
  const organization = activeOrganization(query.data);
  const deleteRequested = useLocalSearchParams<{ delete?: string }>().delete === "1";

  if (!organization) {
    return (
      <SafeAreaView edges={["bottom"]} style={styles.screen}>
        <ScrollView style={sideInsets} contentContainerStyle={styles.content}>
          {query.error ? (
            <LoadFailure message={errorText(query.error)} onRetry={() => void query.refetch()} />
          ) : (
            <ActivityIndicator color={native.secondaryLabel} />
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <OrganizationEditor
      key={organization.id}
      organization={organization}
      canDelete={canDeleteOrganization(query.data?.organizations ?? [], organization)}
      deleteRequested={deleteRequested}
    />
  );
}

function OrganizationEditor({
  organization,
  canDelete,
  deleteRequested,
}: {
  organization: Organization;
  canDelete: boolean;
  deleteRequested: boolean;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(deleteRequested);
  const [confirmation, setConfirmation] = useState("");
  const name = draft ?? organization.name;
  const trimmed = name.trim();
  const changed = trimmed !== "" && trimmed !== organization.name;
  const rename = useSave({
    save: (next: string, send) =>
      send("organizations/rename", { organizationId: organization.id, name: next }),
    stale: [organizationsQuery().queryKey],
    onSaved: () => setDraft(null),
  });
  const removal = useSave({
    save: async (organizationId: string, send) => {
      const { activeSpaceId } = await send("organizations/remove", { organizationId });
      await leaveDeletedOrganization(organization, activeSpaceId);
    },
    closesScreen: true,
  });
  const pending = rename.pending || removal.pending;
  const failure = rename.error ?? removal.error;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <SettingsGroup accessibilityLabel={t`Organization name`} label={t`Organization name`}>
          {organization.canManage ? (
            <SettingsInputRow
              key="name"
              accessibilityLabel={t`Organization name`}
              editable={!pending}
              maxLength={60}
              value={name}
              onChangeText={setDraft}
              onSubmitEditing={() => {
                if (changed) rename.run(trimmed);
              }}
              onEndEditing={() => {
                if (!trimmed) setDraft(null);
              }}
              returnKeyType="done"
            />
          ) : (
            <SettingsRow key="name" title={organization.name} />
          )}
          {organization.canManage && changed ? (
            <SettingsRow
              key="save"
              accessibilityRole="button"
              disabled={pending}
              dimmed={pending}
              tinted
              title={rename.pending ? t`Saving…` : t`Save`}
              onPress={() => rename.run(trimmed)}
            />
          ) : null}
        </SettingsGroup>
        <SettingsGroup label={t`New organization`}>
          <SettingsRow
            key="create"
            accessibilityRole="button"
            disabled={pending}
            title={t`Create organization`}
            onPress={() => openFromSettingsSheet(router, "/new-organization")}
          />
        </SettingsGroup>
        {canDelete ? (
          <SettingsGroup>
            <SettingsRow
              key="delete"
              accessibilityRole="button"
              destructive
              disabled={pending}
              dimmed={pending}
              title={t`Delete organization`}
              onPress={() => {
                setConfirming((open) => !open);
                setConfirmation("");
              }}
            />
            {confirming ? (
              <SettingsInputRow
                key="confirmation"
                accessibilityLabel={t`Type ${ph({ name: organization.name })} to confirm`}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                editable={!pending}
                placeholder={t`Type ${ph({ name: organization.name })} to confirm`}
                value={confirmation}
                onChangeText={setConfirmation}
              />
            ) : null}
            {confirming ? (
              <SettingsRow
                key="confirm"
                accessibilityRole="button"
                destructive
                disabled={pending || confirmation.trim() !== organization.name.trim()}
                dimmed={pending || confirmation.trim() !== organization.name.trim()}
                title={t`Delete`}
                trailing={
                  pending ? <ActivityIndicator color={mobileTokens().destructive} /> : undefined
                }
                onPress={() => removal.run(organization.id)}
              />
            ) : null}
          </SettingsGroup>
        ) : null}
        {failure ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorText(failure)}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    content: { width: "100%", padding: 20, gap: 24, paddingBottom: 40 },
    error: { color: tokens.destructive, fontSize: 14 },
  });
}
