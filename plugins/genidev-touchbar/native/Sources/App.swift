import AppKit
import SwiftUI

final class AppModel: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var expanded = false
    @Published var nowMs: Double = Fmt.nowMs()
    @Published var layout: Layout = .current()
    /// Screen x of the panel's left edge; views place the strip relative to it.
    @Published var windowMinX: CGFloat = 0
    /// Left edge of the first menu bar icon right of the notch (nil = unknown).
    var iconLimitX: CGFloat?
    /// Server clock minus local clock, from generatedAt.
    var clockOffset: Double = 0
    private var lastGeneratedAt: Double?
    var staticRender = false

    // Panel state. Not saved between launches.
    @Published var hoveredId: String?
    @Published var expandedId: String?
    @Published var filter: CardFilter = .all
    /// Write panel actions to the log (dry-run and --simulate).
    var logActions = false
    var lastRowClick: (id: String, at: Date)?

    // Calm strip, robot, messages.
    /// Time for every animation (see AnimClock); moved by PanelController.
    let clock = AnimClock()
    /// "Plan done": the robot is happy until this moment.
    @Published var happyUntil: Date?
    /// --ui-mood: forced mood for renders.
    @Published var forcedMood: Mood?
    /// --ui-time: static renders draw animated things at this moment (seconds) instead of at rest.
    var frozenT: Double?
    /// Message on screen under the strip.
    @Published var banner: NoteEvent?
    /// The strip window is on screen (animations pause otherwise).
    @Published var visibleOnScreen = false
    var detector = EventDetector()
    private var happyWork: DispatchWorkItem?

    var onOpen: (SnapshotCard) -> Void = { _ in }
    var onRefresh: () -> Void = {}
    /// The "do not cover icons" switch changed: rescan and relayout at once.
    var onIconsPrefChanged: () -> Void = {}
    var onCardsChanged: () -> Void = {}
    var onLayoutNeeded: () -> Void = {}
    var onMenu: () -> Void = {}
    var onEvents: ([NoteEvent]) -> Void = { _ in }
    var onBannerClick: () -> Void = {}
    var onBannerClose: () -> Void = {}

    var cards: [SnapshotCard] { snapshot?.cards ?? [] }
    var totals: SnapshotSummary { snapshot?.totals ?? SnapshotSummary(cards: []) }

    func mood(at d: Date = Date()) -> Mood {
        forcedMood ?? Mood.from(totals, happyEvent: happyUntil.map { d < $0 } ?? false)
    }
    var mood: Mood { mood() }

    func apply(_ s: Snapshot?) {
        let local = Fmt.nowMs()
        if let s = s, s.generatedAt != lastGeneratedAt {
            // Recompute only on a new snapshot, so a static file keeps its clock.
            clockOffset = s.generatedAt - local
            lastGeneratedAt = s.generatedAt
        }
        // A poll with the same cards changes nothing on screen: publish nothing, so the
        // views are not rebuilt every 2 s (generatedAt alone moves on every poll).
        let changed = !Snapshot.sameContent(s, snapshot)
        // Pictures of threads: only addresses on this machine are ever asked (see IconStore).
        if let s = s { IconStore.shared.setBase(s.iconUrl) }
        if changed {
            nowMs = local
            snapshot = s
        }
        var events: [NoteEvent] = []
        if let s = s { events = detector.feed(s.cards) }
        if changed { normalizeUI() }
        onCardsChanged()
        if !events.isEmpty { onEvents(events) }
    }

    /// "Plan done": happy for 6 s (upset still wins, see Mood.from).
    func triggerHappy(seconds: Double = 6) {
        happyUntil = Date().addingTimeInterval(seconds)
        happyWork?.cancel()
        let w = DispatchWorkItem { [weak self] in
            self?.happyUntil = nil
            self?.onLayoutNeeded()
        }
        happyWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: w)
    }

    func bannerClick() { onBannerClick() }
    func bannerClose() { onBannerClose() }

    func timeText(_ card: SnapshotCard) -> String {
        Fmt.duration(ms: Fmt.workedMs(card, serverNow: nowMs + clockOffset))
    }

    /// Geometry from NSScreen plus the calm strip's wing widths.
    func computeLayout() -> Layout {
        var L = Layout.current()
        if !cards.isEmpty { CalmMath.apply(to: &L, summary: totals, iconLimitX: iconLimitX, keepIcons: Prefs.keepIcons) }
        L.headerMinW = PanelMath.preferredWidth
        return L
    }

    func open(_ card: SnapshotCard) { onOpen(card) }
    func refresh() { onRefresh() }
}

final class NotchPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    /// AppKit pushes windows below the menu bar; the strip must sit on the top edge.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class FirstClickHostingView<V: View>: NSHostingView<V> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class HoverView: NSView {
    var onHover: (Bool) -> Void = { _ in }
    private var area: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let a = area { removeTrackingArea(a) }
        let a = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(a)
        area = a
    }
    override func mouseEntered(with event: NSEvent) { onHover(true) }
    override func mouseExited(with event: NSEvent) { onHover(false) }
}

/// Owns the borderless panel over the menu bar. The window covers only the strip;
/// while the strip changes size the window briefly covers both the old and new shape.
final class PanelController {
    let model: AppModel
    let panel: NotchPanel
    private var expandWork: DispatchWorkItem?
    private var collapseWork: DispatchWorkItem?
    private var settleWork: DispatchWorkItem?
    private var iconsScannedAt = Date.distantPast
    private var menuOpen = false
    // Animation clock (see AnimClock).
    private enum AnimMode { case off, robot, panel }
    private var animMode: AnimMode = .off
    private var animTimer: Timer?
    private var screensAsleep = false
    // Messages under the strip.
    private var queue = BannerQueue()
    private var bannerWork: DispatchWorkItem?
    private var bannerDeadline: Date?
    private var bannerRemaining: Double = BannerMath.seconds
    private var bannerHovered = false

    init(model: AppModel) {
        self.model = model
        panel = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 10, height: 10),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        // isFloatingPanel resets the level to .floating, so set it first and the level after.
        panel.isFloatingPanel = true
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 2)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.acceptsMouseMovedEvents = true

        let container = HoverView(frame: panel.contentRect(forFrameRect: panel.frame))
        container.autoresizesSubviews = true
        let host = FirstClickHostingView(rootView: RootView(model: model))
        host.sizingOptions = []
        host.frame = container.bounds
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)
        container.onHover = { [weak self] inside in self?.hover(inside) }
        panel.contentView = container

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            Log.write("экраны изменились, пересчитываю полоску")
            self?.iconsScannedAt = .distantPast
            self?.relayout()
        }
        model.onCardsChanged = { [weak self] in self?.relayout(scanIcons: true) }
        model.onIconsPrefChanged = { [weak self] in
            self?.iconsScannedAt = .distantPast
            self?.relayout(scanIcons: true)
        }
        model.onLayoutNeeded = { [weak self] in self?.relayout() }
        model.onMenu = { [weak self] in self?.showMenu() }
        model.onEvents = { [weak self] es in self?.handle(es) }
        model.onBannerClick = { [weak self] in self?.bannerClick() }
        model.onBannerClose = { [weak self] in self?.dismissBanner(how: "крестик") }
        // Animations stop while nobody can see them.
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification,
                                               object: panel, queue: .main) { [weak self] _ in self?.updateAnimation() }
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.screensAsleep = true
            self?.updateAnimation()
        }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.screensAsleep = false
            self?.updateAnimation()
        }
    }

    // MARK: animation clock

    /// Open panel: 6 frames a second. Collapsed strip: only the robot, and only at the
    /// moments its face changes (about once a second while it thinks, never otherwise).
    /// Hidden, covered or asleep: nothing.
    func updateAnimation() {
        let seen = model.visibleOnScreen && panel.isVisible && !screensAsleep
            && (panel.occlusionState.contains(.visible) || Self.ignoreOcclusion)
        let mode: AnimMode
        if !seen || model.staticRender || model.cards.isEmpty { mode = .off }
        else if model.expanded { mode = .panel }
        else if model.mood == .thinking { mode = .robot }
        else { mode = .off }
        guard mode != animMode else { return }
        animMode = mode
        animTimer?.invalidate()
        animTimer = nil
        switch mode {
        case .off: break
        case .panel:
            let t = Timer(timeInterval: 1.0 / 6, repeats: true) { [weak self] _ in
                self?.model.clock.t = Date().timeIntervalSinceReferenceDate
            }
            t.tolerance = 0.02
            RunLoop.main.add(t, forMode: .common)
            animTimer = t
            model.clock.t = Date().timeIntervalSinceReferenceDate
        case .robot:
            scheduleRobotFrame()
        }
    }

    /// Moves the clock to the next moment the thinking robot looks different.
    private func scheduleRobotFrame() {
        let now = Date().timeIntervalSinceReferenceDate
        model.clock.t = now
        let next = MascotFace.nextChange(after: now)
        let t = Timer(fire: Date(timeIntervalSinceReferenceDate: next + 0.01), interval: 0, repeats: false) { [weak self] _ in
            guard let self = self, self.animMode == .robot else { return }
            if self.model.mood != .thinking { self.animMode = .off; self.updateAnimation(); return }
            self.scheduleRobotFrame()
        }
        t.tolerance = 0.03
        RunLoop.main.add(t, forMode: .common)
        animTimer = t
    }

    /// For tests without a visible screen (--simulate in a headless session).
    private static let ignoreOcclusion = ProcessInfo.processInfo.environment["BBTB_IGNORE_OCCLUSION"] != nil

    private func targetFrame(_ L: Layout, expanded: Bool) -> NSRect {
        let c = NSRect(x: L.collapsedMinX.rounded(.down), y: L.screenTop - L.notchH,
                       width: ceil(L.collapsedWidth) + 1, height: L.notchH)
        if !expanded, model.banner != nil {
            let h = BannerMath.totalHeight(L)
            return c.union(NSRect(x: BannerMath.minX(L).rounded(.down), y: L.screenTop - h,
                                  width: ceil(BannerMath.width(L)) + 1, height: h))
        }
        guard expanded else { return c }
        let h = model.panelHeight(L)
        let e = NSRect(x: L.expandedMinX.rounded(.down), y: L.screenTop - h,
                       width: ceil(L.expandedWidth) + 1, height: h)
        // Keep the collapsed strip inside the window too, so the cursor over it does not
        // leave the window when the panel opens (no expand/collapse flicker).
        return e.union(c)
    }

    private func setWindow(_ f: NSRect) {
        if model.windowMinX != f.minX { model.windowMinX = f.minX }
        if panel.frame != f { panel.setFrame(f, display: true) }
    }

    /// Called on every snapshot (scanIcons: true) and every clock tick.
    func relayout(scanIcons: Bool = false) {
        // The window list is not free: look for menu bar icons at most every 10 s.
        if scanIcons, Prefs.keepIcons, Date().timeIntervalSince(iconsScannedAt) >= 10 {
            iconsScannedAt = Date()
            let G = Layout.current()
            let lim = StatusIcons.leftmostIconX(rightOf: G.notchMaxX, screenTop: G.screenTop, bandHeight: G.notchH)
            // Menu bar widgets change width all the time: log only a real move, not a few points of jitter.
            let moved: Bool = {
                switch (lim, model.iconLimitX) {
                case (nil, nil): return false
                case let (a?, b?): return abs(a - b) >= 24
                default: return true
                }
            }()
            if moved {
                Log.write(lim.map { String(format: "первый значок строки меню справа от выреза: x=%.0f", $0) }
                          ?? "значки строки меню не найдены, ширина крыла по содержимому")
            }
            model.iconLimitX = lim
        }
        if model.cards.isEmpty {
            if model.expanded { model.expanded = false }
            if model.banner != nil { queue.clear(); bannerWork?.cancel(); model.banner = nil }
            if panel.isVisible { panel.orderOut(nil) }
            if model.visibleOnScreen { model.visibleOnScreen = false }
            updateAnimation()
            return
        }
        if !model.visibleOnScreen { model.visibleOnScreen = true }
        defer { updateAnimation() }
        let L = model.computeLayout()
        let target = targetFrame(L, expanded: model.expanded)
        if !panel.isVisible {
            model.layout = L
            setWindow(target)
            panel.orderFrontRegardless()
            return
        }
        if L != model.layout {
            // Grow the window to cover old and new shape, animate, then fit the window.
            setWindow(panel.frame.union(target))
            withAnimation(.easeInOut(duration: 0.25)) { model.layout = L }
            scheduleSettle()
        } else if panel.frame != target {
            // Same geometry, other height (a row opened, a filter, new tickets).
            setWindow(panel.frame.union(target))
            scheduleSettle()
        }
    }

    private func scheduleSettle() {
        settleWork?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self = self, !self.model.cards.isEmpty else { return }
            self.setWindow(self.targetFrame(self.model.layout, expanded: self.model.expanded))
        }
        settleWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: w)
    }

    private static let debug = ProcessInfo.processInfo.environment["BBTB_DEBUG"] != nil

    private func hover(_ inside: Bool) {
        if Self.debug {
            let m = NSEvent.mouseLocation
            Log.write(String(format: "debug: hover %@ мышь=(%.0f,%.0f) окно=%@", inside ? "in" : "out", m.x, m.y, NSStringFromRect(panel.frame)))
        }
        if model.banner != nil && !model.expanded {
            // Over a message: the 5 s countdown stops; the panel does not open.
            bannerHover(inside)
            return
        }
        if inside {
            collapseWork?.cancel()
            guard !model.expanded else { return }
            let w = DispatchWorkItem { [weak self] in self?.setExpanded(true) }
            expandWork = w
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: w)
        } else {
            expandWork?.cancel()
            guard model.expanded, !menuOpen, !holdOpen else { return }
            let w = DispatchWorkItem { [weak self] in
                guard let self = self, !self.menuOpen else { return }
                self.setExpanded(false)
            }
            collapseWork = w
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: w)
        }
    }

    func setExpanded(_ on: Bool) {
        guard !model.cards.isEmpty || !on else { return }
        if on {
            settleWork?.cancel()
            if !queue.items.isEmpty {
                model.logUI("панель раскрыта: сообщения у выреза не показываются (снято \(queue.items.count))")
                queue.clear()
                bannerWork?.cancel()
                model.banner = nil
            }
            // The expanded panel contains the collapsed strip, so its frame covers both.
            setWindow(targetFrame(model.layout, expanded: true).union(panel.frame))
            model.nowMs = Fmt.nowMs()
            if !model.expanded { Haptic.tap() }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) { model.expanded = true }
        } else {
            withAnimation(.easeOut(duration: 0.25)) {
                model.expanded = false
                model.hoveredId = nil
            }
        }
        // Then fit the window, so clicks around the collapsed strip reach the menu bar.
        scheduleSettle()
        updateAnimation()
    }

    // MARK: messages

    func handle(_ events: [NoteEvent]) {
        for e in events {
            model.logUI("событие: \(e.kind.title) · \(e.card.project) (тред \(e.card.threadId))")
            if e.kind == .done { model.triggerHappy() }
        }
        guard Prefs.bannersOn else {
            model.logUI("сообщения у выреза выключены в меню: не показываю")
            return
        }
        guard !model.expanded else {
            model.logUI("панель раскрыта: сообщение не показываю")
            return
        }
        let wasShowing = queue.current
        for e in events {
            for d in queue.push(e) { model.logUI("очередь сообщений полна (\(BannerQueue.limit)): отброшено «\(d.line1)»") }
        }
        if let w = wasShowing, queue.current != w {
            // The message on screen was the oldest and got dropped.
            showCurrent()
        } else if wasShowing == nil {
            showCurrent()
        }
    }

    private func showCurrent() {
        bannerWork?.cancel()
        guard let e = queue.current, !model.cards.isEmpty else {
            if model.banner != nil {
                withAnimation(.easeOut(duration: 0.25)) { model.banner = nil }
                scheduleSettle()
            }
            return
        }
        setWindow(panel.frame.union(bannerFrame()))
        withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) { model.banner = e }
        model.logUI("показано сообщение «\(e.line1)» — \(e.line2) (в очереди ещё \(queue.items.count - 1))")
        if Prefs.soundOn { Sounds.play(e.kind) }
        bannerRemaining = BannerMath.seconds
        bannerHovered = false
        startBannerTimer()
    }

    private func bannerFrame() -> NSRect {
        let L = model.layout
        let h = BannerMath.totalHeight(L)
        return NSRect(x: BannerMath.minX(L).rounded(.down), y: L.screenTop - h, width: ceil(BannerMath.width(L)) + 1, height: h)
    }

    private func startBannerTimer() {
        bannerWork?.cancel()
        guard !bannerHovered else { return }
        bannerDeadline = Date().addingTimeInterval(bannerRemaining)
        let w = DispatchWorkItem { [weak self] in self?.dismissBanner(how: "прошло 5 с") }
        bannerWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + bannerRemaining, execute: w)
    }

    private func bannerHover(_ inside: Bool) {
        guard inside != bannerHovered else { return }
        bannerHovered = inside
        if inside {
            bannerWork?.cancel()
            if let d = bannerDeadline { bannerRemaining = max(1, d.timeIntervalSinceNow) }
            model.logUI(String(format: "курсор над сообщением: отсчёт стоит (осталось %.1f с)", bannerRemaining))
        } else {
            model.logUI(String(format: "курсор ушёл с сообщения: отсчёт идёт (осталось %.1f с)", bannerRemaining))
            startBannerTimer()
        }
    }

    func dismissBanner(how: String) {
        guard let e = queue.current else { return }
        model.logUI("сообщение «\(e.line1)» закрыто (\(how))")
        queue.popCurrent()
        bannerHovered = false
        if queue.current != nil {
            withAnimation(.easeOut(duration: 0.2)) { model.banner = nil }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.showCurrent() }
        } else {
            showCurrent()
        }
    }

    func bannerClick() {
        guard let e = queue.current else { return }
        model.logUI("нажато сообщение: открываю тред \(e.card.threadId)")
        ThreadOpener.open(threadId: e.card.threadId, dryRun: dryRun, knownBB: knownBB())
        dismissBanner(how: "нажатие")
    }

    var dryRun = false
    /// --ui-open: test run, the panel stays open when the cursor leaves (no mouse needed).
    var holdOpen = false
    var knownBB: () -> String? = { nil }

    // MARK: gear menu

    func showMenu() {
        menuOpen = true
        collapseWork?.cancel()
        if let e = NSApp.currentEvent, e.type == .leftMouseUp || e.type == .leftMouseDown {
            model.logUI(String(format: "открыто меню (шестерёнка): нажатие мышью в x=%.0f y=%.0f", NSEvent.mouseLocation.x, NSEvent.mouseLocation.y))
        } else {
            model.logUI("открыто меню (шестерёнка)")
        }
        AppMenu.popUp(model)
        menuOpen = false
        // The menu may have closed with the mouse outside the panel.
        if !panel.frame.contains(NSEvent.mouseLocation) { hover(false) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model: AppModel
    let options: Options
    var controller: PanelController?
    var client: BBClient?
    var fileSource: FileSource?
    var pollTimer: Timer?
    var clockTimer: Timer?

    init(model: AppModel, options: Options) {
        self.model = model
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = PanelController(model: model)
        self.controller = controller
        controller.dryRun = options.dryRun
        controller.holdOpen = options.uiOpen
        controller.knownBB = { [weak self] in self?.client?.knownBBPath }
        Prefs.forgetStripThread()
        model.forcedMood = options.uiMood

        model.onOpen = { [weak self] card in
            guard let self = self else { return }
            controller.setExpanded(false)
            ThreadOpener.open(threadId: card.threadId, dryRun: self.options.dryRun, knownBB: self.client?.knownBBPath)
        }

        let mode: String
        if options.demo {
            mode = "демо"
            model.apply(Demo.snapshot())
            model.onRefresh = { [weak self] in self?.model.apply(Demo.snapshot()) }
        } else if let path = options.snapshotFile {
            mode = "файл \(path)"
            let src = FileSource(path: path)
            src.onSnapshot = { [weak self] s in self?.model.apply(s) }
            fileSource = src
            src.tick()
            model.onRefresh = { src.tick() }
            pollTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in src.tick() }
        } else {
            mode = "сеть"
            let c = BBClient()
            c.onSnapshot = { [weak self] s in self?.model.apply(s) }
            client = c
            c.tick()
            model.onRefresh = { c.tick(force: true) }
            pollTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in c.tick() }
        }
        Log.write("запуск (\(mode)\(options.dryRun ? ", dry-run" : ""))")
        Log.write(Mascot.describe())
        if let d = options.iconsDir { Log.write("картинки тредов из папки \(d), без сети") }
        model.logActions = options.dryRun || !options.simulate.isEmpty
        applyUIFlags(controller)

        clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            // Times are shown only in the open panel and in a message; the calm strip has none.
            // Tick once a second only then, and only while a turn runs.
            guard self.model.expanded || self.model.banner != nil,
                  self.model.cards.contains(where: { $0.runningSince != nil }) else { return }
            self.model.nowMs = Fmt.nowMs()
        }
        clockTimer?.tolerance = 0.2

        if let i = options.simulateClick {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self = self else { return }
                let cards = self.model.cards
                if i >= 0, i < cards.count {
                    Log.write("simulate-click: строка \(i)")
                    self.model.open(cards[i])
                } else {
                    Log.write("simulate-click: строки \(i) нет")
                }
            }
        }
        for (i, action) in options.simulate.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5 + Double(i)) { [weak self] in
                self?.simulate(action)
            }
        }
        if let secs = options.exitAfter {
            DispatchQueue.main.asyncAfter(deadline: .now() + secs) {
                Log.write("выход по --exit-after")
                Log.flush()
                exit(0)
            }
        }
    }

    /// --ui-*: the same state the mouse would set; the panel opens so it can be seen.
    /// Over the network the first snapshot comes later: wait for it (up to 15 s).
    private func applyUIFlags(_ controller: PanelController, attempt: Int = 0) {
        let o = options
        guard o.uiFilter != nil || o.uiExpand != nil || o.uiHover != nil || o.uiOpen else { return }
        if model.cards.isEmpty {
            guard attempt < 30 else { Log.write("флаги --ui-*: сводки нет 15 с, панель не открыта"); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.applyUIFlags(controller, attempt: attempt + 1)
            }
            return
        }
        UIFlags.apply(o, to: model)
        controller.setExpanded(true)
        controller.relayout()
        Log.write("флаги --ui-*: панель открыта при запуске")
    }

    /// --simulate: calls the same handlers as the buttons, clicks and the mouse monitor.
    private func simulate(_ action: String) {
        guard let controller = controller else { return }
        let parts = action.split(separator: ":", maxSplits: 1).map(String.init)
        let name = parts[0]
        let arg = parts.count > 1 ? parts[1] : nil
        func row() -> SnapshotCard? {
            let cards = model.visibleCards
            guard let i = arg.flatMap(Int.init), i >= 0, i < cards.count else {
                Log.write("simulate \(action): такой строки нет (строк \(cards.count))")
                return nil
            }
            return cards[i]
        }
        Log.write("simulate: \(action)")
        switch name {
        case "row-click": if let c = row() { model.rowClick(c) }
        case "row-open": if let c = row() { model.rowOpen(c, how: "стрелка") }
        case "row-double": if let c = row() { model.rowDouble(c) }
        case "open-panel": controller.setExpanded(true)
        case "close-panel": controller.setExpanded(false)
        case "event":
            // Same path as a real change: a new snapshot with the thread in the new state.
            let p = (arg ?? "").split(separator: ":").map(String.init)
            guard p.count == 2, let k = EventKind(rawValue: p[0]), let i = Int(p[1]),
                  var s = model.snapshot, i >= 0, i < s.cards.count else {
                Log.write("simulate \(action): ждали event:<done|waiting|error>:<N>, N — номер карточки в сводке")
                return
            }
            s.cards[i].state = k.state
            if k == .done { s.cards[i].done = s.cards[i].total; s.cards[i].remaining = 0 }
            s.generatedAt += 1
            s.summary = nil
            model.apply(s)
        case "banner-click": model.bannerClick()
        case "banner-close": model.bannerClose()
        case "menu": Log.write("пункты меню: " + AppMenu.items(model).map { $0.label }.joined(separator: " | "))
        case "menu-item":
            // Runs the menu item number N (from 0, separators counted), like a click on it.
            let items = AppMenu.items(model)
            guard let i = arg.flatMap(Int.init), i >= 0, i < items.count, !items[i].isSeparator else {
                Log.write("simulate \(action): такого пункта нет")
                return
            }
            guard items[i].enabled else {
                Log.write("simulate \(action): пункт «\(items[i].title)» неактивен")
                return
            }
            items[i].action()
        case "filter":
            if let f = arg.flatMap(CardFilter.parse) {
                model.setFilter(f)
            } else {
                Log.write("simulate \(action): неизвестный фильтр")
            }
        default: Log.write("simulate \(action): неизвестное действие")
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        Log.write("выход")
        Log.flush()
    }
}
