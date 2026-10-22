# In-game music

Put your own audio files in this folder and list them in `playlist.json`. Nothing plays until you add tracks.

```json
{
  "shuffle": false,
  "default": ["music/saloon.mp3"],
  "duel":    ["music/duel-1.mp3", "music/duel-2.mp3"],
  "results": ["music/victory.mp3"]
}
```

- Screens you can set: `menu`, `lobby`, `duel`, `results`. A screen with no list uses `default`. If neighbouring screens share the same list, the song keeps playing without restarting.
- Tracks play in order and loop back to the start. Set `"shuffle": true` to randomise.
- Use `.mp3`, `.ogg` or `.m4a`. Keep each file small (about 2 to 5 MB) so it loads quickly on mobile data.
- Paths are relative to `public/`. You can also use a full `https://` URL to a file hosted elsewhere.
- Browsers only allow audio after the first tap or click, so music starts on the player's first interaction.
- Players get a volume slider (it appears once you add tracks) and the mute button. Their volume is remembered.
- Only use music you own or have a licence for. Files in this folder are deployed with the game on Render.
