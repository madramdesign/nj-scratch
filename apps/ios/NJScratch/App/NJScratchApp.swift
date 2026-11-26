import SwiftUI
import UserNotifications

/// Shows notifications while the app is open and opens the game when one is tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        await MainActor.run {
            if let gameId = info["gameId"] as? String { Router.shared.open(gameId: gameId) } else { Router.shared.tab = .changes }
        }
    }
}

@main
struct NJScratchApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = DataStore()
    @State private var watchlist = Watchlist()
    @State private var notifier = Notifier.shared
    @State private var router = Router.shared
    @AppStorage("acknowledgedNotice.v1") private var acknowledged = false

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(watchlist)
                .environment(notifier)
                .environment(router)
                .fullScreenCover(isPresented: .constant(!acknowledged)) {
                    NoticeView { acknowledged = true }
                }
                .task { await store.refresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { notifier.scheduleRefresh() }
        }
        // iOS runs this when it grants background time (roughly every few hours, at its discretion).
        .backgroundTask(.appRefresh(Notifier.refreshTaskId)) {
            await MainActor.run { Notifier.shared.scheduleRefresh() }
            let (store, watched) = await MainActor.run { (DataStore(), Set(Watchlist().ids)) }
            await Notifier.shared.check(store: store, watched: watched)
        }
    }
}

struct RootView: View {
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            NavigationStack(path: $router.rankingsPath) { RankingsView() }
                .tabItem { Label("Rankings", systemImage: "list.number") }
                .tag(Router.Tab.rankings)
            NavigationStack { CalendarView() }
                .tabItem { Label("Calendar", systemImage: "calendar") }
                .tag(Router.Tab.calendar)
            NavigationStack { ChangesView() }
                .tabItem { Label("Changes", systemImage: "bell") }
                .tag(Router.Tab.changes)
            NavigationStack { WatchlistView() }
                .tabItem { Label("Watchlist", systemImage: "star") }
                .tag(Router.Tab.watchlist)
            NavigationStack { AboutView() }
                .tabItem { Label("About", systemImage: "info.circle") }
                .tag(Router.Tab.about)
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
