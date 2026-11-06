# Gratitude Garden

A gratitude diary that lives in your Mac's menu bar and grows a garden.

1. **Write down what was good today.** Click the menu-bar icon and a page drops down: type from the top, add photos and place them anywhere like prints in a scrapbook.
2. **Submit** and that day's flower grows to full bloom, then it's planted in your garden. The more you put on the page, the bigger it grows. Day one is always a lotus; after that each seed is drawn by rarity (lotuses rarest, ground flowers commonest).
3. **The garden** is a watercolour 3D garden with a koi pond. Each flower keeps the page that grew it: click one to see it. Two fingers on the trackpad move round, pinch zooms. The pill at the bottom has the settings, including sliders for the glass.

> The app's window title and bundle are still called "Sip Flower" (its working name).

## Try it on another Mac

Needs an Apple silicon Mac, [Node](https://nodejs.org) 22 or newer and [pnpm](https://pnpm.io) (`npm i -g pnpm`).

```bash
git clone https://github.com/Sumin-Studio/gratitude-garden.git
cd gratitude-garden
pnpm install
pnpm dev          # run it straight from the code
```

To install it as an app:

```bash
pnpm package      # builds dist/mac-arm64/Sip Flower.app and a .dmg
```

Drag the app into Applications. It's ad-hoc signed, not notarized: if macOS won't open it, right-click it in Applications → Open → Open (once). macOS asks for the microphone the first time you record.

Your diary is saved in `~/Library/Application Support/Sip Flower/` (`state.json`, with `media/` for photos).

## Try it in a browser

```bash
pnpm web          # then open /pad.html and /garden.html?diary
```

The browser version keeps a pretend diary in the tab's own storage.

## Demo mode (for recording)

Put a `demo.json` in the app's folder above:

```json
{ "replay": true, "seed": "lotus" }
```

Today's seed is then always a lotus, and opening the pad after a Submit puts today back as it was, so a take can be repeated. Delete the file to go back to normal. `scripts/demo-diary.mts` builds a pretend diary from a list of days and photos (see the top of the file).

## Develop

```bash
pnpm typecheck
pnpm test         # the diary model, layout, rig
pnpm selftest     # the whole loop in the real app: type, submit, garden
```

- `src/shared/diary.ts`: the diary (days, flowers, rarity, sizes).
- `src/main/`: the menu-bar icon, the pad window, the garden window, the page's garden picture (`snap.ts`), demo mode.
- `src/renderer/src/pad/`: the pad. `src/renderer/src/garden/`: the garden scene, the flower callout, the settings. `src/renderer/src/ui/`: the shared sheet and glass styles.
- `resources/flowers/`: the flower models.

## Credits

Inspired by **Sip** by Kailash S R ([@kail.designs](https://www.instagram.com/p/Dbn8eVOAdNy/)), a pixel-art desktop companion that gets thirstier while you work. Sip's source isn't public, so nothing here is borrowed from it; this is a from-scratch reinterpretation. The name "Sip" is theirs.

Built with Electron, React, three.js and @react-three/fiber. Type is Inter.
