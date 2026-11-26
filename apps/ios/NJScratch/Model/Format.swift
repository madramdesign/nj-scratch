import Foundation

/// Number and date formatting that matches the website (packages/lottery-data/src/format.ts).
enum Format {
    private static let usd: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        return f
    }()

    private static let int: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_US")
        return f
    }()

    /// "$1,234" (whole dollars) or "$12.34" with `decimals`.
    static func money(_ cents: Double?, decimals: Bool = false) -> String {
        guard let cents, cents.isFinite else { return "—" }
        usd.minimumFractionDigits = decimals ? 2 : 0
        usd.maximumFractionDigits = decimals ? 2 : 0
        return usd.string(from: NSNumber(value: cents / 100)) ?? "—"
    }

    static func money(_ cents: Int) -> String { money(Double(cents)) }

    /// "$1.2M", "$350K", "$900".
    static func moneyCompact(_ cents: Double?) -> String {
        guard let cents, cents.isFinite else { return "—" }
        let d = cents / 100
        if d >= 1_000_000 { return "$" + trim(d / 1_000_000) + "M" }
        if d >= 10_000 { return "$" + String(Int((d / 1000).rounded())) + "K" }
        return money(cents)
    }

    static func pct(_ ratio: Double?, digits: Int = 1) -> String {
        guard let ratio, ratio.isFinite else { return "—" }
        return String(format: "%.\(digits)f%%", ratio * 100)
    }

    static func odds(_ oneIn: Double?) -> String {
        guard let oneIn, oneIn.isFinite, oneIn > 0 else { return "—" }
        return oneIn < 100 ? "1 in \(String(format: "%.2f", oneIn))" : "1 in \(integer(oneIn))"
    }

    static func integer(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "—" }
        return int.string(from: NSNumber(value: n.rounded())) ?? "—"
    }

    static func integer(_ n: Int) -> String { integer(Double(n)) }

    /// Chance as a percentage, adding "about 1 in X" for small chances.
    static func chance(_ p: Double) -> String {
        if p <= 0 { return "0%" }
        if p >= 0.995 { return ">99%" }
        if p < 0.01 {
            let pctText = p < 0.0001 ? "<0.01%" : pct(p, digits: 2)
            return "\(pctText) (about 1 in \(integer(1 / p)))"
        }
        return pct(p, digits: 0)
    }

    static func retention(_ r: Double?) -> String {
        guard let r, r.isFinite else { return "n/a" }
        return String(format: "%.2f×", r)
    }

    static func date(_ ms: Double?) -> String {
        guard let ms else { return "—" }
        return Date(milliseconds: ms).formatted(date: .abbreviated, time: .omitted)
    }

    static func relative(_ ms: Double?) -> String {
        guard let ms else { return "never" }
        return Date(milliseconds: ms).formatted(.relative(presentation: .named))
    }

    static func inDays(_ d: Int) -> String {
        d <= 0 ? "today" : d == 1 ? "tomorrow" : "in \(integer(d)) days"
    }

    private static func trim(_ x: Double) -> String {
        let s = String(format: "%.1f", x)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }
}
