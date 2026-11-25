# Custom mascot

The plugin ships no mascot pictures: without them the app draws its robot.

To use your own mascot, put PNG frames into `~/Library/Application Support/bb-touchbar/mascot/` and restart the app (`native/run.sh restart`). That folder lives outside the plugin, so updates and `uninstall.sh` keep it (`uninstall.sh --purge` removes it).

Lookup order: `--mascot-dir <folder>` (testing), then the user folder above, then `*.png` placed here before a build (`build.sh` copies them into `BBTouchbar.app/Contents/Resources/mascot/`), then the robot. A folder counts only when it has `idle.png`.

Format: PNG 256×256, transparent background, up to 2 MB, at most 2048 px per side.

| File | When it shows |
|---|---|
| `idle.png` | thinking, looking ahead; required |
| `left.png` | thinking, looking left |
| `right.png` | thinking, looking right |
| `asking.png` | a thread waits for your answer |
| `upset.png` | a plan has a failure |
| `happy.png` | a plan has just finished, or all plans are done |
| `sleeping.png` | nobody is working |

A missing frame is replaced by `idle.png`. While thinking, frames cycle: `idle` 1.5 s, `left` 1.2 s, `idle` 1.5 s, `right` 1.2 s, `idle` 0.6 s.

Try your pictures without installing: `BBTouchbar --demo --mascot-dir <folder> --render-png <output folder>`.
