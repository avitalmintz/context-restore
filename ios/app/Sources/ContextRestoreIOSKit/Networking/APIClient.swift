import Foundation

public enum APIClientError: LocalizedError {
    case invalidBaseURL
    case missingToken
    case serverError(String)
    case httpError(Int)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Backend URL is invalid"
        case .missingToken:
            return "API token is required"
        case .serverError(let message):
            return message
        case .httpError(let code):
            return "Request failed with HTTP \(code)"
        }
    }
}

@MainActor
public final class APIClient {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func registerDevice(config: BackendConfig) async throws -> String {
        let response: DeviceRegisterResponse = try await send(
            config: config,
            path: "/v1/devices/register",
            method: "POST",
            body: [
                "platform": "ios",
                "deviceLabel": config.deviceLabel
            ]
        )

        guard response.ok, let deviceId = response.deviceId, !deviceId.isEmpty else {
            throw APIClientError.serverError(response.error ?? "Could not register device")
        }
        return deviceId
    }

    public func fetchTasks(
        config: BackendConfig,
        includeDone: Bool,
        limit: Int
    ) async throws -> [TaskItem] {
        let query = "includeDone=\(includeDone ? "true" : "false")&limit=\(max(1, min(limit, 500)))"
        let response: TaskFeedResponse = try await send(
            config: config,
            path: "/v1/tasks?\(query)",
            method: "GET",
            body: Optional<EmptyBody>.none
        )
        guard response.ok else {
            throw APIClientError.serverError("Could not load tasks")
        }
        return response.tasks
    }

    public func applyAction(
        config: BackendConfig,
        taskId: String,
        action: TaskActionRequest
    ) async throws {
        let encodedTaskId = taskId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? taskId
        let response: ActionResponse = try await send(
            config: config,
            path: "/v1/tasks/\(encodedTaskId)/actions",
            method: "POST",
            body: action
        )

        guard response.ok else {
            throw APIClientError.serverError(response.error ?? "Action failed")
        }
    }

    private func send<T: Decodable, B: Encodable>(
        config: BackendConfig,
        path: String,
        method: String,
        body: B?
    ) async throws -> T {
        guard config.isConfigured else {
            throw APIClientError.missingToken
        }

        guard let url = URL(string: config.normalizedBaseURL + path) else {
            throw APIClientError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.apiToken)", forHTTPHeaderField: "Authorization")

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            switch error.code {
            case .cannotConnectToHost, .timedOut, .notConnectedToInternet, .networkConnectionLost:
                throw APIClientError.serverError(
                    "Could not connect to backend. Ensure backend is running (`npm run dev`) and URL is `http://127.0.0.1:8787` in Simulator."
                )
            default:
                throw APIClientError.serverError(error.localizedDescription)
            }
        } catch {
            throw APIClientError.serverError(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.serverError("Invalid response")
        }

        if (200..<300).contains(http.statusCode) == false {
            if let apiError = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data),
               let message = apiError.error,
               !message.isEmpty {
                throw APIClientError.serverError(message)
            }
            throw APIClientError.httpError(http.statusCode)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}

private struct APIErrorEnvelope: Decodable {
    let ok: Bool?
    let error: String?
}

private struct EmptyBody: Encodable {}
