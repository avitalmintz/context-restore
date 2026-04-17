import Foundation
import UserNotifications

@MainActor
public final class NotificationScheduler {
    private let center: UNUserNotificationCenter
    private let reminderIdentifier = "context-restore.daily-reminder"
    private let taskReminderPrefix = "context-restore.task-reminder"

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    public func apply(settings: IOSNotificationSettings, tasks: [TaskItem]) async throws {
        center.removePendingNotificationRequests(withIdentifiers: [reminderIdentifier])

        guard settings.enabled else {
            return
        }

        let permissionGranted = try await requestPermissionIfNeeded()
        guard permissionGranted else {
            throw NotificationSchedulerError.permissionDenied
        }

        let request = UNNotificationRequest(
            identifier: reminderIdentifier,
            content: makeContent(tasks: tasks),
            trigger: makeDailyTrigger(hour: settings.hour, minute: settings.minute)
        )

        try await add(request: request)
    }

    public func sendTestNotification(afterSeconds: TimeInterval = 5) async throws {
        let permissionGranted = try await requestPermissionIfNeeded()
        guard permissionGranted else {
            throw NotificationSchedulerError.permissionDenied
        }

        let content = UNMutableNotificationContent()
        content.title = "Context Restore Test"
        content.body = "Notifications are working on this device."
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, afterSeconds),
            repeats: false
        )

        let request = UNNotificationRequest(
            identifier: "context-restore.test-\(UUID().uuidString)",
            content: content,
            trigger: trigger
        )

        try await add(request: request)
    }

    public func scheduleTaskReminder(task: TaskItem, at remindAt: Date) async throws {
        let permissionGranted = try await requestPermissionIfNeeded()
        guard permissionGranted else {
            throw NotificationSchedulerError.permissionDenied
        }

        let content = UNMutableNotificationContent()
        content.title = "Reminder: \(task.title)"
        content.body = task.nextAction.isEmpty
            ? "Open Context Restore to continue this task."
            : task.nextAction
        content.sound = .default

        let interval = max(1, remindAt.timeIntervalSinceNow)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        let request = UNNotificationRequest(
            identifier: "\(taskReminderPrefix).\(task.taskId)",
            content: content,
            trigger: trigger
        )

        center.removePendingNotificationRequests(withIdentifiers: ["\(taskReminderPrefix).\(task.taskId)"])
        try await add(request: request)
    }

    private func makeDailyTrigger(hour: Int, minute: Int) -> UNCalendarNotificationTrigger {
        var components = DateComponents()
        components.hour = min(23, max(0, hour))
        components.minute = min(59, max(0, minute))
        return UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
    }

    private func makeContent(tasks: [TaskItem]) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        let active = tasks.filter { $0.status != "done" }

        if active.isEmpty {
            content.title = "Context Restore"
            content.body = "No open tasks right now."
        } else {
            content.title = "You have \(active.count) open context tasks"
            let top = active.prefix(2).map { "• \($0.title)" }.joined(separator: " ")
            content.body = top.isEmpty ? "Open the app to continue where you left off." : top
        }

        content.sound = .default
        return content
    }

    private func requestPermissionIfNeeded() async throws -> Bool {
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
            center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: granted)
            }
        }
    }

    private func add(request: UNNotificationRequest) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            center.add(request) { error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: ())
            }
        }
    }
}

public enum NotificationSchedulerError: LocalizedError {
    case permissionDenied

    public var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Notifications are disabled for this app. Enable them in iOS Settings."
        }
    }
}
