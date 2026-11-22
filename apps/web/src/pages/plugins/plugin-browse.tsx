import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ConnectionCatalogItem,
  MacAppConnection,
  McpServer,
  PluginMarketplaceEntry,
} from "@robots/contracts";
import {
  CATALOG_SEARCH_QUERY_MAX_LENGTH,
  MAC_APP_CONNECTIONS,
  mcpServerConnection,
  SUBMIT_PLUGIN_URL,
} from "@robots/contracts";
import type { RemoteMcpApp } from "@robots/core";
import {
  CONNECTION_CATALOG_PAGE_SIZE,
  catalogItemKey,
  isRecommendedPlugin,
  managedAppFor,
  matchesRemoteMcpApp,
  OTHER_PLUGINS,
  REMOTE_MCP_APPS,
  remoteMcpAppServer,
  robotsAppCopy,
} from "@robots/core";
import { Button, SectionHeading, Spinner } from "@robots/ui-web";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import type { ReactNode } from "react";
import { MacAppIcon } from "../../components/integrations/mac-app-icon";
import type { PluginSelection } from "../../components/integrations/plugin-marketplace";
import {
  IntegrationRow,
  PluginLogo,
  PluginRow,
  pluginSelection,
  ROW_SHELL,
} from "../../components/integrations/plugin-marketplace";
import type { TileContext } from "./parts";
import { CatalogTile } from "./parts";
import type { CatalogBrowse } from "./use-catalog-browse";
import { PLUGIN_PAGE_SIZE } from "./use-catalog-browse";
import type { PluginConnections } from "./use-plugin-connections";

const SECTION_SIZE = 6;

function remoteAppConnected(app: RemoteMcpApp, servers: readonly McpServer[]): boolean {
  const server = remoteMcpAppServer(app, servers);
  return Boolean(server && mcpServerConnection(server) === "connected");
}

function RemoteMcpAppRow({
  app,
  servers,
  onOpen,
}: {
  app: RemoteMcpApp;
  servers: readonly McpServer[];
  onOpen: (app: RemoteMcpApp) => void;
}) {
  return (
    <PluginRow
      name={app.name}
      description={app.description}
      site={app.site}
      installed={remoteAppConnected(app, servers)}
      onOpen={() => onOpen(app)}
    />
  );
}

function MacAppRow({ app, onOpen }: { app: MacAppConnection; onOpen: () => void }) {
  return (
    <IntegrationRow
      icon={
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border/60 bg-accent text-foreground [&_svg]:size-5">
          <MacAppIcon name={app.icon} />
        </span>
      }
      name={app.name}
      description={app.description}
      onOpen={onOpen}
      action={<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
    />
  );
}

function BrowseSection({
  title,
  testId,
  children,
}: {
  title: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="mb-6">
      <SectionHeading as="h2" className="mb-2 px-2.5">
        {title}
      </SectionHeading>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

export function PluginBrowse({
  browse,
  state,
  tileContext,
  onOpenPlugin,
  onSearchPublic,
  onOpenMacApp,
  onOpenRemoteApp,
}: {
  browse: CatalogBrowse;
  state: PluginConnections;
  tileContext: TileContext;
  onOpenPlugin: (selection: PluginSelection) => void;
  onSearchPublic: (query: string) => void;
  onOpenMacApp: (app: MacAppConnection) => void;
  onOpenRemoteApp: (app: RemoteMcpApp) => void;
}) {
  const { t } = useLingui();
  const { catalogLoaded, catalog, pluginCatalog, pluginInstalls, mcpServers } = state;
  const {
    query,
    setVisibleCount,
    category,
    setCategory,
    pluginCount,
    setPluginCount,
    featuredTiles,
    showFeatured,
    visible,
    strongMatches,
    weakMatches,
    rendered,
    catalogEntries,
    catalogsReady,
    plugins,
    categoryLabel,
    categories,
    brandMatches,
    searching,
    pluginMatches,
    pluginForApp,
  } = browse;
  const { itemConnected } = tileContext.connections;
  const installedPlugin = (installedSource: string) =>
    pluginInstalls.find((row) => row.source === installedSource);

  const browsingHome = showFeatured && !category;
  const connectedApps = catalog.filter(itemConnected);
  const connectedRemote = REMOTE_MCP_APPS.filter((app) => remoteAppConnected(app, mcpServers));
  const installedApps = plugins.filter((entry) => installedPlugin(entry.installedSource));
  const availableTiles = catalog.length
    ? featuredTiles.filter((tile) => !tile.item || tile.missing || !itemConnected(tile.item))
    : [];
  const featuredKeys = new Set(
    featuredTiles.flatMap((tile) => (tile.item ? [catalogItemKey(tile.item)] : [])),
  );
  const availableRemote = REMOTE_MCP_APPS.filter((app) => !remoteAppConnected(app, mcpServers));
  const remoteMatches = REMOTE_MCP_APPS.filter((app) => matchesRemoteMcpApp(app, query));
  const recommended = catalogEntries
    .filter(isRecommendedPlugin)
    .map((entry) => ({ entry, item: managedAppFor(entry, catalog) }))
    .filter(({ entry, item }) =>
      item
        ? !itemConnected(item) && !featuredKeys.has(catalogItemKey(item))
        : entry.hasConnector && !installedPlugin(entry.installedSource),
    )
    .slice(0, SECTION_SIZE);
  const availableItems = availableTiles.flatMap((tile) =>
    tile.item && !tile.missing ? [tile.item] : [],
  );
  const shownItems = new Set(
    [
      ...connectedApps,
      ...availableItems,
      ...recommended.flatMap(({ item }) => (item ? [item] : [])),
    ].map(catalogItemKey),
  );
  const shownPlugins = new Set(
    [...installedApps, ...recommended.flatMap(({ entry, item }) => (item ? [] : [entry]))].map(
      (entry) => entry.id,
    ),
  );
  const homePlugins = browsingHome
    ? plugins.filter((entry) => !shownPlugins.has(entry.id))
    : plugins;
  const moreApps = rendered.filter((item) => !shownItems.has(catalogItemKey(item)));

  function catalogTile(
    item: ConnectionCatalogItem,
    label: string,
    logo?: string | null,
    opts?: { tileTestId?: boolean },
  ) {
    return (
      <CatalogTile
        key={catalogItemKey(item)}
        item={item}
        label={label}
        logo={logo}
        description={
          robotsAppCopy([item.name, item.slug]) ??
          pluginForApp.get(catalogItemKey(item))?.description
        }
        tileTestId={opts?.tileTestId}
        context={tileContext}
      />
    );
  }

  function renderPluginRow(entry: PluginMarketplaceEntry, description = entry.description) {
    const selection = pluginSelection(entry);
    return (
      <PluginRow
        key={entry.id}
        name={entry.displayName}
        description={description}
        logo={entry.logo}
        site={selection.site}
        installed={Boolean(installedPlugin(entry.installedSource))}
        onOpen={() => onOpenPlugin(selection)}
      />
    );
  }

  function renderPluginSections() {
    if (pluginCatalog.isPending)
      return (
        <div className="grid place-items-center py-8">
          <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading plugins…`} />
        </div>
      );
    const unavailable =
      pluginCatalog.error || pluginCatalog.data?.unavailableRegistries.length ? (
        <div role="alert" className="mt-6 flex items-center gap-3 text-body text-muted-foreground">
          <Trans>Some plugins could not be loaded.</Trans>
          <Button variant="outline" size="sm" onClick={() => void pluginCatalog.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null;
    return (
      <>
        {unavailable}
        {renderPluginResults()}
      </>
    );
  }

  function renderPluginResults() {
    if (category || searching)
      return pluginMatches.length || brandMatches.length ? (
        <section data-testid="plugin-results" className="mt-2">
          <div className="grid grid-cols-2 gap-2">
            {brandMatches.map(({ item }) => catalogTile(item, item.name, item.logo))}
            {pluginMatches.slice(0, pluginCount).map(renderPluginRow)}
          </div>
          {pluginCount < pluginMatches.length ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPluginCount((count) => count + PLUGIN_PAGE_SIZE)}
              >
                <Trans>Show more</Trans>
              </Button>
            </div>
          ) : null}
        </section>
      ) : null;
    const uncategorized = homePlugins.filter((entry) => !entry.category);
    const sections: Array<[string, string, PluginMarketplaceEntry[]]> = [
      ...categories.map((name): [string, string, PluginMarketplaceEntry[]] => [
        name,
        categoryLabel(name),
        homePlugins.filter((entry) => entry.category === name),
      ]),
      ...(uncategorized.length
        ? [[OTHER_PLUGINS, t`More`, uncategorized] as [string, string, PluginMarketplaceEntry[]]]
        : []),
    ].filter(([, , entries]) => entries.length);
    return (
      <>
        {sections.map(([name, label, entries]) => (
          <section key={name} data-testid="plugin-section" className="mt-8">
            <div className="mb-2 flex items-center justify-between px-2.5">
              <SectionHeading as="h2">{label}</SectionHeading>
              {entries.length > SECTION_SIZE ? (
                <Button variant="text" size="sm" onClick={() => setCategory(name)}>
                  <Trans>View all</Trans>
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {entries.slice(0, SECTION_SIZE).map(renderPluginRow)}
            </div>
          </section>
        ))}
      </>
    );
  }

  function renderPublicCatalogRow(query: string) {
    return (
      <div className="mt-2">
        <IntegrationRow
          icon={
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border/60 bg-accent text-muted-foreground">
              <Search className="size-4" />
            </span>
          }
          name={t`Search MCP servers for “${query}”`}
          onOpen={() => onSearchPublic(query)}
          action={null}
        />
      </div>
    );
  }

  return (
    <>
      {browsingHome && catalogLoaded && catalog.length === 0 && catalogsReady && !plugins.length ? (
        <p className="mb-6 text-body leading-6 text-muted-foreground/80">
          <Trans>Configure a plugin catalog on the server to connect apps.</Trans>
        </p>
      ) : null}

      {browsingHome && connectedApps.length + connectedRemote.length + installedApps.length ? (
        <BrowseSection title={<Trans>Connected</Trans>} testId="connected-integrations">
          {connectedApps.map((item) =>
            catalogTile(item, item.name, item.logo, { tileTestId: true }),
          )}
          {connectedRemote.map((app) => (
            <RemoteMcpAppRow key={app.id} app={app} servers={mcpServers} onOpen={onOpenRemoteApp} />
          ))}
          {installedApps.map(renderPluginRow)}
        </BrowseSection>
      ) : null}

      {browsingHome ? (
        <BrowseSection title={<Trans>On your Mac</Trans>} testId="mac-apps">
          {MAC_APP_CONNECTIONS.map((app) => (
            <MacAppRow key={app.id} app={app} onOpen={() => onOpenMacApp(app)} />
          ))}
        </BrowseSection>
      ) : null}

      {browsingHome &&
      catalogLoaded &&
      availableTiles.length + availableRemote.length + recommended.length ? (
        <BrowseSection title={<Trans>Available</Trans>} testId="featured-connectors">
          {availableTiles.map((tile) =>
            tile.item && !tile.missing ? (
              catalogTile(tile.item, tile.label, tile.item.logo, { tileTestId: true })
            ) : (
              <div key={tile.id} className={`${ROW_SHELL} opacity-70`}>
                <PluginLogo name={tile.label} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-lg font-medium text-foreground">
                    {tile.label}
                  </span>
                  <span className="block truncate text-body-sm text-muted-foreground">
                    <Trans>Not in the plugin catalog</Trans>
                  </span>
                </span>
              </div>
            ),
          )}
          {availableRemote.map((app) => (
            <RemoteMcpAppRow key={app.id} app={app} servers={mcpServers} onOpen={onOpenRemoteApp} />
          ))}
          {recommended.map(({ entry, item }) =>
            item
              ? catalogTile(item, item.name, item.logo)
              : renderPluginRow(entry, robotsAppCopy([entry.name]) ?? entry.description),
          )}
        </BrowseSection>
      ) : null}

      {!showFeatured && !category && remoteMatches.length ? (
        <div data-testid="remote-mcp-apps" className="mb-6 grid grid-cols-2 gap-2">
          {remoteMatches.map((app) => (
            <RemoteMcpAppRow key={app.id} app={app} servers={mcpServers} onOpen={onOpenRemoteApp} />
          ))}
        </div>
      ) : null}

      {catalogsReady &&
      visible.length === 0 &&
      !showFeatured &&
      !pluginMatches.length &&
      !brandMatches.length ? (
        <p className="text-muted-foreground/80">
          <Trans>No apps match your search.</Trans>
        </p>
      ) : null}
      {showFeatured ? (
        <>
          {renderPluginSections()}
          {moreApps.length > 0 && !category ? (
            <SectionHeading as="h2" className="mt-8 mb-2 px-2.5">
              <Trans>More apps</Trans>
            </SectionHeading>
          ) : null}
          {moreApps.length > 0 && !category ? (
            <div className="grid grid-cols-2 gap-2">
              {moreApps.map((item) =>
                catalogTile(item, item.name, item.logo, {
                  tileTestId: !showFeatured,
                }),
              )}
            </div>
          ) : null}
          {rendered.length < visible.length && !category ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setVisibleCount((count) => count + CONNECTION_CATALOG_PAGE_SIZE)}
              >
                <Trans>Show more</Trans>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {strongMatches.length > 0 && !category ? (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {strongMatches.map((item) =>
                catalogTile(item, item.name, item.logo, { tileTestId: true }),
              )}
            </div>
          ) : null}
          {renderPluginSections()}
          {rendered.length > 0 && !category ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {rendered.map((item) =>
                catalogTile(item, item.name, item.logo, { tileTestId: true }),
              )}
            </div>
          ) : null}
          {rendered.length < weakMatches.length && !category ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setVisibleCount((count) => count + CONNECTION_CATALOG_PAGE_SIZE)}
              >
                <Trans>Show more</Trans>
              </Button>
            </div>
          ) : null}
          {query.trim().length >= 2 &&
          query.trim().length <= CATALOG_SEARCH_QUERY_MAX_LENGTH &&
          !category
            ? renderPublicCatalogRow(query.trim())
            : null}
        </>
      )}
      {catalogLoaded && !category ? (
        <div className="mt-10 flex justify-center">
          <a
            href={SUBMIT_PLUGIN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-body-sm text-muted-foreground hover:text-foreground"
          >
            <Trans>Submit a plugin</Trans>
            <ArrowUpRight size={14} />
          </a>
        </div>
      ) : null}
    </>
  );
}
