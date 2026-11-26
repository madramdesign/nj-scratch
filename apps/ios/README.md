# NJ Scratch for iPhone and iPad

A native SwiftUI app for the NJ Scratch-Off Tracker.

It reads the same JSON the website publishes on GitHub Pages (`<site>/api/*.json`), so it needs no server. It keeps the last good copy of the data on the device, so it opens instantly and still works offline. A banner shows how old the data is.

## Screens

| Screen | What it shows |
|---|---|
| **Rankings** | All active games, filterable by price and searchable. Sort by score, estimated return, top-prize odds vs. launch, odds of winning more than cost, or price. |
| **Game detail** | Assessment and its reasons, stronger same-price alternatives, key numbers, break-even, "If you buy several tickets" chances next to the expected loss, history charts, prize table and score breakdown. Links to njlottery.com. |
| **Calendar** | Announced games, the games that stop selling next, and the last day to claim prizes. |
| **Changes** | Notable changes in the official data, grouped by day. |
| **Watchlist** | Starred games (stored on the device only) and their recent notable changes. |
| **About** | Data freshness, a scoring summary, responsible-play information and links. |

The first time the app opens, it shows a notice covering:
- gambling and the house edge,
- that rankings are not predictions,
- 18+,
- no affiliation with the NJ Lottery,
- 1-800-GAMBLER.

The math matches the website. `NJScratch/Model/Analytics.swift` ports `packages/analytics/src/session.ts` and `alternatives.ts`. `NJScratchTests` checks the port against the same reference values as the TypeScript tests, and decodes real exported JSON.

## Build and run

You need Xcode 26 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`). The Xcode project is generated from `project.yml` and is not committed.

```bash
cd apps/ios && xcodegen generate
```

```bash
open NJScratch.xcodeproj
```

Run tests from the command line:

```bash
xcodebuild -project NJScratch.xcodeproj -scheme NJScratch -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

### Pointing the app at local data

The app reads https://madramdesign.github.io/nj-scratch/ by default. To use a local static build instead:

1. Build the site and serve it with `vite preview` on port 4173 (see the root README).
2. Set the environment variable `NJ_BASE_URL=http://localhost:4173/nj-scratch/` in the scheme (Edit Scheme → Run → Arguments).

Only localhost is allowed over plain HTTP (`NSAllowsLocalNetworking`).

The calendar and the notable-changes file appear on the live site once the Phase 1 website changes are deployed. Until then:
- the Calendar tab says it isn't published yet;
- Changes falls back to filtering `changes.json`.

## Releasing to TestFlight

These steps use the "ROBERT MEKITA" team (`G2E45NC5BZ`) with automatic signing. The App Store Connect app record for `com.madramdesign.NJScratch` already exists.

1. Raise the build number in `project.yml`: `CURRENT_PROJECT_VERSION` must go up with every upload. Raise `MARKETING_VERSION` when you release a new version.
2. Regenerate the project and archive:

   ```bash
   xcodegen generate && xcodebuild -project NJScratch.xcodeproj -scheme NJScratch -configuration Release -destination 'generic/platform=iOS' -archivePath build/NJScratch.xcarchive -allowProvisioningUpdates archive
   ```

3. Upload. Use an `ExportOptions.plist` with `method` set to `app-store-connect`, `destination` set to `upload`, and `teamID` set to `G2E45NC5BZ`:

   ```bash
   xcodebuild -exportArchive -archivePath build/NJScratch.xcarchive -exportOptionsPlist build/ExportOptions-upload.plist -exportPath build/upload -allowProvisioningUpdates
   ```

Builds appear under **TestFlight** in App Store Connect after Apple finishes processing them, usually within 5–30 minutes.

- **Internal testers** (members of your App Store Connect team) can install a build right away.
- **External testers** need Beta App Review first. That requires a privacy policy URL, a beta description and test notes.

## App Store

**Status:** version 1.0 (build 2) was submitted for App Review on 2026-11-25. Release is manual: after approval, press **Release this Version** in App Store Connect.

Built into the app:
- `PrivacyInfo.xcprivacy`: no tracking, no data collected, and the UserDefaults reason (`CA92.1`).
- An app icon with no alpha channel.
- The export-compliance flag (`ITSAppUsesNonExemptEncryption = NO`).
- The first-launch notice with 18+ and 1-800-GAMBLER.
- No purchase links, ads or accounts.

Listing materials live in `AppStore/`:

| File | Contents |
|---|---|
| `metadata.json` | Subtitle, description, keywords, promotional text, URLs, categories (Reference, then Utilities), copyright, review notes, 18+ override, US-only availability, free price, content-rights declaration |
| `screenshots/iphone-6.9/`, `screenshots/ipad-13/` | Simulator screenshots, 1320×2868 and 2064×2752 |
| `asc.mjs` | App Store Connect API script (no dependencies) |
| `review-contact.json` | Optional reviewer contact details. Gitignored; the contact can also be entered in App Store Connect. |

### Updating the listing or submitting a new version

The script needs an App Store Connect API key with the App Manager role. Save the `.p8` file as `~/.appstoreconnect/private_keys/AuthKey_<KEY ID>.p8` and set:

```bash
export ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id>
```

Commands:
- `node AppStore/asc.mjs check` reads back what a submission needs. It never prints contact details.
- `node AppStore/asc.mjs push` uploads the listing, categories, age rating, availability, price, review notes and screenshots, and selects the newest processed build. It is safe to re-run.
- `node AppStore/asc.mjs submit` sends the version to App Review. Run it deliberately.

For a new version:
1. Create the version in App Store Connect, or let an upload create it.
2. Set `VERSION` in `asc.mjs`.
3. Add `whatsNew` handling if needed.
4. Raise the build number and upload as described under "Releasing to TestFlight".
5. Run `push`, then `check`, then `submit`.

**App Privacy** ("Data Not Collected") can't be set or read through Apple's API. Keep it published in App Store Connect.

Guideline 5.3 (gaming, gambling and lotteries) is the main review risk. The review notes explain that the app only analyzes the NJ Lottery's public data: it does not sell tickets, take wagers, link to purchases, or claim any affiliation. Keep "win", "beat the lottery" and "best odds to win" out of the name, subtitle and keywords.
