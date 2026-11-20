import type { LabFeature } from "@robots/contracts";
import { LAB_FEATURES } from "@robots/contracts";

const BOARD_ENV = "TICKET_BOARD_ENABLED";
const EMAIL_ENV = "EMAIL_PAGE_ENABLED";
const DOCS_ENV = "DOCS_PAGE_ENABLED";

/** The setting that turns each Labs feature on for every account; Labs then hides it. */
const DEPLOYMENT_LAB_ENV: Record<LabFeature, string> = {
  board: BOARD_ENV,
  email: EMAIL_ENV,
  docs: DOCS_ENV,
};

export function deploymentLabsFromEnv(source: Record<string, string | undefined>): LabFeature[] {
  return LAB_FEATURES.filter((feature) => source[DEPLOYMENT_LAB_ENV[feature]] === "true");
}
