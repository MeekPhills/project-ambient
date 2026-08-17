import CryptoKit
import Foundation

public struct AmbientImportIssue: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case duplicate
        case unsupported
        case unreadable
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
    public var issues: [AmbientImportIssue]

    public init(mode: AmbientImportMode, importedCount: Int, issues: [AmbientImportIssue]) {
        self.mode = mode
        self.importedCount = importedCount
        self.issues = issues
        self.duplicateCount = issues.filter { $0.kind == .duplicate }.count
        self.unsupportedCount = issues.filter { $0.kind == .unsupported }.count
        self.unreadableCount = issues.filter { $0.kind == .unreadable }.count
    }

    public var summary: String {
        var parts = ["Imported \(importedCount) background\(importedCount == 1 ? "" : "s")"]
        if duplicateCount > 0 { parts.append("\(duplicateCount) duplicate\(duplicateCount == 1 ? "" : "s") skipped") }
        if unsupportedCount > 0 { parts.append("\(unsupportedCount) unsupported") }
        if unreadableCount > 0 { parts.append("\(unreadableCount) unreadable") }
        return parts.joined(separator: "; ") + "."
    }

    public var hasIssues: Bool { !issues.isEmpty }

    /// A complete spoken-first sentence for assistive technology: import mode,
    /// counts, the untouched-originals guarantee, and how many items need review.
    public var accessibleSummary: String {
        let modePhrase = mode == .copy
            ? "copied into Ambient's private library"
            : "referenced in place"
        var sentences = ["Imported \(importedCount) background\(importedCount == 1 ? "" : "s"), \(modePhrase)."]
        sentences.append("Original files remain untouched.")
        if hasIssues {
            sentences.append("\(issues.count) item\(issues.count == 1 ? " needs" : "s need") review; each has an actionable message in the import report.")
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
        managedDirectory: URL
    ) throws -> AmbientPreparedImport {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: folder.path])
        }

        if mode == .copy {
            try fileManager.createDirectory(at: managedDirectory, withIntermediateDirectories: true)
        }

        var knownHashes = Set(existing.compactMap { $0.provenance?.sourceSHA256 })
        var assets: [AmbientAsset] = []
        var issues: [AmbientImportIssue] = []
        var createdFiles: [URL] = []

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
                let digest = try sha256(of: source)
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
                    if !fileManager.fileExists(atPath: destination.path) {
                        try fileManager.copyItem(at: source, to: destination)
                        createdFiles.append(destination)
                    }
                } else {
                    destination = source.standardizedFileURL
                }

                let byteCount = Int64(values?.fileSize ?? 0)
                let tags = AmbientCatalogScanner.filenameTags(for: source.deletingPathExtension().lastPathComponent)
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
                    rights: AmbientAssetRights()
                ))
            } catch {
                issues.append(AmbientImportIssue(
                    kind: .unreadable,
                    fileName: fileName,
                    message: "\(fileName) could not be read: \(error.localizedDescription)"
                ))
            }
        }

        return AmbientPreparedImport(
            assets: assets,
            report: AmbientImportReport(mode: mode, importedCount: assets.count, issues: issues),
            createdFiles: createdFiles
        )
    }

    func rollback(createdFiles: [URL]) {
        for url in createdFiles {
            try? fileManager.removeItem(at: url)
        }
    }

    private func sha256(of url: URL) throws -> String {
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
