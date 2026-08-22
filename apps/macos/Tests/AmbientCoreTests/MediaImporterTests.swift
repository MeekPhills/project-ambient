import CryptoKit
import XCTest
@testable import AmbientCore

final class MediaImporterTests: XCTestCase {
    private var temporaryURLs: [URL] = []

    override func tearDownWithError() throws {
        for url in temporaryURLs { try? FileManager.default.removeItem(at: url) }
        temporaryURLs = []
    }

    func testReferenceImportPreservesSourcesAndReportsDuplicateAndUnsupportedFiles() throws {
        let source = try temporaryDirectory()
        let data = Data("same-image-bytes".utf8)
        let original = source.appendingPathComponent("Philadelphia Skyline.jpg")
        let duplicate = source.appendingPathComponent("Skyline Duplicate.jpg")
        let unsupported = source.appendingPathComponent("Read Me.txt")
        try data.write(to: original)
        try data.write(to: duplicate)
        try Data("notes".utf8).write(to: unsupported)
        let before = try digest(original)

        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))
        let result = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "reference-import-0001"
        )))

        XCTAssertEqual(result.importReport?.importedCount, 1)
        XCTAssertEqual(result.importReport?.duplicateCount, 1)
        XCTAssertEqual(result.importReport?.unsupportedCount, 1)
        XCTAssertEqual(try digest(original), before)
        XCTAssertEqual(try Data(contentsOf: duplicate), data)
        let asset = try XCTUnwrap(engine.state.assets.first)
        XCTAssertEqual(asset.path, original.path)
        XCTAssertEqual(asset.provenance?.sourceSHA256, before)
        XCTAssertEqual(asset.provenance?.importMode, .reference)
        XCTAssertEqual(asset.rights?.basis, .privateReference)
        XCTAssertFalse(asset.rights?.redistributionAllowed ?? true)
    }

    func testCopyImportCreatesManagedCopyWithoutChangingOriginal() throws {
        let source = try temporaryDirectory()
        let original = source.appendingPathComponent("Potomac Sunrise.png")
        let data = Data("source-image".utf8)
        try data.write(to: original)
        let before = try digest(original)
        let dataDirectory = try temporaryDirectory()
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))

        let result = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .copy,
            requestID: "copy-import-0001"
        )))

        XCTAssertEqual(result.importReport?.importedCount, 1)
        let asset = try XCTUnwrap(engine.state.assets.first)
        XCTAssertNotEqual(asset.path, original.path)
        XCTAssertTrue(asset.path.hasPrefix(dataDirectory.appendingPathComponent("Media").path))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: asset.path)), data)
        XCTAssertEqual(try digest(original), before)
        XCTAssertEqual(asset.provenance?.sourcePath, original.path)
        XCTAssertEqual(asset.provenance?.importMode, .copy)
    }

    func testTypedImportCommandIsIdempotentAcrossRestart() throws {
        let source = try temporaryDirectory()
        try Data("image".utf8).write(to: source.appendingPathComponent("City.jpg"))
        let dataDirectory = try temporaryDirectory()
        let command = AmbientCommand.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "stable-import-0001"
        ))

        let firstEngine = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        let first = try firstEngine.execute(command)
        let restarted = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        let replay = try restarted.execute(command)

        XCTAssertEqual(first.message, replay.message)
        XCTAssertEqual(restarted.state.assets.count, 1)
        XCTAssertEqual(restarted.state.requestLedger?.last?.requestID, "stable-import-0001")
    }

    func testLegacyAssetWithoutProvenanceStillDecodes() throws {
        let json = """
        {
          "id": "A0000000-0000-4000-8000-000000000099",
          "path": "/Pictures/legacy.jpg",
          "kind": "image",
          "fileName": "legacy.jpg",
          "tags": [],
          "importedAt": "2026-08-13T00:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let asset = try decoder.decode(AmbientAsset.self, from: Data(json.utf8))
        XCTAssertNil(asset.provenance)
        XCTAssertNil(asset.rights)
    }

    func testAttributionManifestRoundTripsLicensedImport() throws {
        let source = try temporaryDirectory()
        let image = source.appendingPathComponent("Lake.jpg")
        try Data("licensed-image".utf8).write(to: image)
        let manifest = source.appendingPathComponent("photo-manifest.tsv")
        try Data("filename\tcreator\tlicense\tsource URL\nLake.jpg\tAda Creator\tCC BY 4.0\thttps://example.test/lake\n".utf8).write(to: manifest)

        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))
        let result = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "attribution-roundtrip-0001"
        )))

        let asset = try XCTUnwrap(engine.state.assets.first)
        XCTAssertEqual(asset.rights?.basis, .attributedLicense)
        XCTAssertEqual(asset.rights?.rightsholder, "Ada Creator")
        XCTAssertEqual(asset.rights?.license, "CC BY 4.0")
        XCTAssertEqual(asset.rights?.sourceURL, "https://example.test/lake")
        XCTAssertTrue(asset.rights?.requiresVisibleCredit == true)
        XCTAssertEqual(asset.rights?.creditLine, "Ada Creator · CC BY 4.0")
        XCTAssertEqual(result.importedAssets?.first?.rights, asset.rights)
        XCTAssertEqual(result.importReport?.unmatchedAttributionCount, 0)
        XCTAssertEqual(result.importReport?.unsupportedCount, 0)
    }

    func testPublicDomainManifestUsesExplicitPublicDomainBasis() throws {
        let source = try temporaryDirectory()
        try Data("public-domain-image".utf8).write(to: source.appendingPathComponent("Archive.png"))
        try Data("filename\tcreator\tlicense\tsource URL\nArchive.png\t\tPublic Domain\thttps://example.test/archive\n".utf8)
            .write(to: source.appendingPathComponent("photo-manifest.tsv"))

        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))
        _ = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "public-domain-0001"
        )))
        let rights = try XCTUnwrap(engine.state.assets.first?.rights)
        XCTAssertEqual(rights.basis, .publicDomain)
        XCTAssertTrue(rights.redistributionAllowed)
        XCTAssertTrue(rights.commercialUseVerified)
        XCTAssertFalse(rights.requiresVisibleCredit)
    }

    func testUnknownRightsBasisDecodesFailClosed() throws {
        let json = """
        {"basis":"future-license","redistributionAllowed":true,"commercialUseVerified":true,"rightsholder":"Unknown"}
        """
        let rights = try JSONDecoder().decode(AmbientAssetRights.self, from: Data(json.utf8))
        XCTAssertEqual(rights.basis, .privateReference)
        XCTAssertFalse(rights.redistributionAllowed)
        XCTAssertFalse(rights.commercialUseVerified)
    }

    func testUnmatchedAttributionRowsAreActionableIssues() throws {
        let source = try temporaryDirectory()
        try Data("filename\tcreator\tlicense\tsource URL\nMissing.jpg\tAda Creator\tCC BY 4.0\thttps://example.test/missing\n".utf8)
            .write(to: source.appendingPathComponent("photo-manifest.tsv"))
        try Data("actual".utf8).write(to: source.appendingPathComponent("Actual.jpg"))

        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))
        let result = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "unmatched-attribution-0001"
        )))
        XCTAssertEqual(result.importReport?.unmatchedAttributionCount, 1)
        let issue = try XCTUnwrap(result.importReport?.issues.first(where: { $0.kind == .unmatchedAttribution }))
        XCTAssertEqual(issue.fileName, "Missing.jpg")
        XCTAssertTrue(issue.message.contains("No imported media matched"))
    }

    func testImportSkipsAssetsAlreadyCatalogedByPathWithoutProvenance() throws {
        let source = try temporaryDirectory()
        let file = source.appendingPathComponent("Legacy.jpg")
        try Data("legacy-bytes".utf8).write(to: file)
        // A scanner-discovered asset: same path, no provenance hash.
        let legacy = AmbientAsset(path: file.standardizedFileURL.path, kind: .image, fileName: "Legacy.jpg")

        let importer = AmbientMediaImporter()
        let prepared = try importer.prepare(
            folder: source,
            mode: .reference,
            existing: [legacy],
            managedDirectory: try temporaryDirectory()
        )

        XCTAssertTrue(prepared.assets.isEmpty)
        XCTAssertEqual(prepared.report.duplicateCount, 1)
    }

    func testScannerToleratesDuplicatePathsInStoredState() throws {
        let asset = AmbientAsset(path: "/Pictures/x.jpg", kind: .image, fileName: "x.jpg")
        // Must not trap on duplicate keys — corrupted historical state would
        // otherwise crash every rescan.
        let result = AmbientCatalogScanner().scan(folders: [], existing: [asset, asset])
        XCTAssertTrue(result.assets.isEmpty)
    }

    func testRescanDoesNotTagImagesAsVideo() throws {
        let folder = try temporaryDirectory()
        try Data("img".utf8).write(to: folder.appendingPathComponent("Beach.jpg"))
        try Data("vid".utf8).write(to: folder.appendingPathComponent("Clip.mov"))

        let result = AmbientCatalogScanner().scan(folders: [folder])

        let image = try XCTUnwrap(result.assets.first(where: { $0.kind == .image }))
        let video = try XCTUnwrap(result.assets.first(where: { $0.kind == .video }))
        XCTAssertFalse(image.tags.contains("video"))
        XCTAssertTrue(video.tags.contains("video"))
    }

    func testImportedVideoCarriesVideoTagLikeScannedVideos() throws {
        let source = try temporaryDirectory()
        try Data("vid".utf8).write(to: source.appendingPathComponent("Sunset.mov"))

        let prepared = try AmbientMediaImporter().prepare(
            folder: source,
            mode: .reference,
            existing: [],
            managedDirectory: try temporaryDirectory()
        )

        let asset = try XCTUnwrap(prepared.assets.first)
        XCTAssertTrue(asset.tags.contains("video"))
    }

    func testReferenceImportRegistersFolderEvenWhenNothingImported() throws {
        let source = try temporaryDirectory()
        try Data("notes".utf8).write(to: source.appendingPathComponent("Read Me.txt"))
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))

        let result = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "register-empty-0001"
        )))

        XCTAssertEqual(result.importReport?.importedCount, 0)
        XCTAssertTrue(engine.state.libraryFolders.contains(source.standardizedFileURL.path))

        // The registration must survive a restart (state persisted).
        let restarted = try AmbientEngine(store: AmbientStateStore(directoryURL: engine.store.directoryURL))
        XCTAssertTrue(restarted.state.libraryFolders.contains(source.standardizedFileURL.path))
    }

    func testRescanDoesNotResurrectContentDuplicateOfImportedAsset() throws {
        let source = try temporaryDirectory()
        let bytes = Data("identical-image-bytes".utf8)
        try bytes.write(to: source.appendingPathComponent("Skyline.jpg"))
        try bytes.write(to: source.appendingPathComponent("Skyline Copy.jpg"))
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))

        let result = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "rescan-dedupe-0001"
        )))
        XCTAssertEqual(result.importReport?.importedCount, 1)
        XCTAssertEqual(result.importReport?.duplicateCount, 1)

        // Path-only reconciliation would re-add the skipped twin here, without
        // provenance or rights.
        XCTAssertEqual(engine.scanLibraries(), 1)
        XCTAssertEqual(engine.state.assets.count, 1)
        XCTAssertNotNil(engine.state.assets.first?.provenance)
    }

    func testLedgerKeepsBoundedIssueExcerptWithExactCounts() throws {
        let source = try temporaryDirectory()
        let unsupportedCount = AmbientEngine.maximumLedgerImportIssues * 2
        for index in 0..<unsupportedCount {
            try Data("notes".utf8).write(to: source.appendingPathComponent("Notes-\(index).txt"))
        }
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: try temporaryDirectory()))

        let live = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "ledger-bound-0001"
        )))
        XCTAssertEqual(live.importReport?.issues.count, unsupportedCount)

        let stored = try XCTUnwrap(engine.state.requestLedger?.last?.result.importReport)
        XCTAssertEqual(stored.issues.count, AmbientEngine.maximumLedgerImportIssues)
        XCTAssertEqual(stored.unsupportedCount, unsupportedCount)
        XCTAssertEqual(stored.reviewItemCount, unsupportedCount)
        XCTAssertTrue(stored.accessibleSummary.contains("\(unsupportedCount) items need review"))
    }

    func testInjectedImportFailureLeavesLastKnownGoodStateUnchanged() throws {
        let dataDirectory = try temporaryDirectory()
        let source = try temporaryDirectory()
        try Data("image".utf8).write(to: source.appendingPathComponent("City.jpg"))
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        _ = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "good-state-0001"
        )))
        // Compare identity, not whole structs: rolling back reloads state from
        // disk, where ISO-8601 encoding drops sub-second date precision.
        let goodAssetIDs = engine.state.assets.map(\.id)
        let goodDigests = engine.state.assets.compactMap { $0.provenance?.sourceSHA256 }
        let goodFolders = engine.state.libraryFolders

        let missing = source.appendingPathComponent("does-not-exist", isDirectory: true)
        XCTAssertThrowsError(try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: missing.path,
            mode: .copy,
            requestID: "failed-import-0001"
        ))))

        XCTAssertEqual(engine.state.assets.map(\.id), goodAssetIDs)
        XCTAssertEqual(engine.state.assets.compactMap { $0.provenance?.sourceSHA256 }, goodDigests)
        XCTAssertEqual(engine.state.libraryFolders, goodFolders)
        XCTAssertNil(engine.state.requestLedger?.first(where: { $0.requestID == "failed-import-0001" }))

        // The failure must not have been persisted either.
        let restarted = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        XCTAssertEqual(restarted.state.assets.map(\.id), goodAssetIDs)
        XCTAssertEqual(restarted.state.assets.compactMap { $0.provenance?.sourceSHA256 }, goodDigests)
        XCTAssertEqual(restarted.state.libraryFolders, goodFolders)
    }

    func testInjectedApplyFailureRestoresLastKnownGoodState() throws {
        let dataDirectory = try temporaryDirectory()
        let source = try temporaryDirectory()
        try Data("one".utf8).write(to: source.appendingPathComponent("One.jpg"))
        try Data("two".utf8).write(to: source.appendingPathComponent("Two.jpg"))
        let wallpaper = FailingWallpaperService()
        let engine = try AmbientEngine(
            store: AmbientStateStore(directoryURL: dataDirectory),
            wallpaper: wallpaper
        )
        _ = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "apply-good-0001"
        )))
        let applied = try engine.next(requestID: "apply-good-0002")
        let goodAssetID = try XCTUnwrap(applied.asset?.id)
        XCTAssertEqual(engine.state.currentAssetID, goodAssetID)
        let goodHistory = engine.state.history

        wallpaper.shouldFail = true
        XCTAssertThrowsError(try engine.next(requestID: "apply-fail-0001"))

        XCTAssertEqual(engine.state.currentAssetID, goodAssetID)
        XCTAssertEqual(engine.state.history, goodHistory)
        XCTAssertNil(engine.state.requestLedger?.first(where: { $0.requestID == "apply-fail-0001" }))

        let restarted = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        XCTAssertEqual(restarted.state.currentAssetID, goodAssetID)
        XCTAssertEqual(restarted.state.history, goodHistory)
    }

    func testRollbackRemovesFilesCreatedByAFailedCopyImport() throws {
        let managed = try temporaryDirectory()
        let created = managed.appendingPathComponent("partial-copy.jpg")
        try Data("partial".utf8).write(to: created)

        AmbientMediaImporter().rollback(createdFiles: [created])

        XCTAssertFalse(FileManager.default.fileExists(atPath: created.path))
    }

    func testRotationTriggerDefaultsToCadenceAndSurvivesRestart() throws {
        let dataDirectory = try temporaryDirectory()
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        XCTAssertNil(engine.state.rotationTrigger)

        let result = try engine.setRotationTrigger(.screenLock, requestID: "trigger-0001")
        XCTAssertEqual(result.action, "set_rotation_trigger")
        XCTAssertEqual(engine.state.rotationTrigger, .screenLock)

        let restarted = try AmbientEngine(store: AmbientStateStore(directoryURL: dataDirectory))
        XCTAssertEqual(restarted.state.rotationTrigger, .screenLock)

        // Replaying the same request is idempotent, like every other command.
        let replay = try restarted.setRotationTrigger(.screenLock, requestID: "trigger-0001")
        XCTAssertEqual(replay.message, result.message)
    }

    @MainActor
    func testPausedPlaybackSuppressesLockRotation() throws {
        let source = try temporaryDirectory()
        try Data("one".utf8).write(to: source.appendingPathComponent("One.jpg"))
        try Data("two".utf8).write(to: source.appendingPathComponent("Two.jpg"))
        let engine = try AmbientEngine(
            store: AmbientStateStore(directoryURL: try temporaryDirectory()),
            wallpaper: FailingWallpaperService()
        )
        _ = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: source.path,
            mode: .reference,
            requestID: "pause-import-0001"
        )))
        _ = try engine.setRotationTrigger(.screenLock, requestID: "pause-trigger-0001")
        _ = try engine.pause(requestID: "pause-0001")
        let beforeAssetID = engine.state.currentAssetID

        // The coordinator routes a lock through the same advance path a timer
        // uses, so pause must suppress it there too.
        try engine.advanceRotation(
            at: Date(),
            boundary: AmbientRotationBoundary(date: Date(), reasons: [.screenLock])
        )

        XCTAssertEqual(engine.state.currentAssetID, beforeAssetID)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-import-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        temporaryURLs.append(url)
        return url
    }

    private func digest(_ url: URL) throws -> String {
        let value = SHA256.hash(data: try Data(contentsOf: url))
        return value.map { String(format: "%02x", $0) }.joined()
    }
}

/// Applies successfully until `shouldFail` is set, then throws — the injected
/// apply failure #37 requires last-known-good state to survive.
private final class FailingWallpaperService: AmbientWallpaperApplying {
    var shouldFail = false

    func captureCurrentWallpapers() -> [String: String] { [:] }

    func apply(asset: AmbientAsset, scope: AmbientDisplayScope) throws {
        if shouldFail {
            throw CocoaError(.fileWriteNoPermission, userInfo: [NSFilePathErrorKey: asset.path])
        }
    }

    func restore(paths: [String: String]) throws {}
}
