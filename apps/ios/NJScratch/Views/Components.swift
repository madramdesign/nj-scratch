import SwiftUI

/// Score with a text label and a shape, so meaning never depends on color alone.
struct ScoreBadge: View {
    let score: GameScore
    var large = false

    private var style: (icon: String, text: String, color: Color) {
        switch score.label {
        case "strong": return ("arrowtriangle.up.fill", "Strong", .green)
        case "average": return ("square.fill", "Average", .orange)
        case "weak": return ("arrowtriangle.down.fill", "Weak", .red)
        default: return ("questionmark", "Unrated", .gray)
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: style.icon).font(.system(size: large ? 11 : 8)).accessibilityHidden(true)
            Text(score.score.map { String(Int($0.rounded())) } ?? "—").monospacedDigit()
            if large { Text(style.text).font(.caption.weight(.semibold)) }
        }
        .font(large ? .title3.weight(.bold) : .subheadline.weight(.bold))
        .padding(.horizontal, large ? 12 : 8)
        .padding(.vertical, large ? 6 : 3)
        .foregroundStyle(style.color)
        .background(style.color.opacity(0.15), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Score \(score.score.map { String(Int($0.rounded())) } ?? "unrated"), \(style.text) remaining-prize profile")
    }
}

struct StarButton: View {
    @Environment(Watchlist.self) private var watchlist
    let gameId: String
    let name: String

    var body: some View {
        let on = watchlist.contains(gameId)
        Button {
            watchlist.toggle(gameId)
        } label: {
            Image(systemName: on ? "star.fill" : "star")
                .foregroundStyle(on ? .yellow : .secondary)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(on ? "Stop tracking \(name)" : "Track \(name)")
        .sensoryFeedback(.selection, trigger: on)
    }
}

/// "est." marker for values this app calculates (not official NJ figures).
struct Est: View {
    var body: some View {
        Text("est.")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityLabel("estimate")
    }
}

/// Banner explaining how fresh the data is; warns when stale or offline.
struct DataStatusBanner: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        if let s = store.status {
            let stale = store.isStale
            HStack(spacing: 8) {
                Image(systemName: stale || store.isOffline ? "exclamationmark.triangle.fill" : "checkmark.seal.fill")
                    .foregroundStyle(stale || store.isOffline ? .orange : .green)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(stale ? "Data may be out of date" : "Official NJ data")
                        .font(.footnote.weight(.semibold))
                    Text("Verified with njlottery.com \(Format.relative(s.lastVerifiedAt))\(store.isOffline ? " · offline copy" : "")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}

struct StatRow: View {
    let label: String
    let value: String
    var detail: String? = nil
    var estimated = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                // One Text, so "est." wraps with the label instead of floating beside it.
                (Text(label) + (estimated ? Text(" est.").font(.caption2.weight(.semibold)).foregroundColor(.secondary) : Text("")))
                    .accessibilityLabel(estimated ? "\(label), estimate" : label)
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 12)
            Text(value).font(.body.weight(.semibold)).monospacedDigit().multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

struct GameRow: View {
    let game: Game
    var showStar = true

    var body: some View {
        HStack(spacing: 12) {
            if showStar { StarButton(gameId: game.gameId, name: game.name) }
            VStack(alignment: .leading, spacing: 3) {
                Text(game.name).font(.headline).lineLimit(1)
                Text("\(Format.money(game.priceCents)) · #\(game.gameNumber) · top \(game.topPrize.label)")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text("\(Image(systemName: "trophy")) \(game.topPrize.remaining)/\(game.topPrize.original) top   \(Image(systemName: "chart.line.uptrend.xyaxis")) \(Format.pct(game.currentReturn, digits: 0)) est. return")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(game.topPrize.remaining) of \(game.topPrize.original) top prizes left, estimated return \(Format.pct(game.currentReturn, digits: 0))")
            }
            Spacer(minLength: 4)
            ScoreBadge(score: game.score)
        }
        .padding(.vertical, 2)
    }
}

struct EmptyState: View {
    let title: String
    let message: String
    var systemImage = "tray"

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text(message))
    }
}
