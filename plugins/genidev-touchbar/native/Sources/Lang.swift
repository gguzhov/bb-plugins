import Foundation

/// UI language. Russian is the app's language; `--lang en` switches the strip and panel labels
/// (and the demo data) to English for renders such as catalog screenshots.
enum Lang {
    nonisolated(unsafe) static var en = false
}

/// The Russian text, or the English one under `--lang en`.
@inline(__always) func L(_ ru: String, _ en: String) -> String { Lang.en ? en : ru }

/// English plural: 1 thread, 2 threads.
func enPlural(_ n: Int, _ one: String, _ many: String) -> String { abs(n) == 1 ? one : many }
