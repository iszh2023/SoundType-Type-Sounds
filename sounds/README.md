# Adding “real” sounds

SoundType ships with **synthetic placeholder sounds** by default.


## Folder layout

Put files here:

`Google Extension/SoundType/sounds/<seriesId>/<file>`

Examples:
- `Google Extension/SoundType/sounds/roblox/oof.mp3`
- `Google Extension/SoundType/sounds/mario/mammamia.mp3`
- `Google Extension/SoundType/sounds/animal/chatter1.mp3`

## Which filenames are loaded?

The extension tries these filenames (you can add any subset; it will use what it finds):

Each name below can be **either**:
- exact filename (like `mammamia.mp3`), **or**
- base name with extension omitted (like `mammamia`) — SoundType will try `.mp3`, `.wav`, then `.ogg`.

- `roblox`: `oof`, `oof2`, `vine_boom`
- `amongus`: `sus`, `emergency`, `kill`
- `mario`: `mammamia`, `coin`, `1up`, `jump`
- `animal`: `chatter1`, `chatter2`, `chatter3`
- `geometry`: `gd_click1`, `gd_click2`, `gd_jump`
- `minecraft`: `xp`, `hit`, `place`
- `pokemon`: `pikachu`, `battle_start`, `catch`
- `zelda`: `hey_listen`, `item_get`, `secret`
- `sonic`: `ring`, `spin`, `level_up`
- `undertale`: `sans`, `hit`, `save`
- `asmr`: `asmr_tap_1`, `asmr_tap_2`, `asmr_brush_1`, `asmr_scratch_1`, `asmr_crinkle_1`, `asmr_whisper_1`, `asmr_whisper_2`, `asmr_rain_1`, `asmr_water_1`, `asmr_chime_1`
- `meme`: `metal_pipe`, `bruh`, `gasp`, `boing`, `error`, `ping`, `bass`
- `keys`: `keys`

## After adding sounds

1. Go to `chrome://extensions`
2. Click **Reload** on SoundType
3. Refresh your webpage / open a new tab
4. Pick the series again (or refresh the page)
