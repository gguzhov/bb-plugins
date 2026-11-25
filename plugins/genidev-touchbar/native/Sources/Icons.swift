import AppKit
import ImageIO
import SwiftUI

// Pictures of threads and executors from the project icons plugin (genidev-project-icons).
// Live: over HTTP from Snapshot.iconUrl (127.0.0.1 / localhost only, no token), cached in
// memory and in ~/Library/Caches/bb-touchbar/icons/. Tests: --icons-dir reads the same
// file names from a folder instead of the network.

/// Frames an icon may have. `base` is the picture itself (no `frame` in the query).
enum IconFrame: String, CaseIterable {
    case base, left, right, puzzled, alert, happy
}

/// Names, addresses and checks. No I/O here, so --selftest covers all of it.
enum IconKey {
    static let maxBytes = 512 * 1024
    static let maxPixels = 1024
    static let allowedHosts: Set<String> = ["127.0.0.1", "localhost", "::1", "[::1]"]

    /// 1...64 characters of A-Z a-z 0-9 _ -, not starting with "-".
    static func validId(_ s: String) -> Bool {
        guard (1...64).contains(s.count), s.first != "-" else { return false }
        return s.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-") }
    }

    /// Memory and disk cache key: "<id>" or "<id>.<frame>". nil for an unsafe id.
    static func key(id: String, frame: IconFrame) -> String? {
        guard validId(id) else { return nil }
        return frame == .base ? id : "\(id).\(frame.rawValue)"
    }

    /// File name in the plugin's assets folder and in --icons-dir: "<id>.webp", "<id>.left.webp".
    static func assetName(id: String, frame: IconFrame) -> String? { key(id: id, frame: frame).map { "\($0).webp" } }

    /// File name in the disk cache: "<id>.img", "<id>.left.img".
    static func cacheName(id: String, frame: IconFrame) -> String? { key(id: id, frame: frame).map { "\($0).img" } }

    /// The icon route only when it is on this machine: http(s), host 127.0.0.1 / localhost / ::1,
    /// no user or password. Anything else is refused (nil) and never asked.
    static func allowedBase(_ raw: String?) -> URL? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              let c = URLComponents(string: raw),
              let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = c.host?.lowercased(), allowedHosts.contains(host),
              c.user == nil, c.password == nil else { return nil }
        var out = c
        out.query = nil
        out.fragment = nil
        return out.url
    }

    /// `<base>?id=<id>` and `&frame=<name>`.
    static func url(base: URL, id: String, frame: IconFrame) -> URL? {
        guard validId(id), var c = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        var q = [URLQueryItem(name: "id", value: id)]
        if frame != .base { q.append(URLQueryItem(name: "frame", value: frame.rawValue)) }
        c.queryItems = q
        guard let u = c.url, let h = u.host?.lowercased(), allowedHosts.contains(h) else { return nil }
        return u
    }

    /// Picture bytes -> image, through ImageIO (WebP, PNG). nil for anything that is not a
    /// picture, is larger than 512 KB or than 1024 px.
    static func decode(_ data: Data) -> CGImage? {
        guard !data.isEmpty, data.count <= maxBytes,
              let src = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetType(src) != nil, CGImageSourceGetCount(src) >= 1,
              let img = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary),
              img.width > 0, img.height > 0, img.width <= maxPixels, img.height <= maxPixels else { return nil }
        return img
    }

    /// An HTTP answer is taken only when it is 200, says image/*, is at most 512 KB and decodes.
    static func accept(status: Int, mime: String?, data: Data) -> Result<CGImage, IconError> {
        guard status == 200 else { return .failure(.http(status)) }
        guard let m = mime?.lowercased(), m.hasPrefix("image/") else { return .failure(.notImage(mime ?? "нет типа")) }
        guard data.count <= maxBytes else { return .failure(.tooLarge(data.count)) }
        guard let img = decode(data) else { return .failure(.undecodable) }
        return .success(img)
    }
}

enum IconError: Error, Equatable, CustomStringConvertible {
    case http(Int), notImage(String), tooLarge(Int), undecodable, network(String), redirect, missingFile

    var description: String {
        switch self {
        case .http(let c): return "HTTP \(c)"
        case .notImage(let m): return "ответ не картинка (\(m))"
        case .tooLarge(let n): return "больше 512 КБ (\(n) байт)"
        case .undecodable: return "картинка не читается"
        case .network(let s): return "нет связи (\(s))"
        case .redirect: return "перенаправление не принимается"
        case .missingFile: return "файла нет"
        }
    }
}

/// Which frame a thread's picture shows. Working: eyes straight 1.6 s, left 0.5 s,
/// straight 0.4 s, right 0.5 s (3 s loop); waiting: puzzled; error: alert; done: happy;
/// pause: the base picture (dimmed by the badge). A missing frame falls back to the base.
enum IconAnim {
    static let loop = 3.0

    static func workingFrame(_ t: Double) -> IconFrame {
        let p = t.truncatingRemainder(dividingBy: loop)
        let q = p < 0 ? p + loop : p
        if q < 1.6 { return .base }
        if q < 2.1 { return .left }
        if q < 2.5 { return .base }
        return .right
    }

    /// The frame the state asks for. t nil = static picture (working looks straight).
    static func wanted(_ state: CardState, t: Double?) -> IconFrame {
        switch state {
        case .working: return t.map(workingFrame) ?? .base
        case .waiting: return .puzzled
        case .error: return .alert
        case .done: return .happy
        case .idle: return .base
        }
    }

    static func shown(_ icon: SnapshotIcon, state: CardState, t: Double?) -> IconFrame {
        let f = wanted(state, t: t)
        return f == .base || icon.has(f) ? f : .base
    }

    /// Frames a visible row will need soon, so the eyes do not wait for the network.
    static func needed(_ icon: SnapshotIcon, state: CardState) -> [IconFrame] {
        switch state {
        case .working: return [.base] + [IconFrame.left, .right].filter(icon.has)
        default: return [shown(icon, state: state, t: nil)]
        }
    }
}

/// Loads, keeps and hands out the pictures. All state lives on the main thread; files and
/// the network are read on a background queue. Views observe `version`, which moves only
/// when a picture arrives.
final class IconStore: NSObject, ObservableObject, URLSessionTaskDelegate {
    static let shared = IconStore()

    @Published private(set) var version = 0

    /// --icons-dir: read pictures from this folder, never from the network or the disk cache.
    var dir: String?
    /// --render-png: load in place (the renderer cannot wait for a later redraw).
    var syncMode = false
    /// Off in --selftest: no disk cache, no network.
    var cacheEnabled = true
    private(set) var base: URL?
    private var rawBase: String?
    private var images: [String: NSImage] = [:]
    private var failedAt: [String: Date] = [:]
    private var inFlight: Set<String> = []
    private var publishPending = false
    private let queue = DispatchQueue(label: "bb-touchbar.icons", qos: .utility)
    static let retryAfter: TimeInterval = 60
    static let cacheMaxAge: TimeInterval = 7 * 24 * 3600
    /// Requests made, by host (for the log and the self-test: a foreign host is never asked).
    private(set) var requestedHosts: [String: Int] = [:]

    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 3
        cfg.timeoutIntervalForResource = 5
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.connectionProxyDictionary = [:]
        cfg.httpCookieAcceptPolicy = .never
        cfg.httpShouldSetCookies = false
        cfg.urlCache = nil
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    var cacheDir: URL {
        let lib = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSString(string: "~/Library/Caches").expandingTildeInPath)
        return lib.appendingPathComponent("bb-touchbar/icons", isDirectory: true)
    }

    /// Called with every snapshot. A foreign host is refused once in the log and never asked.
    func setBase(_ raw: String?) {
        guard raw != rawBase else { return }
        rawBase = raw
        let u = IconKey.allowedBase(raw)
        if raw != nil && u == nil {
            let host = raw.flatMap { URLComponents(string: $0)?.host } ?? "?"
            Log.write("адрес иконок отклонён: не 127.0.0.1 и не localhost (хост «\(host)»), картинки не запрашиваются")
        } else if let u = u, u != base {
            Log.write("адрес иконок: \(u.absoluteString)")
            failedAt.removeAll()
        }
        base = u
    }

    /// The picture if it is here; otherwise starts loading it and returns nil.
    func image(_ icon: SnapshotIcon, _ frame: IconFrame) -> NSImage? {
        guard let key = IconKey.key(id: icon.id, frame: frame) else { return nil }
        if let img = images[key] { return img }
        request(icon.id, frame, key: key)
        return images[key]
    }

    /// The frame, or the base picture while the frame is not here yet.
    func picture(_ icon: SnapshotIcon, _ frame: IconFrame) -> NSImage? {
        guard icon.usable else { return nil }
        if let img = image(icon, frame) { return img }
        return frame == .base ? nil : image(icon, .base)
    }

    func prefetch(_ icon: SnapshotIcon, _ frames: [IconFrame]) {
        guard icon.usable else { return }
        for f in frames { _ = image(icon, f) }
    }

    private enum Source { case dir(String), web(URL, cache: URL?), cacheOnly(URL) }

    private func request(_ id: String, _ frame: IconFrame, key: String) {
        guard !inFlight.contains(key) else { return }
        if let t = failedAt[key], Date().timeIntervalSince(t) < Self.retryAfter { return }
        let src: Source
        if let d = dir {
            src = .dir(d)
        } else if let b = base {
            src = .web(b, cache: cacheEnabled ? cacheDir : nil)
        } else if cacheEnabled {
            // No address yet: a picture from an earlier run may still be on disk.
            src = .cacheOnly(cacheDir)
        } else {
            return
        }
        inFlight.insert(key)
        if syncMode {
            let r = Self.loadBlocking(id, frame, src, session: session, note: { [weak self] h in self?.requestedHosts[h, default: 0] += 1 })
            finish(key, id: id, frame: frame, r, publish: false)
            return
        }
        queue.async { [session] in
            let r = Self.loadBlocking(id, frame, src, session: session, note: { h in
                DispatchQueue.main.async { self.requestedHosts[h, default: 0] += 1 }
            })
            DispatchQueue.main.async { self.finish(key, id: id, frame: frame, r, publish: true) }
        }
    }

    private struct Loaded {
        var image: CGImage?
        var error: IconError?
        var how: String
        var bytes = 0
    }

    private func finish(_ key: String, id: String, frame: IconFrame, _ r: Loaded, publish: Bool) {
        inFlight.remove(key)
        if let cg = r.image {
            images[key] = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
            failedAt[key] = nil
            if r.how == "сеть" { Log.write("иконка \(key): загружена по сети (\(r.bytes) байт), сохранена в кеш") }
            if publish { schedulePublish() }
        } else {
            failedAt[key] = Date()
            // A missing frame on disk while there is no address is not a problem worth a line.
            if r.how != "кеш" || r.error != .missingFile {
                Log.write("иконка \(key): не загружена (\(r.how): \(r.error?.description ?? "?")), показываю значок с буквами; повтор не раньше чем через минуту")
            }
        }
    }

    /// Many pictures arrive together on launch: redraw once for all of them.
    private func schedulePublish() {
        guard !publishPending else { return }
        publishPending = true
        DispatchQueue.main.async {
            self.publishPending = false
            self.version &+= 1
        }
    }

    private static func loadBlocking(_ id: String, _ frame: IconFrame, _ src: Source, session: URLSession,
                                     note: (String) -> Void) -> Loaded {
        let fm = FileManager.default
        func readFile(_ path: String) -> Data? {
            guard let a = try? fm.attributesOfItem(atPath: path), let n = a[.size] as? NSNumber,
                  n.intValue <= IconKey.maxBytes else { return nil }
            return fm.contents(atPath: path)
        }
        switch src {
        case .dir(let d):
            guard let name = IconKey.assetName(id: id, frame: frame) else { return Loaded(error: .missingFile, how: "папка") }
            guard let data = readFile((d as NSString).appendingPathComponent(name)) else { return Loaded(error: .missingFile, how: "папка") }
            guard let img = IconKey.decode(data) else { return Loaded(error: .undecodable, how: "папка") }
            return Loaded(image: img, how: "папка", bytes: data.count)
        case .cacheOnly(let c):
            return fromCache(c, id, frame, maxAge: nil) ?? Loaded(error: .missingFile, how: "кеш")
        case .web(let b, let c):
            if let c = c, let hit = fromCache(c, id, frame, maxAge: cacheMaxAge) { return hit }
            guard let url = IconKey.url(base: b, id: id, frame: frame) else { return Loaded(error: .network("адрес"), how: "сеть") }
            if let h = url.host { note(h) }
            var req = URLRequest(url: url)
            req.setValue("image/*", forHTTPHeaderField: "accept")
            let sem = DispatchSemaphore(value: 0)
            var out = Loaded(error: .network("таймаут"), how: "сеть")
            session.dataTask(with: req) { data, resp, err in
                defer { sem.signal() }
                if let err = err as? URLError {
                    out = Loaded(error: err.code == .cancelled ? .redirect : .network("URLError \(err.code.rawValue)"), how: "сеть")
                    return
                } else if err != nil {
                    out = Loaded(error: .network("ошибка"), how: "сеть")
                    return
                }
                let http = resp as? HTTPURLResponse
                let d = data ?? Data()
                switch IconKey.accept(status: http?.statusCode ?? 0, mime: http?.mimeType, data: d) {
                case .success(let img):
                    out = Loaded(image: img, how: "сеть", bytes: d.count)
                    if let c = c, let name = IconKey.cacheName(id: id, frame: frame) {
                        try? fm.createDirectory(at: c, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                        try? d.write(to: c.appendingPathComponent(name), options: .atomic)
                    }
                case .failure(let e):
                    out = Loaded(error: e, how: "сеть")
                }
            }.resume()
            if sem.wait(timeout: .now() + 6) == .timedOut { return Loaded(error: .network("таймаут"), how: "сеть") }
            return out
        }
    }

    private static func fromCache(_ c: URL, _ id: String, _ frame: IconFrame, maxAge: TimeInterval?) -> Loaded? {
        guard let name = IconKey.cacheName(id: id, frame: frame) else { return nil }
        let path = c.appendingPathComponent(name).path
        let fm = FileManager.default
        guard let a = try? fm.attributesOfItem(atPath: path), let n = a[.size] as? NSNumber, n.intValue <= IconKey.maxBytes else { return nil }
        if let maxAge = maxAge, let m = a[.modificationDate] as? Date, Date().timeIntervalSince(m) > maxAge { return nil }
        guard let data = fm.contents(atPath: path), let img = IconKey.decode(data) else {
            try? fm.removeItem(atPath: path)
            return nil
        }
        return Loaded(image: img, how: "кеш", bytes: data.count)
    }

    /// Redirects could lead off this machine: never follow them.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    /// --selftest: forget everything.
    func resetForTest() {
        images.removeAll(); failedAt.removeAll(); inFlight.removeAll(); requestedHosts.removeAll()
        base = nil; rawBase = nil; dir = nil
    }

    var loadedKeys: [String] { images.keys.sorted() }
}

// MARK: - Views

/// The thread's picture with the state marks, or the letters badge without a picture.
struct ThreadBadge: View {
    @ObservedObject var store: IconStore
    let card: SnapshotCard
    var size: CGFloat = PanelMath.badge
    var t: Double? = nil

    var body: some View {
        let img: NSImage? = card.icon.flatMap { icon in
            guard icon.usable else { return nil }
            store.prefetch(icon, IconAnim.needed(icon, state: card.state))
            return store.picture(icon, IconAnim.shown(icon, state: card.state, t: t))
        }
        ProjectBadge(project: card.project, state: card.state, size: size, t: t, image: img)
    }
}

/// Small executor picture before the ticket's time and model.
struct AgentIcon: View {
    @ObservedObject var store: IconStore
    let icon: SnapshotIcon
    static let size: CGFloat = 15

    var body: some View {
        if let img = store.picture(icon, .base) {
            Image(nsImage: img)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: Self.size, height: Self.size)
        } else {
            Color.clear.frame(width: Self.size, height: Self.size)
        }
    }
}
