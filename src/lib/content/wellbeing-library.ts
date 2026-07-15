import "server-only";
import type { MovementMomentType } from "@/schemas/ai-output-v2";

/**
 * Curated wellbeing content libraries (Prompts 7, 8, 9).
 *
 * Breathing, meditation, relaxation, movement and evening wind-down content is
 * human-curated here and versioned in git — the AI SELECTS (via server-side
 * substitution), it does not invent. This guarantees calm/movement guidance is
 * always safe, reviewed wording, works during provider outages, and costs no
 * output tokens.
 *
 * Movement entries carry avoid_if tags; users whose movement_limitations
 * mention a matching area only receive entries without that tag (and never
 * anything beyond gentle). Never rehab, never treatment.
 */
export const LIBRARY_VERSION = "2026-07-15";

// ---------- Calm library (P7) ----------

export interface BreathingEntry {
  name: string;
  duration_minutes: number;
  when_to_use: string;
  steps: string[];
  gentle_note: string;
}

export const BREATHING_LIBRARY: BreathingEntry[] = [
  {
    name: "Slow exhale breathing (4-6)",
    duration_minutes: 3,
    when_to_use: "When your mind feels busy or tense.",
    steps: [
      "Sit comfortably and soften your shoulders.",
      "Breathe in through your nose for a count of 4.",
      "Breathe out slowly through your mouth for a count of 6.",
      "Repeat for about 3 minutes, letting the exhale stay longer than the inhale.",
    ],
    gentle_note: "Stop if you feel dizzy or uncomfortable.",
  },
  {
    name: "Box breathing",
    duration_minutes: 4,
    when_to_use: "Before something that needs steady focus.",
    steps: [
      "Breathe in for a count of 4.",
      "Hold gently for 4.",
      "Breathe out for 4.",
      "Pause for 4, then repeat the square a few more times.",
    ],
    gentle_note: "Stop if you feel dizzy or uncomfortable.",
  },
  {
    name: "Three slow sighs",
    duration_minutes: 2,
    when_to_use: "A quick reset between tasks.",
    steps: [
      "Take a deep breath in through your nose.",
      "Let it out as a long, audible sigh.",
      "Repeat twice more, a little slower each time.",
    ],
    gentle_note: "Stop if you feel dizzy or uncomfortable.",
  },
  {
    name: "Hand-on-heart breathing",
    duration_minutes: 3,
    when_to_use: "When the day feels heavy.",
    steps: [
      "Place one hand on your chest.",
      "Feel the warmth of your hand as you breathe in slowly.",
      "Breathe out slowly, noticing your hand rise and fall.",
      "Continue for about 3 minutes.",
    ],
    gentle_note: "Stop if you feel dizzy or uncomfortable.",
  },
];

export interface MeditationEntry {
  name: string;
  duration_minutes: number;
  script: string[];
  journal_prompt: string;
}

export const MEDITATION_LIBRARY: MeditationEntry[] = [
  {
    name: "Two-minute noticing pause",
    duration_minutes: 2,
    script: [
      "Sit or stand still, and let your eyes rest somewhere soft.",
      "Notice three things you can hear, without judging them.",
      "Notice how your body feels against the chair or floor.",
      "Take one slow breath and gently return to your day.",
    ],
    journal_prompt: "What is one thing you noticed just now?",
  },
  {
    name: "Gentle body scan",
    duration_minutes: 5,
    script: [
      "Close your eyes or soften your gaze.",
      "Bring attention to your feet, then slowly move it upward.",
      "Wherever you find tension, imagine your breath softening it.",
      "Finish at the top of your head, then take one full breath.",
    ],
    journal_prompt: "Where were you holding tension today?",
  },
  {
    name: "One kind thought",
    duration_minutes: 3,
    script: [
      "Take two slow breaths to settle.",
      "Think of one thing you handled today, however small.",
      "Silently tell yourself: \"That was enough.\"",
      "Rest with that thought for a minute before moving on.",
    ],
    journal_prompt: "What did you handle today that deserves credit?",
  },
];

export interface RelaxationEntry {
  name: string;
  duration_minutes: number;
  steps: string[];
  best_for: string;
}

export const RELAXATION_LIBRARY: RelaxationEntry[] = [
  {
    name: "Shoulder melt",
    duration_minutes: 3,
    steps: [
      "Lift your shoulders up toward your ears as you breathe in.",
      "Hold for a moment, then let them drop as you breathe out.",
      "Repeat 5 times, letting each drop feel heavier.",
    ],
    best_for: "Desk tension and busy days.",
  },
  {
    name: "5-4-3-2-1 grounding",
    duration_minutes: 4,
    steps: [
      "Name 5 things you can see.",
      "Name 4 things you can feel.",
      "Name 3 things you can hear.",
      "Name 2 things you can smell.",
      "Name 1 thing you're glad about right now.",
    ],
    best_for: "A racing mind.",
  },
  {
    name: "Warm drink ritual",
    duration_minutes: 5,
    steps: [
      "Make a warm, caffeine-free drink.",
      "Sit somewhere comfortable without your phone.",
      "Drink it slowly, noticing the warmth of the cup in your hands.",
    ],
    best_for: "Evenings and slow afternoons.",
  },
  {
    name: "Progressive softening",
    duration_minutes: 6,
    steps: [
      "Lie down or sit back comfortably.",
      "Gently tense your hands for 3 seconds, then release.",
      "Do the same with your arms, shoulders, and face.",
      "Finish with three slow breaths.",
    ],
    best_for: "Winding down before sleep.",
  },
];

// ---------- Movement library (P8) ----------

type AvoidTag = "knees" | "back" | "wrists" | "floor" | "standing";

interface MovementEntry {
  movement: MovementMomentType;
  /** Users whose limitations mention these areas won't get this entry. */
  avoid_if: AvoidTag[];
}

const CAUTION = "Skip any movement that causes pain.";

export const MOVEMENT_LIBRARY: MovementEntry[] = [
  {
    avoid_if: [],
    movement: {
      title: "Fresh-air walk",
      movement_type: "walk",
      duration_minutes: 10,
      intensity: "gentle",
      best_time: "Whenever you can step outside",
      equipment_needed: "None",
      steps: [
        "Step outside and walk at a comfortable pace.",
        "Let your arms swing naturally and look around, not at your phone.",
        "Turn back halfway so the whole walk feels easy.",
      ],
      modifications: ["Walk indoors or in a hallway if the weather is bad."],
      low_energy_version: "A 3-minute stroll to the end of the street and back.",
      caution_note: CAUTION,
    },
  },
  {
    avoid_if: ["standing"],
    movement: {
      title: "Doorway stretch break",
      movement_type: "stretch",
      duration_minutes: 5,
      intensity: "very_gentle",
      best_time: "Mid-morning or mid-afternoon",
      equipment_needed: "None",
      steps: [
        "Stand tall and reach both arms overhead as you breathe in.",
        "Lower your arms and roll your shoulders back 5 times.",
        "Place your hands on a doorframe and lean gently forward to open the chest.",
        "Finish with a slow neck turn to each side.",
      ],
      modifications: ["All of this can be done seated except the doorway lean."],
      low_energy_version: "Just the shoulder rolls and neck turns, seated.",
      caution_note: CAUTION,
    },
  },
  {
    avoid_if: ["wrists", "floor", "knees"],
    movement: {
      title: "Gentle floor mobility",
      movement_type: "mobility",
      duration_minutes: 8,
      intensity: "gentle",
      best_time: "Morning or early evening",
      equipment_needed: "A mat or carpet",
      steps: [
        "On hands and knees, slowly round and arch your back 5 times.",
        "Sit back toward your heels with arms stretched forward, rest 3 breaths.",
        "Return to hands and knees and circle your hips slowly each way.",
      ],
      modifications: ["Place a cushion under your knees for comfort."],
      low_energy_version: "Just the resting stretch, for one minute.",
      caution_note: CAUTION,
    },
  },
  {
    avoid_if: ["knees"],
    movement: {
      title: "Sit-to-stand strength",
      movement_type: "strength",
      duration_minutes: 5,
      intensity: "moderate",
      best_time: "Any time you're near a sturdy chair",
      equipment_needed: "A chair",
      steps: [
        "Sit on the edge of a sturdy chair, feet flat.",
        "Stand up slowly without using your hands if you can.",
        "Sit back down with control. Repeat 8–10 times.",
        "Rest, then do one more easy set if it felt fine.",
      ],
      modifications: ["Use your hands on your thighs for support."],
      low_energy_version: "5 slow repetitions only.",
      caution_note: CAUTION,
    },
  },
  {
    avoid_if: [],
    movement: {
      title: "Desk reset",
      movement_type: "desk_reset",
      duration_minutes: 3,
      intensity: "very_gentle",
      best_time: "Between tasks",
      equipment_needed: "None",
      steps: [
        "Sit tall and roll your shoulders back 5 times.",
        "Interlace your fingers and stretch your arms forward, rounding your upper back.",
        "Turn your head slowly side to side, 3 times each way.",
        "Stand up and shake out your arms and legs for 20 seconds.",
      ],
      modifications: ["Skip the standing part if you prefer to stay seated."],
      low_energy_version: "Shoulder rolls and one big stretch.",
      caution_note: CAUTION,
    },
  },
  {
    avoid_if: ["back"],
    movement: {
      title: "Evening release",
      movement_type: "evening_release",
      duration_minutes: 7,
      intensity: "very_gentle",
      best_time: "About an hour before bed",
      equipment_needed: "A wall or a bed",
      steps: [
        "Lie on your back with your legs resting up against a wall (or on the bed).",
        "Let your arms rest by your sides and breathe slowly for 3 minutes.",
        "Come down gently, hug your knees softly toward you, and rock slightly side to side.",
      ],
      modifications: ["Rest your calves on a chair instead of a wall."],
      low_energy_version: "Two minutes of legs-up rest only.",
      caution_note: CAUTION,
    },
  },
];

/** Limitation keywords -> avoid tags. Conservative: any hit removes entries. */
const LIMITATION_TAGS: [RegExp, AvoidTag[]][] = [
  [/knee/i, ["knees", "floor"]],
  [/back|spine|disc/i, ["back", "floor"]],
  [/wrist|hand|carpal/i, ["wrists"]],
  [/floor|kneel|get.{0,10}down/i, ["floor", "knees"]],
  [/stand|balance|dizz/i, ["standing"]],
];

// ---------- Evening wind-down library (P9) ----------

export interface EveningRoutine {
  time: string;
  steps: string[];
  simple_version: string;
}

/** Three lengths: 2-minute, 10-minute, full (P9). */
export const EVENING_LIBRARY: Record<"short" | "medium" | "full", EveningRoutine[]> = {
  short: [
    {
      time: "Right before bed",
      steps: [
        "Put your phone to charge outside arm's reach.",
        "Take three slow breaths in the dark.",
      ],
      simple_version: "Phone away, three slow breaths.",
    },
    {
      time: "Right before bed",
      steps: [
        "Dim the lights in your room.",
        "Write tomorrow's single most important thing on paper.",
      ],
      simple_version: "Dim lights, jot one thing for tomorrow.",
    },
  ],
  medium: [
    {
      time: "About 30 minutes before bed",
      steps: [
        "Dim the lights and put screens away.",
        "Do a 2-minute tidy of one small surface.",
        "Wash your face and brush your teeth slowly, without rushing.",
        "In bed, take five slow breaths with a longer exhale.",
      ],
      simple_version: "Lights down, screens away, five slow breaths in bed.",
    },
    {
      time: "About 30 minutes before bed",
      steps: [
        "Make a small caffeine-free warm drink.",
        "Sit somewhere soft and let the day settle while you drink it.",
        "Write down anything circling in your head to park it for tomorrow.",
        "Head to bed when the cup is done.",
      ],
      simple_version: "Warm drink, brain-dump on paper, then bed.",
    },
  ],
  full: [
    {
      time: "Starting about an hour before bed",
      steps: [
        "Set a gentle 'wind-down' alarm one hour before your sleep time.",
        "Dim the lights around your home.",
        "Do a slow 5-minute stretch or legs-up rest.",
        "Take a warm shower or wash your face.",
        "Write down tomorrow's top one or two things.",
        "In bed, read something light or breathe slowly until drowsy.",
      ],
      simple_version: "Lights down, quick stretch, note for tomorrow, bed.",
    },
  ],
};

// ---------- Deterministic pickers ----------

/** Stable pseudo-random index from user + date so the pick varies daily. */
function pickIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % Math.max(length, 1);
}

export function pickBreathing(seed: string): BreathingEntry {
  return BREATHING_LIBRARY[pickIndex(seed + "b", BREATHING_LIBRARY.length)];
}

export function pickMeditation(seed: string): MeditationEntry {
  return MEDITATION_LIBRARY[pickIndex(seed + "m", MEDITATION_LIBRARY.length)];
}

export function pickRelaxation(seed: string): RelaxationEntry {
  return RELAXATION_LIBRARY[pickIndex(seed + "r", RELAXATION_LIBRARY.length)];
}

/**
 * Pick a movement entry that respects the user's stated limitations. Any
 * limitation keyword removes conflicting entries AND caps intensity at gentle.
 * Never returns rehab — if nothing fits, returns the desk reset (safest).
 */
export function pickMovement(
  seed: string,
  opts: { limitations?: string | null; lowEnergy?: boolean }
): MovementMomentType {
  const limitations = (opts.limitations ?? "").trim();
  const avoid = new Set<AvoidTag>();
  if (limitations) {
    for (const [re, tags] of LIMITATION_TAGS) {
      if (re.test(limitations)) tags.forEach((t) => avoid.add(t));
    }
  }

  let candidates = MOVEMENT_LIBRARY.filter(
    (e) => !e.avoid_if.some((t) => avoid.has(t))
  );
  if (limitations || opts.lowEnergy) {
    const gentleOnly = candidates.filter(
      (e) => e.movement.intensity !== "moderate"
    );
    if (gentleOnly.length) candidates = gentleOnly;
  }
  if (!candidates.length) {
    candidates = MOVEMENT_LIBRARY.filter(
      (e) => e.movement.movement_type === "desk_reset"
    );
  }

  const chosen = candidates[pickIndex(seed + "mv", candidates.length)].movement;
  // Deep copy so callers can annotate without mutating the library.
  return JSON.parse(JSON.stringify(chosen)) as MovementMomentType;
}

export function pickEvening(
  seed: string,
  preferredLength?: string | null
): EveningRoutine {
  const bucket =
    preferredLength === "5_min"
      ? "short"
      : preferredLength === "20_min"
        ? "full"
        : "medium";
  const list = EVENING_LIBRARY[bucket];
  return list[pickIndex(seed + "e", list.length)];
}
