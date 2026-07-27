/**
 * Landing proof of the adaptation loop (MW-V11-03).
 *
 * Prospective users were reading *claims* about Today, Adjust and Undo. This
 * shows the actual sequence instead, using the product's own vocabulary:
 * "What will change", the "Can change / Kept / Already done" counts, the
 * "Keep this" and "Already done — kept" chips, and "Undo — bring the previous
 * plan back". Every one of those strings is what `today-plan-v2.tsx` renders,
 * so the page cannot drift into describing a product that does not exist —
 * `tests/landing-proof.test.ts` asserts each label still appears in the real
 * component.
 *
 * Three deliberate constraints:
 *
 *  - **No real data, ever.** The fixture below is written here, not fetched.
 *    Nothing on this page has ever belonged to a user.
 *  - **Not interactive.** The chips are spans, not buttons. A mock control that
 *    takes focus and then does nothing is worse for a keyboard or screen-reader
 *    user than an honest picture, so this is marked up as a `<figure>` with a
 *    caption that says what it is.
 *  - **No animation.** Nothing moves, so there is nothing to suppress under
 *    reduced motion, and every state boundary is a border rather than colour
 *    alone, so it survives forced-colors mode.
 *
 * Server component: it holds no state and ships no JavaScript.
 */

/** The example day, before the change. Sample data — never a real plan. */
const BEFORE = [
  { label: "Water with the mid-morning break", state: "done" },
  { label: "Lunch — grain bowl from last night", state: "done" },
  { label: "Walk after the 2pm meeting", state: "done" },
  { label: "Three slow breaths, afternoon dip", state: "open" },
  { label: "Dinner — sheet-pan chicken, 20 min", state: "open" },
  { label: "Fill tomorrow's water bottle", state: "kept" },
  { label: "Wind-down — screens down, lights low", state: "open" },
] as const;

const canChange = BEFORE.filter((i) => i.state === "open").length;
const kept = BEFORE.filter((i) => i.state === "kept").length;
const alreadyDone = BEFORE.filter((i) => i.state === "done").length;

const STEP_LABEL = "text-xs font-medium uppercase tracking-wide text-[#9CA3AF]";
const CARD = "rounded-2xl border border-[#E5E1DA] bg-white p-5 shadow-sm";

export function AdaptiveDayProof() {
  return (
    <figure className="mx-auto mt-8 max-w-md">
      <ol className="space-y-3">
        {/* 1 — one next step */}
        <li className={CARD}>
          <p className={STEP_LABEL}>Today · one next step</p>
          <p className="mt-1.5 font-medium text-[#1F2937]">
            Dinner — sheet-pan chicken, 20 min
          </p>
          <p className="mt-1 text-sm text-[#6B7280]">
            The full day stays one tap away.
          </p>
          <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-[#7C9A92] px-3 py-1.5 text-white">
              Done for now
            </span>
            <span className="rounded-full border border-[#E5E1DA] px-3 py-1.5 text-[#6B7280]">
              Not now
            </span>
          </p>
        </li>

        {/* 2 — the day changes */}
        <li className={CARD}>
          <p className={STEP_LABEL}>Then the day changes</p>
          <p className="mt-1.5 text-sm text-[#1F2937]">
            A meeting runs late. You pick one reason.
          </p>
          <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-[#7C9A92] bg-[#7C9A92]/10 px-3 py-1.5 text-[#1F2937]">
              Less time
            </span>
            <span className="rounded-full border border-[#E5E1DA] px-3 py-1.5 text-[#6B7280]">
              Lower energy
            </span>
          </p>
        </li>

        {/* 3 — the preview, before anything is committed */}
        <li className={CARD}>
          <p className={STEP_LABEL}>What will change</p>
          <p className="mt-1 text-xs text-[#6B7280]">
            Can change: {canChange} · Kept: {kept} · Already done: {alreadyDone}
          </p>
          <ul className="mt-2 space-y-1.5">
            {BEFORE.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span
                  className={
                    item.state === "open" ? "text-[#1F2937]" : "text-[#9CA3AF]"
                  }
                >
                  {item.label}
                </span>
                {item.state === "done" && (
                  <span className="shrink-0 rounded-full border border-[#166534]/20 bg-[#DCFCE7] px-2.5 py-0.5 text-xs text-[#166534]">
                    Already done — kept
                  </span>
                )}
                {item.state === "kept" && (
                  <span className="shrink-0 rounded-full border border-[#7C9A92] bg-[#7C9A92]/10 px-2.5 py-0.5 text-xs text-[#1F2937]">
                    Kept — won&rsquo;t change
                  </span>
                )}
              </li>
            ))}
          </ul>
        </li>

        {/* 4 — committed, and reversible */}
        <li className="rounded-2xl border border-[#166534]/20 bg-[#DCFCE7] p-5">
          <p className="font-medium text-[#1F2937]">Rest of today adjusted</p>
          <p className="mt-1 text-sm text-[#1F2937]">
            Dinner and the wind-down got smaller. Kept as they were: {kept} kept
            item and {alreadyDone} already-done items — untouched.
          </p>
          <p className="mt-3 inline-flex rounded-xl border border-[#166534]/30 px-3.5 py-1.5 text-xs font-medium text-[#166534]">
            Undo — bring the previous plan back
          </p>
        </li>
      </ol>

      <figcaption className="mt-3 text-center text-sm text-[#9CA3AF]">
        An example of the product view, built from sample data — not a customer
        result. Your own day is shaped by your check-in.
      </figcaption>
    </figure>
  );
}
