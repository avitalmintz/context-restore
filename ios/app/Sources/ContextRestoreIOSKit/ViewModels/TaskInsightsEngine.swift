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
    public let headline: String
    public let observations: [String]
    public let missingChecks: [String]
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
        tasks
            .sorted { $0.lastActivityTs > $1.lastActivityTs }
            .map { task in
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

                let observations = observationLines(for: task, kind: kind, rankedPages: ranked)
                let missing = missingChecks(for: task, kind: kind)

                return DetailedBriefItem(
                    taskId: task.taskId,
                    title: task.title,
                    headline: headline(for: task, kind: kind),
                    observations: observations,
                    missingChecks: missing,
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

    private static func headline(for task: TaskItem, kind: InferredTaskKind) -> String {
        switch kind {
        case .shopping:
            return "Shopping comparison brief"
        case .travel:
            return "Travel planning brief"
        case .research:
            return "Research brief"
        case .news:
            return "News tracking brief"
        case .social:
            return "Community thread brief"
        case .other:
            return "Task detail brief"
        }
    }

    private static func observationLines(for task: TaskItem, kind: InferredTaskKind, rankedPages: [TaskPage]) -> [String] {
        var lines: [String] = []
        lines.append("Active time: \(formatMs(task.stats.activeMs ?? 0)) across \(max(task.stats.pageCount, task.pages.count)) pages.")

        if task.stats.revisitCount ?? 0 > 0 {
            lines.append("You revisited this task \(task.stats.revisitCount ?? 0) times, which usually signals high intent.")
        }

        if let top = rankedPages.first {
            lines.append("Highest-interest page: \"\(condensedTitle(top.title))\" (score \(Int(top.interestScore.rounded()))).")
        }

        switch kind {
        case .shopping:
            lines.append("Shopping signal: \(task.stats.bouncedCount) closed quickly, \(task.stats.skimmedCount) skimmed.")
        case .travel:
            lines.append("Travel signal: \(task.stats.deepScrollCount ?? 0) deep scroll events suggest detail checking.")
        case .research, .news:
            lines.append("Reading signal: \(task.stats.readCount) fully read, \(task.stats.skimmedCount) skimmed.")
        case .social, .other:
            break
        }

        return lines
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
