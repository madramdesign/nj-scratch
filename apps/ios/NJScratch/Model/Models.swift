import Foundation

// Decodable mirrors of the JSON the website publishes under <site>/api/ (see apps/api/src/export-static.ts).
// Only the fields the app uses are declared; anything else in the JSON is ignored.
// Money is integer cents unless noted; timestamps are epoch milliseconds.

struct GamesResponse: Decodable {
    let status: DataStatus
    let games: [Game]
}

struct DataStatus: Decodable {
    let now: Double
    let dataAsOf: Double?
    let lastVerifiedAt: Double?
    let isStale: Bool
    let activeGames: Int
    let rankedGames: Int
    let warnings: [String]
}

struct PrizeGroup: Decodable, Hashable {
    let original: Int
    let remaining: Int
    let pctRemaining: Double?
    let valueOriginalCents: Double
    let valueRemainingCents: Double
}

struct TopPrize: Decodable, Hashable {
    let label: String
    let headlineCents: Double
    let cashCents: Double
    let kind: String
    let original: Int
    let remaining: Int
    let pctRemaining: Double?
}

struct MajorPrizes: Decodable, Hashable {
    let original: Int
    let remaining: Int
    let pctRemaining: Double?
    let thresholdCents: Double
    let tierCount: Int
}

/// Estimated tickets remaining. `available == false` comes with a `reason` instead of numbers.
struct TicketEstimate: Decodable, Hashable {
    let available: Bool
    let ticketsRemaining: Double?
    let remainingFraction: Double?
    let confidence: String?
    let note: String?
    let reason: String?
}

struct ScoreComponent: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    let rawFormatted: String?
    let percentile: Double?
    let effectiveWeight: Double
    let contribution: Double
    var id: String { key }
}

struct GameScore: Decodable, Hashable {
    let score: Double?
    let components: [ScoreComponent]
    let rank: Int?
    let rankInPrice: Int?
    let peersInPrice: Int?
    /// strong | average | weak | unrated
    let label: String
    let notes: [String]
}

struct Explanation: Decodable, Hashable {
    let headline: String
    let strengths: [String]
    let weaknesses: [String]
    let avoidReasons: [String]
}

struct Tier: Decodable, Hashable, Identifiable {
    let tierNumber: Int
    let prizeCents: Double
    let description: String
    /// cash | free_ticket | annuity
    let kind: String
    let original: Int
    let remaining: Int
    let claimedCount: Int
    let pctRemaining: Double?
    let isTop: Bool
    let isMajor: Bool
    let currentOddsOneIn: Double?
    let originalOddsOneIn: Double?
    var id: Int { tierNumber }
}

/// One active game with its metrics, score and explanation. `tiers` is present on the detail endpoint only.
struct Game: Decodable, Hashable, Identifiable {
    let gameId: String
    let gameNumber: String
    let name: String
    let priceCents: Int
    let launchDate: Double?
    let totalTicketsPrinted: Double?
    let topPrize: TopPrize
    let allPrizes: PrizeGroup
    let major: MajorPrizes
    let tickets: TicketEstimate
    let originalEvCents: Double?
    let originalReturn: Double?
    let currentEvCents: Double?
    let currentReturn: Double?
    let expectedLossCents: Double?
    let originalOddsAnyOneIn: Double?
    let currentOddsAnyOneIn: Double?
    let currentOddsProfitOneIn: Double?
    let originalOddsProfitOneIn: Double?
    let currentOddsTopOneIn: Double?
    let originalOddsTopOneIn: Double?
    let topRetention: Double?
    let majorRetention: Double?
    let warnings: [String]
    let score: GameScore
    let explanation: Explanation
    let lastChangeAt: Double?
    let tiers: [Tier]?

    var id: String { gameId }
}

struct GameDetailResponse: Decodable {
    let game: Game?
    let notRankedReason: String?
    let events: [ChangeEvent]
    let officialUrl: String
}

struct HistoryResponse: Decodable {
    let points: [HistoryPoint]
}

struct HistoryPoint: Decodable, Hashable, Identifiable {
    let observed_at: Double
    let score: Double?
    let current_return: Double?
    let original_return: Double?
    let top_remaining: Int
    let top_original: Int
    let tickets_remaining_est: Double?
    let source_key: String
    var id: Double { observed_at }
    var date: Date { Date(milliseconds: observed_at) }
}

struct ChangesResponse: Decodable {
    let events: [ChangeEvent]
}

struct ChangeEvent: Decodable, Hashable, Identifiable {
    let id: Int
    let game_id: String
    let observed_at: Double
    let kind: String
    /// info | notable | warning
    let severity: String
    let message: String
    let game_name: String?
    let price_cents: Int?
    var date: Date { Date(milliseconds: observed_at) }
}

struct CalendarResponse: Decodable {
    let now: Double
    let upcoming: [UpcomingGame]
    let salesEnding: [SalesEndingGame]
    let claimDeadlines: [ClaimDeadline]
}

struct UpcomingGame: Decodable, Hashable, Identifiable {
    let gameId: String
    let gameNumber: String
    let name: String
    let priceCents: Int
    let topPrizeLabel: String
    let topPrizeOriginal: Int
    let launchDate: Double
    let launchReturn: Double?
    let oddsAnyOneIn: Double?
    var id: String { gameId }
}

struct SalesEndingGame: Decodable, Hashable, Identifiable {
    let gameId: String
    let gameNumber: String
    let name: String
    let priceCents: Int
    let topPrizeOriginal: Int
    let topPrizeRemaining: Int
    let salesEndDate: Double
    let daysLeft: Int
    var id: String { gameId }
}

struct ClaimDeadline: Decodable, Hashable, Identifiable {
    let gameId: String
    let gameNumber: String
    let name: String
    let priceCents: Int
    let topPrizeLabel: String
    let topPrizeOriginal: Int
    let topPrizeRemaining: Int
    let salesEndedOn: Double
    let lastDayToClaim: Double
    let daysLeft: Int
    var id: String { gameId }
}

extension Date {
    init(milliseconds: Double) { self.init(timeIntervalSince1970: milliseconds / 1000) }
}

/// The NJ Lottery's own page for a game.
func officialURL(gameId: String) -> URL {
    let padded = String(repeating: "0", count: max(0, 5 - gameId.count)) + gameId
    return URL(string: "https://www.njlottery.com/en-us/scratch-offs/\(padded).html")!
}
