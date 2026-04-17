import Foundation

public enum InferredTaskKind: String, Hashable {
    case shopping
    case research
    case travel
    case news
    case social
    case other
}

public struct AIBriefingItem: Identifiable, Hashable {
    public var id: String { taskId }

    public let taskId: String
    public let title: String
    public let summary: String
    public let nextFocus: String
    public let confidencePct: Int
    public let kind: InferredTaskKind
}

public struct DetailedBriefPageNote: Identifiable, Hashable {
    public var id: String { url }

    public let url: String
    public let title: String
    public let domain: String
    public let state: String
    public let interestScore: Double
}

public struct DetailedBriefItem: Identifiable, Hashable {
    public var id: String { taskId }

    public let taskId: String
    public let title: String
    public let objective: String
    public let intentLabel: String
    public let decisionSnapshot: String
    public let whyTimeline: [String]
    public let findings: [String]
    public let finishPlan: [String]
    public let overlapHint: String?
    public let closureHint: String
    public let topPages: [DetailedBriefPageNote]
}

public struct GapAnalysisItem: Identifiable, Hashable {
    public let id: String
    public let taskId: String
    public let taskTitle: String
    public let severity: Int
    public let message: String
    public let suggestedAction: String
}

public enum TaskInsightsEngine {
    public static func aiBriefings(for tasks: [TaskItem]) -> [AIBriefingItem] {
        tasks
            .sorted { $0.lastActivityTs > $1.lastActivityTs }
            .map { task in
                let kind = inferKind(for: task)
                let topPage = rankedPages(for: task).first
                let summary = summaryLine(for: task, kind: kind, topPage: topPage)
                let nextFocus = nextFocusLine(for: task, kind: kind)
                return AIBriefingItem(
                    taskId: task.taskId,
                    title: task.title,
                    summary: summary,
                    nextFocus: nextFocus,
                    confidencePct: Int((task.confidence * 100).rounded()),
                    kind: kind
                )
            }
    }

    public static func detailedBriefs(for tasks: [TaskItem]) -> [DetailedBriefItem] {
        let ordered = tasks.sorted { $0.lastActivityTs > $1.lastActivityTs }
        let overlap = overlapHints(for: ordered)

        return ordered.map { task in
            let kind = inferKind(for: task)
            let ranked = rankedPages(for: task)
            let topPages = Array(ranked.prefix(3)).map { page in
                DetailedBriefPageNote(
                    url: page.url,
                    title: page.title,
                    domain: page.domain,
                    state: page.state,
                    interestScore: page.interestScore
                )
            }

            let decisionSnapshot = decisionSnapshot(for: task, rankedPages: ranked)
            let timeline = timelineLines(for: task)
            let findings = summaryFindings(for: task, kind: kind)
            let plan = finishPlan(for: task, kind: kind, rankedPages: ranked)
            let closeHint = closureHint(for: task)

            return DetailedBriefItem(
                taskId: task.taskId,
                title: task.title,
                objective: objectiveLine(for: task, kind: kind),
                intentLabel: intentLabel(for: task),
                decisionSnapshot: decisionSnapshot,
                whyTimeline: timeline,
                findings: findings,
                finishPlan: plan,
                overlapHint: overlap[task.taskId],
                closureHint: closeHint,
                topPages: topPages
            )
        }
    }

    public static func gapItems(for tasks: [TaskItem]) -> [GapAnalysisItem] {
        var output: [GapAnalysisItem] = []

        for task in tasks {
            let kind = inferKind(for: task)
            let taskGaps = rawGaps(for: task, kind: kind)
            for (index, gap) in taskGaps.enumerated() {
                output.append(
                    GapAnalysisItem(
                        id: "\(task.taskId)-\(index)",
                        taskId: task.taskId,
                        taskTitle: task.title,
                        severity: gap.severity,
                        message: gap.message,
                        suggestedAction: gap.action
                    )
                )
            }
        }

        return output.sorted {
            if $0.severity == $1.severity {
                return $0.taskTitle < $1.taskTitle
            }
            return $0.severity > $1.severity
        }
    }

    private struct RawGap {
        let severity: Int
        let message: String
        let action: String
    }

    private static func inferKind(for task: TaskItem) -> InferredTaskKind {
        let category = task.category.lowercased()
        let combined = [task.title, task.topic, task.domain] + task.domains
        let haystack = combined.joined(separator: " ").lowercased()

        if category.contains("shop") || containsAny(haystack, terms: ["shop", "buy", "jacket", "dress", "shoe", "price", "sale", "cart"]) {
            return .shopping
        }
        if category.contains("travel") || containsAny(haystack, terms: ["flight", "hotel", "airbnb", "trip", "booking", "itinerary", "vacation"]) {
            return .travel
        }
        if category.contains("news") || containsAny(haystack, terms: ["news", "update", "announced", "release", "model", "breaking"]) {
            return .news
        }
        if category.contains("research") || containsAny(haystack, terms: ["paper", "pdf", "study", "research", "docs", "tutorial", "guide"]) {
            return .research
        }
        if containsAny(haystack, terms: ["discord", "reddit", "x.com", "twitter", "instagram", "tiktok"]) {
            return .social
        }
        return .other
    }

    private static func summaryLine(for task: TaskItem, kind: InferredTaskKind, topPage: TaskPage?) -> String {
        let pageCount = max(task.stats.pageCount, task.pages.count)
        let domainSummary = uniqueDomains(from: task).prefix(3).joined(separator: ", ")
        let topPageTitle = condensedTitle(topPage?.title ?? "")

        switch kind {
        case .shopping:
            if topPageTitle.isEmpty {
                return "You compared \(pageCount) shopping pages across \(domainSummary)."
            }
            return "You compared \(pageCount) shopping pages and spent the most attention on \"\(topPageTitle)\"."
        case .travel:
            return "You explored \(pageCount) travel pages across \(domainSummary) while planning options."
        case .research, .news:
            return "You reviewed \(pageCount) sources across \(domainSummary) to build context on this topic."
        case .social:
            return "You moved across \(pageCount) social/community pages; this may be a quick-follow task, not a deep read."
        case .other:
            return "You were working across \(pageCount) related pages across \(domainSummary)."
        }
    }

    private static func nextFocusLine(for task: TaskItem, kind: InferredTaskKind) -> String {
        let missing = missingChecks(for: task, kind: kind)
        if let first = missing.first {
            return first
        }

        if task.stats.skimmedCount > 0 {
            return "Finish the skimmed pages before closing this task."
        }

        if task.stats.unopenedCount > 0 {
            return "Open the unopened pages in priority order to recover context."
        }

        return task.nextAction
    }

    private static func objectiveLine(for task: TaskItem, kind: InferredTaskKind) -> String {
        let topic = task.topic.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackTopic = topic.isEmpty ? task.title : topic
        switch kind {
        case .shopping:
            return "Objective: Decide on the best option for \(fallbackTopic)."
        case .travel:
            return "Objective: Convert travel browsing into a concrete itinerary."
        case .research:
            return "Objective: Finish learning and capture one clear takeaway."
        case .news:
            return "Objective: Catch up quickly and close the information loop."
        case .social:
            return "Objective: Decide if this is meaningful follow-up or just browsing."
        case .other:
            return "Objective: Recover intent and either complete or close this task."
        }
    }

    private static func intentLabel(for task: TaskItem) -> String {
        let score = intentScore(for: task)
        if score >= 70 {
            return "High intent (\(score)/100)"
        }
        if score >= 40 {
            return "Medium intent (\(score)/100)"
        }
        return "Low intent (\(score)/100)"
    }

    private static func intentScore(for task: TaskItem) -> Int {
        let activeMs = max(task.stats.activeMs ?? 0, task.pages.reduce(0) { $0 + $1.activeMs })
        let revisits = task.stats.revisitCount ?? 0
        let reads = task.stats.readCount
        let pages = max(task.stats.pageCount, task.pages.count)
        let topInterest = rankedPages(for: task).first?.interestScore ?? 0

        let score = min(45, (Double(activeMs) / 60_000.0) * 4.0)
            + min(20, Double(revisits * 5))
            + min(20, Double(reads * 8))
            + min(10, Double(pages * 2))
            + min(5, topInterest / 20.0)

        return Int(max(0, min(100, score)).rounded())
    }

    private static func decisionSnapshot(for task: TaskItem, rankedPages: [TaskPage]) -> String {
        guard let top = rankedPages.first else {
            return "No strong page signal yet."
        }

        var reasons: [String] = []
        if top.activeMs > 0 {
            reasons.append("spent \(formatMs(top.activeMs))")
        }
        if top.revisitCount > 0 {
            reasons.append("revisited \(top.revisitCount)x")
        }
        if top.maxScrollPct >= 65 {
            reasons.append("scrolled \(Int(top.maxScrollPct.rounded()))%")
        }
        if reasons.isEmpty {
            reasons.append("opened repeatedly")
        }
        return "Leaning toward \"\(condensedTitle(top.title))\" because you \(reasons.joined(separator: ", "))."
    }

    private static func timelineLines(for task: TaskItem) -> [String] {
        let ranked = rankedPages(for: task)
        var lines: [String] = []
        if let searchLike = task.pages.first(where: { pageContains($0, terms: ["search?", "google.com/search", "bing.com/search"]) }) {
            lines.append("Started with search: \(condensedTitle(searchLike.title)).")
        }
        if let first = ranked.first {
            lines.append("Focused on: \(condensedTitle(first.title)).")
        }
        if let revisit = ranked.first(where: { $0.revisitCount > 0 }) {
            lines.append("Revisited: \(condensedTitle(revisit.title)) (\(revisit.revisitCount)x).")
        }
        return Array(lines.prefix(3))
    }

    private static func summaryFindings(for task: TaskItem, kind: InferredTaskKind) -> [String] {
        var lines: [String] = []
        lines.append("Tracked \(max(task.stats.pageCount, task.pages.count)) pages with \(formatMs(task.stats.activeMs ?? 0)) active time.")
        lines.append("Behavior: \(task.stats.readCount) read • \(task.stats.skimmedCount) skimmed • \(task.stats.unopenedCount) unopened • \(task.stats.bouncedCount) closed quickly.")

        switch kind {
        case .shopping:
            let hasReviews = task.pages.contains { pageContains($0, terms: ["review", "rating", "stars"]) }
            let hasReturns = task.pages.contains { pageContains($0, terms: ["return", "refund", "policy"]) }
            lines.append("Coverage: reviews \(hasReviews ? "checked" : "missing"), returns \(hasReturns ? "checked" : "missing").")
        case .research, .news:
            lines.append(task.stats.readCount > 0 ? "You completed at least one source." : "You have not fully read a source yet.")
        case .travel:
            let hasFlights = task.pages.contains { pageContains($0, terms: ["flight", "airline"]) }
            let hasHotels = task.pages.contains { pageContains($0, terms: ["hotel", "airbnb", "lodging"]) }
            lines.append("Coverage: flights \(hasFlights ? "checked" : "missing"), stays \(hasHotels ? "checked" : "missing").")
        case .social, .other:
            break
        }
        return lines
    }

    private static func finishPlan(for task: TaskItem, kind: InferredTaskKind, rankedPages: [TaskPage]) -> [String] {
        var plan: [String] = []
        if let next = rankedPages.first(where: { $0.state == "unopened" || $0.state == "skimmed" }) ?? rankedPages.first {
            plan.append("Open \"\(condensedTitle(next.title))\" next and finish it fully.")
        }
        if let missing = missingChecks(for: task, kind: kind).first {
            plan.append(missing)
        } else {
            plan.append(kind == .shopping ? "Shortlist top 2 options and decide now." : "Resolve the remaining page and close this task.")
        }
        plan.append(closureHint(for: task))
        return Array(plan.prefix(3))
    }

    private static func closureHint(for task: TaskItem) -> String {
        let activeMs = max(task.stats.activeMs ?? 0, task.pages.reduce(0) { $0 + $1.activeMs })
        if max(task.stats.pageCount, task.pages.count) <= 1 && activeMs < 120_000 && task.stats.readCount == 0 {
            return "Likely quick detour: mark done or delete context if no longer relevant."
        }
        if task.stats.skimmedCount == 0 && task.stats.unopenedCount == 0 {
            return "Everything is reviewed; mark done if decision is made."
        }
        return "Keep this open only if a decision is still pending."
    }

    private static func overlapHints(for tasks: [TaskItem]) -> [String: String] {
        var result: [String: String] = [:]
        let tokenMap: [String: Set<String>] = Dictionary(uniqueKeysWithValues: tasks.map { task in
            let tokens = tokenize(task.title + " " + task.topic + " " + task.pages.map { $0.title }.joined(separator: " "))
                .filter { $0.count >= 3 }
            return (task.taskId, Set(tokens))
        })

        for task in tasks {
            let domainsA = Set(([task.domain] + task.domains).map { $0.lowercased() })
            var overlaps: [String] = []
            for other in tasks where other.taskId != task.taskId {
                let domainsB = Set(([other.domain] + other.domains).map { $0.lowercased() })
                let sharedDomain = !domainsA.intersection(domainsB).isEmpty
                let tokensA = tokenMap[task.taskId] ?? []
                let tokensB = tokenMap[other.taskId] ?? []
                let common = tokensA.intersection(tokensB).count
                let denominator = max(max(tokensA.count, tokensB.count), 1)
                let tokenOverlap = Double(common) / Double(denominator)
                if tokenOverlap >= 0.22 && sharedDomain {
                    overlaps.append(other.title)
                }
            }
            if !overlaps.isEmpty {
                result[task.taskId] = "Possible duplicate context with: " + overlaps.prefix(2).joined(separator: " • ")
            }
        }

        return result
    }

    private static func missingChecks(for task: TaskItem, kind: InferredTaskKind) -> [String] {
        rawGaps(for: task, kind: kind).map { $0.action }
    }

    private static func rawGaps(for task: TaskItem, kind: InferredTaskKind) -> [RawGap] {
        var gaps: [RawGap] = []

        if task.stats.skimmedCount > 0 {
            gaps.append(
                RawGap(
                    severity: 2,
                    message: "Task has skimmed pages but no completion pass.",
                    action: "Finish skimmed pages and mark done if complete."
                )
            )
        }

        if task.stats.unopenedCount > 0 {
            gaps.append(
                RawGap(
                    severity: 3,
                    message: "Task still has unopened pages.",
                    action: "Open or delete unopened pages to reduce context clutter."
                )
            )
        }

        switch kind {
        case .shopping:
            let hasReviews = task.pages.contains { pageContains($0, terms: ["review", "ratings", "stars"]) }
            let hasReturns = task.pages.contains { pageContains($0, terms: ["return", "refund", "policy"]) }
            if !hasReviews {
                gaps.append(
                    RawGap(
                        severity: 3,
                        message: "Compared products without checking reviews.",
                        action: "Open a review/ratings page before deciding."
                    )
                )
            }
            if !hasReturns {
                gaps.append(
                    RawGap(
                        severity: 2,
                        message: "Return policy was not clearly reviewed.",
                        action: "Check return/refund policy for your top option."
                    )
                )
            }
        case .travel:
            let hasFlight = task.pages.contains { pageContains($0, terms: ["flight", "airline", "depart", "arrival"]) }
            let hasHotel = task.pages.contains { pageContains($0, terms: ["hotel", "stay", "airbnb", "lodging"]) }
            if hasFlight && !hasHotel {
                gaps.append(
                    RawGap(
                        severity: 2,
                        message: "Flights were checked but lodging was not.",
                        action: "Research hotels/lodging to complete this trip plan."
                    )
                )
            }
            if hasHotel && !hasFlight {
                gaps.append(
                    RawGap(
                        severity: 2,
                        message: "Lodging was checked but flights were not.",
                        action: "Compare flights before locking dates."
                    )
                )
            }
        case .research, .news:
            let hasSourceDepth = task.pages.contains { page in
                pageContains(page, terms: ["paper", "arxiv", "pdf", "docs", "documentation"]) && page.state != "bounced"
            }
            if !hasSourceDepth {
                gaps.append(
                    RawGap(
                        severity: 2,
                        message: "Mostly surface-level pages were visited.",
                        action: "Add one primary source (paper or official docs) to finish this topic."
                    )
                )
            }
        case .social, .other:
            break
        }

        return Array(gaps.prefix(3))
    }

    private static func rankedPages(for task: TaskItem) -> [TaskPage] {
        task.pages.sorted {
            if $0.interestScore == $1.interestScore {
                return $0.activeMs > $1.activeMs
            }
            return $0.interestScore > $1.interestScore
        }
    }

    private static func uniqueDomains(from task: TaskItem) -> [String] {
        var seen = Set<String>()
        var output: [String] = []
        for domain in [task.domain] + task.domains {
            let trimmed = domain.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty || seen.contains(trimmed) {
                continue
            }
            seen.insert(trimmed)
            output.append(trimmed)
        }
        return output
    }

    private static func pageContains(_ page: TaskPage, terms: [String]) -> Bool {
        let combined = (page.title + " " + page.url).lowercased()
        return containsAny(combined, terms: terms)
    }

    private static func containsAny(_ text: String, terms: [String]) -> Bool {
        terms.contains { text.contains($0.lowercased()) }
    }

    private static func tokenize(_ text: String) -> [String] {
        text
            .lowercased()
            .replacingOccurrences(of: "https://", with: " ")
            .replacingOccurrences(of: "http://", with: " ")
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
    }

    private static func condensedTitle(_ value: String) -> String {
        let cleaned = value
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.count <= 80 {
            return cleaned
        }
        let prefix = cleaned.prefix(77)
        return "\(prefix)..."
    }

    private static func formatMs(_ value: Int) -> String {
        if value <= 0 {
            return "0m"
        }
        let totalSeconds = value / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        if minutes == 0 {
            return "\(seconds)s"
        }
        return "\(minutes)m \(seconds)s"
    }
}
