import Foundation

public struct IOSNotificationSettings: Equatable, Codable {
    public var enabled: Bool
    public var hour: Int
    public var minute: Int

    public init(enabled: Bool = false, hour: Int = 20, minute: Int = 0) {
        self.enabled = enabled
        self.hour = min(23, max(0, hour))
        self.minute = min(59, max(0, minute))
    }
}

public protocol IOSNotificationSettingsStore {
    func load() -> IOSNotificationSettings
    func save(_ settings: IOSNotificationSettings)
}

public final class UserDefaultsIOSNotificationSettingsStore: IOSNotificationSettingsStore {
    private enum Keys {
        static let enabled = "ios.notifications.enabled"
        static let hour = "ios.notifications.hour"
        static let minute = "ios.notifications.minute"
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> IOSNotificationSettings {
        IOSNotificationSettings(
            enabled: defaults.object(forKey: Keys.enabled) as? Bool ?? false,
            hour: defaults.object(forKey: Keys.hour) as? Int ?? 20,
            minute: defaults.object(forKey: Keys.minute) as? Int ?? 0
        )
    }

    public func save(_ settings: IOSNotificationSettings) {
        defaults.set(settings.enabled, forKey: Keys.enabled)
        defaults.set(settings.hour, forKey: Keys.hour)
        defaults.set(settings.minute, forKey: Keys.minute)
    }
}
