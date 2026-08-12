import Foundation

public struct AmbientMutationResult: Codable, Sendable {
    public var ok: Bool
    public var action: String
    public var requestID: String?
    public var message: String
    public var channel: AmbientChannel?
    public var asset: AmbientAsset?
    public var expiresAt: Date?

    public init(
        ok: Bool = true,
        action: String,
        requestID: String? = nil,
        message: String,
        channel: AmbientChannel? = nil,
        asset: AmbientAsset? = nil,
        expiresAt: Date? = nil
    ) {
        self.ok = ok
        self.action = action
        self.requestID = requestID
        self.message = message
        self.channel = channel
        self.asset = asset
        self.expiresAt = expiresAt
    }
}

public struct AmbientHistoryItem: Codable, Sendable {
    public var position: Int
    public var asset: AmbientAsset

    public init(position: Int, asset: AmbientAsset) {
        self.position = position
        self.asset = asset
    }
}

public final class AmbientEngine {
    public let store: AmbientStateStore
    public let scanner: AmbientCatalogScanner
    public let wallpaper: AmbientWallpaperService
    public let aerialExporter: AmbientAerialExporter

    public private(set) var state: AmbientState

    public init(
        store: AmbientStateStore = AmbientStateStore(),
        scanner: AmbientCatalogScanner = AmbientCatalogScanner(),
        wallpaper: AmbientWallpaperService = AmbientWallpaperService(),
        aerialExporter: AmbientAerialExporter = AmbientAerialExporter()
    ) throws {
        self.store = store
        self.scanner = scanner
        self.wallpaper = wallpaper
        self.aerialExporter = aerialExporter
        self.state = try store.load()
        normalizeExpirations()
        try store.save(state)
    }

    public func reload() throws {
        state = try store.load()
        normalizeExpirations()
    }

    public func importFolder(_ url: URL) throws -> AmbientMutationResult {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: url.path])
        }
        let path = url.standardizedFileURL.path
        if !state.libraryFolders.contains(path) {
            state.libraryFolders.append(path)
            state.libraryFolders.sort()
        }
        let count = scanLibraries()
        return AmbientMutationResult(
            action: "import",
            message: "Imported \(count) compatible backgrounds from \(url.lastPathComponent)."
        )
    }

    @discardableResult
    public func scanLibraries() -> Int {
        let folders = state.libraryFolders.map { URL(fileURLWithPath: $0, isDirectory: true) }
        let result = scanner.scan(folders: folders, existing: state.assets)
        state.assets = result.assets
        state.lastScanAt = Date()
        if let current = state.currentAssetID, !state.assets.contains(where: { $0.id == current }) {
            state.currentAssetID = nil
        }
        try? store.save(state)
        return result.assets.count
    }

    public func resolve(at date: Date = Date()) -> AmbientRuleResolution {
        AmbientRuleEngine.resolve(state: state, at: date)
    }

    public func status(at date: Date = Date()) -> AmbientNowNext {
        let resolution = resolve(at: date)
        let eligible = desktopAssets(in: resolution.channel)
        let now = state.assets.first(where: { $0.id == state.currentAssetID })
        let next = AmbientRuleEngine.nextAsset(after: now?.id, in: eligible)
        let lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        let mode: String
        switch state.powerPolicy {
        case .automatic: mode = lowPower ? "still (Low Power Mode)" : "still + Aerial on demand"
        case .efficiency: mode = "still only"
        case .quality: mode = "still + Aerial motion"
        }
        let paused = state.playbackStatus == .paused ? " Playback is paused." : ""
        return AmbientNowNext(
            channel: resolution.channel,
            now: now,
            next: next,
            why: resolution.reason + paused,
            isLowPowerModeEnabled: lowPower,
            effectiveMode: mode
        )
    }

    public func channels() -> [AmbientChannel] {
        state.channels.filter(\.isEnabled)
    }

    public func channel(matching idOrName: String) -> AmbientChannel? {
        if let id = UUID(uuidString: idOrName), let exact = state.channels.first(where: { $0.id == id }) {
            return exact
        }
        return state.channels.first {
            $0.name.compare(idOrName, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
        } ?? state.channels.first {
            $0.name.localizedCaseInsensitiveContains(idOrName)
        }
    }

    @discardableResult
    public func addSmartChannel(name: String, tags: [String], symbol: String = "sparkles.rectangle.stack") throws -> AmbientChannel {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanTags = tags
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        guard !cleanName.isEmpty, !cleanTags.isEmpty else {
            throw NSError(
                domain: "ProjectAmbient",
                code: 422,
                userInfo: [NSLocalizedDescriptionKey: "A channel needs a name and at least one tag."]
            )
        }
        let channel = AmbientChannel(name: cleanName, symbol: symbol, includeTags: Array(Set(cleanTags)).sorted())
        state.channels.append(channel)
        try store.save(state)
        return channel
    }

    public func removeChannel(id: UUID) throws {
        guard !AmbientChannel.builtIns.contains(where: { $0.id == id }) else { return }
        state.channels.removeAll(where: { $0.id == id })
        state.rules.removeAll(where: { $0.channelID == id })
        if state.activeChannelID == id {
            state.activeChannelID = state.channels.first?.id
        }
        try store.save(state)
    }

    @discardableResult
    public func addRule(
        name: String,
        channelID: UUID,
        schedule: AmbientSchedule,
        priority: Int = 0
    ) throws -> AmbientRule {
        guard state.channels.contains(where: { $0.id == channelID }) else {
            throw NSError(
                domain: "ProjectAmbient",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "That channel no longer exists."]
            )
        }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let rule = AmbientRule(
            name: cleanName.isEmpty ? "Scheduled channel" : cleanName,
            channelID: channelID,
            schedule: schedule,
            priority: priority
        )
        state.rules.append(rule)
        try store.save(state)
        return rule
    }

    public func removeRule(id: UUID) throws {
        state.rules.removeAll(where: { $0.id == id })
        try store.save(state)
    }

    @discardableResult
    public func activate(
        _ idOrName: String,
        durationSeconds: Int? = nil,
        displayScope: AmbientDisplayScope = .all,
        requestID: String? = nil
    ) throws -> AmbientMutationResult {
        guard let channel = channel(matching: idOrName) else {
            throw NSError(
                domain: "ProjectAmbient",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "No channel matches “\(idOrName)”."]
            )
        }
        if let seconds = durationSeconds, seconds > 0 {
            state.previousActiveChannelID = state.activeChannelID
            state.channelActivationUntil = Date().addingTimeInterval(TimeInterval(seconds))
        } else {
            state.previousActiveChannelID = nil
            state.channelActivationUntil = nil
        }
        state.activeChannelID = channel.id
        try store.save(state)
        let result = try next(displayScope: displayScope, requestID: requestID)
        return AmbientMutationResult(
            action: "activate",
            requestID: requestID,
            message: "Activated \(channel.name). \(result.message)",
            channel: channel,
            asset: result.asset,
            expiresAt: state.channelActivationUntil
        )
    }

    @discardableResult
    public func next(
        displayScope: AmbientDisplayScope = .all,
        requestID: String? = nil
    ) throws -> AmbientMutationResult {
        normalizeExpirations()
        guard state.playbackStatus == .playing else {
            return AmbientMutationResult(
                ok: false,
                action: "next",
                requestID: requestID,
                message: "Playback is paused. Resume before advancing."
            )
        }
        let resolution = resolve()
        let eligible = desktopAssets(in: resolution.channel)
        guard let asset = AmbientRuleEngine.nextAsset(after: state.currentAssetID, in: eligible) else {
            return AmbientMutationResult(
                ok: false,
                action: "next",
                requestID: requestID,
                message: "No still images match this channel. Import images or export its videos to Aerial.",
                channel: resolution.channel
            )
        }

        if state.previousWallpaperPaths.isEmpty {
            state.previousWallpaperPaths = wallpaper.captureCurrentWallpapers()
        }
        try wallpaper.apply(asset: asset, scope: displayScope)
        state.currentAssetID = asset.id
        state.history.removeAll(where: { $0 == asset.id })
        state.history.insert(asset.id, at: 0)
        state.history = Array(state.history.prefix(100))
        try store.save(state)
        return AmbientMutationResult(
            action: "next",
            requestID: requestID,
            message: "Applied \(asset.fileName) to \(displayScope == .all ? "all displays" : "the primary display").",
            channel: resolution.channel,
            asset: asset
        )
    }

    @discardableResult
    public func pause(durationSeconds: Int? = nil, requestID: String? = nil) throws -> AmbientMutationResult {
        state.playbackStatus = .paused
        if let seconds = durationSeconds, seconds > 0 {
            state.pausedUntil = Date().addingTimeInterval(TimeInterval(seconds))
        } else {
            state.pausedUntil = nil
        }
        try store.save(state)
        return AmbientMutationResult(
            action: "pause",
            requestID: requestID,
            message: state.pausedUntil == nil ? "Paused until you resume." : "Paused temporarily.",
            expiresAt: state.pausedUntil
        )
    }

    @discardableResult
    public func resume(requestID: String? = nil) throws -> AmbientMutationResult {
        state.playbackStatus = .playing
        state.pausedUntil = nil
        try store.save(state)
        return AmbientMutationResult(
            action: "resume",
            requestID: requestID,
            message: "Background rotation resumed."
        )
    }

    @discardableResult
    public func setPowerPolicy(_ policy: AmbientPowerPolicy, requestID: String? = nil) throws -> AmbientMutationResult {
        state.powerPolicy = policy
        try store.save(state)
        return AmbientMutationResult(
            action: "set_power_policy",
            requestID: requestID,
            message: "Power policy set to \(policy.title)."
        )
    }

    public func history(limit: Int) -> [AmbientHistoryItem] {
        Array(state.history.prefix(max(0, min(limit, 100))).enumerated()).compactMap { index, id in
            guard let asset = state.assets.first(where: { $0.id == id }) else { return nil }
            return AmbientHistoryItem(position: index + 1, asset: asset)
        }
    }

    @discardableResult
    public func restore(requestID: String? = nil) throws -> AmbientMutationResult {
        try wallpaper.restore(paths: state.previousWallpaperPaths)
        state.currentAssetID = nil
        state.playbackStatus = .paused
        try store.save(state)
        return AmbientMutationResult(
            action: "restore",
            requestID: requestID,
            message: "Restored the wallpapers that were active before Project Ambient."
        )
    }

    public func exportAerial(channel idOrName: String, destination: URL) throws -> AmbientAerialExportResult {
        guard let channel = channel(matching: idOrName) else {
            throw NSError(
                domain: "ProjectAmbient",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "No channel matches “\(idOrName)”."]
            )
        }
        return try aerialExporter.export(channel: channel, state: state, destination: destination)
    }

    private func desktopAssets(in channel: AmbientChannel?) -> [AmbientAsset] {
        AmbientRuleEngine.assets(in: channel, state: state).filter { $0.kind == .image }
    }

    private func normalizeExpirations(now: Date = Date()) {
        if let until = state.pausedUntil, until <= now {
            state.playbackStatus = .playing
            state.pausedUntil = nil
        }
        if let until = state.channelActivationUntil, until <= now {
            state.activeChannelID = state.previousActiveChannelID ?? state.activeChannelID
            state.previousActiveChannelID = nil
            state.channelActivationUntil = nil
        }
    }
}
