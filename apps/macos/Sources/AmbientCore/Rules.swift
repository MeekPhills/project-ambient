import Foundation

public struct AmbientRuleResolution: Sendable {
    public var channel: AmbientChannel?
    public var reason: String

    public init(channel: AmbientChannel?, reason: String) {
        self.channel = channel
        self.reason = reason
    }
}

public enum AmbientRuleEngine {
    public static func scheduleMatches(
        _ schedule: AmbientSchedule,
        at date: Date,
        calendar: Calendar = .current
    ) -> Bool {
        let weekday = calendar.component(.weekday, from: date)
        if !schedule.weekdays.isEmpty && !schedule.weekdays.contains(weekday) {
            return false
        }

        let hour = calendar.component(.hour, from: date)
        let minute = calendar.component(.minute, from: date)
        let value = (hour * 60) + minute

        if schedule.startMinute <= schedule.endMinute {
            return value >= schedule.startMinute && value <= schedule.endMinute
        }
        // Overnight windows, such as 18:00–06:00.
        return value >= schedule.startMinute || value <= schedule.endMinute
    }

    public static func resolve(
        state: AmbientState,
        at date: Date = Date(),
        calendar: Calendar = .current
    ) -> AmbientRuleResolution {
        let matching = state.rules
            .filter { $0.isEnabled && scheduleMatches($0.schedule, at: date, calendar: calendar) }
            .sorted {
                if $0.priority != $1.priority { return $0.priority > $1.priority }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }

        if let rule = matching.first,
           let channel = state.channels.first(where: { $0.id == rule.channelID && $0.isEnabled }) {
            return AmbientRuleResolution(
                channel: channel,
                reason: "Rule “\(rule.name)” is active for this time and day."
            )
        }

        if let selected = state.channels.first(where: { $0.id == state.activeChannelID && $0.isEnabled }) {
            return AmbientRuleResolution(
                channel: selected,
                reason: "You selected the \(selected.name) channel."
            )
        }

        let fallback = state.channels.first(where: \.isEnabled)
        return AmbientRuleResolution(
            channel: fallback,
            reason: fallback == nil ? "Import a folder to begin." : "Using the first available channel."
        )
    }

    public static func assets(in channel: AmbientChannel?, state: AmbientState) -> [AmbientAsset] {
        guard let channel else { return [] }
        let matches: [AmbientAsset]
        switch channel.kind {
        case .manual:
            let ids = Set(channel.assetIDs)
            matches = state.assets.filter { ids.contains($0.id) }
        case .smart:
            if channel.includeTags.isEmpty {
                matches = state.assets
            } else {
                let tags = Set(channel.includeTags.map { $0.lowercased() })
                matches = state.assets.filter { asset in
                    !tags.isDisjoint(with: Set(asset.tags.map { $0.lowercased() }))
                }
            }
        }
        return matches.sorted {
            let nameOrder = $0.fileName.localizedStandardCompare($1.fileName)
            if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
            return $0.path < $1.path
        }
    }

    public static func nextAsset(after currentID: UUID?, in assets: [AmbientAsset]) -> AmbientAsset? {
        guard !assets.isEmpty else { return nil }
        guard let currentID, let index = assets.firstIndex(where: { $0.id == currentID }) else {
            return assets[0]
        }
        return assets[(index + 1) % assets.count]
    }
}
