-- Prompt 14 (audit v5): expand the plan_feedback verdicts beyond the original
-- helpful / not_for_me so users can say *why* a plan didn't fit. The new
-- verdicts map to canonical, injection-safe generation hints in code.
-- Additive and idempotent: we only widen the CHECK constraint.

alter table plan_feedback
  drop constraint if exists plan_feedback_verdict_check;

alter table plan_feedback
  add constraint plan_feedback_verdict_check
  check (
    verdict in (
      'helpful',
      'not_for_me',
      'too_much',
      'too_little_time',
      'didnt_fit_food'
    )
  );
