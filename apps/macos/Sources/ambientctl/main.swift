import AmbientCore
import Darwin
import Foundation

private struct StatusEnvelope: Encodable {
    var ok = true
    var playbackStatus: AmbientPlaybackStatus
    var powerPolicy: AmbientPowerPolicy
    var libraryFolderCount: Int
    var assetCount: Int
    var imageCount: Int
    var videoCount: Int
    var lastScanAt: Date?
    var status: AmbientNowNext
}

private struct ChannelsEnvelope: Encodable {
    var ok = true
    var channels: [ChannelSummary]
}

private struct ChannelSummary: Encodable {
    var channel: AmbientChannel
    var assetCount: Int
    var imageCount: Int
    var videoCount: Int
}

private struct ChannelEnvelope: Encodable {
    var ok = true
    var result: ChannelSummary
}

private struct HistoryEnvelope: Encodable {
    var ok = true
    var items: [AmbientHistoryItem]
}

private struct ScanEnvelope: Encodable {
    var ok = true
    var assetCount: Int
    var scannedAt: Date
}

private struct AerialEnvelope: Encodable {
    var ok = true
    var destination: String
    var copiedCount: Int
    var manifest: String
}

private struct ErrorEnvelope: Encodable {
    var ok = false
    var error: String
    var usage: String?
}

private enum CLIError: LocalizedError {
    case usage(String)
    case unknownChannel(String)
    case invalidPolicy(String)
    case invalidRotationTrigger(String)
    case invalidScope(String)
    case invalidImportMode(String)

    var errorDescription: String? {
        switch self {
        case .usage(let value): return value
        case .unknownChannel(let value): return "No channel matches “\(value)”."
        case .invalidPolicy(let value): return "Unknown power policy “\(value)”. Use automatic, efficiency, or quality."
        case .invalidRotationTrigger(let value): return "Unknown rotation trigger “\(value)”. Use cadence or screen-lock."
        case .invalidScope(let value): return "Unknown display scope “\(value)”. Use all or primary."
        case .invalidImportMode(let value): return "Unknown import mode “\(value)”. Use copy or reference."
        }
    }
}

@main
private struct AmbientCLI {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.isEmpty || arguments.contains("--help") || arguments.contains("-h") {
                print(usage)
                return
            }
            let engine = try AmbientEngine()
            try execute(arguments, engine: engine)
        } catch {
            let showUsage = error is CLIError
            writeJSON(ErrorEnvelope(error: error.localizedDescription, usage: showUsage ? usage : nil), to: .standardError)
            exit(1)
        }
    }

    private static func execute(_ raw: [String], engine: AmbientEngine) throws {
        let arguments = raw.filter { $0 != "--json" }
        guard let command = arguments.first else { throw CLIError.usage("Missing command.") }

        switch command {
        case "status":
            let state = engine.state
            writeJSON(StatusEnvelope(
                playbackStatus: state.playbackStatus,
                powerPolicy: state.powerPolicy,
                libraryFolderCount: state.libraryFolders.count,
                assetCount: state.assets.count,
                imageCount: state.assets.filter { $0.kind == .image }.count,
                videoCount: state.assets.filter { $0.kind == .video }.count,
                lastScanAt: state.lastScanAt,
                status: engine.status()
            ))

        case "channels":
            guard arguments.count >= 2 else { throw CLIError.usage("Use channels list or channels get <id>.") }
            switch arguments[1] {
            case "list":
                writeJSON(ChannelsEnvelope(channels: engine.channels().map { summary($0, engine: engine) }))
            case "get":
                guard arguments.count >= 3 else { throw CLIError.usage("channels get requires a channel ID or name.") }
                guard let channel = engine.channel(matching: arguments[2]) else { throw CLIError.unknownChannel(arguments[2]) }
                writeJSON(ChannelEnvelope(result: summary(channel, engine: engine)))
            default:
                throw CLIError.usage("Use channels list or channels get <id>.")
            }

        case "next":
            let requestID = value(after: "--request-id", in: arguments)
            let scope = try displayScope(in: arguments)
            writeMutation(try engine.next(displayScope: scope, requestID: requestID), engine: engine)

        case "activate":
            guard arguments.count >= 2 else { throw CLIError.usage("activate requires a channel ID or name.") }
            let duration = intValue(after: "--duration", in: arguments)
            let requestID = value(after: "--request-id", in: arguments)
            let scope = try displayScope(in: arguments)
            writeMutation(try engine.activate(
                arguments[1],
                durationSeconds: duration,
                displayScope: scope,
                requestID: requestID
            ), engine: engine)

        case "pause":
            writeMutation(try engine.pause(
                durationSeconds: intValue(after: "--duration", in: arguments),
                requestID: value(after: "--request-id", in: arguments)
            ), engine: engine)

        case "resume":
            writeMutation(try engine.resume(requestID: value(after: "--request-id", in: arguments)), engine: engine)

        case "power-policy":
            guard arguments.count >= 3, arguments[1] == "set" else {
                throw CLIError.usage("Use power-policy set <automatic|efficiency|quality>.")
            }
            writeMutation(try engine.setPowerPolicy(
                try powerPolicy(arguments[2]),
                requestID: value(after: "--request-id", in: arguments)
            ), engine: engine)

        case "rotation-trigger":
            guard arguments.count >= 3, arguments[1] == "set" else {
                throw CLIError.usage("Use rotation-trigger set <cadence|screen-lock>.")
            }
            writeMutation(try engine.setRotationTrigger(
                try rotationTrigger(arguments[2]),
                requestID: value(after: "--request-id", in: arguments)
            ), engine: engine)

        case "history":
            let limit = intValue(after: "--limit", in: arguments) ?? 20
            writeJSON(HistoryEnvelope(items: engine.history(limit: limit)))

        case "restore":
            writeMutation(try engine.restore(requestID: value(after: "--request-id", in: arguments)), engine: engine)

        case "import":
            guard arguments.count >= 2, !arguments[1].hasPrefix("--") else {
                throw CLIError.usage("import requires a folder path before any flags.")
            }
            writeMutation(
                try engine.execute(.importMedia(AmbientImportCommand(
                    folderPath: arguments[1],
                    mode: try importMode(in: arguments),
                    requestID: value(after: "--request-id", in: arguments) ?? UUID().uuidString,
                    manifestPath: value(after: "--manifest", in: arguments)
                ))),
                engine: engine
            )

        case "scan":
            let count = engine.scanLibraries()
            writeMutation(
                ScanEnvelope(assetCount: count, scannedAt: engine.state.lastScanAt ?? Date()),
                engine: engine
            )

        case "export-aerial":
            guard arguments.count >= 2,
                  let destination = value(after: "--destination", in: arguments) else {
                throw CLIError.usage("export-aerial requires a channel and --destination <folder>.")
            }
            let result = try engine.exportAerial(
                channel: arguments[1],
                destination: URL(fileURLWithPath: destination, isDirectory: true)
            )
            writeJSON(AerialEnvelope(
                destination: result.destination.path,
                copiedCount: result.copiedCount,
                manifest: result.manifestURL.path
            ))

        default:
            throw CLIError.usage("Unknown command “\(command)”.")
        }
    }

    private static func summary(_ channel: AmbientChannel, engine: AmbientEngine) -> ChannelSummary {
        let assets = AmbientRuleEngine.assets(in: channel, state: engine.state)
        return ChannelSummary(
            channel: channel,
            assetCount: assets.count,
            imageCount: assets.filter { $0.kind == .image }.count,
            videoCount: assets.filter { $0.kind == .video }.count
        )
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private static func intValue(after flag: String, in arguments: [String]) -> Int? {
        value(after: flag, in: arguments).flatMap(Int.init)
    }

    private static func displayScope(in arguments: [String]) throws -> AmbientDisplayScope {
        guard let raw = value(after: "--display-scope", in: arguments) else { return .all }
        guard let scope = AmbientDisplayScope(rawValue: raw) else { throw CLIError.invalidScope(raw) }
        return scope
    }

    private static func rotationTrigger(_ raw: String) throws -> AmbientRotationTrigger {
        switch raw.lowercased().replacingOccurrences(of: "-", with: "_") {
        case "cadence", "schedule", "interval", "timer": return .cadence
        case "screen_lock", "lock", "on_lock", "lock_only": return .screenLock
        default: throw CLIError.invalidRotationTrigger(raw)
        }
    }

    private static func powerPolicy(_ raw: String) throws -> AmbientPowerPolicy {
        switch raw.lowercased().replacingOccurrences(of: "-", with: "_") {
        case "automatic", "balanced": return .automatic
        case "efficiency", "battery_saver", "low_power", "still_only": return .efficiency
        case "quality", "high_quality", "full_motion": return .quality
        default: throw CLIError.invalidPolicy(raw)
        }
    }

    private static func importMode(in arguments: [String]) throws -> AmbientImportMode {
        guard let raw = value(after: "--mode", in: arguments) else { return .reference }
        guard let mode = AmbientImportMode(rawValue: raw.lowercased()) else {
            throw CLIError.invalidImportMode(raw)
        }
        return mode
    }

    private static func writeJSON<T: Encodable>(_ value: T, to handle: FileHandle = .standardOutput) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        do {
            var data = try encoder.encode(value)
            data.append(0x0A)
            try handle.write(contentsOf: data)
        } catch {
            let fallback = "{\"ok\":false,\"error\":\"Unable to encode response\"}\n"
            try? handle.write(contentsOf: Data(fallback.utf8))
        }
    }

    private static func writeMutation<T: Encodable>(_ value: T, engine: AmbientEngine) {
        writeJSON(value)
        DistributedNotificationCenter.default().postNotificationName(
            AmbientRuntimeNotification.stateStoreChanged,
            object: nil,
            userInfo: ["revision": NSNumber(value: engine.state.stateRevision ?? 0)],
            deliverImmediately: true
        )
    }

    private static let usage = """
    ambientctl — local control for Project Ambient

    Commands:
      status --json
      channels list --json
      channels get <id-or-name> --json
      next [--display-scope all|primary] [--request-id <id>] --json
      activate <channel> [--display-scope all|primary] [--duration <seconds>] [--request-id <id>] --json
      pause [--duration <seconds>] [--request-id <id>] --json
      resume [--request-id <id>] --json
      power-policy set <automatic|efficiency|quality> [--request-id <id>] --json
      rotation-trigger set <cadence|screen-lock> [--request-id <id>] --json
      history [--limit <count>] --json
      restore [--request-id <id>] --json
      import <folder> [--mode copy|reference] [--manifest <photo-manifest.tsv>] [--request-id <id>] --json
      scan --json
      export-aerial <channel> --destination <folder> --json
    """
}
