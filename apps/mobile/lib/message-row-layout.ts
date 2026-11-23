import { isApprovalAskBlock, isSecretAskBlock } from "@robots/core";
import { isCenteredAgentEvent, THREAD_COLUMN_GUTTER } from "./message-presentation";
import type { MobileMessage } from "./mobile-types";

const COLUMN_PADDING = THREAD_COLUMN_GUTTER * 2;

/** Sizes a message's column: wide asks and centered events fill it, minus the avatar gutter. */
export function messageRowLayout(
  blocks: MobileMessage["blocks"],
  {
    activityBotId,
    inGroup,
    columnWidth,
    plainBotText = false,
  }: {
    activityBotId?: string;
    inGroup: boolean;
    columnWidth: number;
    plainBotText?: boolean;
  },
) {
  const wideAsk = blocks.some(isSecretAskBlock);
  const full = wideAsk || isCenteredAgentEvent(blocks);
  const fillsBubble = blocks.some(
    (block) =>
      block.kind === "app_connect" ||
      block.kind === "mcp_approval" ||
      block.kind === "app" ||
      block.kind === "page" ||
      (block.kind === "ask" &&
        block.status !== "answered" &&
        Boolean(block.actions?.length) &&
        !isApprovalAskBlock(block) &&
        !block.instructionUpdate &&
        !block.settingsUpdate),
  );
  const gutter = activityBotId ? (inGroup ? 28 : 36) : 0;
  const fullText = plainBotText && !activityBotId;
  return {
    width: full || fullText ? "100%" : fillsBubble && !activityBotId ? "90%" : undefined,
    maxWidth: full || fullText ? "100%" : activityBotId ? undefined : "90%",
    menuFullWidth: wideAsk || fillsBubble || fullText,
    menuMaxWidth: wideAsk
      ? columnWidth - COLUMN_PADDING - gutter
      : isCenteredAgentEvent(blocks)
        ? columnWidth - COLUMN_PADDING
        : activityBotId || fullText
          ? columnWidth - COLUMN_PADDING - gutter
          : (columnWidth - COLUMN_PADDING) * 0.9,
  } as const;
}
