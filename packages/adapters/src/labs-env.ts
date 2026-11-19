import type { LabFeature } from "@robots/contracts";
import { LAB_FEATURES } from "@robots/contracts";

const BOARD_ENV = "TICKET_BOARD_ENABLED";
const TODAY_ENV = "TODAY_PAGE_ENABLED";
const EMAIL_ENV = "EMAIL_PAGE_ENABLED";
const DOCS_ENV = "DOCS_PAGE_ENABLED";

const DEPLOYMENT_LAB_ENV: Record<LabFeature, string> = {
  board: BOARD_ENV,
  today: TODAY_ENV,
  email: EMAIL_ENV,
  docs: DOCS_ENV,
};

export function deploymentLabsFromEnv(source: Record<string, string | undefined>): LabFeature[] {
  return LAB_FEATURES.filter((feature) => source[DEPLOYMENT_LAB_ENV[feature]] === "true");
}
