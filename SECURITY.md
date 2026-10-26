# Security

This document states what the app actually protects, how, and where the protection ends. Where a
requirement is **not** met, it says so plainly instead of implying otherwise.

---

## 1. Network surface

- The manifest declares **no `INTERNET` permission**. The app cannot open a socket, so there is no
  telemetry, no crash upload, no analytics, no ad SDK and no remote API to leak to.
- `android:usesCleartextTraffic="false"` — even if a future feature adds networking, plain HTTP is
  blocked at the platform level.
- `android:allowBackup="false"` — Android's cloud/ADB auto-backup cannot silently copy the shop
  database off the device; backups are explicit user actions instead.
- The only permissions requested are Bluetooth ones, used exclusively for thermal printing:
  `BLUETOOTH`/`BLUETOOTH_ADMIN` (max SDK 30) and `BLUETOOTH_CONNECT` (Android 12+).

## 2. PIN lock

| Property | Value |
| --- | --- |
| Format | 4–8 digits (`PIN_MIN_LENGTH`…`PIN_MAX_LENGTH`), digits only |
| Weak-PIN rejection | all-same-digit and `1234`/`12345`/`123456`/`0000`/`1111` are refused |
| Storage | **never the PIN** — a scrypt verifier `{algo, N, r, p, dkLen, salt, hash}` stored through `SecureStore` (Keystore-encrypted preferences) |
| KDF parameters | scrypt N=32768, r=8, p=1, dkLen=32, unique 16-byte random salt per device |
| Comparison | constant-time comparison of derived keys |
| Change | requires the current PIN; a change generates a new salt |
| Lockout | 5 free attempts, then 30 s → 60 → 120 → 240 → 300 s (capped), reset on success |
| Auto-lock | configurable idle timeout, default 60 s; also re-locks when the app returns from the background after the timeout |
| Transaction safety | locking is a UI-state change only; an in-flight database transaction is never interrupted or rolled back by the lock |

Implementation: [src/services/pinService.ts](src/services/pinService.ts) with `@noble/hashes`
scrypt (audited, pure JS, no native build step). Tests assert that the stored JSON contains no
digits of the PIN, that the same PIN produces different verifiers on two devices (different salt),
and that wrong PINs are rejected.

On first launch the app refuses to open business data until a PIN exists. The lock screen obscures
content behind it; the database is opened only after the PIN is verified.

## 3. Recovery

- Optional multi-question recovery (minimum **two** questions), from a list of ten childhood-style
  questions or custom text.
- Answers are normalized (case, whitespace, Urdu letter variants, Arabic-Indic digits), then stored
  as salted scrypt verifiers only. The app never displays a saved answer.
- Verification evaluates **all** answers and returns one generic failure, so an attacker cannot
  learn which answer was wrong.
- Recovery is rate-limited with the same lockout schedule as the PIN; the screen warns that recovery
  questions are weaker than a strong secret and recommends writing the answers down offline.
- A successful recovery requires setting a new PIN immediately; business data is untouched.
- **There is no master PIN, backdoor, hardcoded recovery code or hidden bypass** anywhere in the
  codebase.

## 4. Secrets on the device

`SecureStore` (Kotlin) stores small secrets encrypted with an **AES-256-GCM key held in the Android
Keystore** — the key is generated on the device, marked non-exportable, and never leaves it:

```
SecureStore.getItem(key) / setItem(key, value) / removeItem(key)
SecureStore.encryptToFile / decryptFile   (used for encrypted backups)
```

`encryptFile`/`decryptFile` wrap a file with the same Keystore key and are used for encrypted
backups. No API key, password or signing secret is stored in source code, `strings.xml`, or the JS
bundle.

## 5. Backups

- Created with `VACUUM INTO`: a consistent snapshot even while the app is in use.
- Recorded in the `backups` table with size, schema version and checksum, so an incomplete file is
  never presented as a valid backup.
- **Encrypted backups** are sealed with the Keystore AES-GCM key file-by-file; an encrypted backup
  can only be restored on a device that still holds that key. If the app is uninstalled or the
  Keystore key is destroyed, an encrypted backup **cannot be recovered** — the app says this in the
  backup screen before encrypting.
- Restore validates the candidate (`PRAGMA integrity_check`, schema version) before replacing the
  live file, and re-checks after; a bad file leaves the previous database intact.
- Backups are user-exported to a location the user chooses; app-private storage alone is documented
  as **not** a safe backup (device loss, app deletion).

## 6. Roles and authorisation

Permissions are enforced in the **service layer** (`assertCan(actor.role, permission)`), not by
hiding buttons. A cashier who calls a service directly from a bug or a script is still refused.

| Permission | Owner | Manager | Cashier | Inventory | Accountant |
| --- | :-: | :-: | :-: | :-: | :-: |
| `sale.create` | ✅ | ✅ | ✅ | | |
| `sale.return` | ✅ | ✅ | | | |
| `sale.discount.override` | ✅ | ✅ | | | |
| `product.manage` | ✅ | ✅ | | ✅ | |
| `stock.adjust` | ✅ | ✅ | | ✅ | |
| `purchase.manage` | ✅ | ✅ | | ✅ | |
| `payment.record` | ✅ | ✅ | ✅ | | ✅ |
| `expense.manage` | ✅ | ✅ | | | ✅ |
| `cash.close` | ✅ | ✅ | ✅ | | |
| `report.view` | ✅ | ✅ | | | ✅ |
| `settings.manage` | ✅ | ✅ | | | |
| `backup.manage` | ✅ | ✅ | | | |
| `security.manage` | ✅ | | | | |

`security.manage` is owner-only: managers cannot change the PIN policy, recovery questions or
roles. Tests cover a cashier being refused backup creation and an unauthorised discount override.

## 7. Audit trail

`audit_events` records `at`, `actor`, `action`, `entity`, `entity_id` and a JSON `details` payload
for: sale creation/reversal, purchase creation/reversal, returns, stock adjustments, payments,
expenses, cash closings, product archive/restore, settings changes, PIN changes, recovery resets,
backup creation and restore. The audit log is append-only (no UI deletes or edits events).

Sensitive operational history (`stock_movements`, `ledger_entries`, `payments`) is immutable;
corrections are new documented rows, never in-place edits.

## 8. Data handling rules

- All SQL is parameterized. The only interpolated identifiers are fixed, code-chosen column names
  and directions (never user input).
- CSV **export** escapes values and writes UTF-8 with a BOM so Excel renders Urdu correctly.
  (CSV *import* is not implemented yet — see PROJECT_STATUS.md — so there is no bulk-import path to
  validate.)
- Logging: the app does not log PINs, recovery answers, customer phone numbers or monetary details
  to `console`/logcat. Errors surface to the user with a typed message.
- Deleting data is deliberate: a finished document is reversed with a reason, and any future
  "delete" feature must follow the same rule.

## 9. Honest limits

1. **The database file is not encrypted with SQLCipher.** It is a normal SQLite file inside
   app-private storage. On a non-rooted device other apps cannot read it; on a rooted or
   compromised device, or via a full-device backup performed outside the app, the contents are
   readable. The PIN gate does not encrypt data at rest.
2. **The PIN protects the app, not a stolen device from a determined attacker.** 4–8 digits is a
   small keyspace; scrypt and lockout make online guessing slow, but offline extraction of the
   database is a different threat that point 1 leaves open.
3. **Encrypted backups are unrecoverable if the Keystore key is lost.** There is no escrow and no
   recovery code that can decrypt them.
4. **Recovery questions are weaker than a hardware-backed factor.** They are offered because a shop
   owner with one phone needs *some* path back into their own data, and the UI says so.
5. **A rooted device can defeat every app-level control** — screenshot blocking, PIN gating and
   Keystore usage included. The app does not claim to be tamper-proof.
6. **Bluetooth printing sends bill contents to the paired printer.** That is the point of a
   printer, but it is a data egress path the user controls, not the app.

## 10. Planned hardening (not implemented)

- SQLCipher (or an equivalent maintained encrypted SQLite build) with the key wrapped by the
  Keystore, a documented key-loss policy and a migration path for existing plaintext databases.
- Optional biometric unlock (`BiometricPrompt`) as a convenience layer **on top of** the PIN, never
  as a replacement for the recovery flow.
- Screenshot/recents preview blocking on sensitive screens (`FLAG_SECURE`).
- Signed, versioned backup format with a key-derivation audit trail.
