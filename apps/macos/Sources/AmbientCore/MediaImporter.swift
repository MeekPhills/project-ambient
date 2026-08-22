import CryptoKit
import Foundation

public struct AmbientImportIssue: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case duplicate
        case unsupported
        case unreadable
        case copyFailed = "copy-failed"
        /// An attribution manifest row that matched no imported file.
        case unmatchedAttribution = "unmatched-attribution"
    }

    public var kind: Kind
    public var fileName: String
    public var message: String

    public init(kind: Kind, fileName: String, message: String) {
        self.kind = kind
        self.fileName = fileName
        self.message = message
    }
}

public struct AmbientImportReport: Codable, Sendable {
    public var mode: AmbientImportMode
    public var importedCount: Int
    public var duplicateCount: Int
    public var unsupportedCount: Int
    public var unreadableCount: Int
    public var copyFailedCount: Int
    public var unmatchedAttributionCount: Int
    public var issues: [AmbientImportIssue]

    private enum CodingKeys: String, CodingKey {
        case mode, importedCount, duplicateCount, unsupportedCount, unreadableCount, copyFailedCount, unmatchedAttributionCount, issues
    }

    public init(mode: AmbientImportMode, importedCount: Int, issues: [AmbientImportIssue], unmatchedAttributionCount: Int = 0) {
        self.mode = mode
        self.importedCount = importedCount
        self.issues = issues
        self.duplicateCount = issues.filter { $0.kind == .duplicate }.count
        self.unsupportedCount = issues.filter { $0.kind == .unsupported }.count
        self.unreadableCount = issues.filter { $0.kind == .unreadable }.count
        self.copyFailedCount = issues.filter { $0.kind == .copyFailed }.count
        self.unmatchedAttributionCount = unmatchedAttributionCount
    }

    /// Reports persisted before copy-failure reporting existed omit the key;
    /// decoding them as zero keeps an old state file loadable.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        mode = try container.decode(AmbientImportMode.self, forKey: .mode)
        importedCount = try container.decode(Int.self, forKey: .importedCount)
        duplicateCount = try container.decode(Int.self, forKey: .duplicateCount)
        unsupportedCount = try container.decode(Int.self, forKey: .unsupportedCount)
        unreadableCount = try container.decode(Int.self, forKey: .unreadableCount)
        copyFailedCount = try container.decodeIfPresent(Int.self, forKey: .copyFailedCount) ?? 0
        unmatchedAttributionCount = try container.decodeIfPresent(Int.self, forKey: .unmatchedAttributionCount) ?? 0
        issues = try container.decode([AmbientImportIssue].self, forKey: .issues)
    }

    /// Counts, never `issues.count`: a ledger-stored report keeps an excerpt of
    /// the per-file rows but must still state the true totals.
    public var reviewItemCount: Int {
        duplicateCount + unsupportedCount + unreadableCount + copyFailedCount + unmatchedAttributionCount
    }

    /// A bounded excerpt for durable storage. The request ledger lives in
    /// `state.json` and is rewritten on every mutation, so an import that
    /// skipped thousands of files must not be persisted row-for-row.
    public func truncatingIssues(to limit: Int) -> AmbientImportReport {
        guard issues.count > limit else { return self }
        var excerpt = self
        excerpt.issues = Array(issues.prefix(limit))
        return excerpt
    }

    public var summary: String {
        if foundNothing {
            return "No supported backgrounds were found in that folder."
        }
        var parts = ["Imported \(importedCount) background\(importedCount == 1 ? "" : "s")"]
        if duplicateCount > 0 { parts.append("\(duplicateCount) duplicate\(duplicateCount == 1 ? "" : "s") skipped") }
        if unsupportedCount > 0 { parts.append("\(unsupportedCount) unsupported") }
        if unreadableCount > 0 { parts.append("\(unreadableCount) unreadable") }
        if copyFailedCount > 0 { parts.append("\(copyFailedCount) could not be copied") }
        if unmatchedAttributionCount > 0 { parts.append("\(unmatchedAttributionCount) attribution row\(unmatchedAttributionCount == 1 ? "" : "s") unmatched") }
        return parts.joined(separator: "; ") + "."
    }

    public var hasIssues: Bool { reviewItemCount > 0 }

    /// True when the folder yielded nothing at all — no imports and no
    /// skipped files. Presenting that as success would be misleading.
    public var foundNothing: Bool { importedCount == 0 && reviewItemCount == 0 }

    /// A complete spoken-first sentence for assistive technology: import mode,
    /// counts, the untouched-originals guarantee, and how many items need review.
    public var accessibleSummary: String {
        let modePhrase = mode == .copy
            ? "copied into Ambient's private library"
            : "referenced in place"
        var sentences: [String]
        if foundNothing {
            sentences = ["No supported backgrounds were found in that folder."]
        } else {
            sentences = ["Imported \(importedCount) background\(importedCount == 1 ? "" : "s"), \(modePhrase)."]
        }
        sentences.append("Original files remain untouched.")
        if hasIssues {
            sentences.append("\(reviewItemCount) item\(reviewItemCount == 1 ? " needs" : "s need") review; each has an actionable message in the import report.")
        }
        return sentences.joined(separator: " ")
    }
}

struct AmbientPreparedImport {
    var assets: [AmbientAsset]
    var report: AmbientImportReport
    var createdFiles: [URL]
}

public final class AmbientMediaImporter {
    private let fileManager: FileManager

    public init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    func prepare(
        folder: URL,
        mode: AmbientImportMode,
        existing: [AmbientAsset],
        managedDirectory: URL,
        attributionManifest: AmbientAttributionManifest? = nil,
        attributionManifestURL: URL? = nil
    ) throws -> AmbientPreparedImport {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: folder.path])
        }

        if mode == .copy {
            try fileManager.createDirectory(at: managedDirectory, withIntermediateDirectories: true)
        }

        var knownHashes = Set(existing.compactMap { $0.provenance?.sourceSHA256 })
        // Legacy assets discovered by the scanner have no provenance hash, so
        // hash dedupe alone would re-append them under the same path — and a
        // duplicate path corrupts the stored catalog.
        var knownPaths = Set(existing.map { $0.path })
        var assets: [AmbientAsset] = []
        var issues: [AmbientImportIssue] = []
        var createdFiles: [URL] = []
        var matchedAttributionFiles = Set<String>()

        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        guard let enumerator = fileManager.enumerator(
            at: folder,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            throw CocoaError(.fileReadUnknown, userInfo: [NSFilePathErrorKey: folder.path])
        }

        // Directory enumeration order is unspecified, so sort before processing:
        // which file of a duplicate set becomes the library asset must be stable.
        var candidates: [URL] = []
        for case let fileURL as URL in enumerator {
            candidates.append(fileURL)
        }
        candidates.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }

        for source in candidates {
            if let attributionManifestURL,
               source.standardizedFileURL.path == attributionManifestURL.standardizedFileURL.path {
                continue
            }
            let values = try? source.resourceValues(forKeys: Set(keys))
            guard values?.isRegularFile == true else { continue }
            let fileName = source.lastPathComponent
            let ext = source.pathExtension.lowercased()
            let kind: AmbientAssetKind
            if AmbientCatalogScanner.imageExtensions.contains(ext) {
                kind = .image
            } else if AmbientCatalogScanner.videoExtensions.contains(ext) {
                kind = .video
            } else {
                issues.append(AmbientImportIssue(
                    kind: .unsupported,
                    fileName: fileName,
                    message: "\(fileName) is not a supported image or video."
                ))
                continue
            }

            do {
                let digest = try Self.contentDigest(of: source)
                guard knownHashes.insert(digest).inserted else {
                    issues.append(AmbientImportIssue(
                        kind: .duplicate,
                        fileName: fileName,
                        message: "\(fileName) matches media already in the library."
                    ))
                    continue
                }

                let destination: URL
                if mode == .copy {
                    destination = managedDirectory.appendingPathComponent(
                        "\(digest.prefix(12))-\(safeFileName(fileName))",
                        isDirectory: false
                    )
                } else {
                    destination = source.standardizedFileURL
                }

                guard knownPaths.insert(destination.path).inserted else {
                    issues.append(AmbientImportIssue(
                        kind: .duplicate,
                        fileName: fileName,
                        message: "\(fileName) is already in the library."
                    ))
                    continue
                }

                if mode == .copy, !fileManager.fileExists(atPath: destination.path) {
                    do {
                        try fileManager.copyItem(at: source, to: destination)
                        createdFiles.append(destination)
                    } catch {
                        // A copy failure is a destination problem, not a source
                        // problem — do not blame the (readable) original.
                        issues.append(AmbientImportIssue(
                            kind: .copyFailed,
                            fileName: fileName,
                            message: "\(fileName) could not be copied into Ambient's library: \(error.localizedDescription)"
                        ))
                        knownHashes.remove(digest)
                        knownPaths.remove(destination.path)
                        continue
                    }
                }

                let byteCount = Int64(values?.fileSize ?? 0)
                var tags = AmbientCatalogScanner.filenameTags(for: source.deletingPathExtension().lastPathComponent)
                if kind == .video {
                    // The scanner guarantees this tag for videos; imports must
                    // not create assets whose channel membership differs.
                    tags.insert("video")
                }
                if let row = attributionManifest?.rows.first(where: { Self.normalizedManifestFilename($0.filename) == fileName }) {
                    matchedAttributionFiles.insert(Self.normalizedManifestFilename(row.filename))
                }
                assets.append(AmbientAsset(
                    path: destination.path,
                    kind: kind,
                    fileName: fileName,
                    tags: Array(tags),
                    modifiedAt: values?.contentModificationDate,
                    provenance: AmbientAssetProvenance(
                        importMode: mode,
                        sourcePath: source.standardizedFileURL.path,
                        sourceSHA256: digest,
                        sourceByteCount: byteCount,
                        sourceModifiedAt: values?.contentModificationDate
                    ),
                    rights: Self.rights(for: attributionManifest?.rows.first(where: { Self.normalizedManifestFilename($0.filename) == fileName }))
                ))
            } catch {
                issues.append(AmbientImportIssue(
                    kind: .unreadable,
                    fileName: fileName,
                    message: "\(fileName) could not be read: \(error.localizedDescription)"
                ))
            }
        }

        let unmatched = attributionManifest?.rows.filter { !matchedAttributionFiles.contains(Self.normalizedManifestFilename($0.filename)) } ?? []
        for row in unmatched {
            issues.append(AmbientImportIssue(
                kind: .unmatchedAttribution,
                fileName: row.filename,
                message: "No imported media matched attribution row \(row.filename). Check the filename and manifest folder."
            ))
        }

        return AmbientPreparedImport(
            assets: assets,
            report: AmbientImportReport(mode: mode, importedCount: assets.count, issues: issues, unmatchedAttributionCount: unmatched.count),
            createdFiles: createdFiles
        )
    }

    private static func normalizedManifestFilename(_ value: String) -> String {
        URL(fileURLWithPath: value).lastPathComponent
    }

    private static func rights(for row: AmbientAttributionManifest.Row?) -> AmbientAssetRights {
        guard let row else { return AmbientAssetRights() }
        let normalized = row.license.lowercased()
        let publicDomain = normalized == "public domain" || normalized == "cc0" || normalized.contains("cc0")
        return AmbientAssetRights(
            basis: publicDomain ? .publicDomain : .attributedLicense,
            redistributionAllowed: publicDomain,
            commercialUseVerified: publicDomain,
            rightsholder: row.creator,
            license: row.license,
            sourceURL: row.sourceURL,
            attributionRequired: !publicDomain && row.creator?.isEmpty == false
        )
    }

    func rollback(createdFiles: [URL]) {
        for url in createdFiles {
            try? fileManager.removeItem(at: url)
        }
    }

    /// Rescan reconciles the catalog by path, so a file whose bytes duplicate an
    /// already-imported asset would re-enter the library — without provenance or
    /// rights — silently undoing the dedupe the import just reported. Only files
    /// whose size matches a known asset are hashed, so a rescan with nothing to
    /// reconcile stays as cheap as before.
    static func removingContentDuplicates(
        from assets: [AmbientAsset],
        fileManager: FileManager = .default
    ) -> [AmbientAsset] {
        var ownerByDigest: [String: String] = [:]
        var knownSizes: Set<Int64> = []
        for asset in assets {
            guard let provenance = asset.provenance else { continue }
            ownerByDigest[provenance.sourceSHA256] = asset.path
            knownSizes.insert(provenance.sourceByteCount)
        }
        guard !ownerByDigest.isEmpty else { return assets }

        return assets.filter { asset in
            guard asset.provenance == nil else { return true }
            let url = URL(fileURLWithPath: asset.path)
            guard
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
                knownSizes.contains(Int64(size)),
                let digest = try? contentDigest(of: url),
                let owner = ownerByDigest[digest],
                owner != asset.path
            else { return true }
            return false
        }
    }

    static func contentDigest(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func safeFileName(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_ "))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "_" }
        let sanitized = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
        return sanitized.isEmpty ? "background" : sanitized
    }
}
