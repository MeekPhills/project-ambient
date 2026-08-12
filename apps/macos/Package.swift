// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ProjectAmbient",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "AmbientCore", targets: ["AmbientCore"]),
        .executable(name: "Ambient", targets: ["Ambient"]),
        .executable(name: "ambientctl", targets: ["ambientctl"])
    ],
    targets: [
        .target(
            name: "AmbientCore",
            path: "Sources/AmbientCore"
        ),
        .executableTarget(
            name: "Ambient",
            dependencies: ["AmbientCore"],
            path: "Sources/Ambient"
        ),
        .executableTarget(
            name: "ambientctl",
            dependencies: ["AmbientCore"],
            path: "Sources/ambientctl"
        ),
        .testTarget(
            name: "AmbientCoreTests",
            dependencies: ["AmbientCore"],
            path: "Tests/AmbientCoreTests"
        )
    ],
    swiftLanguageModes: [.v5]
)
