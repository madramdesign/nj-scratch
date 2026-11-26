import Charts
import SwiftUI

struct GameDetailView: View {
    @Environment(DataStore.self) private var store
    let gameId: String
    @State private var detail: GameDetailResponse?
    @State private var history: [HistoryPoint] = []
    @State private var error: String?

    var body: some View {
        Group {
            if let g = detail?.game ?? nil {
                content(g)
            } else if let error {
                EmptyState(title: "Couldn’t load this game", message: error, systemImage: "exclamationmark.triangle")
            } else if let reason = detail?.notRankedReason {
                EmptyState(title: "Not ranked", message: reason, systemImage: "info.circle")
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(store.game(gameId)?.name ?? detail?.game?.name ?? "Game")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let g = store.game(gameId) ?? detail?.game {
                ToolbarItem(placement: .topBarTrailing) { StarButton(gameId: g.gameId, name: g.name) }
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: officialURL(gameId: g.gameId), subject: Text(g.name)) { Label("Share", systemImage: "square.and.arrow.up") }
                }
            }
        }
        .task(id: gameId) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            detail = try await store.detail(gameId)
            error = nil
        } catch {
            if detail == nil { self.error = error.localizedDescription }
        }
        history = (try? await store.history(gameId).points) ?? history
    }

    @ViewBuilder
    private func content(_ g: Game) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(g.name).font(.title2.bold())
                            Text("Game #\(g.gameNumber) · \(Format.money(g.priceCents)) ticket")
                                .font(.subheadline).foregroundStyle(.secondary)
                            Text("Top prize \(g.topPrize.label)\(g.topPrize.kind == "annuity" ? " (cash value \(Format.money(g.topPrize.cashCents)))" : "")")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        ScoreBadge(score: g.score, large: true)
                    }
                    Text(g.explanation.headline).font(.headline)
                    if let rank = g.score.rank {
                        Text("Ranks #\(rank) of all active games\(g.score.rankInPrice.map { " and #\($0) of \(g.score.peersInPrice ?? 0) \(Format.money(g.priceCents)) games" } ?? ""). This describes the remaining official prize data; it is not a prediction that a ticket will win.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                ForEach(g.explanation.strengths, id: \.self) { Label($0, systemImage: "plus.circle").foregroundStyle(.primary).font(.subheadline) }
                ForEach(g.explanation.weaknesses, id: \.self) { Label($0, systemImage: "minus.circle").font(.subheadline) }
                ForEach(g.warnings, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange) }
            }

            let alts = Alternatives.samePrice(for: store.game(g.gameId) ?? g, in: store.games)
            if !alts.isEmpty {
                Section("Other \(Format.money(g.priceCents)) games with a stronger profile") {
                    ForEach(alts) { a in
                        NavigationLink(value: a.game.gameId) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack { Text(a.game.name).font(.headline); Spacer(); ScoreBadge(score: a.game.score) }
                                Text(a.reasons.joined(separator: "; ") + ".").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            Section("Key numbers") {
                StatRow(label: "Top prizes remaining", value: "\(Format.integer(g.topPrize.remaining)) of \(Format.integer(g.topPrize.original))", detail: Format.pct(g.topPrize.pctRemaining))
                if g.major.tierCount > 0 {
                    StatRow(label: "\(Format.moneyCompact(g.major.thresholdCents))+ prizes remaining", value: "\(Format.integer(g.major.remaining)) of \(Format.integer(g.major.original))", detail: Format.pct(g.major.pctRemaining))
                }
                StatRow(label: "All prizes remaining", value: "\(Format.integer(g.allPrizes.remaining)) of \(Format.integer(g.allPrizes.original))", detail: Format.pct(g.allPrizes.pctRemaining))
                StatRow(label: "Prize value remaining", value: Format.moneyCompact(g.allPrizes.valueRemainingCents), detail: "of \(Format.moneyCompact(g.allPrizes.valueOriginalCents)) at launch")
                if g.tickets.available {
                    StatRow(label: "Tickets remaining", value: "~" + Format.integer(g.tickets.ticketsRemaining), detail: "\(Format.pct(g.tickets.remainingFraction, digits: 0)) of \(Format.integer(g.totalTicketsPrinted)) printed\(g.tickets.confidence == "low" ? " · low confidence" : "")", estimated: true)
                } else {
                    StatRow(label: "Tickets remaining", value: "Insufficient data", detail: g.tickets.reason)
                }
                StatRow(label: "Top-prize odds vs. launch", value: Format.retention(g.topRetention), detail: "now \(g.topPrize.remaining > 0 ? Format.odds(g.currentOddsTopOneIn) : "none left") · launch \(Format.odds(g.originalOddsTopOneIn))", estimated: true)
                StatRow(label: "Odds of any prize", value: Format.odds(g.currentOddsAnyOneIn), detail: "at launch \(Format.odds(g.originalOddsAnyOneIn))", estimated: true)
                StatRow(label: "Odds of winning more than cost", value: Format.odds(g.currentOddsProfitOneIn), detail: "at launch \(Format.odds(g.originalOddsProfitOneIn))", estimated: true)
            }

            Section {
                StatRow(label: "Expected value", value: Format.money(g.currentEvCents, decimals: true), detail: "at launch \(Format.money(g.originalEvCents, decimals: true)) (exact)", estimated: true)
                StatRow(label: "Expected return", value: Format.pct(g.currentReturn), estimated: true)
                StatRow(label: "Expected loss per ticket", value: Format.money(g.expectedLossCents, decimals: true), estimated: true)
            } header: {
                Text("Break-even")
            } footer: {
                Text("Averages over the estimated remaining tickets, not a guarantee. Free tickets are valued as another play; annuity prizes use NJ’s cash value. Prizes won but not yet claimed still count as remaining, which can overstate the return.")
            }

            SessionOddsSection(game: g)

            if !history.isEmpty { HistorySection(points: history) }

            if let tiers = g.tiers {
                Section {
                    ForEach(tiers) { t in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(t.description).font(.subheadline.weight(t.isTop ? .bold : .regular))
                                    if t.isTop { Tag("top") } else if t.isMajor { Tag("major") }
                                    if t.kind == "free_ticket" { Tag("free ticket") }
                                    if t.kind == "annuity" { Tag("annuity") }
                                }
                                Text("now \(Format.odds(t.currentOddsOneIn)) · launch \(Format.odds(t.originalOddsOneIn))")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(Format.integer(t.remaining)) / \(Format.integer(t.original))").font(.subheadline.weight(.semibold)).monospacedDigit()
                                Text(Format.pct(t.pctRemaining, digits: 0) + " left").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text("Prize table")
                } footer: {
                    Text("Remaining counts use NJ Lottery’s formula: prizes of $600+ subtract claim-center claims; smaller prizes subtract paid tickets.")
                }
            }

            Section("Score breakdown") {
                ForEach(g.score.components) { c in
                    StatRow(label: c.label, value: String(format: "%.1f pts", c.contribution),
                            detail: "\(c.rawFormatted ?? "n/a") · percentile \(c.percentile.map { String(Int($0.rounded())) } ?? "n/a") · weight \(Format.pct(c.effectiveWeight, digits: 0))")
                }
                ForEach(g.score.notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
            }

            if let events = detail?.events.filter({ $0.severity != "info" }), !events.isEmpty {
                Section("Notable changes") {
                    ForEach(events.prefix(20)) { e in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.message).font(.subheadline)
                            Text(e.date.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Link(destination: officialURL(gameId: g.gameId)) { Label("View on njlottery.com", systemImage: "safari") }
            } footer: {
                Text("Source: official NJ Lottery data. Values marked est. are this app’s calculations.")
            }
        }
    }
}

private struct Tag: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(.secondary)
    }
}

/// "If you buy several tickets": exact chances next to the expected loss.
struct SessionOddsSection: View {
    let game: Game
    @State private var n = 1
    private let counts = [1, 2, 3, 5, 10, 20]

    var body: some View {
        Section {
            if let r = SessionOdds.compute(for: game, n: n) {
                Picker("Tickets", selection: $n) {
                    ForEach(counts, id: \.self) { Text("\($0)").tag($0) }
                }
                .pickerStyle(.segmented)
                StatRow(label: "You spend", value: Format.money(Double(r.costCents), decimals: true))
                StatRow(label: "Expected loss", value: Format.money(r.expectedLossCents, decimals: true), detail: "average over many plays")
                StatRow(label: "Win back more than you spend", value: Format.chance(r.pNetProfit))
                StatRow(label: "Win back at least what you spend", value: Format.chance(r.pBreakEvenOrBetter))
                StatRow(label: "At least one prize of any size", value: Format.chance(r.pAnyPrize), detail: "includes free tickets")
                StatRow(label: "Every ticket loses", value: Format.chance(r.pAllLose))
                ForEach(r.thresholds) { th in
                    StatRow(label: "At least one prize of \(th.label)", value: Format.chance(th.probability))
                }
            } else {
                Text(game.tickets.reason ?? "Not enough data to estimate tickets remaining.").foregroundStyle(.secondary)
            }
        } header: {
            HStack(spacing: 4) { Text("If you buy several tickets"); Est() }
        } footer: {
            Text("From the official remaining prize counts and the estimated tickets left. A free ticket counts as getting the price back. More tickets raise the chance of some prize, and the expected loss rises with every ticket.")
        }
    }
}

struct HistorySection: View {
    let points: [HistoryPoint]

    var body: some View {
        Section {
            if points.count < 2 {
                Text("History appears once the official data changes.").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Overall score").font(.subheadline.weight(.semibold))
                    Chart(points.filter { $0.score != nil }) { p in
                        LineMark(x: .value("Date", p.date), y: .value("Score", p.score ?? 0))
                        PointMark(x: .value("Date", p.date), y: .value("Score", p.score ?? 0)).symbolSize(18)
                    }
                    .chartYScale(domain: 0...100)
                    .frame(height: 140)
                    .accessibilityLabel("Score history")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Top prizes remaining").font(.subheadline.weight(.semibold))
                    Chart(points) { p in
                        LineMark(x: .value("Date", p.date), y: .value("Top prizes", p.top_remaining)).interpolationMethod(.stepEnd)
                    }
                    .chartYScale(domain: 0...max(1, points.map(\.top_original).max() ?? 1))
                    .frame(height: 120)
                    .accessibilityLabel("Top prizes remaining over time")
                }
            }
        } header: {
            Text("History")
        } footer: {
            let archived = points.filter { $0.source_key == "internet-archive" }.count
            Text("\(points.count) snapshots from \(points.first.map { $0.date.formatted(date: .abbreviated, time: .omitted) } ?? "—")\(archived > 0 ? "; \(archived) from Internet Archive captures of the official API" : "").")
        }
    }
}
