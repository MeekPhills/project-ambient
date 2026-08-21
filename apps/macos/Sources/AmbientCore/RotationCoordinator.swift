import Foundation

public enum AmbientRotationBoundaryReason: String, CaseIterable, Hashable, Sendable {
    case recurringRotation
    case ruleSchedule
    case pauseExpiration
    case temporaryChannelExpiration
    /// Event-driven rather than scheduled: the screen locked while the rotation
    /// trigger was `screenLock`.
    case screenLock
}

public struct AmbientRotationBoundary: Equatable, Sendable {
    public var date: Date
    public var reasons: [AmbientRotationBoundaryReason]

    public init(date: Date, reasons: [AmbientRotationBoundaryReason]) {
        self.date = date
        self.reasons = reasons
    }
}

public struct AmbientRotationCadence: Equatable, Sendable {
    /// The production default rotates stills at quarter-hour boundaries. Keeping
    /// cadence explicit makes future preferences or efficiency tiers testable
    /// without coupling the coordinator to a repeating timer.
    public static let productionDefault = AmbientRotationCadence(interval: 15 * 60)
    public static let energySaving = AmbientRotationCadence(interval: 30 * 60)
    public static let disabled = AmbientRotationCadence(interval: nil)

    public var interval: TimeInterval?

    public init(interval: TimeInterval?) {
        self.interval = interval.flatMap { $0 > 0 ? $0 : nil }
    }

    public func nextDate(after date: Date) -> Date? {
        guard let interval else { return nil }
        let elapsed = date.timeIntervalSince1970
        let nextMultiple = floor(elapsed / interval) + 1
        return Date(timeIntervalSince1970: nextMultiple * interval)
    }

    public static func production(
        for powerPolicy: AmbientPowerPolicy,
        isLowPowerModeEnabled: Bool
    ) -> AmbientRotationCadence {
        switch powerPolicy {
        case .automatic:
            return isLowPowerModeEnabled ? .energySaving : .productionDefault
        case .efficiency:
            return .energySaving
        case .quality:
            return .productionDefault
        }
    }
}

/// Computes the next instant at which playback or the resolved channel can change.
/// The planner is intentionally pure so calendar, time-zone, and expiry behavior can
/// be verified without creating a timer or subscribing to an operating-system event.
public enum AmbientRotationSchedulePlanner {
    private struct RuntimeSignature: Equatable {
        var isPlaying: Bool
        var channelID: UUID?
    }

    public static func nextBoundary(
        in state: AmbientState,
        after date: Date,
        calendar: Calendar = .current,
        cadence: AmbientRotationCadence = .productionDefault
    ) -> AmbientRotationBoundary? {
        var candidates: [Date: Set<AmbientRotationBoundaryReason>] = [:]

        func addCandidate(_ candidate: Date?, reason: AmbientRotationBoundaryReason) {
            guard let candidate, candidate > date else { return }
            candidates[candidate, default: []].insert(reason)
        }

        if let pausedUntil = state.pausedUntil {
            addCandidate(pausedUntil, reason: .pauseExpiration)
        }
        if let activationUntil = state.channelActivationUntil {
            addCandidate(activationUntil, reason: .temporaryChannelExpiration)
        }
        addCandidate(cadence.nextDate(after: date), reason: .recurringRotation)

        let enabledRules = state.rules.filter(\.isEnabled)
        if !enabledRules.isEmpty {
            let firstDay = calendar.startOfDay(for: date)
            let finalDay = calendar.date(byAdding: .day, value: 15, to: firstDay)

            // A rule repeats within one week. Looking across two weeks also covers
            // transitions around daylight-saving changes without polling.
            for dayOffset in 0...14 {
                guard let day = calendar.date(byAdding: .day, value: dayOffset, to: firstDay) else {
                    continue
                }
                addCandidate(day, reason: .ruleSchedule)

                for rule in enabledRules {
                    let schedule = rule.schedule
                    for candidate in wallClockDates(
                        on: day,
                        minuteOfDay: schedule.startMinute,
                        calendar: calendar
                    ) {
                        addCandidate(candidate, reason: .ruleSchedule)
                    }

                    let minuteAfterEnd = schedule.endMinute + 1
                    for candidate in wallClockDates(
                        on: day,
                        minuteOfDay: minuteAfterEnd,
                        calendar: calendar
                    ) {
                        addCandidate(candidate, reason: .ruleSchedule)
                    }
                }
            }

            // A repeated or skipped wall-clock hour can change a schedule even when
            // neither endpoint has a unique Date. Treat the public time-zone
            // transition itself as another candidate and let signature comparison
            // decide whether it is meaningful.
            var daylightTransition = calendar.timeZone.nextDaylightSavingTimeTransition(after: date)
            while let transition = daylightTransition,
                  finalDay.map({ transition <= $0 }) ?? false {
                addCandidate(transition, reason: .ruleSchedule)
                daylightTransition = calendar.timeZone.nextDaylightSavingTimeTransition(
                    after: transition.addingTimeInterval(1)
                )
            }
        }

        for candidate in candidates.keys.sorted() {
            var candidateReasons = candidates[candidate] ?? []
            let before = runtimeSignature(
                for: state,
                at: candidate.addingTimeInterval(-0.001),
                calendar: calendar
            )
            let after = runtimeSignature(for: state, at: candidate, calendar: calendar)
            let recurringRotationCanAdvance = candidateReasons.contains(.recurringRotation)
                && canAdvanceRotation(in: state, at: candidate, calendar: calendar)
            if !recurringRotationCanAdvance {
                candidateReasons.remove(.recurringRotation)
            }
            guard before != after || recurringRotationCanAdvance else { continue }

            let reasons = candidateReasons
                .sorted { $0.rawValue < $1.rawValue }
            return AmbientRotationBoundary(date: candidate, reasons: reasons)
        }

        return nil
    }

    private static func wallClockDates(
        on day: Date,
        minuteOfDay: Int,
        calendar: Calendar
    ) -> [Date] {
        guard minuteOfDay < 1_440 else {
            return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: day)).map { [$0] } ?? []
        }

        let hour = minuteOfDay / 60
        let minute = minuteOfDay % 60
        let first = calendar.date(
            bySettingHour: hour,
            minute: minute,
            second: 0,
            of: day,
            matchingPolicy: .strict,
            repeatedTimePolicy: .first,
            direction: .forward
        )
        let last = calendar.date(
            bySettingHour: hour,
            minute: minute,
            second: 0,
            of: day,
            matchingPolicy: .strict,
            repeatedTimePolicy: .last,
            direction: .forward
        )
        return Array(Set([first, last].compactMap { $0 })).sorted()
    }

    private static func runtimeSignature(
        for originalState: AmbientState,
        at date: Date,
        calendar: Calendar
    ) -> RuntimeSignature {
        var state = originalState
        if let pausedUntil = state.pausedUntil, pausedUntil <= date {
            state.playbackStatus = .playing
            state.pausedUntil = nil
        }
        if let activationUntil = state.channelActivationUntil, activationUntil <= date {
            state.activeChannelID = state.previousActiveChannelID ?? state.activeChannelID
            state.previousActiveChannelID = nil
            state.channelActivationUntil = nil
        }

        let isPlaying = state.playbackStatus == .playing
        let channelID = isPlaying
            ? AmbientRuleEngine.resolve(state: state, at: date, calendar: calendar).channel?.id
            : nil
        return RuntimeSignature(isPlaying: isPlaying, channelID: channelID)
    }

    private static func canAdvanceRotation(
        in originalState: AmbientState,
        at date: Date,
        calendar: Calendar
    ) -> Bool {
        var state = originalState
        if let pausedUntil = state.pausedUntil, pausedUntil <= date {
            state.playbackStatus = .playing
            state.pausedUntil = nil
        }
        if let activationUntil = state.channelActivationUntil, activationUntil <= date {
            state.activeChannelID = state.previousActiveChannelID ?? state.activeChannelID
            state.previousActiveChannelID = nil
            state.channelActivationUntil = nil
        }
        guard state.playbackStatus == .playing else { return false }

        let channel = AmbientRuleEngine.resolve(state: state, at: date, calendar: calendar).channel
        let stills = AmbientRuleEngine.assets(in: channel, state: state).filter { $0.kind == .image }
        return stills.count > 1
    }
}

public enum AmbientRuntimeEvent: Equatable, Sendable {
    case willSleep
    case didWake
    case screenLocked
    case screenUnlocked
    case displayConfigurationChanged
    case powerStateChanged
    case clockOrTimeZoneChanged
    case stateStoreChanged(revision: UInt64?)
}

public enum AmbientRuntimeNotification {
    public static let stateStoreChanged = Notification.Name("com.projectambient.state-store-changed")
}

public enum AmbientRotationReconciliationReason: Equatable, Sendable {
    case launch
    case wake
    case displayConfigurationChanged
    case powerStateChanged
    case clockOrTimeZoneChanged
    case stateStoreChanged
}

@MainActor
public protocol AmbientScheduledAction: AnyObject {
    func cancel()
}

@MainActor
public protocol AmbientBoundaryScheduling: AnyObject {
    func schedule(at date: Date, action: @escaping @MainActor () -> Void) -> any AmbientScheduledAction
}

@MainActor
public protocol AmbientRuntimeEventObserving: AnyObject {
    func start(handler: @escaping @MainActor (AmbientRuntimeEvent) -> Void)
    func stop()
}

@MainActor
public protocol AmbientRotationDriving: AnyObject {
    func rotationState(at date: Date) throws -> AmbientState
    func advanceRotation(at date: Date, boundary: AmbientRotationBoundary) throws
    func reconcileRotation(at date: Date, reason: AmbientRotationReconciliationReason) throws
}

/// Coordinates one-shot rule timers and lifecycle recovery. All sources of time,
/// timers, notifications, and wallpaper work are injectable, keeping tests free of
/// run-loop and AppKit side effects.
@MainActor
public final class AmbientRotationCoordinator {
    public private(set) var nextBoundary: AmbientRotationBoundary?
    public private(set) var isStarted = false

    private let driver: any AmbientRotationDriving
    private let scheduler: any AmbientBoundaryScheduling
    private let events: any AmbientRuntimeEventObserving
    private let fixedCalendar: Calendar?
    private let cadenceProvider: @MainActor (AmbientState) -> AmbientRotationCadence
    private let now: @MainActor () -> Date
    private let onChange: @MainActor () -> Void
    private let onError: @MainActor (Error) -> Void

    private var scheduledAction: (any AmbientScheduledAction)?
    private var generation = 0
    private var isSleeping = false
    private var isScreenLocked = false
    private var suspendedBoundary: AmbientRotationBoundary?
    private var lastWakeHandledAt: Date?
    private var lastSeenStateRevision: UInt64 = 0

    public init(
        driver: any AmbientRotationDriving,
        scheduler: any AmbientBoundaryScheduling,
        events: any AmbientRuntimeEventObserving,
        calendar: Calendar? = nil,
        cadenceProvider: @escaping @MainActor (AmbientState) -> AmbientRotationCadence = { _ in
            .productionDefault
        },
        now: @escaping @MainActor () -> Date = Date.init,
        onChange: @escaping @MainActor () -> Void = {},
        onError: @escaping @MainActor (Error) -> Void = { _ in }
    ) {
        self.driver = driver
        self.scheduler = scheduler
        self.events = events
        self.fixedCalendar = calendar
        self.cadenceProvider = cadenceProvider
        self.now = now
        self.onChange = onChange
        self.onError = onError
    }

    public func start() {
        guard !isStarted else { return }
        isStarted = true
        events.start { [weak self] event in
            self?.handle(event)
        }

        let date = now()
        reconcile(at: date, reason: .launch)
        scheduleNext(after: date)
    }

    public func stop() {
        guard isStarted else { return }
        isStarted = false
        isSleeping = false
        suspendedBoundary = nil
        cancelScheduledAction()
        events.stop()
    }

    /// Call after a user or local control-plane mutation so a changed rule or timed
    /// pause replaces the existing one-shot timer immediately.
    public func stateDidChange() {
        guard isStarted, !isSleeping else { return }
        let date = now()
        reconcile(at: date, reason: .stateStoreChanged)
        scheduleNext(after: date)
    }

    private func handle(_ event: AmbientRuntimeEvent) {
        guard isStarted else { return }

        switch event {
        case .willSleep:
            guard !isSleeping else { return }
            isSleeping = true
            suspendedBoundary = nextBoundary
            cancelScheduledAction()

        case .didWake:
            let date = now()
            if !isSleeping,
               let lastWakeHandledAt,
               date.timeIntervalSince(lastWakeHandledAt) < 1 {
                return
            }
            lastWakeHandledAt = date
            let missedBoundary = suspendedBoundary.flatMap { $0.date <= date ? $0 : nil }
            isSleeping = false
            suspendedBoundary = nil
            if let missedBoundary {
                advance(at: date, boundary: missedBoundary)
            } else {
                reconcile(at: date, reason: .wake)
            }
            scheduleNext(after: date)

        case .screenLocked:
            // Exactly one advance per lock cycle: macOS can deliver the lock
            // notification more than once, and sleep emits it alongside its own.
            guard !isScreenLocked else { return }
            isScreenLocked = true
            guard !isSleeping else { return }
            let date = now()
            guard rotationTrigger(at: date) == .screenLock else { return }
            advance(at: date, boundary: AmbientRotationBoundary(date: date, reasons: [.screenLock]))

        case .screenUnlocked:
            // Unlocking only re-arms the next lock; it never rotates, so the
            // background the user locked to is the one they come back to.
            isScreenLocked = false

        case .displayConfigurationChanged:
            guard !isSleeping else { return }
            let date = now()
            reconcile(at: date, reason: .displayConfigurationChanged)
            scheduleNext(after: date)

        case .powerStateChanged:
            guard !isSleeping else { return }
            let date = now()
            reconcile(at: date, reason: .powerStateChanged)
            scheduleNext(after: date)

        case .clockOrTimeZoneChanged:
            guard !isSleeping else { return }
            let date = now()
            reconcile(at: date, reason: .clockOrTimeZoneChanged)
            scheduleNext(after: date)

        case .stateStoreChanged:
            guard !isSleeping else { return }
            let date = now()
            do {
                // Distributed notifications are advisory and can be posted by any
                // local process. Trust only the revision loaded from the serialized
                // state file; never allow a forged hint to poison this watermark.
                let state = try driver.rotationState(at: date)
                let persistedRevision = state.stateRevision ?? 0
                guard persistedRevision > lastSeenStateRevision else { return }
            } catch {
                onError(error)
                return
            }
            reconcile(at: date, reason: .stateStoreChanged)
            scheduleNext(after: date)
        }
    }

    private func scheduleNext(after date: Date) {
        if isStarted,
           !isSleeping,
           let pending = nextBoundary,
           pending.date <= date {
            do {
                let state = try driver.rotationState(at: date)
                lastSeenStateRevision = max(lastSeenStateRevision, state.stateRevision ?? 0)
                if state.lastRotationAt.map({ $0 < pending.date }) ?? true {
                    advance(at: date, boundary: pending)
                }
            } catch {
                onError(error)
            }
        }
        cancelScheduledAction()
        guard isStarted, !isSleeping else { return }

        do {
            let state = try driver.rotationState(at: date)
            lastSeenStateRevision = max(lastSeenStateRevision, state.stateRevision ?? 0)
            let calendar = fixedCalendar ?? .current
            // Lock-triggered rotation is event-driven by definition: no cadence
            // boundary is planned, so no timer is armed. Rule boundaries still
            // apply — they choose the channel, not when to advance within it.
            let cadence = (state.rotationTrigger ?? .cadence) == .screenLock
                ? AmbientRotationCadence.disabled
                : cadenceProvider(state)
            guard let boundary = AmbientRotationSchedulePlanner.nextBoundary(
                in: state,
                after: date,
                calendar: calendar,
                cadence: cadence
            ) else {
                nextBoundary = nil
                return
            }

            nextBoundary = boundary
            let scheduledGeneration = generation
            scheduledAction = scheduler.schedule(at: boundary.date) { [weak self] in
                self?.timerFired(boundary, generation: scheduledGeneration)
            }
        } catch {
            nextBoundary = nil
            onError(error)
        }
    }

    private func timerFired(_ boundary: AmbientRotationBoundary, generation: Int) {
        guard isStarted, !isSleeping, generation == self.generation else { return }
        scheduledAction = nil
        nextBoundary = nil

        let date = now()
        guard date >= boundary.date else {
            scheduleNext(after: date)
            return
        }

        advance(at: date, boundary: boundary)
        scheduleNext(after: date)
    }

    /// Reads the trigger from current state. A read failure falls back to
    /// cadence, which never rotates on lock — the safe direction.
    private func rotationTrigger(at date: Date) -> AmbientRotationTrigger {
        do {
            let state = try driver.rotationState(at: date)
            lastSeenStateRevision = max(lastSeenStateRevision, state.stateRevision ?? 0)
            return state.rotationTrigger ?? .cadence
        } catch {
            onError(error)
            return .cadence
        }
    }

    private func advance(at date: Date, boundary: AmbientRotationBoundary) {
        do {
            try driver.advanceRotation(at: date, boundary: boundary)
            onChange()
        } catch {
            onError(error)
        }
    }

    private func reconcile(at date: Date, reason: AmbientRotationReconciliationReason) {
        do {
            try driver.reconcileRotation(at: date, reason: reason)
            onChange()
        } catch {
            onError(error)
        }
    }

    private func cancelScheduledAction() {
        generation += 1
        scheduledAction?.cancel()
        scheduledAction = nil
        nextBoundary = nil
    }
}
