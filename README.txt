Openly Rotation Reference Style Update

Apply this patch after the previous Openly-Rotation-Dashboard-Update (including migrations 018 and 019).
This patch changes only the Rotation UI. No new SQL is required.

1. Copy the src folder into your Openly project, replacing the two matching files.
2. Run npm run build.
3. Publish using your normal Git/Vercel flow:
   git add src/app/components/RotationPanel.tsx src/app/components/rotation.module.css
   git commit -m "Match rotation dashboard to reference design"
   git push

Includes compact session controls, horizontal resting player cards, responsive court panels,
team score +/- controls, court diagrams, timers, and independent End Round actions.
Existing backend rotation, entitlement, and result behavior is retained.
No shuffle/add-player controls, invented ratings, or serve counters are included.

Validation: TypeScript, component ESLint, production build, and mocked desktop/mobile browser
checks covering three courts without duplicate players, per-court completion, timeout/overtime,
and non-host restrictions. Screenshots use sample players and are not live website data.
