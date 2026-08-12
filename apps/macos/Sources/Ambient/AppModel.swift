import AmbientCore
import AppKit
import Combine
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var state = AmbientState()
    @Published private(set) var nowNext = AmbientNowNext(
        channel: nil,
        now: nil,
        next: nil,
        why: "Import a folder to begin.",
        isLowPowerModeEnabled: false,
        effectiveMode: "still"
    )
    @Published var selectedChannelID: UUID?
    @Published var isWorking = false
    @Published var notice: String?
    @Published var errorMessage: String?
    @Published var showingNewChannel = false
    @Published var showingNewRule = false

    private var engine: AmbientEngine?
    private var rotationCoordinator: AmbientRotationCoordinator?

    init() {
        do {
            let engine = try AmbientEngine()
            self.engine = engine
            refresh(rescheduleRotation: false)

            let coordinator = AmbientRotationCoordinator(
                driver: engine,
                scheduler: MacBoundaryScheduler(),
                events: MacRuntimeEventSource(),
                cadenceProvider: { state in
                    AmbientRotationCadence.production(
                        for: state.powerPolicy,
                        isLowPowerModeEnabled: ProcessInfo.processInfo.isLowPowerModeEnabled
                    )
                },
                onChange: { [weak self] in
                    self?.refresh(rescheduleRotation: false)
                },
                onError: { [weak self] error in
                    self?.errorMessage = error.localizedDescription
                }
            )
            rotationCoordinator = coordinator
            coordinator.start()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    var selectedChannel: AmbientChannel? {
        let id = selectedChannelID ?? state.activeChannelID
        return state.channels.first(where: { $0.id == id })
    }

    var selectedAssets: [AmbientAsset] {
        AmbientRuleEngine.assets(in: selectedChannel, state: state)
    }

    func assetCount(for channel: AmbientChannel) -> Int {
        AmbientRuleEngine.assets(in: channel, state: state).count
    }

    func refresh(rescheduleRotation: Bool = true) {
        guard let engine else { return }
        try? engine.reload()
        state = engine.state
        if selectedChannelID == nil || !state.channels.contains(where: { $0.id == selectedChannelID }) {
            selectedChannelID = state.activeChannelID
        }
        nowNext = engine.status()
        if rescheduleRotation {
            rotationCoordinator?.stateDidChange()
        }
    }

    func chooseImportFolder() {
        let panel = NSOpenPanel()
        panel.title = "Choose your background library"
        panel.message = "Project Ambient scans compatible images and videos locally."
        panel.prompt = "Import folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }

        perform("Scanning \(url.lastPathComponent)…") { engine in
            try engine.importFolder(url)
        }
    }

    func rescan() {
        perform("Refreshing your library…") { engine in
            let count = engine.scanLibraries()
            return AmbientMutationResult(action: "scan", message: "Found \(count) compatible backgrounds.")
        }
    }

    func activate(_ channel: AmbientChannel) {
        selectedChannelID = channel.id
        perform("Activating \(channel.name)…") { engine in
            try engine.activate(channel.id.uuidString)
        }
    }

    func next() {
        perform("Choosing the next background…") { engine in
            try engine.next()
        }
    }

    func togglePause() {
        let isPaused = state.playbackStatus == .paused
        perform(isPaused ? "Resuming…" : "Pausing…") { engine in
            isPaused ? try engine.resume() : try engine.pause()
        }
    }

    func setPowerPolicy(_ policy: AmbientPowerPolicy) {
        perform("Updating power policy…") { engine in
            try engine.setPowerPolicy(policy)
        }
    }

    func restore() {
        perform("Restoring your previous wallpaper…") { engine in
            try engine.restore()
        }
    }

    func addChannel(name: String, tags: String) {
        guard let engine else { return }
        do {
            let channel = try engine.addSmartChannel(
                name: name,
                tags: tags.split(separator: ",").map(String.init)
            )
            selectedChannelID = channel.id
            notice = "Created \(channel.name)."
            showingNewChannel = false
            refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func removeSelectedChannel() {
        guard let engine, let channel = selectedChannel else { return }
        do {
            try engine.removeChannel(id: channel.id)
            notice = "Removed \(channel.name)."
            selectedChannelID = nil
            refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addRule(name: String, channelID: UUID, start: Date, end: Date, weekdays: [Int], priority: Int) {
        guard let engine else { return }
        let calendar = Calendar.current
        let startMinute = calendar.component(.hour, from: start) * 60 + calendar.component(.minute, from: start)
        let endMinute = calendar.component(.hour, from: end) * 60 + calendar.component(.minute, from: end)
        do {
            _ = try engine.addRule(
                name: name,
                channelID: channelID,
                schedule: AmbientSchedule(startMinute: startMinute, endMinute: endMinute, weekdays: weekdays),
                priority: priority
            )
            notice = "Rule added."
            showingNewRule = false
            refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func removeRule(_ rule: AmbientRule) {
        guard let engine else { return }
        do {
            try engine.removeRule(id: rule.id)
            notice = "Rule removed."
            refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func exportAerial() {
        guard let channel = selectedChannel else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose an Aerial export folder"
        panel.message = "Project Ambient will create a playlist folder that Aerial can use as a local source."
        panel.prompt = "Export"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard let engine else { return }
        isWorking = true
        do {
            let result = try engine.exportAerial(channel: channel.id.uuidString, destination: url)
            notice = result.copiedCount == 0
                ? "No videos in \(channel.name); the Aerial playlist folder was still created."
                : "Exported \(result.copiedCount) videos for Aerial."
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }

    private func perform(_ progress: String, operation: (AmbientEngine) throws -> AmbientMutationResult) {
        guard let engine, !isWorking else { return }
        isWorking = true
        notice = progress
        defer { isWorking = false; refresh() }
        do {
            let result = try operation(engine)
            notice = result.message
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
