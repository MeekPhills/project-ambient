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
        // "still + Aerial on demand" is what the engine emits for the default
        // automatic policy outside Low Power Mode; tests must pin real values.
        let nowNext = AmbientNowNext(
            channel: nil,
            now: nil,
            next: nil,
            why: "Import a folder to begin.",
            isLowPowerModeEnabled: false,
            effectiveMode: "still + Aerial on demand"
        )

        let summary = nowNext.accessibleSummary
        XCTAssertTrue(summary.hasPrefix("No background is applied yet."))
        XCTAssertTrue(summary.contains("Channel: none."))
        XCTAssertTrue(summary.contains("Up next: no matching still."))
        XCTAssertTrue(summary.contains("Why: Import a folder to begin."))
        XCTAssertTrue(summary.contains("Mode: still + Aerial on demand."))
        XCTAssertFalse(summary.contains("Low Power Mode"))
    }

    func testNowNextAccessibleSummarySpeaksLowPowerModeExactlyOnceForAutomaticPolicy() {
        // The automatic-policy engine string already embeds "(Low Power Mode)";
        // the summary must not narrate the condition a second time.
        let nowNext = AmbientNowNext(
            channel: nil,
            now: nil,
            next: nil,
            why: "Battery saver is limiting motion.",
            isLowPowerModeEnabled: true,
            effectiveMode: "still (Low Power Mode)"
        )

        let summary = nowNext.accessibleSummary
        let mentions = summary.components(separatedBy: "Low Power Mode").count - 1
        XCTAssertEqual(mentions, 1) // only inside the mode string — nothing appended
        XCTAssertTrue(summary.contains("Mode: still (Low Power Mode)."))
        XCTAssertFalse(summary.contains("Low Power Mode is on."))
    }

    func testNowNextAccessibleSummaryAppendsLowPowerModeWhenModeStringOmitsIt() {
        // A forced policy ("still only") does not mention Low Power Mode, so
        // the summary must add the sentence itself.
        let nowNext = AmbientNowNext(
            channel: nil,
            now: nil,
            next: nil,
            why: "Efficiency policy is forced.",
            isLowPowerModeEnabled: true,
            effectiveMode: "still only"
        )

        XCTAssertTrue(nowNext.accessibleSummary.contains("Mode: still only. Low Power Mode is on."))
    }

    func testEmptyFolderReportReadsAsNothingFoundNotSuccess() {
        let report = AmbientImportReport(mode: .copy, importedCount: 0, issues: [])

        XCTAssertTrue(report.foundNothing)
        XCTAssertEqual(report.summary, "No supported backgrounds were found in that folder.")
        XCTAssertTrue(report.accessibleSummary.hasPrefix("No supported backgrounds were found in that folder."))
        XCTAssertTrue(report.accessibleSummary.contains("Original files remain untouched."))
        XCTAssertFalse(report.accessibleSummary.contains("Imported 0"))
    }
}
