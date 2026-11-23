import { useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu";
import { PageLoading } from "../components/PageLoading";
import { SignupSurvey } from "../components/SignupSurvey";
import { UsageSharingStep } from "../components/UsageSharing";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { rpc } from "../lib/rpc";
import { useSignOut } from "../lib/sign-out";
import { errorText } from "../lib/user-error";
import { ensureFirstBot, FirstBotRetry } from "./onboarding/first-bot";
import { ModelStep } from "./onboarding/model-step";
import { useOnboardingModel } from "./onboarding/use-onboarding-model";

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  const { step: routeStep } = useParams();
  const [sharingNeeded, setSharingNeeded] = useState(false);
  const linkedStep =
    routeStep === "survey" || routeStep === "model"
      ? routeStep
      : routeStep === "sharing" && sharingNeeded
        ? "sharing"
        : undefined;
  const [creatingBot, setCreatingBot] = useState(false);
  const [finished, setFinished] = useState<"sharing" | "survey" | null>(null);
  const step = creatingBot ? "bot" : finished ? "loading" : (linkedStep ?? "loading");
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [after, setAfter] = useState<{ survey: boolean; next: "model" | "bot" } | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const model = useOnboardingModel({
    catalog,
    billingEnabled,
    onConnected: () => goTo("bot"),
  });
  const { error, modelProbe, setError } = model;
  const createStartedRef = useRef(false);
  const { signingOut, logOut } = useSignOut("/sign-in", setError);

  useEffect(() => {
    const leaving = new AbortController();
    const { signal } = leaving;
    void Promise.all([
      rpc.me(undefined, { signal }),
      rpc.models.list(undefined, { signal }).catch(() => []),
    ])
      .then(([me, models]) => {
        if (signal.aborted) return;
        setBillingEnabled(me.billingEnabled);
        setCatalog(models);
        const next = me.needsModel ? "model" : "bot";
        const survey = Boolean(me.needsSignupSurvey);
        setAfter({ survey, next });
        const sharing = Boolean(me.usageSharing?.needed);
        setSharingNeeded(sharing);
        if (!linkedStep || (routeStep === "sharing" && !sharing)) {
          goTo(sharing ? "sharing" : survey ? "survey" : next);
        }
      })
      .catch(() => {
        if (signal.aborted) return;
        setAfter({ survey: false, next: "bot" });
        if (!linkedStep) goTo("bot");
      });
    return () => {
      leaving.abort();
      modelProbe.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!finished || !after) return;
    setFinished(null);
    goTo(finished === "sharing" && after.survey ? "survey" : after.next);
  }, [finished, after]);

  function goTo(next: "sharing" | "survey" | "model" | "bot") {
    if (next === "bot") setCreatingBot(true);
    navigate(next === "bot" ? "/onboarding" : `/onboarding/${next}`, { replace: true });
  }

  async function createFirstBot() {
    if (createStartedRef.current) return;
    createStartedRef.current = true;
    setError(null);
    try {
      const bot = await ensureFirstBot();
      // Onboarding continues conversationally in the thread: greeting first,
      // then the focus choice (immediate for the first bot).
      const started = await rpc.onboarding
        .start({ botId: bot.id })
        .then(() => true)
        .catch(() => false);
      if (started) {
        await rpc.onboarding.promptFocus({ botId: bot.id }).catch(() => undefined);
      }
      navigate(`/app/${bot.id}`);
    } catch (err) {
      createStartedRef.current = false;
      setError(errorText(err, t`Could not create your bot`));
    }
  }

  useEffect(() => {
    if (step !== "bot") return;
    void createFirstBot();
  }, [step]);

  // Loading, and creating the first bot, both wait on one spinner until the chat opens.
  if (step === "loading" || (step === "bot" && !error)) return <PageLoading />;

  return (
    <div className="min-h-full bg-background px-6 py-12" data-robots-surface="onboarding">
      <AccountMenu signingOut={signingOut} onLogOut={() => void logOut()} />
      <div className="mx-auto w-full max-w-[560px]">
        {step === "sharing" ? <UsageSharingStep onDone={() => setFinished("sharing")} /> : null}
        {step === "survey" ? <SignupSurvey onDone={() => setFinished("survey")} /> : null}
        {step === "model" ? <ModelStep model={model} fieldId={fieldId} /> : null}
        {step === "bot" ? (
          <FirstBotRetry error={error} onRetry={() => void createFirstBot()} />
        ) : null}
      </div>
    </div>
  );
}
