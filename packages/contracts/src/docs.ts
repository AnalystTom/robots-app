import * as z from "zod";
import { MemoryDocumentSchema } from "./domain.js";
import { Id } from "./ids.js";

/**
 * Docs are the Space's memory documents shown as a library: shared ones every bot reads and
 * writes, and each bot's own notes as background files.
 */
export const DocSchema = MemoryDocumentSchema.extend({
  /** The bot whose run wrote the current revision; null when a person did. */
  editedByBotId: Id.nullable(),
});
export type Doc = z.infer<typeof DocSchema>;

export const DocRevisionSchema = z.object({
  revision: z.number().int(),
  content: z.string(),
  createdAt: z.string(),
  editedByBotId: Id.nullable(),
});
export type DocRevision = z.infer<typeof DocRevisionSchema>;

export const DOC_NAME_MAX_LENGTH = 120;
/** How many earlier versions a doc's history shows, newest first. */
export const DOC_REVISIONS_LIMIT = 50;

export const CreateDocInput = z.object({
  name: z.string().trim().min(1).max(DOC_NAME_MAX_LENGTH),
  content: z.string().max(200_000).default(""),
});

/** The file a doc name is saved as: names without an extension become Markdown files. */
export function docPath(name: string): string {
  const trimmed = name.trim();
  return /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** What a doc is called in the library: its file name without the Markdown extension. */
export function docTitle(path: string): string {
  return path.replace(/\.md$/i, "");
}
