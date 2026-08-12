import Darwin
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
    private static let lockRegistryGuard = NSLock()
    private static var lockRegistry: [String: NSRecursiveLock] = [:]

    public let directoryURL: URL
    public let stateURL: URL
    public let lockURL: URL
    private let processLock: NSRecursiveLock

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
        self.lockURL = self.directoryURL.appendingPathComponent("state.lock")
        Self.lockRegistryGuard.lock()
        if let existing = Self.lockRegistry[self.lockURL.path] {
            self.processLock = existing
        } else {
            let created = NSRecursiveLock()
            Self.lockRegistry[self.lockURL.path] = created
            self.processLock = created
        }
        Self.lockRegistryGuard.unlock()
    }

    public func load() throws -> AmbientState {
        try withFileLock {
            try loadUnlocked()
        }
    }

    public func save(_ state: AmbientState) throws {
        try withFileLock {
            var next = state
            let persistedRevision = (try? loadUnlocked().stateRevision) ?? nil
            next.stateRevision = max(persistedRevision ?? 0, state.stateRevision ?? 0) + 1
            try saveUnlocked(next)
        }
    }

    /// Runs a read-modify-write mutation under an advisory interprocess lock.
    /// Callers may return `shouldSave == false` for idempotent replays or pure
    /// lifecycle work that did not alter persisted state.
    public func withExclusiveState<T>(
        _ body: (inout AmbientState) throws -> (value: T, shouldSave: Bool)
    ) throws -> (value: T, state: AmbientState) {
        try withFileLock {
            var state = try loadUnlocked()
            let decision = try body(&state)
            if decision.shouldSave {
                state.stateRevision = (state.stateRevision ?? 0) + 1
                try saveUnlocked(state)
            }
            return (decision.value, state)
        }
    }

    private func loadUnlocked() throws -> AmbientState {
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

    private func saveUnlocked(_ state: AmbientState) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(state)
        try data.write(to: stateURL, options: .atomic)
    }

    private func withFileLock<T>(_ body: () throws -> T) throws -> T {
        processLock.lock()
        defer { processLock.unlock() }
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let descriptor = lockURL.path.withCString {
            Darwin.open($0, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        }
        guard descriptor >= 0 else { throw posixError() }
        defer { Darwin.close(descriptor) }

        // lockf provides a process-wide advisory lock over the state file's
        // companion descriptor. Reads also take the exclusive lock so every
        // load observes a complete transaction across app and CLI processes.
        guard Darwin.lockf(descriptor, F_LOCK, 0) == 0 else { throw posixError() }
        defer { _ = Darwin.lockf(descriptor, F_ULOCK, 0) }
        return try body()
    }

    private func posixError() -> NSError {
        NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
}
