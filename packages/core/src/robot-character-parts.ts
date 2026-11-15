/**
 * The drawn parts of a robot character, ported from the RoBots desktop app. Every string is fixed
 * artwork: nothing a user types is ever put into one, so the drawing is safe as a data URI.
 * All parts share one 256x256 view box.
 */
import type { RobotColour, RobotLook, RobotSlot } from "@robots/contracts";

export interface RobotPart {
  /** Drawn behind the head (or, for a face, on the visor). */
  back?: string;
  /** Drawn in front of the head. */
  front?: string;
}

const BOW_TIE =
  '<path d="M128 198l-24-13v26zM128 198l24-13v26z" fill="#e5484d"/><circle cx="128" cy="198" r="6" fill="#c43a3f"/>';

const body = (fill: string) =>
  `<path d="M24 256C24 212 68 190 128 190s104 22 104 66z" fill="${fill}"/>`;

/** The antenna bulb glows in a lighter tone of the backdrop. */
export const ROBOT_COLOUR_GLOWS: Readonly<Record<RobotColour, string>> = {
  green: "#86efac",
  red: "#fecaca",
  teal: "#99f6e4",
  purple: "#ddd6fe",
  slate: "#f1f5f8",
  pink: "#ff9ecb",
  orange: "#fde68a",
  blue: "#bfdbfe",
};

export const ROBOT_PART_ART: {
  [Slot in Exclude<RobotSlot, "colour">]: Readonly<Record<RobotLook[Slot], RobotPart>>;
} = {
  headwear: {
    antenna: {
      back: '<rect x="124" y="40" width="8" height="30" rx="4" fill="#a9b8c6"/><circle cx="128" cy="38" r="11" fill="GLOW"/>',
    },
    hood: {
      back: '<path d="M128 30c58 0 94 46 94 106 0 48-26 76-94 76s-94-28-94-76c0-60 36-106 94-106z" fill="#39424f"/><path d="M128 46c50 0 80 40 80 90 0 42-22 62-80 62s-80-20-80-62c0-50 30-90 80-90z" fill="#252c35"/>',
      front:
        '<path d="M44 132c0-62 38-96 84-96s84 34 84 96" fill="none" stroke="#151a20" stroke-width="12" stroke-linecap="round"/><rect x="30" y="110" width="30" height="54" rx="12" fill="#f25f4c"/><rect x="196" y="110" width="30" height="54" rx="12" fill="#f25f4c"/>',
    },
    "chef-hat": {
      front:
        '<g fill="#fff"><circle cx="92" cy="46" r="26"/><circle cx="128" cy="34" r="30"/><circle cx="164" cy="46" r="26"/><rect x="76" y="46" width="104" height="34" rx="8"/></g><rect x="76" y="68" width="104" height="12" rx="5" fill="#e3e9ef"/><path d="M104 52v14M128 50v16M152 52v14" stroke="#e3e9ef" stroke-width="3" stroke-linecap="round"/>',
    },
    mortarboard: {
      front:
        '<rect x="84" y="54" width="88" height="24" rx="4" fill="#26303b"/><path d="M128 26l84 24-84 24-84-24z" fill="#1b232c"/><path d="M128 50l68 8v34" fill="none" stroke="#f5b83d" stroke-width="4" stroke-linejoin="round"/><rect x="190" y="90" width="12" height="20" rx="3" fill="#f5b83d"/><circle cx="128" cy="50" r="5" fill="#f5b83d"/>',
    },
    deerstalker: {
      front:
        '<defs><clipPath id="d"><path d="M60 96C60 42 196 42 196 96z"/></clipPath></defs><path d="M60 96C60 42 196 42 196 96z" fill="#b08d5a"/><path d="M100 40v60M128 40v60M156 40v60M56 64h144M56 84h144" stroke="#8c6c3f" stroke-width="4" clip-path="url(#d)"/><path d="M90 94q38 22 76 0z" fill="#8c6c3f"/><circle cx="128" cy="46" r="6" fill="#8c6c3f"/>',
    },
    "top-hat": {
      front:
        '<g transform="rotate(-8 128 72)"><rect x="90" y="16" width="76" height="54" rx="6" fill="#151a24"/><rect x="90" y="52" width="76" height="10" fill="#e5484d"/><rect x="70" y="66" width="116" height="11" rx="5.5" fill="#151a24"/></g>',
    },
  },
  face: {
    terminal: {
      back: '<path d="M94 110l16 12-16 12M136 136h26" fill="none" stroke="#4ade80" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    grumpy: {
      back: '<path d="M90 106l28 10M166 106l-28 10" stroke="#ff7a66" stroke-width="7" stroke-linecap="round"/><circle cx="108" cy="128" r="7" fill="#ff7a66"/><circle cx="148" cy="128" r="7" fill="#ff7a66"/><path d="M104 148l8-6 8 6 8-6 8 6 8-6 8 6" fill="none" stroke="#ff7a66" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    monocle: {
      back: '<circle cx="106" cy="124" r="8" fill="#7dd3fc"/><circle cx="150" cy="124" r="8" fill="#7dd3fc"/><circle cx="150" cy="124" r="17" fill="#7dd3fc" fill-opacity=".15" stroke="#f5b83d" stroke-width="5"/><path d="M164 134c12 16 6 36 20 52" fill="none" stroke="#f5b83d" stroke-width="2.5"/><path d="M114 146q14 8 28 0" fill="none" stroke="#7dd3fc" stroke-width="4" stroke-linecap="round"/>',
    },
    magnifier: {
      back: '<path d="M96 126h20" stroke="#c4b5fd" stroke-width="7" stroke-linecap="round"/><circle cx="150" cy="124" r="9" fill="#c4b5fd"/><path d="M118 148l18-3" stroke="#c4b5fd" stroke-width="4" stroke-linecap="round"/>',
      front:
        '<path d="M166 142l26 32" stroke="#5b3a24" stroke-width="11" stroke-linecap="round"/><circle cx="152" cy="124" r="21" fill="#c4b5fd" fill-opacity=".14" stroke="#e2e8f0" stroke-width="6"/>',
    },
    glasses: {
      back: '<circle cx="106" cy="124" r="7" fill="#e2e8f0"/><circle cx="150" cy="124" r="7" fill="#e2e8f0"/><g fill="none" stroke="#cbd5e1" stroke-width="4"><circle cx="106" cy="124" r="18"/><circle cx="150" cy="124" r="18"/><path d="M124 122q4-4 8 0"/></g><path d="M118 150q10 5 20 0" fill="none" stroke="#e2e8f0" stroke-width="4" stroke-linecap="round"/>',
    },
    hearts: {
      back: '<path d="M106 120c0-8-12-8-12 1 0 8 12 14 12 17 0-3 12-9 12-17 0-9-12-9-12-1zM150 120c0-8-12-8-12 1 0 8 12 14 12 17 0-3 12-9 12-17 0-9-12-9-12-1z" fill="#ff7eb6"/><path d="M112 144q16 16 32 0z" fill="#ff7eb6"/>',
    },
    aviators: {
      back: '<g fill="#0f172a" stroke="#f5c542" stroke-width="4" stroke-linejoin="round"><path d="M84 112h38v10c0 16-10 24-20 24-12 0-18-10-18-22z"/><path d="M134 112h38v12c0 12-6 22-18 22-10 0-20-8-20-24z"/></g><path d="M84 112h88" stroke="#f5c542" stroke-width="4"/><path d="M92 120l8 8M142 120l8 8" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/><path d="M114 152q20 6 32-6" fill="none" stroke="#7dd3fc" stroke-width="4" stroke-linecap="round"/>',
    },
    happy: {
      back: '<path d="M96 128q10-12 20 0M140 128q10-12 20 0" fill="none" stroke="#93c5fd" stroke-width="7" stroke-linecap="round"/><path d="M110 144q18 16 36 0" fill="none" stroke="#93c5fd" stroke-width="5" stroke-linecap="round"/>',
    },
  },
  outfit: {
    hoodie: {
      back: `${body("#39424f")}<path d="M112 212l-4 30M144 212l4 30" stroke="#e8edf2" stroke-width="5" stroke-linecap="round"/>`,
    },
    "chef-jacket": {
      back: `${body("#f8fafc")}<g fill="#9aa9b8"><circle cx="106" cy="226" r="4"/><circle cx="106" cy="244" r="4"/><circle cx="150" cy="226" r="4"/><circle cx="150" cy="244" r="4"/></g>`,
      front: '<path d="M100 192h56l-28 24z" fill="#1f2a44"/>',
    },
    tweed: {
      back: `${body("#8a5a3b")}<path d="M104 190l24 56 24-56z" fill="#f1f5f8"/><path d="M94 192l34 60-18-60zM162 192l-34 60 18-60z" fill="#6f4730"/>`,
      front: BOW_TIE,
    },
    cape: {
      back: `${body("#7a5c36")}<path d="M36 234c8-26 46-40 92-40s84 14 92 40c-34-10-150-10-184 0z" fill="#9b7a4e"/>`,
    },
    turtleneck: {
      back: body("#15181d"),
      front:
        '<rect x="90" y="166" width="76" height="36" rx="15" fill="#2b313a"/><path d="M98 182h60M98 192h60" stroke="#15181d" stroke-width="3" stroke-linecap="round"/>',
    },
    "t-shirt": {
      back: `${body("#fdf2f8")}<path d="M152 214l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#f59e0b"/>`,
    },
    vest: {
      back: `${body("#bfdbfe")}<path d="M24 256c0-42 40-62 88-66l6 66zM232 256c0-42-40-62-88-66l-6 66z" fill="#1e3a5f"/><path d="M62 238l12-12 8 6 14-14m-8 0h8v8" fill="none" stroke="#4ade80" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    tuxedo: {
      back: `${body("#151a24")}<path d="M104 190l24 52 24-52z" fill="#f8fafc"/>`,
      front: BOW_TIE,
    },
  },
  extra: {
    none: {},
    "ring-light": {
      back: '<circle cx="128" cy="120" r="104" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="26"/><circle cx="128" cy="120" r="104" fill="none" stroke="#ffe4f0" stroke-width="10"/>',
    },
    confetti: {
      back: '<rect x="34" y="62" width="12" height="7" rx="2" fill="#facc15" transform="rotate(-24 40 66)"/><rect x="210" y="86" width="12" height="7" rx="2" fill="#f472b6" transform="rotate(30 216 90)"/><rect x="24" y="156" width="12" height="7" rx="2" fill="#4ade80" transform="rotate(18 30 160)"/><rect x="220" y="168" width="12" height="7" rx="2" fill="#facc15" transform="rotate(-36 226 172)"/><rect x="200" y="30" width="10" height="6" rx="2" fill="#4ade80" transform="rotate(12 205 33)"/><rect x="44" y="24" width="10" height="6" rx="2" fill="#f472b6" transform="rotate(-10 49 27)"/>',
    },
    steam: {
      front:
        '<path d="M38 102q-8-8 0-16t0-16M218 102q8-8 0-16t0-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/>',
    },
  },
};
