import AppKit
import ImageIO
import SwiftUI

/// The robot's face. Order of `allCases` = order in the proof sheet.
enum Mood: String, CaseIterable {
    case thinking, asking, upset, happy, sleeping

    var title: String {
        switch self {
        case .thinking: return L("думает", "thinking")
        case .asking: return L("спрашивает", "asking")
        case .upset: return L("расстроен", "upset")
        case .happy: return L("рад", "happy")
        case .sleeping: return L("спит", "sleeping")
        }
    }

    var accent: Color {
        switch self {
        case .thinking, .happy: return Palette.color(.working)
        case .asking: return Palette.color(.waiting)
        case .upset: return Palette.color(.error)
        case .sleeping: return Palette.color(.idle)
        }
    }

    /// Lasting mood. Priority: upset, asking, thinking, happy (all plans done), sleeping.
    /// A fresh "plan done" event shows happy over anything but upset.
    static func from(_ s: SnapshotSummary, happyEvent: Bool = false) -> Mood {
        if s.threadsError > 0 { return .upset }
        if happyEvent { return .happy }
        if s.threadsWaiting > 0 { return .asking }
        if s.threadsWorking > 0 { return .thinking }
        if allDone(s) { return .happy }
        return .sleeping
    }

    static func allDone(_ s: SnapshotSummary) -> Bool {
        s.threadsWorking == 0 && s.threadsWaiting == 0 && s.threadsError == 0 && s.total > 0 && s.done >= s.total
    }
}

// MARK: - Drawing

/// Robot head drawn with Canvas: rounded head, antenna with a light, two eyes, a mouth.
/// `t` is seconds for the idle animation; static renders pass a fixed value.
struct RobotFace: View {
    let mood: Mood
    let size: CGFloat
    var t: Double = 0
    /// Smooth antenna pulse (open panel, 6 frames a second). The collapsed strip keeps
    /// the antenna steady, so its face changes only on a glance or a blink.
    var antennaPulse = true

    var body: some View {
        Canvas { ctx, sz in
            RobotFace.draw(&ctx, s: min(sz.width, sz.height), mood: mood, t: t, antennaPulse: antennaPulse)
        }
        .frame(width: size, height: size)
    }

    /// Next moment after `t` when the thinking face (without the antenna pulse) changes:
    /// a glance boundary of the 6 s loop or the start or end of a blink.
    static func nextChange(after t: Double) -> Double {
        var best = Double.infinity
        let gBase = (t / 6).rounded(.down) * 6
        for k in 0...1 {
            for b in [1.5, 2.7, 4.2, 5.4] {
                let x = gBase + Double(k) * 6 + b
                if x > t + 0.001 { best = min(best, x) }
            }
        }
        let bBase = (t / 4.7).rounded(.down) * 4.7
        for k in 0...1 {
            for b in [0.0, 0.17] {
                let x = bBase + Double(k) * 4.7 + b
                if x > t + 0.001 { best = min(best, x) }
            }
        }
        return best
    }

    /// Glance offset for "thinking": centre, left, centre, right in a 6 s loop.
    static func glance(_ t: Double) -> CGFloat {
        let p = t.truncatingRemainder(dividingBy: 6)
        if p < 1.5 { return 0 }
        if p < 2.7 { return -1 }
        if p < 4.2 { return 0 }
        if p < 5.4 { return 1 }
        return 0
    }

    /// One short blink about every 4.7 s.
    static func blinking(_ t: Double) -> Bool { t.truncatingRemainder(dividingBy: 4.7) < 0.17 }

    static func draw(_ ctx: inout GraphicsContext, s: CGFloat, mood: Mood, t: Double, antennaPulse: Bool = true) {
        let sleeping = mood == .sleeping
        let line = Color.white.opacity(sleeping ? 0.5 : 1)
        let accent = mood.accent
        let lw = max(1.25, s * 0.07)
        let stroke = StrokeStyle(lineWidth: lw, lineCap: .round, lineJoin: .round)

        // Head.
        let head = CGRect(x: s * 0.13, y: s * 0.30, width: s * 0.74, height: s * 0.62)
        ctx.stroke(Path(roundedRect: head, cornerRadius: s * 0.17, style: .continuous), with: .color(line), style: stroke)
        // Ears.
        for x in [s * 0.05, s * 0.88] {
            ctx.fill(Path(roundedRect: CGRect(x: x, y: s * 0.52, width: s * 0.07, height: s * 0.18), cornerRadius: s * 0.03),
                     with: .color(line))
        }
        // Antenna: stem and light.
        var stem = Path()
        stem.move(to: CGPoint(x: s * 0.5, y: head.minY))
        stem.addLine(to: CGPoint(x: s * 0.5, y: s * 0.17))
        ctx.stroke(stem, with: .color(line), style: stroke)
        var lightOpacity = 1.0
        if mood == .thinking && antennaPulse { lightOpacity = 0.55 + 0.45 * (0.5 + 0.5 * sin(t * .pi)) }   // 2 s pulse
        let r = s * 0.085
        ctx.fill(Path(ellipseIn: CGRect(x: s * 0.5 - r, y: s * 0.13 - r, width: 2 * r, height: 2 * r)),
                 with: .color(accent.opacity(sleeping ? 0.6 : lightOpacity)))

        // Eyes.
        let eyeY = s * 0.56
        let eyeDX = s * 0.17
        let eyes = [s * 0.5 - eyeDX, s * 0.5 + eyeDX]
        switch mood {
        case .thinking:
            let dx = glance(t) * s * 0.05
            if blinking(t) {
                for x in eyes { ctx.stroke(hLine(x + dx, eyeY, s * 0.07), with: .color(line), style: stroke) }
            } else {
                let er = s * 0.065
                for x in eyes {
                    ctx.fill(Path(ellipseIn: CGRect(x: x + dx - er, y: eyeY - er - s * 0.01, width: 2 * er, height: 2 * er)), with: .color(line))
                }
            }
        case .asking:
            let er = s * 0.095
            for x in eyes {
                ctx.stroke(Path(ellipseIn: CGRect(x: x - er, y: eyeY - er - s * 0.02, width: 2 * er, height: 2 * er)),
                           with: .color(line), style: StrokeStyle(lineWidth: max(1, lw * 0.8)))
                let pr = s * 0.04
                ctx.fill(Path(ellipseIn: CGRect(x: x - pr, y: eyeY - pr - s * 0.02, width: 2 * pr, height: 2 * pr)), with: .color(line))
            }
        case .upset:
            let k = s * 0.055
            for x in eyes {
                var p = Path()
                p.move(to: CGPoint(x: x - k, y: eyeY - k)); p.addLine(to: CGPoint(x: x + k, y: eyeY + k))
                p.move(to: CGPoint(x: x + k, y: eyeY - k)); p.addLine(to: CGPoint(x: x - k, y: eyeY + k))
                ctx.stroke(p, with: .color(line), style: stroke)
            }
        case .happy:
            let k = s * 0.07
            for x in eyes {
                var p = Path()
                p.addArc(center: CGPoint(x: x, y: eyeY + k * 0.4), radius: k, startAngle: .degrees(200), endAngle: .degrees(340), clockwise: false)
                ctx.stroke(p, with: .color(line), style: stroke)
            }
        case .sleeping:
            for x in eyes { ctx.stroke(hLine(x, eyeY + s * 0.01, s * 0.07), with: .color(line), style: stroke) }
        }

        // Mouth.
        let mouthY = s * 0.77
        switch mood {
        case .thinking:
            ctx.stroke(hLine(s * 0.5 + s * 0.03, mouthY, s * 0.09), with: .color(line), style: stroke)
        case .asking:
            let mr = s * 0.045
            ctx.stroke(Path(ellipseIn: CGRect(x: s * 0.5 - mr, y: mouthY - mr, width: 2 * mr, height: 2 * mr)),
                       with: .color(accent), style: StrokeStyle(lineWidth: max(1, lw * 0.85)))
        case .upset:
            var p = Path()
            p.addArc(center: CGPoint(x: s * 0.5, y: mouthY + s * 0.09), radius: s * 0.12,
                     startAngle: .degrees(225), endAngle: .degrees(315), clockwise: false)
            ctx.stroke(p, with: .color(accent), style: stroke)
        case .happy:
            var p = Path()
            p.addArc(center: CGPoint(x: s * 0.5, y: mouthY - s * 0.08), radius: s * 0.12,
                     startAngle: .degrees(45), endAngle: .degrees(135), clockwise: false)
            ctx.stroke(p, with: .color(accent), style: stroke)
        case .sleeping:
            ctx.stroke(hLine(s * 0.5, mouthY, s * 0.06), with: .color(line), style: stroke)
        }

        // Marks above the head: "?" when asking, "z" when sleeping.
        if mood == .asking || mood == .sleeping {
            let txt = Text(mood == .asking ? "?" : "z")
                .font(.system(size: s * (mood == .asking ? 0.34 : 0.3), weight: .heavy, design: .rounded))
                .foregroundColor(mood == .asking ? accent : Color.white.opacity(0.6))
            ctx.draw(txt, at: CGPoint(x: s * 0.84, y: s * 0.14), anchor: .center)
        }
    }

    private static func hLine(_ cx: CGFloat, _ y: CGFloat, _ half: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: cx - half, y: y))
        p.addLine(to: CGPoint(x: cx + half, y: y))
        return p
    }
}

/// Robot or mascot that moves with the shared clock; static when `animate` is false.
struct RobotView: View {
    let mood: Mood
    let size: CGFloat
    var animate: Bool
    let clock: AnimClock
    var antennaPulse = true
    /// Static time (renders with --ui-time); nil = 0.5 s, the straight look.
    var fixedT: Double? = nil

    var body: some View {
        if animate && mood == .thinking {
            Clocked(clock) { t in MascotFace(mood: mood, size: size, t: t, antennaPulse: antennaPulse) }
        } else {
            MascotFace(mood: mood, size: size, t: fixedT ?? 0.5)
        }
    }
}

// MARK: - Mascot from pictures

/// Frames of a custom mascot: PNG 256×256 with a transparent background. Looked up in
/// --mascot-dir, else the user's folder ~/Library/Application Support/bb-touchbar/mascot/
/// (kept outside the plugin, so a personal logo is never published), else the app's
/// Resources/mascot/ (native/Assets/mascot/*.png at build time). No idle.png anywhere: the robot.
enum MascotFrame: String, CaseIterable {
    case idle, left, right, asking, upset, happy, sleeping
}

enum Mascot {
    /// --mascot-dir: read the frames from here instead of the app's resources (set before first use).
    nonisolated(unsafe) static var overrideDir: String?
    static let maxBytes = 2 * 1024 * 1024

    /// --mascot-user-dir: another user folder (tests).
    nonisolated(unsafe) static var userDir: String =
        NSString(string: "~/Library/Application Support/bb-touchbar/mascot").expandingTildeInPath

    static let dir: String? = {
        if let d = overrideDir { return d }
        let fm = FileManager.default
        if fm.fileExists(atPath: (userDir as NSString).appendingPathComponent("idle.png")) { return userDir }
        return Bundle.main.resourceURL?.appendingPathComponent("mascot").path
    }()

    /// Loaded once at first use. Pictures larger than 2 MB or 2048 px are skipped.
    static let frames: [MascotFrame: NSImage] = {
        guard let d = dir else { return [:] }
        var out: [MascotFrame: NSImage] = [:]
        let fm = FileManager.default
        for f in MascotFrame.allCases {
            let path = (d as NSString).appendingPathComponent("\(f.rawValue).png")
            guard let a = try? fm.attributesOfItem(atPath: path), let n = a[.size] as? NSNumber, n.intValue <= maxBytes,
                  let data = fm.contents(atPath: path),
                  let src = CGImageSourceCreateWithData(data as CFData, nil),
                  let cg = CGImageSourceCreateImageAtIndex(src, 0, nil),
                  cg.width <= 2048, cg.height <= 2048 else { continue }
            out[f] = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        }
        return out
    }()

    /// The mascot replaces the robot when at least idle.png is there.
    static var available: Bool { frames[.idle] != nil }

    static func describe() -> String {
        if available {
            let names = MascotFrame.allCases.filter { frames[$0] != nil }.map { $0.rawValue }
            return "талисман из картинок \(dir ?? "?"): \(names.joined(separator: ", "))"
        }
        return "картинок талисмана нет (\(dir ?? "нет папки ресурсов")): рисую робота"
    }

    /// Thinking: idle, left, idle, right with the robot's glance timing; other moods one frame.
    static func frame(_ mood: Mood, t: Double) -> MascotFrame {
        switch mood {
        case .thinking:
            let g = RobotFace.glance(t)
            return g < 0 ? .left : (g > 0 ? .right : .idle)
        case .asking: return .asking
        case .upset: return .upset
        case .happy: return .happy
        case .sleeping: return .sleeping
        }
    }

    /// The picture for a mood; a missing frame is replaced by idle. nil = no mascot.
    static func image(_ mood: Mood, t: Double) -> NSImage? {
        guard available else { return nil }
        return frames[frame(mood, t: t)] ?? frames[.idle]
    }

    /// Next moment the thinking mascot changes: only the glance boundaries (it does not blink).
    static func nextChange(after t: Double) -> Double {
        var best = Double.infinity
        let gBase = (t / 6).rounded(.down) * 6
        for k in 0...1 {
            for b in [1.5, 2.7, 4.2, 5.4] {
                let x = gBase + Double(k) * 6 + b
                if x > t + 0.001 { best = min(best, x) }
            }
        }
        return best
    }
}

/// The mascot picture when there is one, the drawn robot otherwise. Same size and place.
struct MascotFace: View {
    let mood: Mood
    let size: CGFloat
    var t: Double = 0.5
    var antennaPulse = true

    /// When the face in the collapsed strip next changes (the strip redraws only then).
    static func nextChange(after t: Double) -> Double {
        Mascot.available ? Mascot.nextChange(after: t) : RobotFace.nextChange(after: t)
    }

    var body: some View {
        if let img = Mascot.image(mood, t: t) {
            Image(nsImage: img)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else {
            RobotFace(mood: mood, size: size, t: t, antennaPulse: antennaPulse)
        }
    }
}

// MARK: - Calm strip

/// Texts of the calm strip and the robot row, from the totals.
enum Calm {
    static func projects(_ n: Int) -> String {
        Lang.en ? "\(n) \(enPlural(n, "project", "projects"))" : "\(n) \(Fmt.plural(n, "проект", "проекта", "проектов"))"
    }

    /// Left label: "2 проекта"; at zero: "ждёт ответа" (yellow), "ошибка" (red) or "пауза" (grey).
    static func label(_ s: SnapshotSummary) -> (text: String, color: Color) {
        if s.projectsWorking > 0 { return (projects(s.projectsWorking), .white) }
        if s.threadsWaiting > 0 { return (L("ждёт ответа", "waiting"), Palette.color(.waiting)) }
        if s.threadsError > 0 { return (L("ошибка", "error"), Palette.color(.error)) }
        return (L("пауза", "paused"), Palette.secondary)
    }

    static func count(_ s: SnapshotSummary) -> String { "\(s.done)/\(s.total)" }


    /// Thoughts in the order they rotate (one every 6 s). Working threads, freshest first.
    static func thoughts(cards: [SnapshotCard], summary s: SnapshotSummary) -> [String] {
        let working = cards.filter { $0.state == .working }.sorted { $0.updatedAt > $1.updatedAt }
        func what(_ c: SnapshotCard) -> String? {
            let t = c.current?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return t.isEmpty ? nil : t
        }
        if working.count == 1 {
            let c = working[0]
            return [what(c).map { L("Думаю над: ", "Thinking about: ") + $0 }
                    ?? L("Работаю над планом: ", "Working on the plan: ") + c.planTitle]
        }
        if working.count > 1 {
            return working.map { c in "\(c.project): " + (what(c) ?? L("работаю над планом «\(c.planTitle)»", "working on the plan “\(c.planTitle)”")) }
        }
        // Nobody works on the cards (the totals may count threads beyond them).
        if s.threadsWorking > 0 { return [L("Думаю над планами: \(projects(s.projectsWorking)) в работе", "Thinking about plans: \(projects(s.projectsWorking)) in work")] }
        // Error before waiting, as in the robot's mood priority.
        if let e = cards.first(where: { $0.state == .error }) { return [L("Что-то сломалось в ", "Something broke in ") + e.project] }
        if s.threadsError > 0 { return [L("Что-то сломалось", "Something broke")] }
        if let w = cards.first(where: { $0.state == .waiting }) { return [L("Жду вашего ответа: ", "Waiting for your answer: ") + w.project] }
        if s.threadsWaiting > 0 { return [L("Жду вашего ответа", "Waiting for your answer")] }
        if Mood.allDone(s) { return [L("Всё готово", "All done")] }
        return [L("Отдыхаю, в работе ничего нет", "Resting, nothing in work")]
    }

    static func thoughtIndex(at t: Double, count: Int) -> Int {
        Int((max(0, t) / 6).rounded(.down)) % max(1, count)
    }

    static func thought(cards: [SnapshotCard], summary: SnapshotSummary, at t: Double) -> String {
        let all = thoughts(cards: cards, summary: summary)
        return all[thoughtIndex(at: t, count: all.count)]
    }
}

/// Wing widths of the calm strip. The count reserves its digits as "00", so the window
/// does not jump when a number changes; the label is measured as it is (its word changes
/// with the number anyway: «проект», «проекта», «проектов»).
enum CalmMath {
    static let robotSize: CGFloat = 19

    /// Paddings and fonts of the calm strip. `before` is the strip before 2026-11-24
    /// (kept for the self-test, which prints both widths).
    struct Metrics {
        var outerPad: CGFloat
        var robotGap: CGFloat
        var innerPad: CGFloat
        var ringGap: CGFloat
        var nameCountGap: CGFloat
        var labelSize: CGFloat
        var countSize: CGFloat
        var reserveLabelDigits: Bool

        var labelFont: NSFont { NSFont.systemFont(ofSize: labelSize, weight: .medium) }
        var countFont: NSFont { NSFont.monospacedDigitSystemFont(ofSize: countSize, weight: .semibold) }
    }

    static let before = Metrics(outerPad: 12, robotGap: 6, innerPad: 8, ringGap: 6, nameCountGap: 12,
                                labelSize: 12, countSize: 12, reserveLabelDigits: true)
    static let current = Metrics(outerPad: 6, robotGap: 3, innerPad: 3, ringGap: 5, nameCountGap: 8,
                                 labelSize: 11, countSize: 12, reserveLabelDigits: false)
    static var m: Metrics { current }
    static var ringGap: CGFloat { m.ringGap }
    static var robotGap: CGFloat { m.robotGap }

    static func labelWidth(_ text: String, _ k: Metrics = current) -> CGFloat {
        WingMath.textWidth(k.reserveLabelDigits ? WingMath.reserveTemplate(text) : text, k.labelFont)
    }
    static func countWidth(_ s: SnapshotSummary, _ k: Metrics = current) -> CGFloat {
        WingMath.textWidth(WingMath.reserveTemplate(Calm.count(s)), k.countFont)
    }
    /// Ring + gap + count.
    static func statsWidth(_ s: SnapshotSummary, _ k: Metrics = current) -> CGFloat { WingMath.ringSize + k.ringGap + countWidth(s, k) }

    static func leftWidth(labelW: CGFloat, stats: CGFloat?, _ k: Metrics = current) -> CGFloat {
        var w = k.outerPad + robotSize + k.robotGap + labelW + k.innerPad
        if let st = stats { w += k.nameCountGap + st }
        return ceil(w)
    }

    /// Ring and count with paddings: the right wing's content.
    static func rightContent(_ s: SnapshotSummary, _ k: Metrics = current) -> CGFloat {
        ceil(k.innerPad + statsWidth(s, k) + k.outerPad)
    }

    /// keepIcons off (default): both wings have the same width, the wider of the two contents,
    /// the right wing is always drawn. keepIcons on: the right wing only when it fits before
    /// the first menu bar icon, otherwise everything goes to the left wing.
    static func apply(to L: inout Layout, summary s: SnapshotSummary, iconLimitX: CGFloat?, keepIcons: Bool = false,
                      metrics k: Metrics = current) {
        let labelW = labelWidth(Calm.label(s).text, k)
        let stats = statsWidth(s, k)
        let full = rightContent(s, k)
        L.keepIcons = keepIcons
        L.calm = true
        if !keepIcons {
            let leftOnly = leftWidth(labelW: labelW, stats: nil, k)
            let w = max(leftOnly, full)
            L.rightMode = .right
            L.rightW = w
            L.nameW = labelW
            L.statsW = stats
            L.leftNameOnlyW = leftOnly
            L.leftW = w
            return
        }
        let avail = iconLimitX.map { $0 - WingMath.iconGap - L.notchMaxX }
        let right = avail.map { full <= $0 } ?? true
        L.rightMode = right ? .right : .left
        L.rightW = right ? full : 0
        L.nameW = labelW
        L.statsW = stats
        L.leftNameOnlyW = leftWidth(labelW: labelW, stats: nil, k)
        L.leftW = leftWidth(labelW: labelW, stats: right ? nil : stats, k)
    }
}

/// Collapsed strip in calm mode: robot and projects on the left, ring and count on the right
/// (or everything on the left when the menu bar icons leave no room).
struct CalmContent: View {
    @ObservedObject var model: AppModel
    let layout: Layout
    var animate: Bool

    var body: some View {
        let s = model.totals
        let mood = model.mood
        let label = Calm.label(s)
        let k = CalmMath.current
        let stats = HStack(spacing: k.ringGap) {
            RingView(fraction: Fmt.fraction(done: s.done, total: s.total), state: .idle,
                     size: WingMath.ringSize, line: 2.5, animate: false, color: mood.accent)
            Text(Calm.count(s))
                .font(.system(size: k.countSize, weight: .semibold).monospacedDigit())
                .foregroundColor(.white)
                .lineLimit(1)
                .fixedSize()
        }
        HStack(spacing: 0) {
            HStack(spacing: 0) {
                RobotView(mood: mood, size: CalmMath.robotSize, animate: animate, clock: model.clock, antennaPulse: false,
                          fixedT: model.staticRender ? model.frozenT : nil)
                Text(label.text)
                    .font(.system(size: k.labelSize, weight: .medium))
                    .foregroundColor(label.color)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(width: layout.nameW, alignment: .leading)
                    .padding(.leading, k.robotGap)
                if layout.rightMode == .left {
                    stats
                        .frame(width: layout.statsW, alignment: .leading)
                        .padding(.leading, k.nameCountGap)
                }
            }
            .padding(.leading, k.outerPad)
            .padding(.trailing, k.innerPad)
            .frame(width: layout.leftW, alignment: .trailing)

            Color.clear.frame(width: layout.notchW)

            if layout.rightMode == .right {
                stats
                    .padding(.leading, k.innerPad)
                    .frame(width: layout.rightW, alignment: .leading)
            }
        }
        .frame(width: layout.collapsedWidth, height: layout.notchH, alignment: .leading)
    }
}

/// One header line under the panel's top band: the mascot (or robot) and what it thinks about.
/// With several working threads the thought changes every 6 s with a soft cross-fade.
struct RobotRow: View {
    @ObservedObject var model: AppModel
    let layout: Layout

    private func content(t: Double) -> some View {
        let s = model.totals
        let mood = model.mood(at: Date(timeIntervalSinceReferenceDate: t))
        let all = Calm.thoughts(cards: model.cards, summary: s)
        let i = Calm.thoughtIndex(at: t, count: all.count)
        return HStack(spacing: 9) {
            MascotFace(mood: mood, size: PanelMath.robotRowFace, t: t)
            ZStack(alignment: .leading) {
                Text(all[i])
                    .font(.system(size: PanelMath.thoughtSize, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(i)
                    // The old thought fades out first, then the new one fades in from below:
                    // two texts never overlap on the line.
                    .transition(.asymmetric(
                        insertion: AnyTransition.opacity.combined(with: .offset(y: 6))
                            .animation(.easeOut(duration: 0.3).delay(0.2)),
                        removal: AnyTransition.opacity.animation(.easeIn(duration: 0.18))))
            }
            .animation(.easeInOut(duration: 0.45), value: i)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
        }
        .padding(.horizontal, PanelMath.sidePad + 4)
        .frame(width: layout.expandedWidth, height: PanelMath.robotRowH, alignment: .leading)
        .helpIf(all.count > 1 ? "Работающие треды по очереди, раз в 6 секунд" : nil)
    }

    var body: some View {
        if model.staticRender || !model.expanded {
            content(t: model.frozenT ?? 0.5)
        } else {
            Clocked(model.clock) { t in content(t: t) }
        }
    }
}
