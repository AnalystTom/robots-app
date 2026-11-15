import type { SandboxKindCapabilities } from "@robots/adapter-kit";
import { DEFAULT_COMPUTER_SCREEN } from "@robots/core";

export const dockerSandboxCapabilities: SandboxKindCapabilities = {
  terminal: true,
  inPlaceUpdate: true,
  nativeShell: false,
  runsOnUserMachine: false,
  screen: DEFAULT_COMPUTER_SCREEN,
  serverHomeMount: "always",
  serverOwnsStoredTeamHome: false,
  storedHomeIsBackup: true,
};
