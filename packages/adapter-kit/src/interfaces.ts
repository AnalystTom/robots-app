import type { ComputerSize } from "@robots/contracts";
import type {
  AdapterContext,
  AdapterDescriptor,
  AgentRunRequest,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  ArtifactPut,
  AutoReviewCapabilities,
  AutoReviewRequest,
  AutoReviewResult,
  BackgroundJob,
  BackgroundJobHandlers,
  BillingByokCheckoutRequest,
  BillingByokPlan,
  BillingCheckoutRequest,
  BillingCreditCheckoutRequest,
  BillingCreditPurchase,
  BillingPrice,
  BillingSubscriptionSnapshot,
  BrowserActRequest,
  BrowserActResult,
  BrowserCapabilities,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserPurchaseCheckRequest,
  BrowserPurchaseCheckResult,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
  CloudAgentCapabilities,
  CloudAgentHandle,
  CloudAgentLaunchRequest,
  CloudAgentReplyRequest,
  CloudAgentSnapshot,
  CommandRequest,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerFileEntry,
  ComputerInput,
  ComputerObservation,
  ComputerRef,
  ConnectorCall,
  ConnectorCapabilities,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ControlLeaseRef,
  MemoryCapabilities,
  MemoryCommitRequest,
  MemoryExportRequest,
  MemoryReadRequest,
  MemoryRemoveRequest,
  MemoryRevision,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySnapshot,
  MessagingInboundEvent,
  MessagingInboundMessage,
  MessagingPlatformDescriptor,
  MessagingSendRequest,
  MessagingSendResult,
  NotificationMessage,
  PageBrowserCommand,
  PageBrowserResult,
  PortableFile,
  ProcessEvent,
  SandboxCapabilities,
  ScreenRequest,
  ScreenSession,
  SecretChangeListener,
  SecretContext,
  SecretPutOptions,
  SecretRecord,
  SemanticMemoryCapabilities,
  SemanticMemoryConversationRequest,
  SemanticMemoryForgetRequest,
  SemanticMemoryPurgeHistoryRequest,
  SemanticMemoryRecallRequest,
  SemanticMemoryReflectRequest,
  SemanticMemoryResponse,
  SemanticMemoryResult,
  SemanticMemorySaveRequest,
  SnapshotRef,
  SpeechClip,
  StreamedPortableFile,
  TerminalRequest,
  TransactionalEmail,
  UnreferencedMachine,
  VoiceCapabilities,
  VoiceInfo,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceVerifyResult,
  WebFetchCapabilities,
  WebFetchRequest,
  WebFetchResult,
  WebSearchCapabilities,
  WebSearchHit,
  WebSearchRequest,
  WorkspaceDirectoryRequest,
  WorkspaceExportLimits,
} from "./types.js";

export interface SandboxProvider {
  ownsReference?(computer: Pick<ComputerRef, "kind" | "providerRef">): boolean;
  billsWhileRunning?(computer: Pick<ComputerRef, "kind">): boolean;
  keepsHome?(computer: ComputerRef): Promise<boolean>;
  describe(): AdapterDescriptor<SandboxCapabilities>;
  workspaceDirectories?(
    computer: ComputerRef,
    request: WorkspaceDirectoryRequest,
    context: AdapterContext,
  ): Promise<string[]>;
  environment?(
    computer: ComputerRef,
    context: AdapterContext,
  ): Promise<{ platform: string; home: string; shell: string; screen?: boolean } | undefined>;
  hostBrowserProfiles?(
    computer: ComputerRef,
    context: AdapterContext,
  ): Promise<HostBrowserProfile[]>;
  importHostBrowserSessions?(
    computer: ComputerRef,
    request: HostBrowserImportRequest,
    context: AdapterContext,
  ): Promise<HostBrowserImportResult>;
  pageBrowser?(
    computer: ComputerRef,
    request: PageBrowserCommand,
    context: AdapterContext,
  ): Promise<PageBrowserResult>;
  provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
      savedAt?: Date;
      size?: ComputerSize;
      timezone?: string;
      language?: string;
    },
    context: AdapterContext,
  ): Promise<ComputerRef>;
  provisionKind?(homeKey?: string): Promise<ComputerRef["kind"]>;
  isRunning?(computer: ComputerRef, context: AdapterContext): Promise<boolean>;
  isStopped?(computer: ComputerRef, context: AdapterContext): Promise<boolean>;
  hasMountedHome?(computer: ComputerRef, context: AdapterContext): Promise<boolean>;
  prepare(computer: ComputerRef, context: AdapterContext): Promise<void>;
  execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent>;
  cancelRunWork?(
    computer: ComputerRef,
    computerId: string,
    runId: string,
    context: AdapterContext,
  ): Promise<void>;
  inspectBackgroundWork?(
    computer: ComputerRef,
    markerId: string,
    context: AdapterContext,
  ): Promise<"active" | "idle" | "unknown">;
  connectScreen(
    computer: ComputerRef,
    request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession>;
  connectTerminal?(
    computer: ComputerRef,
    request: TerminalRequest,
    context: AdapterContext,
  ): Promise<{ url: string; headers?: Record<string, string> }>;
  setScreenControl?(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ): Promise<void>;
  sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ): Promise<void>;
  observe(computer: ComputerRef, context: AdapterContext): Promise<ComputerObservation>;
  act(
    computer: ComputerRef,
    request: ComputerActionRequest,
    context: AdapterContext,
  ): Promise<ComputerActionResult>;
  listFiles(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
  ): Promise<ComputerFileEntry[]>;
  readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array>;
  writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext): Promise<void>;
  exportWorkspace(
    computer: ComputerRef,
    context: AdapterContext,
    limits?: WorkspaceExportLimits,
  ): AsyncIterable<PortableFile | StreamedPortableFile>;
  importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<void>;
  snapshot(computer: ComputerRef, context: AdapterContext): Promise<SnapshotRef>;
  keepAlive?(computer: ComputerRef): Promise<void>;
  releaseScreen?(computer: ComputerRef, context: AdapterContext): Promise<void>;
  stop(
    computer: ComputerRef,
    context: AdapterContext,
    options?: { discardUnsaved?: boolean },
  ): Promise<void>;
  destroy(computer: ComputerRef, context: AdapterContext): Promise<void>;
  deleteMachine?(machine: UnreferencedMachine, signal: AbortSignal): Promise<void>;
}

export interface UnreferencedMachineRecords {
  record(machine: UnreferencedMachine, deleteAt: Date): Promise<void>;
  clear(machine: UnreferencedMachine): Promise<void>;
}

export interface ConnectorProvider {
  describe(): AdapterDescriptor<ConnectorCapabilities>;
  discoverTools(context: AdapterContext): Promise<ConnectorTool[]>;
  resolveCall?(
    call: ConnectorCall,
    context: AdapterContext,
  ): Promise<{ call: ConnectorCall; tool: ConnectorTool } | undefined>;
  execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent>;
  endRun?(runId: string): void;
}

export interface ConnectionAuthProvider {
  describe(): AdapterDescriptor<{ oauth: boolean }>;
  begin(
    request: { provider: string; redirectUrl: string },
    context: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }>;
  complete(
    request: { state: string; code?: string },
    context: AdapterContext,
  ): Promise<{ connectionRef: string }>;
  revoke(connectionRef: string, context: AdapterContext): Promise<void>;
}

export interface ManagedConnectorProvider
  extends ConnectorProvider,
    Omit<ConnectionAuthProvider, "describe"> {
  catalog(context: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]>;
  listAppTools?(context: AdapterContext, externalId: string): Promise<ConnectorTool[]>;
  listConnectedExternalIds(context: AdapterContext): Promise<string[]>;
  needsReconnect?(context: AdapterContext, externalId: string): Promise<boolean>;
  listReconnectRefs?(context: AdapterContext): Promise<string[]>;
  connectionReady(context: AdapterContext, externalId: string): Promise<boolean>;
  warmDirectory?(): Promise<void>;
  resolveConnectedAccountId?(
    userId: string,
    slug: string,
    currentRef: string | null | undefined,
    excludeIds?: string[],
    spaceId?: string,
  ): Promise<string | undefined>;
  cancelAuthorizationRequest?(requestId: string, context: AdapterContext): Promise<void>;
  revokeUnreferencedAccounts?(
    slug: string,
    keepAccountIds: string[],
    context: AdapterContext,
  ): Promise<void>;
}

export interface MemoryStore {
  describe(): AdapterDescriptor<MemoryCapabilities>;
  read(request: MemoryReadRequest, context: AdapterContext): Promise<MemorySnapshot>;
  search(request: MemorySearchRequest, context: AdapterContext): Promise<MemorySearchResult[]>;
  commit(request: MemoryCommitRequest, context: AdapterContext): Promise<MemoryRevision>;
  remove(request: MemoryRemoveRequest, context: AdapterContext): Promise<{ removed: boolean }>;
  exportMarkdown(
    request: MemoryExportRequest,
    context: AdapterContext,
  ): AsyncIterable<PortableFile>;
  importMarkdown(
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<MemoryRevision>;
}

export interface SemanticMemoryProvider {
  readonly connectionIdentity?: string;
  describe(): AdapterDescriptor<SemanticMemoryCapabilities>;
  recall(
    request: SemanticMemoryRecallRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<SemanticMemoryResult[]>>;
  save(
    request: SemanticMemorySaveRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse>;
  purgeHistory(
    request: SemanticMemoryPurgeHistoryRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse>;
  forget?(
    request: SemanticMemoryForgetRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<{ id: string; expired: boolean; reason: string | null }>>;
  retainConversation?(
    request: SemanticMemoryConversationRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<{ pending?: string }>>;
  retainedConversationSettled?(
    pending: string,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<{ settled: boolean }>>;
  reflect?(
    request: SemanticMemoryReflectRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<string>>;
}

export interface AgentRuntime {
  describe(): AdapterDescriptor<AgentRuntimeCapabilities>;
  run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncIterable<AgentRuntimeEvent>;
  abort(runId: string): Promise<void>;
}

export interface ModelProvider {
  describe(): AdapterDescriptor<{ catalog: boolean; byok: boolean }>;
  listModels(): Promise<Array<{ provider: string; id: string; label: string; billing: string }>>;
}

export interface JobTransaction {
  $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<unknown>;
}

export interface JobPublisher {
  enqueue(job: BackgroundJob): Promise<void>;
  enqueueIn(tx: JobTransaction, job: BackgroundJob): Promise<void>;
  cancelIn(tx: JobTransaction, key: string): Promise<void>;
  cancel(key: string): Promise<void>;
  close(): Promise<void>;
}

export interface JobWorkerHost {
  start(handlers: BackgroundJobHandlers): Promise<void>;
  stop(): Promise<void>;
}

export interface AgentHomeStore {
  describe(): AdapterDescriptor<{ revisions: boolean }>;
  checkout(botId: string, dest: string, context: AdapterContext): Promise<string>;
  commit(botId: string, src: string, context: AdapterContext): Promise<string>;
  restore(botId: string, revision: string, dest: string, context: AdapterContext): Promise<void>;
  exportHome(
    botId: string,
    context: AdapterContext,
    options?: { directory?: string; skipHidden?: boolean },
  ): AsyncIterable<PortableFile>;
  readFile(
    botId: string,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<string>;
  writeFile(botId: string, path: string, content: string, context: AdapterContext): Promise<void>;
  list(
    botId: string,
    path: string,
    context: AdapterContext,
  ): Promise<Array<{ path: string; kind: "file" | "dir"; size: number }>>;
}

export interface ObjectStorage {
  put(key: string, body: AsyncIterable<Uint8Array>): Promise<void>;
  get(key: string): AsyncIterable<Uint8Array>;
  list(prefix: string): AsyncIterable<{ key: string; lastModified: Date }>;
  delete(keys: readonly string[]): Promise<void>;
}

export interface KeyWrapContext {
  spaceId: string;
  version: number;
}

export interface WrappedDataKey {
  masterKeyId: string;
  wrappedKey: string;
}

export interface KeyProvider {
  describe(): AdapterDescriptor<{ rotate: boolean }>;
  activeKeyId(): string;
  wrap(dataKey: Uint8Array, context: KeyWrapContext): Promise<WrappedDataKey>;
  unwrap(wrapped: WrappedDataKey, context: KeyWrapContext): Promise<Uint8Array>;
}

export interface ArtifactStore {
  describe(): AdapterDescriptor<{ stream: boolean }>;
  put(artifact: ArtifactPut, context: AdapterContext): Promise<{ id: string; hash: string }>;
  get(id: string, context: AdapterContext): Promise<Uint8Array>;
  remove(id: string, context: AdapterContext): Promise<void>;
}

export interface SecretStore {
  describe(): AdapterDescriptor<{ rotate: boolean; degraded?: boolean }>;
  put(
    plaintext: string,
    context: AdapterContext,
    options?: SecretPutOptions,
  ): Promise<SecretRecord>;
  load(ref: string, context: SecretContext): Promise<string>;
  delete(ref: string, context: SecretContext): Promise<void>;
  isRemote(ref: string): boolean;
  redact(value: string): string;
  onChange(listener: SecretChangeListener): () => void;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeFanout {
  describe(): AdapterDescriptor<{ distributed: boolean; push: boolean }>;
  publish(topic: string, payload: string): Promise<void>;
  subscribe(topic: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export type IncomingCallNotification = {
  callId: string;
  botId: string;
  botName: string;
  expiresAt: string;
  ended?: true;
};

export interface NotificationProvider {
  describe(): AdapterDescriptor<{ push: boolean; email: boolean }>;
  send(message: NotificationMessage, context: AdapterContext): Promise<void>;
  incomingCall?(userId: string, call: IncomingCallNotification): Promise<void>;
}

export interface TransactionalEmailProvider {
  describe(): AdapterDescriptor<{ transactional: boolean }>;
  send(message: TransactionalEmail): Promise<void>;
  drain?(): Promise<void>;
}

export interface BillingProvider {
  createCreditCheckout?(input: BillingCreditCheckoutRequest): Promise<{ url: string }>;
  listCreditPurchases?(customerId: string): Promise<BillingCreditPurchase[]>;
  setMonthlyCredits?(customerId: string, amountCents: number): Promise<void>;
  createByokCheckout?(input: BillingByokCheckoutRequest): Promise<{ url: string }>;
  endTrial?(customerId: string): Promise<void>;
  changeByokPlan?(
    customerId: string,
    subscriptionId: string,
    change: { from: BillingByokPlan; to: BillingByokPlan },
  ): Promise<boolean>;
  endByokPlans?(customerId: string): Promise<void>;
  grantBalanceCredit?(customerId: string, amountCents: number, referenceId: string): Promise<void>;
  describe(): AdapterDescriptor<{ trials: boolean; portal: boolean; modelCredits?: boolean }>;
  getPrice(): Promise<BillingPrice>;
  createCustomer(input: { email: string; organizationId: string }): Promise<{ customerId: string }>;
  createCheckout(input: BillingCheckoutRequest): Promise<{ url: string }>;
  expireOpenCheckouts(customerId: string): Promise<void>;
  createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  getCustomerSubscription(customerId: string): Promise<BillingSubscriptionSnapshot | null>;
  updateSeats(customerId: string, seats: number): Promise<void>;
  cancelCustomerSubscriptions(customerId: string): Promise<void>;
  parseWebhook(rawBody: string, headers: Headers): { customerId: string } | "ignored" | null;
}

export interface ExecutionRunner {
  describe(): AdapterDescriptor<{ cloud: boolean; selfHosted: boolean; desktop: boolean }>;
  dispatch(runId: string, target: "cloud" | "self-hosted" | "desktop"): Promise<void>;
}

export interface VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities>;
  verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult>;
  listVoices(
    apiKey: string,
    context: AdapterContext,
    options?: { language?: string },
  ): Promise<VoiceInfo[]>;
  synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip>;
  transcribe?(request: VoiceTranscribeRequest, context: AdapterContext): Promise<{ text: string }>;
}

export interface MessagingSurface {
  describe(): AdapterDescriptor<{ providers: string[] }>;
  platforms(): MessagingPlatformDescriptor[];
  handleWebhook(provider: string, request: Request): Promise<Response> | null;
  onInbound(sink: (event: MessagingInboundEvent) => Promise<void>): void;
  sendToThread(
    request: MessagingSendRequest,
    context: AdapterContext,
  ): Promise<MessagingSendResult>;
  openDirectThread(provider: string, address: string, context: AdapterContext): Promise<string>;
  acknowledge(threadId: string, handle: string, context: AdapterContext): Promise<void>;
  fetchThreadHistory?(
    threadId: string,
    options: { before: string; limit: number },
    context: AdapterContext,
  ): Promise<MessagingInboundMessage[]>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface WebSearchProvider {
  describe(): AdapterDescriptor<WebSearchCapabilities>;
  search(request: WebSearchRequest, context: AdapterContext): Promise<WebSearchHit[]>;
}

export interface WebFetchProvider {
  describe(): AdapterDescriptor<WebFetchCapabilities>;
  fetch(request: WebFetchRequest, context: AdapterContext): Promise<WebFetchResult>;
}

export interface WebProvider extends WebSearchProvider, WebFetchProvider {
  describe(): AdapterDescriptor<WebSearchCapabilities & WebFetchCapabilities>;
}

export interface BrowserProvider {
  describe(): AdapterDescriptor<BrowserCapabilities>;
  navigate(
    computer: ComputerRef,
    request: BrowserNavigateRequest,
    context: AdapterContext,
  ): Promise<BrowserNavigateResult>;
  snapshot(
    computer: ComputerRef,
    request: BrowserSnapshotRequest,
    context: AdapterContext,
  ): Promise<BrowserSnapshotResult>;
  act(
    computer: ComputerRef,
    request: BrowserActRequest,
    context: AdapterContext,
  ): Promise<BrowserActResult>;
  purchaseCheck?(
    computer: ComputerRef,
    request: BrowserPurchaseCheckRequest,
    context: AdapterContext,
  ): Promise<BrowserPurchaseCheckResult>;
}

export interface CloudAgentProvider {
  describe(): AdapterDescriptor<CloudAgentCapabilities>;
  launch(request: CloudAgentLaunchRequest, context: AdapterContext): Promise<CloudAgentHandle>;
  get(id: string, context: AdapterContext, runId?: string): Promise<CloudAgentSnapshot>;
  reply(
    id: string,
    request: CloudAgentReplyRequest,
    context: AdapterContext,
  ): Promise<CloudAgentHandle>;
  cancel(id: string, context: AdapterContext, runId?: string): Promise<CloudAgentSnapshot>;
}

export interface AutoReviewProvider {
  describe(): AdapterDescriptor<AutoReviewCapabilities>;
  review(request: AutoReviewRequest, context: AdapterContext): Promise<AutoReviewResult>;
}

export interface HostBrowserProfile {
  id: string;
  name: string;
  sites: string[];
}

export interface HostBrowserImportRequest {
  profile: string;
  sites: string[];
}

export interface HostBrowserImportResult {
  sites: Array<{ site: string; cookies: number }>;
}
