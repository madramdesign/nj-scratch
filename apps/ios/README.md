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
| **Watchlist** | Starred games (stored on the device only), their recent notable changes, and notification settings. |

**Notifications (version 1.1).** Turn them on in Watchlist → Notifications. There are two options:
- **Starred games:** top or major prizes claimed, the last top prize claimed, and profile changes.
- **New game announcements.**

How it works:
- iOS runs a background app refresh (`com.madramdesign.NJScratch.refresh`) when it chooses, typically a few times a day. The app fetches `api/changes-notable.json` and posts local notifications for events newer than the last check.
- The first check after you turn notifications on only records the current position, so older changes are never sent.
- Each check posts at most 5 notifications; anything beyond the first 4 becomes one summary.
- Tapping a game notification opens that game; tapping the summary opens Changes.
- There is no server or push service, and nothing leaves the device.
- Debug builds have a "check the last 3 days now" button for testing.
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

## App Store checklist

Already in place:
- `PrivacyInfo.xcprivacy`: no tracking, no data collected, and the UserDefaults reason (`CA92.1`).
- An app icon with no alpha channel.
- The export-compliance flag (`ITSAppUsesNonExemptEncryption = NO`).
- The first-launch notice with 18+ and 1-800-GAMBLER.
- No purchase links, ads or accounts.

Still needed before submitting:
1. **Apple Developer Program membership.** Set `DEVELOPMENT_TEAM` in `project.yml` and confirm the bundle id `com.madramdesign.NJScratch`.
2. **App Store Connect record.**
   - Category: Reference (secondary: Utilities).
   - Age rating: answer "Gambling" questions truthfully. Expect an **18+** rating.
   - Privacy: "Data Not Collected".
3. **Review notes.** Explain that the app only analyzes the NJ Lottery's public data:
   - it does not sell tickets, take wagers, or link to purchases;
   - it is not affiliated with the NJ Lottery.

   Guideline 5.3 (gaming, gambling and lotteries) is the main review risk. Apps that only show lottery information are generally allowed, but be ready to answer questions.
4. **Screenshots** for 6.9" and 6.5" iPhones, plus iPad if you keep iPad support (`TARGETED_DEVICE_FAMILY` "1,2").
5. **Metadata.** Avoid "win", "beat the lottery" and "best odds to win" in the name, subtitle and keywords.
6. **A support URL and privacy policy URL.** The GitHub Pages site can host a short privacy page saying no data is collected.
