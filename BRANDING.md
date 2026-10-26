# Branding: DukanDost

**DukanDost** (Urdu: دُکان دوست, "the shop's friend") is the official app name. It is a
four-syllable Urdu+English name that a shop owner in Karachi, Faisalabad or Peshawar can say
easily, it says what the product is (a friend to your دکان / store), and it does not collide with a
generic word like "General Store" in a Play or sideload list.

The name is set once in `android/app/src/main/res/values/strings.xml` (`app_name`) and referenced
by the launcher, splash screen, package label and About screen. The *shop's* name remains
configurable in Settings → Store profile; it is unrelated to the app name.

---

## 1. Logo

**Concept:** one coherent mark — a white shopping basket on the brand teal tile. The basket is the
universal retail symbol for a grocery/kiryana store; no other symbols are mixed in.

| File | Purpose |
| --- | --- |
| [assets/branding/logo.svg](assets/branding/logo.svg) | Editable vector source |
| [assets/branding/logo-preview.png](assets/branding/logo-preview.png) | 256 px preview rendered from the same geometry |
| `android/app/src/main/res/drawable/ic_launcher_foreground.xml` | Vector foreground for the adaptive icon |
| `android/app/src/main/res/drawable/ic_launcher_monochrome.xml` | Android 13+ themed-icon layer |
| `mipmap-{mdpi..xxxhdpi}/ic_launcher{,_round}.png` | Legacy launcher densities (48 → 192 px) |
| `mipmap-anydpi-v26/ic_launcher{,_round}.xml` | Adaptive-icon definition (API 26+) |

### Palette

| Token | Hex | Use |
| --- | --- | --- |
| Brand primary | `#0F766E` | Icon tile, splash background, primary buttons, headers |
| Primary dark | `#115E59` | Pressed states, chip text |
| On primary | `#FFFFFF` | Mark, button labels, inverse text |
| Background / surface / text | `#F4F6F8` / `#FFFFFF` / `#0F172A` | Layout tokens in `src/app/theme.ts` |

All tokens live in [src/app/theme.ts](src/app/theme.ts) (`colors`, `spacing`, `radius`, `font`,
`touchTarget`, `motion`) — screens import them instead of defining their own colours, so the
Dashboard, POS, Products, dialogs and receipt preview look like one product.

### Regenerating the PNGs

The launcher PNGs are **generated**, not hand-drawn:

```bash
node tools/icon-generator/generate.js
```

The script draws the same basket geometry as the SVG (rounded tile, tapered body, two woven slots,
arc handle) with antialiasing at 4× supersampling, using only Node's `zlib` — no ImageMagick, no
Inkscape, no design suite. Run it after changing the mark, then commit the changed PNGs.

The Android adaptive icon and monochrome vector are hand-maintained and mirror the same geometry
(scale 46 on a 108dp canvas); if you edit the logo, edit those paths too.

---

## 2. Splash screen

Implemented with the platform mechanism — no third-party splash library:

| API | Mechanism |
| --- | --- |
| Android 12+ (API 31+) | `Theme.GeneralStore.Starting` sets `android:windowSplashScreenBackground` (brand teal), `android:windowSplashScreenAnimatedIcon` (the white basket vector) and `android:windowSplashScreenIconBackgroundColor`; the launcher masks the icon into its own shape and the system hides it on first frame. |
| API 24–30 | The same theme sets `android:windowBackground` to a `layer-list` (teal + centred basket vector), which appears instantly with no library. |

The activity uses `@style/Theme.GeneralStore.Starting` while the application keeps `AppTheme`, so
the splash hands over to a background colour that matches the first rendered screen — no white or
black flash, no artificial delay, and no repeated splash during navigation.

Files: `res/values/styles.xml`, `res/values-v31/styles.xml`, `res/drawable/splash_background.xml`.

---

## 3. Motion

`motion` in [src/app/theme.ts](src/app/theme.ts) defines the shared timing system:

```ts
motion = { duration: 180, durationSlow: 260, slideDistance: 12, ease: [0.2, 0, 0, 1] }
```

- Screen transitions are React Navigation's native-stack defaults (subtle horizontal slide driven on
  the UI thread — no JS animation work during a POS interaction).
- Sheets use the platform `Modal` slide, and every JS-driven animation is gated by
  `useReducedMotion()`, which listens to `AccessibilityInfo.isReduceMotionEnabled` so Android's
  "Remove animations" setting is respected.
- No animation library was added: a dependency that increases APK size and startup time was not
  justified by the few transitions this app needs.

---

## 4. In-app identity

- **Lock screen** — the `BrandMark` (teal tile + basket, drawn with plain RN views so it is crisp at
  any size) with the wordmark **DukanDost** above the PIN entry and above the first-run PIN setup.
- **Help & about** — `BrandMark` + wordmark + the Urdu/English tagline "دُکان دوست — آف لائن POS
  اور انوینٹری / DukanDost — offline POS & inventory", above version, schema and database path.
- The mark carries `accessibilityRole="image"` and `accessibilityLabel="DukanDost"`.

---

## 5. Verification status (honest)

**Verified in code/tests:**

- Adaptive icon, monochrome layer and all five PNG densities are generated from one geometry and
  present in `res/` (each file produced by the generator run in this session).
- Splash theme is wired in the manifest and both API branches exist.
- `BrandMark` renders, is square at any size and exposes an accessibility label
  (`__tests__/ui/layout.test.tsx`).
- Inset layout contract (`Screen`, `BottomBar`, tab bar, FABs, POS bars) asserted with fixed insets.

**Not verified — needs a real device (no Android device/emulator in this environment):**

- The launcher icon as rendered by a specific launcher (adaptive mask shape, themed-icon recolour).
- The splash-to-app transition timing and whether any launcher shows a frame of the window
  background before the system splash on API 24–30.
- Behaviour under increased display size / font scale, gesture vs three-button navigation, cutout
  devices, split-screen, and keyboard-open states on the POS and form screens.

The acceptance matrix for those configurations is in PROJECT_STATUS.md §7; nothing there should be
read as passing until someone runs it on hardware.
