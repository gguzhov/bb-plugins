import AppKit
import CoreGraphics

/// Where the count and the time go. They are always shown.
enum RightWingMode: String, Equatable {
    case right   // right wing: count and time
    case left    // no room before the menu bar icons: left wing after the project name
}

/// Wing widths = measured content + paddings. Digits are reserved as "00" so the
/// width only changes when the time format changes (seconds -> minutes -> hours),
/// not on every tick.
enum WingMath {
    static let maxLeft: CGFloat = 150
    static let outerPad: CGFloat = 12
    static let innerPad: CGFloat = 8
    static let ringSize: CGFloat = 16
    static let ringGap: CGFloat = 7
    static let countTimeGap: CGFloat = 8
    static let iconGap: CGFloat = 6
    /// Gap between the project name and the count when they share the left wing.
    static let nameCountGap: CGFloat = 12
    /// The name keeps its old limit: a 150 pt wing minus paddings and the ring.
    static let maxName: CGFloat = maxLeft - outerPad - ringSize - ringGap - innerPad

    static let nameFont = NSFont.systemFont(ofSize: 12, weight: .medium)
    static let countFont = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
    static let timeFont = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)

    static func textWidth(_ s: String, _ font: NSFont) -> CGFloat {
        ceil((s as NSString).size(withAttributes: [.font: font]).width) + 1
    }

    /// Every run of digits becomes "00": "5 с" and "59 с" reserve the same width.
    static func reserveTemplate(_ s: String) -> String {
        var out = ""
        var inDigits = false
        for ch in s {
            if ch.isNumber {
                if !inDigits { out += "00"; inDigits = true }
            } else {
                out.append(ch)
                inDigits = false
            }
        }
        return out
    }

    /// Width of "count  time" with digits reserved as "00".
    static func statsWidth(countWidth: CGFloat, timeWidth: CGFloat) -> CGFloat {
        countWidth + countTimeGap + timeWidth
    }

    /// Left wing: ring + name (capped at maxName) [+ gap + count + time when they live here].
    static func leftWidth(nameWidth: CGFloat, stats: CGFloat? = nil) -> CGFloat {
        var w = outerPad + ringSize + ringGap + min(nameWidth, maxName) + innerPad
        if let stats = stats { w += nameCountGap + stats }
        return ceil(w)
    }

    /// avail = room between the notch and the first menu bar icon (minus the gap); nil = unknown.
    /// Count and time stay on the right only when both fit; otherwise they move left.
    static func right(countWidth: CGFloat, timeWidth: CGFloat, avail: CGFloat?) -> (RightWingMode, CGFloat) {
        let full = ceil(innerPad + statsWidth(countWidth: countWidth, timeWidth: timeWidth) + outerPad)
        guard let avail = avail else { return (.right, full) }
        return full <= avail ? (.right, full) : (.left, 0)
    }

    static func apply(to layout: inout Layout, card: SnapshotCard, timeText: String, iconLimitX: CGFloat?) {
        let nameW = textWidth(card.project, nameFont)
        let countW = textWidth("\(card.done)/\(card.total)", countFont)
        let timeW = textWidth(reserveTemplate(timeText), timeFont)
        let avail = iconLimitX.map { $0 - iconGap - layout.notchMaxX }
        let (mode, w) = right(countWidth: countW, timeWidth: timeW, avail: avail)
        layout.rightMode = mode
        layout.rightW = w
        layout.nameW = min(nameW, maxName)
        layout.statsW = statsWidth(countWidth: countW, timeWidth: timeW)
        layout.leftNameOnlyW = leftWidth(nameWidth: nameW)
        layout.leftW = leftWidth(nameWidth: nameW, stats: mode == .left ? layout.statsW : nil)
    }
}

/// Finds the left edge of the menu bar status icons to the right of the notch.
/// CGWindowListCopyWindowInfo returns window bounds (not titles or pixels) without
/// the screen recording permission. Status items live on layer 25 (kCGStatusWindowLevel).
enum StatusIcons {
    static func leftmostIconX(rightOf notchMaxX: CGFloat, screenTop: CGFloat, bandHeight: CGFloat) -> CGFloat? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return nil }
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? screenTop
        // CG global coords: origin at the top-left of the primary display, y down.
        let bandTopCG = primaryTop - screenTop
        let me = Int(getpid())
        var best: CGFloat?
        for w in list {
            guard (w[kCGWindowLayer as String] as? Int) == Int(CGWindowLevelForKey(.statusWindow)),
                  (w[kCGWindowOwnerPID as String] as? Int) != me,
                  let b = w[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: b as CFDictionary) else { continue }
            if (w[kCGWindowAlpha as String] as? Double ?? 1) <= 0 { continue }
            // Only icons in this screen's menu bar band, right of the notch, of icon size.
            guard rect.width > 0, rect.width < 400, rect.height <= bandHeight + 4,
                  rect.minY >= bandTopCG - 2, rect.minY <= bandTopCG + bandHeight,
                  rect.minX >= notchMaxX - 1 else { continue }
            best = min(best ?? rect.minX, rect.minX)
        }
        return best
    }
}
