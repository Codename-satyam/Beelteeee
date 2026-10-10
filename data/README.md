# Local tournament data

`maps.json` is the local map pool used to draw five options for each match. Keep it as a JSON array of unique map-name strings, for example:

```json
[
  "Coal Tower",
  "Garden of Joy",
  "The Game",
  "Dead Dawg Saloon",
  "Treatment Theater"
]
```

At least five unique names are required. The site fetches this file at runtime, so deploy any map-pool edits to Vercel before running the next map vote. Each active match stores the five drawn maps and each ban in the browser's tournament state.
