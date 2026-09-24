Openly Rotation — editable session controls and championships

This patch follows the earlier multi-court Rotation Dashboard update (migrations 018 and 019).
It updates the hosted game Rotation tab only. Apply SQL first, then copy the two
src files into F:\WebProj\openly, replacing the matching files.

1. In Supabase SQL Editor, run the full contents of:
   supabase/migrations/020_rotation_editable_settings_championship.sql
   Run it once against the same database as your Openly site.
2. Copy src/app/components/RotationPanel.tsx and rotation.module.css into your project.
3. In PowerShell, from F:\WebProj\openly:
   npm run build
   git add src/app/components/RotationPanel.tsx src/app/components/rotation.module.css supabase/migrations/020_rotation_editable_settings_championship.sql
   git commit -m "Allow rotation settings edits and fix championships"
   git push

Hosts can change play style, rented court count, minutes, target, and win-by in
Session Controls between rounds, including after completed rounds. A draft or
live round temporarily blocks edits. Changes affect future rounds; old results
keep the settings with which they were played. Court settings below the courts
has been removed.

Optional championship: Top 4 creates one final on Court 1. Top 8 needs two
rented courts and eight players who have completed a qualifying round. It
creates semifinals on Courts 1 and 2. Use the single Start button below both
courts, enter and Save each court's score, then Complete semifinals. The button
to create the winners' final appears afterward. Scores must reach the target
and win-by requirement. Championship rounds do not change regular standings.

Verification: production build and ESLint; database scenarios for edits after
completed rounds, edit blocks during active rounds, historical scoring rules,
Top 8/Top 4 rounds and host authorization; mocked browser flow for settings,
semifinals, scoring, shared completion, and final. The included screenshot uses
sample players.
