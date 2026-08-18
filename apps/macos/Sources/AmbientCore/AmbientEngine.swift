import Foundation

public struct AmbientMutationResult: Codable, Sendable {
    public var ok: Bool
    public var action: String
    public var requestID: String?
    public var message: String
    public var channel: AmbientChannel?
    public var asset: AmbientAsset?
    public var expiresAt: Date?
    public var importReport: AmbientImportReport?

    public init(
        ok: Bool = true,
        action: String,
        requestID: String? = nil,
        message: String,
        channel: AmbientChannel? = nil,
        asset: AmbientAsset? = nil,
        expiresAt: Date? = nil,
        importReport: AmbientImportReport? = nil
    ) {
        self.ok = ok
        self.action = action
        self.requestID = requestID
        self.message = message
        self.channel = channel
        self.asset = asset
        self.expiresAt = expiresAt
        self.importReport = importReport
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

public enum AmbientIdempotencyError: LocalizedError {
    case invalidRequestID
    case requestConflict(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRequestID:
            return "A request ID must contain between 1 and 128 characters."
        case .requestConflict(let requestID):
            return "Request ID \(requestID) was already used for a different operation."
        }
    }
}

public final class AmbientEngine {
    private static let maximumRequestLedgerEntries = 128

    public let store: AmbientStateStore
    public let scanner: AmbientCatalogScanner
    public let wallpaper: any AmbientWallpaperApplying
    public let aerialExporter: AmbientAerialExporter
    public let importer: AmbientMediaImporter

    public private(set) var state: AmbientState

    public init(
        store: AmbientStateStore = AmbientStateStore(),
        scanner: AmbientCatalogScanner = AmbientCatalogScanner(),
        wallpaper: any AmbientWallpaperApplying = AmbientWallpaperService(),
        aerialExporter: AmbientAerialExporter = AmbientAerialExporter(),
        importer: AmbientMediaImporter = AmbientMediaImporter()
    ) throws {
        self.store = store
        self.scanner = scanner
        self.wallpaper = wallpaper
        self.aerialExporter = aerialExporter
        self.importer = importer
        self.state = try store.load()
        let transaction = try store.withExclusiveState { storedState in
            let changed = Self.normalizeExpirations(in: &storedState, now: Date())
            return ((), changed)
        }
        self.state = transaction.state
    }

    public func reload(at date: Date = Date()) throws {
        state = try store.load()
        _ = Self.normalizeExpirations(in: &state, now: date)
    }

    public func execute(_ command: AmbientCommand) throws -> AmbientMutationResult {
        switch command {
        case .importMedia(let input):
            return try importFolder(
                URL(fileURLWithPath: input.folderPath, isDirectory: true),
                mode: input.mode,
                requestID: input.requestID
            )
        }
    }

    public func importFolder(
        _ url: URL,
        mode: AmbientImportMode = .reference,
        requestID: String? = nil
    ) throws -> AmbientMutationResult {
        var createdFiles: [URL] = []
        do {
            return try idempotentMutation(
                requestID: requestID,
                fingerprint: fingerprint("import", url.standardizedFileURL.path, mode.rawValue)
            ) { [self] in
                let managedDirectory = store.directoryURL.appendingPathComponent("Media", isDirectory: true)
                let prepared = try importer.prepare(
                    folder: url,
                    mode: mode,
                    existing: state.assets,
                    managedDirectory: managedDirectory
                )
                createdFiles = prepared.createdFiles
                state.assets.append(contentsOf: prepared.assets)
                state.assets.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
                state.lastScanAt = Date()

                // Reference mode always registers the chosen folder — even a
                // zero-import run — so later additions appear on rescan, as the
                // pre-import behavior guaranteed. Copy mode registers the
                // managed directory only once it actually holds media.
                let libraryPath: String?
                if mode == .reference {
                    libraryPath = url.standardizedFileURL.path
                } else {
                    libraryPath = prepared.assets.isEmpty ? nil : managedDirectory.path
                }
                var libraryChanged = false
                if let libraryPath, !state.libraryFolders.contains(libraryPath) {
                    state.libraryFolders.append(libraryPath)
                    state.libraryFolders.sort()
                    libraryChanged = true
                }

                return (
                    AmbientMutationResult(
                        action: "import",
                        requestID: requestID,
                        message: prepared.report.summary,
                        importReport: prepared.report
                    ),
                    !prepared.assets.isEmpty || libraryChanged
                )
            }
        } catch {
            importer.rollback(createdFiles: createdFiles)
            throw error
        }
    }

    @discardableResult
    public func scanLibraries() -> Int {
        do {
            return try serializedMutation { [self] in
                (scanLibrariesUnlocked(at: Date()), true)
            }
        } catch {
            return state.assets.count
        }
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
        try serializedMutation { [self] in
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
            return (channel, true)
        }
    }

    public func removeChannel(id: UUID) throws {
        _ = try serializedMutation { [self] in
            guard !AmbientChannel.builtIns.contains(where: { $0.id == id }) else { return ((), false) }
            state.channels.removeAll(where: { $0.id == id })
            state.rules.removeAll(where: { $0.channelID == id })
            if state.activeChannelID == id {
                state.activeChannelID = state.channels.first?.id
            }
            return ((), true)
        }
    }

    @discardableResult
    public func addRule(
        name: String,
        channelID: UUID,
        schedule: AmbientSchedule,
        priority: Int = 0
    ) throws -> AmbientRule {
        try serializedMutation { [self] in
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
            return (rule, true)
        }
    }

    public func removeRule(id: UUID) throws {
        _ = try serializedMutation { [self] in
            let oldCount = state.rules.count
            state.rules.removeAll(where: { $0.id == id })
            return ((), state.rules.count != oldCount)
        }
    }

    @discardableResult
    public func activate(
        _ idOrName: String,
        durationSeconds: Int? = nil,
        displayScope: AmbientDisplayScope = .all,
        requestID: String? = nil
    ) throws -> AmbientMutationResult {
        let date = Date()
        return try idempotentMutation(
            requestID: requestID,
            fingerprint: fingerprint("activate", idOrName, String(durationSeconds ?? 0), displayScope.rawValue),
            at: date
        ) { [self] in
            guard let channel = channel(matching: idOrName) else {
                throw NSError(
                    domain: "ProjectAmbient",
                    code: 404,
                    userInfo: [NSLocalizedDescriptionKey: "No channel matches “\(idOrName)”."]
                )
            }
            if let seconds = durationSeconds, seconds > 0 {
                state.previousActiveChannelID = state.activeChannelID
                state.channelActivationUntil = date.addingTimeInterval(TimeInterval(seconds))
            } else {
                state.previousActiveChannelID = nil
                state.channelActivationUntil = nil
            }
            state.activeChannelID = channel.id
            let nextResult = try advanceWallpaper(displayScope: displayScope, at: date, requestID: requestID)
            return (
                AmbientMutationResult(
                    action: "activate",
                    requestID: requestID,
                    message: "Activated \(channel.name). \(nextResult.message)",
                    channel: channel,
                    asset: nextResult.asset,
                    expiresAt: state.channelActivationUntil
                ),
                true
            )
        }
    }

    @discardableResult
    public func next(
        displayScope: AmbientDisplayScope = .all,
        requestID: String? = nil,
        at date: Date = Date()
    ) throws -> AmbientMutationResult {
        try idempotentMutation(
            requestID: requestID,
            fingerprint: fingerprint("next", displayScope.rawValue),
            at: date
        ) { [self] in
            let result = try advanceWallpaper(displayScope: displayScope, at: date, requestID: requestID)
            return (result, result.ok)
        }
    }

    @discardableResult
    public func pause(durationSeconds: Int? = nil, requestID: String? = nil) throws -> AmbientMutationResult {
        let date = Date()
        return try idempotentMutation(
            requestID: requestID,
            fingerprint: fingerprint("pause", String(durationSeconds ?? 0)),
            at: date
        ) { [self] in
            state.playbackStatus = .paused
            if let seconds = durationSeconds, seconds > 0 {
                state.pausedUntil = date.addingTimeInterval(TimeInterval(seconds))
            } else {
                state.pausedUntil = nil
            }
            return (
                AmbientMutationResult(
                    action: "pause",
                    requestID: requestID,
                    message: state.pausedUntil == nil ? "Paused until you resume." : "Paused temporarily.",
                    expiresAt: state.pausedUntil
                ),
                true
            )
        }
    }

    @discardableResult
    public func resume(requestID: String? = nil) throws -> AmbientMutationResult {
        try idempotentMutation(requestID: requestID, fingerprint: fingerprint("resume")) { [self] in
            state.playbackStatus = .playing
            state.pausedUntil = nil
            return (
                AmbientMutationResult(
                    action: "resume",
                    requestID: requestID,
                    message: "Background rotation resumed."
                ),
                true
            )
        }
    }

    @discardableResult
    public func setPowerPolicy(_ policy: AmbientPowerPolicy, requestID: String? = nil) throws -> AmbientMutationResult {
        try idempotentMutation(
            requestID: requestID,
            fingerprint: fingerprint("set_power_policy", policy.rawValue)
        ) { [self] in
            let changed = state.powerPolicy != policy
            state.powerPolicy = policy
            return (
                AmbientMutationResult(
                    action: "set_power_policy",
                    requestID: requestID,
                    message: "Power policy set to \(policy.title)."
                ),
                changed
            )
        }
    }

    public func history(limit: Int) -> [AmbientHistoryItem] {
        Array(state.history.prefix(max(0, min(limit, 100))).enumerated()).compactMap { index, id in
            guard let asset = state.assets.first(where: { $0.id == id }) else { return nil }
            return AmbientHistoryItem(position: index + 1, asset: asset)
        }
    }

    @discardableResult
    public func restore(requestID: String? = nil) throws -> AmbientMutationResult {
        try idempotentMutation(requestID: requestID, fingerprint: fingerprint("restore")) { [self] in
            try wallpaper.restore(paths: state.previousWallpaperPaths)
            state.currentAssetID = nil
            state.playbackStatus = .paused
            state.pausedUntil = nil
            state.managedDisplayScope = nil
            return (
                AmbientMutationResult(
                    action: "restore",
                    requestID: requestID,
                    message: "Restored the wallpapers that were active before Project Ambient."
                ),
                true
            )
        }
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

    private func scanLibrariesUnlocked(at date: Date) -> Int {
        let folders = state.libraryFolders.map { URL(fileURLWithPath: $0, isDirectory: true) }
        let result = scanner.scan(folders: folders, existing: state.assets)
        state.assets = result.assets
        state.lastScanAt = date
        if let current = state.currentAssetID, !state.assets.contains(where: { $0.id == current }) {
            state.currentAssetID = nil
        }
        return result.assets.count
    }

    private func advanceWallpaper(
        displayScope: AmbientDisplayScope,
        at date: Date,
        requestID: String?
    ) throws -> AmbientMutationResult {
        guard state.playbackStatus == .playing else {
            return AmbientMutationResult(
                ok: false,
                action: "next",
                requestID: requestID,
                message: "Playback is paused. Resume before advancing."
            )
        }
        let resolution = resolve(at: date)
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
        state.managedDisplayScope = displayScope
        state.lastRotationAt = date
        state.history.removeAll(where: { $0 == asset.id })
        state.history.insert(asset.id, at: 0)
        state.history = Array(state.history.prefix(100))
        return AmbientMutationResult(
            action: "next",
            requestID: requestID,
            message: "Applied \(asset.fileName) to \(displayScope == .all ? "all displays" : "the primary display").",
            channel: resolution.channel,
            asset: asset
        )
    }

    private func serializedMutation<T>(
        at date: Date = Date(),
        _ operation: () throws -> (value: T, changed: Bool)
    ) throws -> T {
        let transaction = try store.withExclusiveState { storedState in
            let originalState = storedState
            self.state = storedState
            let normalized = Self.normalizeExpirations(in: &self.state, now: date)
            do {
                let output = try operation()
                storedState = self.state
                return (output.value, normalized || output.changed)
            } catch {
                self.state = originalState
                throw error
            }
        }
        state = transaction.state
        return transaction.value
    }

    private func idempotentMutation(
        requestID: String?,
        fingerprint: String,
        at date: Date = Date(),
        _ operation: () throws -> (result: AmbientMutationResult, changed: Bool)
    ) throws -> AmbientMutationResult {
        if let requestID, !(1...128).contains(requestID.count) {
            throw AmbientIdempotencyError.invalidRequestID
        }

        return try serializedMutation(at: date) { [self] in
            if let requestID,
               let existing = state.requestLedger?.last(where: { $0.requestID == requestID }) {
                guard existing.fingerprint == fingerprint else {
                    throw AmbientIdempotencyError.requestConflict(requestID)
                }
                return (existing.result, false)
            }

            let output = try operation()
            guard let requestID else { return (output.result, output.changed) }

            var ledger = state.requestLedger ?? []
            ledger.append(AmbientRequestLedgerEntry(
                requestID: requestID,
                fingerprint: fingerprint,
                result: output.result,
                recordedAt: date
            ))
            if ledger.count > Self.maximumRequestLedgerEntries {
                ledger.removeFirst(ledger.count - Self.maximumRequestLedgerEntries)
            }
            state.requestLedger = ledger
            return (output.result, true)
        }
    }

    private func fingerprint(_ fields: String...) -> String {
        // Encoding the field array avoids delimiter ambiguity in user-provided
        // channel names while keeping the ledger portable and inspectable.
        (try? JSONEncoder().encode(fields).base64EncodedString()) ?? fields.description
    }

    @discardableResult
    private static func normalizeExpirations(in state: inout AmbientState, now: Date) -> Bool {
        var changed = false
        if let until = state.pausedUntil, until <= now {
            state.playbackStatus = .playing
            state.pausedUntil = nil
            changed = true
        }
        if let until = state.channelActivationUntil, until <= now {
            state.activeChannelID = state.previousActiveChannelID ?? state.activeChannelID
            state.previousActiveChannelID = nil
            state.channelActivationUntil = nil
            changed = true
        }
        return changed
    }
}

extension AmbientEngine: AmbientRotationDriving {
    @MainActor
    public func rotationState(at date: Date) throws -> AmbientState {
        try reload(at: date)
        return state
    }

    @MainActor
    public func advanceRotation(at date: Date, boundary: AmbientRotationBoundary) throws {
        _ = try serializedMutation(at: date) { [self] in
            let scope = state.managedDisplayScope ?? .all
            let result = try advanceWallpaper(displayScope: scope, at: date, requestID: nil)
            return ((), result.ok)
        }
    }

    @MainActor
    public func reconcileRotation(at date: Date, reason: AmbientRotationReconciliationReason) throws {
        _ = try serializedMutation(at: date) { [self] in
            var capturedNewDisplayWallpaper = false
            if reason == .displayConfigurationChanged {
                let currentWallpapers = wallpaper.captureCurrentWallpapers()
                for (displayKey, path) in currentWallpapers
                    where state.previousWallpaperPaths[displayKey] == nil {
                    state.previousWallpaperPaths[displayKey] = path
                    capturedNewDisplayWallpaper = true
                }
            }

            let resolution = resolve(at: date)
            let eligible = desktopAssets(in: resolution.channel)
            let current = state.assets.first(where: { $0.id == state.currentAssetID })
            let scope = state.managedDisplayScope ?? .all

            if state.playbackStatus == .playing,
               current == nil || !eligible.contains(where: { $0.id == current?.id }) {
                let result = try advanceWallpaper(displayScope: scope, at: date, requestID: nil)
                return ((), capturedNewDisplayWallpaper || result.ok)
            }

            let shouldReapplyCurrent: Bool
            switch reason {
            case .launch, .wake, .displayConfigurationChanged:
                shouldReapplyCurrent = true
            case .powerStateChanged, .clockOrTimeZoneChanged, .stateStoreChanged:
                shouldReapplyCurrent = false
            }

            if shouldReapplyCurrent, let current {
                try wallpaper.apply(asset: current, scope: scope)
            }
            return ((), capturedNewDisplayWallpaper)
        }
    }
}
