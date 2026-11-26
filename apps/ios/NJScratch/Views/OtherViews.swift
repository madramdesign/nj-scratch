import SwiftUI

struct CalendarView: View {
    @Environment(DataStore.self) private var store
    @State private var data: CalendarResponse?
    @State private var error: String?

    var body: some View {
        List {
            if let d = data {
                Section {
                    if d.upcoming.isEmpty {
                        Text("No announced games with a future launch date.").foregroundStyle(.secondary)
                    }
                    ForEach(d.upcoming) { g in
                        ExternalRow(url: officialURL(gameId: g.gameId)) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(g.name).font(.headline).foregroundStyle(.primary)
                                    Spacer()
                                    Text(Format.money(g.priceCents)).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                }
                                Text("Launches \(Format.date(g.launchDate)) · \(Format.inDays(Int(((g.launchDate - d.now) / 86_400_000).rounded(.up))))")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text("\(g.topPrizeOriginal) × \(g.topPrizeLabel) top · return at launch \(Format.pct(g.launchReturn)) · \(Format.odds(g.oddsAnyOneIn))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Coming soon")
                } footer: {
                    Text("Return at launch is exact, from the official print run.")
                }

                Section("Next to stop selling") {
                    ForEach(d.salesEnding.prefix(10)) { g in
                        NavigationLink(value: g.gameId) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(g.name).font(.headline)
                                Text("\(Format.money(g.priceCents)) · sales end \(Format.date(g.salesEndDate)) (\(Format.inDays(g.daysLeft))) · \(g.topPrizeRemaining) of \(g.topPrizeOriginal) top prizes left")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    let upcoming = d.claimDeadlines.filter { $0.daysLeft >= 0 }.prefix(25)
                    if upcoming.isEmpty { Text("No claim deadlines coming up.").foregroundStyle(.secondary) }
                    ForEach(Array(upcoming)) { g in
                        ExternalRow(url: officialURL(gameId: g.gameId)) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(g.name).font(.headline).foregroundStyle(.primary)
                                    Spacer()
                                    Text(Format.money(g.priceCents)).font(.subheadline).foregroundStyle(.primary)
                                }
                                Text("Last day to claim \(Format.date(g.lastDayToClaim)) (\(Format.inDays(g.daysLeft)))").font(.subheadline).foregroundStyle(.secondary)
                                Text("Sales ended \(Format.date(g.salesEndedOn)) · \(g.topPrizeRemaining) of \(g.topPrizeOriginal) top prizes (\(g.topPrizeLabel)) not yet claimed")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Last day to claim prizes")
                } footer: {
                    Text("Claim deadlines aren’t printed on tickets. “Not yet claimed” includes prizes that were never sold, so it doesn’t mean a winning ticket is out there.")
                }
            } else if let error {
                EmptyState(title: "Calendar unavailable", message: error, systemImage: "calendar.badge.exclamationmark")
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 30)
            }
        }
        .navigationTitle("Launches & Deadlines")
        .navigationDestination(for: String.self) { GameDetailView(gameId: $0) }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            data = try await store.calendar()
            error = nil
        } catch DataStore.FetchError.notFound {
            error = "The calendar appears after the next website update."
        } catch {
            if data == nil { self.error = error.localizedDescription }
        }
    }
}

struct ChangesView: View {
    @Environment(DataStore.self) private var store
    @State private var events: [ChangeEvent] = []
    @State private var error: String?
    @State private var loaded = false

    private var grouped: [(day: Date, events: [ChangeEvent])] {
        let cal = Calendar.current
        let groups = Dictionary(grouping: events.prefix(300)) { cal.startOfDay(for: $0.date) }
        return groups.map { ($0.key, $0.value) }.sorted { $0.day > $1.day }
    }

    var body: some View {
        List {
            if !loaded {
                HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 30)
            } else if events.isEmpty {
                EmptyState(title: "No changes yet", message: error ?? "Notable changes appear after each update.", systemImage: "bell.slash")
            }
            ForEach(grouped, id: \.day) { group in
                Section(group.day.formatted(date: .complete, time: .omitted)) {
                    ForEach(group.events) { e in
                        EventRow(event: e)
                    }
                }
            }
        }
        .navigationTitle("Changes")
        .navigationDestination(for: String.self) { GameDetailView(gameId: $0) }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            events = try await store.notableChanges()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

struct EventRow: View {
    @Environment(DataStore.self) private var store
    let event: ChangeEvent

    private var icon: (String, Color) {
        switch event.kind {
        case "top_prize_claimed": return ("trophy", .orange)
        case "top_prize_sold_out": return ("trophy.slash", .red)
        case "major_prize_claimed": return ("dollarsign.circle", .orange)
        case "score_changed": return ("chart.line.uptrend.xyaxis", .blue)
        case "game_added": return ("sparkles", .green)
        case "game_announced": return ("calendar.badge.plus", .green)
        case "structure_changed": return ("exclamationmark.triangle", .yellow)
        default: return ("circle", .secondary)
        }
    }

    var body: some View {
        let content = HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon.0).foregroundStyle(icon.1).frame(width: 22).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let name = event.game_name, !event.message.contains(name) {
                    Text("\(name)\(event.price_cents.map { " (\(Format.money($0)))" } ?? "")").font(.subheadline.weight(.semibold))
                }
                Text(event.message).font(.subheadline)
            }
        }
        if store.game(event.game_id) != nil {
            NavigationLink(value: event.game_id) { content }
        } else {
            content
        }
    }
}

struct WatchlistView: View {
    @Environment(DataStore.self) private var store
    @Environment(Watchlist.self) private var watchlist
    @State private var events: [ChangeEvent] = []

    var body: some View {
        List {
            if watchlist.ids.isEmpty {
                EmptyState(title: "No games tracked", message: "Tap the star on any game to track it here. Your watchlist stays on this device.", systemImage: "star")
            } else {
                Section("Tracked games") {
                    ForEach(watchlist.ids, id: \.self) { id in
                        if let g = store.game(id) {
                            NavigationLink(value: id) { GameRow(game: g) }
                        } else {
                            HStack {
                                StarButton(gameId: id, name: "game \(id)")
                                Text("Game #\(id) is no longer on sale").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                let mine = events.filter { watchlist.contains($0.game_id) }.prefix(30)
                Section("Recent notable changes") {
                    if mine.isEmpty { Text("None yet. Top and major prize claims and big score moves appear here.").foregroundStyle(.secondary) }
                    ForEach(Array(mine)) { e in
                        VStack(alignment: .leading, spacing: 2) {
                            EventRow(event: e)
                            Text(e.date.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(.secondary).padding(.leading, 32)
                        }
                    }
                }
            }
        }
        .navigationTitle("Watchlist")
        .navigationDestination(for: String.self) { GameDetailView(gameId: $0) }
        .task { events = (try? await store.notableChanges()) ?? [] }
        .refreshable {
            await store.refresh()
            events = (try? await store.notableChanges()) ?? events
        }
    }
}

struct AboutView: View {
    @Environment(DataStore.self) private var store

    var body: some View {
        List {
            Section {
                DataStatusBanner()
                if let s = store.status {
                    StatRow(label: "Active games", value: "\(s.activeGames)")
                    StatRow(label: "Data as of", value: Format.date(s.dataAsOf))
                    ForEach(s.warnings, id: \.self) { Text($0).font(.footnote).foregroundStyle(.orange) }
                }
                Button("Refresh now") { Task { await store.refresh() } }
                    .disabled(store.isLoading)
            } header: {
                Text("Data")
            } footer: {
                Text("Data comes from the official NJ Lottery instant-games API and is checked about every 6 hours.")
            }

            Section("How games are scored") {
                Text("Each active game gets a 0–100 score from five parts, each compared with the other active games: estimated return per $1 (35%), top prizes left relative to tickets sold (20%), major prizes left relative to tickets sold (20%), chance of winning more than the ticket cost (15%), and prize value left relative to tickets sold (10%). Games with no top prize left are capped at 40.")
                Text("Tickets remaining is estimated from how many small, retailer-paid prizes have been paid. Prizes won but not yet claimed still count as remaining.")
                Link("Full methodology", destination: store.baseURL.appendingPathComponent("methodology"))
            }

            Section("Responsible play") {
                Text("Scratch-off tickets are gambling. The lottery keeps a house edge, so every game returns less than it costs on average. Rankings describe official data; they are not predictions or advice.")
                Text("You must be 18 or older to buy New Jersey Lottery tickets.")
                GamblerHelpLink()
                Link("NJ Council on Compulsive Gambling", destination: URL(string: "https://www.800gambler.org")!)
            }

            Section {
                Link("Official NJ Lottery scratch-offs", destination: URL(string: "https://www.njlottery.com/en-us/scratch-offs.html#tab-active")!)
                Link("Website version", destination: store.baseURL)
            } footer: {
                Text("Not affiliated with or endorsed by the New Jersey Lottery. No account, no tracking: your watchlist stays on this device.")
            }
        }
        .navigationTitle("About")
    }
}

/// A row that opens an external page (njlottery.com): normal text colors plus an outbound-arrow indicator.
struct ExternalRow<Content: View>: View {
    let url: URL
    @ViewBuilder let content: () -> Content

    var body: some View {
        Link(destination: url) {
            HStack(alignment: .center, spacing: 8) {
                content()
                Image(systemName: "arrow.up.right.square")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .accessibilityLabel("Opens njlottery.com")
            }
        }
        .tint(.primary)
    }
}
