import AmbientCore
import AppKit
import SwiftUI

final class AmbientAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct AmbientApp: App {
    @NSApplicationDelegateAdaptor(AmbientAppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("Project Ambient") {
            ContentView(model: model)
                .frame(minWidth: 980, minHeight: 680)
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Import Background Folder…") { model.chooseImportFolder() }
                    .keyboardShortcut("o", modifiers: [.command, .shift])
                Button("Next Background") { model.next() }
                    .keyboardShortcut(.rightArrow, modifiers: [.command])
                Button(model.state.playbackStatus == .paused ? "Resume Rotation" : "Pause Rotation") {
                    model.togglePause()
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])
            }
        }

        MenuBarExtra("Project Ambient", systemImage: "sparkles.rectangle.stack") {
            AmbientMenu(model: model)
        }

        Settings {
            SettingsView(model: model)
                .frame(width: 520, height: 360)
        }
    }
}

private struct AmbientMenu: View {
    @ObservedObject var model: AppModel

    var body: some View {
        if let now = model.nowNext.now {
            Label(now.fileName, systemImage: "photo")
        } else {
            Text("No background active")
        }
        Text(model.nowNext.channel?.name ?? "No channel")
            .foregroundStyle(.secondary)
        Divider()
        Button("Next Background") { model.next() }
            .keyboardShortcut("n")
        Button(model.state.playbackStatus == .paused ? "Resume" : "Pause") { model.togglePause() }
        Divider()
        Button("Open Project Ambient") {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.windows.first(where: { $0.canBecomeKey })?.makeKeyAndOrderFront(nil)
        }
        Button("Quit") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}
