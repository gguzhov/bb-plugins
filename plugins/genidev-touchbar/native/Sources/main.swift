import AppKit
import SwiftUI

struct Options {
    var demo = false
    var snapshotFile: String?
    var renderDir: String?
    var dryRun = false
    var selftest = false
    var simulateClick: Int?
    var exitAfter: Double?
    /// Test: pretend the first menu bar icon starts at this screen x (render only).
    var iconLimit: Double?
    // Panel state without the mouse (render and live run).
    var uiHover: Int?
    var uiExpand: Int?
    var uiFilter: CardFilter?
    /// Open the panel at launch (live run, no mouse).
    var uiOpen = false
    /// Robot and messages.
    var uiMood: Mood?
    var uiBanner: EventKind?
    var printMenu = false
    /// --render-png / --print-menu: the "do not cover menu bar icons" switch is on.
    var uiKeepIcons = false
    /// --render-png: add a plan of N tickets as the second card.
    var demoLong: Int?
    /// Live run: actions through the same handlers as the real ones, 1 s apart.
    var simulate: [String] = []
    /// --icons-dir: thread pictures from a folder (<id>.webp, <id>.<frame>.webp) instead of the network.
    var iconsDir: String?
    /// --ui-time: static renders show animated pictures at this moment.
    var uiTime: Double?
    /// --export-robot-stubs: write the drawn robot as mascot stub PNGs (test helper) and exit.
    var exportRobotStubs: String?
    /// --lang en: English labels and demo data (render only).
    var lang: String?
    /// --ui-catalog: clean previews for the catalog page.
    var uiCatalog = false

    static func parse(_ argv: [String]) -> Options {
        var o = Options()
        var i = 1
        func next() -> String? {
            i += 1
            return i < argv.count ? argv[i] : nil
        }
        while i < argv.count {
            switch argv[i] {
            case "--demo": o.demo = true
            case "--snapshot-file": o.snapshotFile = next()
            case "--render-png": o.renderDir = next()
            case "--dry-run": o.dryRun = true
            case "--selftest": o.selftest = true
            case "--config": if let p = next() { BBLocator.configPath = p }
            case "--log-file": if let p = next() { Log.path = p }
            case "--simulate-click": o.simulateClick = next().flatMap(Int.init)
            case "--exit-after": o.exitAfter = next().flatMap(Double.init)
            case "--icon-limit": o.iconLimit = next().flatMap(Double.init)
            case "--ui-hover": o.uiHover = next().flatMap(Int.init)
            case "--ui-expand": o.uiExpand = next().flatMap(Int.init)
            case "--ui-filter":
                let v = next() ?? ""
                guard let f = CardFilter.parse(v) else {
                    FileHandle.standardError.write("--ui-filter: ждали all|working|idle (idle = «Пауза»: все, кто не работает), получили «\(v)»\n".data(using: .utf8)!)
                    exit(2)
                }
                o.uiFilter = f
            case "--ui-open": o.uiOpen = true
            case "--ui-mood":
                let v = next() ?? ""
                guard let m = Mood(rawValue: v) else {
                    FileHandle.standardError.write("--ui-mood: ждали thinking|asking|upset|happy|sleeping, получили «\(v)»\n".data(using: .utf8)!)
                    exit(2)
                }
                o.uiMood = m
            case "--ui-banner":
                let v = next() ?? ""
                guard let k = EventKind(rawValue: v) else {
                    FileHandle.standardError.write("--ui-banner: ждали done|waiting|error, получили «\(v)»\n".data(using: .utf8)!)
                    exit(2)
                }
                o.uiBanner = k
            case "--print-menu": o.printMenu = true
            case "--ui-keep-icons": o.uiKeepIcons = true
            case "--demo-long": o.demoLong = next().flatMap(Int.init)
            case "--icons-dir": o.iconsDir = next()
            case "--mascot-dir": Mascot.overrideDir = next()
            case "--mascot-user-dir": if let d = next() { Mascot.userDir = d }
            case "--plugin-id": if let v = next(), !v.isEmpty { PluginId.primary = v }
            case "--lang": o.lang = next()
            case "--ui-catalog": o.uiCatalog = true
            case "--ui-time": o.uiTime = next().flatMap(Double.init)
            case "--export-robot-stubs": o.exportRobotStubs = next()
            case "--simulate":
                if let v = next() { o.simulate += v.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) } }
            case "-h", "--help":
                print("""
                BBTouchbar — полоска у выреза камеры с работой агентов bb.
                  --demo                  встроенный пример сводки
                  --snapshot-file <путь>  читать сводку из JSON-файла (раз в 2 с)
                  --render-png <папка>    отрисовать свёрнутый и раскрытый вид в PNG и выйти
                  --dry-run               не открывать тред, а писать команду в лог
                  --selftest              самопроверка: формы слов, шапка, значки, дорожка, фильтры, меню
                  --config <путь>         другой config.json (для проверки)
                  --log-file <путь>       другой файл лога (для проверки)
                  --simulate-click <N>    через 1,5 с нажать строку N (для проверки)
                  --exit-after <сек>      выйти через N секунд (для проверки)
                  --icon-limit <x>        для --render-png: первый значок строки меню начинается с x
                  --ui-hover <N>          строка N под курсором (номер в списке на панели, с 0)
                  --ui-expand <N>         строка N раскрыта
                  --ui-filter <имя>       all|working|idle (idle = «Пауза»: все, кто сейчас не работает)
                  --ui-open               открыть панель при запуске и не сворачивать, когда курсор ушёл
                                          (проверка нагрузки и вида без мыши)
                  --ui-mood <настроение>  thinking|asking|upset|happy|sleeping — лицо робота принудительно
                  --ui-banner <событие>   done|waiting|error — для --render-png нарисовать сообщение у выреза
                  --ui-keep-icons         переключатель «Не закрывать значки строки меню» включён (для --render-png и --print-menu)
                  --print-menu            вывести пункты меню и выйти
                  --demo-long <N>         для --render-png: второй строкой план из N задач
                  --icons-dir <папка>     картинки тредов и исполнителей из папки (<id>.webp, <id>.<кадр>.webp)
                                          вместо сети (для --demo и --render-png)
                  --mascot-dir <папка>    картинки талисмана (idle.png, left.png, …) вместо всех других мест
                  --mascot-user-dir <папка>  другая папка пользователя для талисмана (по умолчанию
                                          ~/Library/Application Support/bb-touchbar/mascot)
                  --plugin-id <id>        сначала спрашивать bb об этом идентификаторе плагина (проверка
                                          перехода; по умолчанию genidev-touchbar, запасной — touchbar)
                  --lang en               для --render-png и --demo: подписи полоски и панели по-английски
                                          и английские демо-данные (снимки для каталога)
                  --ui-catalog            для --render-png: превью без разметки выреза, на тёмном фоне
                  --ui-time <сек>         для --render-png: нарисовать анимированное в этот момент
                                          (глаза иконок, талисман думает: влево/вправо)
                  --export-robot-stubs <папка>  записать нарисованного робота в PNG 256×256 по кадрам
                                          талисмана (заглушки для проверки) и выйти
                    (без --render-png флаги --ui-* открывают панель при запуске)
                  --simulate <действие>   живой прогон: row-click:N, row-open:N, row-double:N, filter:<имя>,
                                          open-panel, close-panel, event:<done|waiting|error>:N, banner-click,
                                          banner-close, menu, menu-item:N; можно повторять
                                          или через запятую, по одному в секунду с 1,5 с
                """)
                exit(0)
            default:
                // Ignore -psn_* and other system arguments.
                break
            }
            i += 1
        }
        return o
    }
}

let options = Options.parse(CommandLine.arguments)

// Test runs never touch the installed copy's settings.
if options.selftest || options.demo || options.dryRun || options.snapshotFile != nil || options.renderDir != nil
    || options.printMenu || !options.simulate.isEmpty {
    Prefs.useTestStore()
}

if let d = options.iconsDir { IconStore.shared.dir = d }
if let l = options.lang {
    guard l == "en" || l == "ru" else {
        FileHandle.standardError.write("--lang: ждали en|ru, получили «\(l)»\n".data(using: .utf8)!)
        exit(2)
    }
    Lang.en = l == "en"
}

if options.selftest {
    exit(SelfTest.run() ? 0 : 1)
}


if options.printMenu {
    let m = AppModel()
    m.staticRender = true
    m.apply(options.snapshotFile.flatMap { FileManager.default.contents(atPath: $0) }.flatMap { try? Snapshot.decode($0) } ?? Demo.snapshot())
    UIFlags.apply(options, to: m)
    for it in AppMenu.items(m) { print(it.label) }
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

if let d = options.exportRobotStubs {
    let ok = MainActor.assumeIsolated { Renderer.exportRobotStubs(to: d) }
    exit(ok ? 0 : 1)
}

if let dir = options.renderDir {
    let ok = MainActor.assumeIsolated { Renderer.run(options: options, dir: dir) }
    exit(ok ? 0 : 1)
}

enum UIFlags {
    /// Sets filter, open row and hovered row from --ui-*; rows are numbered in the visible list.
    static func apply(_ o: Options, to m: AppModel) {
        if let f = o.uiFilter {
            m.filter = f
            m.normalizeUI()
        }
        let cards = m.visibleCards
        if let i = o.uiExpand, i >= 0, i < cards.count { m.expandedId = cards[i].id }
        if let i = o.uiHover, i >= 0, i < cards.count { m.hoveredId = cards[i].id }
        if let mood = o.uiMood { m.forcedMood = mood }
        if o.uiKeepIcons, m.staticRender { Prefs.keepIcons = true }
        if let t = o.uiTime, m.staticRender { m.frozenT = t }
    }
}

// One instance per bundle: a second launch exits quietly.
if let bid = Bundle.main.bundleIdentifier {
    let others = NSRunningApplication.runningApplications(withBundleIdentifier: bid)
        .filter { $0.processIdentifier != getpid() }
    if !others.isEmpty {
        Log.write("уже запущен экземпляр pid \(others[0].processIdentifier), выхожу")
        Log.flush()
        exit(0)
    }
}

signal(SIGPIPE, SIG_IGN)
let model = AppModel()
let delegate = AppDelegate(model: model, options: options)
app.delegate = delegate
app.run()
