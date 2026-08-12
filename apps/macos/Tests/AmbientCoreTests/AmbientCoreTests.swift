import XCTest
@testable import AmbientCore

final class AmbientCoreTests: XCTestCase {
    private var temporaryURLs: [URL] = []

    override func tearDownWithError() throws {
        for url in temporaryURLs {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryURLs = []
    }

    func testStateRoundTripPreservesChannelsAndPolicy() throws {
        let directory = try temporaryDirectory()
        let store = AmbientStateStore(directoryURL: directory)
        var state = AmbientState()
        state.powerPolicy = .efficiency
        state.libraryFolders = ["/Pictures/Wallpapers"]
        try store.save(state)

        let loaded = try store.load()
        XCTAssertEqual(loaded.version, AmbientState.schemaVersion)
        XCTAssertEqual(loaded.powerPolicy, .efficiency)
        XCTAssertEqual(loaded.libraryFolders, ["/Pictures/Wallpapers"])
        XCTAssertEqual(loaded.channels.map(\.id), AmbientChannel.builtIns.map(\.id))
    }

    func testFilenameClassifierFindsSportsAndBeachCategories() {
        XCTAssertTrue(AmbientCatalogScanner.filenameTags(for: "Eagles-Championship-2018").contains("sports"))
        XCTAssertTrue(AmbientCatalogScanner.filenameTags(for: "tropical_beach_sunset").contains("beach"))
    }

    func testScannerCatalogsSupportedFilesAndIgnoresOthers() throws {
        let directory = try temporaryDirectory()
        try Data("not-an-image".utf8).write(to: directory.appendingPathComponent("phillies-stadium.jpg"))
        try Data("video".utf8).write(to: directory.appendingPathComponent("ocean-surf.mp4"))
        try Data("notes".utf8).write(to: directory.appendingPathComponent("notes.txt"))

        let result = AmbientCatalogScanner().scan(folders: [directory])
        XCTAssertEqual(result.assets.count, 2)
        XCTAssertEqual(result.assets.first(where: { $0.kind == .image })?.tags.contains("sports"), true)
        XCTAssertEqual(result.assets.first(where: { $0.kind == .video })?.tags.contains("beach"), true)
    }

    func testRuleEngineUsesPriorityAndSupportsOvernightWindows() throws {
        let beach = AmbientChannel.builtIns.first(where: { $0.id == AmbientChannel.beachChannelID })!
        let city = AmbientChannel.builtIns.first(where: { $0.id == AmbientChannel.citiesChannelID })!
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(name: "Evening", channelID: beach.id, schedule: AmbientSchedule(startMinute: 18 * 60, endMinute: 6 * 60), priority: 5),
            AmbientRule(name: "Late city", channelID: city.id, schedule: AmbientSchedule(startMinute: 22 * 60, endMinute: 23 * 60), priority: 20)
        ]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 8, day: 12, hour: 22, minute: 30)))

        let result = AmbientRuleEngine.resolve(state: state, at: date, calendar: calendar)
        XCTAssertEqual(result.channel?.id, city.id)
        XCTAssertTrue(result.reason.contains("Late city"))
    }

    func testAssetSelectionIsStableAndWraps() {
        let first = AmbientAsset(path: "/a.jpg", kind: .image, fileName: "A.jpg")
        let second = AmbientAsset(path: "/b.jpg", kind: .image, fileName: "B.jpg")
        let assets = [first, second]
        XCTAssertEqual(AmbientRuleEngine.nextAsset(after: nil, in: assets)?.id, first.id)
        XCTAssertEqual(AmbientRuleEngine.nextAsset(after: first.id, in: assets)?.id, second.id)
        XCTAssertEqual(AmbientRuleEngine.nextAsset(after: second.id, in: assets)?.id, first.id)
    }

    func testAerialExportCopiesOnlyVideosAndWritesManifest() throws {
        let source = try temporaryDirectory()
        let destination = try temporaryDirectory()
        let videoURL = source.appendingPathComponent("beach-loop.mp4")
        let imageURL = source.appendingPathComponent("beach-still.jpg")
        try Data("video".utf8).write(to: videoURL)
        try Data("image".utf8).write(to: imageURL)

        let video = AmbientAsset(path: videoURL.path, kind: .video, fileName: videoURL.lastPathComponent, tags: ["beach"])
        let image = AmbientAsset(path: imageURL.path, kind: .image, fileName: imageURL.lastPathComponent, tags: ["beach"])
        let channel = AmbientChannel(name: "Coast", includeTags: ["beach"])
        let state = AmbientState(assets: [video, image], channels: [channel], activeChannelID: channel.id)

        let result = try AmbientAerialExporter().export(channel: channel, state: state, destination: destination)
        XCTAssertEqual(result.copiedCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.manifestURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: result.destination.appendingPathComponent("beach-loop.mp4").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: result.destination.appendingPathComponent("beach-still.jpg").path))
    }

    func testEnginePersistsChannelRuleAndPauseExpiry() throws {
        let directory = try temporaryDirectory()
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: directory))
        let channel = try engine.addSmartChannel(name: "Philadelphia", tags: ["eagles", "phillies"])
        _ = try engine.addRule(
            name: "Game day",
            channelID: channel.id,
            schedule: AmbientSchedule(startMinute: 900, endMinute: 1_200),
            priority: 40
        )
        let result = try engine.pause(durationSeconds: 60, requestID: "test-request")

        XCTAssertEqual(result.requestID, "test-request")
        XCTAssertNotNil(result.expiresAt)
        let reloaded = try AmbientStateStore(directoryURL: directory).load()
        XCTAssertTrue(reloaded.channels.contains(where: { $0.id == channel.id }))
        XCTAssertEqual(reloaded.rules.first?.name, "Game day")
        XCTAssertEqual(reloaded.playbackStatus, .paused)
    }

    func testConcurrentStateTransactionsPreserveEveryMutationAndRevision() throws {
        let directory = try temporaryDirectory()
        let seedStore = AmbientStateStore(directoryURL: directory)
        try seedStore.save(AmbientState())
        let identifiers = (0..<40).map { _ in UUID() }
        let errorLock = NSLock()
        var errors: [Error] = []

        DispatchQueue.concurrentPerform(iterations: identifiers.count) { index in
            do {
                let store = AmbientStateStore(directoryURL: directory)
                _ = try store.withExclusiveState { state in
                    state.history.append(identifiers[index])
                    return ((), true)
                }
            } catch {
                errorLock.lock()
                errors.append(error)
                errorLock.unlock()
            }
        }

        XCTAssertTrue(errors.isEmpty, "Unexpected transaction errors: \(errors)")
        let loaded = try seedStore.load()
        XCTAssertEqual(Set(loaded.history), Set(identifiers))
        XCTAssertEqual(loaded.stateRevision, 41)
    }

    func testConcurrentAmbientCtlProcessesSerializeMutations() throws {
        let directory = try temporaryDirectory()
        let store = AmbientStateStore(directoryURL: directory)
        try store.save(AmbientState())
        let executable = try ambientCtlExecutable()
        var processes: [Process] = []

        for index in 0..<12 {
            let process = Process()
            process.executableURL = executable
            process.arguments = [
                "power-policy", "set", index.isMultiple(of: 2) ? "automatic" : "efficiency",
                "--request-id", String(format: "subprocess-request-%04d", index),
                "--json"
            ]
            var environment = ProcessInfo.processInfo.environment
            environment["AMBIENT_DATA_DIR"] = directory.path
            process.environment = environment
            process.standardOutput = Pipe()
            process.standardError = Pipe()
            try process.run()
            processes.append(process)
        }

        for process in processes {
            process.waitUntilExit()
            XCTAssertEqual(process.terminationStatus, 0)
        }

        let loaded = try store.load()
        let requestIDs = Set((loaded.requestLedger ?? []).map(\.requestID))
        XCTAssertEqual(requestIDs.count, 12)
        for index in 0..<12 {
            XCTAssertTrue(requestIDs.contains(String(format: "subprocess-request-%04d", index)))
        }
    }

    private func ambientCtlExecutable() throws -> URL {
        let startingURLs = [
            Bundle(for: AmbientCoreTests.self).bundleURL,
            Bundle.main.bundleURL,
            URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        ]
        for startingURL in startingURLs {
            var directory = startingURL
            for _ in 0..<8 {
                let candidate = directory.appendingPathComponent("ambientctl")
                if FileManager.default.isExecutableFile(atPath: candidate.path) {
                    return candidate
                }
                directory.deleteLastPathComponent()
            }
        }
        throw XCTSkip("ambientctl build product was not available to the test bundle")
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }
}
