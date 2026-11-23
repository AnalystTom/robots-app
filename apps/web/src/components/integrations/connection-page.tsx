import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type {
  ConnectionPlacement,
  PermissionTool,
  RiskyCapability,
  ToolPermission,
  ToolPermissionState,
} from "@robots/core";
import {
  groupToolsByEffect,
  guardedCapabilities,
  riskyCapability,
  TOOL_PERMISSIONS,
  toolPermissionChoices,
} from "@robots/core";
import {
  Button,
  DialogClose,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  SectionHeading,
  Spinner,
} from "@robots/ui-web";
import { ChevronDown, ChevronLeft, ChevronRight, Cloud, Laptop, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { ConnectionIcon } from "./connection-icon";
import type { PermissionGrant } from "./permission-dialog";
import { PermissionDialog, usePermissionCopy } from "./permission-dialog";
import type { ToolPermissions } from "./use-tool-permissions";
import { useToolPermissions } from "./use-tool-permissions";

export function ConnectionPageHeader({
  title,
  onBack,
  closeLabel,
}: {
  title: string;
  onBack: () => void;
  closeLabel: string;
}) {
  const { t } = useLingui();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={t`Back`}
        onClick={onBack}
      >
        <ChevronLeft />
      </Button>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogClose
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={closeLabel}
          />
        }
      >
        <X />
      </DialogClose>
    </div>
  );
}

function PlacementLine({ placement }: { placement: ConnectionPlacement }) {
  const Icon = placement === "cloud" ? Cloud : Laptop;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-body text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden className="size-4 shrink-0" />
        {placement === "cloud" ? <Trans>Cloud</Trans> : <Trans>On this Mac</Trans>}
      </span>
      <span className="text-muted-foreground/80">
        {placement === "cloud" ? <Trans>Always on</Trans> : <Trans>Works while it's online</Trans>}
      </span>
    </p>
  );
}

export function ConnectionPage({
  name,
  logo,
  icon,
  placement,
  description,
  children,
  footer,
}: {
  name: string;
  logo?: string | null;
  icon?: ReactNode;
  placement: ConnectionPlacement;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div data-testid="connection-page" className="mx-auto w-full max-w-2xl space-y-8">
      <header className="space-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <ConnectionIcon name={name} logo={logo} icon={icon} />
          <div className="min-w-0 space-y-0.5">
            <h2 className="truncate text-heading2 font-medium text-foreground">{name}</h2>
            <PlacementLine placement={placement} />
          </div>
        </div>
        {description ? <p className="text-body-lg text-muted-foreground">{description}</p> : null}
      </header>
      {children}
      {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
    </div>
  );
}

export function ConnectionSection({
  title,
  caption,
  children,
  "data-testid": testId,
}: {
  title: ReactNode;
  caption?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <section data-testid={testId} className="space-y-2">
      <SectionHeading variant="label" className="px-4">
        {title}
      </SectionHeading>
      <div className="divide-y divide-border rounded-xl border border-border">{children}</div>
      {caption ? <p className="px-4 text-body-sm text-muted-foreground">{caption}</p> : null}
    </section>
  );
}

export function ConnectionRow({
  label,
  detail,
  action,
  onOpen,
  expanded,
  "data-testid": testId,
}: {
  label: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  onOpen?: () => void;
  expanded?: boolean;
  "data-testid"?: string;
}) {
  const text = (
    <span className="min-w-0 flex-1 text-start">
      <span className="block truncate text-body text-foreground">{label}</span>
      {detail ? (
        <span className="block truncate text-body-sm text-muted-foreground">{detail}</span>
      ) : null}
    </span>
  );
  return (
    <div data-testid={testId} className="flex min-h-14 items-center gap-3 px-4 py-2">
      {onOpen ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onOpen}
        >
          {text}
          {expanded === undefined ? null : expanded ? (
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      ) : (
        text
      )}
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}

export function usePermissionLabels() {
  const { t } = useLingui();
  const labels: Record<ToolPermissionState | "mixed", string> = {
    allow: t`Allowed`,
    ask: t`Ask each time`,
    deny: t`Off`,
    review: t`Auto review`,
    once: t`Asks once`,
    mixed: t`Mixed`,
  };
  return labels;
}

function PermissionMenu({
  label,
  state,
  options,
  disabled,
  onChange,
}: {
  label: string;
  state: ToolPermissionState | "mixed" | null;
  options: readonly ToolPermission[];
  disabled: boolean;
  onChange: (permission: ToolPermission) => void;
}) {
  const labels = usePermissionLabels();
  if (!state) return <Spinner className="size-4 text-muted-foreground" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        data-testid="permission-menu"
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            className="gap-1 text-body-sm text-muted-foreground"
          />
        }
      >
        {labels[state]}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={state}
          onValueChange={(next) => {
            const permission = options.find((option) => option === next);
            if (permission) onChange(permission);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {labels[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToolRow({
  tool,
  capability,
  permissions,
  onOpenRisky,
}: {
  tool: PermissionTool;
  capability: RiskyCapability | null;
  permissions: ToolPermissions;
  onOpenRisky?: (tool: PermissionTool, capability: RiskyCapability, turnOn: ToolPermission) => void;
}) {
  const { t } = useLingui();
  const state = permissions.stateOf(tool);
  const openRisky = capability && onOpenRisky ? onOpenRisky : null;
  return (
    <ConnectionRow
      data-testid={capability ? "tool-row-risky" : "tool-row"}
      label={tool.label}
      onOpen={openRisky && capability ? () => openRisky(tool, capability, "ask") : undefined}
      action={
        <PermissionMenu
          label={t`Permission for ${tool.label}`}
          state={state}
          options={toolPermissionChoices(tool)}
          disabled={!permissions.editable(tool) || permissions.pending}
          onChange={(permission) => {
            if (openRisky && capability && state === "deny" && permission !== "deny")
              openRisky(tool, capability, permission);
            else permissions.set([tool], permission);
          }}
        />
      }
    />
  );
}

function LookupRows({
  tools,
  permissions,
}: {
  tools: PermissionTool[];
  permissions: ToolPermissions;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const states = new Set(tools.map((tool) => permissions.stateOf(tool)));
  const [only] = states;
  const shared = states.size > 1 ? "mixed" : (only ?? null);
  return (
    <>
      <ConnectionRow
        data-testid="tool-row-lookups"
        label={<Trans>Find and read</Trans>}
        detail={<Plural value={tools.length} one="# tool" other="# tools" />}
        onOpen={() => setOpen((current) => !current)}
        expanded={open}
        action={
          <PermissionMenu
            label={t`Permission for finding and reading`}
            state={shared}
            options={TOOL_PERMISSIONS.filter((option) =>
              tools.every((tool) => toolPermissionChoices(tool).includes(option)),
            )}
            disabled={!tools.some(permissions.editable) || permissions.pending}
            onChange={(permission) => permissions.set(tools, permission)}
          />
        }
      />
      {open
        ? tools.map((tool) => (
            <div key={tool.name} className="ps-4">
              <ToolRow tool={tool} capability={null} permissions={permissions} />
            </div>
          ))
        : null}
    </>
  );
}

export function ToolsSection({
  appName,
  appSlug,
  appLogo,
  appIcon,
  tools,
  loading,
  botName,
  grantsFor,
}: {
  appName: string;
  appSlug: string;
  appLogo?: string | null;
  appIcon?: ReactNode;
  tools: PermissionTool[];
  loading: boolean;
  botName: string;
  grantsFor?: (tool: PermissionTool) => PermissionGrant[];
}) {
  const { i18n } = useLingui();
  const permissions = useToolPermissions();
  const copy = usePermissionCopy(botName);
  const [risky, setRisky] = useState<{
    tool: PermissionTool;
    capability: RiskyCapability;
    turnOn: ToolPermission;
  } | null>(null);
  if (!loading && tools.length === 0) return null;
  const { lookups, actions } = groupToolsByEffect(tools);
  const guarded = permissions.policy ? guardedCapabilities(tools, appSlug, permissions.policy) : [];
  const caption =
    guarded.length > 0
      ? copy.asksBefore(
          new Intl.ListFormat(i18n.locale, { type: "disjunction" }).format(
            guarded.map((capability) => copy.noun[capability]),
          ),
        )
      : null;
  return (
    <ConnectionSection
      data-testid="connection-tools"
      title={<Trans>Tools</Trans>}
      caption={
        <>
          {permissions.error ? (
            <span role="alert" className="block text-destructive">
              {permissions.error}
            </span>
          ) : null}
          {caption}
        </>
      }
    >
      {loading ? (
        <div className="grid min-h-14 place-items-center">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : (
        <>
          {lookups.length > 0 ? <LookupRows tools={lookups} permissions={permissions} /> : null}
          {actions.map((tool) => (
            <ToolRow
              key={tool.name}
              tool={tool}
              capability={riskyCapability(tool, appSlug)}
              permissions={permissions}
              onOpenRisky={(picked, capability, turnOn) =>
                setRisky({ tool: picked, capability, turnOn })
              }
            />
          ))}
        </>
      )}
      {risky ? (
        <PermissionDialog
          appName={appName}
          appLogo={appLogo}
          appIcon={appIcon}
          botName={botName}
          tool={risky.tool}
          capability={risky.capability}
          turnOn={risky.turnOn}
          permissions={permissions}
          grants={grantsFor?.(risky.tool) ?? []}
          onClose={() => setRisky(null)}
        />
      ) : null}
    </ConnectionSection>
  );
}
