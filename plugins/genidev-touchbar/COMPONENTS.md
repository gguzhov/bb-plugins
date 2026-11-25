# Компоненты

React-компонентов в проекте нет: у плагина нет интерфейса в окне bb. Интерфейс рисует приложение на SwiftUI, его части лежат в `native/Sources/Views.swift`.

| Компонент | Файл | Что рисует |
|---|---|---|
| `MascotFace` | `Robot.swift` | Талисман из картинок, без них робот; везде, где было лицо робота |
| `RobotFace`, `RobotView` | `Robot.swift` | Лицо робота в пяти настроениях (запасное) и его анимация по общим часам |
| `CalmContent` | `Robot.swift` | Свёрнутая полоска: талисман, проекты в работе, кольцо, счёт |
| `RobotRow` | `Robot.swift` | Заголовок панели: талисман и мысль одной строкой |
| `ThreadBadge` | `Icons.swift` | Картинка треда с кадром по состоянию, без неё значок с буквами |
| `AgentIcon` | `Icons.swift` | Маленькая картинка исполнителя в строке задачи |
| `ProjectBadge` | `Track.swift` | Картинка или значок с буквами, метки состояния и бегущая дуга |
| `TrackView`, `TrackLegend` | `Track.swift` | Дорожка блоков по задачам и подписи цветов |
| `RingView` | `Views.swift` | Кольцо доли выполненного |
| `NotchShape` | `Views.swift` | Чёрная фигура полоски со скруглёнными нижними углами |
| `FilterBar` | `Panel.swift` | Три фильтра на всю ширину |
| `CardRow` | `Panel.swift` | Строка треда в панели |
| `TicketDetails`, `TicketLine` | `Panel.swift` | Задачи по очередям в раскрытой строке |
| `BannerContent` | `Events.swift` | Сообщение у выреза |

Расчёты без рисования вынесены в `WingMath`, `PanelMath`, `TrackMath`, `CalmMath`, `BannerMath`, `IconKey`, `IconAnim`, `Mascot` и проверяются флагом `--selftest`. Загрузку и кеш картинок ведёт `IconStore` (`Icons.swift`).
