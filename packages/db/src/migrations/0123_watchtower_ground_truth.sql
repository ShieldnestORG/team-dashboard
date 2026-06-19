-- 0123_watchtower_ground_truth.sql
-- Adds optional brand "ground truth" text to Watchtower subscriptions, used
-- by the weekly accuracy judge (Haiku) to flag engine answers that
-- contradict what's actually true about the brand. Nullable + additive:
-- existing subscriptions are unaffected (no ground truth = no accuracy judge
-- = no accuracyAlerts in the digest).

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS ground_truth text;
