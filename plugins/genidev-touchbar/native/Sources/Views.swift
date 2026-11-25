import AppKit
import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

extension View {
    /// A tooltip only when there is text (an empty one could hide the row's own tooltip).
    @ViewBuilder func helpIf(_ text: String?) -> some View {
        if let t = text, !t.isEmpty { self.help(t) } else { self }
    }
}

enum Palette {
    static func color(_ s: CardState) -> Color {
        switch s {
        case .working, .done: return Color(hex: 0x30D158)
        case .waiting: return Color(hex: 0xFFD60A)
        case .error: return Color(hex: 0xFF453A)
        case .idle: return Color(hex: 0x8E8E93)
        }
    }
    static let track = Color.white.opacity(0.22)
    static let secondary = Color.white.opacity(0.62)
    static let tertiary = Color.white.opacity(0.42)
}

/// Geometry of the strip, taken from NSScreen at run time.
struct Layout: Equatable {
    var notchMinX: CGFloat      // screen coords
    var notchW: CGFloat
    var notchH: CGFloat
    var screenTop: CGFloat
    var hasNotch: Bool
    /// Height of the screen with the notch; the panel is at most 70% of it.
    var screenH: CGFloat = 1117
    /// Width the panel header asks for (summary + buttons on both sides of the notch).
    var headerMinW: CGFloat = 0
    /// Wing widths and the right wing mode come from WingMath (content + paddings).
    var leftW: CGFloat = WingMath.maxLeft
    var rightW: CGFloat = 0
    var rightMode: RightWingMode = .right
    /// Name width (already capped) and reserved "count  time" width, for exact placement.
    var nameW: CGFloat = 0
    /// Left wing without count and time: the panel width depends only on this, as before.
    var leftNameOnlyW: CGFloat = WingMath.maxLeft
    var statsW: CGFloat = 0
    /// Calm mode (no thread pinned in the strip): robot, projects, total ring and count.
    var calm: Bool = false
    /// "Do not cover menu bar icons" is on: the strip never goes over them.
    var keepIcons: Bool = false
    var rowH: CGFloat = 54
    var rowGap: CGFloat = 4
    var maxRows = 6

    var notchMaxX: CGFloat { notchMinX + notchW }
    var notchCenterX: CGFloat { notchMinX + notchW / 2 }
    var collapsedMinX: CGFloat { notchMinX - leftW }
    var collapsedWidth: CGFloat { leftW + notchW + rightW }
    /// Expanded panel: ~440 pt centred on the notch, wide enough to contain the collapsed strip.
    /// Same as before count and time could move left: name-only wing, capped at 150 pt.
    /// The header may widen it up to 500 pt.
    var expandedWidth: CGFloat {
        max(440, notchW + 2 * min(WingMath.maxLeft, max(leftNameOnlyW, rightW)), min(PanelMath.maxWidth, headerMinW))
    }
    /// Whether the collapsed strip lies inside the expanded panel (then its band stays visible).
    var collapsedFitsPanel: Bool {
        collapsedMinX >= expandedMinX - 0.5 && collapsedMinX + collapsedWidth <= expandedMinX + expandedWidth + 0.5
    }
    var expandedMinX: CGFloat { notchCenterX - expandedWidth / 2 }
    var collapsedRadius: CGFloat { hasNotch ? 10 : notchH / 2 }

    static func current() -> Layout {
        if let s = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }),
           let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
            let w = s.frame.width - l.width - r.width
            return Layout(notchMinX: s.frame.minX + l.width, notchW: max(0, w),
                          notchH: s.safeAreaInsets.top, screenTop: s.frame.maxY, hasNotch: true,
                          screenH: s.frame.height)
        }
        if let s = NSScreen.screens.first {
            let menu = s.frame.maxY - s.visibleFrame.maxY
            let h = (menu >= 20 && menu <= 40) ? menu : 24
            return Layout(notchMinX: s.frame.midX, notchW: 0, notchH: h, screenTop: s.frame.maxY, hasNotch: false,
                          screenH: s.frame.height)
        }
        // No screen at all (headless render): typical 16" MacBook values.
        return Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true, screenH: 1117)
    }
}

/// Flat top, rounded bottom corners. Radius animates.
struct NotchShape: Shape {
    var radius: CGFloat
    var animatableData: CGFloat {
        get { radius }
        set { radius = newValue }
    }

    func path(in r: CGRect) -> Path {
        let rad = max(0, min(radius, r.height / 2, r.width / 2))
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - rad))
        p.addArc(tangent1End: CGPoint(x: r.maxX, y: r.maxY), tangent2End: CGPoint(x: r.maxX - rad, y: r.maxY), radius: rad)
        p.addLine(to: CGPoint(x: r.minX + rad, y: r.maxY))
        p.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.minX, y: r.maxY - rad), radius: rad)
        p.closeSubpath()
        return p
    }
}

struct RingView: View {
    let fraction: Double
    let state: CardState
    let size: CGFloat
    let line: CGFloat
    var label: String? = nil
    var animate = true
    /// Overrides the state colour (calm strip: colour of the robot's mood).
    var color: Color? = nil
    @State private var phase = false

    var pulsing: Bool { animate && state == .working }

    var body: some View {
        ZStack {
            Circle().inset(by: line / 2).stroke(Palette.track, lineWidth: line)
            if fraction > 0 {
                Circle().inset(by: line / 2)
                    .trim(from: 0, to: CGFloat(fraction))
                    .stroke(color ?? Palette.color(state), style: StrokeStyle(lineWidth: line, lineCap: fraction >= 1 ? .butt : .round))
                    .rotationEffect(.degrees(-90))
                    .opacity(pulsing && phase ? 0.55 : 1)
            }
            if let label {
                Text(label)
                    .font(.system(size: size * 0.36, weight: .semibold).monospacedDigit())
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(width: size, height: size)
        .scaleEffect(pulsing && phase ? 1.08 : 1)
        .onAppear { updatePulse() }
        .onChange(of: pulsing) { _ in updatePulse() }
    }

    private func updatePulse() {
        if pulsing {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { phase = true }
        } else {
            withAnimation(.default) { phase = false }
        }
    }
}
