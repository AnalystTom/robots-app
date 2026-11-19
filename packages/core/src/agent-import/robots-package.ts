import type { BotPackage } from "@robots/contracts";
import type { AgentImportParse } from "./shared.js";
import { freeName, instructionItem, memoryItem, skillItem } from "./shared.js";

export function parseRobotsPackage(pkg: BotPackage): AgentImportParse {
  const skills: AgentImportParse["skills"] = [];
  const skipped: AgentImportParse["skipped"] = [];
  const used = new Set<string>();
  for (const [index, skill] of pkg.skills.entries()) {
    const item = skillItem(`skills:${index}`, skill.content);
    if (!item) {
      skipped.push({ path: `skills: ${index + 1}`, reason: "invalid_skill" });
      continue;
    }
    skills.push({ ...item, id: `skills:${freeName(item.name, used, "")}` });
  }
  const memoryPaths = new Set<string>();
  return {
    suggestedName: pkg.bot.name,
    suggestedDescription: pkg.bot.description,
    instructions: pkg.bot.instructions.trim()
      ? [
          {
            ...instructionItem("instructions", pkg.bot.instructions, { role: "working" }),
            title: pkg.bot.name,
          },
        ]
      : [],
    memory: pkg.memory.map((note) => {
      const path = freeName(note.path, memoryPaths, ".md");
      return memoryItem(path, path, path, note.content);
    }),
    skills,
    skipped,
  };
}
