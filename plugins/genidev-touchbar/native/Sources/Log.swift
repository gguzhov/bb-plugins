import Foundation

/// Append-only log at ~/Library/Logs/bb-touchbar.log. Never pass the token here.
enum Log {
    static var path: String = NSString(string: "~/Library/Logs/bb-touchbar.log").expandingTildeInPath
    private static let queue = DispatchQueue(label: "bb-touchbar.log")
    private static var lastStatus: String?

    static func write(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) [\(getpid())] \(message)\n"
        queue.async {
            let fm = FileManager.default
            let dir = (path as NSString).deletingLastPathComponent
            try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
            if let attrs = try? fm.attributesOfItem(atPath: path),
               let size = attrs[.size] as? NSNumber, size.intValue > 1_000_000 {
                try? fm.removeItem(atPath: path + ".1")
                try? fm.moveItem(atPath: path, toPath: path + ".1")
            }
            if !fm.fileExists(atPath: path) { fm.createFile(atPath: path, contents: nil) }
            if let h = FileHandle(forWritingAtPath: path) {
                h.seekToEndOfFile()
                h.write(line.data(using: .utf8)!)
                try? h.close()
            }
        }
    }

    /// Writes only when the connection status changes, not on every attempt.
    static func status(_ status: String) {
        let changed: Bool = queue.sync {
            if lastStatus == status { return false }
            lastStatus = status
            return true
        }
        if changed { write(status) }
    }

    static func flush() { queue.sync {} }
}
