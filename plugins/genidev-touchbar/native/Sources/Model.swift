import Foundation
import CoreGraphics

// Mirrors lib/contract.ts exactly. Do not add fields here without changing the contract.

enum CardState: String, Codable {
    case working, waiting, error, done, idle

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = CardState(rawValue: raw) ?? .idle
    }

    /// Caption shown in the expanded row when there is no current ticket.
    var caption: String {
        switch self {
        case .working: return L("Работает", "Working")
        case .waiting: return L("Ждёт ответа", "Waiting for you")
        case .error: return L("Ошибка", "Error")
        case .done: return L("Готово", "Done")
        case .idle: return L("Пауза", "Paused")
        }
    }
}

/// Ticket status from task-queue. Unknown values read as pending.
enum TicketStatus: String, Codable {
    case pending, active, review, done, error, skipped

    init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? ""
        self = TicketStatus(rawValue: raw) ?? .pending
    }
}

/// A picture from the project icons plugin (contract.ts SnapshotIcon). Decoded leniently:
/// a broken value becomes an icon with an empty id, which `usable` rejects, so the card
/// falls back to the letters badge instead of dropping the snapshot.
struct SnapshotIcon: Codable, Equatable {
    var id: String
    var frames: [String]
    var chosen: Bool

    init(id: String, frames: [String] = [], chosen: Bool = false) {
        self.id = id
        self.frames = frames
        self.chosen = chosen
    }

    init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
            self.init(id: "")
            return
        }
        let id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? nil
        let frames = ((try? c.decodeIfPresent([String].self, forKey: .frames)) ?? nil) ?? []
        let chosen = ((try? c.decodeIfPresent(Bool.self, forKey: .chosen)) ?? nil) ?? false
        self.init(id: id ?? "", frames: frames, chosen: chosen)
    }

    /// The id is safe for a URL query and a cache file name.
    var usable: Bool { IconKey.validId(id) }
    func has(_ f: IconFrame) -> Bool { frames.contains(f.rawValue) }
}

struct SnapshotTicket: Codable, Equatable {
    var title: String
    var status: TicketStatus
    var owner: String?
    // Added after version 2; nil when an older plugin does not send them.
    var startedAt: Double? = nil
    var doneAt: Double? = nil
    /// Agent work on this ticket without the turn running now (nil = old snapshot: no time shown).
    var workMs: Double? = nil
    // Added with project icons; nil from an older plugin.
    var agent: String? = nil
    var agentIcon: SnapshotIcon? = nil

    init(title: String, status: TicketStatus, owner: String? = nil,
         startedAt: Double? = nil, doneAt: Double? = nil, workMs: Double? = nil,
         agent: String? = nil, agentIcon: SnapshotIcon? = nil) {
        self.title = title
        self.status = status
        self.owner = owner
        self.startedAt = startedAt
        self.doneAt = doneAt
        self.workMs = workMs
        self.agent = agent
        self.agentIcon = agentIcon
    }

    /// Lenient: a ticket with a missing field must not drop the whole snapshot.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        status = (try? c.decodeIfPresent(TicketStatus.self, forKey: .status)) ?? .pending
        owner = (try? c.decodeIfPresent(String.self, forKey: .owner)) ?? nil
        startedAt = (try? c.decodeIfPresent(Double.self, forKey: .startedAt)) ?? nil
        doneAt = (try? c.decodeIfPresent(Double.self, forKey: .doneAt)) ?? nil
        workMs = (try? c.decodeIfPresent(Double.self, forKey: .workMs)) ?? nil
        agent = (try? c.decodeIfPresent(String.self, forKey: .agent)) ?? nil
        agentIcon = (try? c.decodeIfPresent(SnapshotIcon.self, forKey: .agentIcon)) ?? nil
    }
}

struct SnapshotStage: Codable, Equatable {
    var name: String
    var tickets: [SnapshotTicket]

    init(name: String, tickets: [SnapshotTicket]) {
        self.name = name
        self.tickets = tickets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        tickets = (try? c.decodeIfPresent([SnapshotTicket].self, forKey: .tickets)) ?? []
    }
}

struct SnapshotCard: Codable, Identifiable, Equatable {
    var threadId: String
    var project: String
    var title: String
    var planTitle: String
    var done: Int
    var total: Int
    var remaining: Int
    var current: String?
    var state: CardState
    var workMs: Double
    var runningSince: Double?
    var updatedAt: Double
    // Snapshot version 2. All optional: an older plugin does not send them.
    var note: String? = nil
    var etaMs: Double? = nil
    var stages: [SnapshotStage]? = nil
    var hiddenTickets: Int? = nil
    /// Added with project icons; nil from an older plugin or with the icons plugin off.
    var icon: SnapshotIcon? = nil

    var id: String { threadId }
}

extension SnapshotCard {
    /// The required fields as before; the optional ones never drop the card.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        threadId = try c.decode(String.self, forKey: .threadId)
        project = try c.decode(String.self, forKey: .project)
        title = try c.decode(String.self, forKey: .title)
        planTitle = try c.decode(String.self, forKey: .planTitle)
        done = try c.decode(Int.self, forKey: .done)
        total = try c.decode(Int.self, forKey: .total)
        remaining = try c.decode(Int.self, forKey: .remaining)
        current = try c.decodeIfPresent(String.self, forKey: .current)
        state = try c.decode(CardState.self, forKey: .state)
        workMs = try c.decode(Double.self, forKey: .workMs)
        runningSince = try c.decodeIfPresent(Double.self, forKey: .runningSince)
        updatedAt = try c.decode(Double.self, forKey: .updatedAt)
        note = (try? c.decodeIfPresent(String.self, forKey: .note)) ?? nil
        etaMs = (try? c.decodeIfPresent(Double.self, forKey: .etaMs)) ?? nil
        stages = try c.decodeIfPresent([SnapshotStage].self, forKey: .stages)
        hiddenTickets = (try? c.decodeIfPresent(Int.self, forKey: .hiddenTickets)) ?? nil
        icon = (try? c.decodeIfPresent(SnapshotIcon.self, forKey: .icon)) ?? nil
    }
}

/// Totals for the calm strip (contract.ts SnapshotSummary). Optional in the snapshot:
/// an older plugin does not send it, then the same numbers come from the cards.
struct SnapshotSummary: Codable, Equatable {
    var projectsWorking: Int
    var projects: Int
    var threads: Int
    var threadsWorking: Int
    var threadsWaiting: Int
    var threadsError: Int
    var done: Int
    var total: Int
    /// Tickets of the threads working right now, and how many of them are done.
    /// Added later: nil from an older plugin, then counted over the cards.
    var tasksInWorking: Int? = nil
    var doneInWorking: Int? = nil

    init(projectsWorking: Int, projects: Int, threads: Int, threadsWorking: Int,
         threadsWaiting: Int, threadsError: Int, done: Int, total: Int,
         tasksInWorking: Int? = nil, doneInWorking: Int? = nil) {
        self.projectsWorking = projectsWorking
        self.projects = projects
        self.threads = threads
        self.threadsWorking = threadsWorking
        self.threadsWaiting = threadsWaiting
        self.threadsError = threadsError
        self.done = done
        self.total = total
        self.tasksInWorking = tasksInWorking
        self.doneInWorking = doneInWorking
    }

    /// Same rules as the plugin, over the cards we have.
    init(cards: [SnapshotCard]) {
        let working = cards.filter { $0.state == .working }
        self.init(projectsWorking: Set(working.map { $0.project }).count,
                  projects: Set(cards.map { $0.project }).count,
                  threads: cards.count,
                  threadsWorking: working.count,
                  threadsWaiting: cards.filter { $0.state == .waiting }.count,
                  threadsError: cards.filter { $0.state == .error }.count,
                  done: cards.reduce(0) { $0 + max(0, $1.done) },
                  total: cards.reduce(0) { $0 + max(0, $1.total) },
                  tasksInWorking: working.reduce(0) { $0 + max(0, $1.total) },
                  doneInWorking: working.reduce(0) { $0 + max(0, $1.done) })
    }

    /// Lenient: a missing number reads as 0 instead of dropping the snapshot.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func n(_ k: CodingKeys) -> Int { ((try? c.decodeIfPresent(Int.self, forKey: k)) ?? nil) ?? 0 }
        func o(_ k: CodingKeys) -> Int? { (try? c.decodeIfPresent(Int.self, forKey: k)) ?? nil }
        self.init(projectsWorking: n(.projectsWorking), projects: n(.projects), threads: n(.threads),
                  threadsWorking: n(.threadsWorking), threadsWaiting: n(.threadsWaiting),
                  threadsError: n(.threadsError), done: n(.done), total: n(.total),
                  tasksInWorking: o(.tasksInWorking), doneInWorking: o(.doneInWorking))
    }
}

struct Snapshot: Codable, Equatable {
    var version: Int? = nil
    var summary: SnapshotSummary? = nil
    var generatedAt: Double
    var cards: [SnapshotCard]
    /// Icons plugin image route; nil from an older plugin or with the icons plugin off.
    var iconUrl: String? = nil

    /// From the plugin when present, else counted over the cards. Fields an older
    /// plugin does not send are counted over the cards too.
    var totals: SnapshotSummary {
        guard var s = summary else { return SnapshotSummary(cards: cards) }
        if s.tasksInWorking == nil || s.doneInWorking == nil {
            let byCards = SnapshotSummary(cards: cards)
            if s.tasksInWorking == nil { s.tasksInWorking = byCards.tasksInWorking }
            if s.doneInWorking == nil { s.doneInWorking = byCards.doneInWorking }
        }
        return s
    }

    /// Same cards and totals; generatedAt is not compared.
    static func sameContent(_ a: Snapshot?, _ b: Snapshot?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case let (x?, y?): return x.cards == y.cards && x.summary == y.summary && x.version == y.version && x.iconUrl == y.iconUrl
        default: return false
        }
    }

    static func decode(_ data: Data) throws -> Snapshot {
        try JSONDecoder().decode(Snapshot.self, from: data)
    }
}

extension Snapshot {
    /// generatedAt and cards are required; the rest never drops the snapshot.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? nil
        summary = (try? c.decodeIfPresent(SnapshotSummary.self, forKey: .summary)) ?? nil
        generatedAt = try c.decode(Double.self, forKey: .generatedAt)
        cards = try c.decode([SnapshotCard].self, forKey: .cards)
        iconUrl = (try? c.decodeIfPresent(String.self, forKey: .iconUrl)) ?? nil
    }
}

enum Fmt {
    /// < 1 min: "N с"; < 1 h: "N мин"; else "H ч M мин".
    static func duration(ms: Double) -> String {
        let secs = ms.isFinite ? max(0, Int((ms / 1000).rounded(.down))) : 0
        if secs < 60 { return L("\(secs) с", "\(secs) s") }
        let mins = secs / 60
        if mins < 60 { return L("\(mins) мин", "\(mins) min") }
        return L("\(mins / 60) ч \(mins % 60) мин", "\(mins / 60) h \(mins % 60) min")
    }

    /// Share of the ring that is done, 0...1. total <= 0 gives an empty ring.
    static func fraction(done: Int, total: Int) -> Double {
        guard total > 0 else { return 0 }
        return min(1, max(0, Double(done) / Double(total)))
    }

    /// workMs plus the running turn, measured on the server clock.
    static func workedMs(_ card: SnapshotCard, serverNow: Double) -> Double {
        var ms = card.workMs
        if let since = card.runningSince { ms += max(0, serverNow - since) }
        return ms
    }

    static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

    /// Russian plural: 1 тред, 2 треда, 5 тредов, 11 тредов, 21 тред.
    static func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
        let a = abs(n) % 100, b = abs(n) % 10
        if a >= 11 && a <= 14 { return many }
        if b == 1 { return one }
        if b >= 2 && b <= 4 { return few }
        return many
    }

    static func threads(_ n: Int) -> String {
        Lang.en ? "\(n) \(enPlural(n, "thread", "threads"))" : "\(n) \(plural(n, "тред", "треда", "тредов"))"
    }
    static func tasks(_ n: Int) -> String {
        Lang.en ? "\(n) \(enPlural(n, "task", "tasks"))" : "\(n) \(plural(n, "задача", "задачи", "задач"))"
    }
    static func moreTickets(_ n: Int) -> String {
        Lang.en ? "\(n) more \(enPlural(n, "ticket", "tickets"))" : "ещё \(n) \(plural(n, "тикет", "тикета", "тикетов"))"
    }

    /// "≈ 12 мин до конца"; under a minute: "меньше минуты до конца".
    static func eta(ms: Double) -> String {
        guard ms.isFinite, ms >= 60_000 else { return L("меньше минуты до конца", "under a minute left") }
        return L("≈ \(duration(ms: ms)) до конца", "≈ \(duration(ms: ms)) left")
    }
}

/// Filter row of the panel: three equal buttons. "Пауза" = every thread not working now.
enum CardFilter: String, CaseIterable {
    case all, working, idle

    var title: String {
        switch self {
        case .all: return L("Все", "All")
        case .working: return L("Работают", "Working")
        case .idle: return L("Пауза", "Paused")
        }
    }

    /// --ui-filter and --simulate filter: also the older names.
    static func parse(_ s: String) -> CardFilter? {
        switch s {
        case "all": return .all
        case "working": return .working
        case "idle", "paused", "pause": return .idle
        default: return nil
        }
    }

    func matches(_ c: SnapshotCard) -> Bool {
        switch self {
        case .all: return true
        case .working: return c.state == .working
        case .idle: return c.state != .working
        }
    }

    func count(_ cards: [SnapshotCard]) -> Int { cards.filter(matches).count }

    /// The row shows when there is more than one thread; an empty filter is shown dimmed.
    static func rowVisible(_ cards: [SnapshotCard]) -> Bool { cards.count > 1 }

    /// A filter can be chosen when the row is shown and it has threads.
    static func selectable(_ f: CardFilter, cards: [SnapshotCard]) -> Bool {
        f == .all || (rowVisible(cards) && f.count(cards) > 0)
    }

    /// The filter to keep after new data: back to "Все" when it emptied or the row is hidden.
    static func normalized(_ f: CardFilter, cards: [SnapshotCard]) -> CardFilter {
        selectable(f, cards: cards) ? f : .all
    }
}

/// What a row says about a thread, and the time of one ticket.
enum RowText {
    enum Tone: String { case primary, secondary, waiting, error, done }

    /// The ticket in work: the active one named like card.current, else the first active one.
    static func currentTicket(_ c: SnapshotCard) -> SnapshotTicket? {
        let all = (c.stages ?? []).flatMap { $0.tickets }
        let active = all.filter { $0.status == .active }
        if let cur = c.current, let t = active.first(where: { $0.title == cur }) { return t }
        return active.first
    }

    static func nextTicket(_ c: SnapshotCard) -> SnapshotTicket? {
        (c.stages ?? []).flatMap { $0.tickets }.first(where: { $0.status == .pending })
    }

    private static func clean(_ s: String?) -> String? {
        let t = s?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? nil : t
    }

    /// Second line of a row: what is going on now.
    static func now(_ c: SnapshotCard) -> (text: String, tone: Tone) {
        switch c.state {
        case .working:
            if let cur = clean(c.current) { return (cur, .primary) }
            return (clean(c.planTitle) ?? L("Работает", "Working"), .secondary)
        case .idle:
            if let n = nextTicket(c).flatMap({ clean($0.title) }) { return (L("Пауза · следующая: \(n)", "Paused · next: \(n)"), .secondary) }
            return (L("Пауза", "Paused"), .secondary)
        case .waiting:
            return (L("Ждёт ответа: ", "Waiting for you: ") + (clean(c.note) ?? c.project), .waiting)
        case .error:
            return (clean(c.note).map { L("Ошибка: ", "Error: ") + $0 } ?? L("Ошибка", "Error"), .error)
        case .done:
            return (L("Готово", "Done"), .done)
        }
    }

    /// Time on a ticket: workMs, plus the running turn for the active ticket
    /// (now - max(runningSince, startedAt), server clock). nil = old snapshot without workMs.
    static func ticketMs(_ t: SnapshotTicket, card: SnapshotCard, serverNow: Double) -> Double? {
        guard let w = t.workMs, w.isFinite else { return nil }
        var ms = max(0, w)
        if t.status == .active, let rs = card.runningSince, let st = t.startedAt {
            ms += max(0, serverNow - max(rs, st))
        }
        return ms
    }

    /// Time text for a ticket line: none for a ticket that never ran.
    static func ticketTime(_ t: SnapshotTicket, card: SnapshotCard, serverNow: Double) -> String? {
        guard let ms = ticketMs(t, card: card, serverNow: serverNow) else { return nil }
        if ms < 1000 && t.status != .active { return nil }
        return Fmt.duration(ms: ms)
    }

    /// "8 мин · Sonnet 5.5", only the owner without time, only the time without owner.
    static func ticketRight(_ t: SnapshotTicket, card: SnapshotCard, serverNow: Double) -> String? {
        let owner = clean(t.owner)
        let time = ticketTime(t, card: card, serverNow: serverNow)
        switch (time, owner) {
        case let (t?, o?): return "\(t) · \(o)"
        case let (t?, nil): return t
        case let (nil, o?): return o
        default: return nil
        }
    }
}

enum Demo {
    static func snapshot(now: Double = Fmt.nowMs()) -> Snapshot {
        var s = cardsOnly(now: now)
        // Like the plugin: counted over every thread with a plan, more than the cards shown.
        // Like the plugin; here it matches the cards, so the header and the filters agree.
        s.summary = SnapshotSummary(projectsWorking: 2, projects: 6, threads: 6, threadsWorking: 2,
                                    threadsWaiting: 1, threadsError: 1, done: 25, total: 41,
                                    tasksInWorking: 13, doneInWorking: 7)
        return s
    }

    /// Demo cards without the summary (selftest: totals counted over the cards).
    static func cardsOnly(now: Double = Fmt.nowMs()) -> Snapshot {
        let min = 60_000.0
        // Ticket with demo times: done ones took a few minutes, the active one runs now.
        var k = 0
        func T(title: String, status: TicketStatus, owner: String?, agent: String? = nil, agentIcon: String? = nil) -> SnapshotTicket {
            k += 1
            let spent = Double(3 + (k * 7) % 11) * min
            var t: SnapshotTicket
            switch status {
            case .done:
                t = SnapshotTicket(title: title, status: status, owner: owner, startedAt: now - spent - 60 * min,
                                   doneAt: now - 60 * min, workMs: spent)
            case .active:
                t = SnapshotTicket(title: title, status: status, owner: owner, startedAt: now - 12 * min,
                                   doneAt: nil, workMs: 6 * min)
            case .review, .error:
                t = SnapshotTicket(title: title, status: status, owner: owner, startedAt: now - 30 * min,
                                   doneAt: nil, workMs: spent)
            case .pending, .skipped:
                t = SnapshotTicket(title: title, status: status, owner: owner, startedAt: nil, doneAt: nil, workMs: 0)
            }
            t.agent = agent
            t.agentIcon = agentIcon.map { icon($0, chosen: false) }
            return t
        }
        return Snapshot(version: 2, generatedAt: now, cards: [
            SnapshotCard(threadId: "demo-working-1", project: L("Global GG AI", "Notch Bar"),
                         title: L("Полоска у выреза камеры для агентов bb", "A strip around the camera notch for bb agents"),
                         planTitle: L("Touch Bar у выреза", "Notch strip"), done: 2, total: 6, remaining: 4,
                         current: L("Полоска у выреза камеры", "Strip around the notch"), state: .working,
                         workMs: 47 * min, runningSince: now - 95_000, updatedAt: now - 5_000,
                         note: nil, etaMs: 12 * min,
                         stages: [
                            SnapshotStage(name: L("Очередь 1: сводка из плагина", "Queue 1: plugin summary"), tickets: [
                                T(title: L("Сводка тредов для полоски", "Thread summary for the strip"), status: .done, owner: "Sonnet 5.5",
                                  agent: L("Сводка для полоски", "Strip summary"), agentIcon: "kitty"),
                                T(title: L("Старый способ показа плана", "Old plan view"), status: .skipped, owner: nil),
                                T(title: L("Полоска у выреза камеры", "Strip around the notch"), status: .active, owner: "Opus 5.5",
                                  agent: L("Крестик закрытия панели", "Panel close button"), agentIcon: "fox"),
                            ]),
                            SnapshotStage(name: L("Очередь 2: живая панель с тикетами, шапкой и фильтрами", "Queue 2: live panel with tickets, header and filters"), tickets: [
                                T(title: L("Проверка сводки на трёх экранах", "Check the summary on three screens"), status: .review, owner: "Haiku 5.5",
                                  agent: L("Проверка на трёх экранах", "Three-screen check"), agentIcon: "penguin"),
                                T(title: L("Установка под автозапуск", "Start at login"), status: .error, owner: "Sonnet 5.5"),
                                T(title: L("Очень длинное название тикета, которое точно не поместится в одну строку панели и обрежется многоточием", "A very long ticket title that will not fit on one line of the panel and ends with an ellipsis"), status: .pending, owner: "Sonnet 5.5"),
                            ]),
                         ], hiddenTickets: 0, icon: icon("ball-bear")),
            SnapshotCard(threadId: "demo-waiting-2",
                         project: L("Остров Здоровья — сайт клиники с очень длинным названием проекта", "Green Garden — a nursery website with a very long project name"),
                         title: L("Переделать страницу записи к врачу, добавить выбор филиала и времени приёма", "Rework the booking page, add store and time slot choice"),
                         planTitle: L("Запись онлайн", "Online booking"), done: 3, total: 5, remaining: 2,
                         current: nil, state: .waiting,
                         workMs: 83 * min + 20_000, runningSince: nil, updatedAt: now - 60_000,
                         note: L("Нужен ответ: какие филиалы показывать в форме записи и можно ли брать расписание врачей из МИС напрямую, или его надо выгружать вручную раз в день, как сейчас", "Need an answer: which stores to show in the booking form, and can we read the schedule from the shop system directly or export it by hand once a day, as now"),
                         etaMs: nil,
                         stages: [
                            SnapshotStage(name: "", tickets: [
                                T(title: L("Форма записи", "Booking form"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Выбор филиала", "Store choice"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Выбор времени приёма", "Time slot choice"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Расписание врачей из МИС", "Schedule from the shop system"), status: .pending, owner: "Opus 5.5"),
                                T(title: L("Проверка на телефоне", "Phone check"), status: .pending, owner: nil),
                            ]),
                         ], hiddenTickets: 0, icon: icon("ball-owl")),
            SnapshotCard(threadId: "demo-working-6", project: L("Ostrov Stats", "Sales Reports"),
                         title: L("Замечания бухгалтерии", "Accounting feedback"),
                         planTitle: L("Правки отчётов", "Report fixes"), done: 5, total: 7, remaining: 2,
                         current: L("Выпуск с миграциями", "Release with migrations"), state: .working,
                         workMs: 27 * min, runningSince: now - 20_000, updatedAt: now - 2_000,
                         note: nil, etaMs: 40_000,
                         stages: [
                            SnapshotStage(name: L("Очередь 1: отчёты", "Queue 1: reports"), tickets: [
                                T(title: L("Сверка актов", "Invoice matching"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Отчёт по кассе", "Cash report"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Округление сумм", "Rounding"), status: .done, owner: "Haiku 5.5"),
                            ]),
                            SnapshotStage(name: L("Очередь 2: права", "Queue 2: access"), tickets: [
                                T(title: L("Доступ бухгалтерии", "Accounting access"), status: .done, owner: "Opus 5.5"),
                                T(title: L("Журнал изменений", "Change log"), status: .done, owner: "Sonnet 5.5"),
                            ]),
                            SnapshotStage(name: L("Очередь 3: выпуск", "Queue 3: release"), tickets: [
                                T(title: L("Выпуск с миграциями", "Release with migrations"), status: .active, owner: "Opus 5.5"),
                                T(title: L("Проверка в production", "Production check"), status: .pending, owner: "Haiku 5.5"),
                            ]),
                         ], hiddenTickets: 0, icon: icon("ball-moose")),
            SnapshotCard(threadId: "demo-error-3", project: L("ostrov-stats", "analytics-export"),
                         title: L("Выгрузка статистики из Метрики", "Export visit stats"),
                         planTitle: L("Отчёт за ноябрь", "November report"), done: 1, total: 4, remaining: 3,
                         current: nil, state: .error,
                         workMs: 12 * min, runningSince: nil, updatedAt: now - 300_000,
                         note: L("Метрика ответила 403: у токена нет доступа к счётчику", "Analytics API answered 403: the token has no access to the counter"),
                         etaMs: nil,
                         stages: [
                            SnapshotStage(name: L("Очередь 1: выгрузка", "Queue 1: export"), tickets: [
                                T(title: L("Доступ к API Метрики", "Analytics API access"), status: .done, owner: "Haiku 5.5"),
                                T(title: L("Выгрузка визитов за ноябрь", "Export November visits"), status: .error, owner: "Sonnet 5.5"),
                                T(title: L("Сводная таблица", "Summary table"), status: .pending, owner: "Sonnet 5.5"),
                                T(title: L("Отчёт владельцу", "Report to the owner"), status: .pending, owner: nil),
                            ]),
                         ], hiddenTickets: 0, icon: icon("ball-hedgehog")),
            // Old summary (no stages): the panel asks to update the plugin.
            SnapshotCard(threadId: "demo-idle-4", project: L("bb-plugin-touchbar", "notch-bar-plugin"),
                         title: L("Сводка для полоски", "Strip summary"),
                         planTitle: L("Плагин", "Plugin"), done: 0, total: 5, remaining: 5,
                         current: nil, state: .idle,
                         workMs: 40_000, runningSince: nil, updatedAt: now - 900_000),
            SnapshotCard(threadId: "demo-done-5", project: L("Яндекс Директ", "Ad Campaigns"),
                         title: L("Кампании на декабрь", "December campaigns"),
                         planTitle: L("Реклама", "Ads"), done: 14, total: 14, remaining: 0,
                         current: nil, state: .done,
                         workMs: 2 * 60 * min + 5 * min, runningSince: nil, updatedAt: now - 3_600_000,
                         note: nil, etaMs: nil,
                         stages: [
                            SnapshotStage(name: L("Очередь 1: кампании", "Queue 1: campaigns"), tickets: [
                                T(title: L("Семантика", "Keywords"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Объявления", "Ads copy"), status: .done, owner: "Sonnet 5.5"),
                                T(title: L("Ставки и бюджет", "Bids and budget"), status: .done, owner: "Opus 5.5"),
                                T(title: L("Запуск", "Launch"), status: .done, owner: nil),
                            ]),
                         ], hiddenTickets: 10, icon: icon("ball-rabbit")),
        ])
    }

    /// Demo icons: ids of the icons plugin's built-in pictures; frames as its icons.json lists them.
    /// The pictures come from --icons-dir (the demo has no iconUrl and never goes to the network).
    static let iconFrames: [String: [String]] = [
        "ball-bear": ["left", "right", "puzzled", "alert", "happy"],
        "ball-owl": ["left", "right", "puzzled", "alert", "happy"],
        "ball-moose": ["left", "right", "puzzled", "alert", "happy"],
        "ball-hedgehog": ["left", "right", "puzzled", "alert", "happy"],
        "ball-rabbit": ["left", "right", "puzzled", "alert", "happy"],
        "kitty": ["left", "right", "puzzled"], "fox": ["left", "right", "puzzled"],
        "penguin": ["left", "right", "puzzled"], "armor-hero": [],
    ]

    static func icon(_ id: String, chosen: Bool = true) -> SnapshotIcon {
        SnapshotIcon(id: id, frames: iconFrames[id] ?? [], chosen: chosen)
    }

    /// A plan of `tickets` tickets in `stagesCount` queues (selftest, long-plan render).
    static func longCard(tickets: Int, stagesCount: Int = 4, hidden: Int = 0, now: Double = Fmt.nowMs()) -> SnapshotCard {
        let statuses: [TicketStatus] = [.done, .done, .skipped, .done, .review, .active, .error, .pending, .pending]
        var stages: [SnapshotStage] = []
        let per = max(1, Int((Double(tickets) / Double(max(1, stagesCount))).rounded(.up)))
        var n = 0
        for s in 0..<stagesCount where n < tickets {
            var ts: [SnapshotTicket] = []
            for _ in 0..<per where n < tickets {
                let st = statuses[n % statuses.count]
                let ran = st != .pending && st != .skipped
                ts.append(SnapshotTicket(title: "Тикет \(n + 1): шаг длинного плана", status: st,
                                         owner: ["Sonnet 5.5", "Opus 5.5", "Haiku 5.5"][n % 3],
                                         startedAt: ran ? now - 3_600_000 : nil, doneAt: st == .done ? now - 60_000 : nil,
                                         workMs: ran ? Double(2 + n % 7) * 60_000 : 0))
                n += 1
            }
            stages.append(SnapshotStage(name: "Очередь \(s + 1): часть большого плана", tickets: ts))
        }
        return SnapshotCard(threadId: "demo-long-\(tickets)", project: "Длинный план", title: "План из \(tickets) тикетов",
                            planTitle: "Длинный план", done: tickets / 2, total: tickets + hidden,
                            remaining: tickets - tickets / 2 + hidden, current: "Тикет 6", state: .working,
                            workMs: 90 * 60_000, runningSince: now - 30_000, updatedAt: now,
                            note: "Длинный план: проверка высоты панели", etaMs: 95 * 60_000,
                            stages: stages, hiddenTickets: hidden)
    }
}
