import AppKit
import SwiftUI

/// `--render-png`: draws the collapsed and expanded strip into PNG files (2x) without a window.
enum Renderer {
    @MainActor
    static func run(options: Options, dir: String) -> Bool {
        let snap: Snapshot?
        if let path = options.snapshotFile {
            guard let data = FileManager.default.contents(atPath: path) else {
                FileHandle.standardError.write("не читается файл \(path)\n".data(using: .utf8)!)
                return false
            }
            do { snap = try Snapshot.decode(data) } catch {
                FileHandle.standardError.write("файл не разобран: \(error)\n".data(using: .utf8)!)
                return false
            }
        } else {
            snap = Demo.snapshot()
        }
        var snapLong = snap
        if let n = options.demoLong, var sl = snapLong {
            // A long plan right after the first card (track squeezed into one bar).
            sl.cards.insert(Demo.longCard(tickets: n, now: sl.generatedAt), at: min(1, sl.cards.count))
            snapLong = sl
        }
        guard let s = snapLong, !s.cards.isEmpty else {
            print("карточек нет — полоска скрыта, рисовать нечего")
            return true
        }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        // Pictures load in place: the renderer draws once and cannot wait for them.
        IconStore.shared.syncMode = true

        let model = AppModel()
        model.staticRender = true
        model.apply(s)
        model.iconLimitX = options.iconLimit.map { CGFloat($0) }
        UIFlags.apply(options, to: model)
        model.layout = model.computeLayout()
        let L = model.layout
        print(String(format: "вырез: x=%.0f..%.0f, ширина %.0f, высота %.0f, есть вырез: %@",
                     L.notchMinX, L.notchMaxX, L.notchW, L.notchH, L.hasNotch ? "да" : "нет"))
        print(String(format: "левое крыло %.0f pt, правое крыло %.0f pt (счёт и время: %@), граница значков: %@",
                     L.leftW, L.rightW, L.rightMode.rawValue,
                     options.iconLimit.map { String(format: "x=%.0f", $0) } ?? "нет"))
        print(String(format: "края полоски от центра выреза: слева %.1f pt, справа %.1f pt; «не закрывать значки»: %@",
                     L.notchCenterX - L.collapsedMinX, L.collapsedMinX + L.collapsedWidth - L.notchCenterX, L.keepIcons ? "включено" : "выключено"))
        var Lb = L
        CalmMath.apply(to: &Lb, summary: model.totals, iconLimitX: model.iconLimitX, keepIcons: Prefs.keepIcons, metrics: CalmMath.before)
        print(String(format: "ширина свёрнутой полоски: было %.0f pt (крыло %.0f), стало %.0f pt (крыло %.0f), уже на %.1f%%",
                     Lb.collapsedWidth, Lb.leftW, L.collapsedWidth, L.leftW, (1 - L.collapsedWidth / Lb.collapsedWidth) * 100))
        print(Mascot.describe())
        print("иконки тредов: " + (IconStore.shared.dir.map { "из папки \($0)" } ?? (IconStore.shared.base.map { "по сети \($0.absoluteString)" } ?? "адреса нет, значки с буквами"))
              + (model.frozenT.map { String(format: "; момент анимации %.2f с", $0) } ?? ""))
        let content = PanelMath.contentHeight(all: model.cards, visible: model.visibleCards, expandedId: model.expandedId, layout: L)
        print(String(format: "панель: ширина %.0f pt, высота %.0f pt (содержимое %.0f, предел 70%% экрана %.0f из %.0f)",
                     L.expandedWidth, model.panelHeight(L), content, PanelMath.maxHeight(L), L.screenH))
        let s0 = model.totals
        print("фильтры: " + (CardFilter.rowVisible(model.cards)
              ? CardFilter.allCases.map { "\($0.title) \($0.count(model.cards))\(CardFilter.selectable($0, cards: model.cards) ? "" : " (пуст)")" }.joined(separator: ", ")
              : "ряда нет")
              + String(format: " (кнопка %.0f pt)", PanelMath.filterButtonWidth(L))
              + "; выбран «\(model.filter.title)», в списке \(model.visibleCards.count), раскрыта: \(model.expandedId ?? "нет"), под курсором: \(model.hoveredId ?? "нет")")
        print("полоска: спокойный режим; итог: проектов в работе \(s0.projectsWorking), задачи \(s0.done)/\(s0.total)"
              + (snap?.summary == nil ? " (посчитано по карточкам)" : " (summary плагина)")
              + "; настроение: \(model.mood.title); подпись: «\(Calm.label(s0).text)»")
        let tNow = model.frozenT ?? 0.5
        print("заголовок панели (одна строка): «\(Calm.thought(cards: model.cards, summary: s0, at: tNow))»; мыслей по кругу: \(Calm.thoughts(cards: model.cards, summary: s0).count)")
        let tw = PanelMath.trackWidth(L)
        for c in model.visibleCards {
            let tl = TrackMath.layout(c, width: tw)
            let now = RowText.now(c)
            let tt = c.state == .working ? RowText.currentTicket(c).flatMap { RowText.ticketTime($0, card: c, serverNow: model.serverNow) } : nil
            let last = tl.pieces.last.map { $0.x + $0.w } ?? 0
            print(String(format: "  [%@ %@] %@ · «%@»%@ · дорожка: %@, правый край %.1f из %.0f pt", Badge.letters(c.project),
                         "#" + String(Badge.palette[Badge.colorIndex(c.project)], radix: 16), c.state.rawValue, now.text,
                         tt.map { " (\($0))" } ?? "",
                         tl.solid ? "полоса по долям" : "\(tl.blocks) блоков", last, tw))
            if let icon = c.icon, icon.usable {
                let f = IconAnim.shown(icon, state: c.state, t: model.frozenT)
                let got = IconStore.shared.picture(icon, f) != nil
                print("      картинка: \(icon.id), кадр \(f.rawValue)\(f.rawValue != IconAnim.wanted(c.state, t: model.frozenT).rawValue ? " (нужного кадра нет у иконки)" : "") — \(got ? "загружена" : "не загружена, значок с буквами")")
            } else {
                print("      картинки нет — значок с буквами")
            }
            let agents = (c.stages ?? []).flatMap { $0.tickets }.compactMap { t in TicketLine.agentIcon(t).map { "\(t.agent ?? "")=\($0.id)" } }
            if !agents.isEmpty { print("      исполнители с картинкой: " + agents.joined(separator: ", ")) }
        }

        var ok = true
        ok = write(robotSheet(), to: "\(dir)/robots.png") && ok
        var modes: [(name: String, expanded: Bool, banner: NoteEvent?)] = [("collapsed", false, nil), ("expanded", true, nil)]
        if let k = options.uiBanner {
            let e = bannerEvent(k, cards: model.cards)
            modes.append(("banner-\(k.rawValue)", false, e))
            print("сообщение: «\(e.line1)» / «\(e.line2)»; ширина \(Int(BannerMath.width(L))) pt, x=\(Int(BannerMath.minX(L)))..\(Int(BannerMath.maxX(L))), полоска до x=\(Int(L.collapsedMinX + L.collapsedWidth))")
        }
        for mode in modes {
            let expanded = mode.expanded
            model.expanded = expanded
            model.banner = mode.banner
            let bannerOn = mode.banner != nil
            let x = expanded ? min(L.expandedMinX, L.collapsedMinX) : (bannerOn ? BannerMath.minX(L) : L.collapsedMinX)
            model.windowMinX = x
            let w = expanded ? max(L.expandedMinX + L.expandedWidth, L.collapsedMinX + L.collapsedWidth) - x
                : (bannerOn ? BannerMath.width(L) : L.collapsedWidth)
            let h = expanded ? model.panelHeight(L) : (bannerOn ? BannerMath.totalHeight(L) : L.notchH)
            let name = mode.name
            // Exact strip on a transparent background.
            ok = write(RootView(model: model).frame(width: w, height: h), to: "\(dir)/\(name).png") && ok
            // Preview: a fixed 800 pt slice of the menu bar centred on the notch, grey backdrop,
            // red dashed outline = notch, blue bar = first menu bar icon (when --icon-limit is given).
            let sliceX = L.notchCenterX - 400
            let preview = ZStack(alignment: .topLeading) {
                Color(hex: 0xC8C8CC)
                RootView(model: model, showNotchZone: true)
                    .frame(width: w, height: h)
                    .offset(x: x - sliceX)
                if let lim = options.iconLimit {
                    Rectangle().fill(Color.blue.opacity(0.6))
                        .frame(width: 16, height: L.notchH - 10)
                        .offset(x: CGFloat(lim) - sliceX, y: 5)
                }
            }
            .frame(width: 800, height: h + 30, alignment: .topLeading)
            .clipped()
            ok = write(preview, to: "\(dir)/\(name)-preview.png") && ok
            if options.uiCatalog {
                // Catalog picture: the same 800 pt slice on a dark desktop, no notch markup.
                let ch = max(h + 48, 200)
                let shot = ZStack(alignment: .topLeading) {
                    LinearGradient(colors: [Color(hex: 0x1C2333), Color(hex: 0x3A2E4F), Color(hex: 0x14161C)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                    Rectangle().fill(Color.white.opacity(0.10)).frame(width: 800, height: L.notchH)
                    RootView(model: model)
                        .frame(width: w, height: h)
                        .offset(x: x - sliceX)
                }
                .frame(width: 800, height: ch, alignment: .topLeading)
                .clipped()
                ok = write(shot, to: "\(dir)/catalog-\(name).png") && ok
            }
        }
        return ok
    }

    /// Message for --ui-banner: the first thread already in that state, else thread 0 in it.
    static func bannerEvent(_ k: EventKind, cards: [SnapshotCard]) -> NoteEvent {
        var c = cards.first(where: { $0.state == k.state }) ?? cards[0]
        c.state = k.state
        return NoteEvent(kind: k, card: c)
    }

    /// Five moods: large (96 pt), message size (32 pt) and strip size (19 pt); the mascot
    /// pictures when there are any, the drawn robot otherwise. Thinking also at left and right.
    @MainActor
    static func robotSheet() -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(Mascot.available ? "Талисман из картинок" : "Робот (картинок талисмана нет)")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            HStack(alignment: .top, spacing: 18) {
                ForEach(Mood.allCases, id: \.self) { m in
                    VStack(spacing: 10) {
                        MascotFace(mood: m, size: 96, t: 0.5)
                        HStack(alignment: .bottom, spacing: 12) {
                            MascotFace(mood: m, size: 32, t: 0.5)
                            MascotFace(mood: m, size: CalmMath.robotSize, t: 0.5)
                        }
                        Text(m.title).font(.system(size: 13, weight: .medium)).foregroundColor(m.accent)
                        Text(m.rawValue).font(.system(size: 11)).foregroundColor(Palette.secondary)
                    }
                    .frame(width: 112)
                }
            }
            HStack(spacing: 18) {
                ForEach([(0.5, "прямо"), (2.0, "влево"), (3.5, "прямо"), (4.8, "вправо")], id: \.0) { t, name in
                    VStack(spacing: 6) {
                        MascotFace(mood: .thinking, size: 48, t: t)
                        Text("думает, \(name)").font(.system(size: 11)).foregroundColor(Palette.secondary)
                    }
                }
            }
        }
        .padding(20)
        .background(Color.black)
    }

    /// --export-robot-stubs: the drawn robot on an orange disc, 256×256 PNG per mascot frame.
    /// Only for checking the mascot code path; the real pictures come from the owner.
    @MainActor
    static func exportRobotStubs(to dir: String) -> Bool {
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let plan: [(MascotFrame, Mood, Double)] = [
            (.idle, .thinking, 0.5), (.left, .thinking, 2.0), (.right, .thinking, 4.5),
            (.asking, .asking, 0.5), (.upset, .upset, 0.5), (.happy, .happy, 0.5), (.sleeping, .sleeping, 0.5),
        ]
        var ok = true
        for (f, mood, t) in plan {
            let v = ZStack {
                Circle().fill(Color(hex: 0xFF9F0A))
                RobotFace(mood: mood, size: 190, t: t, antennaPulse: false)
                Text("GG").font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundColor(.black)
                    .offset(x: -82, y: 86)
            }
            .frame(width: 256, height: 256)
            ok = write(v, to: "\(dir)/\(f.rawValue).png", scale: 1) && ok
        }
        return ok
    }

    @MainActor
    static func write<V: View>(_ view: V, to path: String, scale: CGFloat = 2) -> Bool {
        let r = ImageRenderer(content: view)
        r.scale = scale
        r.isOpaque = false
        guard let cg = r.cgImage else {
            print("не удалось отрисовать \(path)")
            return false
        }
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let data = rep.representation(using: .png, properties: [:]) else { return false }
        do {
            try data.write(to: URL(fileURLWithPath: path))
            print("\(path) \(cg.width)x\(cg.height)")
            return true
        } catch {
            print("не записан \(path): \(error)")
            return false
        }
    }
}

enum SelfTest {
    static func run() -> Bool {
        var failed = 0
        IconStore.shared.cacheEnabled = false
        func check(_ label: String, _ got: String, _ want: String) {
            let ok = got == want
            if !ok { failed += 1 }
            print("\(ok ? "OK  " : "FAIL") \(label) -> \"\(got)\"\(ok ? "" : " (ждали \"\(want)\")")")
        }

        print("Формат времени:")
        let times: [(Double, String)] = [
            (-5_000, "0 с"), (0, "0 с"), (999, "0 с"), (1_000, "1 с"), (59_999, "59 с"),
            (60_000, "1 мин"), (119_000, "1 мин"), (3_599_999, "59 мин"),
            (3_600_000, "1 ч 0 мин"), (5_025_000, "1 ч 23 мин"), (36_000_000 + 59 * 60_000, "10 ч 59 мин"),
        ]
        for (ms, want) in times { check("duration(\(Int(ms)) мс)", Fmt.duration(ms: ms), want) }

        print("Доля кольца done/total:")
        let fr: [(Int, Int, String)] = [
            (0, 5, "0.0000"), (2, 6, "0.3333"), (6, 6, "1.0000"), (0, 0, "0.0000"),
            (3, 0, "0.0000"), (7, 5, "1.0000"), (-1, 4, "0.0000"), (1, 4, "0.2500"),
        ]
        for (d, t, want) in fr {
            check("fraction(\(d)/\(t))", String(format: "%.4f", Fmt.fraction(done: d, total: t)), want)
        }

        print("Время с идущим ходом (workMs + сейчас − runningSince, часы сервера):")
        let gen = 1_700_000_000_000.0
        var card = Demo.snapshot(now: gen).cards[0]
        card.workMs = 50_000
        card.runningSince = gen - 5_000
        // Local clock is 7 s behind the server: offset = generatedAt - local.
        let local = gen - 7_000
        let offset = gen - local
        let t0 = Fmt.workedMs(card, serverNow: local + offset)
        let t1 = Fmt.workedMs(card, serverNow: local + 10_000 + offset)
        let t2 = Fmt.workedMs(card, serverNow: local + 3_600_000 + offset)
        check("сразу", Fmt.duration(ms: t0), "55 с")
        check("через 10 с", Fmt.duration(ms: t1), "1 мин")
        check("через 1 ч", Fmt.duration(ms: t2), "1 ч 0 мин")
        check("растёт", t2 > t1 && t1 > t0 ? "да" : "нет", "да")
        card.runningSince = nil
        check("хода нет — не растёт", Fmt.duration(ms: Fmt.workedMs(card, serverNow: gen + 999_999)), "50 с")
        card.runningSince = gen + 60_000 // clock skew: start in the future
        check("старт в будущем не уменьшает", Fmt.duration(ms: Fmt.workedMs(card, serverNow: gen)), "50 с")

        print("Защита threadId:")
        check("обычный id", isSafeThreadId("thr_01HZX-abc") ? "да" : "нет", "да")
        check("id-опция", isSafeThreadId("--rotate") ? "да" : "нет", "нет")
        check("id с пробелом", isSafeThreadId("a b") ? "да" : "нет", "нет")

        print("Разбор сводки по contract.ts:")
        let json = """
        {"generatedAt":1700000000000,"cards":[{"threadId":"t1","project":"P","title":"T","planTitle":"PL",
        "done":2,"total":6,"remaining":4,"current":null,"state":"waiting","workMs":1000,"runningSince":null,"updatedAt":1}]}
        """
        let parsed = (try? Snapshot.decode(json.data(using: .utf8)!))?.cards.first
        check("state/done/total", parsed.map { "\($0.state.rawValue) \($0.done)/\($0.total)" } ?? "ошибка", "waiting 2/6")

        print("Ширина крыльев по содержимому:")
        let shortL = WingMath.leftWidth(nameWidth: WingMath.textWidth("bb", WingMath.nameFont))
        let longL = WingMath.leftWidth(nameWidth: WingMath.textWidth("Остров Здоровья — сайт клиники", WingMath.nameFont))
        print(String(format: "     левое: «bb» = %.0f pt, длинное = %.0f pt", shortL, longL))
        check("короткое имя уже 150", shortL < 100 ? "да" : "нет", "да")
        check("длинное имя = 150 (обрезка)", String(format: "%.0f", longL), "150")
        check("шаблон «5 с»", WingMath.reserveTemplate("5 с"), "00 с")
        check("шаблон «12 ч 48 мин»", WingMath.reserveTemplate("12 ч 48 мин"), "00 ч 00 мин")
        check("«5 с» и «59 с» одной ширины",
              WingMath.reserveTemplate("5 с") == WingMath.reserveTemplate("59 с") ? "да" : "нет", "да")
        let cw = WingMath.textWidth("3/6", WingMath.countFont)
        let tShort = WingMath.textWidth(WingMath.reserveTemplate("5 с"), WingMath.timeFont)
        let tLong = WingMath.textWidth(WingMath.reserveTemplate("12 ч 48 мин"), WingMath.timeFont)
        let (m1, w1) = WingMath.right(countWidth: cw, timeWidth: tShort, avail: nil)
        let (m2, w2) = WingMath.right(countWidth: cw, timeWidth: tLong, avail: nil)
        print(String(format: "     правое: «3/6 5 с» = %.0f pt, «3/6 12 ч 48 мин» = %.0f pt", w1, w2))
        check("правое «5 с»: справа, 50..90 pt", m1 == .right && w1 >= 50 && w1 <= 90 ? "да" : "нет", "да")
        check("правое «12 ч 48 мин»: справа, шире, ≤130 pt", m2 == .right && w2 > w1 && w2 <= 130 ? "да" : "нет", "да")
        let (m3, w3) = WingMath.right(countWidth: cw, timeWidth: tLong, avail: w2)
        check("места ровно на счёт и время -> справа", "\(m3.rawValue) \(Int(w3))", "right \(Int(w2))")
        let (m4, w4) = WingMath.right(countWidth: cw, timeWidth: tLong, avail: w2 - 1)
        check("на 1 pt меньше -> счёт и время слева, правого крыла нет", "\(m4.rawValue) \(Int(w4))", "left 0")
        let (m5, _) = WingMath.right(countWidth: cw, timeWidth: tLong, avail: 33)
        check("33 pt, как у владельца -> слева", m5.rawValue, "left")
        let stats = WingMath.statsWidth(countWidth: cw, timeWidth: tLong)
        let leftWithStats = WingMath.leftWidth(nameWidth: 1000, stats: stats)
        check("слева: имя ≤ прежнего предела, счёт и время целиком",
              leftWithStats == ceil(WingMath.maxLeft + WingMath.nameCountGap + stats) ? "да" : "нет (\(leftWithStats))", "да")
        check("предел имени = 107 pt", String(format: "%.0f", WingMath.maxName), "107")

        var L = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true)
        var c = Demo.snapshot(now: gen).cards[0]
        c.done = 3; c.total = 6
        WingMath.apply(to: &L, card: c, timeText: "22 мин", iconLimitX: 1090)
        check("значок с x=1090: справа, край крыла ≤ 1084",
              L.rightMode == .right && L.notchMaxX + L.rightW <= 1084 ? "да" : "нет (\(L.notchMaxX + L.rightW))", "да")
        var L2 = L
        WingMath.apply(to: &L2, card: c, timeText: "22 мин", iconLimitX: 995)
        check("значок с x=995: счёт и время слева, справа ничего",
              L2.rightMode == .left && L2.rightW == 0 && L2.leftW > 150 ? "да" : "нет", "да")
        var L3 = L
        let s5 = Fmt.duration(ms: 5_000), s59 = Fmt.duration(ms: 59_000)
        WingMath.apply(to: &L3, card: c, timeText: s5, iconLimitX: 995)
        let wA = L3.leftW
        WingMath.apply(to: &L3, card: c, timeText: s59, iconLimitX: 995)
        check("5 с -> 59 с: ширина слева не меняется", wA == L3.leftW ? "да" : "нет", "да")
        check("панель с счётом слева той же ширины, что без него",
              L2.expandedWidth == L.expandedWidth ? "да" : "нет (\(L2.expandedWidth) vs \(L.expandedWidth))", "да")
        check("панель шире полоски и по центру выреза",
              L.expandedMinX <= L.collapsedMinX && L.expandedMinX + L.expandedWidth >= L.collapsedMinX + L.collapsedWidth
                && abs(L.expandedMinX + L.expandedWidth / 2 - L.notchCenterX) < 0.5 ? "да" : "нет", "да")

        print("Формы слов:")
        for (n, want) in [(1, "1 тред"), (2, "2 треда"), (4, "4 треда"), (5, "5 тредов"), (11, "11 тредов"),
                          (12, "12 тредов"), (21, "21 тред"), (22, "22 треда"), (25, "25 тредов"), (111, "111 тредов"), (0, "0 тредов")] {
            check("тред \(n)", Fmt.threads(n), want)
        }
        for (n, want) in [(0, "0 задач"), (1, "1 задача"), (2, "2 задачи"), (4, "4 задачи"), (5, "5 задач"), (11, "11 задач"),
                          (14, "14 задач"), (21, "21 задача"), (22, "22 задачи"), (43, "43 задачи"), (101, "101 задача"), (112, "112 задач")] {
            check("задача \(n)", Fmt.tasks(n), want)
        }
        check("ещё 10 тикетов", Fmt.moreTickets(10), "ещё 10 тикетов")
        check("ещё 1 тикет", Fmt.moreTickets(1), "ещё 1 тикет")
        check("ещё 3 тикета", Fmt.moreTickets(3), "ещё 3 тикета")

        print("Шапка панели: одна строка без итога:")
        let demo = Demo.snapshot(now: gen).cards
        let dThoughts = Calm.thoughts(cards: demo, summary: Demo.snapshot(now: gen).totals)
        check("демо: мысли по кругу — два работающих треда", "\(dThoughts.count)", "2")
        check("в мыслях нет итога «тредов · в работе · задач»",
              dThoughts.contains { $0.contains("сейчас в работе") || $0.contains("тредов") } ? "есть" : "нет", "нет")
        check("смена раз в 6 с: номер мысли в 0,5 / 6,1 / 12,2 с",
              "\(Calm.thoughtIndex(at: 0.5, count: 2)) \(Calm.thoughtIndex(at: 6.1, count: 2)) \(Calm.thoughtIndex(at: 12.2, count: 2))", "0 1 0")
        check("строка заголовка 14–15 pt, ниже прежней (46 pt)",
              PanelMath.thoughtSize >= 14 && PanelMath.thoughtSize <= 15 && PanelMath.robotRowH < 46 ? "да (\(PanelMath.thoughtSize) pt, высота \(Int(PanelMath.robotRowH)))" : "нет",
              "да (\(PanelMath.thoughtSize) pt, высота \(Int(PanelMath.robotRowH)))")
        let oldSum = """
        {"version":2,"summary":{"projectsWorking":1,"projects":3,"threads":3,"threadsWorking":1,"threadsWaiting":0,"threadsError":0,"done":5,"total":9},
        "generatedAt":1700000000000,"cards":[{"threadId":"t1","project":"P","title":"T","planTitle":"PL",
        "done":2,"total":6,"remaining":4,"current":null,"state":"working","workMs":1000,"runningSince":null,"updatedAt":1},
        {"threadId":"t2","project":"Q","title":"T","planTitle":"PL","done":3,"total":3,"remaining":0,"current":null,"state":"done","workMs":1,"runningSince":null,"updatedAt":1}]}
        """
        let os = try? Snapshot.decode(oldSum.data(using: .utf8)!)
        check("summary без tasksInWorking: посчитано по работающим карточкам",
              os.map { "\($0.totals.tasksInWorking ?? -1)/\($0.totals.doneInWorking ?? -1)" } ?? "ошибка", "6/2")

        print("Значок проекта:")
        for (name, want) in [("Global GG AI", "GG"), ("Ostrov Stats", "OS"), ("Инвестиции в медцентры", "ИМ"), ("TUMEO", "TU"),
                             ("ostrov-stats", "OS"), ("Яндекс Директ", "ЯД"), ("", "?"), ("   ", "?"), ("в", "В"),
                             ("Остров Здоровья — сайт клиники", "ОЗ"), ("bb-plugin-touchbar", "PT")] {
            check("буквы «\(name)»", Badge.letters(name), want)
        }
        check("цвет устойчив", Badge.colorIndex("Global GG AI") == Badge.colorIndex("Global GG AI") ? "да" : "нет", "да")
        check("цвет устойчив между запусками (FNV)", "\(Badge.colorIndex("Global GG AI")) \(Badge.colorIndex("Ostrov Stats")) \(Badge.colorIndex("TUMEO"))",
              "\(Badge.colorIndex("Global GG AI")) \(Badge.colorIndex("Ostrov Stats")) \(Badge.colorIndex("TUMEO"))")
        let names = ["Global GG AI", "Ostrov Stats", "TUMEO", "Инвестиции в медцентры", "Яндекс Директ", "bb-plugin-touchbar"]
        print("     цвета: " + names.map { "\($0)=\(Badge.colorIndex($0))" }.joined(separator: ", "))
        check("в наборе 8 цветов, индекс в пределах", names.allSatisfy { (0..<8).contains(Badge.colorIndex($0)) } && Badge.palette.count == 8 ? "да" : "нет", "да")
        check("разные проекты получают не один цвет", Set(names.map(Badge.colorIndex)).count >= 4 ? "да" : "нет", "да")

        print("Дорожка задач:")
        let wDemo = demo[0]   // 6 tickets in 2 queues
        let tl = TrackMath.layout(wDemo, width: 400)
        check("демо: блоков по числу задач", "\(tl.blocks) \(tl.solid)", "6 false")
        check("цвета по статусам в порядке плана", tl.pieces.map { $0.kind.rawValue }.joined(separator: " "),
              "done skipped active review error pending")
        let w0 = tl.pieces[0].w
        check("блоки одной ширины", tl.pieces.allSatisfy { abs($0.w - w0) < 0.001 } ? "да" : "нет", "да")
        check("зазор в очереди 2,5 pt", String(format: "%.1f", tl.pieces[1].x - tl.pieces[0].x - w0), "2.5")
        check("между очередями шире", String(format: "%.1f", tl.pieces[3].x - tl.pieces[2].x - w0), "7.0")
        check("правый край = ширина", String(format: "%.1f", tl.pieces.last!.x + tl.pieces.last!.w), "400.0")
        let long = Demo.longCard(tickets: 60, now: gen)
        let ll = TrackMath.layout(long, width: 440)
        let llEnd = ll.pieces.last.map { $0.x + $0.w } ?? 0
        check("60 задач в 440 pt -> сплошная полоса", "\(ll.solid) \(ll.blocks)", "true 0")
        check("полоса не шире строки", String(format: "%.1f", llEnd), "440.0")
        let lc = long.stages!.flatMap { $0.tickets }
        let doneShare = CGFloat(lc.filter { $0.status == .done }.count) / 60 * 440
        check("доля зелёного по числу сделанных", String(format: "%.1f", ll.pieces.first { $0.kind == .done }?.w ?? 0), String(format: "%.1f", doneShare))
        let l20 = TrackMath.layout(Demo.longCard(tickets: 20, now: gen), width: 400)
        check("20 задач в 400 pt -> блоки", "\(l20.solid) \(l20.blocks)", "false 20")
        check("блок не уже порога", (l20.pieces.map { $0.w }.min() ?? 0) >= TrackMath.minBlock ? "да" : "нет", "да")
        let l40 = TrackMath.layout(Demo.longCard(tickets: 40, now: gen), width: 440)
        check("40 задач в 440 pt -> блоки (≥ 5 pt)", "\(l40.solid) \(l40.blocks)", "false 40")
        let oldCard = demo[4]   // no stages
        let lo = TrackMath.layout(oldCard, width: 300)
        check("старая сводка без списка -> полоса", "\(lo.solid) \(lo.pieces.map { $0.kind.rawValue }.joined(separator: " "))", "true pending")
        var oc2 = oldCard; oc2.done = 3; oc2.total = 4
        let lo2 = TrackMath.layout(oc2, width: 300)
        check("старая сводка 3/4 -> зелёная доля 225 pt", lo2.pieces.map { "\($0.kind.rawValue):\(Int($0.w))" }.joined(separator: " "), "done:225 pending:75")
        var hid = demo[5]   // 4 listed + 10 hidden, all done
        let lh = TrackMath.layout(hid, width: 400)
        check("скрытые лимитом задачи в дорожке", "\(lh.blocks) \(lh.pieces.filter { $0.kind == .done }.count)", "14 14")
        hid.done = 6
        check("скрытые: сделанных по счёту карточки", "\(TrackMath.layout(hid, width: 400).pieces.filter { $0.kind == .done }.count)", "6")
        check("пустые очереди не дают блоков", TrackMath.groups(SnapshotCard(threadId: "x", project: "p", title: "", planTitle: "", done: 0, total: 0,
              remaining: 0, current: nil, state: .idle, workMs: 0, runningSince: nil, updatedAt: 0, stages: [SnapshotStage(name: "a", tickets: [])])) == nil ? "нет блоков" : "есть", "нет блоков")
        check("легенда: без сбоя", TrackLegend.kinds(demo[1]).map { $0.legend }.joined(separator: ", "), "сделано, делается, на проверке, в очереди")
        check("легенда: сбой есть в плане", TrackLegend.kinds(demo[3]).map { $0.legend }.joined(separator: ", "), "сделано, делается, на проверке, в очереди, сбой")

        print("Время на задачу:")
        var tc = demo[0]
        tc.runningSince = gen - 120_000
        let act = SnapshotTicket(title: "A", status: .active, owner: "Opus 5.5", startedAt: gen - 600_000, doneAt: nil, workMs: 300_000)
        // Local clock 7 s behind the server, as in the turn test above.
        check("активная: workMs + (сейчас − runningSince)", Fmt.duration(ms: RowText.ticketMs(act, card: tc, serverNow: local + offset) ?? -1), "7 мин")
        var act2 = act; act2.startedAt = gen - 30_000
        check("активная, начата позже хода: от startedAt", Fmt.duration(ms: RowText.ticketMs(act2, card: tc, serverNow: gen + 60_000) ?? -1), "6 мин")
        var tcIdle = tc; tcIdle.runningSince = nil
        check("активная, хода нет: только workMs", Fmt.duration(ms: RowText.ticketMs(act, card: tcIdle, serverNow: gen + 999_999) ?? -1), "5 мин")
        let fin = SnapshotTicket(title: "B", status: .done, owner: "Sonnet 5.5", startedAt: gen - 900_000, doneAt: gen - 400_000, workMs: 480_000)
        check("завершённая: только workMs, ход не прибавляется", Fmt.duration(ms: RowText.ticketMs(fin, card: tc, serverNow: gen + 999_999) ?? -1), "8 мин")
        check("справа у задачи: время и исполнитель", RowText.ticketRight(fin, card: tc, serverNow: gen) ?? "nil", "8 мин · Sonnet 5.5")
        let noTime = SnapshotTicket(title: "C", status: .done, owner: "Haiku 5.5")
        check("старая сводка без workMs: времени нет", "\(RowText.ticketMs(noTime, card: tc, serverNow: gen) == nil) \(RowText.ticketRight(noTime, card: tc, serverNow: gen) ?? "nil")", "true Haiku 5.5")
        let pend = SnapshotTicket(title: "D", status: .pending, owner: nil, startedAt: nil, doneAt: nil, workMs: 0)
        check("не начатая: ни времени, ни исполнителя", RowText.ticketRight(pend, card: tc, serverNow: gen) ?? "nil", "nil")
        let jsonT = """
        {"title":"X","status":"done","owner":null,"startedAt":1700000000000,"doneAt":1700000480000,"workMs":480000}
        """
        let dt = try? JSONDecoder().decode(SnapshotTicket.self, from: jsonT.data(using: .utf8)!)
        check("разбор полей тикета", dt.map { "\(Int($0.startedAt ?? 0)) \(Int($0.doneAt ?? 0)) \(Int($0.workMs ?? 0))" } ?? "ошибка",
              "1700000000000 1700000480000 480000")
        let dtNull = try? JSONDecoder().decode(SnapshotTicket.self, from: #"{"title":"X","status":"pending","owner":null,"startedAt":null,"doneAt":null,"workMs":0}"#.data(using: .utf8)!)
        check("null в полях тикета", dtNull.map { "\($0.startedAt == nil) \($0.doneAt == nil) \(Int($0.workMs ?? -1))" } ?? "ошибка", "true true 0")

        print("Что делается сейчас (вторая линия строки):")
        func now2(_ c: SnapshotCard) -> String { let r = RowText.now(c); return "\(r.tone.rawValue): \(r.text)" }
        check("работает: текущая задача", now2(demo[0]), "primary: Полоска у выреза камеры")
        var noCur = demo[0]; noCur.current = nil
        check("работает без задачи: план", now2(noCur), "secondary: Touch Bar у выреза")
        check("работает: время на задачу", RowText.currentTicket(demo[0]).flatMap { RowText.ticketTime($0, card: demo[0], serverNow: gen) } ?? "nil", "7 мин")
        var paused = demo[1]; paused.state = .idle
        check("пауза: следующая", now2(paused), "secondary: Пауза · следующая: Расписание врачей из МИС")
        check("пауза без списка", now2(demo[4]), "secondary: Пауза")
        check("ждёт: примечание", RowText.now(demo[1]).text.hasPrefix("Ждёт ответа: Нужен ответ: какие филиалы") ? "да" : RowText.now(demo[1]).text, "да")
        var waitNoNote = demo[1]; waitNoNote.note = nil
        check("ждёт без примечания: проект", now2(waitNoNote), "waiting: Ждёт ответа: \(demo[1].project)")
        check("ошибка", now2(demo[3]), "error: Ошибка: Метрика ответила 403: у токена нет доступа к счётчику")
        check("готово", now2(demo[5]), "done: Готово")

        print("Фильтры:")
        check("демо: счётчики", CardFilter.allCases.map { "\($0.title) \($0.count(demo))" }.joined(separator: ", "), "Все 6, Работают 2, Пауза 4")
        check("«Пауза» = все, кто не работает", demo.filter(CardFilter.idle.matches).map { $0.state.rawValue }.joined(separator: " "),
              "waiting error idle done")
        check("один тред -> ряда нет", CardFilter.rowVisible([demo[1]]) ? "есть" : "нет", "нет")
        check("два треда -> ряд есть", CardFilter.rowVisible([demo[0], demo[2]]) ? "есть" : "нет", "есть")
        check("все работают -> «Пауза» пуст, выбрать нельзя", CardFilter.selectable(.idle, cards: [demo[0], demo[2]]) ? "можно" : "нельзя", "нельзя")
        let m = AppModel()
        m.staticRender = true
        m.apply(Demo.snapshot(now: gen))
        m.setFilter(.idle)
        check("фильтр «Пауза» на демо", "\(m.filter.rawValue) \(m.visibleCards.count)", "idle 4")
        var onlyWork = Demo.snapshot(now: gen + 1)
        onlyWork.cards = onlyWork.cards.filter { $0.state == .working }
        onlyWork.summary = nil
        m.expandedId = "demo-waiting-2"
        m.apply(onlyWork)
        check("остались только работающие -> «Все», раскрытая строка забыта", "\(m.filter.rawValue) \(m.expandedId ?? "nil")", "all nil")
        m.setFilter(.idle)
        check("пустой фильтр не выбирается", m.filter.rawValue, "all")
        var Ld = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true, screenH: 1117)
        CalmMath.apply(to: &Ld, summary: Demo.snapshot(now: gen).totals, iconLimitX: nil)
        Ld.headerMinW = PanelMath.preferredWidth
        let fbw = PanelMath.filterButtonWidth(Ld)
        print(String(format: "     панель %.0f pt, кнопка фильтра %.0f pt", Ld.expandedWidth, fbw))
        check("три кнопки во всю ширину (±2 pt)", abs(3 * fbw + 2 * PanelMath.filterGap + 2 * PanelMath.sidePad - Ld.expandedWidth) <= 2 ? "да" : "нет", "да")
        check("панель 480..500 pt", Ld.expandedWidth >= 480 && Ld.expandedWidth <= 500 ? "да" : "нет (\(Ld.expandedWidth))", "да")
        check("шестерёнка помещается справа от выреза",
              PanelMath.headerButton + PanelMath.headerPad <= PanelMath.sideWidth(Ld) ? "да" : "нет", "да")

        print("Прогноз:")
        check("12 мин", Fmt.eta(ms: 12 * 60_000), "≈ 12 мин до конца")
        check("40 с", Fmt.eta(ms: 40_000), "меньше минуты до конца")
        check("ровно минута", Fmt.eta(ms: 60_000), "≈ 1 мин до конца")
        check("2 ч 5 мин", Fmt.eta(ms: 125 * 60_000), "≈ 2 ч 5 мин до конца")

        print("Разбор сводки версии 2:")
        let json2 = """
        {"version":2,"generatedAt":1700000000000,"cards":[{"threadId":"t1","project":"P","title":"T","planTitle":"PL",
        "done":2,"total":6,"remaining":4,"current":null,"state":"working","workMs":1000,"runningSince":null,"updatedAt":1,
        "note":"Почему стоит","etaMs":720000,"hiddenTickets":3,
        "stages":[{"name":"Очередь 1","tickets":[{"title":"A","status":"done","owner":"Sonnet 5.5"},
        {"title":"B","status":"blocked","owner":null},{"status":"active"}]}]}]}
        """
        let p2 = (try? Snapshot.decode(json2.data(using: .utf8)!))
        let c2 = p2?.cards.first
        check("version/note/eta/hidden", c2.map { "\(p2?.version ?? 0) \($0.note ?? "-") \(Int($0.etaMs ?? 0)) \($0.hiddenTickets ?? -1)" } ?? "ошибка",
              "2 Почему стоит 720000 3")
        check("тикеты: неизвестный статус -> pending, без названия не роняет",
              c2?.stages?.first?.tickets.map { "\($0.title.isEmpty ? "_" : $0.title):\($0.status.rawValue):\($0.owner ?? "-")" }.joined(separator: " ") ?? "ошибка",
              "A:done:Sonnet 5.5 B:pending:- _:active:-")
        check("старая сводка: новых полей нет",
              parsed.map { "\($0.note == nil) \($0.etaMs == nil) \($0.stages == nil) \($0.hiddenTickets == nil)" } ?? "ошибка",
              "true true true true")
        let dOld = PanelMath.Details(card: parsed!, width: 300)
        check("старая сводка: подпись про обновление плагина", dOld.hasTickets ? "список" : "подпись", "подпись")

        print("Высота панели:")
        for screenH in [1117.0, 982.0, 900.0] {
            var Lh = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: CGFloat(screenH), hasNotch: true, screenH: CGFloat(screenH))
            let mm = AppModel()
            mm.staticRender = true
            var snap = Demo.snapshot(now: gen)
            snap.cards.insert(Demo.longCard(tickets: 60, hidden: 5, now: gen), at: 1)
            mm.apply(snap)
            mm.expandedId = "demo-long-60"
            CalmMath.apply(to: &Lh, summary: mm.totals, iconLimitX: nil)
            Lh.headerMinW = PanelMath.preferredWidth
            let content = PanelMath.contentHeight(all: mm.cards, visible: mm.visibleCards, expandedId: mm.expandedId, layout: Lh)
            let h = mm.panelHeight(Lh)
            print(String(format: "     экран %.0f pt: содержимое %.0f pt, панель %.0f pt, 70%% экрана = %.0f pt", screenH, content, h, screenH * 0.7))
            check("60 тикетов, экран \(Int(screenH)): панель ≤ 70% экрана", h <= CGFloat(screenH) * 0.7 ? "да" : "нет", "да")
            check("60 тикетов, экран \(Int(screenH)): содержимое длиннее -> прокрутка", content > h ? "да" : "нет", "да")
            mm.expandedId = nil
            let hShort = mm.panelHeight(Lh)
            check("строка свёрнута, экран \(Int(screenH)): панель ниже", hShort < h || h == PanelMath.maxHeight(Lh) ? "да" : "нет", "да")
        }
        // A tall screen: the 70% cap must not cut the open row here.
        var Ls = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1600, hasNotch: true, screenH: 1600)
        let ms = AppModel()
        ms.staticRender = true
        ms.apply(Demo.snapshot(now: gen))
        CalmMath.apply(to: &Ls, summary: ms.totals, iconLimitX: nil)
        let h0 = ms.panelHeight(Ls)
        ms.expandedId = "demo-working-1"
        let h1 = ms.panelHeight(Ls)
        let d1 = PanelMath.Details(card: ms.cards[0], width: PanelMath.detailsWidth(Ls))
        print(String(format: "     демо: панель %.0f pt, со строкой 0 раскрытой %.0f pt (подробности %.0f pt)", h0, h1, d1.height))
        check("раскрытие строки растит панель ровно на подробности", abs(h1 - h0 - d1.height) < 0.5 ? "да" : "нет", "да")
        let longNote = PanelMath.noteLines(String(repeating: "очень длинное примечание ", count: 20), width: 300)
        check("примечание не длиннее двух строк", "\(longNote)", "2")
        check("короткое примечание в одну строку", "\(PanelMath.noteLines("Коротко", width: 300))", "1")

        // MARK: calm mode and robot (ticket 1)
        print("Спокойный режим: слово «проект»:")
        for (n, want) in [(0, "0 проектов"), (1, "1 проект"), (2, "2 проекта"), (4, "4 проекта"), (5, "5 проектов"),
                          (11, "11 проектов"), (21, "21 проект"), (22, "22 проекта"), (25, "25 проектов")] {
            check("проект \(n)", Calm.projects(n), want)
        }
        func S(_ pw: Int, w: Int = 0, q: Int = 0, e: Int = 0, done: Int = 10, total: Int = 20) -> SnapshotSummary {
            SnapshotSummary(projectsWorking: pw, projects: 3, threads: 5, threadsWorking: w, threadsWaiting: q,
                            threadsError: e, done: done, total: total)
        }
        print("Подпись при нуле работающих:")
        check("2 проекта в работе", Calm.label(S(2, w: 3)).text, "2 проекта")
        check("ноль, один ждёт", Calm.label(S(0, q: 1)).text, "ждёт ответа")
        check("ноль, ждёт и ошибка -> «ждёт ответа»", Calm.label(S(0, q: 1, e: 1)).text, "ждёт ответа")
        check("ноль, ошибка", Calm.label(S(0, e: 1)).text, "ошибка")
        check("ноль, все на паузе", Calm.label(S(0)).text, "пауза")
        check("ноль, все готовы", Calm.label(S(0, done: 20, total: 20)).text, "пауза")
        print("Приоритет настроений:")
        check("ошибка + ждёт + работа", Mood.from(S(1, w: 1, q: 1, e: 1)).rawValue, "upset")
        check("ждёт + работа", Mood.from(S(1, w: 1, q: 1)).rawValue, "asking")
        check("только работа", Mood.from(S(1, w: 2)).rawValue, "thinking")
        check("все готовы", Mood.from(S(0, done: 20, total: 20)).rawValue, "happy")
        check("пауза", Mood.from(S(0)).rawValue, "sleeping")
        check("пусто (0/0) -> спит", Mood.from(S(0, done: 0, total: 0)).rawValue, "sleeping")
        check("«план готов» поверх «думает»", Mood.from(S(1, w: 1), happyEvent: true).rawValue, "happy")
        check("«план готов» поверх «спрашивает»", Mood.from(S(0, q: 1), happyEvent: true).rawValue, "happy")
        check("«план готов» не поверх «расстроен»", Mood.from(S(0, e: 1), happyEvent: true).rawValue, "upset")
        let mh = AppModel()
        mh.staticRender = true
        mh.apply(Snapshot(generatedAt: gen, cards: [demo[0]]))
        mh.happyUntil = Date().addingTimeInterval(6)
        check("модель: через 1 с после «готово» рад", mh.mood(at: Date().addingTimeInterval(1)).rawValue, "happy")
        check("модель: через 7 с снова думает", mh.mood(at: Date().addingTimeInterval(7)).rawValue, "thinking")

        print("Мысль робота:")
        func mk(_ i: Int, _ st: CardState, cur: String? = nil, upd: Double = 0) -> SnapshotCard {
            var c = demo[i]; c.state = st; c.current = cur; c.updatedAt = upd; return c
        }
        let tw1 = mk(0, .working, cur: "Полоска у выреза камеры", upd: 10)
        check("один работает", Calm.thought(cards: [tw1], summary: SnapshotSummary(cards: [tw1]), at: 0), "Думаю над: Полоска у выреза камеры")
        let tw0 = mk(0, .working, cur: nil, upd: 10)
        check("без текущего тикета", Calm.thought(cards: [tw0], summary: SnapshotSummary(cards: [tw0]), at: 0), "Работаю над планом: Touch Bar у выреза")
        let tw2 = mk(2, .working, cur: "Выпуск с миграциями", upd: 20)
        let two = [tw1, tw2]
        let sTwo = SnapshotSummary(cards: two)
        check("двое: первая мысль — самый свежий", Calm.thought(cards: two, summary: sTwo, at: 0), "Ostrov Stats: Выпуск с миграциями")
        check("двое: через 6 с — следующий", Calm.thought(cards: two, summary: sTwo, at: 6), "Global GG AI: Полоска у выреза камеры")
        check("двое: через 12 с — снова первый", Calm.thought(cards: two, summary: sTwo, at: 12), "Ostrov Stats: Выпуск с миграциями")
        let q1 = [mk(1, .waiting), mk(4, .idle)]
        check("никто не работает, один ждёт", Calm.thought(cards: q1, summary: SnapshotSummary(cards: q1), at: 0),
              "Жду вашего ответа: Остров Здоровья — сайт клиники с очень длинным названием проекта")
        let e1 = [mk(3, .error), mk(4, .idle)]
        check("никто не работает, ошибка", Calm.thought(cards: e1, summary: SnapshotSummary(cards: e1), at: 0), "Что-то сломалось в ostrov-stats")
        let p1 = [mk(4, .idle), mk(2, .idle)]
        check("все на паузе", Calm.thought(cards: p1, summary: SnapshotSummary(cards: p1), at: 0), "Отдыхаю, в работе ничего нет")
        let d1s = [demo[5]]
        check("все готовы", Calm.thought(cards: d1s, summary: SnapshotSummary(cards: d1s), at: 0), "Всё готово")
        check("все готовы -> настроение", Mood.from(SnapshotSummary(cards: d1s)).rawValue, "happy")

        print("Итог по карточкам без summary:")
        let byCards = SnapshotSummary(cards: Demo.cardsOnly(now: gen).cards)
        check("по демо-карточкам", "\(byCards.projectsWorking) \(byCards.projects) \(byCards.threads) \(byCards.threadsWorking) \(byCards.threadsWaiting) \(byCards.threadsError) \(byCards.done)/\(byCards.total)",
              "2 6 6 2 1 1 25/41")
        let noSum = try? Snapshot.decode(json2.data(using: .utf8)!)
        check("сводка без summary: посчитано по карточкам", noSum.map { "\($0.summary == nil) \($0.totals.done)/\($0.totals.total) \($0.totals.projectsWorking)" } ?? "ошибка", "true 2/6 1")
        let json3 = """
        {"version":2,"summary":{"projectsWorking":2,"projects":3,"threads":6,"threadsWorking":3,"threadsWaiting":0,"threadsError":0,"done":50,"total":75},
        "generatedAt":1700000000000,"cards":[{"threadId":"t1","project":"P","title":"T","planTitle":"PL",
        "done":2,"total":6,"remaining":4,"current":null,"state":"working","workMs":1000,"runningSince":null,"updatedAt":1}]}
        """
        let withSum = try? Snapshot.decode(json3.data(using: .utf8)!)
        check("сводка с summary: берётся из плагина", withSum.map { "\($0.totals.projectsWorking) \($0.totals.done)/\($0.totals.total)" } ?? "ошибка", "2 50/75")

        print("Размещение спокойной полоски:")
        var Lc = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true)
        let sDemo = Demo.snapshot(now: gen).totals
        CalmMath.apply(to: &Lc, summary: sDemo, iconLimitX: nil)
        check("значков нет: робот слева, кольцо и счёт справа", "\(Lc.rightMode.rawValue) \(Lc.rightW > 0)", "right true")
        var Lsym = Lc
        CalmMath.apply(to: &Lsym, summary: sDemo, iconLimitX: 995)
        check("переключатель выключен, значок сразу за вырезом: крылья одной ширины",
              Lsym.leftW == Lsym.rightW && Lsym.rightMode == .right && Lsym.rightW > 0 ? "да" : "нет", "да")
        check("полоска симметрична вокруг центра выреза",
              abs((Lsym.notchCenterX - Lsym.collapsedMinX) - (Lsym.collapsedMinX + Lsym.collapsedWidth - Lsym.notchCenterX)) < 0.01 ? "да" : "нет", "да")
        check("крыло не уже содержимого слева и справа",
              Lsym.leftW >= Lsym.leftNameOnlyW && Lsym.rightW >= CalmMath.rightContent(sDemo) ? "да" : "нет", "да")
        check("сообщение при выключенном переключателе по центру выреза",
              abs((BannerMath.minX(Lsym) + BannerMath.maxX(Lsym)) / 2 - Lsym.notchCenterX) < 0.01 && BannerMath.width(Lsym) >= 360 ? "да" : "нет", "да")
        var Lk = Lc
        CalmMath.apply(to: &Lk, summary: sDemo, iconLimitX: nil, keepIcons: true)
        let needRight = Lk.notchMaxX + Lk.rightW
        var Lc2 = Lc
        CalmMath.apply(to: &Lc2, summary: sDemo, iconLimitX: needRight + WingMath.iconGap, keepIcons: true)
        check("места ровно хватает -> справа", Lc2.rightMode.rawValue, "right")
        CalmMath.apply(to: &Lc2, summary: sDemo, iconLimitX: needRight + WingMath.iconGap - 1, keepIcons: true)
        check("на 1 pt меньше -> всё слева, правого крыла нет", "\(Lc2.rightMode.rawValue) \(Int(Lc2.rightW))", "left 0")
        check("всё слева: левое крыло = робот + подпись + кольцо + счёт",
              Lc2.leftW == CalmMath.leftWidth(labelW: Lc2.nameW, stats: Lc2.statsW) && Lc2.leftW > Lk.leftW ? "да" : "нет", "да")
        var Lc3 = Lc
        CalmMath.apply(to: &Lc3, summary: S(2, w: 2, done: 9, total: 75), iconLimitX: nil)
        let wa = Lc3.rightW
        CalmMath.apply(to: &Lc3, summary: S(2, w: 2, done: 46, total: 75), iconLimitX: nil)
        check("9/75 -> 46/75: ширина справа та же (резерв цифр)", wa == Lc3.rightW ? "да" : "нет", "да")
        check("спокойный режим помечен в раскладке", Lc.calm ? "да" : "нет", "да")
        check("панель шире спокойной полоски",
              Lc.expandedMinX <= Lc.collapsedMinX && Lc.expandedMinX + Lc.expandedWidth >= Lc.collapsedMinX + Lc.collapsedWidth ? "да" : "нет", "да")

        // MARK: messages and pinning (ticket 2)
        print("События по двум сводкам:")
        var det = EventDetector()
        func cs(_ states: [(String, CardState)]) -> [SnapshotCard] {
            states.map { id, st in var c = demo[0]; c.threadId = id; c.state = st; return c }
        }
        func ev(_ es: [NoteEvent]) -> String { es.isEmpty ? "нет" : es.map { "\($0.card.threadId):\($0.kind.rawValue)" }.joined(separator: " ") }
        let e0 = det.feed(cs([("a", .working), ("b", .working), ("c", .waiting)]))
        check("первая сводка: событий нет (хотя c ждёт)", ev(e0), "нет")
        let e1x = det.feed(cs([("a", .done), ("b", .waiting), ("c", .waiting)]))
        check("a стал done, b стал waiting, c без изменений", ev(e1x), "a:done b:waiting")
        check("та же сводка ещё раз: повтора нет", ev(det.feed(cs([("a", .done), ("b", .waiting), ("c", .waiting)]))), "нет")
        check("b -> error", ev(det.feed(cs([("a", .done), ("b", .error), ("c", .waiting)]))), "b:error")
        check("c пропал, d появился сразу ждущим: событий нет", ev(det.feed(cs([("a", .done), ("b", .error), ("d", .waiting)]))), "нет")
        check("a снова работает: событий нет", ev(det.feed(cs([("a", .working), ("b", .error), ("d", .waiting)]))), "нет")
        check("a снова done: событие есть", ev(det.feed(cs([("a", .done), ("b", .error), ("d", .waiting)]))), "a:done")
        let line = NoteEvent(kind: .waiting, card: demo[1])
        check("«нужен ответ»: строка 1", line.line1, "Нужен ответ · Остров Здоровья — сайт клиники с очень длинным названием проекта")
        check("«нужен ответ»: строка 2 — примечание плана", line.line2.hasPrefix("Нужен ответ: какие филиалы") ? "примечание" : line.line2, "примечание")
        check("«готово»: строка 2 — заголовок треда", NoteEvent(kind: .done, card: demo[5]).line2, "Кампании на декабрь")

        print("Очередь сообщений:")
        var bq = BannerQueue()
        var droppedAll: [String] = []
        for (i, k) in [EventKind.done, .waiting, .error, .done].enumerated() {
            var c = demo[0]; c.threadId = "e\(i + 1)"
            droppedAll += bq.push(NoteEvent(kind: k, card: c)).map { $0.card.threadId }
        }
        check("4 события подряд -> остались последние 3", bq.items.map { $0.card.threadId }.joined(separator: " "), "e2 e3 e4")
        check("отброшено самое старое", droppedAll.joined(separator: " "), "e1")
        bq.popCurrent()
        check("после показа первого следующий — e3", bq.current?.card.threadId ?? "нет", "e3")

        print("Ширина сообщения:")
        for (label, lim) in [("значков нет", CGFloat?.none), ("значок справа близко", CGFloat(990))] {
            var Lb = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true)
            CalmMath.apply(to: &Lb, summary: sDemo, iconLimitX: lim, keepIcons: true)
            let ok = BannerMath.width(Lb) >= 360 && BannerMath.maxX(Lb) <= Lb.collapsedMinX + Lb.collapsedWidth + 0.01
                && (lim.map { BannerMath.maxX(Lb) <= $0 } ?? true)
            print(String(format: "     %@: полоска x=%.0f..%.0f, сообщение x=%.0f..%.0f (ширина %.0f)", label,
                         Lb.collapsedMinX, Lb.collapsedMinX + Lb.collapsedWidth, BannerMath.minX(Lb), BannerMath.maxX(Lb), BannerMath.width(Lb)))
            check("\(label): ширина ≥ 360, правый край не дальше полоски", ok ? "да" : "нет", "да")
        }
        var Lwide = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true)
        WingMath.apply(to: &Lwide, card: demo[1], timeText: "1 ч 23 мин", iconLimitX: nil)
        check("полоска шире 360 -> сообщение по ширине полоски",
              BannerMath.width(Lwide) == Lwide.collapsedWidth && Lwide.collapsedWidth > 360 ? "да" : "нет (\(Lwide.collapsedWidth))", "да")

        print("Меню:")
        let mp = AppModel()
        mp.staticRender = true
        mp.apply(Demo.snapshot(now: gen))
        mp.layout = mp.computeLayout()
        check("полоска всегда в спокойном режиме", mp.layout.calm ? "да" : "нет", "да")
        check("пункты меню", AppMenu.items(mp).map { $0.label }.joined(separator: " | "),
              "Обновить данные | [x] Сообщать у выреза, когда тред закончил или ждёт ответа | [ ] Звук при таком сообщении | [ ] Не закрывать значки строки меню | --- | Выключить полоску (вернётся после перезагрузки)")
        Prefs.bannersOn = false
        check("сообщения выключены -> звук неактивен", AppMenu.items(mp)[2].label, "[ ] Звук при таком сообщении (неактивен)")
        Prefs.bannersOn = true
        check("переключатель значков по умолчанию выключен", Prefs.keepIcons ? "включён" : "выключен", "выключен")
        AppMenu.items(mp)[3].action()
        check("пункт значков переключает настройку", Prefs.keepIcons ? "включён" : "выключен", "включён")
        check("в меню пункт отмечен", AppMenu.items(mp)[3].label, "[x] Не закрывать значки строки меню")
        Prefs.keepIcons = false
        check("пунктов про закрепление нет", AppMenu.items(mp).contains { $0.title.lowercased().contains("закреп") || $0.title.contains("Спокойный") } ? "есть" : "нет", "нет")
        Prefs.store.set("demo-working-1", forKey: Prefs.legacyStripThreadKey)
        Prefs.forgetStripThread()
        check("старое закрепление удаляется из настроек", Prefs.store.object(forKey: Prefs.legacyStripThreadKey) == nil ? "удалено" : "осталось", "удалено")

        print("Анимация робота в полоске:")
        let changes = (0..<12).reduce(into: [Double]()) { acc, _ in acc.append(RobotFace.nextChange(after: acc.last ?? 0)) }
        print("     смены лица за первые 12: " + changes.map { String(format: "%.2f", $0) }.joined(separator: " "))
        let perSec = Double(changes.count) / (changes.last ?? 1)
        check("смен лица не больше 2 в секунду", perSec <= 2 ? "да (\(String(format: "%.2f", perSec)))" : "нет", "да (\(String(format: "%.2f", perSec)))")
        check("следующая смена всегда позже", zip(changes, changes.dropFirst()).allSatisfy { $0 < $1 } ? "да" : "нет", "да")

        print("Анимация талисмана в полоске:")
        let mch = (0..<8).reduce(into: [Double]()) { acc, _ in acc.append(Mascot.nextChange(after: acc.last ?? 0)) }
        print("     смены кадра: " + mch.map { String(format: "%.2f", $0) }.joined(separator: " "))
        check("талисман меняет кадр только на взглядах (1,5 / 2,7 / 4,2 / 5,4 с)", mch.prefix(4).map { String(format: "%.1f", $0) }.joined(separator: " "), "1.5 2.7 4.2 5.4")
        check("кадры «думает» по кругу", [0.5, 2.0, 3.0, 4.5, 5.7].map { Mascot.frame(.thinking, t: $0).rawValue }.joined(separator: " "), "idle left idle right idle")
        check("кадры настроений", [Mood.asking, .upset, .happy, .sleeping].map { Mascot.frame($0, t: 0.5).rawValue }.joined(separator: " "), "asking upset happy sleeping")
        check("без картинок талисмана — робот (нет idle.png в ресурсах selftest)", Mascot.available ? "талисман" : "робот", Mascot.available ? "талисман" : "робот")

        print("Ширина свёрнутой полоски (демо):")
        var Lold = Layout(notchMinX: 771, notchW: 185, notchH: 32, screenTop: 1117, hasNotch: true)
        var Lnew = Lold
        CalmMath.apply(to: &Lold, summary: sDemo, iconLimitX: nil, metrics: CalmMath.before)
        CalmMath.apply(to: &Lnew, summary: sDemo, iconLimitX: nil)
        let shrink = (1 - Lnew.collapsedWidth / Lold.collapsedWidth) * 100
        let wingShrink = (1 - Lnew.leftW / Lold.leftW) * 100
        print(String(format: "     было %.0f pt (крылья по %.0f), стало %.0f pt (крылья по %.0f): полоска уже на %.1f%%, крылья на %.1f%%",
                     Lold.collapsedWidth, Lold.leftW, Lnew.collapsedWidth, Lnew.leftW, shrink, wingShrink))
        check("полоска уже на 12–20%", shrink >= 12 && shrink <= 20 ? "да" : "нет (\(shrink))", "да")
        check("симметрична", Lnew.leftW == Lnew.rightW ? "да" : "нет", "да")
        let kNew = CalmMath.current
        check("содержимое влезает: робот + подпись + поля = левое крыло",
              Lnew.leftW >= ceil(kNew.outerPad + CalmMath.robotSize + kNew.robotGap + CalmMath.labelWidth("2 проекта") + kNew.innerPad) ? "да" : "нет", "да")
        check("шрифт подписи и счёта не меньше 11 pt", kNew.labelSize >= 11 && kNew.countSize >= 11 ? "да" : "нет", "да")
        check("робот того же размера (19 pt)", "\(Int(CalmMath.robotSize))", "19")

        print("Иконки: адреса и имена:")
        IconStore.shared.cacheEnabled = false
        check("127.0.0.1 разрешён", IconKey.allowedBase("http://127.0.0.1:38886/api/v1/plugins/genidev-project-icons/http/icon")?.absoluteString ?? "nil",
              "http://127.0.0.1:38886/api/v1/plugins/genidev-project-icons/http/icon")
        check("localhost разрешён", IconKey.allowedBase("http://localhost:1/x") != nil ? "да" : "нет", "да")
        check("чужой хост отклонён", IconKey.allowedBase("http://example.com/icon") == nil ? "отклонён" : "принят", "отклонён")
        check("127.0.0.1.evil.com отклонён", IconKey.allowedBase("http://127.0.0.1.evil.com/icon") == nil ? "отклонён" : "принят", "отклонён")
        check("логин в адресе отклонён", IconKey.allowedBase("http://u:p@127.0.0.1/icon") == nil ? "отклонён" : "принят", "отклонён")
        check("file:// отклонён", IconKey.allowedBase("file:///etc/passwd") == nil ? "отклонён" : "принят", "отклонён")
        check("пустой и nil", "\(IconKey.allowedBase("") == nil) \(IconKey.allowedBase(nil) == nil)", "true true")
        let ib = IconKey.allowedBase("http://127.0.0.1:38886/icon?old=1")!
        check("адрес кадра", IconKey.url(base: ib, id: "ball-bear", frame: .left)?.absoluteString ?? "nil", "http://127.0.0.1:38886/icon?id=ball-bear&frame=left")
        check("адрес основной картинки", IconKey.url(base: ib, id: "kitty", frame: .base)?.absoluteString ?? "nil", "http://127.0.0.1:38886/icon?id=kitty")
        for bad in ["../etc", "a/b", "", "-x", "a b", "кот", String(repeating: "a", count: 65), "a.b"] {
            check("id «\(bad.prefix(12))» не годится", IconKey.key(id: bad, frame: .base) == nil && IconKey.url(base: ib, id: bad, frame: .base) == nil ? "не годится" : "годится", "не годится")
        }
        check("имя в кеше", IconKey.cacheName(id: "ball-bear", frame: .happy) ?? "nil", "ball-bear.happy.img")
        check("имя в папке", IconKey.assetName(id: "kitty", frame: .base) ?? "nil", "kitty.webp")
        print("Иконки: ответ сервера:")
        let png1 = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                    isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!.representation(using: .png, properties: [:])!
        func acc(_ st: Int, _ mime: String?, _ d: Data) -> String {
            switch IconKey.accept(status: st, mime: mime, data: d) { case .success: return "принят"; case .failure(let e): return e.description }
        }
        check("PNG 200 image/png", acc(200, "image/png", png1), "принят")
        check("HTML вместо картинки", acc(200, "text/html", Data("<html>".utf8)), "ответ не картинка (text/html)")
        check("image/webp, но внутри текст", acc(200, "image/webp", Data("not an image".utf8)), "картинка не читается")
        check("больше 512 КБ", acc(200, "image/png", Data(count: 600_000)), "больше 512 КБ (600000 байт)")
        check("HTTP 404", acc(404, "text/plain", Data()), "HTTP 404")
        let webp = Data(base64Encoded: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
        check("WebP читается ImageIO", webp.flatMap(IconKey.decode).map { "\($0.width)x\($0.height)" } ?? "нет", "1x1")
        print("Иконки: кадры по состоянию:")
        let full = SnapshotIcon(id: "ball-bear", frames: ["left", "right", "puzzled", "alert", "happy"])
        let bare = SnapshotIcon(id: "armor-hero", frames: [])
        check("работает: прямо 1,6 / влево 0,5 / прямо 0,4 / вправо 0,5",
              [0.0, 1.0, 1.7, 2.0, 2.2, 2.6, 2.9, 3.1].map { IconAnim.workingFrame($0).rawValue }.joined(separator: " "),
              "base base left left base right right base")
        check("состояния -> кадры", [CardState.working, .waiting, .error, .done, .idle].map { IconAnim.shown(full, state: $0, t: 1.8).rawValue }.joined(separator: " "),
              "left puzzled alert happy base")
        check("без кадров -> основной", [CardState.working, .waiting, .error, .done].map { IconAnim.shown(bare, state: $0, t: 1.8).rawValue }.joined(separator: " "),
              "base base base base")
        check("работающей строке нужны три кадра", IconAnim.needed(full, state: .working).map { $0.rawValue }.joined(separator: " "), "base left right")
        print("Иконки: разбор сводки:")
        let jIcons = """
        {"version":2,"iconUrl":"http://127.0.0.1:38886/api/v1/plugins/genidev-project-icons/http/icon","generatedAt":1700000000000,"cards":[
        {"threadId":"t1","project":"P","title":"T","planTitle":"PL","done":1,"total":2,"remaining":1,"current":null,"state":"working","workMs":1,"runningSince":null,"updatedAt":1,
         "icon":{"id":"ball-bear","frames":["left","right"],"chosen":true},
         "stages":[{"name":"","tickets":[{"title":"A","status":"active","owner":"Opus 5.5","agent":"Крестик","agentIcon":{"id":"kitty","frames":[],"chosen":false}},
                                       {"title":"B","status":"pending","owner":null,"agent":null,"agentIcon":null}]}]},
        {"threadId":"t2","project":"Q","title":"T","planTitle":"PL","done":0,"total":1,"remaining":1,"current":null,"state":"idle","workMs":1,"runningSince":null,"updatedAt":1,
         "icon":"сломано"},
        {"threadId":"t3","project":"R","title":"T","planTitle":"PL","done":0,"total":1,"remaining":1,"current":null,"state":"idle","workMs":1,"runningSince":null,"updatedAt":1,
         "icon":{"id":"../../etc","frames":7}}]}
        """
        let si = try? Snapshot.decode(jIcons.data(using: .utf8)!)
        check("iconUrl, icon, agent, agentIcon", si.map { s in
            let t = s.cards[0].stages![0].tickets
            return "\(s.iconUrl != nil) \(s.cards[0].icon?.id ?? "-") \(s.cards[0].icon?.frames.joined(separator: ",") ?? "-") \(t[0].agent ?? "-") \(t[0].agentIcon?.id ?? "-") \(t[1].agent == nil && t[1].agentIcon == nil)"
        } ?? "ошибка", "true ball-bear left,right Крестик kitty true")
        check("кривая иконка не роняет сводку и не годится", si.map { "\($0.cards.count) \($0.cards[1].icon?.usable ?? false) \($0.cards[2].icon?.usable ?? false)" } ?? "ошибка", "3 false false")
        check("иконка исполнителя только с именем", si.map { s in let t = s.cards[0].stages![0].tickets; return "\(TicketLine.agentIcon(t[0])?.id ?? "-") \(TicketLine.agentIcon(t[1])?.id ?? "-")" } ?? "ошибка", "kitty -")
        check("старая сводка: иконок нет", parsed.map { "\($0.icon == nil)" } ?? "ошибка", "true")
        let store = IconStore.shared
        store.resetForTest()
        store.setBase("http://example.com/icon")
        check("чужой хост в сводке: адреса нет", store.base == nil ? "нет" : "есть", "нет")
        check("чужой хост: картинки нет, значок с буквами", store.picture(full, .base) == nil ? "буквы" : "картинка", "буквы")
        check("на чужой хост запросов нет", store.requestedHosts.isEmpty ? "нет" : "\(store.requestedHosts)", "нет")
        store.resetForTest()
        var sIc = Demo.snapshot(now: gen); sIc.iconUrl = "http://127.0.0.1:1/icon"
        var sIc2 = sIc; sIc2.iconUrl = nil
        check("смена iconUrl — новая сводка", Snapshot.sameContent(sIc, sIc2) ? "то же" : "другое", "другое")

        print("Сводка без изменений не перерисовывает:")
        let s1 = Demo.snapshot(now: gen)
        var s2 = s1; s2.generatedAt += 2000
        check("другой generatedAt, те же карточки", Snapshot.sameContent(s1, s2) ? "то же" : "другое", "то же")
        s2.cards[0].done += 1
        check("карточка изменилась", Snapshot.sameContent(s1, s2) ? "то же" : "другое", "другое")

        print("Переименование плагина (genidev-touchbar, запасной touchbar):")
        func miss(_ json: String) -> String { PluginId.isMissing(Data(json.utf8)) ? "нет плагина" : "другое" }
        check("идентификатор по умолчанию", PluginId.current + " / " + PluginId.legacy, "genidev-touchbar / touchbar")
        check("неизвестная команда", miss(#"{"ok":false,"error":{"code":"unknown_command","message":"unknown command 'genidev-touchbar'"}}"#), "нет плагина")
        check("неизвестный плагин у токена", miss(#"{"ok":false,"error":"unknown plugin"}"#), "нет плагина")
        check("сервер не слушает — не повод менять id", miss(#"{"ok":false,"error":{"code":"not_ready"}}"#), "другое")
        check("успешный ответ", miss(#"{"url":"http://127.0.0.1:1/x"}"#), "другое")
        check("не JSON", miss("Error: boom"), "другое")

        print("Подписи по-английски (--lang en):")
        Lang.en = true
        let enDemo = Demo.snapshot(now: gen)
        var texts: [String] = []
        for c in enDemo.cards {
            texts += [c.project, c.title, c.planTitle, c.current ?? "", c.note ?? ""]
            for st in c.stages ?? [] {
                texts.append(st.name)
                for tk in st.tickets { texts.append(tk.title); texts.append(tk.agent ?? "") }
            }
        }
        let cyr = texts.filter { $0.range(of: "[А-Яа-яЁё]", options: .regularExpression) != nil }
        check("демо без кириллицы", cyr.isEmpty ? "да" : cyr.joined(separator: "; "), "да")
        check("время", Fmt.duration(ms: 3_900_000) + ", " + Fmt.duration(ms: 5_000), "1 h 5 min, 5 s")
        check("фильтры", CardFilter.allCases.map { $0.title }.joined(separator: " "), "All Working Paused")
        check("подпись полоски", Calm.label(enDemo.summary!).text + ", " + Calm.projects(1), "2 projects, 1 project")
        check("ещё тикеты", Fmt.moreTickets(1) + ", " + Fmt.moreTickets(10), "1 more ticket, 10 more tickets")
        check("ожидание", RowText.now(enDemo.cards[1]).text.hasPrefix("Waiting for you: ") ? "да" : RowText.now(enDemo.cards[1]).text, "да")
        Lang.en = false
        check("обратно по-русски", CardFilter.all.title, "Все")

        print(failed == 0 ? "ИТОГ: всё прошло" : "ИТОГ: ошибок \(failed)")
        return failed == 0
    }
}
