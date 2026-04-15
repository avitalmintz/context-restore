import Foundation

public struct BackendConfig: Equatable {
    public var baseURL: String
    public var apiToken: String
    public var deviceId: String
    public var deviceLabel: String

    public init(
        baseURL: String = "http://127.0.0.1:8787",
        apiToken: String = "",
        deviceId: String = "",
        deviceLabel: String = "Context Restore iOS"
    ) {
        self.baseURL = baseURL
        self.apiToken = apiToken
        self.deviceId = deviceId
        self.deviceLabel = deviceLabel
    }

    public var normalizedBaseURL: String {
        baseURL.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"/+\z"#, with: "", options: .regularExpression)
    }

    public var isConfigured: Bool {
        !normalizedBaseURL.isEmpty && !apiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

public protocol BackendConfigStore {
    func load() -> BackendConfig
    func save(_ config: BackendConfig)
}

public final class UserDefaultsBackendConfigStore: BackendConfigStore {
    private enum Keys {
        static let baseURL = "backend.baseURL"
        static let apiToken = "backend.apiToken"
        static let deviceId = "backend.deviceId"
        static let deviceLabel = "backend.deviceLabel"
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> BackendConfig {
        BackendConfig(
            baseURL: defaults.string(forKey: Keys.baseURL) ?? "http://127.0.0.1:8787",
            apiToken: defaults.string(forKey: Keys.apiToken) ?? "",
            deviceId: defaults.string(forKey: Keys.deviceId) ?? "",
            deviceLabel: defaults.string(forKey: Keys.deviceLabel) ?? "Context Restore iOS"
        )
    }

    public func save(_ config: BackendConfig) {
        defaults.set(config.baseURL, forKey: Keys.baseURL)
        defaults.set(config.apiToken, forKey: Keys.apiToken)
        defaults.set(config.deviceId, forKey: Keys.deviceId)
        defaults.set(config.deviceLabel, forKey: Keys.deviceLabel)
    }
}
