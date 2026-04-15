// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ContextRestoreIOSKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "ContextRestoreIOSKit",
            targets: ["ContextRestoreIOSKit"]
        )
    ],
    targets: [
        .target(
            name: "ContextRestoreIOSKit",
            path: "Sources/ContextRestoreIOSKit"
        ),
        .testTarget(
            name: "ContextRestoreIOSKitTests",
            dependencies: ["ContextRestoreIOSKit"],
            path: "Tests/ContextRestoreIOSKitTests"
        )
    ]
)
