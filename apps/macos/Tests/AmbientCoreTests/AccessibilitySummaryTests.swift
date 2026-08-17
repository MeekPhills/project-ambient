import XCTest
@testable import AmbientCore

final class AccessibilitySummaryTests: XCTestCase {
    func testCopyImportReportAccessibleSummaryStatesModeGuaranteeAndReviewCount() {
        let report = AmbientImportReport(
            mode: .copy,
            importedCount: 3,
            issues: [
                AmbientImportIssue(kind: .duplicate, fileName: "Skyline Duplicate.jpg", message: "Duplicate of Philadelphia Skyline.jpg; it was skipped."),
                AmbientImportIssue(kind: .unsupported, fileName: "Read Me.txt", message: "Text files are not supported backgrounds.")
            ]
        )

        let summary = report.accessibleSummary
        XCTAssertTrue(summary.contains("Imported 3 backgrounds, copied into Ambient's private library."))
        XCTAssertTrue(summary.contains("Original files remain untouched."))
        XCTAssertTrue(summary.contains("2 items need review"))
    }

    func testReferenceImportReportAccessibleSummarySingularCleanRun() {
        let report = AmbientImportReport(mode: .reference, importedCount: 1, issues: [])

        let summary = report.accessibleSummary
        XCTAssertTrue(summary.contains("Imported 1 background, referenced in place."))
        XCTAssertTrue(summary.contains("Original files remain untouched."))
        XCTAssertFalse(summary.contains("review"))
        XCTAssertFalse(report.hasIssues)
    }

    func testSingleIssueUsesSingularNeedsPhrasing() {
        let report = AmbientImportReport(
            mode: .copy,
            importedCount: 0,
            issues: [AmbientImportIssue(kind: .unreadable, fileName: "Broken.jpg", message: "Broken.jpg could not be read.")]
        )

        XCTAssertTrue(report.accessibleSummary.contains("1 item needs review"))
    }

    func testNowNextAccessibleSummaryWithoutAppliedBackground() {
        let nowNext = AmbientNowNext(
            channel: nil,
            now: nil,
            next: nil,
            why: "Import a folder to begin.",
            isLowPowerModeEnabled: false,
            effectiveMode: "still"
        )

        let summary = nowNext.accessibleSummary
        XCTAssertTrue(summary.hasPrefix("No background is applied yet."))
        XCTAssertTrue(summary.contains("Channel: none."))
        XCTAssertTrue(summary.contains("Up next: no matching still."))
        XCTAssertTrue(summary.contains("Why: Import a folder to begin."))
        XCTAssertTrue(summary.contains("Mode: still."))
        XCTAssertFalse(summary.contains("Low Power Mode"))
    }

    func testNowNextAccessibleSummaryMentionsLowPowerModeWhenEnabled() {
        let nowNext = AmbientNowNext(
            channel: nil,
            now: nil,
            next: nil,
            why: "Rotation paused while Low Power Mode is on.",
            isLowPowerModeEnabled: true,
            effectiveMode: "efficiency"
        )

        XCTAssertTrue(nowNext.accessibleSummary.contains("Low Power Mode is on."))
    }
}
