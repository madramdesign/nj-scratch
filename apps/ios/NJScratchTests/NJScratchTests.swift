import XCTest
@testable import NJScratch

/// Same reference values as packages/analytics/test/session.test.ts, so the Swift port can't drift from the website.
final class SessionOddsTests: XCTestCase {
    // The reference game after half the run is sold: 500,000 tickets left, $2 ticket.
    let tiers = [
        SessionTier(prizeCents: 200, remaining: 50_000, isFreeTicket: true),
        SessionTier(prizeCents: 500, remaining: 50_000, isFreeTicket: false),
        SessionTier(prizeCents: 100_000, remaining: 80, isFreeTicket: false),
        SessionTier(prizeCents: 1_000_000, remaining: 8, isFreeTicket: false),
    ]

    func compute(_ n: Int, tiers: [SessionTier]? = nil) -> SessionResult? {
        SessionOdds.compute(priceCents: 200, ticketsRemaining: 500_000, tiers: tiers ?? self.tiers, evCents: 91.11, n: n)
    }

    func testHypergeometricOnTinyPool() {
        XCTAssertEqual(SessionOdds.pNone(2, 5, 2), 0.3, accuracy: 1e-12)
        XCTAssertEqual(SessionOdds.pNone(0, 5, 2), 1)
        XCTAssertEqual(SessionOdds.pNone(4, 5, 2), 0)
    }

    func testOneTicketEqualsPerTicketOdds() throws {
        let r = try XCTUnwrap(compute(1))
        XCTAssertEqual(r.pAnyPrize, 100_088.0 / 500_000, accuracy: 1e-12)
        XCTAssertEqual(r.pAnyProfitPrize, 50_088.0 / 500_000, accuracy: 1e-12)
        XCTAssertEqual(r.pNetProfit, 50_088.0 / 500_000, accuracy: 1e-10)
        XCTAssertEqual(r.pBreakEvenOrBetter, 100_088.0 / 500_000, accuracy: 1e-10)
        XCTAssertEqual(try XCTUnwrap(r.expectedLossCents), 108.89, accuracy: 1e-6)
        XCTAssertEqual(r.thresholds.map(\.label), ["$100 or more", "$1,000 or more", "$10,000 or more"])
    }

    func testTwoTicketsMatchEnumeration() throws {
        var outcomes: [(v: Double, p: Double)] = [(2, 0.1), (5, 0.1), (1000, 80.0 / 500_000), (10000, 8.0 / 500_000)]
        outcomes.append((0, 1 - outcomes.reduce(0) { $0 + $1.p }))
        var profit = 0.0, even = 0.0
        for a in outcomes { for b in outcomes {
            if a.v + b.v > 4 { profit += a.p * b.p }
            if a.v + b.v >= 4 { even += a.p * b.p }
        } }
        let r = try XCTUnwrap(compute(2))
        XCTAssertEqual(r.pNetProfit, profit, accuracy: 1e-6)
        XCTAssertEqual(r.pBreakEvenOrBetter, even, accuracy: 1e-6)
        XCTAssertEqual(r.costCents, 400)
    }

    func testRefusesImpossibleInputs() {
        XCTAssertNil(compute(0))
        XCTAssertNil(compute(51))
        XCTAssertNil(SessionOdds.compute(priceCents: 200, ticketsRemaining: 0, tiers: tiers, evCents: nil, n: 1))
        XCTAssertEqual(compute(3, tiers: Array(tiers.prefix(2)))?.thresholds.count, 0)
    }
}

final class DecodingTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try Data(contentsOf: url)
    }

    func testDecodesGameListAndDetailFromTheWebsiteExport() throws {
        let list = try JSONDecoder().decode(GamesResponse.self, from: fixture("games"))
        XCTAssertEqual(list.games.count, 5)
        XCTAssertEqual(list.games.first?.score.rank, 1)
        XCTAssertNil(list.games.first?.tiers)

        let detail = try JSONDecoder().decode(GameDetailResponse.self, from: fixture("game-1972"))
        let g = try XCTUnwrap(detail.game)
        XCTAssertEqual(g.name, "Cash Fever")
        XCTAssertEqual(g.priceCents, 1000)
        XCTAssertTrue(try XCTUnwrap(g.tiers).contains { $0.isTop })
        let r = try XCTUnwrap(SessionOdds.compute(for: g, n: 5))
        XCTAssertGreaterThan(r.pAnyPrize, r.pAnyProfitPrize)
        XCTAssertEqual(r.costCents, 5000)
    }

    func testDecodesCalendar() throws {
        let c = try JSONDecoder().decode(CalendarResponse.self, from: fixture("calendar"))
        XCTAssertEqual(c.upcoming.count, 15)
        XCTAssertEqual(c.upcoming.map(\.launchDate), c.upcoming.map(\.launchDate).sorted())
    }
}

final class AlternativesAndFormatTests: XCTestCase {
    func testFormatting() {
        XCTAssertEqual(Format.money(1_000_000.0), "$10,000")
        XCTAssertEqual(Format.money(132.4, decimals: true), "$1.32")
        XCTAssertEqual(Format.odds(4.4512), "1 in 4.45")
        XCTAssertEqual(Format.odds(125_359), "1 in 125,359")
        XCTAssertEqual(Format.chance(0.68), "68%")
        XCTAssertEqual(Format.chance(0.0073), "0.73% (about 1 in 137)")
        XCTAssertEqual(Format.moneyCompact(150_000_000), "$1.5M")
    }

    func testAlternativesNeedHigherScoreAndReturnAtTheSamePrice() throws {
        let list = try JSONDecoder().decode(GamesResponse.self, from: Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "games", withExtension: "json"))))
        for g in list.games {
            for a in Alternatives.samePrice(for: g, in: list.games) {
                XCTAssertEqual(a.game.priceCents, g.priceCents)
                XCTAssertGreaterThanOrEqual(a.game.score.score!, g.score.score! + Alternatives.minScoreGap)
                XCTAssertGreaterThan(a.game.topPrize.remaining, 0)
            }
        }
        // The top-ranked game never gets an alternative.
        XCTAssertTrue(Alternatives.samePrice(for: list.games[0], in: list.games).isEmpty)
    }
}

final class NotificationSelectorTests: XCTestCase {
    private func event(_ id: Int, _ game: String, _ kind: String, _ message: String, at: Double, name: String? = "Game", price: Int? = 1000) -> ChangeEvent {
        let json: [String: Any?] = ["id": id, "game_id": game, "observed_at": at, "kind": kind, "severity": "notable", "message": message, "game_name": name, "price_cents": price]
        let data = try! JSONSerialization.data(withJSONObject: json.compactMapValues { $0 })
        return try! JSONDecoder().decode(ChangeEvent.self, from: data)
    }

    func testOnlyNewEventsForStarredGamesOfInterestingKinds() {
        let events = [
            event(1, "1972", "top_prize_claimed", "1 × $500,000 top prize claimed (1 left).", at: 100),
            event(2, "1972", "top_prize_claimed", "1 × $500,000 top prize claimed (2 left).", at: 50), // already seen
            event(3, "1999", "top_prize_claimed", "1 × $5 top prize claimed.", at: 120),               // not starred
            event(4, "1972", "score_changed", "Score decreased from 90 → 80.", at: 130),                 // raw score move: skipped
            event(5, "1972", "score_changed", "Profile changed from strong to average.", at: 130),
            event(6, "1972", "structure_changed", "Prize tier revised.", at: 140),                       // not a notification kind
            event(7, "2020", "game_announced", "New $10 game announced: Wild 50X (02020), launching Dec 30, 2026.", at: 150, name: "Wild 50X"),
        ]
        let notes = NotificationSelector.select(events: events, watched: ["1972"], after: 60, includeAnnouncements: false)
        XCTAssertEqual(notes.map(\.id), ["event-1", "event-5"])
        XCTAssertEqual(notes[0].title, "Game ($10)")
        XCTAssertEqual(notes[0].gameId, "1972")

        let withAnnouncements = NotificationSelector.select(events: events, watched: ["1972"], after: 60, includeAnnouncements: true)
        XCTAssertEqual(withAnnouncements.last, PlannedNotification(id: "event-7", title: "New game announced", body: "New $10 game announced: Wild 50X (02020), launching Dec 30, 2026.", gameId: nil))
        XCTAssertEqual(NotificationSelector.newestTime(events), 150)
    }

    func testManyEventsCollapseIntoASummary() {
        let events = (1...9).map { event($0, "1972", "major_prize_claimed", "1 × $10,000 prize claimed.", at: Double($0)) }
        let notes = NotificationSelector.select(events: events, watched: ["1972"], after: 0, includeAnnouncements: false, limit: 5)
        XCTAssertEqual(notes.count, 5)
        XCTAssertEqual(notes.prefix(4).map(\.id), ["event-6", "event-7", "event-8", "event-9"])
        XCTAssertEqual(notes.last?.body, "5 more updates. Open NJ Scratch to see them in Changes.")
        XCTAssertNil(notes.last?.gameId)
    }

    func testNothingWhenNothingIsStarredAndAnnouncementsAreOff() {
        let events = [event(1, "1972", "top_prize_claimed", "x", at: 10)]
        XCTAssertTrue(NotificationSelector.select(events: events, watched: [], after: 0, includeAnnouncements: false).isEmpty)
    }
}
