import Foundation
import Observation

/// Loads the JSON the website publishes on GitHub Pages and keeps the last good copy on disk, so the app
/// opens instantly and still works offline (clearly labeled with the data's age).
@MainActor
@Observable
final class DataStore {
    /// Live site by default. For development, set the `NJ_BASE_URL` environment variable in the scheme
    /// (e.g. http://localhost:4173/nj-scratch/ for `vite preview` of the static build).
    static let defaultBaseURL = URL(string: "https://madramdesign.github.io/nj-scratch/")!

    let baseURL: URL
    private(set) var games: [Game] = []
    private(set) var status: DataStatus?
    private(set) var isLoading = false
    private(set) var error: String?
    /// True when what's shown came from the on-disk copy because the network request failed.
    private(set) var isOffline = false

    private let session: URLSession
    private let cacheDir: URL
    private let decoder = JSONDecoder()

    init(baseURL: URL? = nil, session: URLSession = .shared) {
        let env = ProcessInfo.processInfo.environment["NJ_BASE_URL"].flatMap(URL.init(string:))
        self.baseURL = baseURL ?? env ?? Self.defaultBaseURL
        self.session = session
        cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("api", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        if let cached: GamesResponse = try? readCache("games.json") {
            games = cached.games
            status = cached.status
        }
    }

    /// Data is flagged stale when it hasn't been verified against njlottery.com for 36 hours (same as the site).
    var isStale: Bool {
        guard let verified = status?.lastVerifiedAt else { return true }
        return Date().timeIntervalSince(Date(milliseconds: verified)) > 36 * 3600
    }

    func game(_ id: String) -> Game? { games.first { $0.gameId == id } }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let r: GamesResponse = try await fetch("games.json")
            games = r.games
            status = r.status
            error = nil
            isOffline = false
        } catch {
            self.error = error.localizedDescription
            isOffline = !games.isEmpty
        }
    }

    func detail(_ id: String) async throws -> GameDetailResponse { try await fetch("games/\(id).json") }
    func history(_ id: String) async throws -> HistoryResponse { try await fetch("games/\(id)/history.json") }
    func calendar() async throws -> CalendarResponse { try await fetch("calendar.json") }

    /// Notable changes; falls back to filtering the general change list on sites built before the notable export existed.
    func notableChanges() async throws -> [ChangeEvent] {
        do {
            let r: ChangesResponse = try await fetch("changes-notable.json")
            return r.events
        } catch FetchError.notFound {
            let r: ChangesResponse = try await fetch("changes.json")
            return r.events.filter { $0.severity != "info" }
        }
    }

    enum FetchError: LocalizedError {
        case notFound
        case http(Int)
        var errorDescription: String? {
            switch self {
            case .notFound: return "This data isn't published yet."
            case .http(let code): return "The server returned HTTP \(code)."
            }
        }
    }

    /// Network first; on failure, the last good copy from disk.
    private func fetch<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent("api").appendingPathComponent(path)
        do {
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadRevalidatingCacheData
            req.timeoutInterval = 20
            let (data, response) = try await session.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 200
            if code == 404 { throw FetchError.notFound }
            guard (200..<300).contains(code) else { throw FetchError.http(code) }
            let value = try decoder.decode(T.self, from: data)
            try? data.write(to: cacheFile(path), options: .atomic)
            return value
        } catch FetchError.notFound {
            throw FetchError.notFound
        } catch {
            if let cached: T = try? readCache(path) { return cached }
            throw error
        }
    }

    private func cacheFile(_ path: String) -> URL {
        cacheDir.appendingPathComponent(path.replacingOccurrences(of: "/", with: "__"))
    }

    private func readCache<T: Decodable>(_ path: String) throws -> T {
        try decoder.decode(T.self, from: Data(contentsOf: cacheFile(path)))
    }
}

/// Starred games, stored on this device only.
@MainActor
@Observable
final class Watchlist {
    private static let key = "watchlist.v1"
    private(set) var ids: [String]

    init() {
        ids = UserDefaults.standard.stringArray(forKey: Self.key) ?? []
    }

    func contains(_ id: String) -> Bool { ids.contains(id) }

    func toggle(_ id: String) {
        if let i = ids.firstIndex(of: id) { ids.remove(at: i) } else { ids.insert(id, at: 0) }
        UserDefaults.standard.set(ids, forKey: Self.key)
    }
}
