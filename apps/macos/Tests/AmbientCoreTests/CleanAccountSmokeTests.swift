import Foundation
import XCTest
@testable import AmbientCore

final class CleanAccountSmokeTests: XCTestCase {
    func testCleanAccountStaticImportReachesApplyWithoutPriorState() throws {
        let dataDirectory = try temporaryDirectory()
        let fixture = try temporaryDirectory()
        let image = fixture.appendingPathComponent("Clean Account Sunrise.jpg")
        try Data("clean-account-image".utf8).write(to: image)
        try Data("unsupported".utf8).write(to: fixture.appendingPathComponent("README.txt"))

        let wallpaper = SmokeWallpaper()
        let engine = try AmbientEngine(
            store: AmbientStateStore(directoryURL: dataDirectory),
            wallpaper: wallpaper
        )

        XCTAssertTrue(engine.state.assets.isEmpty)
        XCTAssertTrue(engine.state.requestLedger?.isEmpty ?? true)

        let importResult = try engine.execute(.importMedia(AmbientImportCommand(
            folderPath: fixture.path,
            mode: .reference,
            requestID: "clean-account-import-0001"
        )))
        XCTAssertEqual(importResult.importReport?.importedCount, 1)
        XCTAssertEqual(importResult.importReport?.unsupportedCount, 1)
        XCTAssertEqual(engine.state.assets.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: dataDirectory.appendingPathComponent("state.json").path))

        let applyResult = try engine.next(requestID: "clean-account-apply-0001")
        XCTAssertTrue(applyResult.ok)
        XCTAssertEqual(wallpaper.appliedAssets.map(\.fileName), ["Clean Account Sunrise.jpg"])

        let restarted = try AmbientEngine(
            store: AmbientStateStore(directoryURL: dataDirectory),
            wallpaper: SmokeWallpaper()
        )
        XCTAssertEqual(restarted.state.assets.count, 1)
        XCTAssertEqual(restarted.state.requestLedger?.count, 2)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-clean-account-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
}

private final class SmokeWallpaper: AmbientWallpaperApplying {
    private(set) var appliedAssets: [AmbientAsset] = []

    func captureCurrentWallpapers() -> [String: String] { [:] }
    func apply(asset: AmbientAsset, scope: AmbientDisplayScope) throws { appliedAssets.append(asset) }
    func restore(paths: [String: String]) throws {}
}
