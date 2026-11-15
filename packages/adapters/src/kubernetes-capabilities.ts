import type { SandboxKindCapabilities } from "@robots/adapter-kit";
import { DEFAULT_COMPUTER_SCREEN } from "@robots/core";

export const kubernetesSandboxCapabilities: SandboxKindCapabilities = {
  terminal: true,
  inPlaceUpdate: true,
  nativeShell: false,
  runsOnUserMachine: false,
  screen: DEFAULT_COMPUTER_SCREEN,
  serverHomeMount: "optional",
  serverOwnsStoredTeamHome: true,
  storedHomeIsBackup: false,
};
