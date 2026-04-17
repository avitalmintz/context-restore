import Foundation

public struct TaskRelations: Equatable, Codable {
    public var mergedIntoByTaskId: [String: String]
    public var keepSeparatePairs: [String: Int64]

    public init(
        mergedIntoByTaskId: [String: String] = [:],
        keepSeparatePairs: [String: Int64] = [:]
    ) {
        self.mergedIntoByTaskId = mergedIntoByTaskId
        self.keepSeparatePairs = keepSeparatePairs
    }
}

public protocol TaskRelationsStore {
    func load() -> TaskRelations
    func save(_ relations: TaskRelations)
}

public final class UserDefaultsTaskRelationsStore: TaskRelationsStore {
    private enum Keys {
        static let blob = "ios.task.relations.v1"
    }

    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> TaskRelations {
        guard let data = defaults.data(forKey: Keys.blob),
              let decoded = try? decoder.decode(TaskRelations.self, from: data) else {
            return TaskRelations()
        }
        return decoded
    }

    public func save(_ relations: TaskRelations) {
        if let data = try? encoder.encode(relations) {
            defaults.set(data, forKey: Keys.blob)
        }
    }
}
