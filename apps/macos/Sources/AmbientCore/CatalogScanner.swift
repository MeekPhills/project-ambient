import Foundation
import ImageIO
import Vision

public struct AmbientScanResult: Sendable {
    public var assets: [AmbientAsset]
    public var skippedCount: Int

    public init(assets: [AmbientAsset], skippedCount: Int) {
        self.assets = assets
        self.skippedCount = skippedCount
    }
}

public final class AmbientCatalogScanner {
    private let usesVisionClassification: Bool

    public static let imageExtensions: Set<String> = [
        "avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"
    ]
    public static let videoExtensions: Set<String> = [
        "m4v", "mov", "mp4"
    ]

    private static let keywordGroups: [(tag: String, terms: Set<String>)] = [
        ("beach", ["beach", "coast", "coastal", "ocean", "sea", "sand", "shore", "tropical", "surf", "water"]),
        ("sports", ["sport", "sports", "eagles", "phillies", "sixers", "flyers", "union", "football", "baseball", "basketball", "hockey", "soccer", "stadium", "arena", "touchdown", "goal", "championship"]),
        ("nature", ["nature", "forest", "tree", "mountain", "valley", "river", "lake", "waterfall", "flower", "wildlife", "desert", "canyon", "meadow"]),
        ("city", ["city", "skyline", "street", "building", "architecture", "philadelphia", "philly", "newyork", "chicago", "urban", "downtown"]),
        ("space", ["space", "galaxy", "nebula", "planet", "moon", "star", "stars", "astronomy", "cosmos"]),
        ("abstract", ["abstract", "gradient", "geometry", "geometric", "pattern", "texture"])
    ]

    /// Vision classification is opt-in because importing a large library must
    /// remain bounded and predictable on the base M4/16 GB tier.
    public init(usesVisionClassification: Bool = false) {
        self.usesVisionClassification = usesVisionClassification
    }

    public func scan(folders: [URL], existing: [AmbientAsset] = []) -> AmbientScanResult {
        let existingByPath = Dictionary(uniqueKeysWithValues: existing.map { ($0.path, $0) })
        var found: [AmbientAsset] = []
        var skipped = 0

        for folder in folders {
            guard let enumerator = FileManager.default.enumerator(
                at: folder,
                includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else {
                skipped += 1
                continue
            }

            for case let fileURL as URL in enumerator {
                let ext = fileURL.pathExtension.lowercased()
                let kind: AmbientAssetKind
                if Self.imageExtensions.contains(ext) {
                    kind = .image
                } else if Self.videoExtensions.contains(ext) {
                    kind = .video
                } else {
                    continue
                }

                let values = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey])
                guard values?.isRegularFile != false else { continue }
                let canonicalPath = fileURL.standardizedFileURL.path

                if var prior = existingByPath[canonicalPath] {
                    prior.modifiedAt = values?.contentModificationDate
                    found.append(prior)
                    continue
                }

                var tags = Self.filenameTags(for: fileURL.deletingPathExtension().lastPathComponent)
                if kind == .image, usesVisionClassification {
                    tags.formUnion(visionTags(for: fileURL))
                } else {
                    tags.insert("video")
                }

                found.append(AmbientAsset(
                    path: canonicalPath,
                    kind: kind,
                    fileName: fileURL.lastPathComponent,
                    tags: Array(tags),
                    modifiedAt: values?.contentModificationDate
                ))
            }
        }

        let unique = Dictionary(found.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
        return AmbientScanResult(
            assets: unique.values.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending },
            skippedCount: skipped
        )
    }

    public static func filenameTags(for name: String) -> Set<String> {
        let words = Set(
            name.lowercased()
                .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
                .map(String.init)
        )
        var tags: Set<String> = words
        for group in keywordGroups where !group.terms.isDisjoint(with: words) {
            tags.insert(group.tag)
        }
        return tags
    }

    private func visionTags(for url: URL) -> Set<String> {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: 512,
                kCGImageSourceCreateThumbnailWithTransform: true
              ] as CFDictionary) else {
            return []
        }

        let request = VNClassifyImageRequest()
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }

        let observations = (request.results ?? [])
            .filter { $0.confidence >= 0.18 }
            .prefix(8)

        var tags = Set<String>()
        for observation in observations {
            let normalized = observation.identifier
                .lowercased()
                .replacingOccurrences(of: "_", with: " ")
            let words = Set(normalized.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
            for group in Self.keywordGroups where !group.terms.isDisjoint(with: words) {
                tags.insert(group.tag)
            }
        }
        return tags
    }
}
