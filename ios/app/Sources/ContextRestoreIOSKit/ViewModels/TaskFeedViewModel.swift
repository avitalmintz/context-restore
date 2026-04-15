import Foundation

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

    @Published public var config: BackendConfig {
        didSet {
            configStore.save(config)
        }
    }

    private let apiClient: APIClient
    private let configStore: BackendConfigStore
    private let notificationStore: IOSNotificationSettingsStore
    private let notificationScheduler: NotificationScheduler

    public init(
        apiClient: APIClient = APIClient(),
        configStore: BackendConfigStore = UserDefaultsBackendConfigStore(),
        notificationStore: IOSNotificationSettingsStore = UserDefaultsIOSNotificationSettingsStore(),
        notificationScheduler: NotificationScheduler = NotificationScheduler()
    ) {
        self.apiClient = apiClient
        self.configStore = configStore
        self.notificationStore = notificationStore
        self.notificationScheduler = notificationScheduler
        self.config = configStore.load()
        self.notificationSettings = notificationStore.load()
    }

    public var hasConfiguredBackend: Bool {
        config.isConfigured
    }

    public var activeTasks: [TaskItem] {
        includeDone ? tasks : tasks.filter { $0.status != "done" }
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
}
