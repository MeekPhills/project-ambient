import Foundation

public struct AmbientAerialManifest: Codable, Sendable {
    public var generatedAt: Date
    public var channelName: String
    public var videos: [String]
    public var powerPolicy: AmbientPowerPolicy

    public init(generatedAt: Date = Date(), channelName: String, videos: [String], powerPolicy: AmbientPowerPolicy) {
        self.generatedAt = generatedAt
        self.channelName = channelName
        self.videos = videos
        self.powerPolicy = powerPolicy
    }
}

public struct AmbientAerialExportResult: Sendable {
    public var destination: URL
    public var copiedCount: Int
    public var manifestURL: URL

    public init(destination: URL, copiedCount: Int, manifestURL: URL) {
        self.destination = destination
        self.copiedCount = copiedCount
        self.manifestURL = manifestURL
    }
}

public final class AmbientAerialExporter {
    public init() {}

    public func export(
        channel: AmbientChannel,
        state: AmbientState,
        destination: URL
    ) throws -> AmbientAerialExportResult {
        let target = destination.appendingPathComponent(safeName(channel.name), isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)

        let videos = AmbientRuleEngine.assets(in: channel, state: state).filter { $0.kind == .video }
        var copiedNames: [String] = []
        for asset in videos {
            guard FileManager.default.fileExists(atPath: asset.path) else { continue }
            let output = uniqueDestination(for: asset.url, in: target)
            try FileManager.default.copyItem(at: asset.url, to: output)
            copiedNames.append(output.lastPathComponent)
        }

        let manifest = AmbientAerialManifest(
            channelName: channel.name,
            videos: copiedNames.sorted(),
            powerPolicy: state.powerPolicy
        )
        let manifestURL = target.appendingPathComponent("ambient-playlist.json")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(manifest).write(to: manifestURL, options: .atomic)

        let instructionsURL = target.appendingPathComponent("README.txt")
        let instructions = """
        Project Ambient exported this local video playlist for Aerial.

        In Aerial, open Settings, add a local video source, and choose this folder:
        \(target.path)

        Project Ambient never uploads these files. Use Aerial's pause and Low Power Mode settings for the most efficient live playback.
        """
        try instructions.data(using: .utf8)?.write(to: instructionsURL, options: .atomic)

        return AmbientAerialExportResult(destination: target, copiedCount: copiedNames.count, manifestURL: manifestURL)
    }

    private func safeName(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "- _"))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
        let name = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "Ambient Playlist" : name
    }

    private func uniqueDestination(for source: URL, in directory: URL) -> URL {
        let initial = directory.appendingPathComponent(source.lastPathComponent)
        guard FileManager.default.fileExists(atPath: initial.path) else { return initial }
        let stem = source.deletingPathExtension().lastPathComponent
        let ext = source.pathExtension
        for index in 2...9_999 {
            let candidate = directory.appendingPathComponent("\(stem)-\(index).\(ext)")
            if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        return directory.appendingPathComponent("\(UUID().uuidString).\(ext)")
    }
}
