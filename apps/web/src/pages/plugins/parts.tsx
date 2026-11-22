import { Trans, useLingui } from "@lingui/react/macro";
import type { ConnectionCatalogItem, McpServer, McpServerConnection } from "@robots/contracts";
import { mcpServerConnection } from "@robots/contracts";
import { catalogItemKey } from "@robots/core";
import { Button, SectionHeading } from "@robots/ui-web";
import { Check, ChevronLeft, CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { IntegrationRow, PluginLogo } from "../../components/integrations/plugin-marketplace";
import type { PluginConnections } from "./use-plugin-connections";

export function ConnectorIcon({ name, logo }: { name: string; logo?: string | null }) {
  return logo ? (
    <img
      src={logo}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-9 w-9 shrink-0 rounded-xl bg-accent object-contain"
    />
  ) : (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-body font-semibold text-foreground">
      {Array.from(name)[0]}
    </div>
  );
}

function connectionLabel(state: McpServerConnection): ReactElement {
  switch (state) {
    case "disabled":
      return <Trans>Disabled</Trans>;
    case "needs_client":
      return <Trans>Needs an OAuth client ID</Trans>;
    case "needs_sign_in":
      return <Trans>Needs sign-in</Trans>;
    case "not_working":
      return <Trans>Not working</Trans>;
    case "connected":
      return <Trans>Connected</Trans>;
    case "not_connected":
      return <Trans>Not connected</Trans>;
  }
}

export function ConnectionStatus({ server }: { server: McpServer }) {
  const state = mcpServerConnection(server);
  const warning = state === "needs_sign_in" || state === "needs_client";
  const Icon =
    state === "connected"
      ? Check
      : warning
        ? TriangleAlert
        : state === "not_working"
          ? CircleAlert
          : null;
  const tone =
    state === "connected"
      ? "text-success"
      : warning
        ? "text-warning"
        : state === "not_working"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <span className={`flex min-w-0 items-center gap-1 text-body-sm ${tone}`}>
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{connectionLabel(state)}</span>
    </span>
  );
}

export function ViewTitle({ title, onBack }: { title: ReactNode; onBack: () => void }) {
  const { t } = useLingui();
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="-ms-2 text-muted-foreground"
        aria-label={t`Back`}
        onClick={onBack}
      >
        <ChevronLeft />
      </Button>
      <SectionHeading as="h2" variant="heading">
        {title}
      </SectionHeading>
    </div>
  );
}

export type TileContext = {
  connections: PluginConnections;
  onOpenApp: (item: ConnectionCatalogItem) => void;
  onOpenDetail: (item: ConnectionCatalogItem) => void;
};

export function CatalogTile({
  item,
  label,
  logo,
  description,
  tileTestId: tileTestIdOption,
  context,
}: {
  item: ConnectionCatalogItem;
  label: string;
  logo?: string | null;
  description?: string;
  tileTestId?: boolean;
  context: TileContext;
}) {
  const { connections, onOpenApp } = context;
  const connected = connections.itemConnected(item);
  const tileTestId = tileTestIdOption !== false && connected;
  return (
    <IntegrationRow
      testId={tileTestId ? `connection-tile-${item.slug.toLowerCase()}` : undefined}
      icon={<PluginLogo name={label} logo={logo} />}
      name={label}
      description={description}
      onOpen={() => onOpenApp(item)}
      action={<CatalogActions item={item} context={context} />}
    />
  );
}

function CatalogActions({ item, context }: { item: ConnectionCatalogItem; context: TileContext }) {
  const { connections, onOpenDetail } = context;
  const key = catalogItemKey(item);
  const connected = connections.itemConnected(item);
  const connecting = connections.pending === key;
  if (connected) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={connecting}
        onClick={(event) => {
          event.stopPropagation();
          onOpenDetail(item);
        }}
      >
        {connecting ? <Trans>Adding…</Trans> : <Trans>Added</Trans>}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={connecting}
      onClick={(event) => {
        event.stopPropagation();
        void connections.connect(item);
      }}
    >
      {connecting ? <Trans>Adding…</Trans> : <Trans>Add</Trans>}
    </Button>
  );
}
