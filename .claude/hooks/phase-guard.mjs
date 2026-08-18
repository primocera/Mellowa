#!/usr/bin/env node
/**
 * Mellowa phase guardrail.
 *
 * The engineering build is done & certified through v20. The project phase is
 * MARKETING. This hook (configured in .claude/settings.json) does two things:
 *
 *   - session : injects the phase directive at SessionStart so every agent —
 *               including a fresh "check the repo and write the next pack" run —
 *               loads it before doing anything.
 *   - write   : on Write/Edit of an engineering-PACK artifact (new migration,
 *               docs/release/vNN pack doc, or an MW-/XAPP- named file) it forces
 *               an "ask" so the write can't happen silently. Real bug fixes /
 *               owner requests just get confirmed; another pack gets caught.
 *
 * It never throws and never hard-blocks — a guardrail, not a lock.
 */

const mode = process.argv[2];
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    if (mode === "session") {
      const context = [
        "PROJECT PHASE = MARKETING (not engineering).",
        "Mellowa's engineering build is done and certified through v20.",
        'If asked to "check the repo and write the next prompt pack", the answer is a MARKETING pack (label it v21): copy, plans and experiments — NOT code.',
        "Do NOT audit for gaps or write another engineering / hardening / closure / elevation / scale / security pack (no MW-*, XAPP-*, S*, X* prompts, no migrations, no refactors for their own sake).",
        "This already happened by mistake at v19 and again at v20 — do not make it three times.",
        "Real bug fixes and explicit owner requests are still welcome. Read docs/NEXT_STEPS.md before proposing any pack.",
      ].join(" ");
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: context,
          },
        })
      );
      return;
    }

    const data = JSON.parse(input || "{}");
    const fp =
      (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) ||
      "";
    const norm = String(fp).replace(/\\/g, "/");
    const base = norm.split("/").pop() || "";

    const isMigration = /(^|\/)supabase\/migrations\/[^/]*\.sql$/i.test(norm);
    const isReleasePack = /(^|\/)docs\/release\/v\d+\//i.test(norm);
    const isPackNamed = /^(MW|XAPP)-/i.test(base);

    if (isMigration || isReleasePack || isPackNamed) {
      const kind = isMigration
        ? "a new database migration"
        : isReleasePack
        ? "a docs/release/vNN release-pack doc"
        : "an MW-*/XAPP-* engineering-pack file";
      const reason =
        "Mellowa's phase is MARKETING (engineering is certified through v20). This write targets " +
        kind +
        " — the signature of another engineering pack, which docs/NEXT_STEPS.md says NOT to write (v19 and v20 already went this way by mistake). Proceed ONLY if this is a real bug fix or an explicit owner request; otherwise write the v21 MARKETING pack instead. Confirm with the owner.";
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: reason,
          },
        })
      );
      return;
    }
    // No output → allow the tool call unchanged.
  } catch {
    // Never block work on a hook error.
  }
});
