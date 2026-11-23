import { Trans, useLingui } from "@lingui/react/macro";
import type { LinkFavicons } from "@robots/chat-ui/web";
import { LinkFaviconsContext, RemoteImagesContext } from "@robots/chat-ui/web";
import type { LabFeature } from "@robots/contracts";
import { PAIR_PAGE_PATH } from "@robots/contracts";
import { analyticsScreen } from "@robots/core";
import { Button } from "@robots/ui-web";
import type { ReactNode } from "react";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { LoadingState } from "./components/ai/primitives";
import { CallLayout } from "./components/call/CallLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MarkdownLinkPrompt } from "./components/markdown-link-prompt";
import { PageLoading } from "./components/PageLoading";
import { SubscriptionGate } from "./components/SubscriptionGate";
import { authClient } from "./lib/auth";
import { getLoadedLabs, subscribeLabs } from "./lib/bootstrap";
import { syncCallIdentity } from "./lib/call-session";
import { desktopBridge } from "./lib/desktop";
import { syncWebLogoAvatarIdentity } from "./lib/logo-avatar-activity";
import { identifyMonitoringUser } from "./lib/monitoring";
import { markAfterPaint, markOnce } from "./lib/performance";
import { lazyComponent } from "./lib/preload-recovery";
import { QueryUserProvider, setQueryUser } from "./lib/query";
import { remoteImagesPreference } from "./lib/remote-images-preference";
import { hasSignedInBefore, rememberSignedIn } from "./lib/returning-user";
import { rpc } from "./lib/rpc";
import {
  holdAnonymousGate,
  holdUnreachableGate,
  sessionGate,
  sessionRetryDelayMs,
  showSessionUnavailable,
} from "./lib/session-gate";
import {
  MCP_OAUTH_CALLBACK_PATH,
  newAccountDestination,
  SLACK_INSTALL_CALLBACK_PATH,
  signInNext,
} from "./lib/sign-in-next";
import { syncLogOutFailure } from "./lib/sign-out";
import { completeSsoCallback, SSO_CALLBACK_PATH } from "./lib/sso-flow";
import { IntegrationCallbackPage } from "./pages/IntegrationCallback";
import { IntegrationSetupPage } from "./pages/IntegrationSetup";
import { McpOAuthCallbackPage } from "./pages/McpOAuthCallback";
import { SharedPagePage } from "./pages/SharedPage";
import { ShellPage } from "./pages/Shell";
import { SlackInstallCallbackPage } from "./pages/SlackInstallCallback";

const AuthPage = lazyComponent(() => import("./pages/Auth").then((module) => module.AuthPage));
const PasswordResetPage = lazyComponent(() =>
  import("./pages/Auth").then((module) => module.PasswordResetPage),
);
const OnboardingPage = lazyComponent(() =>
  import("./pages/Onboarding").then((module) => module.OnboardingPage),
);
const NotFoundPage = lazyComponent(() =>
  import("./pages/NotFound").then((module) => module.NotFoundPage),
);
const ArtifactsPage = lazyComponent(() =>
  import("./pages/Artifacts").then((module) => module.ArtifactsPage),
);
const BoardPage = lazyComponent(() => import("./pages/Board").then((module) => module.BoardPage));
const TasksPage = lazyComponent(() =>
  import("./pages/workspace/TasksPage").then((module) => module.TasksPage),
);
const EmailPage = lazyComponent(() =>
  import("./pages/workspace/EmailPage").then((module) => module.EmailPage),
);
const DocsPage = lazyComponent(() =>
  import("./pages/workspace/DocsPage").then((module) => module.DocsPage),
);
const AdminPluginsPage = lazyComponent(() =>
  import("./pages/AdminPluginsPage").then((module) => module.AdminPluginsPage),
);
const AdminAccessPage = lazyComponent(() =>
  import("./pages/AdminAccessPage").then((module) => module.AdminAccessPage),
);
const NavLinkPage = lazyComponent(() =>
  import("./pages/NavLinkPage").then((module) => module.NavLinkPage),
);
const PairPage = lazyComponent(() => import("./pages/PairPage").then((module) => module.PairPage));
const InvitePage = lazyComponent(() =>
  import("./pages/Invite").then((module) => module.InvitePage),
);

function SsoCallbackPage() {
  useEffect(() => {
    completeSsoCallback();
  }, []);
  return null;
}

const linkFavicons: LinkFavicons = {
  load: (origin) => rpc.links.favicon({ origin }),
};

export function App() {
  const loadRemoteImages = remoteImagesPreference.use();
  return (
    <RemoteImagesContext.Provider value={loadRemoteImages}>
      <LinkFaviconsContext.Provider value={linkFavicons}>
        <ErrorBoundary fallback={<AppFailed />}>
          {window.location.pathname === SSO_CALLBACK_PATH ? (
            <SsoCallbackPage />
          ) : window.location.pathname === "/integrations/callback" ? (
            <IntegrationCallbackPage />
          ) : (
            <SessionApp />
          )}
        </ErrorBoundary>
      </LinkFaviconsContext.Provider>
    </RemoteImagesContext.Provider>
  );
}

function SessionApp() {
  const [searchParams] = useSearchParams();
  const next = signInNext(searchParams.get("next"));
  // A joined string, so a fresh but equal list never re-renders the routes; null until loaded.
  const labsKey = useSyncExternalStore(
    subscribeLabs,
    () => getLoadedLabs()?.join(",") ?? null,
    () => null,
  );
  const labs = labsKey === null ? null : (labsKey.split(",") as LabFeature[]);
  /** A Labs page waits for the account's Labs, so it never falls through to a chat route. */
  const lab = (feature: LabFeature, page: ReactNode) =>
    labs === null ? (
      <PageLoading />
    ) : labs.includes(feature) ? (
      page
    ) : (
      <Navigate to="/app" replace />
    );
  const session = authClient.useSession();
  const { pathname, search } = useLocation();
  const screen = analyticsScreen(pathname);
  const analyticsUserId = session.data?.user.id;
  const lastScreen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (session.isPending) return;
    void identifyMonitoringUser(Boolean(analyticsUserId));
  }, [analyticsUserId, session.isPending]);
  useEffect(() => {
    if (!analyticsUserId) {
      lastScreen.current = undefined;
      return;
    }
    if (!screen) return;
    const key = `${analyticsUserId}:${screen}`;
    if (lastScreen.current === key) return;
    lastScreen.current = key;
    void Promise.resolve()
      .then(() => rpc.analytics.screen({ screen, surface: desktopBridge() ? "desktop" : "web" }))
      .catch(() => undefined);
  }, [analyticsUserId, screen]);
  const gate = sessionGate(session);
  useLayoutEffect(() => {
    if (gate !== "authenticated" && gate !== "anonymous") return;
    syncWebLogoAvatarIdentity(analyticsUserId ?? null);
    syncCallIdentity(analyticsUserId ?? null);
    syncLogOutFailure(gate === "authenticated");
    if (gate === "authenticated") rememberSignedIn();
  }, [gate, analyticsUserId]);
  useEffect(() => {
    if (gate === "authenticated" || gate === "anonymous") setQueryUser(analyticsUserId ?? null);
  }, [gate, analyticsUserId]);
  const [holdingUnreachable, setHoldingUnreachable] = useState(false);
  const nextHolding = holdUnreachableGate(gate, holdingUnreachable);
  if (nextHolding !== holdingUnreachable) setHoldingUnreachable(nextHolding);
  const [holdingAnonymous, setHoldingAnonymous] = useState(false);
  const nextHoldingAnonymous = holdAnonymousGate(gate, holdingAnonymous);
  if (nextHoldingAnonymous !== holdingAnonymous) setHoldingAnonymous(nextHoldingAnonymous);

  useLayoutEffect(() => {
    if (session.isPending) return;
    markOnce("rk:renderer:session-committed");
    markAfterPaint("rk:renderer:session-painted");
  }, [session.isPending]);

  if (showSessionUnavailable(gate, nextHolding)) {
    return <SessionUnavailable refetch={session.refetch} />;
  }
  if (gate === "loading" && !nextHoldingAnonymous) {
    return <PageLoading data-robots-app-state="session-pending" />;
  }

  const user = session.data?.user;
  return (
    <QueryUserProvider value={user?.id ?? null}>
      <MarkdownLinkPrompt>
        <div className="h-full" data-robots-app-state="ready">
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <Navigate
                    to={user ? "/app" : hasSignedInBefore() ? "/sign-in" : "/sign-up"}
                    replace
                  />
                }
              />
              {["/sign-in", "/sign-in/email"].map((path) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    user ? (
                      <Navigate to={next ?? "/app"} replace />
                    ) : (
                      <AuthPage key={path} mode="in" />
                    )
                  }
                />
              ))}
              {["/sign-up", "/sign-up/email"].map((path) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    user ? (
                      <Navigate to={newAccountDestination(next)} replace />
                    ) : (
                      <AuthPage key={path} mode="up" />
                    )
                  }
                />
              ))}
              <Route
                path="/forgot-password"
                element={
                  user ? <Navigate to="/app" replace /> : <AuthPage key="forgot" mode="forgot" />
                }
              />
              <Route path="/reset-password" element={<PasswordResetPage />} />
              <Route path={PAIR_PAGE_PATH} element={<PairPage />} />
              <Route path="/p/:slugToken" element={<SharedPagePage />} />
              <Route
                path={MCP_OAUTH_CALLBACK_PATH}
                element={
                  user ? (
                    <McpOAuthCallbackPage />
                  ) : (
                    <Navigate
                      to={`/sign-in?next=${encodeURIComponent(pathname + search)}`}
                      replace
                    />
                  )
                }
              />
              <Route
                path={SLACK_INSTALL_CALLBACK_PATH}
                element={
                  user ? (
                    <SlackInstallCallbackPage />
                  ) : (
                    <Navigate
                      to={`/sign-in?next=${encodeURIComponent(pathname + search)}`}
                      replace
                    />
                  )
                }
              />
              <Route
                path="/integrations/setup"
                element={
                  user ? (
                    <IntegrationSetupPage />
                  ) : (
                    <Navigate to="/sign-in?next=/integrations/setup" replace />
                  )
                }
              />
              <Route
                path="/admin/plugins"
                element={
                  user ? (
                    <AdminPluginsPage />
                  ) : (
                    <Navigate to="/sign-in?next=/admin/plugins" replace />
                  )
                }
              />
              <Route
                path="/invite/:token"
                element={
                  user ? (
                    <InvitePage />
                  ) : (
                    <Navigate to={`/sign-in?next=${encodeURIComponent(pathname)}`} replace />
                  )
                }
              />
              <Route
                path="/admin/access"
                element={
                  user ? <AdminAccessPage /> : <Navigate to="/sign-in?next=/admin/access" replace />
                }
              />
              <Route
                element={
                  user ? (
                    <SubscriptionGate fallback={<PageLoading />}>
                      <Outlet />
                    </SubscriptionGate>
                  ) : (
                    <Navigate to="/sign-in" replace />
                  )
                }
              >
                <Route path="/app" element={<ShellPage />} />
                <Route path="/app/g/:groupId" element={<ShellPage />} />
                <Route path="/app/:botId" element={<ShellPage />} />
                <Route element={<CallLayout />}>
                  <Route path="/onboarding/:step?" element={<OnboardingPage />} />
                  <Route path="/app/artifacts" element={<ArtifactsPage />} />
                  <Route path="/app/artifacts/:artifactId" element={<ArtifactsPage />} />
                  <Route path="/app/board" element={lab("board", <BoardPage />)} />
                  <Route path="/app/tasks" element={lab("board", <TasksPage />)} />
                  <Route path="/app/today" element={<Navigate to="/app" replace />} />
                  <Route path="/app/email" element={lab("email", <EmailPage />)} />
                  <Route path="/app/docs" element={lab("docs", <DocsPage />)} />
                  <Route path="/app/x/:linkId" element={<NavLinkPage />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </div>
      </MarkdownLinkPrompt>
    </QueryUserProvider>
  );
}

function SessionUnavailable({ refetch }: { refetch: () => Promise<void> }) {
  const { t } = useLingui();
  const [attempt, setAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const retryImmediately = useRef(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    let cancelled = false;
    const delay = retryImmediately.current ? 0 : sessionRetryDelayMs(attempt);
    retryImmediately.current = false;
    const timer = setTimeout(() => {
      void refetchRef.current().finally(() => {
        if (!cancelled) setAttempt((value) => value + 1);
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, retryKey]);

  return (
    <div className="grid h-full place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center">
        <LoadingState label={t`Reconnecting`} />
        <p className="mt-3 text-body text-muted-foreground/80">
          <Trans>Can&apos;t reach the server.</Trans>
        </p>
        <div className="mt-4">
          <Button
            variant="secondary"
            onClick={() => {
              retryImmediately.current = true;
              setAttempt(0);
              setRetryKey((key) => key + 1);
            }}
          >
            <Trans>Retry now</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}

function AppFailed() {
  return (
    <div
      className="grid h-full place-items-center bg-background px-6 text-center"
      data-robots-app-state="failed"
    >
      <div className="flex flex-col items-center">
        <p className="text-body text-muted-foreground/80">
          <Trans>Something went wrong. Try again.</Trans>
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <Trans>Refresh</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}
