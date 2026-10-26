# Building the APK (no Android Studio required)

You do **not** need Android Studio, Expo or EAS. The APK is built by GitHub Actions from a
committed Gradle wrapper and a pinned toolchain. This machine has no JDK or Android SDK, so no APK
was produced here — the steps below are how the first real APK gets made.

---

## 1. Toolchain the workflow uses

| Tool | Version | Where it comes from |
| --- | --- | --- |
| Node.js | 24 (project requires ≥ 22.11) | `actions/setup-node` |
| JDK | Temurin **21** | `actions/setup-java` |
| Gradle | **9.4.1** | committed wrapper (`android/gradle/wrapper/`) |
| Android Gradle Plugin | 9.x | React Native 0.88 gradle plugin (`node_modules/@react-native/gradle-plugin`) |
| Kotlin | 2.2.0 | `android/build.gradle` |
| compileSdk / buildTools | **37** / 37.0.0 | `android/build.gradle` (mirrors RN 0.88's `gradle/libs.versions.toml`) |
| SDK package names | `platforms;android-37.0`, `build-tools;37.0.0` | installed by the workflow |
| targetSdk | 36 | `android/build.gradle` |
| minSdk | 24 (Android 7.0) | `android/build.gradle` |
| NDK | 27.1.12297006 | installed by the workflow (`sdkmanager`); CMake is not needed — the project has no native source |

Pinned versions live in `android/build.gradle`, `android/app/build.gradle`,
`android/gradle/wrapper/gradle-wrapper.properties` and `.github/workflows/android.yml`. Change them
together.

## 2. Push the repository

```bash
git remote add origin https://github.com/<you>/general-store.git
git branch -M main
git push -u origin main
```

If you create the repository through the GitHub UI, do **not** add a README or license file — the
repository already has them.

## 3. Run the workflow

The workflow is [.github/workflows/android.yml](.github/workflows/android.yml). It runs on every
push to `main`/`master` and on every pull request, and can be started by hand:

**GitHub → Actions → “Android APK” → Run workflow** (optionally tick *Also build a release APK*).

Jobs:

1. **verify** — `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:ci`.
   The whole pipeline stops here if any check fails; the APK job will not run.
2. **apk** — installs the SDK packages above, then `./gradlew assembleDebug` and uploads:
   - `general-store-debug-apk` → `general-store-debug.apk` (the artifact you install)
   - `general-store-debug-logs` → Gradle output, uploaded even on failure
3. **release** (manual runs only) — `assembleRelease`, signed when the secrets below exist,
   uploaded as `general-store-release-apk`.

Download the artifact: **Actions → run → Artifacts → general-store-debug-apk**.

## 4. Install on the phone

1. Download and unzip `general-store-debug-apk` (it contains `general-store-debug.apk`).
2. Copy it to the phone (USB, or any transfer the user already uses).
3. Open it, allow “Install unknown apps” for the file manager/browser once, install.
4. First launch asks for a PIN (4–8 digits) — there is no default PIN and no bypass.
5. Optional: pair a Bluetooth thermal printer in **More → Settings → Printer** before the first
   bill.

The debug APK is signed with the standard Android debug key. It installs fine on a personal phone
but **cannot** be published to Play, **cannot** be upgraded by a release build signed with a
different key, and debugs normally (no Play/App Bundle optimisation).

## 5. Release APK signing (optional, for distribution)

The release build in this repo falls back to the debug key when no keystore is configured, so it is
always installable for testing. For a properly signed release:

1. Create a keystore **outside** the repository:

   ```bash
   keytool -genkeypair -v -keystore release.keystore -alias generalstore \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add repository secrets (**Settings → Secrets and variables → Actions**):

   | Secret | Content |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` output |
   | `ANDROID_KEYSTORE_PASSWORD` | keystore password |
   | `ANDROID_KEY_ALIAS` | `generalstore` |
   | `ANDROID_KEY_PASSWORD` | key password |

3. Run **Actions → Android APK → Run workflow** with *build a release APK* ticked.

Never commit the keystore, its passwords, or a base64 dump of it. Losing the keystore means you can
never update the app on a phone that installed the released version.

For local release signing, put `release.keystore` in `android/app/` and a `keystore.properties` next
to `android/`:

```properties
storeFile=app/release.keystore
storePassword=…
keyAlias=generalstore
keyPassword=…
```

Both paths are git-ignored.

## 6. Building locally (if you ever install a JDK + SDK)

Android Studio is not required; only a JDK 21 and the Android SDK command-line tools:

```bash
npm ci
npm run android:assemble        # android/app/build/outputs/apk/debug/app-debug.apk
npx react-native start          # Metro, if you want live reload
npm run android                 # install the debug build on a USB-connected phone
```

`android/local.properties` must point at your SDK (`sdk.dir=…`); it is git-ignored.

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `SDK location not found` | No Android SDK on the machine. Use the GitHub Actions path, or create `android/local.properties`. |
| `Unsupported class file major version` / Gradle JDK error | Wrong JDK. Use **21**; Gradle 9 and AGP 9 reject 8/11. |
| `Failed to find package 'platforms;android-37'` | API 37 is published as `platforms;android-37.0` (minor-versioned naming). Bump `compileSdk` only together with the `sdkmanager` line. |
| `NDK not configured` / CMake error | The new architecture builds native code; the workflow installs NDK 27.1.12297006 and CMake 3.22.1. |
| Metro “Unable to load script” | The JS bundle is missing from a debug build without Metro — use `npm run android:assemble` (bundles JS) or start Metro. |
| Blank screen after launch | Check `adb logcat | grep -i react`; usually a missing native module registration (`GeneralStorePackage`). |
| Bluetooth printer prints nothing | Pair it in Android settings first, then pick it in Settings → Printer; the manifest requests `BLUETOOTH_CONNECT` on Android 12+. |
| Workflow fails at `npm ci` | `package-lock.json` is out of sync with `package.json`; run `npm install` locally and commit the lockfile. |
| Workflow fails at `npm run lint` / `test:ci` | Real failures — the APK job is gated on them on purpose. Fix the code, don't skip the gate. |
