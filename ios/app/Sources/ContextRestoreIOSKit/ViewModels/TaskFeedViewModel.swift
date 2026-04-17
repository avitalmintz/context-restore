import Foundation

public struct TaskDuplicateCandidate: Identifiable, Hashable {
    public var id: String { "\(taskId)::\(otherTaskId)" }
    public let taskId: String
    public let otherTaskId: String
    public let otherTaskTitle: String
    public let score: Double
}

public struct TaskRelatedSuggestion: Identifiable, Hashable {
    public var id: String { "\(taskId)::\(relatedTaskId)" }
    public let taskId: String
    public let relatedTaskId: String
    public let relatedTaskTitle: String
    public let relatedLastActivityTs: Int64
    public let reason: String
    public let score: Double
}

@MainActor
public final class TaskFeedViewModel: ObservableObject {
    @Published public private(set) var tasks: [TaskItem] = []
    @Published public var isLoading: Bool = false
    @Published public var errorMessage: String = ""
    @Published public var includeDone: Bool = false
    @Published public var renameDraft: String = ""
    @Published public var notificationSettings: IOSNotificationSettings {
        didSet {
            notificationStore.save(notificationSettings)
        }
    }
    @Published public var taskRelations: TaskRelations {
        didSet {
            relationStore.save(taskRelations)
        }
    }

    @Published public var config: BackendConfig {
        didSet {
            configStore.save(config)
        }
    }

    private let apiClient: APIClient
    private let configStore: BackendConfigStore
    private let notificationStore: IOSNotificationSettingsStore
    private let relationStore: TaskRelationsStore
    private let notificationScheduler: NotificationScheduler

    public init(
        apiClient: APIClient = APIClient(),
        configStore: BackendConfigStore = UserDefaultsBackendConfigStore(),
        notificationStore: IOSNotificationSettingsStore = UserDefaultsIOSNotificationSettingsStore(),
        relationStore: TaskRelationsStore = UserDefaultsTaskRelationsStore(),
        notificationScheduler: NotificationScheduler = NotificationScheduler()
    ) {
        self.apiClient = apiClient
        self.configStore = configStore
        self.notificationStore = notificationStore
        self.relationStore = relationStore
        self.notificationScheduler = notificationScheduler
        self.config = configStore.load()
        self.notificationSettings = notificationStore.load()
        self.taskRelations = relationStore.load()
    }

    public var hasConfiguredBackend: Bool {
        config.isConfigured
    }

    public var activeTasks: [TaskItem] {
        let merged = applyTaskRelations(to: tasks)
        return includeDone ? merged : merged.filter { $0.status.lowercased() != "done" }
    }

    public func refresh(limit: Int = 100) async {
        guard hasConfiguredBackend else {
            errorMessage = "Set backend URL + API token in Settings"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            tasks = try await apiClient.fetchTasks(
                config: config,
                includeDone: true,
                limit: limit
            )
            errorMessage = ""
            try? await notificationScheduler.apply(settings: notificationSettings, tasks: activeTasks)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func registerDeviceIfNeeded(force: Bool = false) async {
        guard hasConfiguredBackend else {
            errorMessage = "Set backend URL + API token in Settings"
            return
        }

        if !force, !config.deviceId.isEmpty {
            return
        }

        do {
            let deviceId = try await apiClient.registerDevice(config: config)
            config.deviceId = deviceId
            errorMessage = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func markDone(task: TaskItem, done: Bool) async {
        await applyAction(
            taskId: task.taskId,
            action: TaskActionRequest(
                actionType: .setDone,
                payload: ["done": .bool(done)],
                deviceId: config.deviceId.isEmpty ? nil : config.deviceId
            )
        )
    }

    public func rename(task: TaskItem, title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        await applyAction(
            taskId: task.taskId,
            action: TaskActionRequest(
                actionType: .rename,
                payload: ["title": .string(trimmed)],
                deviceId: config.deviceId.isEmpty ? nil : config.deviceId
            )
        )
    }

    public func deleteTaskContext(task: TaskItem) async {
        let urls = task.pages.map { CodableValue.string($0.url) }
        await applyAction(
            taskId: task.taskId,
            action: TaskActionRequest(
                actionType: .deleteTaskContext,
                payload: ["urls": .array(urls)],
                deviceId: config.deviceId.isEmpty ? nil : config.deviceId
            )
        )
    }

    public func saveNotificationSettings(enabled: Bool, hour: Int, minute: Int) async {
        notificationSettings = IOSNotificationSettings(enabled: enabled, hour: hour, minute: minute)
        do {
            try await notificationScheduler.apply(settings: notificationSettings, tasks: activeTasks)
            errorMessage = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func sendTestNotification() async {
        do {
            try await notificationScheduler.sendTestNotification(afterSeconds: 5)
            errorMessage = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func setReminder(task: TaskItem, remindAt: Date) async {
        do {
            try await notificationScheduler.scheduleTaskReminder(task: task, at: remindAt)
            errorMessage = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func duplicateCandidate(for task: TaskItem) -> TaskDuplicateCandidate? {
        duplicateCandidatesMap()[task.taskId]
    }

    public func relatedSuggestion(for task: TaskItem) -> TaskRelatedSuggestion? {
        relatedSuggestionsMap()[task.taskId]
    }

    public func mergeTasks(primaryTaskId: String, secondaryTaskId: String) {
        let primary = primaryTaskId.trimmingCharacters(in: .whitespacesAndNewlines)
        let secondary = secondaryTaskId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !primary.isEmpty, !secondary.isEmpty, primary != secondary else {
            return
        }

        var next = taskRelations
        let primaryRoot = resolveMergeRoot(primary, mergedInto: next.mergedIntoByTaskId)
        let secondaryRoot = resolveMergeRoot(secondary, mergedInto: next.mergedIntoByTaskId)
        guard primaryRoot != secondaryRoot else { return }

        next.mergedIntoByTaskId[secondaryRoot] = primaryRoot
        next.keepSeparatePairs.removeValue(forKey: pairKey(primaryRoot, secondaryRoot))
        taskRelations = next
        errorMessage = ""
    }

    public func keepTasksSeparate(primaryTaskId: String, secondaryTaskId: String) {
        let primary = primaryTaskId.trimmingCharacters(in: .whitespacesAndNewlines)
        let secondary = secondaryTaskId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !primary.isEmpty, !secondary.isEmpty, primary != secondary else {
            return
        }

        var next = taskRelations
        next.keepSeparatePairs[pairKey(primary, secondary)] = Int64(Date().timeIntervalSince1970 * 1000)

        if next.mergedIntoByTaskId[primary] == secondary {
            next.mergedIntoByTaskId.removeValue(forKey: primary)
        }
        if next.mergedIntoByTaskId[secondary] == primary {
            next.mergedIntoByTaskId.removeValue(forKey: secondary)
        }

        taskRelations = next
        errorMessage = ""
    }

    public func unmergeTasks(primaryTaskId: String) {
        let primary = primaryTaskId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !primary.isEmpty else { return }

        var next = taskRelations
        var keysToDelete: [String] = []
        for key in next.mergedIntoByTaskId.keys {
            let root = resolveMergeRoot(key, mergedInto: next.mergedIntoByTaskId)
            if root == primary || next.mergedIntoByTaskId[key] == primary {
                keysToDelete.append(key)
            }
        }
        for key in keysToDelete {
            next.mergedIntoByTaskId.removeValue(forKey: key)
        }
        taskRelations = next
        errorMessage = ""
    }

    public func mergedFragmentTitles(for primaryTaskId: String) -> [String] {
        let primary = primaryTaskId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !primary.isEmpty else { return [] }

        var titles: [String] = []
        for task in tasks {
            guard task.taskId != primary else { continue }
            let root = resolveMergeRoot(task.taskId, mergedInto: taskRelations.mergedIntoByTaskId)
            if root == primary {
                titles.append(task.title)
            }
        }
        return Array(Set(titles)).sorted()
    }

    private func applyAction(taskId: String, action: TaskActionRequest) async {
        guard hasConfiguredBackend else {
            errorMessage = "Set backend URL + API token in Settings"
            return
        }

        do {
            try await apiClient.applyAction(config: config, taskId: taskId, action: action)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func applyTaskRelations(to sourceTasks: [TaskItem]) -> [TaskItem] {
        var map = Dictionary(uniqueKeysWithValues: sourceTasks.map { ($0.taskId, $0) })
        var suppressed = Set<String>()

        for (childTaskId, parentTaskId) in taskRelations.mergedIntoByTaskId {
            guard let child = map[childTaskId] else { continue }
            let parentRootId = resolveMergeRoot(parentTaskId, mergedInto: taskRelations.mergedIntoByTaskId)
            guard var parent = map[parentRootId], parent.taskId != child.taskId else { continue }
            parent = mergeTaskRecords(primary: parent, secondary: child)
            map[parent.taskId] = parent
            suppressed.insert(child.taskId)
        }

        let merged = map.values
            .filter { !suppressed.contains($0.taskId) }
            .sorted { $0.lastActivityTs > $1.lastActivityTs }

        return merged
    }

    private func mergeTaskRecords(primary: TaskItem, secondary: TaskItem) -> TaskItem {
        let pages = mergePages(primary.pages + secondary.pages)
        let domains = Array(Set(([primary.domain, secondary.domain] + primary.domains + secondary.domains).filter { !$0.isEmpty })).sorted()
        let related = mergeRelatedTasks(primary.relatedTasks, secondary.relatedTasks)

        return TaskItem(
            taskId: primary.taskId,
            title: primary.title,
            domain: primary.domain.isEmpty ? secondary.domain : primary.domain,
            domains: domains,
            category: primary.category.isEmpty ? secondary.category : primary.category,
            topic: primary.topic.isEmpty ? secondary.topic : primary.topic,
            confidence: max(primary.confidence, secondary.confidence),
            status: primary.status,
            lastActivityTs: max(primary.lastActivityTs, secondary.lastActivityTs),
            briefing: primary.briefing.isEmpty ? secondary.briefing : primary.briefing,
            nextAction: primary.nextAction.isEmpty ? secondary.nextAction : primary.nextAction,
            stats: buildStatsFromPages(
                pages,
                eventCount: (primary.stats.eventCount ?? 0) + (secondary.stats.eventCount ?? 0)
            ),
            pages: pages,
            relatedTasks: related,
            openLoopScore: max(primary.openLoopScore ?? 0, secondary.openLoopScore ?? 0),
            nudgePhase: primary.nudgePhase ?? secondary.nudgePhase,
            snapshotTs: max(primary.snapshotTs ?? 0, secondary.snapshotTs ?? 0),
            schemaVersion: max(primary.schemaVersion ?? 1, secondary.schemaVersion ?? 1)
        )
    }

    private func mergeRelatedTasks(_ first: [RelatedTask]?, _ second: [RelatedTask]?) -> [RelatedTask]? {
        let merged = (first ?? []) + (second ?? [])
        guard !merged.isEmpty else { return nil }

        var byTaskId: [String: RelatedTask] = [:]
        for item in merged {
            if let current = byTaskId[item.taskId] {
                if (item.overlapScore ?? 0) > (current.overlapScore ?? 0) {
                    byTaskId[item.taskId] = item
                }
            } else {
                byTaskId[item.taskId] = item
            }
        }
        return Array(byTaskId.values).sorted { ($0.overlapScore ?? 0) > ($1.overlapScore ?? 0) }
    }

    private func mergePages(_ pages: [TaskPage]) -> [TaskPage] {
        var byURL: [String: TaskPage] = [:]

        for page in pages {
            guard !page.url.isEmpty else { continue }
            if let current = byURL[page.url] {
                let merged = TaskPage(
                    url: page.url,
                    domain: current.domain.isEmpty ? page.domain : current.domain,
                    title: current.title.count >= page.title.count ? current.title : page.title,
                    state: statePriority(page.state) > statePriority(current.state) ? page.state : current.state,
                    interestScore: max(current.interestScore, page.interestScore),
                    completionScore: max(current.completionScore, page.completionScore),
                    maxScrollPct: max(current.maxScrollPct, page.maxScrollPct),
                    activeMs: current.activeMs + page.activeMs,
                    visitCount: current.visitCount + page.visitCount,
                    revisitCount: current.revisitCount + page.revisitCount,
                    lastTs: max(current.lastTs, page.lastTs)
                )
                byURL[page.url] = merged
            } else {
                byURL[page.url] = page
            }
        }

        return byURL.values.sorted {
            if $0.interestScore == $1.interestScore {
                return $0.lastTs > $1.lastTs
            }
            return $0.interestScore > $1.interestScore
        }
    }

    private func buildStatsFromPages(_ pages: [TaskPage], eventCount: Int) -> TaskStats {
        var readCount = 0
        var skimmedCount = 0
        var unopenedCount = 0
        var bouncedCount = 0
        var activeMs = 0
        var revisitCount = 0
        var deepScrollCount = 0

        for page in pages {
            switch page.state.lowercased() {
            case "read":
                readCount += 1
            case "skimmed":
                skimmedCount += 1
            case "unopened":
                unopenedCount += 1
            default:
                bouncedCount += 1
            }
            activeMs += page.activeMs
            revisitCount += page.revisitCount
            if page.maxScrollPct >= 80 {
                deepScrollCount += 1
            }
        }

        return TaskStats(
            activeMs: activeMs,
            pageCount: pages.count,
            readCount: readCount,
            eventCount: eventCount,
            bouncedCount: bouncedCount,
            revisitCount: revisitCount,
            skimmedCount: skimmedCount,
            unopenedCount: unopenedCount,
            deepScrollCount: deepScrollCount
        )
    }

    private func relatedSuggestionsMap() -> [String: TaskRelatedSuggestion] {
        let mergedTasks = applyTaskRelations(to: tasks)
        if mergedTasks.count < 2 {
            return [:]
        }

        var output: [String: TaskRelatedSuggestion] = [:]

        for task in mergedTasks {
            guard task.status.lowercased() != "done" else { continue }
            let currentTaskTokens = taskTokens(for: task)
            var best: TaskRelatedSuggestion?

            for candidate in mergedTasks where candidate.taskId != task.taskId {
                let gapMs = task.lastActivityTs - candidate.lastActivityTs
                if gapMs < 30 * 60 * 1000 {
                    continue
                }

                let domainsA = Set(([task.domain] + task.domains).map { $0.lowercased() }.filter { !$0.isEmpty })
                let domainsB = Set(([candidate.domain] + candidate.domains).map { $0.lowercased() }.filter { !$0.isEmpty })
                let sharedDomains = domainsA.intersection(domainsB).count

                let candidateTokens = taskTokens(for: candidate)
                let sharedTokens = currentTaskTokens.intersection(candidateTokens).count
                let tokenOverlap = Double(sharedTokens) / Double(max(max(currentTaskTokens.count, candidateTokens.count), 1))

                let score = tokenOverlap
                    + (sharedDomains > 0 ? 0.22 : 0.0)
                    + (sharedTokens >= 2 ? 0.15 : 0.0)
                    + (task.category.lowercased() == candidate.category.lowercased() ? 0.08 : 0.0)

                if score < 0.34 {
                    continue
                }

                let reason: String
                if sharedDomains > 0 {
                    reason = "shared domain + intent overlap"
                } else if sharedTokens >= 2 {
                    reason = "shared intent keywords"
                } else {
                    reason = "similar browsing thread"
                }

                let suggestion = TaskRelatedSuggestion(
                    taskId: task.taskId,
                    relatedTaskId: candidate.taskId,
                    relatedTaskTitle: candidate.title,
                    relatedLastActivityTs: candidate.lastActivityTs,
                    reason: reason,
                    score: score
                )

                if let best, best.score >= suggestion.score {
                    continue
                }
                best = suggestion
            }

            if let best {
                output[task.taskId] = best
            }
        }

        return output
    }

    private func duplicateCandidatesMap() -> [String: TaskDuplicateCandidate] {
        let visibleTasks = activeTasks
        if visibleTasks.count < 2 {
            return [:]
        }

        var output: [String: TaskDuplicateCandidate] = [:]

        for i in 0..<visibleTasks.count {
            for j in (i + 1)..<visibleTasks.count {
                let first = visibleTasks[i]
                let second = visibleTasks[j]
                let key = pairKey(first.taskId, second.taskId)
                if taskRelations.keepSeparatePairs[key] != nil {
                    continue
                }

                let score = duplicateScore(first, second)
                if score < 0.55 {
                    continue
                }

                let preferred = first.lastActivityTs >= second.lastActivityTs ? first : second
                let other = preferred.taskId == first.taskId ? second : first
                let candidate = TaskDuplicateCandidate(
                    taskId: preferred.taskId,
                    otherTaskId: other.taskId,
                    otherTaskTitle: other.title,
                    score: score
                )

                if let current = output[preferred.taskId], current.score >= score {
                    continue
                }
                output[preferred.taskId] = candidate
            }
        }

        return output
    }

    private func duplicateScore(_ first: TaskItem, _ second: TaskItem) -> Double {
        let domainsA = Set(([first.domain] + first.domains).map { $0.lowercased() }.filter { !$0.isEmpty })
        let domainsB = Set(([second.domain] + second.domains).map { $0.lowercased() }.filter { !$0.isEmpty })
        let sharedDomains = domainsA.intersection(domainsB).count

        let tokensA = taskTokens(for: first)
        let tokensB = taskTokens(for: second)
        let sharedTokens = tokensA.intersection(tokensB).count
        let tokenOverlap = Double(sharedTokens) / Double(max(max(tokensA.count, tokensB.count), 1))
        let categoryBonus = first.category.lowercased() == second.category.lowercased() ? 0.12 : 0.0
        return tokenOverlap + (sharedDomains > 0 ? 0.25 : 0.0) + (sharedTokens >= 2 ? 0.15 : 0.0) + categoryBonus
    }

    private func taskTokens(for task: TaskItem) -> Set<String> {
        let text = ([task.title, task.topic] + task.pages.map { $0.title + " " + $0.url })
            .joined(separator: " ")
            .lowercased()

        let raw = text
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { $0.count >= 3 }

        return Set(raw)
    }

    private func pairKey(_ first: String, _ second: String) -> String {
        [first, second].sorted().joined(separator: "::")
    }

    private func resolveMergeRoot(_ taskId: String, mergedInto: [String: String]) -> String {
        var current = taskId
        var visited = Set<String>()

        while let next = mergedInto[current], !next.isEmpty, !visited.contains(current), next != current {
            visited.insert(current)
            current = next
        }
        return current
    }

    private func statePriority(_ state: String) -> Int {
        switch state.lowercased() {
        case "read":
            return 3
        case "skimmed":
            return 2
        case "unopened":
            return 1
        default:
            return 0
        }
    }
}
