import type { SandboxKindCapabilities } from "@robots/adapter-kit";
import { DEFAULT_COMPUTER_SCREEN } from "@robots/core";

export const noneSandboxCapabilities: SandboxKindCapabilities = {
  terminal: false,
  inPlaceUpdate: false,
  nativeShell: false,
  runsOnUserMachine: false,
  screen: DEFAULT_COMPUTER_SCREEN,
  serverHomeMount: "never",
  serverOwnsStoredTeamHome: false,
  storedHomeIsBackup: false,
};
