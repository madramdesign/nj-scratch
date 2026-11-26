import SwiftUI

@main
struct NJScratchApp: App {
    @State private var store = DataStore()
    @State private var watchlist = Watchlist()
    @AppStorage("acknowledgedNotice.v1") private var acknowledged = false

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(watchlist)
                .fullScreenCover(isPresented: .constant(!acknowledged)) {
                    NoticeView { acknowledged = true }
                }
                .task { await store.refresh() }
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            NavigationStack { RankingsView() }
                .tabItem { Label("Rankings", systemImage: "list.number") }
            NavigationStack { CalendarView() }
                .tabItem { Label("Calendar", systemImage: "calendar") }
            NavigationStack { ChangesView() }
                .tabItem { Label("Changes", systemImage: "bell") }
            NavigationStack { WatchlistView() }
                .tabItem { Label("Watchlist", systemImage: "star") }
            NavigationStack { AboutView() }
                .tabItem { Label("About", systemImage: "info.circle") }
        }
    }
}

/// Shown once before first use: what the app is, what it isn't, age requirement and the helpline.
struct NoticeView: View {
    let onContinue: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "ticket")
                    .font(.system(size: 44))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text("NJ Scratch")
                    .font(.largeTitle.bold())
                Text("Analysis of official New Jersey Lottery remaining-prize data for active scratch-off games.")
                    .font(.title3)
                VStack(alignment: .leading, spacing: 10) {
                    Label("Scratch-offs are gambling. Every game returns less than it costs on average.", systemImage: "exclamationmark.triangle")
                    Label("Rankings describe official data. They are not predictions, and a high score doesn't mean a ticket is likely to win.", systemImage: "chart.bar")
                    Label("You must be 18 or older to buy New Jersey Lottery tickets.", systemImage: "person.badge.shield.checkmark")
                    Label("Not affiliated with or endorsed by the New Jersey Lottery.", systemImage: "building.columns")
                }
                .font(.callout)
                GamblerHelpLink()
                Button(action: onContinue) {
                    Text("I’m 18 or older, continue").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity)
        }
        .interactiveDismissDisabled()
    }
}

struct GamblerHelpLink: View {
    var body: some View {
        Link(destination: URL(string: "tel:18004262537")!) {
            Label("If gambling is a problem, call 1-800-GAMBLER", systemImage: "phone")
                .font(.callout.weight(.semibold))
        }
    }
}
