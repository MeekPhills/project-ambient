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
