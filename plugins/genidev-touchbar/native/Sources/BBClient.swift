import AppKit
import Foundation

struct CommandResult {
    var status: Int32
    var out: Data
    var timedOut: Bool
}

enum Shell {
    /// Runs a program without a shell. Returns nil when it cannot start.
    static func run(_ path: String, _ args: [String], env: [String: String], timeout: TimeInterval) -> CommandResult? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        var data = Data()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            data = out.fileHandleForReading.readDataToEndOfFile()
            group.leave()
        }
        var timedOut = false
        if group.wait(timeout: .now() + timeout) == .timedOut {
            timedOut = true
            p.terminate()
            _ = group.wait(timeout: .now() + 2)
        }
        p.waitUntilExit()
        return CommandResult(status: p.terminationStatus, out: data, timedOut: timedOut)
    }

    /// PATH and `command -v bb` from the user's login shell, computed once.
    static let login: (path: String?, bb: String?) = {
        let shell = String(cString: getpwuid(getuid()).pointee.pw_shell)
        let sh = FileManager.default.isExecutableFile(atPath: shell) ? shell : "/bin/zsh"
        let env = ["HOME": NSHomeDirectory(), "USER": NSUserName(), "LOGNAME": NSUserName(), "SHELL": sh]
        let script = "printf '__P__%s\\n' \"$PATH\"; printf '__B__%s\\n' \"$(command -v bb 2>/dev/null)\""
        guard let r = Shell.run(sh, ["-lc", script], env: env, timeout: 6), !r.timedOut else { return (nil, nil) }
        let text = String(decoding: r.out, as: UTF8.self)
        var path: String?, bb: String?
        for line in text.split(separator: "\n") {
            if line.hasPrefix("__P__") { path = String(line.dropFirst(5)) }
            if line.hasPrefix("__B__") { let v = String(line.dropFirst(5)); if v.hasPrefix("/") { bb = v } }
        }
        return (path, bb)
    }()

    static let standardDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]

    /// Clean environment for bb (it is a node script, so node must be in PATH).
    static func bbEnv(bbPath: String) -> [String: String] {
        var dirs: [String] = []
        if let p = login.path { dirs += p.split(separator: ":").map(String.init) }
        dirs.append((bbPath as NSString).deletingLastPathComponent)
        let resolved = (bbPath as NSString).resolvingSymlinksInPath
        dirs.append((resolved as NSString).deletingLastPathComponent)
        dirs += standardDirs
        var seen = Set<String>()
        let path = dirs.filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: ":")
        return [
            "HOME": NSHomeDirectory(), "USER": NSUserName(), "LOGNAME": NSUserName(),
            "PATH": path, "LANG": ProcessInfo.processInfo.environment["LANG"] ?? "en_US.UTF-8",
            "NO_COLOR": "1",
        ]
    }
}

enum BBLocator {
    static var configPath = NSString(string: "~/Library/Application Support/bb-touchbar/config.json").expandingTildeInPath

    /// config.json bbPath first; then the login shell PATH; then usual places.
    static func locate() -> (path: String?, source: String) {
        let fm = FileManager.default
        if let data = fm.contents(atPath: configPath),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let p = obj["bbPath"] as? String, !p.isEmpty {
            // The config is the owner's explicit choice: no silent fallback to another bb.
            if fm.isExecutableFile(atPath: p) { return (p, "config") }
            Log.status("bb не найден по bbPath из config.json: \(p)")
            return (nil, "config-missing")
        }
        if let p = Shell.login.bb, fm.isExecutableFile(atPath: p) { return (p, "login-shell") }
        let home = NSHomeDirectory()
        let candidates = [
            "/opt/homebrew/bin/bb", "/usr/local/bin/bb", "\(home)/.bb/bin/bb", "\(home)/.local/bin/bb",
            "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
        ]
        for c in candidates where fm.isExecutableFile(atPath: c) { return (c, "default") }
        return (nil, "none")
    }
}

/// Thread ids go to argv of `bb thread open`; refuse anything that could be read as an option.
func isSafeThreadId(_ id: String) -> Bool {
    guard let first = id.unicodeScalars.first, CharacterSet.alphanumerics.contains(first), id.count <= 200 else { return false }
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-.:"))
    return id.unicodeScalars.allSatisfy { allowed.contains($0) && $0.isASCII }
}

/// Plugin id the app asks bb about. Version 0.2.0 renamed the plugin from `touchbar`;
/// an app that finds no `genidev-touchbar` tries the old id once per lookup.
enum PluginId {
    static let current = "genidev-touchbar"
    static let legacy = "touchbar"
    /// --plugin-id: ask for another id first (tests).
    nonisolated(unsafe) static var primary = current

    /// bb answered "no such command" or "unknown plugin": the plugin is not installed under that id.
    static func isMissing(_ out: Data) -> Bool {
        guard let obj = try? JSONSerialization.jsonObject(with: out) as? [String: Any], obj["ok"] as? Bool == false else { return false }
        if let e = obj["error"] as? [String: Any], let code = e["code"] as? String {
            return code == "unknown_command" || code == "unknown_plugin" || code == "plugin_not_found"
        }
        if let e = obj["error"] as? String { return e.lowercased().contains("unknown plugin") }
        return false
    }
}

/// Polls the Notch Bar plugin over HTTP. Token lives only in memory.
final class BBClient {
    private var url: URL?
    private var token: String?
    private var bbPath: String?
    private var failures = 0
    private var nextResolveAt = Date.distantPast
    private var busy = false
    private var loggedURL: String?
    private var answeredSinceResolve = false
    private var loggedFallback = false
    /// The id that gave the current address (current or legacy).
    private(set) var pluginId = PluginId.primary
    private let session: URLSession
    var onSnapshot: (Snapshot?) -> Void = { _ in }

    init() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 3
        cfg.timeoutIntervalForResource = 5
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.connectionProxyDictionary = [:]
        session = URLSession(configuration: cfg)
    }

    /// Called every 2 s on the main thread.
    func tick(force: Bool = false) {
        if busy { return }
        if force { nextResolveAt = .distantPast }
        if url == nil || token == nil {
            guard Date() >= nextResolveAt else { return }
            busy = true
            DispatchQueue.global(qos: .utility).async {
                let ok = self.resolve()
                DispatchQueue.main.async {
                    self.busy = false
                    if ok { self.fetch() } else {
                        self.nextResolveAt = Date().addingTimeInterval(10)
                        self.onSnapshot(nil)
                    }
                }
            }
        } else {
            fetch()
        }
    }

    /// Asks bb for the endpoint and the token. Runs off the main thread.
    private func resolve() -> Bool {
        let (path, source) = BBLocator.locate()
        guard let bb = path else {
            if source != "config-missing" { Log.status("bb не найден: нет config.json и нет bb в PATH") }
            return false
        }
        bbPath = bb
        let env = Shell.bbEnv(bbPath: bb)
        var id = PluginId.primary
        guard var r = Shell.run(bb, [id, "endpoint", "--json"], env: env, timeout: 15) else {
            Log.status("bb не запускается: \(bb)")
            return false
        }
        if r.status != 0, !r.timedOut, id != PluginId.legacy, PluginId.isMissing(r.out) {
            // Installed copy from before the rename: try the old id once.
            if !loggedFallback {
                Log.write("плагин \(id) не найден, пробую прежний идентификатор \(PluginId.legacy)")
                loggedFallback = true
            }
            id = PluginId.legacy
            guard let r2 = Shell.run(bb, [id, "endpoint", "--json"], env: env, timeout: 15) else { return false }
            r = r2
        }
        guard r.status == 0, !r.timedOut,
              let obj = try? JSONSerialization.jsonObject(with: r.out) as? [String: Any],
              let s = obj["url"] as? String, let u = URL(string: s),
              let host = u.host, ["127.0.0.1", "localhost", "::1"].contains(host) else {
            Log.status("bb \(id) endpoint не дал адрес (код \(r.status)\(r.timedOut ? ", таймаут" : "")) — плагин не установлен или bb не запущен")
            return false
        }
        guard let t = Shell.run(bb, ["plugin", "token", id, "--json"], env: env, timeout: 15) else { return false }
        var tok: String?
        if let obj = try? JSONSerialization.jsonObject(with: t.out) as? [String: Any] {
            if let v = obj["token"] as? String { tok = v }
            else if let d = obj["data"] as? [String: Any], let v = d["token"] as? String { tok = v }
            else if obj["ok"] as? Bool == false {
                let err = (obj["error"] as? String).map { ": \($0.prefix(80))" } ?? ""
                Log.status("токен плагина \(id) не получен\(err)")
                return false
            }
        } else if t.status == 0 {
            let raw = String(decoding: t.out, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if !raw.isEmpty, !raw.contains(" "), !raw.contains("\n") { tok = raw }
        }
        guard t.status == 0, let token = tok, !token.isEmpty else {
            Log.status("токен плагина \(id) не получен (код \(t.status))")
            return false
        }
        let changed: Bool = DispatchQueue.main.sync {
            self.url = u
            self.token = token
            self.pluginId = id
            self.failures = 0
            self.answeredSinceResolve = false
            defer { self.loggedURL = u.absoluteString }
            return self.loggedURL != u.absoluteString
        }
        if changed { Log.write("адрес плагина \(id): \(u.absoluteString)") }
        return true
    }

    private func fetch() {
        guard let url = url, let token = token else { return }
        busy = true
        var req = URLRequest(url: url)
        req.setValue(token, forHTTPHeaderField: "x-bb-plugin-token")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        session.dataTask(with: req) { data, resp, err in
            var snap: Snapshot?
            var problem: String?
            if let err = err as? URLError {
                problem = "сервер плагина не отвечает (URLError \(err.code.rawValue))"
            } else if err != nil {
                problem = "сервер плагина не отвечает"
            } else if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
                problem = "сервер плагина ответил HTTP \(http.statusCode)"
            } else if let data = data {
                do { snap = try Snapshot.decode(data) } catch { problem = "сводка не разобрана: формат не совпадает с contract.ts" }
            }
            DispatchQueue.main.async {
                self.busy = false
                if let s = snap {
                    self.failures = 0
                    self.answeredSinceResolve = true
                    Log.status("связь с плагином есть (\(self.pluginId))")
                    self.onSnapshot(s)
                } else {
                    self.failures += 1
                    Log.status(problem ?? "сервер плагина не отвечает")
                    if self.failures >= 3 {
                        // Port may have changed: ask bb for the address and token again.
                        self.url = nil
                        self.token = nil
                        self.failures = 0
                        // Ask bb again right away if this address used to answer; else wait 10 s.
                        self.nextResolveAt = self.answeredSinceResolve ? .distantPast : Date().addingTimeInterval(10)
                        self.onSnapshot(nil)
                    }
                }
            }
        }.resume()
    }

    var knownBBPath: String? { bbPath }
}

/// `--snapshot-file`: re-read a JSON file every 2 s.
final class FileSource {
    let path: String
    var onSnapshot: (Snapshot?) -> Void = { _ in }
    init(path: String) { self.path = path }

    func tick() {
        guard let data = FileManager.default.contents(atPath: path) else {
            Log.status("файл сводки не читается: \(path)")
            onSnapshot(nil)
            return
        }
        do {
            let s = try Snapshot.decode(data)
            Log.status("сводка из файла: \(path)")
            onSnapshot(s)
        } catch {
            Log.status("файл сводки не разобран: \(path)")
            onSnapshot(nil)
        }
    }
}

enum ThreadOpener {
    static let bbBundleId = "dev.bb.desktop"

    static func open(threadId: String, dryRun: Bool, knownBB: String?) {
        guard isSafeThreadId(threadId) else {
            Log.write("отказ: подозрительный threadId, команда не выполнена")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let bb = knownBB ?? BBLocator.locate().path
            if dryRun {
                Log.write("dry-run: выполнил бы: \(bb ?? "bb") thread open \(threadId) и вывел bb вперёд")
                return
            }
            guard let bb = bb else {
                Log.write("не могу открыть тред: bb не найден")
                return
            }
            let r = Shell.run(bb, ["thread", "open", threadId], env: Shell.bbEnv(bbPath: bb), timeout: 15)
            Log.write("bb thread open \(threadId): код \(r?.status ?? -1)")
            DispatchQueue.main.async { activateBB() }
        }
    }

    static func activateBB() {
        // openApplication activates an already running app too, which works from a background agent.
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bbBundleId) else { return }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: cfg)
    }
}
