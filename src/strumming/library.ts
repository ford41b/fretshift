import type { Pattern, Difficulty, Stroke } from "./schema";

type Template = {
  id: string;
  name: string;
  family: string;
  meter: Pattern["meter"];
  subdivision: Pattern["subdivision"];
  feel: Pattern["feel"];
  difficulty: Difficulty;
  tempo: [number, number];
  genres: string[];
  sections: string[];
  events: Pattern["events"];
};
// Authoring notation is expanded immediately into structured, validated events.
// D/U = accented, d/u = light, x = muted, - = rest. Never persisted as text.
function template(
  id: string,
  name: string,
  family: string,
  meter: Pattern["meter"],
  subdivision: Pattern["subdivision"],
  rhythm: string,
  difficulty: Difficulty,
  tempo: [number, number],
  genres: string[],
  sections: string[],
): Template {
  const strokes: Record<string, Stroke> = {
    d: "down",
    u: "up",
    x: "mute",
    "-": "rest",
  };
  return {
    id,
    name,
    family,
    meter,
    subdivision,
    difficulty,
    tempo,
    genres,
    sections,
    feel: meter[1] === 8 && meter[0] % 3 === 0 ? "compound" : "straight",
    events: [...rhythm.replaceAll(" ", "")].map((symbol, i) => ({
      position: i / subdivision,
      duration: 1 / subdivision,
      stroke: strokes[symbol.toLowerCase()],
      accent: symbol === "-" ? 0 : symbol === symbol.toUpperCase() ? 1 : 0.35,
    })),
  };
}
export const RHYTHM_LIBRARY: Template[] = [
  template(
    "straight-blues",
    "Straight blues backbeat",
    "blues",
    [4, 4],
    2,
    "d-D-d-Du",
    "intermediate",
    [60, 135],
    ["blues"],
    ["verse"],
  ),
  template(
    "quarters",
    "Steady quarters",
    "pulse",
    [4, 4],
    1,
    "Dddd",
    "beginner",
    [40, 220],
    [],
    ["intro", "verse"],
  ),
  template(
    "half-time",
    "Room to change",
    "space",
    [4, 4],
    1,
    "D-d-",
    "beginner",
    [60, 300],
    ["ballad", "worship"],
    ["intro", "bridge"],
  ),
  template(
    "eighths",
    "Straight eighths",
    "eighths",
    [4, 4],
    2,
    "DuDuDuDu",
    "intermediate",
    [55, 135],
    ["rock", "pop"],
    ["chorus"],
  ),
  template(
    "folk",
    "Acoustic lift",
    "folk",
    [4, 4],
    2,
    "D-du-uDu",
    "intermediate",
    [65, 140],
    ["folk", "pop", "country"],
    ["verse", "chorus"],
  ),
  template(
    "country",
    "Country backbeat",
    "country",
    [4, 4],
    2,
    "d-Dud-Du",
    "intermediate",
    [75, 155],
    ["country", "folk"],
    ["verse"],
  ),
  template(
    "rock",
    "Driving downstrokes",
    "rock",
    [4, 4],
    2,
    "d-Ddd-Dd",
    "intermediate",
    [85, 165],
    ["rock"],
    ["chorus"],
  ),
  template(
    "ballad",
    "Open ballad",
    "ballad",
    [4, 4],
    2,
    "D--uD-du",
    "intermediate",
    [40, 90],
    ["ballad", "worship"],
    ["verse", "bridge"],
  ),
  template(
    "pop-push",
    "Anticipated pop",
    "syncopated",
    [4, 4],
    2,
    "D-uD-uDu",
    "advanced",
    [65, 125],
    ["pop", "worship"],
    ["chorus", "bridge"],
  ),
  template(
    "muted",
    "Percussive backbeat",
    "percussive",
    [4, 4],
    2,
    "D-xu-uxu",
    "advanced",
    [65, 125],
    ["pop", "funk"],
    ["chorus"],
  ),
  template(
    "funk",
    "Sixteenth pocket",
    "sixteenths",
    [4, 4],
    4,
    "D-xu-uXuD-xu-uXu",
    "advanced",
    [50, 100],
    ["funk"],
    ["verse", "bridge"],
  ),
  template(
    "waltz",
    "Waltz pulse",
    "pulse",
    [3, 4],
    1,
    "Ddd",
    "beginner",
    [45, 220],
    ["folk", "country"],
    ["intro"],
  ),
  template(
    "waltz-lift",
    "Waltz lift",
    "folk",
    [3, 4],
    2,
    "D-dudu",
    "intermediate",
    [55, 145],
    ["folk", "ballad", "country"],
    ["verse"],
  ),
  template(
    "waltz-space",
    "Floating waltz",
    "syncopated",
    [3, 4],
    2,
    "D-u-xu",
    "advanced",
    [50, 130],
    ["pop", "ballad"],
    ["bridge"],
  ),
  template(
    "six-pulse",
    "Two gentle pulses",
    "pulse",
    [6, 8],
    1,
    "D--d--",
    "beginner",
    [35, 200],
    ["ballad", "worship"],
    ["intro", "verse"],
  ),
  template(
    "six-roll",
    "Rolling six",
    "eighths",
    [6, 8],
    1,
    "DudDud",
    "intermediate",
    [40, 145],
    ["folk", "worship", "ballad"],
    ["chorus"],
  ),
  template(
    "six-blues",
    "Compound blues sway",
    "blues",
    [6, 8],
    1,
    "D-uD-u",
    "intermediate",
    [40, 150],
    ["blues"],
    ["verse"],
  ),
  template(
    "six-mute",
    "Muted compound lift",
    "percussive",
    [6, 8],
    1,
    "Dux-ud",
    "advanced",
    [40, 125],
    ["blues", "pop"],
    ["bridge", "chorus"],
  ),
  template(
    "two-pulse",
    "March pulse",
    "pulse",
    [2, 4],
    1,
    "Dd",
    "beginner",
    [45, 230],
    [],
    ["intro"],
  ),
  template(
    "two-lift",
    "Two-beat lift",
    "folk",
    [2, 4],
    2,
    "D-Du",
    "intermediate",
    [60, 155],
    ["folk", "country"],
    ["verse"],
  ),
  template(
    "two-mute",
    "Two-beat pocket",
    "percussive",
    [2, 4],
    4,
    "D-xu-uDu",
    "advanced",
    [45, 105],
    ["funk", "pop"],
    ["chorus"],
  ),
];

export function templatesFor(meter: Pattern["meter"]): Template[] {
  const exact = RHYTHM_LIBRARY.filter(
    (t) => t.meter[0] === meter[0] && t.meter[1] === meter[1],
  );
  if (exact.length) return exact;
  const [n, d] = meter;
  if (n < 2 || n > 12 || d === 16) return [];
  const compound = d === 8 && n % 3 === 0;
  // Conservative additive grouping: 7/8 = 2+2+3; 5/4 = 3+2.
  const groups = compound
    ? (Array(n / 3).fill(3) as number[])
    : n === 7
      ? [2, 2, 3]
      : n === 5
        ? [3, 2]
        : (Array(n).fill(1) as number[]);
  const starts = new Set<number>();
  let pos = 0;
  groups.forEach((g) => {
    starts.add(pos);
    pos += g;
  });
  const pulse = Array.from({ length: n }, (_, i) =>
    starts.has(i) ? "D" : "-",
  ).join("");
  const rolling = Array.from({ length: n }, (_, i) =>
    starts.has(i) ? "D" : i % 2 ? "u" : "d",
  ).join("");
  const expressive = Array.from({ length: n * 2 }, (_, i) =>
    i % 2 ? (i % 4 === 1 ? "u" : "-") : i % 4 === 2 ? "x" : "D",
  ).join("");
  return [
    template(
      "group-pulse",
      "Grouped pulse",
      "pulse",
      meter,
      1,
      pulse,
      "beginner",
      [40, 300],
      [],
      ["intro", "verse"],
    ),
    template(
      "group-flow",
      "Grouped flow",
      "eighths",
      meter,
      d === 8 ? 1 : 2,
      d === 8 ? rolling : [...rolling].map((c) => c + "u").join(""),
      "intermediate",
      [40, 140],
      [],
      ["chorus"],
    ),
    template(
      "group-pocket",
      "Grouped pocket",
      "percussive",
      meter,
      2,
      expressive,
      "advanced",
      [40, 100],
      [],
      ["bridge"],
    ),
  ];
}
