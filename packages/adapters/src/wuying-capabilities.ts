import type { SandboxKindCapabilities } from "@robots/adapter-kit";
import { DEFAULT_COMPUTER_SCREEN } from "@robots/core";

export const wuyingSandboxCapabilities: SandboxKindCapabilities = {
  terminal: false,
  inPlaceUpdate: false,
  nativeShell: true,
  runsOnUserMachine: false,
  screen: DEFAULT_COMPUTER_SCREEN,
  serverHomeMount: "never",
  serverOwnsStoredTeamHome: false,
  storedHomeIsBackup: true,
};
