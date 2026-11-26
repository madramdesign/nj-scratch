import SwiftUI

enum RankingSort: String, CaseIterable, Identifiable {
    case score = "Overall score"
    case expectedReturn = "Estimated return"
    case topPrize = "Top-prize odds vs. launch"
    case profitOdds = "Odds of winning more than cost"
    case priceLow = "Price: low to high"
    case priceHigh = "Price: high to low"
    var id: String { rawValue }

    func sorted(_ games: [Game]) -> [Game] {
        // Missing values sort last.
        func by(_ key: (Game) -> Double?, ascending: Bool = false) -> [Game] {
            games.sorted { a, b in
                switch (key(a), key(b)) {
                case let (x?, y?): return ascending ? x < y : x > y
                case (_?, nil): return true
                default: return false
                }
            }
        }
        switch self {
        case .score: return by { $0.score.score }
        case .expectedReturn: return by { $0.currentReturn }
        case .topPrize: return by { $0.topRetention }
        case .profitOdds: return by { $0.currentOddsProfitOneIn.map { 1 / $0 } }
        case .priceLow: return by({ Double($0.priceCents) }, ascending: true)
        case .priceHigh: return by { Double($0.priceCents) }
        }
    }
}

struct RankingsView: View {
    @Environment(DataStore.self) private var store
    @State private var price: Int? = nil
    @State private var sort: RankingSort = .score
    @State private var search = ""
    @State private var hideNoTopPrize = false

    private var prices: [Int] { Array(Set(store.games.map(\.priceCents))).sorted() }

    private var shown: [Game] {
        var g = store.games
        if let price { g = g.filter { $0.priceCents == price } }
        if hideNoTopPrize { g = g.filter { $0.topPrize.remaining > 0 } }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "#", with: "")
        if !q.isEmpty { g = g.filter { $0.name.lowercased().contains(q) || $0.gameNumber.contains(q) || $0.gameId == q } }
        return sort.sorted(g)
    }

    var body: some View {
        List {
            Section {
                DataStatusBanner()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        PriceChip(title: "All prices", selected: price == nil) { price = nil }
                        ForEach(prices, id: \.self) { p in
                            PriceChip(title: Format.money(p), selected: price == p) { price = p }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            }
            Section {
                if store.games.isEmpty {
                    if store.isLoading {
                        HStack { Spacer(); ProgressView("Loading official data…"); Spacer() }.padding(.vertical, 30)
                    } else {
                        EmptyState(title: "No data yet", message: store.error ?? "Pull down to load the latest official data.", systemImage: "wifi.exclamationmark")
                    }
                } else if shown.isEmpty {
                    EmptyState(title: "No matching games", message: "Try another price or search.", systemImage: "magnifyingglass")
                } else {
                    ForEach(shown) { g in
                        NavigationLink(value: g.gameId) { GameRow(game: g) }
                    }
                }
            } header: {
                if !store.games.isEmpty {
                    Text("\(shown.count) of \(store.games.count) active games · \(sort.rawValue)")
                }
            } footer: {
                Text("Scores compare each game’s remaining official prizes with the other active games. They are not predictions; every game returns less than it costs on average.")
            }
        }
        .navigationTitle("Rankings")
        .navigationDestination(for: String.self) { GameDetailView(gameId: $0) }
        .searchable(text: $search, prompt: "Game name or number")
        .refreshable { await store.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(RankingSort.allCases) { Text($0.rawValue).tag($0) }
                    }
                    Toggle("Hide games with no top prize left", isOn: $hideNoTopPrize)
                } label: {
                    Label("Sort and filter", systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
    }
}

struct PriceChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(selected ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.12), in: Capsule())
                .foregroundStyle(selected ? Color.accentColor : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
