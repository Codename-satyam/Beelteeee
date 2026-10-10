# The Entity Championship — Local JSON Build

This version keeps the existing static HTML/CSS/JavaScript structure and removes Supabase and sign-in dependencies.

## Included pages

- `pages/index.html` — tournament landing page
- `pages/toss.html` — coin toss and map-only veto (no Killer voting)
- `pages/bracket.html` — team setup, single-elimination bracket, scoring, match completion, export/import state JSON
- `pages/bracket-screen.html` — full-screen read-only bracket for a stream layout
- `pages/live.html` — live scoreboard overlay

## Data and persistence

- Map names are loaded from `data/maps.json`.
- Team lists, bracket rounds, map bans, selected maps and scores are saved in the browser's `localStorage`.
- State changes update other open tabs/windows that use this same site in the same browser profile.
- Use **Export state JSON** and **Import state JSON** in Bracket Control to transfer/back up a tournament between machines.

### Important static-hosting limitation

A browser-only static site hosted on Vercel cannot directly overwrite a JSON file in the deployed project. Therefore, `data/maps.json` is a read-only configuration file, while tournament changes are saved to browser storage and can be exported/imported as a JSON file. Without a database or a small write-capable server, data will not automatically synchronize between two different computers or browser profiles.

## Vercel deployment

1. Commit this folder's contents to the GitHub repository (keep the folder names as shown).
2. In Vercel, set Framework Preset to **Other**.
3. Root Directory should be the repository root containing `index.html`, `pages/`, `shared/`, and `data/`.
4. Leave the Build Command blank. Set Output Directory to `.` if Vercel requires one for the static output.
5. Deploy. Open the root URL; `index.html` forwards visitors to `pages/index.html`.

## Scoring flow

1. Add team names and generate a bracket.
2. Choose a match and run the coin toss.
3. The toss winner bans first; teams alternate bans until one of five randomly selected maps remains.
4. Continue to the scoring menu and allocate the existing action-based points for Game 1 and Game 2.
5. Confirm both games and complete the match. The winner automatically advances.

The scoring model is preserved from the supplied project: team A is Killer in Game 1 and Survivor in Game 2; team B has the opposite roles. No Killer selection/voting is used.

## Local development

Serve the folder with any static server (for example, VS Code Live Server). Opening files directly with `file://` may block `fetch('../data/maps.json')` in some browsers.

## When replacing an existing repository

Remove obsolete authentication/database assets from the old project if present: `shared/supabase-config.js`, `data/killers.json`, the old `login.html` page, and any Supabase setup SQL that is no longer needed. This build does not reference or load them.
