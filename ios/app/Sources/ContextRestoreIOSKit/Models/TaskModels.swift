import Foundation

public struct TaskFeedResponse: Codable {
    public let ok: Bool
    public let tasks: [TaskItem]
    public let serverTs: Int64?
}

public struct DeviceRegisterResponse: Codable {
    public let ok: Bool
    public let deviceId: String?
    public let serverTime: Int64?
    public let error: String?
}

public struct ActionResponse: Codable {
    public let ok: Bool
    public let actionId: String?
    public let createdAt: String?
    public let error: String?
}

public struct TaskItem: Codable, Identifiable, Hashable {
    public var id: String { taskId }

    public let taskId: String
    public let title: String
    public let domain: String
    public let domains: [String]
    public let category: String
    public let topic: String
    public let confidence: Double
    public let status: String
    public let lastActivityTs: Int64
    public let briefing: String
    public let nextAction: String
    public let stats: TaskStats
    public let pages: [TaskPage]
    public let openLoopScore: Double?
    public let nudgePhase: String?
    public let snapshotTs: Int64?
    public let schemaVersion: Int?
}

public struct TaskStats: Codable, Hashable {
    public let activeMs: Int?
    public let pageCount: Int
    public let readCount: Int
    public let eventCount: Int?
    public let bouncedCount: Int
    public let revisitCount: Int?
    public let skimmedCount: Int
    public let unopenedCount: Int
    public let deepScrollCount: Int?
}

public struct TaskPage: Codable, Hashable, Identifiable {
    public var id: String { url }

    public let url: String
    public let domain: String
    public let title: String
    public let state: String
    public let interestScore: Double
    public let completionScore: Double
    public let maxScrollPct: Double
    public let activeMs: Int
    public let visitCount: Int
    public let revisitCount: Int
    public let lastTs: Int64
}

public enum TaskActionType: String {
    case rename
    case setDone = "set_done"
    case setActive = "set_active"
    case deleteTaskContext = "delete_task_context"
}

public struct TaskActionRequest: Codable {
    public let actionType: String
    public let payload: [String: CodableValue]
    public let deviceId: String?

    public init(actionType: TaskActionType, payload: [String: CodableValue], deviceId: String?) {
        self.actionType = actionType.rawValue
        self.payload = payload
        self.deviceId = deviceId
    }
}

public enum CodableValue: Codable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: CodableValue])
    case array([CodableValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: CodableValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([CodableValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported CodableValue")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}
