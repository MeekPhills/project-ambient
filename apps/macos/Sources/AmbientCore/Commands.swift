import Foundation

public enum AmbientCommand: Codable, Sendable {
    case importMedia(AmbientImportCommand)
}

public struct AmbientImportCommand: Codable, Sendable {
    public var folderPath: String
    public var mode: AmbientImportMode
    public var requestID: String

    public init(folderPath: String, mode: AmbientImportMode, requestID: String = UUID().uuidString) {
        self.folderPath = folderPath
        self.mode = mode
        self.requestID = requestID
    }
}
