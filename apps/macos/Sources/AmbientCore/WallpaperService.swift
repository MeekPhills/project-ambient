import AppKit
import Foundation

public enum AmbientWallpaperError: LocalizedError {
    case noScreens
    case missingFile(String)
    case unsupportedAsset

    public var errorDescription: String? {
        switch self {
        case .noScreens: return "No displays are available."
        case .missingFile(let path): return "The background file is missing: \(path)"
        case .unsupportedAsset: return "Video backgrounds play through the Aerial adapter; choose a still image to apply directly."
        }
    }
}

public enum AmbientDisplayScope: String, Codable, Sendable {
    case all
    case primary
}

public protocol AmbientWallpaperApplying: AnyObject {
    func captureCurrentWallpapers() -> [String: String]
    func apply(asset: AmbientAsset, scope: AmbientDisplayScope) throws
    func restore(paths: [String: String]) throws
}

public final class AmbientWallpaperService: AmbientWallpaperApplying {
    public init() {}

    public func captureCurrentWallpapers() -> [String: String] {
        var result: [String: String] = [:]
        for screen in NSScreen.screens {
            guard let key = displayKey(for: screen),
                  let url = NSWorkspace.shared.desktopImageURL(for: screen) else { continue }
            result[key] = url.path
        }
        return result
    }

    public func apply(asset: AmbientAsset, scope: AmbientDisplayScope = .all) throws {
        guard asset.kind == .image else { throw AmbientWallpaperError.unsupportedAsset }
        let url = asset.url
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw AmbientWallpaperError.missingFile(url.path)
        }
        let screens: [NSScreen]
        switch scope {
        case .all:
            screens = NSScreen.screens
        case .primary:
            screens = NSScreen.main.map { [$0] } ?? []
        }
        guard !screens.isEmpty else { throw AmbientWallpaperError.noScreens }
        for screen in screens {
            try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
        }
    }

    public func restore(paths: [String: String]) throws {
        guard !NSScreen.screens.isEmpty else { throw AmbientWallpaperError.noScreens }
        for screen in NSScreen.screens {
            guard let key = displayKey(for: screen), let path = paths[key] else { continue }
            let url = URL(fileURLWithPath: path)
            guard FileManager.default.fileExists(atPath: path) else { continue }
            try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
        }
    }

    private func displayKey(for screen: NSScreen) -> String? {
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return nil
        }
        return number.stringValue
    }
}
