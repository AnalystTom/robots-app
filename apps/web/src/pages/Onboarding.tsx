import { useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu";
import { PageLoading } from "../components/PageLoading";
import { SignupSurvey } from "../components/SignupSurvey";
import { importBotTemplate, isBotTemplateLink } from "../lib/import-bot-template";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { reportClientError } from "../lib/monitoring";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { onboardingTemplate } from "../lib/sign-in-next";
import { useSignOut } from "../lib/sign-out";
import { errorText } from "../lib/user-error";
import { ensureFirstBot, FirstBotRetry } from "./onboarding/first-bot";
import { ModelStep } from "./onboarding/model-step";
import { useOnboardingModel } from "./onboarding/use-onboarding-model";

async function startOnboardingChat(botId: string) {
  const started = await rpc.onboarding
    .start({ botId })
    .then(() => true)
    .catch(() => false);
  if (started) {
    await rpc.onboarding
      .promptFocus({ botId })
      .catch((error: unknown) => reportClientError(error, "rpc.transport"));
  }
}

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  const { step: routeStep } = useParams();
  const [searchParams] = useSearchParams();
  const [template] = useState(() => onboardingTemplate(searchParams));
  const queries = useSpaceQueries();
  const linkedStep = routeStep === "survey" || routeStep === "model" ? routeStep : undefined;
  const [creatingBot, setCreatingBot] = useState(false);
  const [surveyDone, setSurveyDone] = useState(false);
  const step = creatingBot ? "bot" : surveyDone ? "loading" : (linkedStep ?? "loading");
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [afterSurvey, setAfterSurvey] = useState<"model" | "bot" | null>(null);
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
        setAfterSurvey(next);
        if (!linkedStep) goTo(me.needsSignupSurvey ? "survey" : next);
      })
      .catch(() => {
        if (signal.aborted) return;
        setAfterSurvey("bot");
        if (!linkedStep) goTo("bot");
      });
    return () => {
      leaving.abort();
      modelProbe.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!surveyDone || !afterSurvey) return;
    setSurveyDone(false);
    goTo(afterSurvey);
  }, [surveyDone, afterSurvey]);

  function goTo(next: "survey" | "model" | "bot") {
    if (next === "bot") setCreatingBot(true);
    const search = template ? `?template=${template}` : "";
    navigate(next === "bot" ? `/onboarding${search}` : `/onboarding/${next}${search}`, {
      replace: true,
    });
  }

  async function createFirstBot() {
    if (createStartedRef.current) return;
    createStartedRef.current = true;
    setError(null);
    try {
      const linkedBotId =
        template && isBotTemplateLink(template) ? await importBotTemplate(template, queries) : null;
      if (linkedBotId) {
        await startOnboardingChat(linkedBotId);
        navigate(`/app/${linkedBotId}`);
        return;
      }
      const bot = await ensureFirstBot();
      await startOnboardingChat(bot.id);
      navigate(template ? `/app/${bot.id}?templates` : `/app/${bot.id}`);
    } catch (err) {
      createStartedRef.current = false;
      setError(errorText(err, t`Could not create your bot`));
    }
  }

  useEffect(() => {
    if (step !== "bot") return;
    void createFirstBot();
  }, [step]);

  if (step === "loading" || (step === "bot" && !error)) return <PageLoading />;

  return (
    <div className="min-h-full bg-background px-6 py-12" data-robots-surface="onboarding">
      <AccountMenu signingOut={signingOut} onLogOut={() => void logOut()} />
      <div className="mx-auto w-full max-w-[560px]">
        {step === "survey" ? <SignupSurvey onDone={() => setSurveyDone(true)} /> : null}
        {step === "model" ? <ModelStep model={model} fieldId={fieldId} /> : null}
        {step === "bot" ? (
          <FirstBotRetry error={error} onRetry={() => void createFirstBot()} />
        ) : null}
      </div>
    </div>
  );
}
