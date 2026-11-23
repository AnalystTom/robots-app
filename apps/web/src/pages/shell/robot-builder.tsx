import { t } from "@lingui/core/macro";
import type { RobotLook, RobotSlot } from "@robots/contracts";
import {
  ROBOT_COLOUR_FILLS,
  ROBOT_PARTS,
  ROBOT_SLOTS,
  robotCharacterValue,
} from "@robots/contracts";
import { DEFAULT_ROBOT_LOOK, randomRobotLook, withRobotPart } from "@robots/core";
import { Button, ToggleGroup, ToggleGroupItem } from "@robots/ui-web";
import { Shuffle } from "lucide-react";

function robotLabels(): {
  slots: Record<RobotSlot, string>;
  parts: Record<string, string>;
} {
  return {
    slots: {
      colour: t`Colour`,
      headwear: t`Headwear`,
      face: t`Face`,
      outfit: t`Outfit`,
      extra: t`Extra`,
    },
    // Keyed by slot and id: "none" and "hoodie" mean different things in different slots.
    parts: {
      "colour.green": t`Green`,
      "colour.red": t`Red`,
      "colour.teal": t`Teal`,
      "colour.purple": t`Purple`,
      "colour.slate": t`Slate`,
      "colour.pink": t`Pink`,
      "colour.orange": t`Orange`,
      "colour.blue": t`Blue`,
      "headwear.antenna": t`Antenna`,
      "headwear.hood": t`Hood and headphones`,
      "headwear.chef-hat": t`Chef's hat`,
      "headwear.mortarboard": t`Mortarboard`,
      "headwear.deerstalker": t`Deerstalker`,
      "headwear.top-hat": t`Top hat`,
      "face.terminal": t`Terminal`,
      "face.grumpy": t`Grumpy`,
      "face.monocle": t`Monocle`,
      "face.magnifier": t`Magnifier`,
      "face.glasses": t`Round glasses`,
      "face.hearts": t`Heart eyes`,
      "face.aviators": t`Aviators`,
      "face.happy": t`Happy`,
      "outfit.hoodie": t`Hoodie`,
      "outfit.chef-jacket": t`Chef's jacket`,
      "outfit.tweed": t`Tweed and bow tie`,
      "outfit.cape": t`Cape`,
      "outfit.turtleneck": t`Turtleneck`,
      "outfit.t-shirt": t`T-shirt`,
      "outfit.vest": t`Fleece vest`,
      "outfit.tuxedo": t`Tuxedo`,
      "extra.none": t`None`,
      "extra.ring-light": t`Ring light`,
      "extra.confetti": t`Confetti`,
      "extra.steam": t`Steam`,
    },
  };
}

/**
 * Builds a robot character from parts: one row of chips per slot and a Shuffle. The preview is
 * the avatar its caller already shows. Without a robot yet, nothing is selected and the first
 * pick starts from the default robot.
 */
export function RobotBuilder({
  look,
  onChange,
}: {
  look: RobotLook | null;
  onChange: (value: string) => void;
}) {
  const labels = robotLabels();
  return (
    <div className="space-y-3" data-testid="robot-builder">
      {ROBOT_SLOTS.map((slot) => (
        <div key={slot}>
          <div className="mb-1.5 text-caption font-medium tracking-wider text-muted-foreground uppercase">
            {labels.slots[slot]}
          </div>
          <ToggleGroup
            aria-label={labels.slots[slot]}
            value={look ? [look[slot]] : []}
            onValueChange={([next]) => {
              const id = (ROBOT_PARTS[slot] as readonly string[]).find((part) => part === next);
              if (!id || id === look?.[slot]) return;
              onChange(
                robotCharacterValue(
                  withRobotPart(look ?? DEFAULT_ROBOT_LOOK, slot, id as RobotLook[typeof slot]),
                ),
              );
            }}
            spacing={1}
            className="w-full flex-wrap"
          >
            {ROBOT_PARTS[slot].map((id) => (
              <ToggleGroupItem
                key={id}
                value={id}
                variant="outline"
                size="sm"
                className="rounded-full"
              >
                {slot === "colour" ? (
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full"
                    style={{ backgroundColor: ROBOT_COLOUR_FILLS[id as RobotLook["colour"]] }}
                  />
                ) : null}
                {labels.parts[`${slot}.${id}`]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(robotCharacterValue(randomRobotLook()))}
      >
        <Shuffle aria-hidden="true" />
        {t`Shuffle`}
      </Button>
    </div>
  );
}
