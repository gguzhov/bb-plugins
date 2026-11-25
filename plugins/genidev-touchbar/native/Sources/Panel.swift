import AppKit
import SwiftUI

/// Sizes of the expanded panel. Views use these exact heights, so the window height
/// is computed here without measuring SwiftUI.
enum PanelMath {
    static let maxWidth: CGFloat = 500
    /// The panel asks for this width (the strip may make it wider, up to maxWidth).
    static let preferredWidth: CGFloat = 480
    static let maxScreenFraction: CGFloat = 0.7

    // Header (on the notch band) and filter row.
    static let headerPad: CGFloat = 12
    static let headerButton: CGFloat = 22
    static let filterH: CGFloat = 34
    static let filterButtonH: CGFloat = 24
    static let filterGap: CGFloat = 6
    /// One header line under the top band: mascot 26 pt and the thought, 14.5 pt semibold.
    static let robotRowH: CGFloat = 38
    static let robotRowFace: CGFloat = 26
    static let thoughtSize: CGFloat = 14.5

    // List.
    static let listTop: CGFloat = 6
    static let listBottom: CGFloat = 10
    static let sidePad: CGFloat = 10
    static let rowInset: CGFloat = 10
    static let arrowSlot: CGFloat = 22
    // Row: badge and two lines, then the track.
    static let badge: CGFloat = 36
    static let badgeGap: CGFloat = 10
    static let rowTop: CGFloat = 9
    static let trackGap: CGFloat = 8
    static let rowBottom: CGFloat = 9
    static var rowH: CGFloat { rowTop + badge + trackGap + TrackMath.height + rowBottom }
    /// Details start under the text column: inset + badge + gap.
    static var detailsLead: CGFloat { rowInset + badge + badgeGap }

    // Details of an open row.
    static let noteLineH: CGFloat = 14
    static let noteEtaGap: CGFloat = 2
    static let etaH: CGFloat = 16
    static let legendH: CGFloat = 16
    static let stageH: CGFloat = 20
    static let ticketH: CGFloat = 20
    static let stageGap: CGFloat = 4
    static let hiddenH: CGFloat = 18
    static let placeholderH: CGFloat = 18
    static let openH: CGFloat = 24
    static let blockGap: CGFloat = 8
    static let detailsBottom: CGFloat = 10

    static let noteFont = NSFont.systemFont(ofSize: 11)

    // MARK: width

    static func sideWidth(_ L: Layout) -> CGFloat { (L.expandedWidth - L.notchW) / 2 }
    static func rowWidth(_ L: Layout) -> CGFloat { L.expandedWidth - 2 * sidePad }
    static func trackWidth(_ L: Layout) -> CGFloat { rowWidth(L) - 2 * rowInset }
    static func detailsWidth(_ L: Layout) -> CGFloat { rowWidth(L) - detailsLead - rowInset }
    static func filterButtonWidth(_ L: Layout) -> CGFloat {
        floor((L.expandedWidth - 2 * sidePad - 2 * filterGap) / 3)
    }

    // MARK: height

    static func noteLines(_ s: String, width: CGFloat) -> Int {
        // 4 pt narrower than the view: when in doubt, reserve the second line.
        let r = (s as NSString).boundingRect(with: NSSize(width: max(20, width - 4), height: 10_000),
                                             options: [.usesLineFragmentOrigin], attributes: [.font: noteFont])
        let lh = NSLayoutManager().defaultLineHeight(for: noteFont)
        return r.height > lh * 1.5 ? 2 : 1
    }

    /// What an open row shows; the view and the height come from the same values.
    struct Details {
        var note: String?
        var noteLines = 0
        var eta: String?
        var stages: [SnapshotStage]
        var hidden: Int

        init(card: SnapshotCard, width: CGFloat) {
            let n = card.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            note = n.isEmpty ? nil : n
            if let n = note { noteLines = PanelMath.noteLines(n, width: width) }
            eta = card.etaMs.map { Fmt.eta(ms: $0) }
            stages = (card.stages ?? []).filter { !$0.tickets.isEmpty }
            hidden = max(0, card.hiddenTickets ?? 0)
        }

        var hasInfo: Bool { note != nil || eta != nil }
        var hasTickets: Bool { !stages.isEmpty }

        var infoHeight: CGFloat {
            var h: CGFloat = 0
            if note != nil { h += CGFloat(noteLines) * PanelMath.noteLineH }
            if eta != nil { h += (note != nil ? PanelMath.noteEtaGap : 0) + PanelMath.etaH }
            return h
        }

        var ticketsHeight: CGFloat {
            var h: CGFloat
            if hasTickets {
                h = PanelMath.legendH + PanelMath.stageGap + stages.reduce(0) { acc, s in
                    acc + (s.name.isEmpty ? 0 : PanelMath.stageH) + CGFloat(s.tickets.count) * PanelMath.ticketH
                } + CGFloat(stages.count - 1) * PanelMath.stageGap
            } else {
                h = PanelMath.placeholderH
            }
            if hidden > 0 { h += PanelMath.hiddenH }
            return h
        }

        var height: CGFloat {
            (hasInfo ? infoHeight + PanelMath.blockGap : 0) + ticketsHeight + PanelMath.blockGap
                + PanelMath.openH + PanelMath.detailsBottom
        }
    }

    static func listHeight(cards: [SnapshotCard], expandedId: String?, layout L: Layout) -> CGFloat {
        guard !cards.isEmpty else { return listTop + listBottom }
        var h = listTop + listBottom + CGFloat(cards.count) * rowH + CGFloat(cards.count - 1) * L.rowGap
        if let id = expandedId, let c = cards.first(where: { $0.id == id }) {
            h += Details(card: c, width: detailsWidth(L)).height
        }
        return h
    }

    static func filterRowHeight(_ all: [SnapshotCard]) -> CGFloat {
        CardFilter.rowVisible(all) ? filterH : 0
    }

    static func contentHeight(all: [SnapshotCard], visible: [SnapshotCard], expandedId: String?, layout L: Layout) -> CGFloat {
        L.notchH + robotRowH + filterRowHeight(all) + listHeight(cards: visible, expandedId: expandedId, layout: L)
    }

    static func maxHeight(_ L: Layout) -> CGFloat { floor(L.screenH * maxScreenFraction) }

    static func panelHeight(all: [SnapshotCard], visible: [SnapshotCard], expandedId: String?, layout L: Layout) -> CGFloat {
        min(contentHeight(all: all, visible: visible, expandedId: expandedId, layout: L), maxHeight(L))
    }
}

// MARK: - Model: panel state and the handlers every action goes through

extension AppModel {
    var visibleCards: [SnapshotCard] { cards.filter(filter.matches) }

    func panelHeight(_ L: Layout) -> CGFloat {
        PanelMath.panelHeight(all: cards, visible: visibleCards, expandedId: expandedId, layout: L)
    }

    func rowIndex(_ card: SnapshotCard) -> Int { visibleCards.firstIndex(where: { $0.id == card.id }) ?? -1 }

    func logUI(_ s: String) { if logActions { Log.write(s) } }

    /// Server clock now (local clock corrected by generatedAt).
    var serverNow: Double { nowMs + clockOffset }

    /// After new data: filter back to "Все" when it emptied; forget rows that are gone.
    func normalizeUI() {
        let f = CardFilter.normalized(filter, cards: cards)
        if f != filter {
            logUI("фильтр «\(filter.title)» опустел, показываю все")
            filter = f
        }
        let ids = Set(visibleCards.map { $0.id })
        if let e = expandedId, !ids.contains(e) { expandedId = nil }
        if let h = hoveredId, !ids.contains(h) { hoveredId = nil }
    }

    func setHover(_ card: SnapshotCard, _ inside: Bool) {
        let v: String? = inside ? card.id : (hoveredId == card.id ? nil : hoveredId)
        guard v != hoveredId else { return }
        withAnimation(.easeOut(duration: 0.15)) { hoveredId = v }
    }

    /// Single click on a row: open or close its tickets. The second click of a
    /// double click is ignored here (the double click opens the thread instead).
    func rowClick(_ card: SnapshotCard) {
        let now = Date()
        if let l = lastRowClick, l.id == card.id, now.timeIntervalSince(l.at) < NSEvent.doubleClickInterval {
            lastRowClick = nil
            return
        }
        lastRowClick = (card.id, now)
        let opening = expandedId != card.id
        withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) { expandedId = opening ? card.id : nil }
        if opening && !staticRender { Haptic.tap() }
        let n = (card.stages ?? []).reduce(0) { $0 + $1.tickets.count }
        logUI(opening ? "раскрыта строка \(rowIndex(card)) «\(card.project)»: тикетов в списке \(n)"
                      : "свёрнута строка \(rowIndex(card)) «\(card.project)»")
        onLayoutNeeded()
    }

    /// Arrow button, double click and the "Открыть тред" button all end here.
    func rowOpen(_ card: SnapshotCard, how: String) {
        logUI("открываю тред \(card.threadId) (строка \(rowIndex(card)), \(how))")
        onOpen(card)
    }

    func rowDouble(_ card: SnapshotCard) { rowOpen(card, how: "двойное нажатие") }

    func setFilter(_ f: CardFilter) {
        guard f != filter else { return }
        guard CardFilter.selectable(f, cards: cards) else {
            logUI("фильтр «\(f.title)» пуст: выбрать нельзя")
            return
        }
        withAnimation(.easeInOut(duration: 0.2)) {
            filter = f
            normalizeUI()
        }
        let n = visibleCards.count
        logUI("фильтр «\(filter.title)»: в списке \(Fmt.threads(n))")
        onLayoutNeeded()
    }

    func showMenu() { onMenu() }
}

enum Haptic {
    static func tap() { NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now) }
}

/// The right-click menu of the strip and the gear button share these items.
enum AppMenu {
    struct Item {
        enum Kind { case action, toggle(Bool), separator }
        var title: String
        var kind: Kind = .action
        var enabled = true
        var action: () -> Void = {}

        static let separator = Item(title: "", kind: .separator)

        var isSeparator: Bool { if case .separator = kind { return true }; return false }
        var checked: Bool? { if case .toggle(let on) = kind { return on }; return nil }

        /// For --print-menu and the log.
        var label: String {
            if isSeparator { return "---" }
            var s = checked.map { "\($0 ? "[x]" : "[ ]") \(title)" } ?? title
            if !enabled { s += " (неактивен)" }
            return s
        }
    }

    static func items(_ model: AppModel) -> [Item] {
        let banners = Prefs.bannersOn
        return [
            Item(title: "Обновить данные", action: {
                model.logUI("меню: обновить данные")
                model.refresh()
            }),
            Item(title: "Сообщать у выреза, когда тред закончил или ждёт ответа", kind: .toggle(banners), action: {
                Prefs.bannersOn.toggle()
                model.logUI("сообщения у выреза: \(Prefs.bannersOn ? "включены" : "выключены")")
                model.objectWillChange.send()
            }),
            Item(title: "Звук при таком сообщении", kind: .toggle(Prefs.soundOn), enabled: banners, action: {
                Prefs.soundOn.toggle()
                model.logUI("звук сообщений: \(Prefs.soundOn ? "включён" : "выключен")")
                model.objectWillChange.send()
            }),
            Item(title: "Не закрывать значки строки меню", kind: .toggle(Prefs.keepIcons), action: {
                Prefs.keepIcons.toggle()
                model.logUI("не закрывать значки строки меню: \(Prefs.keepIcons ? "включено" : "выключено")")
                model.onIconsPrefChanged()
                model.objectWillChange.send()
            }),
            .separator,
            Item(title: "Выключить полоску (вернётся после перезагрузки)", action: {
                Log.write("меню: полоска выключена до перезагрузки")
                Log.flush()
                NSApp.terminate(nil)
            }),
        ]
    }

    final class Target: NSObject {
        let fn: () -> Void
        init(_ fn: @escaping () -> Void) { self.fn = fn }
        @objc func run() { fn() }
    }

    /// Pops the menu at the mouse. Blocks until the menu closes.
    static func popUp(_ model: AppModel) {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for it in items(model) {
            if it.isSeparator {
                menu.addItem(.separator())
                continue
            }
            let t = Target(it.action)
            let mi = NSMenuItem(title: it.title, action: #selector(Target.run), keyEquivalent: "")
            mi.target = t
            mi.representedObject = t   // the target is weak; keep it alive
            mi.isEnabled = it.enabled
            if let on = it.checked { mi.state = on ? .on : .off }
            menu.addItem(mi)
        }
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }
}

// MARK: - Hover tracking that works in a panel of an inactive app

final class RowTrackerView: NSView {
    var onHover: (Bool) -> Void = { _ in }
    private var area: NSTrackingArea?

    /// Never take clicks: SwiftUI gestures and buttons above get them.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let a = area { removeTrackingArea(a) }
        let a = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(a)
        area = a
    }
    override func mouseEntered(with event: NSEvent) { onHover(true); NSCursor.pointingHand.set() }
    override func mouseMoved(with event: NSEvent) { NSCursor.pointingHand.set() }
    override func mouseExited(with event: NSEvent) { onHover(false); NSCursor.arrow.set() }
}

struct RowTracker: NSViewRepresentable {
    let onHover: (Bool) -> Void
    func makeNSView(context: Context) -> RowTrackerView {
        let v = RowTrackerView()
        v.onHover = onHover
        return v
    }
    func updateNSView(_ v: RowTrackerView, context: Context) { v.onHover = onHover }
}

// MARK: - Views

extension RowText.Tone {
    var color: Color {
        switch self {
        case .primary: return .white
        case .secondary: return Palette.secondary
        case .waiting: return Palette.color(.waiting)
        case .error: return Palette.color(.error)
        case .done: return Palette.color(.done)
        }
    }
}

struct CardRow: View {
    @ObservedObject var model: AppModel
    let card: SnapshotCard
    let layout: Layout

    private var hovered: Bool { model.hoveredId == card.id }
    private var isOpen: Bool { model.expandedId == card.id }
    /// Animations run only in the open panel of a live app.
    private var animate: Bool { !model.staticRender && model.expanded }

    /// Thread picture (or letters). Eyes, the arc and the pulse move with the shared clock,
    /// only in the open panel; renders may freeze a moment with --ui-time.
    @ViewBuilder private var badge: some View {
        if animate && (card.state == .working || card.state == .waiting) {
            Clocked(model.clock) { t in ThreadBadge(store: IconStore.shared, card: card, size: PanelMath.badge, t: t) }
        } else {
            ThreadBadge(store: IconStore.shared, card: card, size: PanelMath.badge,
                        t: model.staticRender ? model.frozenT : nil)
        }
    }

    @ViewBuilder private var track: some View {
        let w = PanelMath.trackWidth(layout)
        // Only a working thread really does its yellow ticket now: only that one pulses.
        if animate && card.state == .working && TrackMath.kinds(card).contains(.active) {
            Clocked(model.clock) { t in TrackView(card: card, width: w, t: t) }
        } else {
            TrackView(card: card, width: w)
        }
    }

    private var lines: some View {
        let now = RowText.now(card)
        let taskTime: String? = card.state == .working
            ? RowText.currentTicket(card).flatMap { RowText.ticketTime($0, card: card, serverNow: model.serverNow) }
            : nil
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                (Text(card.project).font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                 + Text("  " + card.title).font(.system(size: 12)).foregroundColor(Palette.secondary))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Text("\(card.done)/\(card.total)")
                        .font(.system(size: 11, weight: .medium).monospacedDigit())
                        .foregroundColor(Palette.secondary)
                    Text(model.timeText(card))
                        .font(.system(size: 12, weight: .medium).monospacedDigit())
                        .foregroundColor(.white)
                }
                .lineLimit(1)
                .fixedSize()
                .help("Сделано задач из плана · сколько тред работал всего")
            }
            HStack(spacing: 8) {
                Text(now.text)
                    .font(.system(size: 12))
                    .foregroundColor(now.tone.color)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let tt = taskTime {
                    Text(tt)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundColor(Palette.secondary)
                        .lineLimit(1)
                        .fixedSize()
                        .help("Время на эту задачу")
                }
            }
        }
    }

    private var head: some View {
        VStack(alignment: .leading, spacing: PanelMath.trackGap) {
            HStack(spacing: PanelMath.badgeGap) {
                badge
                lines
                Button(action: { model.rowOpen(card, how: "стрелка") }) {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: PanelMath.arrowSlot, height: PanelMath.arrowSlot)
                        .background(Circle().fill(Color.white.opacity(0.16)))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Открыть тред в bb")
                .opacity(hovered ? 1 : 0)
                .allowsHitTesting(hovered)
                .frame(width: hovered ? PanelMath.arrowSlot : 0)
                .padding(.leading, hovered ? 0 : -PanelMath.badgeGap)
            }
            .frame(height: PanelMath.badge)
            track
        }
        .padding(.horizontal, PanelMath.rowInset)
        .padding(.top, PanelMath.rowTop)
        .padding(.bottom, PanelMath.rowBottom)
        .frame(height: PanelMath.rowH)
        .contentShape(Rectangle())
        .onTapGesture { model.rowClick(card) }
        .simultaneousGesture(TapGesture(count: 2).onEnded { model.rowDouble(card) })
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 11, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            head
            if isOpen {
                TicketDetails(model: model, card: card, layout: layout)
                    .padding(.leading, PanelMath.detailsLead)
                    .padding(.trailing, PanelMath.rowInset)
                    .transition(.opacity)
            }
        }
        .frame(width: PanelMath.rowWidth(layout), alignment: .topLeading)
        .background(shape.fill(Color.white.opacity(hovered ? 0.12 : 0.07)))
        .background(Group {
            if !model.staticRender { RowTracker { inside in model.setHover(card, inside) } }
        })
        .clipShape(shape)
        .help(isOpen ? "Нажмите, чтобы свернуть; двойное нажатие откроет тред" : "Нажмите, чтобы увидеть задачи; двойное нажатие откроет тред")
    }
}

struct TicketDetails: View {
    @ObservedObject var model: AppModel
    let card: SnapshotCard
    let layout: Layout

    private func gap(_ h: CGFloat) -> some View { Color.clear.frame(height: h) }

    private var noteColor: Color {
        switch card.state {
        case .waiting, .error: return Palette.color(card.state)
        default: return Palette.secondary
        }
    }

    var body: some View {
        let d = PanelMath.Details(card: card, width: PanelMath.detailsWidth(layout))
        let now = model.serverNow
        VStack(alignment: .leading, spacing: 0) {
            if d.hasInfo {
                if let note = d.note {
                    Text(note)
                        .font(.system(size: 11))
                        .foregroundColor(noteColor)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .frame(height: CGFloat(d.noteLines) * PanelMath.noteLineH, alignment: .topLeading)
                }
                if let eta = d.eta {
                    if d.note != nil { gap(PanelMath.noteEtaGap) }
                    HStack(spacing: 4) {
                        Image(systemName: "hourglass")
                            .font(.system(size: 10))
                        Text(eta)
                            .font(.system(size: 11, weight: .medium).monospacedDigit())
                    }
                    .foregroundColor(Palette.secondary)
                    .lineLimit(1)
                    .frame(height: PanelMath.etaH)
                }
                gap(PanelMath.blockGap)
            }
            if d.hasTickets {
                TrackLegend(card: card)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: PanelMath.legendH)
                gap(PanelMath.stageGap)
                ForEach(Array(d.stages.enumerated()), id: \.offset) { i, stage in
                    if i > 0 { gap(PanelMath.stageGap) }
                    if !stage.name.isEmpty {
                        Text(stage.name)
                            .font(.system(size: 11))
                            .foregroundColor(Palette.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .bottomLeading)
                            .frame(height: PanelMath.stageH, alignment: .bottomLeading)
                    }
                    ForEach(Array(stage.tickets.enumerated()), id: \.offset) { _, t in
                        TicketLine(ticket: t, right: RowText.ticketRight(t, card: card, serverNow: now))
                    }
                }
            } else {
                Text(L("Список задач появится после обновления плагина", "Update the plugin to see the task list"))
                    .font(.system(size: 11))
                    .foregroundColor(Palette.tertiary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(height: PanelMath.placeholderH)
            }
            if d.hidden > 0 {
                Text(Fmt.moreTickets(d.hidden))
                    .font(.system(size: 11))
                    .foregroundColor(Palette.tertiary)
                    .padding(.leading, TicketLine.titleLead)
                    .frame(height: PanelMath.hiddenH)
            }
            gap(PanelMath.blockGap)
            Button(action: { model.rowOpen(card, how: "кнопка «Открыть тред»") }) {
                HStack(spacing: 5) {
                    Text(L("Открыть тред", "Open thread"))
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9, weight: .bold))
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white)
                .padding(.horizontal, 11)
                .frame(height: PanelMath.openH)
                .background(Capsule().fill(Color.white.opacity(0.14)))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .help("Открыть тред в bb")
            .lineLimit(1)
            .fixedSize()
            gap(PanelMath.detailsBottom)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

struct TicketLine: View {
    let ticket: SnapshotTicket
    /// "8 мин · Sonnet 5.5" / owner only / nil.
    var right: String? = nil

    /// Executor's picture, only for a named executor with a usable icon.
    static func agentIcon(_ t: SnapshotTicket) -> SnapshotIcon? {
        guard let a = t.agent?.trimmingCharacters(in: .whitespacesAndNewlines), !a.isEmpty,
              let i = t.agentIcon, i.usable else { return nil }
        return i
    }

    static func agentHelp(_ t: SnapshotTicket) -> String? {
        guard let a = t.agent?.trimmingCharacters(in: .whitespacesAndNewlines), !a.isEmpty else { return nil }
        return "Исполнитель: \(a)"
    }
    static let iconW: CGFloat = 14
    static let iconGap: CGFloat = 7
    static var titleLead: CGFloat { iconW + iconGap }

    @ViewBuilder private var icon: some View {
        switch ticket.status {
        case .done:
            Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundColor(TrackKind.done.color)
        case .active:
            Circle().fill(TrackKind.active.color).frame(width: 7, height: 7)
        case .review:
            Image(systemName: "eye.circle.fill").font(.system(size: 11)).foregroundColor(TrackKind.review.color)
        case .error:
            Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundColor(TrackKind.error.color)
        case .pending:
            Image(systemName: "circle").font(.system(size: 11)).foregroundColor(Palette.tertiary)
        case .skipped:
            Image(systemName: "minus").font(.system(size: 10, weight: .semibold)).foregroundColor(Palette.color(.idle))
        }
    }

    private var titleColor: Color {
        switch ticket.status {
        case .pending: return Palette.secondary
        case .skipped: return Palette.tertiary
        case .done: return Color.white.opacity(0.85)
        default: return .white
        }
    }

    var body: some View {
        HStack(spacing: Self.iconGap) {
            icon.frame(width: Self.iconW)
            Text(ticket.title.isEmpty ? L("Без названия", "Untitled") : ticket.title)
                .strikethrough(ticket.status == .skipped, color: Palette.tertiary)
                .font(.system(size: 12, weight: ticket.status == .active ? .semibold : .regular))
                .foregroundColor(titleColor)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let r = right {
                HStack(spacing: 5) {
                    if let icon = Self.agentIcon(ticket) { AgentIcon(store: IconStore.shared, icon: icon) }
                    Text(r)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundColor(Palette.tertiary)
                        .lineLimit(1)
                        .fixedSize()
                }
            } else if let icon = Self.agentIcon(ticket) {
                AgentIcon(store: IconStore.shared, icon: icon)
            }
        }
        .frame(height: PanelMath.ticketH)
        .helpIf(Self.agentHelp(ticket))
    }
}

/// On the notch band: only the gear on the right.
struct HeaderBar: View {
    @ObservedObject var model: AppModel
    let layout: Layout

    var body: some View {
        let side = PanelMath.sideWidth(layout)
        HStack(spacing: 0) {
            Color.clear.frame(width: side + layout.notchW)
            Button(action: { model.showMenu() }) {
                Image(systemName: "gearshape")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Palette.secondary)
                    .frame(width: PanelMath.headerButton, height: PanelMath.headerButton)
                    .background(Circle().fill(Color.white.opacity(0.08)))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Настройки")
            .padding(.trailing, PanelMath.headerPad)
            .frame(width: side, alignment: .trailing)
        }
        .frame(width: layout.expandedWidth, height: layout.notchH)
    }
}

/// Three equal buttons across the panel: all, working, pause.
struct FilterBar: View {
    @ObservedObject var model: AppModel
    let layout: Layout

    var body: some View {
        let cards = model.cards
        let w = PanelMath.filterButtonWidth(layout)
        HStack(spacing: PanelMath.filterGap) {
            ForEach(CardFilter.allCases, id: \.self) { f in
                let on = model.filter == f
                let n = f.count(cards)
                let can = CardFilter.selectable(f, cards: cards)
                Button(action: { model.setFilter(f) }) {
                    HStack(spacing: 5) {
                        if f == .working {
                            Circle().fill(Palette.color(.working)).frame(width: 6, height: 6)
                        } else if f == .idle {
                            Circle().fill(Palette.color(.idle)).frame(width: 6, height: 6)
                        }
                        Text(f.title)
                        Text("\(n)")
                            .monospacedDigit()
                            .foregroundColor(on ? .white : Palette.tertiary)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(on ? .white : Palette.secondary)
                    .lineLimit(1)
                    .frame(width: w, height: PanelMath.filterButtonH)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(on ? 0.22 : 0.07)))
                    .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!can)
                .opacity(can ? 1 : 0.4)
                .help(f == .idle ? "Треды, которые сейчас не работают: пауза, ждут ответа, ошибка, готово" : "")
            }
        }
        .frame(width: layout.expandedWidth, height: PanelMath.filterH)
    }
}

struct PanelContent: View {
    @ObservedObject var model: AppModel
    let layout: Layout
    let height: CGFloat

    var body: some View {
        let L = layout
        let visible = model.visibleCards
        let filterH = PanelMath.filterRowHeight(model.cards)
        let listAvail = max(0, height - L.notchH - PanelMath.robotRowH - filterH)
        let need = PanelMath.listHeight(cards: visible, expandedId: model.expandedId, layout: L)
        let overflow = need > listAvail + 0.5
        let rows = VStack(spacing: L.rowGap) {
            ForEach(visible) { card in
                CardRow(model: model, card: card, layout: L).id(card.id)
            }
        }
        .padding(.top, PanelMath.listTop)
        .padding(.bottom, PanelMath.listBottom)
        .padding(.horizontal, PanelMath.sidePad)
        .frame(width: L.expandedWidth, alignment: .top)

        VStack(spacing: 0) {
            HeaderBar(model: model, layout: L)
            RobotRow(model: model, layout: L)
            if filterH > 0 { FilterBar(model: model, layout: L) }
            Group {
                if overflow && !model.staticRender {
                    ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: true) { rows }
                            .onChange(of: model.expandedId) { id in
                                guard let id else { return }
                                withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo(id, anchor: .top) }
                            }
                    }
                } else {
                    rows
                }
            }
            .frame(width: L.expandedWidth, height: listAvail, alignment: .top)
            .clipped()
            .overlay(alignment: .bottom) {
                // Soft edge where the list continues below the panel.
                if overflow {
                    LinearGradient(colors: [Color.black.opacity(0), Color.black], startPoint: .top, endPoint: .bottom)
                        .frame(height: 22)
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(width: L.expandedWidth, height: height, alignment: .top)
    }
}

struct RootView: View {
    @ObservedObject var model: AppModel
    /// Debug overlay for proof renders: outline of the camera notch.
    var showNotchZone = false

    var body: some View {
        let L = model.layout
        let cards = model.cards
        let expanded = model.expanded && !cards.isEmpty
        // Everything is placed in screen x coordinates, relative to the window's left edge,
        // so the window can change size without the strip jumping.
        let banner = expanded ? nil : model.banner
        let shapeX = expanded ? L.expandedMinX : (banner != nil ? BannerMath.minX(L) : L.collapsedMinX)
        let shapeW = expanded ? L.expandedWidth : (banner != nil ? BannerMath.width(L) : L.collapsedWidth)
        let shapeH = expanded ? model.panelHeight(L) : (banner != nil ? BannerMath.totalHeight(L) : L.notchH)
        let radius = expanded ? 18 : (banner != nil ? BannerMath.radius : L.collapsedRadius)
        ZStack(alignment: .topLeading) {
            if !cards.isEmpty {
                ZStack(alignment: .topLeading) {
                    NotchShape(radius: radius)
                        .fill(Color.black)
                    CalmContent(model: model, layout: L,
                                animate: !model.staticRender && model.visibleOnScreen && !expanded)
                    .offset(x: L.collapsedMinX - shapeX)
                    .opacity(expanded ? 0 : 1)
                    if let b = banner {
                        BannerContent(model: model, event: b, width: shapeW)
                            .offset(y: L.notchH)
                            .transition(.opacity)
                    }
                    if expanded {
                        PanelContent(model: model, layout: L, height: shapeH)
                            .transition(.opacity)
                    }
                    if showNotchZone && L.notchW > 0 {
                        Rectangle()
                            .stroke(Color.red, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                            .frame(width: L.notchW, height: L.notchH)
                            .offset(x: L.notchMinX - shapeX)
                    }
                }
                .frame(width: shapeW, height: shapeH, alignment: .topLeading)
                // Clip to the panel shape: a long list must not cover the rounded corners.
                .clipShape(NotchShape(radius: radius))
                .contextMenu {
                    ForEach(Array(AppMenu.items(model).enumerated()), id: \.offset) { _, it in
                        if it.isSeparator {
                            Divider()
                        } else if let on = it.checked {
                            Toggle(it.title, isOn: Binding(get: { on }, set: { _ in it.action() }))
                                .disabled(!it.enabled)
                        } else {
                            Button(it.title, action: it.action)
                                .disabled(!it.enabled)
                        }
                    }
                }
                .offset(x: shapeX - model.windowMinX)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
