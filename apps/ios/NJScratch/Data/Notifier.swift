import BackgroundTasks
import Foundation
import Observation
import UserNotifications

/// A local notification to post, derived from a change event.
struct PlannedNotification: Equatable {
    let id: String
    let title: String
    let body: String
    let gameId: String?
}

/// Pure selection logic: which new change events become notifications. Kept free of iOS APIs so it's unit-tested.
enum NotificationSelector {
    /// Event kinds worth a notification for a starred game. Profile changes ("average → weak") are included;
    /// raw score moves are not, because each profile change already comes with one and they'd double up.
    static let starredKinds: Set<String> = ["top_prize_claimed", "top_prize_sold_out", "major_prize_claimed", "game_added"]

    static func select(events: [ChangeEvent], watched: Set<String>, after: Double, includeAnnouncements: Bool, limit: Int = 5) -> [PlannedNotification] {
        let fresh = events
            .filter { $0.observed_at > after }
            .filter { e in
                if e.kind == "game_announced" { return includeAnnouncements }
                guard watched.contains(e.game_id) else { return false }
                return starredKinds.contains(e.kind) || (e.kind == "score_changed" && e.message.hasPrefix("Profile changed"))
            }
            .sorted { ($0.observed_at, $0.id) < ($1.observed_at, $1.id) }
        let notes = fresh.map { e -> PlannedNotification in
            let title: String
            if e.kind == "game_announced" {
                title = "New game announced"
            } else {
                title = (e.game_name ?? "Game \(e.game_id)") + (e.price_cents.map { " (\(Format.money($0)))" } ?? "")
            }
            return PlannedNotification(id: "event-\(e.id)", title: title, body: e.message, gameId: e.kind == "game_announced" ? nil : e.game_id)
        }
        guard notes.count > limit else { return notes }
        // Keep it calm: a few individual notifications, then one summary.
        let shown = Array(notes.suffix(limit - 1))
        let rest = notes.count - shown.count
        return shown + [PlannedNotification(id: "summary-\(fresh.last!.id)", title: "NJ Scratch", body: "\(rest) more updates. Open NJ Scratch to see them in Changes.", gameId: nil)]
    }

    /// The newest event time in a batch: the next check only looks at events after it.
    static func newestTime(_ events: [ChangeEvent]) -> Double? { events.map(\.observed_at).max() }
}

/// Notification settings, background refresh scheduling, and the check itself.
@MainActor
@Observable
final class Notifier {
    static let shared = Notifier()
    static let refreshTaskId = "com.madramdesign.NJScratch.refresh"

    private let defaults = UserDefaults.standard
    private enum Key {
        static let starred = "notify.starred.v1"
        static let announcements = "notify.announcements.v1"
        static let lastSeen = "notify.lastSeenEventAt.v1"
    }

    var notifyStarred: Bool {
        didSet { defaults.set(notifyStarred, forKey: Key.starred); if notifyStarred { scheduleRefresh() } }
    }
    var notifyAnnouncements: Bool {
        didSet { defaults.set(notifyAnnouncements, forKey: Key.announcements); if notifyAnnouncements { scheduleRefresh() } }
    }
    private(set) var authorization: UNAuthorizationStatus = .notDetermined

    var isEnabled: Bool { notifyStarred || notifyAnnouncements }

    private init() {
        notifyStarred = defaults.bool(forKey: Key.starred)
        notifyAnnouncements = defaults.bool(forKey: Key.announcements)
    }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Asks for permission the first time a toggle is switched on. Returns whether notifications are allowed.
    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshAuthorization()
        return granted
    }

    func scheduleRefresh() {
        guard isEnabled else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3 * 3600) // the site updates about every 6 hours
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Fetches notable changes and posts notifications for anything new since the last check.
    /// The first check only records where we are, so turning notifications on never floods old events.
    @discardableResult
    func check(store: DataStore, watched: Set<String>, lookback: TimeInterval? = nil) async -> Int {
        guard isEnabled else { return 0 }
        guard let events = try? await store.notableChanges() else { return 0 }
        let newest = NotificationSelector.newestTime(events)
        var after = defaults.double(forKey: Key.lastSeen)
        if let lookback { after = Date().addingTimeInterval(-lookback).timeIntervalSince1970 * 1000 }
        if after == 0 {
            if let newest { defaults.set(newest, forKey: Key.lastSeen) }
            return 0
        }
        let planned = NotificationSelector.select(events: events, watched: notifyStarred ? watched : [], after: after, includeAnnouncements: notifyAnnouncements)
        let center = UNUserNotificationCenter.current()
        for n in planned {
            let content = UNMutableNotificationContent()
            content.title = n.title
            content.body = n.body
            content.sound = .default
            if let gameId = n.gameId { content.userInfo = ["gameId": gameId] }
            try? await center.add(UNNotificationRequest(identifier: n.id, content: content, trigger: nil))
        }
        if let newest, newest > defaults.double(forKey: Key.lastSeen) { defaults.set(newest, forKey: Key.lastSeen) }
        return planned.count
    }

    /// Called when the user turns notifications on: start from the current data, not from the past.
    func markCaughtUp(store: DataStore) async {
        if let events = try? await store.notableChanges(), let newest = NotificationSelector.newestTime(events) {
            defaults.set(newest, forKey: Key.lastSeen)
        }
    }
}

/// Which tab is showing and which game is open in Rankings, so a notification tap can open a game.
@MainActor
@Observable
final class Router {
    static let shared = Router()
    enum Tab: Hashable { case rankings, calendar, changes, watchlist, about }
    var tab: Tab = .rankings
    var rankingsPath: [String] = []

    func open(gameId: String) {
        tab = .rankings
        rankingsPath = [gameId]
    }
}
