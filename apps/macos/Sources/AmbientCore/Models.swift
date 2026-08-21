import Foundation

public enum AmbientAssetKind: String, Codable, CaseIterable, Sendable {
    case image
    case video
}

public enum AmbientImportMode: String, Codable, CaseIterable, Sendable {
    case copy
    case reference

    public var title: String {
        switch self {
        case .copy: return "Copy into Ambient"
        case .reference: return "Use files in place"
        }
    }
}

public struct AmbientAssetProvenance: Codable, Hashable, Sendable {
    public var importMode: AmbientImportMode
    public var sourcePath: String
    public var sourceSHA256: String
    public var sourceByteCount: Int64
    public var sourceModifiedAt: Date?

    public init(
        importMode: AmbientImportMode,
        sourcePath: String,
        sourceSHA256: String,
        sourceByteCount: Int64,
        sourceModifiedAt: Date?
    ) {
        self.importMode = importMode
        self.sourcePath = sourcePath
        self.sourceSHA256 = sourceSHA256
        self.sourceByteCount = sourceByteCount
        self.sourceModifiedAt = sourceModifiedAt
    }
}

public struct AmbientAssetRights: Codable, Hashable, Sendable {
    public enum Basis: String, Codable, Sendable {
        case privateReference
    }

    public var basis: Basis
    public var redistributionAllowed: Bool
    public var commercialUseVerified: Bool

    public init(
        basis: Basis = .privateReference,
        redistributionAllowed: Bool = false,
        commercialUseVerified: Bool = false
    ) {
        self.basis = basis
        self.redistributionAllowed = redistributionAllowed
        self.commercialUseVerified = commercialUseVerified
    }
}

public struct AmbientAsset: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var path: String
    public var kind: AmbientAssetKind
    public var fileName: String
    public var tags: [String]
    public var importedAt: Date
    public var modifiedAt: Date?
    /// Optional for backward compatibility with schema-v1 catalogs.
    public var provenance: AmbientAssetProvenance?
    /// Local private-reference is the fail-closed default for personal imports.
    public var rights: AmbientAssetRights?

    public init(
        id: UUID = UUID(),
        path: String,
        kind: AmbientAssetKind,
        fileName: String,
        tags: [String] = [],
        importedAt: Date = Date(),
        modifiedAt: Date? = nil,
        provenance: AmbientAssetProvenance? = nil,
        rights: AmbientAssetRights? = nil
    ) {
        self.id = id
        self.path = path
        self.kind = kind
        self.fileName = fileName
        self.tags = Array(Set(tags.map { $0.lowercased() })).sorted()
        self.importedAt = importedAt
        self.modifiedAt = modifiedAt
        self.provenance = provenance
        self.rights = rights
    }

    public var url: URL { URL(fileURLWithPath: path) }
}

public enum AmbientChannelKind: String, Codable, Sendable {
    case smart
    case manual
}

public struct AmbientChannel: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var symbol: String
    public var kind: AmbientChannelKind
    public var includeTags: [String]
    public var assetIDs: [UUID]
    public var isEnabled: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        symbol: String = "photo.stack",
        kind: AmbientChannelKind = .smart,
        includeTags: [String] = [],
        assetIDs: [UUID] = [],
        isEnabled: Bool = true
    ) {
        self.id = id
        self.name = name
        self.symbol = symbol
        self.kind = kind
        self.includeTags = includeTags.map { $0.lowercased() }
        self.assetIDs = assetIDs
        self.isEnabled = isEnabled
    }
}

public struct AmbientSchedule: Codable, Hashable, Sendable {
    /// Minutes after midnight in the user's current calendar/time zone.
    public var startMinute: Int
    public var endMinute: Int
    /// Calendar weekday values (Sunday = 1 ... Saturday = 7). Empty means every day.
    public var weekdays: [Int]

    public init(startMinute: Int = 0, endMinute: Int = 1_439, weekdays: [Int] = []) {
        self.startMinute = min(max(startMinute, 0), 1_439)
        self.endMinute = min(max(endMinute, 0), 1_439)
        self.weekdays = weekdays.filter { (1...7).contains($0) }
    }
}

public struct AmbientRule: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var channelID: UUID
    public var schedule: AmbientSchedule
    public var priority: Int
    public var isEnabled: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        channelID: UUID,
        schedule: AmbientSchedule = AmbientSchedule(),
        priority: Int = 0,
        isEnabled: Bool = true
    ) {
        self.id = id
        self.name = name
        self.channelID = channelID
        self.schedule = schedule
        self.priority = priority
        self.isEnabled = isEnabled
    }
}

public enum AmbientPlaybackStatus: String, Codable, CaseIterable, Sendable {
    case playing
    case paused
}

public enum AmbientRotationTrigger: String, Codable, CaseIterable, Sendable {
    /// Advance on the scheduled cadence (the long-standing behavior).
    case cadence
    /// Advance once per screen lock and never on a timer.
    case screenLock = "screen-lock"

    public var title: String {
        switch self {
        case .cadence: return "On a schedule"
        case .screenLock: return "Once per screen lock"
        }
    }

    public var explanation: String {
        switch self {
        case .cadence: return "Backgrounds change on the rotation schedule."
        case .screenLock: return "Backgrounds change when you lock the screen, never on a timer."
        }
    }
}

public enum AmbientPowerPolicy: String, Codable, CaseIterable, Sendable {
    /// Honor Low Power Mode and use stills while the desktop is mostly hidden.
    case automatic
    /// Always favor still images and avoid live playback.
    case efficiency
    /// Permit Aerial-compatible video playback whenever available.
    case quality

    public var title: String {
        switch self {
        case .automatic: return "Automatic"
        case .efficiency: return "Maximum efficiency"
        case .quality: return "Best motion"
        }
    }
}

public struct AmbientRequestLedgerEntry: Codable, Sendable {
    public var requestID: String
    public var fingerprint: String
    public var result: AmbientMutationResult
    public var recordedAt: Date

    public init(
        requestID: String,
        fingerprint: String,
        result: AmbientMutationResult,
        recordedAt: Date = Date()
    ) {
        self.requestID = requestID
        self.fingerprint = fingerprint
        self.result = result
        self.recordedAt = recordedAt
    }
}

public struct AmbientState: Codable, Sendable {
    public static let schemaVersion = 1

    public var version: Int
    public var libraryFolders: [String]
    public var assets: [AmbientAsset]
    public var channels: [AmbientChannel]
    public var rules: [AmbientRule]
    public var activeChannelID: UUID?
    public var previousActiveChannelID: UUID?
    public var channelActivationUntil: Date?
    public var currentAssetID: UUID?
    public var playbackStatus: AmbientPlaybackStatus
    public var pausedUntil: Date?
    public var powerPolicy: AmbientPowerPolicy
    public var previousWallpaperPaths: [String: String]
    public var history: [UUID]
    public var lastScanAt: Date?
    /// Monotonically increases for each serialized state mutation. Optional so
    /// schema-v1 state files written by older releases continue to decode.
    public var stateRevision: UInt64?
    /// Display intent for automatic rotation and lifecycle reconciliation.
    public var managedDisplayScope: AmbientDisplayScope?
    /// The most recent successful wallpaper advance, used to fence a due timer
    /// against an external command that already satisfied the same boundary.
    public var lastRotationAt: Date?
    /// Bounded, restart-persistent native idempotency ledger.
    public var requestLedger: [AmbientRequestLedgerEntry]?
    /// Optional so catalogs written before lock rotation existed keep decoding;
    /// `nil` means the cadence behavior those installs already have.
    public var rotationTrigger: AmbientRotationTrigger?

    public init(
        version: Int = AmbientState.schemaVersion,
        libraryFolders: [String] = [],
        assets: [AmbientAsset] = [],
        channels: [AmbientChannel] = AmbientChannel.builtIns,
        rules: [AmbientRule] = [],
        activeChannelID: UUID? = nil,
        previousActiveChannelID: UUID? = nil,
        channelActivationUntil: Date? = nil,
        currentAssetID: UUID? = nil,
        playbackStatus: AmbientPlaybackStatus = .playing,
        pausedUntil: Date? = nil,
        powerPolicy: AmbientPowerPolicy = .automatic,
        previousWallpaperPaths: [String: String] = [:],
        history: [UUID] = [],
        lastScanAt: Date? = nil,
        stateRevision: UInt64? = nil,
        managedDisplayScope: AmbientDisplayScope? = nil,
        lastRotationAt: Date? = nil,
        requestLedger: [AmbientRequestLedgerEntry]? = nil,
        rotationTrigger: AmbientRotationTrigger? = nil
    ) {
        self.version = version
        self.libraryFolders = libraryFolders
        self.assets = assets
        self.channels = channels
        self.rules = rules
        self.activeChannelID = activeChannelID ?? channels.first?.id
        self.previousActiveChannelID = previousActiveChannelID
        self.channelActivationUntil = channelActivationUntil
        self.currentAssetID = currentAssetID
        self.playbackStatus = playbackStatus
        self.pausedUntil = pausedUntil
        self.powerPolicy = powerPolicy
        self.previousWallpaperPaths = previousWallpaperPaths
        self.history = history
        self.lastScanAt = lastScanAt
        self.stateRevision = stateRevision
        self.managedDisplayScope = managedDisplayScope
        self.lastRotationAt = lastRotationAt
        self.requestLedger = requestLedger
        self.rotationTrigger = rotationTrigger
    }
}

public extension AmbientChannel {
    static let allChannelID = UUID(uuidString: "A0000000-0000-4000-8000-000000000001")!
    static let beachChannelID = UUID(uuidString: "A0000000-0000-4000-8000-000000000002")!
    static let sportsChannelID = UUID(uuidString: "A0000000-0000-4000-8000-000000000003")!
    static let natureChannelID = UUID(uuidString: "A0000000-0000-4000-8000-000000000004")!
    static let citiesChannelID = UUID(uuidString: "A0000000-0000-4000-8000-000000000005")!
    static let spaceChannelID = UUID(uuidString: "A0000000-0000-4000-8000-000000000006")!

    static var builtIns: [AmbientChannel] {
        [
            AmbientChannel(id: allChannelID, name: "All backgrounds", symbol: "rectangle.stack", includeTags: []),
            AmbientChannel(id: beachChannelID, name: "Beaches", symbol: "water.waves", includeTags: ["beach"]),
            AmbientChannel(id: sportsChannelID, name: "Sports moments", symbol: "sportscourt", includeTags: ["sports"]),
            AmbientChannel(id: natureChannelID, name: "Nature", symbol: "leaf", includeTags: ["nature"]),
            AmbientChannel(id: citiesChannelID, name: "Cities", symbol: "building.2", includeTags: ["city"]),
            AmbientChannel(id: spaceChannelID, name: "Space", symbol: "sparkles", includeTags: ["space"])
        ]
    }
}

public struct AmbientNowNext: Codable, Sendable {
    public var channel: AmbientChannel?
    public var now: AmbientAsset?
    public var next: AmbientAsset?
    public var why: String
    public var isLowPowerModeEnabled: Bool
    public var effectiveMode: String

    public init(
        channel: AmbientChannel?,
        now: AmbientAsset?,
        next: AmbientAsset?,
        why: String,
        isLowPowerModeEnabled: Bool,
        effectiveMode: String
    ) {
        self.channel = channel
        self.now = now
        self.next = next
        self.why = why
        self.isLowPowerModeEnabled = isLowPowerModeEnabled
        self.effectiveMode = effectiveMode
    }

    /// One spoken-first sentence covering the whole Now / Next / Why state,
    /// so assistive technology reads the card as a single coherent element.
    public var accessibleSummary: String {
        var sentences: [String] = []
        sentences.append(now.map { "Now showing \($0.fileName)." } ?? "No background is applied yet.")
        sentences.append("Channel: \(channel?.name ?? "none").")
        sentences.append(next.map { "Up next: \($0.fileName)." } ?? "Up next: no matching still.")
        sentences.append("Why: \(why)")
        var modeSentence = "Mode: \(effectiveMode)."
        // The engine's effectiveMode may already embed "(Low Power Mode)";
        // only add the sentence when it doesn't, or VoiceOver says it twice.
        if isLowPowerModeEnabled && !effectiveMode.localizedCaseInsensitiveContains("low power") {
            modeSentence += " Low Power Mode is on."
        }
        sentences.append(modeSentence)
        return sentences.joined(separator: " ")
    }
}
