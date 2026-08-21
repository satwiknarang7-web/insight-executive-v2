# Analyst avatar portraits

Drop four images here to replace the generated portraits:

| File | Analyst | Role |
| --- | --- | --- |
| `strategist.jpg` | Nadia Reyes | The Strategist |
| `analyst.jpg` | Marcus Oyelaran | The Analyst |
| `storyteller.jpg` | Priya Raman | The Storyteller |
| `coach.jpg` | Tom Baxter | The Coach |

Square images, 256×256 or larger. They are rendered with `object-fit: cover`
inside a circle, so keep the face centred.

No code change is needed. `components/panels/AnalystAvatar.js` uses the file if
it loads and falls back to the generated portrait if it 404s, so the app works
with this directory empty. Filenames come from `portrait` in `lib/avatars.js`.
