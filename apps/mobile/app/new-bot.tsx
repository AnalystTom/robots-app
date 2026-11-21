import { useLingui } from "@lingui/react/macro";
import type { BotAvatarSet } from "@robots/contracts";
import { BOT_NAME_MAX_LENGTH, resolveBotAvatarSet } from "@robots/contracts";
import {
  botLookState,
  newBotLook,
  newBotLookInput,
  newBotPreviewIdentity,
  ORGANIC_PREVIEW_IDENTITIES,
} from "@robots/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, ScrollView, Text, TextInput, View } from "react-native";
import { BotAvatar } from "../components/bot-avatar";
import { BotLookPicker } from "../components/bot-look-picker";
import { NativeActionButton } from "../components/native-action-button";
import { cancelHeaderOptions } from "../components/sheet-header";
import { rpc } from "../lib/api";
import { askForModelBeforeFirstBot, createInboxBot } from "../lib/create-inbox-bot";
import { openChatFromInbox } from "../lib/inbox-changes";
import { native, useMobileTokens } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

export default function NewBot() {
  const sideInsets = useSideInsets();
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const router = useRouter();
  const params = useLocalSearchParams<{ spaceId?: string; avatarSet?: BotAvatarSet }>();
  const [accountSet, setAccountSet] = useState<BotAvatarSet | null>(null);
  const avatarSet = accountSet ?? resolveBotAvatarSet(params.avatarSet);
  const [name, setName] = useState("");
  const [look, setLook] = useState(newBotLook);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);
  const gone = useRef(false);
  const modelCheck = useRef<Promise<boolean>>(Promise.resolve(false));
  const trimmed = name.trim();
  const identity = newBotPreviewIdentity(avatarSet, look);

  useEffect(() => {
    gone.current = false;
    void rpc("me")
      .then((me) => {
        if (gone.current) return;
        const set = resolveBotAvatarSet(me.botAvatarSet);
        setAccountSet(set);
        if (set === "robots")
          setLook((current) =>
            botLookState(current.color).shapeIndex === null
              ? current
              : { ...current, color: botLookState(current.color).color },
          );
      })
      .catch((err: unknown) => {
        if (!gone.current) setError(errorText(err));
      });
    modelCheck.current = askForModelBeforeFirstBot(params.spaceId, () => !gone.current);
    void modelCheck.current.then((asked) => {
      if (asked && !gone.current) router.back();
    });
    return () => {
      gone.current = true;
    };
  }, [params.spaceId, router]);

  useEffect(() => {
    if (!pending) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [pending]);

  async function create() {
    if (!trimmed || !accountSet || creating.current) return;
    creating.current = true;
    setPending(true);
    setError(null);
    try {
      if (await modelCheck.current) return;
      const outcome = await createInboxBot({
        input: { name: trimmed, ...newBotLookInput(accountSet, look) },
        openChat: (href) => {
          if (gone.current) return;
          router.dismiss();
          if (!openChatFromInbox(href)) router.push(href);
        },
        spaceId: params.spaceId,
      });
      if (outcome !== "created" && !gone.current) router.back();
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          ...cancelHeaderOptions(t`Cancel`, () => {
            if (!creating.current) router.back();
          }),
          gestureEnabled: !pending,
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginTop: 8, marginBottom: 24 }}>
          <BotAvatar color={look.color} identity={identity} avatarSet={avatarSet} size={96} />
        </View>
        <TextInput
          autoFocus
          accessibilityLabel={t`Name`}
          value={name}
          onChangeText={setName}
          maxLength={BOT_NAME_MAX_LENGTH}
          autoCapitalize="words"
          autoCorrect={false}
          editable={!pending}
          placeholder={t`Name your Bot`}
          placeholderTextColor={tokens.mutedForeground}
          returnKeyType="done"
          onSubmitEditing={() => void create()}
          style={{
            height: 56,
            borderRadius: 11,
            backgroundColor: native.fill,
            color: tokens.foreground,
            fontSize: 22,
            fontWeight: "600",
            textAlign: "center",
            paddingHorizontal: 14,
          }}
        />
        <View style={{ marginTop: 24 }}>
          <BotLookPicker
            value={look.color}
            identity={identity}
            organicIdentities={ORGANIC_PREVIEW_IDENTITIES}
            avatarSet={avatarSet}
            disabled={pending}
            onChange={(color, picked) => {
              setLook((current) => ({ ...current, color, identity: picked ?? current.identity }));
            }}
          />
        </View>
        {error ? <Text style={{ color: tokens.destructive, marginTop: 16 }}>{error}</Text> : null}
        <NativeActionButton
          fill
          label={pending ? t`Creating…` : t`Create`}
          disabled={!trimmed || !accountSet || pending}
          onPress={() => void create()}
          style={{ marginTop: 28, borderRadius: 28 }}
        />
      </ScrollView>
    </>
  );
}
