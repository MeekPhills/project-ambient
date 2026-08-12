import AmbientCore
import AppKit
import Foundation

@MainActor
final class MacBoundaryScheduler: AmbientBoundaryScheduling {
    func schedule(
        at date: Date,
        action: @escaping @MainActor () -> Void
    ) -> any AmbientScheduledAction {
        MacScheduledAction(fireAt: date, action: action)
    }
}

@MainActor
private final class MacScheduledAction: AmbientScheduledAction {
    private var timer: Timer?

    init(fireAt date: Date, action: @escaping @MainActor () -> Void) {
        let timer = Timer(fire: date, interval: 0, repeats: false) { _ in
            MainActor.assumeIsolated {
                action()
            }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func cancel() {
        timer?.invalidate()
        timer = nil
    }

    deinit {
        timer?.invalidate()
    }
}

@MainActor
final class MacRuntimeEventSource: AmbientRuntimeEventObserving {
    private struct Observation {
        var center: NotificationCenter
        var token: NSObjectProtocol
    }

    private var observations: [Observation] = []
    private var stateStoreWorkItem: DispatchWorkItem?
    private var pendingStateRevision: UInt64?

    func start(handler: @escaping @MainActor (AmbientRuntimeEvent) -> Void) {
        stop()

        let workspaceCenter = NSWorkspace.shared.notificationCenter
        observe(
            NSWorkspace.willSleepNotification,
            center: workspaceCenter,
            event: .willSleep,
            handler: handler
        )
        observe(
            NSWorkspace.didWakeNotification,
            center: workspaceCenter,
            event: .didWake,
            handler: handler
        )
        observe(
            NSWorkspace.screensDidSleepNotification,
            center: workspaceCenter,
            event: .willSleep,
            handler: handler
        )
        observe(
            NSWorkspace.screensDidWakeNotification,
            center: workspaceCenter,
            event: .didWake,
            handler: handler
        )

        let defaultCenter = NotificationCenter.default
        observe(
            NSApplication.didChangeScreenParametersNotification,
            center: defaultCenter,
            event: .displayConfigurationChanged,
            handler: handler
        )
        observe(
            .NSProcessInfoPowerStateDidChange,
            center: defaultCenter,
            event: .powerStateChanged,
            handler: handler
        )
        observe(
            .NSSystemClockDidChange,
            center: defaultCenter,
            event: .clockOrTimeZoneChanged,
            handler: handler
        )
        observe(
            .NSSystemTimeZoneDidChange,
            center: defaultCenter,
            event: .clockOrTimeZoneChanged,
            handler: handler
        )
        observeStateStoreChanges(handler: handler)
    }

    func stop() {
        stateStoreWorkItem?.cancel()
        stateStoreWorkItem = nil
        pendingStateRevision = nil
        for observation in observations {
            observation.center.removeObserver(observation.token)
        }
        observations.removeAll()
    }

    private func observe(
        _ name: Notification.Name,
        center: NotificationCenter,
        event: AmbientRuntimeEvent,
        handler: @escaping @MainActor (AmbientRuntimeEvent) -> Void
    ) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                handler(event)
            }
        }
        observations.append(Observation(center: center, token: token))
    }

    private func observeStateStoreChanges(
        handler: @escaping @MainActor (AmbientRuntimeEvent) -> Void
    ) {
        let center = DistributedNotificationCenter.default()
        let token = center.addObserver(
            forName: AmbientRuntimeNotification.stateStoreChanged,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            MainActor.assumeIsolated {
                guard let self else { return }
                let revision = (notification.userInfo?["revision"] as? NSNumber)?.uint64Value
                if let revision {
                    self.pendingStateRevision = max(self.pendingStateRevision ?? 0, revision)
                }
                guard self.stateStoreWorkItem == nil else { return }

                let workItem = DispatchWorkItem { [weak self] in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        let revision = self.pendingStateRevision
                        self.pendingStateRevision = nil
                        self.stateStoreWorkItem = nil
                        handler(.stateStoreChanged(revision: revision))
                    }
                }
                self.stateStoreWorkItem = workItem
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150), execute: workItem)
            }
        }
        observations.append(Observation(center: center, token: token))
    }

    deinit {
        for observation in observations {
            observation.center.removeObserver(observation.token)
        }
    }
}
