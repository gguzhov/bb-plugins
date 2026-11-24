import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// icon cut <in.png> <out.png> [size=96]   — hard alpha, trim, square, downscale
// icon sheet <out.png> <cell> <cols> <bg hex> <in...> — contact sheet for review

struct Bitmap { var d: [UInt8]; var w: Int; var h: Int }

func load(_ path: String) -> Bitmap? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let w = img.width, h = img.height
    var d = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &d, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return Bitmap(d: d, w: w, h: h)
}

func save(_ b: Bitmap, _ path: String) -> Bool {
    var d = b.d
    guard let ctx = CGContext(data: &d, width: b.w, height: b.h, bitsPerComponent: 8, bytesPerRow: b.w * 4,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let img = ctx.makeImage(),
          let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { return false }
    CGImageDestinationAddImage(dst, img, nil)
    return CGImageDestinationFinalize(dst)
}

/// Alpha below the threshold becomes fully transparent, the rest fully opaque with its own colour.
func hardAlpha(_ b: inout Bitmap, threshold: Int = 128) {
    for i in 0..<(b.w * b.h) {
        let a = Int(b.d[i * 4 + 3])
        if a < threshold { b.d[i*4] = 0; b.d[i*4+1] = 0; b.d[i*4+2] = 0; b.d[i*4+3] = 0 }
        else {
            for c in 0..<3 { b.d[i*4+c] = UInt8(min(255, Int(b.d[i*4+c]) * 255 / max(a, 1))) }
            b.d[i*4+3] = 255
        }
    }
}

/// Drops specks: opaque regions not connected to the largest one and smaller than 0.2% of the image.
func dropSpecks(_ b: inout Bitmap) {
    let n = b.w * b.h
    var label = [Int32](repeating: 0, count: n)
    var sizes: [Int] = [0]
    var stack: [Int] = []
    for start in 0..<n where b.d[start*4+3] != 0 && label[start] == 0 {
        let id = Int32(sizes.count); var size = 0
        stack.append(start); label[start] = id
        while let p = stack.popLast() {
            size += 1
            let x = p % b.w, y = p / b.w
            for (dx, dy) in [(1,0),(-1,0),(0,1),(0,-1)] {
                let nx = x + dx, ny = y + dy
                if nx < 0 || ny < 0 || nx >= b.w || ny >= b.h { continue }
                let q = ny * b.w + nx
                if b.d[q*4+3] != 0 && label[q] == 0 { label[q] = id; stack.append(q) }
            }
        }
        sizes.append(size)
    }
    let limit = n / 500
    for i in 0..<n where label[i] != 0 && sizes[Int(label[i])] < limit {
        b.d[i*4] = 0; b.d[i*4+1] = 0; b.d[i*4+2] = 0; b.d[i*4+3] = 0
    }
}

func bounds(_ b: Bitmap) -> (x0: Int, y0: Int, x1: Int, y1: Int)? {
    var x0 = b.w, y0 = b.h, x1 = -1, y1 = -1
    for y in 0..<b.h { for x in 0..<b.w where b.d[(y*b.w+x)*4+3] != 0 {
        if x < x0 { x0 = x }; if x > x1 { x1 = x }; if y < y0 { y0 = y }; if y > y1 { y1 = y }
    } }
    return x1 < 0 ? nil : (x0, y0, x1, y1)
}

/// Crop to the drawing, centre it in a square with a margin, scale to `size` with area averaging.
func squareScaled(_ b: Bitmap, size: Int, margin: Double = 0.06) -> Bitmap? {
    guard let r = bounds(b) else { return nil }
    let cw = r.x1 - r.x0 + 1, ch = r.y1 - r.y0 + 1
    let side = Int(Double(max(cw, ch)) * (1 + 2 * margin))
    let ox = r.x0 - (side - cw) / 2, oy = r.y0 - (side - ch) / 2
    var out = Bitmap(d: [UInt8](repeating: 0, count: size * size * 4), w: size, h: size)
    let scale = Double(side) / Double(size)
    for ty in 0..<size { for tx in 0..<size {
        let sx0 = Int(Double(tx) * scale), sx1 = max(sx0 + 1, Int(Double(tx + 1) * scale))
        let sy0 = Int(Double(ty) * scale), sy1 = max(sy0 + 1, Int(Double(ty + 1) * scale))
        var r0 = 0.0, g0 = 0.0, b0 = 0.0, a0 = 0.0, cnt = 0.0
        for sy in sy0..<sy1 { for sx in sx0..<sx1 {
            cnt += 1
            let x = ox + sx, y = oy + sy
            if x < 0 || y < 0 || x >= b.w || y >= b.h { continue }
            let i = (y * b.w + x) * 4
            let a = Double(b.d[i+3]) / 255
            r0 += Double(b.d[i]) * a; g0 += Double(b.d[i+1]) * a; b0 += Double(b.d[i+2]) * a; a0 += a
        } }
        let o = (ty * size + tx) * 4
        let alpha = a0 / cnt
        // The bitmap is premultiplied: store colour times coverage.
        out.d[o] = UInt8(min(255, r0 / cnt)); out.d[o+1] = UInt8(min(255, g0 / cnt)); out.d[o+2] = UInt8(min(255, b0 / cnt))
        out.d[o+3] = UInt8(min(255, alpha * 255))
    } }
    return out
}

func hex(_ s: String) -> (UInt8, UInt8, UInt8) {
    let v = UInt32(s.replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0
    return (UInt8((v >> 16) & 255), UInt8((v >> 8) & 255), UInt8(v & 255))
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { print("usage: icon cut|sheet …"); exit(2) }
if cmd == "cut", args.count >= 3 {
    let size = args.count > 3 ? Int(args[3]) ?? 96 : 96
    guard var b = load(args[1]) else { print("cannot read \(args[1])"); exit(1) }
    hardAlpha(&b); dropSpecks(&b)
    guard let out = squareScaled(b, size: size), save(out, args[2]) else { print("empty or cannot write"); exit(1) }
    if let r = bounds(b) { print("ok \(args[2]) drawing \(r.x1 - r.x0 + 1)x\(r.y1 - r.y0 + 1) of \(b.w)x\(b.h)") }
} else if cmd == "sheet", args.count >= 6 {
    let cell = Int(args[2]) ?? 96, cols = Int(args[3]) ?? 6, bg = hex(args[4]); let files = Array(args[5...])
    let gap = 12, rows = (files.count + cols - 1) / cols
    let W = cols * (cell + gap) + gap, H = rows * (cell + gap) + gap
    var sheet = Bitmap(d: [UInt8](repeating: 255, count: W * H * 4), w: W, h: H)
    for i in 0..<(W * H) { sheet.d[i*4] = bg.0; sheet.d[i*4+1] = bg.1; sheet.d[i*4+2] = bg.2 }
    for (n, f) in files.enumerated() {
        guard let src = load(f) else { continue }
        let cx = gap + (n % cols) * (cell + gap), cy = gap + (n / cols) * (cell + gap)
        for y in 0..<cell { for x in 0..<cell {
            // Nearest neighbour is enough for a review sheet.
            let sx = x * src.w / cell, sy = y * src.h / cell
            let i = (sy * src.w + sx) * 4, o = ((cy + y) * W + cx + x) * 4
            let a = Double(src.d[i+3]) / 255
            for c in 0..<3 { sheet.d[o+c] = UInt8(min(255, Double(src.d[i+c]) + Double(sheet.d[o+c]) * (1 - a))) }
        } }
    }
    print(save(sheet, args[1]) ? "sheet \(args[1]) \(W)x\(H)" : "cannot write sheet")
} else { print("usage: icon cut <in> <out> [size] | icon sheet <out> <cell> <cols> <bg> <in...>"); exit(2) }
