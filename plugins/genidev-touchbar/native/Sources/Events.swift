import AppKit
import SwiftUI

/// Settings kept between launches. Test runs (demo, file, dry-run, render, selftest)
/// use a separate suite, so they never change the installed copy's settings.
enum Prefs {
    nonisolated(unsafe) static var store: UserDefaults = .standard
    static let testSuite = "app.gguzhov.bb-touchbar.test"

    static func useTestStore() {
        UserDefaults.standard.removePersistentDomain(forName: testSuite)
        store = UserDefaults(suiteName: testSuite) ?? .standard
    }

    static var bannersOn: Bool {
        get { store.object(forKey: "bannersOn") as? Bool ?? true }
        set { store.set(newValue, forKey: "bannersOn") }
    }
    static var soundOn: Bool {
        get { store.object(forKey: "soundOn") as? Bool ?? false }
        set { store.set(newValue, forKey: "soundOn") }
    }
    /// Keep the strip off the menu bar icons (off: symmetric strip, right wing always drawn).
    static var keepIcons: Bool {
        get { store.object(forKey: "keepIcons") as? Bool ?? false }
        set { store.set(newValue, forKey: "keepIcons") }
    }
    /// Pinning a thread to the strip is gone: an old saved value is ignored and removed.
    static let legacyStripThreadKey = "stripThreadId"
    static func forgetStripThread() {
        if store.object(forKey: legacyStripThreadKey) != nil {
            store.removeObject(forKey: legacyStripThreadKey)
            Log.write("старое закрепление треда в полоске удалено из настроек")
        }
    }
}

enum EventKind: String, CaseIterable {
    case done, waiting, error

    init?(_ s: CardState) {
        switch s {
        case .done: self = .done
        case .waiting: self = .waiting
        case .error: self = .error
        default: return nil
        }
    }

    var state: CardState {
        switch self {
        case .done: return .done
        case .waiting: return .waiting
        case .error: return .error
        }
    }

    var title: String {
        switch self {
        case .done: return L("Готово", "Done")
        case .waiting: return L("Нужен ответ", "Needs your answer")
        case .error: return L("Ошибка", "Error")
        }
    }

    var mood: Mood {
        switch self {
        case .done: return .happy
        case .waiting: return .asking
        case .error: return .upset
        }
    }

    /// System sounds: one for "done", another for "needs an answer" and "error".
    var soundName: String { self == .done ? "Glass" : "Sosumi" }
}

struct NoteEvent: Identifiable, Equatable {
    let id = UUID()
    let kind: EventKind
    let card: SnapshotCard

    var line1: String { "\(kind.title) · \(card.project)" }
    /// Thread title; for "needs an answer" and "error" the plan note when there is one.
    var line2: String {
        if kind != .done, let n = card.note?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty { return n }
        return card.title
    }
}

/// Compares neighbouring snapshots by threadId. No events on the first snapshot,
/// none while a state stays the same, none for a thread that vanished or just appeared.
struct EventDetector {
    private(set) var last: [String: CardState]?

    mutating func feed(_ cards: [SnapshotCard]) -> [NoteEvent] {
        defer {
            var m: [String: CardState] = [:]
            for c in cards where m[c.threadId] == nil { m[c.threadId] = c.state }
            last = m
        }
        guard let prev = last else { return [] }
        return cards.compactMap { c in
            guard let p = prev[c.threadId], p != c.state, let k = EventKind(c.state) else { return nil }
            return NoteEvent(kind: k, card: c)
        }
    }
}

/// Messages waiting to be shown, the one on screen first. At most 3: the oldest goes.
struct BannerQueue {
    static let limit = 3
    private(set) var items: [NoteEvent] = []
    var current: NoteEvent? { items.first }

    /// Returns the dropped events.
    @discardableResult
    mutating func push(_ e: NoteEvent) -> [NoteEvent] {
        items.append(e)
        var dropped: [NoteEvent] = []
        while items.count > Self.limit { dropped.append(items.removeFirst()) }
        return dropped
    }

    mutating func popCurrent() { if !items.isEmpty { items.removeFirst() } }
    mutating func clear() { items.removeAll() }
}

/// The message grows from the collapsed strip: same right edge (never over the menu bar
/// icons), at least 360 pt wide, extends to the left.
enum BannerMath {
    static let minWidth: CGFloat = 360
    static let height: CGFloat = 56
    static let seconds: Double = 5
    static let radius: CGFloat = 16

    static func width(_ L: Layout) -> CGFloat { max(minWidth, L.collapsedWidth) }
    /// Icons not protected: centred under the strip. Protected: same right edge as the strip.
    static func maxX(_ L: Layout) -> CGFloat { L.keepIcons ? L.collapsedMinX + L.collapsedWidth : L.notchCenterX + width(L) / 2 }
    static func minX(_ L: Layout) -> CGFloat { maxX(L) - width(L) }
    static func totalHeight(_ L: Layout) -> CGFloat { L.notchH + height }
}

/// The card under the strip: mascot (or robot), "Готово · project", second line, "6/6 · 46 мин", close.
struct BannerContent: View {
    @ObservedObject var model: AppModel
    let event: NoteEvent
    let width: CGFloat

    var body: some View {
        let c = event.card
        HStack(spacing: 10) {
            // done/waiting/error faces do not move: drawn once.
            MascotFace(mood: event.kind.mood, size: 32, t: 0.5)
            VStack(alignment: .leading, spacing: 3) {
                (Text(event.kind.title).foregroundColor(event.kind.mood.accent)
                 + Text(" · \(c.project)").foregroundColor(.white))
                    .font(.system(size: 13, weight: .semibold))
                Text(event.line2)
                    .font(.system(size: 11))
                    .foregroundColor(Palette.secondary)
            }
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(c.done)/\(c.total) · \(model.timeText(c))")
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundColor(.white)
                .lineLimit(1)
                .fixedSize()
            Button(action: { model.bannerClose() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(Palette.secondary)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(Color.white.opacity(0.1)))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Закрыть сообщение")
        }
        .padding(.leading, 12)
        .padding(.trailing, 10)
        .frame(width: width, height: BannerMath.height, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { model.bannerClick() }
        .help("Открыть тред в bb")
    }
}

enum Sounds {
    static func play(_ k: EventKind) { NSSound(named: NSSound.Name(k.soundName))?.play() }
}
