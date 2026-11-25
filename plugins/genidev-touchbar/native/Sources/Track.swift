import AppKit
import SwiftUI

// MARK: - One clock for every animation

/// Time for animated drawings. PanelController moves it only while something animated
/// is on screen: 6 times a second in the open panel, and in the collapsed strip only
/// at the moments the robot's face really changes. Views that do not animate never read it.
final class AnimClock: ObservableObject {
    @Published var t: Double = 0.5
}

/// Re-draws `content` when the clock moves; nothing else observes the clock.
struct Clocked<Content: View>: View {
    @ObservedObject var clock: AnimClock
    let content: (Double) -> Content

    init(_ clock: AnimClock, @ViewBuilder content: @escaping (Double) -> Content) {
        self.clock = clock
        self.content = content
    }

    var body: some View { content(clock.t) }
}

// MARK: - Project badge

enum Badge {
    /// Eight calm colours; none of them is a status colour.
    static let palette: [UInt32] = [0x5856D6, 0x2F7F8F, 0x8A5BB8, 0xB0623F, 0x3A72B8, 0x6A8A34, 0xA8527C, 0x56708F]

    /// "Global GG AI" -> "GG", "Ostrov Stats" -> "OS", "Инвестиции в медцентры" -> "ИМ",
    /// one word -> its first two letters, empty -> "?". Short lowercase words ("в", "на", "of")
    /// are skipped, unless nothing else is left.
    static func letters(_ name: String) -> String {
        let parts = name.split(whereSeparator: { !($0.isLetter || $0.isNumber) }).map(String.init)
        guard !parts.isEmpty else { return "?" }
        func service(_ w: String) -> Bool { w.count <= 2 && w == w.lowercased() && (w.first?.isLetter ?? false) }
        var words = parts.filter { !service($0) }
        if words.isEmpty { words = parts }
        if words.count == 1 { return String(words[0].prefix(2)).uppercased() }
        return (String(words[0].prefix(1)) + String(words[1].prefix(1))).uppercased()
    }

    /// FNV-1a over the trimmed name: the same project always gets the same colour.
    static func colorIndex(_ name: String) -> Int {
        var h: UInt32 = 2_166_136_261
        for b in name.trimmingCharacters(in: .whitespacesAndNewlines).utf8 {
            h ^= UInt32(b)
            h = h &* 16_777_619
        }
        return Int(h % UInt32(palette.count))
    }

    static func color(_ name: String) -> Color { Color(hex: palette[colorIndex(name)]) }
}

/// The thread's picture (from the icons plugin) or, without one, a rounded square with the
/// project's letters. Working: a thin arc runs around it; pause: dimmed; waiting: pulsing
/// yellow dot; error: red "!"; done: green check.
struct ProjectBadge: View {
    let project: String
    let state: CardState
    var size: CGFloat = 36
    /// Seconds for the running arc and the pulse; nil = static picture.
    var t: Double? = nil
    /// The frame to draw instead of the letters (transparent background, not rounded).
    var image: NSImage? = nil

    private var radius: CGFloat { size * 0.28 }

    var body: some View {
        let color = Badge.color(project)
        let dim = state == .idle
        ZStack {
            if let img = image {
                Image(nsImage: img)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .opacity(dim ? 0.45 : 1)
                    .saturation(dim ? 0.4 : 1)
            } else {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(color)
                    .opacity(dim ? 0.38 : 1)
                Text(Badge.letters(project))
                    .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                    .foregroundColor(.white.opacity(dim ? 0.55 : 1))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(width: size, height: size)
        .overlay { if state == .working { arc(color) } }
        .overlay(alignment: .topTrailing) { mark.offset(x: 4, y: -4) }
    }

    /// A quarter of the outline at a phase that runs once in 1.6 s.
    @ViewBuilder private func arc(_ color: Color) -> some View {
        let p = CGFloat(((t ?? 0.35) / 1.6).truncatingRemainder(dividingBy: 1))
        let len: CGFloat = 0.28
        let shape = RoundedRectangle(cornerRadius: radius + 3, style: .continuous)
        let style = StrokeStyle(lineWidth: 2, lineCap: .round)
        ZStack {
            shape.stroke(color.opacity(0.22), lineWidth: 1)
            shape.trim(from: p, to: min(1, p + len)).stroke(color, style: style)
            if p + len > 1 { shape.trim(from: 0, to: p + len - 1).stroke(color, style: style) }
        }
        .padding(-3.5)
        .brightness(0.15)
    }

    @ViewBuilder private var mark: some View {
        switch state {
        case .waiting:
            let k = 0.5 + 0.5 * sin((t ?? 0) * .pi)   // 2 s pulse
            Circle().fill(Palette.color(.waiting))
                .frame(width: 11, height: 11)
                .overlay(Circle().stroke(Color.black, lineWidth: 2))
                .scaleEffect(t == nil ? 1 : 0.85 + 0.2 * k)
                .opacity(t == nil ? 1 : 0.6 + 0.4 * k)
        case .error:
            markCircle(Palette.color(.error), Text("!").font(.system(size: 10, weight: .heavy)).foregroundColor(.white))
        case .done:
            markCircle(Palette.color(.done), Image(systemName: "checkmark").font(.system(size: 7, weight: .black)).foregroundColor(.black))
        default:
            EmptyView()
        }
    }

    private func markCircle<V: View>(_ c: Color, _ v: V) -> some View {
        ZStack { Circle().fill(c); v }
            .frame(width: 15, height: 15)
            .overlay(Circle().stroke(Color.black, lineWidth: 2))
    }
}

// MARK: - Track of tickets

enum TrackKind: String, CaseIterable {
    case done, review, active, error, pending, skipped

    init(_ s: TicketStatus) {
        switch s {
        case .done: self = .done
        case .active: self = .active
        case .review: self = .review
        case .pending: self = .pending
        case .error: self = .error
        case .skipped: self = .skipped
        }
    }

    var color: Color {
        switch self {
        case .done: return Color(hex: 0x30D158)
        case .active: return Color(hex: 0xFFD60A)
        case .review: return Color(hex: 0x0A84FF)
        case .pending: return Color.white.opacity(0.18)
        case .error: return Color(hex: 0xFF453A)
        case .skipped: return Color.white.opacity(0.08)
        }
    }

    var legend: String {
        switch self {
        case .done: return L("сделано", "done")
        case .active: return L("делается", "in progress")
        case .review: return L("на проверке", "in review")
        case .pending: return L("в очереди", "queued")
        case .error: return L("сбой", "failed")
        case .skipped: return L("пропущено", "skipped")
        }
    }
}

struct TrackPiece: Equatable {
    var x: CGFloat
    var w: CGFloat
    var kind: TrackKind
}

struct TrackLayout: Equatable {
    var pieces: [TrackPiece]
    /// true = one solid bar split by shares (too many tickets, or no ticket list).
    var solid: Bool
    /// Tickets drawn as separate blocks (0 for a solid bar).
    var blocks: Int
}

enum TrackMath {
    static let height: CGFloat = 6
    static let gap: CGFloat = 2.5
    static let stageGap: CGFloat = 7
    /// Narrower blocks read as noise: then the track becomes one bar by shares.
    /// (3 pt by the ticket would keep 60 tickets as 4.6 pt blocks in a 440 pt row.)
    static let minBlock: CGFloat = 5
    static let radius: CGFloat = 2

    /// Ticket kinds per queue in plan order. Tickets cut by the 60-ticket cap go last:
    /// as many done as the card's count says, the rest in the queue. nil = no ticket list.
    static func groups(_ c: SnapshotCard) -> [[TrackKind]]? {
        guard let stages = c.stages else { return nil }
        var out = stages.map { $0.tickets.map { TrackKind($0.status) } }.filter { !$0.isEmpty }
        let hidden = max(0, c.hiddenTickets ?? 0)
        if hidden > 0 {
            let listedDone = out.reduce(0) { $0 + $1.filter { $0 == .done }.count }
            let hd = min(hidden, max(0, c.done - listedDone))
            out.append(Array(repeating: .done, count: hd) + Array(repeating: .pending, count: hidden - hd))
        }
        return out.isEmpty ? nil : out
    }

    static func layout(_ c: SnapshotCard, width: CGFloat) -> TrackLayout {
        let W = max(0, width)
        guard let gs = groups(c) else {
            // Old snapshot: green share of done tickets.
            let f = CGFloat(Fmt.fraction(done: c.done, total: c.total))
            var ps: [TrackPiece] = []
            if f > 0 { ps.append(TrackPiece(x: 0, w: W * f, kind: .done)) }
            if f < 1 { ps.append(TrackPiece(x: W * f, w: W * (1 - f), kind: .pending)) }
            return TrackLayout(pieces: ps, solid: true, blocks: 0)
        }
        let n = gs.reduce(0) { $0 + $1.count }
        let s = gs.count
        let avail = W - gap * CGFloat(n - s) - stageGap * CGFloat(s - 1)
        let bw = avail / CGFloat(n)
        if bw >= minBlock {
            var ps: [TrackPiece] = []
            var x: CGFloat = 0
            for (gi, g) in gs.enumerated() {
                if gi > 0 { x += stageGap - gap }
                for k in g {
                    ps.append(TrackPiece(x: x, w: bw, kind: k))
                    x += bw + gap
                }
            }
            return TrackLayout(pieces: ps, solid: false, blocks: n)
        }
        // Too many tickets: one bar, colours by share, in a fixed order.
        let all = gs.flatMap { $0 }
        var ps: [TrackPiece] = []
        var x: CGFloat = 0
        for k in TrackKind.allCases {
            let cnt = all.filter { $0 == k }.count
            guard cnt > 0 else { continue }
            let w = W * CGFloat(cnt) / CGFloat(n)
            ps.append(TrackPiece(x: x, w: w, kind: k))
            x += w
        }
        return TrackLayout(pieces: ps, solid: true, blocks: 0)
    }

    /// Kinds present in a card's plan (for the legend).
    static func kinds(_ c: SnapshotCard) -> Set<TrackKind> { Set((groups(c) ?? []).flatMap { $0 }) }
}

/// The track: equal blocks per ticket, wider gaps between queues; the ticket in work pulses.
struct TrackView: View {
    let card: SnapshotCard
    let width: CGFloat
    /// Seconds for the pulse; nil = static.
    var t: Double? = nil

    var body: some View {
        let L = TrackMath.layout(card, width: width)
        let pulse = t.map { 0.5 + 0.5 * (0.5 + 0.5 * cos($0 * 2 * .pi / 1.6)) } ?? 1
        Canvas { ctx, size in
            let h = size.height
            if L.solid {
                ctx.clip(to: Path(roundedRect: CGRect(x: 0, y: 0, width: size.width, height: h), cornerRadius: h / 2))
                for p in L.pieces {
                    ctx.fill(Path(CGRect(x: p.x, y: 0, width: p.w, height: h)),
                             with: .color(p.kind.color.opacity(p.kind == .active ? pulse : 1)))
                }
            } else {
                for p in L.pieces {
                    let r = Path(roundedRect: CGRect(x: p.x, y: 0, width: p.w, height: h),
                                 cornerRadius: min(TrackMath.radius, p.w / 2))
                    ctx.fill(r, with: .color(p.kind.color.opacity(p.kind == .active ? pulse : 1)))
                }
            }
        }
        .frame(width: width, height: TrackMath.height)
    }
}

/// One line over the ticket list: what the colours of the track mean.
struct TrackLegend: View {
    let card: SnapshotCard

    static func kinds(_ c: SnapshotCard) -> [TrackKind] {
        var ks: [TrackKind] = [.done, .active, .review, .pending]
        if TrackMath.kinds(c).contains(.error) { ks.append(.error) }
        return ks
    }

    var body: some View {
        HStack(spacing: 10) {
            ForEach(Self.kinds(card), id: \.self) { k in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(k.color).frame(width: 8, height: 8)
                    Text(k.legend)
                }
            }
        }
        .font(.system(size: 10))
        .foregroundColor(Palette.tertiary)
        .lineLimit(1)
        .fixedSize()
    }
}
