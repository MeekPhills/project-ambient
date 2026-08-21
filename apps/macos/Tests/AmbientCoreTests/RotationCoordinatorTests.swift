import XCTest
@testable import AmbientCore

final class AmbientRotationSchedulePlannerTests: XCTestCase {
    func testPlannerFindsActualChannelTransitionsAtMinuteBoundaries() throws {
        let calendar = utcCalendar()
        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(
                name: "Workday city",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 10 * 60, endMinute: (10 * 60) + 59),
                priority: 10
            )
        ]

        let beforeStart = try date(hour: 9, minute: 30, calendar: calendar)
        let start = try date(hour: 10, minute: 0, calendar: calendar)
        let end = try date(hour: 11, minute: 0, calendar: calendar)

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: beforeStart, calendar: calendar),
            AmbientRotationBoundary(date: start, reasons: [.ruleSchedule])
        )
        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: start, calendar: calendar),
            AmbientRotationBoundary(date: end, reasons: [.ruleSchedule])
        )
    }

    func testPlannerSkipsRuleBoundariesMaskedByHigherPriorityRule() throws {
        let calendar = utcCalendar()
        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(
                name: "Always city",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 0, endMinute: 1_439),
                priority: 100
            ),
            AmbientRule(
                name: "Masked beach",
                channelID: beach.id,
                schedule: AmbientSchedule(startMinute: 10 * 60, endMinute: 11 * 60),
                priority: 1
            )
        ]

        let date = try date(hour: 9, minute: 30, calendar: calendar)
        XCTAssertNil(AmbientRotationSchedulePlanner.nextBoundary(in: state, after: date, calendar: calendar))
    }

    func testTemporaryPauseSchedulesOnlyItsResumeBoundary() throws {
        let calendar = utcCalendar()
        let now = try date(hour: 9, minute: 30, calendar: calendar)
        let resume = try date(hour: 9, minute: 45, calendar: calendar)
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState()
        state.playbackStatus = .paused
        state.pausedUntil = resume
        state.rules = [
            AmbientRule(
                name: "City later",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 10 * 60, endMinute: 11 * 60)
            )
        ]

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar),
            AmbientRotationBoundary(date: resume, reasons: [.pauseExpiration])
        )

        state.pausedUntil = nil
        XCTAssertNil(AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar))
    }

    func testEndOfDayInclusiveBoundaryTransitionsAtNextMidnight() throws {
        let calendar = utcCalendar()
        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(
                name: "Through midnight",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 23 * 60, endMinute: 1_439)
            )
        ]
        let now = try date(hour: 23, minute: 30, calendar: calendar)
        let midnight = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)))

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar),
            AmbientRotationBoundary(date: midnight, reasons: [.ruleSchedule])
        )
    }

    func testSpringForwardUsesDSTTransitionWhenEndMinuteDoesNotExist() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 3, day: 8, hour: 1, minute: 45
        )))
        let transition = try XCTUnwrap(calendar.timeZone.nextDaylightSavingTimeTransition(after: now))
        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(
                name: "Skipped end",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 90, endMinute: 150)
            )
        ]

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar),
            AmbientRotationBoundary(date: transition, reasons: [.ruleSchedule])
        )
    }

    func testPauseExpiryAndCadenceAtSameInstantAreMerged() throws {
        let calendar = utcCalendar()
        let now = try date(hour: 9, minute: 7, calendar: calendar)
        let boundary = try date(hour: 9, minute: 15, calendar: calendar)
        var state = AmbientState()
        state.assets = [
            AmbientAsset(path: "/first.jpg", kind: .image, fileName: "first.jpg"),
            AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg")
        ]
        state.playbackStatus = .paused
        state.pausedUntil = boundary

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar),
            AmbientRotationBoundary(
                date: boundary,
                reasons: [.pauseExpiration, .recurringRotation]
            )
        )
    }

    func testPlannerHandlesBothOccurrencesOfRepeatedDaylightSavingHour() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let day = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 11,
            day: 1,
            hour: 0,
            minute: 30
        )))
        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(
                name: "Repeated hour",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 90, endMinute: 119),
                priority: 10
            )
        ]

        let firstStart = try XCTUnwrap(calendar.date(
            bySettingHour: 1,
            minute: 30,
            second: 0,
            of: day,
            matchingPolicy: .strict,
            repeatedTimePolicy: .first,
            direction: .forward
        ))
        let fallback = try XCTUnwrap(calendar.timeZone.nextDaylightSavingTimeTransition(after: day))
        let secondStart = try XCTUnwrap(calendar.date(
            bySettingHour: 1,
            minute: 30,
            second: 0,
            of: day,
            matchingPolicy: .strict,
            repeatedTimePolicy: .last,
            direction: .forward
        ))

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: day, calendar: calendar)?.date,
            firstStart
        )
        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: firstStart, calendar: calendar)?.date,
            fallback
        )
        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: fallback, calendar: calendar)?.date,
            secondStart
        )
    }

    func testRecurringRotationUsesProductionQuarterHourAndInjectableCadence() throws {
        let calendar = utcCalendar()
        let now = try date(hour: 9, minute: 7, calendar: calendar)
        var state = AmbientState()
        state.assets = [
            AmbientAsset(path: "/first.jpg", kind: .image, fileName: "first.jpg"),
            AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg")
        ]

        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar),
            AmbientRotationBoundary(
                date: try date(hour: 9, minute: 15, calendar: calendar),
                reasons: [.recurringRotation]
            )
        )
        XCTAssertEqual(
            AmbientRotationSchedulePlanner.nextBoundary(
                in: state,
                after: now,
                calendar: calendar,
                cadence: AmbientRotationCadence(interval: 30 * 60)
            ),
            AmbientRotationBoundary(
                date: try date(hour: 9, minute: 30, calendar: calendar),
                reasons: [.recurringRotation]
            )
        )
    }

    func testRecurringRotationIsSuppressedWhenPausedOrNothingCanChange() throws {
        let calendar = utcCalendar()
        let now = try date(hour: 9, minute: 7, calendar: calendar)
        var state = AmbientState()
        state.assets = [AmbientAsset(path: "/only.jpg", kind: .image, fileName: "only.jpg")]

        XCTAssertNil(AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar))

        state.assets.append(AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg"))
        state.playbackStatus = .paused
        XCTAssertNil(AmbientRotationSchedulePlanner.nextBoundary(in: state, after: now, calendar: calendar))
    }

    func testProductionCadenceHonorsEfficiencyAndLowPowerPolicies() {
        XCTAssertEqual(
            AmbientRotationCadence.production(for: .automatic, isLowPowerModeEnabled: false),
            .productionDefault
        )
        XCTAssertEqual(
            AmbientRotationCadence.production(for: .automatic, isLowPowerModeEnabled: true),
            .energySaving
        )
        XCTAssertEqual(
            AmbientRotationCadence.production(for: .efficiency, isLowPowerModeEnabled: false),
            .energySaving
        )
        XCTAssertEqual(
            AmbientRotationCadence.production(for: .quality, isLowPowerModeEnabled: true),
            .productionDefault
        )
    }

    private func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(hour: Int, minute: Int, calendar: Calendar) throws -> Date {
        try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 12,
            hour: hour,
            minute: minute
        )))
    }
}

@MainActor
final class AmbientRotationCoordinatorTests: XCTestCase {
    func testStartReconcilesAndSchedulesNextBoundary() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        let driver = TestRotationDriver(state: try scheduledState())
        let scheduler = TestBoundaryScheduler()
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: events,
            calendar: calendar,
            now: { clock.date }
        )

        coordinator.start()

        XCTAssertEqual(driver.reconciliations.map(\.reason), [.launch])
        XCTAssertEqual(scheduler.entries.map(\.date), [try date(hour: 10, minute: 0, calendar: calendar)])
        XCTAssertEqual(coordinator.nextBoundary?.reasons, [.ruleSchedule])
    }

    func testTimerAdvancesOnceAndReplacesItselfWithFollowingBoundary() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        let driver = TestRotationDriver(state: try scheduledState())
        let scheduler = TestBoundaryScheduler()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: TestRuntimeEvents(),
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()
        let firstTimer = try XCTUnwrap(scheduler.entries.last)

        clock.date = try date(hour: 10, minute: 0, calendar: calendar)
        firstTimer.fire()

        XCTAssertEqual(driver.advances.count, 1)
        XCTAssertEqual(driver.advances.first?.date, clock.date)
        XCTAssertEqual(scheduler.entries.last?.date, try date(hour: 11, minute: 0, calendar: calendar))
    }

    func testSleepCancelsTimerAndWakeCatchesUpMissedBoundaryOnce() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        let driver = TestRotationDriver(state: try scheduledState())
        let scheduler = TestBoundaryScheduler()
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: events,
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()
        let sleepingTimer = try XCTUnwrap(scheduler.entries.last)

        events.send(.willSleep)
        XCTAssertTrue(sleepingTimer.isCancelled)

        clock.date = try date(hour: 10, minute: 5, calendar: calendar)
        events.send(.didWake)

        XCTAssertEqual(driver.advances.count, 1)
        XCTAssertEqual(driver.advances.first?.date, clock.date)
        XCTAssertFalse(driver.reconciliations.contains(where: { $0.reason == .wake }))
        XCTAssertEqual(scheduler.entries.last?.date, try date(hour: 11, minute: 0, calendar: calendar))

        // macOS may report both machine wake and display wake for one cycle.
        events.send(.didWake)
        XCTAssertEqual(driver.advances.count, 1)
        XCTAssertFalse(driver.reconciliations.contains(where: { $0.reason == .wake }))
    }

    func testPowerEventAtDueBoundaryCatchesUpBeforeReplacingTimer() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        let driver = TestRotationDriver(state: try scheduledState())
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: TestBoundaryScheduler(),
            events: events,
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()

        clock.date = try date(hour: 10, minute: 0, calendar: calendar)
        events.send(.powerStateChanged)

        XCTAssertEqual(driver.advances.count, 1)
        XCTAssertEqual(driver.advances.first?.boundary.date, clock.date)
    }

    func testRevisionAwareStateEventsIgnoreStaleAndRepeatedBursts() throws {
        let calendar = utcCalendar()
        var state = try scheduledState()
        state.stateRevision = 5
        let driver = TestRotationDriver(state: state)
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: TestBoundaryScheduler(),
            events: events,
            calendar: calendar,
            now: { try! self.date(hour: 9, minute: 30, calendar: calendar) }
        )
        coordinator.start()

        events.send(.stateStoreChanged(revision: UInt64.max))
        driver.state.stateRevision = 6
        events.send(.stateStoreChanged(revision: 6))
        events.send(.stateStoreChanged(revision: 6))

        XCTAssertEqual(
            driver.reconciliations.map(\.reason),
            [.launch, .stateStoreChanged]
        )
    }

    func testDisplayAndPowerEventsUseReconciliationSeam() throws {
        let calendar = utcCalendar()
        let driver = TestRotationDriver(state: try scheduledState())
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: TestBoundaryScheduler(),
            events: events,
            calendar: calendar,
            now: { try! self.date(hour: 9, minute: 30, calendar: calendar) }
        )
        coordinator.start()

        events.send(.displayConfigurationChanged)
        events.send(.powerStateChanged)

        XCTAssertEqual(
            driver.reconciliations.map(\.reason),
            [.launch, .displayConfigurationChanged, .powerStateChanged]
        )
    }

    func testCancelledTimerCallbackCannotAdvanceAfterReschedule() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        let driver = TestRotationDriver(state: try scheduledState())
        let scheduler = TestBoundaryScheduler()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: TestRuntimeEvents(),
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()
        let staleTimer = try XCTUnwrap(scheduler.entries.last)

        coordinator.stateDidChange()
        XCTAssertTrue(staleTimer.isCancelled)
        clock.date = try date(hour: 10, minute: 0, calendar: calendar)
        staleTimer.fire()

        XCTAssertTrue(driver.advances.isEmpty)
    }

    func testRecurringCadenceAdvancesAndSchedulesOnlyOneFollowingTimer() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 7, calendar: calendar))
        var state = AmbientState()
        state.assets = [
            AmbientAsset(path: "/first.jpg", kind: .image, fileName: "first.jpg"),
            AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg")
        ]
        let driver = TestRotationDriver(state: state)
        let scheduler = TestBoundaryScheduler()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: TestRuntimeEvents(),
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()

        let firstTimer = try XCTUnwrap(scheduler.entries.last)
        XCTAssertEqual(firstTimer.date, try date(hour: 9, minute: 15, calendar: calendar))

        clock.date = firstTimer.date
        firstTimer.fire()

        XCTAssertEqual(driver.advances.map(\.boundary.reasons), [[.recurringRotation]])
        XCTAssertEqual(scheduler.entries.last?.date, try date(hour: 9, minute: 30, calendar: calendar))
        XCTAssertEqual(scheduler.entries.filter { !$0.isCancelled }.count, 1)
    }

    func testPowerEventReschedulesUsingCurrentCadenceProvider() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 7, calendar: calendar))
        var state = AmbientState()
        state.assets = [
            AmbientAsset(path: "/first.jpg", kind: .image, fileName: "first.jpg"),
            AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg")
        ]
        let driver = TestRotationDriver(state: state)
        let scheduler = TestBoundaryScheduler()
        let events = TestRuntimeEvents()
        var isLowPowerModeEnabled = false
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: events,
            calendar: calendar,
            cadenceProvider: { state in
                AmbientRotationCadence.production(
                    for: state.powerPolicy,
                    isLowPowerModeEnabled: isLowPowerModeEnabled
                )
            },
            now: { clock.date }
        )
        coordinator.start()
        let normalTimer = try XCTUnwrap(scheduler.entries.last)
        XCTAssertEqual(normalTimer.date, try date(hour: 9, minute: 15, calendar: calendar))

        isLowPowerModeEnabled = true
        events.send(.powerStateChanged)

        XCTAssertTrue(normalTimer.isCancelled)
        XCTAssertEqual(scheduler.entries.last?.date, try date(hour: 9, minute: 30, calendar: calendar))
    }

    func testExternalStateChangeReloadsTimerWithoutApplyingWallpaper() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 7, calendar: calendar))
        var state = AmbientState()
        state.assets = [
            AmbientAsset(path: "/first.jpg", kind: .image, fileName: "first.jpg"),
            AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg")
        ]
        let driver = TestRotationDriver(state: state)
        let scheduler = TestBoundaryScheduler()
        let events = TestRuntimeEvents()
        var changes = 0
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: scheduler,
            events: events,
            calendar: calendar,
            cadenceProvider: { state in
                AmbientRotationCadence.production(
                    for: state.powerPolicy,
                    isLowPowerModeEnabled: false
                )
            },
            now: { clock.date },
            onChange: { changes += 1 }
        )
        coordinator.start()
        let normalTimer = try XCTUnwrap(scheduler.entries.last)

        driver.state.powerPolicy = .efficiency
        driver.state.stateRevision = 1
        events.send(.stateStoreChanged(revision: nil))

        XCTAssertTrue(normalTimer.isCancelled)
        XCTAssertEqual(scheduler.entries.last?.date, try date(hour: 9, minute: 30, calendar: calendar))
        XCTAssertEqual(driver.reconciliations.map(\.reason), [.launch, .stateStoreChanged])
        XCTAssertEqual(changes, 2)
    }

    func testScreenLockAdvancesOnceAndUnlockDoesNot() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        var state = try scheduledState()
        state.rotationTrigger = .screenLock
        let driver = TestRotationDriver(state: state)
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: TestBoundaryScheduler(),
            events: events,
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()

        events.send(.screenLocked)
        XCTAssertEqual(driver.advances.count, 1)
        XCTAssertEqual(driver.advances.first?.boundary.reasons, [.screenLock])

        // macOS can repeat the lock notification within one lock cycle.
        events.send(.screenLocked)
        XCTAssertEqual(driver.advances.count, 1)

        events.send(.screenUnlocked)
        XCTAssertEqual(driver.advances.count, 1)

        // Re-arms for the next lock.
        events.send(.screenLocked)
        XCTAssertEqual(driver.advances.count, 2)
    }

    func testScreenLockDoesNotRotateUnderCadenceTrigger() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        // Default state: rotationTrigger nil, i.e. the cadence behavior every
        // existing install already has.
        let driver = TestRotationDriver(state: try scheduledState())
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: TestBoundaryScheduler(),
            events: events,
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()

        events.send(.screenLocked)

        XCTAssertTrue(driver.advances.isEmpty)
    }

    func testLockTriggerSchedulesNoCadenceTimer() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 7, calendar: calendar))
        // Two stills, so a cadence boundary is genuinely available to plan.
        var rotatable = AmbientState()
        rotatable.assets = [
            AmbientAsset(path: "/first.jpg", kind: .image, fileName: "first.jpg"),
            AmbientAsset(path: "/second.jpg", kind: .image, fileName: "second.jpg")
        ]

        let cadenceCoordinator = AmbientRotationCoordinator(
            driver: TestRotationDriver(state: rotatable),
            scheduler: TestBoundaryScheduler(),
            events: TestRuntimeEvents(),
            calendar: calendar,
            cadenceProvider: { _ in .productionDefault },
            now: { clock.date }
        )
        cadenceCoordinator.start()
        XCTAssertEqual(cadenceCoordinator.nextBoundary?.reasons, [.recurringRotation])

        var lockState = rotatable
        lockState.rotationTrigger = .screenLock
        let lockScheduler = TestBoundaryScheduler()
        let lockCoordinator = AmbientRotationCoordinator(
            driver: TestRotationDriver(state: lockState),
            scheduler: lockScheduler,
            events: TestRuntimeEvents(),
            calendar: calendar,
            cadenceProvider: { _ in .productionDefault },
            now: { clock.date }
        )
        lockCoordinator.start()

        // Same state, lock trigger: no cadence boundary, so no timer is armed.
        XCTAssertNil(lockCoordinator.nextBoundary)
        XCTAssertTrue(lockScheduler.entries.isEmpty)
    }

    func testScreenLockWhileSleepingDoesNotRotate() throws {
        let calendar = utcCalendar()
        let clock = TestClock(try date(hour: 9, minute: 30, calendar: calendar))
        var state = try scheduledState()
        state.rotationTrigger = .screenLock
        let driver = TestRotationDriver(state: state)
        let events = TestRuntimeEvents()
        let coordinator = AmbientRotationCoordinator(
            driver: driver,
            scheduler: TestBoundaryScheduler(),
            events: events,
            calendar: calendar,
            now: { clock.date }
        )
        coordinator.start()

        // Sleep emits a lock notification of its own; the wake path owns that
        // recovery, so it must not also rotate here.
        events.send(.willSleep)
        events.send(.screenLocked)

        XCTAssertTrue(driver.advances.isEmpty)
    }

    private func scheduledState() throws -> AmbientState {
        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        var state = AmbientState(activeChannelID: beach.id)
        state.rules = [
            AmbientRule(
                name: "City hour",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 10 * 60, endMinute: (10 * 60) + 59),
                priority: 10
            )
        ]
        return state
    }

    private func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(hour: Int, minute: Int, calendar: Calendar) throws -> Date {
        try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 12,
            hour: hour,
            minute: minute
        )))
    }
}

@MainActor
final class AmbientEngineRotationLifecycleTests: XCTestCase {
    func testBoundaryAdvancesIntoResolvedChannelAndDisplayReconnectReappliesCurrentStill() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-rotation-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let beachURL = directory.appendingPathComponent("beach.jpg")
        let cityURL = directory.appendingPathComponent("city.jpg")
        try Data("beach".utf8).write(to: beachURL)
        try Data("city".utf8).write(to: cityURL)

        let beach = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.beachChannelID })
        let city = try XCTUnwrap(AmbientChannel.builtIns.first { $0.id == AmbientChannel.citiesChannelID })
        let beachAsset = AmbientAsset(
            path: beachURL.path,
            kind: .image,
            fileName: beachURL.lastPathComponent,
            tags: ["beach"]
        )
        let cityAsset = AmbientAsset(
            path: cityURL.path,
            kind: .image,
            fileName: cityURL.lastPathComponent,
            tags: ["city"]
        )
        var state = AmbientState(
            assets: [beachAsset, cityAsset],
            activeChannelID: beach.id,
            currentAssetID: beachAsset.id
        )
        state.rules = [
            AmbientRule(
                name: "City hour",
                channelID: city.id,
                schedule: AmbientSchedule(startMinute: 10 * 60, endMinute: (10 * 60) + 59),
                priority: 10
            )
        ]

        let store = AmbientStateStore(directoryURL: directory)
        try store.save(state)
        let wallpaper = RecordingWallpaperService()
        let engine = try AmbientEngine(store: store, wallpaper: wallpaper)
        let boundaryDate = try date(hour: 10, minute: 0)
        let boundary = AmbientRotationBoundary(date: boundaryDate, reasons: [.ruleSchedule])

        try engine.advanceRotation(at: boundaryDate, boundary: boundary)

        XCTAssertEqual(engine.state.currentAssetID, cityAsset.id)
        XCTAssertEqual(wallpaper.appliedAssets.map(\.id), [cityAsset.id])

        try engine.reconcileRotation(
            at: try date(hour: 10, minute: 30),
            reason: .displayConfigurationChanged
        )
        XCTAssertEqual(wallpaper.appliedAssets.map(\.id), [cityAsset.id, cityAsset.id])

        try engine.reconcileRotation(
            at: try date(hour: 10, minute: 31),
            reason: .powerStateChanged
        )
        XCTAssertEqual(wallpaper.appliedAssets.count, 2)
    }

    func testPrimaryScopePersistsAcrossRestartWakeReconnectAndCadence() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-scope-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let firstURL = directory.appendingPathComponent("first.jpg")
        let secondURL = directory.appendingPathComponent("second.jpg")
        try Data("first".utf8).write(to: firstURL)
        try Data("second".utf8).write(to: secondURL)
        let first = AmbientAsset(path: firstURL.path, kind: .image, fileName: firstURL.lastPathComponent)
        let second = AmbientAsset(path: secondURL.path, kind: .image, fileName: secondURL.lastPathComponent)
        let store = AmbientStateStore(directoryURL: directory)
        try store.save(AmbientState(assets: [first, second]))

        let initialWallpaper = RecordingWallpaperService()
        let initialEngine = try AmbientEngine(store: store, wallpaper: initialWallpaper)
        _ = try initialEngine.next(displayScope: .primary, requestID: "scope-request-0001", at: try date(hour: 9, minute: 0))
        XCTAssertEqual(initialWallpaper.appliedScopes, [.primary])

        let restartedWallpaper = RecordingWallpaperService()
        let restartedEngine = try AmbientEngine(store: store, wallpaper: restartedWallpaper)
        try restartedEngine.reconcileRotation(at: try date(hour: 9, minute: 1), reason: .wake)
        try restartedEngine.reconcileRotation(
            at: try date(hour: 9, minute: 2),
            reason: .displayConfigurationChanged
        )
        try restartedEngine.advanceRotation(
            at: try date(hour: 9, minute: 15),
            boundary: AmbientRotationBoundary(
                date: try date(hour: 9, minute: 15),
                reasons: [.recurringRotation]
            )
        )

        XCTAssertEqual(restartedWallpaper.appliedScopes, [.primary, .primary, .primary])
        XCTAssertEqual(restartedEngine.state.managedDisplayScope, .primary)
    }

    func testDisplayReconnectPersistsAndRestoresNewDisplayWallpaper() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-display-restore-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let assetURL = directory.appendingPathComponent("ambient.jpg")
        try Data("ambient".utf8).write(to: assetURL)
        let asset = AmbientAsset(
            path: assetURL.path,
            kind: .image,
            fileName: assetURL.lastPathComponent
        )
        var state = AmbientState(assets: [asset], currentAssetID: asset.id)
        state.previousWallpaperPaths = ["display-a": "/original-a.jpg"]
        state.managedDisplayScope = .all

        let store = AmbientStateStore(directoryURL: directory)
        try store.save(state)
        let wallpaper = RecordingWallpaperService()
        wallpaper.capturedWallpapers = [
            "display-a": "/ambient-current-a.jpg",
            "display-b": "/original-b.jpg"
        ]
        let engine = try AmbientEngine(store: store, wallpaper: wallpaper)

        try engine.reconcileRotation(
            at: try date(hour: 9, minute: 2),
            reason: .displayConfigurationChanged
        )

        let persisted = try store.load()
        XCTAssertEqual(persisted.previousWallpaperPaths, [
            "display-a": "/original-a.jpg",
            "display-b": "/original-b.jpg"
        ])
        XCTAssertEqual(wallpaper.appliedAssets.map(\.id), [asset.id])

        _ = try engine.restore(requestID: "restore-new-display-0001")
        XCTAssertEqual(wallpaper.restoredPaths, [[
            "display-a": "/original-a.jpg",
            "display-b": "/original-b.jpg"
        ]])
    }

    func testRequestReplaySurvivesRestartAndConflictIsRejected() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-idempotency-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let firstURL = directory.appendingPathComponent("first.jpg")
        let secondURL = directory.appendingPathComponent("second.jpg")
        try Data("first".utf8).write(to: firstURL)
        try Data("second".utf8).write(to: secondURL)
        let first = AmbientAsset(path: firstURL.path, kind: .image, fileName: firstURL.lastPathComponent)
        let second = AmbientAsset(path: secondURL.path, kind: .image, fileName: secondURL.lastPathComponent)
        let store = AmbientStateStore(directoryURL: directory)
        try store.save(AmbientState(assets: [first, second]))
        let requestID = "idempotent-request-0001"

        let wallpaper = RecordingWallpaperService()
        let engine = try AmbientEngine(store: store, wallpaper: wallpaper)
        let firstResult = try engine.next(displayScope: .all, requestID: requestID)
        let revisionAfterFirst = engine.state.stateRevision
        let replay = try engine.next(displayScope: .all, requestID: requestID)

        XCTAssertEqual(firstResult.asset?.id, replay.asset?.id)
        XCTAssertEqual(wallpaper.appliedAssets.count, 1)
        XCTAssertEqual(engine.state.stateRevision, revisionAfterFirst)

        let restartedWallpaper = RecordingWallpaperService()
        let restarted = try AmbientEngine(store: store, wallpaper: restartedWallpaper)
        let restartedReplay = try restarted.next(displayScope: .all, requestID: requestID)
        XCTAssertEqual(restartedReplay.asset?.id, firstResult.asset?.id)
        XCTAssertTrue(restartedWallpaper.appliedAssets.isEmpty)

        XCTAssertThrowsError(try restarted.next(displayScope: .primary, requestID: requestID)) { error in
            guard case AmbientIdempotencyError.requestConflict = error else {
                return XCTFail("Expected an idempotency conflict, got \(error)")
            }
        }
    }

    func testRequestLedgerIsBounded() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ambient-ledger-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = try AmbientEngine(store: AmbientStateStore(directoryURL: directory))

        for index in 0..<140 {
            _ = try engine.setPowerPolicy(
                index.isMultiple(of: 2) ? .automatic : .efficiency,
                requestID: String(format: "ledger-request-%04d", index)
            )
        }

        XCTAssertEqual(engine.state.requestLedger?.count, 128)
        XCTAssertEqual(engine.state.requestLedger?.first?.requestID, "ledger-request-0012")
    }

    private func date(hour: Int, minute: Int) throws -> Date {
        let calendar = Calendar.current
        return try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 12,
            hour: hour,
            minute: minute
        )))
    }
}

@MainActor
private final class TestClock {
    var date: Date

    init(_ date: Date) {
        self.date = date
    }
}

@MainActor
private final class TestRotationDriver: AmbientRotationDriving {
    struct Reconciliation {
        var date: Date
        var reason: AmbientRotationReconciliationReason
    }

    var state: AmbientState
    var advances: [(date: Date, boundary: AmbientRotationBoundary)] = []
    var reconciliations: [Reconciliation] = []

    init(state: AmbientState) {
        self.state = state
    }

    func rotationState(at date: Date) throws -> AmbientState {
        state
    }

    func advanceRotation(at date: Date, boundary: AmbientRotationBoundary) throws {
        advances.append((date, boundary))
    }

    func reconcileRotation(at date: Date, reason: AmbientRotationReconciliationReason) throws {
        reconciliations.append(Reconciliation(date: date, reason: reason))
    }
}

@MainActor
private final class TestScheduledAction: AmbientScheduledAction {
    let date: Date
    private let action: @MainActor () -> Void
    private(set) var isCancelled = false

    init(date: Date, action: @escaping @MainActor () -> Void) {
        self.date = date
        self.action = action
    }

    func cancel() {
        isCancelled = true
    }

    /// Deliberately permits firing a cancelled callback so generation checks are testable.
    func fire() {
        isCancelled = true
        action()
    }
}

@MainActor
private final class TestBoundaryScheduler: AmbientBoundaryScheduling {
    private(set) var entries: [TestScheduledAction] = []

    func schedule(
        at date: Date,
        action: @escaping @MainActor () -> Void
    ) -> any AmbientScheduledAction {
        let entry = TestScheduledAction(date: date, action: action)
        entries.append(entry)
        return entry
    }
}

@MainActor
private final class TestRuntimeEvents: AmbientRuntimeEventObserving {
    private var handler: (@MainActor (AmbientRuntimeEvent) -> Void)?

    func start(handler: @escaping @MainActor (AmbientRuntimeEvent) -> Void) {
        self.handler = handler
    }

    func stop() {
        handler = nil
    }

    func send(_ event: AmbientRuntimeEvent) {
        handler?(event)
    }
}

private final class RecordingWallpaperService: AmbientWallpaperApplying {
    private(set) var appliedAssets: [AmbientAsset] = []
    private(set) var appliedScopes: [AmbientDisplayScope] = []
    private(set) var restoredPaths: [[String: String]] = []
    var capturedWallpapers = ["test-display": "/before.jpg"]

    func captureCurrentWallpapers() -> [String: String] {
        capturedWallpapers
    }

    func apply(asset: AmbientAsset, scope: AmbientDisplayScope) throws {
        appliedAssets.append(asset)
        appliedScopes.append(scope)
    }

    func restore(paths: [String: String]) throws {
        restoredPaths.append(paths)
    }
}
