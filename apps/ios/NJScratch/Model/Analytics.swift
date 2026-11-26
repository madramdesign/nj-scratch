import Foundation

// Swift ports of packages/analytics/src/session.ts and alternatives.ts, so the app computes the same
// numbers as the website. Keep them in sync (NJScratchTests checks the same reference values).

struct SessionTier {
    let prizeCents: Double
    let remaining: Int
    let isFreeTicket: Bool
}

struct SessionThreshold: Identifiable {
    let minCents: Double
    let label: String
    let probability: Double
    var id: Double { minCents }
}

struct SessionResult {
    let tickets: Int
    let costCents: Int
    let pAnyPrize: Double
    let pAnyProfitPrize: Double
    let pNetProfit: Double
    let pBreakEvenOrBetter: Double
    let pAllLose: Double
    let thresholds: [SessionThreshold]
    let expectedLossCents: Double?
}

enum SessionOdds {
    static let maxTickets = 50

    /// P(no successes) drawing n of T without replacement when K are successes.
    static func pNone(_ K: Int, _ T: Int, _ n: Int) -> Double {
        if K <= 0 { return 1 }
        if n > T - K { return 0 }
        var p = 1.0
        for i in 0..<n { p *= Double(T - K - i) / Double(T - i) }
        return p
    }

    /// Chances for buying `n` tickets. A free ticket counts as getting the ticket price back.
    static func compute(priceCents: Int, ticketsRemaining: Double, tiers: [SessionTier], evCents: Double?, n: Int,
                        thresholdsCents: [Double] = [10_000, 100_000, 1_000_000]) -> SessionResult? {
        let T = Int(ticketsRemaining.rounded(.down))
        guard T > 0, n >= 1, n <= maxTickets, n <= T else { return nil }
        let price = Double(priceCents)
        func sum(_ f: (SessionTier) -> Bool) -> Int { tiers.filter(f).reduce(0) { $0 + max(0, $1.remaining) } }
        let maxPrize = tiers.filter { $0.remaining > 0 }.map(\.prizeCents).max() ?? 0

        let thresholds = thresholdsCents.filter { $0 > price && $0 <= maxPrize }.map { c in
            SessionThreshold(minCents: c, label: "\(Format.money(c)) or more",
                             probability: 1 - pNone(sum { !$0.isFreeTicket && $0.prizeCents >= c }, T, n))
        }

        // Distribution of the total won on a whole-dollar grid up to the amount spent, plus one "more than spent" bucket.
        let cap = Int((Double(n * priceCents) / 100).rounded(.up))
        let over = cap + 1
        var outcomes: [(dollars: Int, p: Double)] = []
        var pWin = 0.0
        for t in tiers where t.remaining > 0 {
            let p = Double(t.remaining) / Double(T)
            pWin += p
            outcomes.append((Int(((t.isFreeTicket ? price : t.prizeCents) / 100).rounded(.down)), p))
        }
        outcomes.append((0, max(0, 1 - pWin)))
        var dist = [Double](repeating: 0, count: cap + 2)
        dist[0] = 1
        for _ in 0..<n {
            var next = [Double](repeating: 0, count: cap + 2)
            for s in 0...over where dist[s] != 0 {
                if s == over { next[over] += dist[s]; continue }
                for o in outcomes {
                    let t = s + o.dollars
                    next[t > cap ? over : t] += dist[s] * o.p
                }
            }
            dist = next
        }
        let costDollars = Double(n * priceCents) / 100
        var pProfit = dist[over], pEven = dist[over]
        for s in 0...cap {
            if Double(s) > costDollars { pProfit += dist[s] }
            if Double(s) >= costDollars { pEven += dist[s] }
        }
        let pAllLose = pNone(sum { _ in true }, T, n)
        return SessionResult(
            tickets: n,
            costCents: n * priceCents,
            pAnyPrize: 1 - pAllLose,
            pAnyProfitPrize: 1 - pNone(sum { !$0.isFreeTicket && $0.prizeCents > price }, T, n),
            pNetProfit: min(1, pProfit),
            pBreakEvenOrBetter: min(1, pEven),
            pAllLose: pAllLose,
            thresholds: thresholds,
            expectedLossCents: evCents.map { Double(n) * (price - $0) }
        )
    }

    static func compute(for game: Game, n: Int) -> SessionResult? {
        guard game.tickets.available, let T = game.tickets.ticketsRemaining, let tiers = game.tiers else { return nil }
        return compute(priceCents: game.priceCents, ticketsRemaining: T,
                       tiers: tiers.map { SessionTier(prizeCents: $0.prizeCents, remaining: $0.remaining, isFreeTicket: $0.kind == "free_ticket") },
                       evCents: game.currentEvCents, n: n)
    }
}

struct Alternative: Identifiable {
    let game: Game
    let reasons: [String]
    var id: String { game.gameId }
}

enum Alternatives {
    /// Minimum score gap (points) for a same-price game to count as clearly stronger.
    static let minScoreGap = 5.0

    /// Same-price games that beat `target` on both score and estimated return and still have a top prize left.
    static func samePrice(for target: Game, in games: [Game], limit: Int = 2) -> [Alternative] {
        guard let ts = target.score.score else { return [] }
        let pct = { (x: Double) in "\(Int((x * 100).rounded()))%" }
        return games
            .filter { g in
                guard g.gameId != target.gameId, g.priceCents == target.priceCents, let s = g.score.score, s >= ts + minScoreGap,
                      let r = g.currentReturn, g.topPrize.remaining > 0 else { return false }
                return target.currentReturn.map { r > $0 } ?? true
            }
            .sorted { ($0.score.score ?? 0) > ($1.score.score ?? 0) }
            .prefix(limit)
            .map { g in
                var reasons: [String] = []
                if let r = g.currentReturn { reasons.append("higher estimated return (\(pct(r)) vs \(target.currentReturn.map(pct) ?? "n/a"))") }
                if let gr = g.topRetention, target.topRetention.map({ gr > $0 + 0.1 }) ?? true {
                    reasons.append("top-prize odds \(String(format: "%.1f", gr))× launch vs \(target.topRetention.map { String(format: "%.1f×", $0) } ?? "n/a")")
                }
                if target.topPrize.remaining == 0 {
                    reasons.append("\(g.topPrize.remaining) of \(g.topPrize.original) top prizes (\(g.topPrize.label)) left, vs none")
                }
                return Alternative(game: g, reasons: reasons)
            }
    }
}
