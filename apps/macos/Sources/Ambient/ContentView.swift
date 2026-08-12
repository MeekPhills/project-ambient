import AmbientCore
import AppKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            Sidebar(model: model)
                .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 300)
        } detail: {
            ZStack {
                AmbientBackdrop()
                if model.state.assets.isEmpty {
                    EmptyLibraryView(model: model)
                } else {
                    DashboardView(model: model)
                }
            }
            .toolbar { toolbar }
        }
        .sheet(isPresented: $model.showingNewChannel) {
            NewChannelSheet(model: model)
        }
        .sheet(isPresented: $model.showingNewRule) {
            if let channel = model.selectedChannel ?? model.state.channels.first {
                NewRuleSheet(model: model, initialChannelID: channel.id)
            }
        }
        .alert("Project Ambient", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "Something went wrong.")
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if model.isWorking {
                ProgressView()
                    .controlSize(.small)
                    .help("Project Ambient is working")
            }
            Button {
                model.rescan()
            } label: {
                Label("Rescan", systemImage: "arrow.clockwise")
            }
            .disabled(model.state.libraryFolders.isEmpty || model.isWorking)

            Button {
                model.togglePause()
            } label: {
                Label(
                    model.state.playbackStatus == .paused ? "Resume" : "Pause",
                    systemImage: model.state.playbackStatus == .paused ? "play.fill" : "pause.fill"
                )
            }
            .disabled(model.isWorking)

            Button {
                model.next()
            } label: {
                Label("Next", systemImage: "forward.end.fill")
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.rightArrow, modifiers: [.command])
            .disabled(model.isWorking || model.state.playbackStatus == .paused)
        }
    }
}

private struct AmbientBackdrop: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        LinearGradient(
            colors: colorScheme == .dark
                ? [Color(red: 0.06, green: 0.07, blue: 0.11), Color(red: 0.10, green: 0.08, blue: 0.16)]
                : [Color(nsColor: .windowBackgroundColor), Color(red: 0.94, green: 0.92, blue: 1.0)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

private struct Sidebar: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(LinearGradient(
                            colors: [Color(red: 0.45, green: 0.25, blue: 0.98), Color(red: 0.15, green: 0.64, blue: 0.92)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                    Image(systemName: "sparkles.rectangle.stack.fill")
                        .foregroundStyle(.white)
                        .font(.system(size: 19, weight: .semibold))
                }
                .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("AMBIENT")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Text("Local • adaptive • yours")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(16)

            HStack {
                Text("CHANNELS")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    model.showingNewChannel = true
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.plain)
                .help("Create a smart channel")
                .accessibilityLabel("Create channel")
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(model.state.channels) { channel in
                        ChannelRow(
                            channel: channel,
                            count: model.assetCount(for: channel),
                            isSelected: model.selectedChannelID == channel.id
                        ) {
                            model.selectedChannelID = channel.id
                        }
                        .contextMenu {
                            Button("Activate") { model.activate(channel) }
                            if !AmbientChannel.builtIns.contains(where: { $0.id == channel.id }) {
                                Button("Delete", role: .destructive) {
                                    model.selectedChannelID = channel.id
                                    model.removeSelectedChannel()
                                }
                            }
                        }
                    }
                }
                .padding(10)
            }

            Divider()
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Local library", systemImage: "internaldrive")
                    Spacer()
                    Text("\(model.state.assets.count)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                Button {
                    model.chooseImportFolder()
                } label: {
                    Label("Import folder", systemImage: "folder.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(model.isWorking)
            }
            .padding(16)
        }
        .background(.ultraThinMaterial)
    }
}

private struct ChannelRow: View {
    var channel: AmbientChannel
    var count: Int
    var isSelected: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: channel.symbol)
                    .frame(width: 20)
                    .foregroundStyle(isSelected ? .white : .secondary)
                Text(channel.name)
                    .lineLimit(1)
                Spacer()
                Text("\(count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(isSelected ? Color.white.opacity(0.8) : Color.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(Color.accentColor.gradient)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(channel.name), \(count) backgrounds")
    }
}

private struct EmptyLibraryView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 24) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.12))
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 42, weight: .light))
                    .foregroundStyle(Color.accentColor)
            }
            .frame(width: 104, height: 104)
            VStack(spacing: 8) {
                Text("Make your desktop feel alive")
                    .font(.largeTitle.bold())
                Text("Choose a folder of images and videos. Ambient organizes it on your Mac, then gives every background a reason and a moment.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 620)
            }
            Button("Choose a background folder") {
                model.chooseImportFolder()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isWorking)

            HStack(spacing: 28) {
                OnboardingPoint(symbol: "lock.shield", title: "Stays local", detail: "No uploads")
                OnboardingPoint(symbol: "bolt", title: "Power aware", detail: "Still-first")
                OnboardingPoint(symbol: "wand.and.stars", title: "Auto organized", detail: "On-device")
            }
            .padding(.top, 8)
        }
        .padding(40)
    }
}

private struct OnboardingPoint: View {
    var symbol: String
    var title: String
    var detail: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .foregroundStyle(Color.accentColor)
                .font(.title2)
            Text(title).font(.callout.weight(.semibold))
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .frame(width: 110)
    }
}

private struct DashboardView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                HStack(alignment: .top, spacing: 18) {
                    CurrentBackgroundCard(model: model)
                        .frame(maxWidth: .infinity)
                    NowNextCard(model: model)
                        .frame(width: 310)
                }
                BackgroundGrid(model: model)
                RulesCard(model: model)
                PowerCard(model: model)
            }
            .padding(28)
            .frame(maxWidth: 1_350, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) {
            if let notice = model.notice {
                HStack(spacing: 8) {
                    Image(systemName: model.isWorking ? "hourglass" : "checkmark.circle.fill")
                        .foregroundStyle(model.isWorking ? Color.secondary : Color.green)
                    Text(notice).lineLimit(1)
                    Spacer()
                }
                .font(.callout)
                .padding(.horizontal, 16)
                .frame(height: 38)
                .background(.ultraThinMaterial)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 5) {
                Text(model.selectedChannel?.name ?? "Your backgrounds")
                    .font(.system(size: 31, weight: .bold, design: .rounded))
                Text("\(model.selectedAssets.count) backgrounds • organized locally")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let channel = model.selectedChannel {
                Button("Activate channel") { model.activate(channel) }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.state.activeChannelID == channel.id || model.isWorking)
            }
        }
    }
}

private struct CurrentBackgroundCard: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.black.opacity(0.12))
                if let asset = model.nowNext.now {
                    AssetArtwork(asset: asset)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.72)],
                        startPoint: .center,
                        endPoint: .bottom
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("NOW")
                            .font(.caption2.bold())
                            .foregroundStyle(.white.opacity(0.75))
                        Text(asset.fileName)
                            .font(.title2.bold())
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text(asset.tags.prefix(4).map { $0.capitalized }.joined(separator: " • "))
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(20)
                } else {
                    ContentUnavailableView(
                        "Ready when you are",
                        systemImage: "photo",
                        description: Text("Press Next to apply the first matching still image.")
                    )
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .shadow(color: .black.opacity(0.18), radius: 22, y: 10)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct NowNextCard: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Now, next & why", systemImage: "point.3.connected.trianglepath.dotted")
                .font(.headline)
            Divider()
            StatusLine(
                eyebrow: "CHANNEL",
                value: model.nowNext.channel?.name ?? "None",
                symbol: model.nowNext.channel?.symbol ?? "rectangle.stack"
            )
            StatusLine(
                eyebrow: "UP NEXT",
                value: model.nowNext.next?.fileName ?? "No matching still",
                symbol: "forward.end"
            )
            VStack(alignment: .leading, spacing: 6) {
                Text("WHY")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                Text(model.nowNext.why)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            HStack {
                Image(systemName: model.nowNext.isLowPowerModeEnabled ? "battery.25" : "bolt.fill")
                Text(model.nowNext.effectiveMode)
                    .lineLimit(1)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(model.nowNext.isLowPowerModeEnabled ? Color.orange : Color.green)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.thinMaterial, in: Capsule())
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.08)))
    }
}

private struct StatusLine: View {
    var eyebrow: String
    var value: String
    var symbol: String

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: symbol)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28, height: 28)
                .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 2) {
                Text(eyebrow).font(.caption2.bold()).foregroundStyle(.secondary)
                Text(value).font(.callout.weight(.semibold)).lineLimit(1)
            }
        }
    }
}

private struct BackgroundGrid: View {
    @ObservedObject var model: AppModel
    private let columns = [GridItem(.adaptive(minimum: 160, maximum: 230), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("In this channel").font(.title3.bold())
                Spacer()
                if model.selectedAssets.contains(where: { $0.kind == .video }) {
                    Button("Export videos to Aerial") { model.exportAerial() }
                        .buttonStyle(.link)
                }
            }
            if model.selectedAssets.isEmpty {
                Text("No backgrounds match this channel yet. Add a channel with filename tags that exist in your library, or import more files.")
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 20)
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(model.selectedAssets.prefix(24)) { asset in
                        VStack(alignment: .leading, spacing: 8) {
                            AssetArtwork(asset: asset)
                                .aspectRatio(16 / 10, contentMode: .fill)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    if asset.kind == .video {
                                        Image(systemName: "play.fill")
                                            .font(.caption)
                                            .foregroundStyle(.white)
                                            .padding(7)
                                            .background(.black.opacity(0.55), in: Circle())
                                            .padding(7)
                                    }
                                }
                            Text(asset.fileName)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                            Text(asset.tags.prefix(3).joined(separator: " • "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

private struct AssetArtwork: View {
    var asset: AmbientAsset

    var body: some View {
        Group {
            if asset.kind == .image, let image = NSImage(contentsOfFile: asset.path) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    LinearGradient(
                        colors: [Color.indigo.opacity(0.8), Color.cyan.opacity(0.55)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "film.stack")
                        .font(.system(size: 34, weight: .light))
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
        }
        .clipped()
    }
}

private struct RulesCard: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Scheduled rules", systemImage: "calendar.badge.clock")
                        .font(.title3.bold())
                    Text("Higher-priority matching rules choose the channel deterministically.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Add rule") { model.showingNewRule = true }
            }
            if model.state.rules.isEmpty {
                Text("No schedule rules yet. Your selected channel stays active until you change it.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.state.rules.sorted(by: { $0.priority > $1.priority })) { rule in
                    HStack(spacing: 12) {
                        Image(systemName: "clock")
                            .foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(rule.name).font(.callout.weight(.semibold))
                            Text(ruleDescription(rule, channels: model.state.channels))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("P\(rule.priority)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Button(role: .destructive) { model.removeRule(rule) } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Delete \(rule.name)")
                    }
                    .padding(10)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func ruleDescription(_ rule: AmbientRule, channels: [AmbientChannel]) -> String {
        let channel = channels.first(where: { $0.id == rule.channelID })?.name ?? "Missing channel"
        func time(_ minute: Int) -> String {
            let date = Calendar.current.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: Date()) ?? Date()
            return date.formatted(date: .omitted, time: .shortened)
        }
        let days = rule.schedule.weekdays.isEmpty ? "every day" : "selected days"
        return "\(channel) • \(time(rule.schedule.startMinute))–\(time(rule.schedule.endMinute)) • \(days)"
    }
}

private struct PowerCard: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Power behavior", systemImage: "bolt.heart")
                .font(.title3.bold())
            Picker("Power behavior", selection: Binding(
                get: { model.state.powerPolicy },
                set: { model.setPowerPolicy($0) }
            )) {
                ForEach(AmbientPowerPolicy.allCases, id: \.self) { policy in
                    Text(policy.title).tag(policy)
                }
            }
            .pickerStyle(.segmented)
            Text("Public macOS APIs apply still images directly. Motion videos stay local and export to Aerial, which can pause for Low Power Mode and when the desktop is hidden.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Export selected channel to Aerial") { model.exportAerial() }
                Spacer()
                Button("Restore previous wallpaper", role: .destructive) { model.restore() }
            }
        }
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct NewChannelSheet: View {
    @ObservedObject var model: AppModel
    @State private var name = ""
    @State private var tags = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                Text("New smart channel").font(.title2.bold())
                Text("Ambient matches these tags against filenames and on-device visual categories.")
                    .foregroundStyle(.secondary)
            }
            Form {
                TextField("Channel name", text: $name, prompt: Text("Philadelphia sports"))
                TextField("Tags, separated by commas", text: $tags, prompt: Text("eagles, phillies, sports"))
            }
            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Create channel") { model.addChannel(name: name, tags: tags) }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || tags.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 500)
    }
}

private struct NewRuleSheet: View {
    @ObservedObject var model: AppModel
    @State private var name = ""
    @State private var channelID: UUID
    @State private var start = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var end = Calendar.current.date(bySettingHour: 17, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var weekdays: Set<Int> = [2, 3, 4, 5, 6]
    @State private var priority = 10
    @Environment(\.dismiss) private var dismiss

    init(model: AppModel, initialChannelID: UUID) {
        self.model = model
        _channelID = State(initialValue: initialChannelID)
    }

    private let days: [(Int, String)] = [(1, "S"), (2, "M"), (3, "T"), (4, "W"), (5, "T"), (6, "F"), (7, "S")]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Schedule a channel").font(.title2.bold())
            Form {
                TextField("Rule name", text: $name, prompt: Text("Workday focus"))
                Picker("Channel", selection: $channelID) {
                    ForEach(model.state.channels) { channel in
                        Text(channel.name).tag(channel.id)
                    }
                }
                HStack {
                    DatePicker("From", selection: $start, displayedComponents: .hourAndMinute)
                    DatePicker("To", selection: $end, displayedComponents: .hourAndMinute)
                }
                LabeledContent("Days") {
                    HStack(spacing: 6) {
                        ForEach(days, id: \.0) { value, label in
                            Button(label) {
                                if weekdays.contains(value) { weekdays.remove(value) } else { weekdays.insert(value) }
                            }
                            .buttonStyle(.bordered)
                            .tint(weekdays.contains(value) ? Color.accentColor : Color.secondary)
                            .accessibilityLabel("Toggle weekday \(value)")
                        }
                    }
                }
                Stepper("Priority: \(priority)", value: $priority, in: 0...100)
            }
            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add rule") {
                    model.addRule(
                        name: name,
                        channelID: channelID,
                        start: start,
                        end: end,
                        weekdays: weekdays.sorted(),
                        priority: priority
                    )
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 560)
    }
}

struct SettingsView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Form {
            Section("Power") {
                Picker("Behavior", selection: Binding(
                    get: { model.state.powerPolicy },
                    set: { model.setPowerPolicy($0) }
                )) {
                    ForEach(AmbientPowerPolicy.allCases, id: \.self) { policy in
                        Text(policy.title).tag(policy)
                    }
                }
                Text("Automatic honors macOS Low Power Mode. Efficiency always uses stills. Quality enables the Aerial motion workflow.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Privacy") {
                LabeledContent("Background library", value: "On this Mac")
                LabeledContent("Visual classification", value: "On-device Vision")
                LabeledContent("Telemetry", value: "Off")
            }
            Section("Recovery") {
                Button("Restore the wallpaper from before Ambient") { model.restore() }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}
