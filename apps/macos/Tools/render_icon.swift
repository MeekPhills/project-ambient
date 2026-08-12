import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: render_icon <output.png>\n".utf8))
    exit(2)
}

let size = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(1) }
NSGraphicsContext.current = context
context.imageInterpolation = .high
context.shouldAntialias = true

let canvas = NSRect(x: 0, y: 0, width: size, height: size)
let background = NSBezierPath(roundedRect: canvas, xRadius: 288, yRadius: 288)
NSColor(red: 0x11 / 255, green: 0x15 / 255, blue: 0x13 / 255, alpha: 1).setFill()
background.fill()

let ring = NSBezierPath(ovalIn: NSRect(x: 272, y: 272, width: 480, height: 480))
ring.lineWidth = 48
NSColor(red: 0xD9 / 255, green: 0xFF / 255, blue: 0x6C / 255, alpha: 1).setStroke()
ring.stroke()

func dot(centerX: CGFloat, centerY: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(ovalIn: NSRect(x: centerX - 80, y: centerY - 80, width: 160, height: 160)).fill()
}

// AppKit's bitmap coordinate system begins at the lower-left; positions mirror
// the shared SVG mark so Finder and the website remain visually identical.
dot(centerX: 512, centerY: 752, color: NSColor(red: 0xFF / 255, green: 0x8B / 255, blue: 0x6A / 255, alpha: 1))
dot(centerX: 720, centerY: 400, color: NSColor(red: 0x8E / 255, green: 0xDC / 255, blue: 0xFF / 255, alpha: 1))
dot(centerX: 304, centerY: 400, color: NSColor(red: 0xC3 / 255, green: 0xA6 / 255, blue: 0xFF / 255, alpha: 1))

context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
