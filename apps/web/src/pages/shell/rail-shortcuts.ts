import { useEffect, useRef, useState } from "react";

/** Up to nine chats get a number: RoBot first, then the roster in order. */
export const RAIL_SHORTCUT_LIMIT = 9;

export interface RailTarget {
  key: string;
  open: () => void;
}

export function isMacPlatform(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad/i.test(platform);
}

/** "⌘2" on a Mac, "Ctrl 2" elsewhere. */
export function railShortcutLabel(position: number, mac = isMacPlatform()): string {
  return mac ? `⌘${position}` : `Ctrl ${position}`;
}

/** The digit a Cmd/Ctrl+1..9 press asks for, or null for any other key. */
export function railShortcutDigit(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "code">,
  mac: boolean,
): number | null {
  if (event.altKey || event.shiftKey) return null;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : null;
}

/** Cmd/Ctrl+1..9 opens the matching rail target. */
export function useRailShortcuts(targets: readonly RailTarget[], enabled: boolean) {
  const latest = useRef(targets);
  latest.current = targets;
  useEffect(() => {
    if (!enabled) return;
    const mac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      const digit = railShortcutDigit(event, mac);
      const target = digit ? latest.current[digit - 1] : undefined;
      if (!target) return;
      event.preventDefault();
      target.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** True while Cmd (Mac) or Ctrl is held on its own for a moment, to reveal the rail's numbers. */
export function useShortcutModifierHeld(enabled: boolean, delayMs = 250): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHeld(false);
      return;
    }
    const modifier = isMacPlatform() ? "Meta" : "Control";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      setHeld(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === modifier) {
        clearTimeout(timer);
        timer = setTimeout(() => setHeld(true), delayMs);
      } else if (!/^[1-9]$/.test(event.key)) {
        // A chord like Cmd+C is not a request to see the numbers.
        release();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === modifier) release();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, [enabled, delayMs]);
  return held;
}
