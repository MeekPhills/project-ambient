import Foundation

public enum AmbientStoreError: LocalizedError {
    case unsupportedSchema(Int)

    public var errorDescription: String? {
        switch self {
        case .unsupportedSchema(let version):
            return "Ambient data uses unsupported schema version \(version)."
        }
    }
}

public final class AmbientStateStore {
    public let directoryURL: URL
    public let stateURL: URL

    public init(directoryURL: URL? = nil) {
        if let directoryURL {
            self.directoryURL = directoryURL
        } else if let override = ProcessInfo.processInfo.environment["AMBIENT_DATA_DIR"], !override.isEmpty {
            self.directoryURL = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            self.directoryURL = appSupport.appendingPathComponent("Project Ambient", isDirectory: true)
        }
        self.stateURL = self.directoryURL.appendingPathComponent("state.json")
    }

    public func load() throws -> AmbientState {
        guard FileManager.default.fileExists(atPath: stateURL.path) else {
            return AmbientState()
        }
        let data = try Data(contentsOf: stateURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let state = try decoder.decode(AmbientState.self, from: data)
        guard state.version <= AmbientState.schemaVersion else {
            throw AmbientStoreError.unsupportedSchema(state.version)
        }
        return state
    }

    public func save(_ state: AmbientState) throws {
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(state)
        try data.write(to: stateURL, options: .atomic)
    }
}
