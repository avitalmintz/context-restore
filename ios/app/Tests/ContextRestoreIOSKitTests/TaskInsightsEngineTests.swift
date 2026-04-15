import XCTest
@testable import ContextRestoreIOSKit

final class TaskInsightsEngineTests: XCTestCase {
    func testBaseURLNormalizationRemovesTrailingSlashes() {
        let config = BackendConfig(baseURL: "http://127.0.0.1:8787///", apiToken: "abc")
        XCTAssertEqual(config.normalizedBaseURL, "http://127.0.0.1:8787")
    }

    func testShoppingTaskProducesReviewGap() {
        let task = makeTask(
            taskId: "task-shopping",
            title: "Compare jacket options",
            domain: "revolve.com",
            domains: ["revolve.com", "reformation.com"],
            category: "shopping",
            topic: "jacket",
            confidence: 0.9,
            status: "active",
            stats: TaskStats(
                activeMs: 120_000,
                pageCount: 2,
                readCount: 0,
                eventCount: 20,
                bouncedCount: 0,
                revisitCount: 1,
                skimmedCount: 1,
                unopenedCount: 0,
                deepScrollCount: 2
            ),
            pages: [
                TaskPage(
                    url: "https://revolve.com/jacket-1",
                    domain: "revolve.com",
                    title: "Jacket 1",
                    state: "skimmed",
                    interestScore: 66,
                    completionScore: 40,
                    maxScrollPct: 75,
                    activeMs: 70_000,
                    visitCount: 1,
                    revisitCount: 1,
                    lastTs: 1_776_000_000_000
                ),
                TaskPage(
                    url: "https://reformation.com/jacket-2",
                    domain: "reformation.com",
                    title: "Jacket 2",
                    state: "skimmed",
                    interestScore: 52,
                    completionScore: 34,
                    maxScrollPct: 62,
                    activeMs: 50_000,
                    visitCount: 1,
                    revisitCount: 0,
                    lastTs: 1_776_000_000_010
                )
            ]
        )

        let gaps = TaskInsightsEngine.gapItems(for: [task])
        XCTAssertTrue(gaps.contains(where: { $0.message.localizedCaseInsensitiveContains("reviews") }))
    }

    func testBriefingIncludesTaskTitleAndConfidence() {
        let task = makeTask(
            taskId: "task-research",
            title: "Anthropic model research",
            domain: "arxiv.org",
            domains: ["arxiv.org"],
            category: "research",
            topic: "anthropic model",
            confidence: 0.74,
            status: "active",
            stats: TaskStats(
                activeMs: 90_000,
                pageCount: 1,
                readCount: 0,
                eventCount: 10,
                bouncedCount: 0,
                revisitCount: 0,
                skimmedCount: 1,
                unopenedCount: 0,
                deepScrollCount: 1
            ),
            pages: [
                TaskPage(
                    url: "https://arxiv.org/abs/1234.5678",
                    domain: "arxiv.org",
                    title: "Paper",
                    state: "skimmed",
                    interestScore: 60,
                    completionScore: 40,
                    maxScrollPct: 70,
                    activeMs: 90_000,
                    visitCount: 1,
                    revisitCount: 0,
                    lastTs: 1_776_000_000_111
                )
            ]
        )

        let briefings = TaskInsightsEngine.aiBriefings(for: [task])
        XCTAssertEqual(briefings.count, 1)
        XCTAssertEqual(briefings[0].taskId, task.taskId)
        XCTAssertEqual(briefings[0].confidencePct, 74)
    }

    private func makeTask(
        taskId: String,
        title: String,
        domain: String,
        domains: [String],
        category: String,
        topic: String,
        confidence: Double,
        status: String,
        stats: TaskStats,
        pages: [TaskPage]
    ) -> TaskItem {
        TaskItem(
            taskId: taskId,
            title: title,
            domain: domain,
            domains: domains,
            category: category,
            topic: topic,
            confidence: confidence,
            status: status,
            lastActivityTs: 1_776_000_000_999,
            briefing: "Briefing",
            nextAction: "Next action",
            stats: stats,
            pages: pages,
            openLoopScore: 0.5,
            nudgePhase: nil,
            snapshotTs: 1_776_000_001_000,
            schemaVersion: 1
        )
    }
}
