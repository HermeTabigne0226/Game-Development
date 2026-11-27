using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class SpriteProcessor {
    static bool IsMagenta(byte r, byte g, byte b) {
        return r > 155 && b > 155 && g < 125 && (r - g) > 60 && (b - g) > 60;
    }

    static Bitmap KeyMagentaAll(string path) {
        using (var orig = new Bitmap(path)) {
            var bmp = new Bitmap(orig.Width, orig.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp)) {
                g.DrawImage(orig, 0, 0, orig.Width, orig.Height);
            }
            int w = bmp.Width, h = bmp.Height;
            var rect = new Rectangle(0, 0, w, h);
            var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            byte[] buf = new byte[w * h * 4];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);

            for (int i = 0; i < w * h; i++) {
                int p = i * 4;
                byte b = buf[p], gVal = buf[p + 1], r = buf[p + 2];
                if (IsMagenta(r, gVal, b)) {
                    buf[p] = 0; buf[p + 1] = 0; buf[p + 2] = 0; buf[p + 3] = 0;
                }
            }

            // Defringe 1px magenta halo adjacent to transparent pixels
            var clearList = new List<int>();
            for (int y = 1; y < h - 1; y++) {
                for (int x = 1; x < w - 1; x++) {
                    int idx = y * w + x;
                    int p = idx * 4;
                    if (buf[p + 3] == 0) continue;
                    byte b = buf[p], gVal = buf[p + 1], r = buf[p + 2];
                    if (r > 120 && b > 120 && gVal < 130 && (r - gVal) > 35 && (b - gVal) > 35) {
                        if (buf[(y * w + (x + 1)) * 4 + 3] == 0 ||
                            buf[(y * w + (x - 1)) * 4 + 3] == 0 ||
                            buf[((y + 1) * w + x) * 4 + 3] == 0 ||
                            buf[((y - 1) * w + x) * 4 + 3] == 0) {
                            clearList.Add(idx);
                        }
                    }
                }
            }
            foreach (int idx in clearList) {
                int p = idx * 4;
                buf[p] = 0; buf[p + 1] = 0; buf[p + 2] = 0; buf[p + 3] = 0;
            }

            Marshal.Copy(buf, 0, data.Scan0, buf.Length);
            bmp.UnlockBits(data);
            return bmp;
        }
    }

    static List<int[]> FindCharacterSpans(Bitmap bmp) {
        int w = bmp.Width, h = bmp.Height;
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[w * h * 4];
        Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(data);

        int[] colCounts = new int[w];
        for (int x = 0; x < w; x++) {
            int c = 0;
            for (int y = 0; y < h; y++) {
                if (buf[(y * w + x) * 4 + 3] > 25) c++;
            }
            colCounts[x] = c;
        }

        int[][] windows = new int[][] {
            new int[] { (int)(w * 0.22), (int)(w * 0.35) },
            new int[] { (int)(w * 0.44), (int)(w * 0.58) },
            new int[] { (int)(w * 0.70), (int)(w * 0.84) }
        };
        int[] splits = new int[5];
        splits[0] = 0;
        splits[4] = w;
        for (int s = 0; s < 3; s++) {
            int bestX = windows[s][0];
            int bestC = int.MaxValue;
            for (int x = windows[s][0]; x <= windows[s][1]; x++) {
                if (colCounts[x] < bestC) {
                    bestC = colCounts[x];
                    bestX = x;
                }
            }
            splits[s + 1] = bestX;
        }

        var spans = new List<int[]>();
        for (int i = 0; i < 4; i++) {
            spans.Add(new int[] { splits[i], splits[i + 1] });
        }
        return spans;
    }

    static Rectangle GetOpaqueBounds(Bitmap bmp, int x0, int x1) {
        int w = bmp.Width, h = bmp.Height;
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[w * h * 4];
        Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(data);

        int minX = x1, maxX = x0, minY = h, maxY = 0;
        for (int y = 0; y < h; y++) {
            for (int x = x0; x < x1; x++) {
                if (buf[(y * w + x) * 4 + 3] > 20) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < minX || maxY < minY) return new Rectangle(x0, 0, Math.Max(1, x1 - x0), h);
        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    public static void ProcessEnemy(string src, string dst, int size) {
        using (var keyed = KeyMagentaAll(src)) {
            var b = GetOpaqueBounds(keyed, 0, keyed.Width);
            using (var outBmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(outBmp)) {
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                int pad = (int)(size * 0.06);
                int avail = size - pad * 2;
                float scale = Math.Min((float)avail / b.Width, (float)avail / b.Height);
                int dw = Math.Max(1, (int)Math.Round(b.Width * scale));
                int dh = Math.Max(1, (int)Math.Round(b.Height * scale));
                int dx = (size - dw) / 2;
                int dy = size - pad - dh;
                g.DrawImage(keyed, new Rectangle(dx, dy, dw, dh), b, GraphicsUnit.Pixel);
                outBmp.Save(dst, ImageFormat.Png);
            }
        }
    }

    public static void ProcessSheet(string src, string dst, int[] frameOrder, int cellSize) {
        using (var keyed = KeyMagentaAll(src)) {
            int w = keyed.Width, h = keyed.Height;
            var rect = new Rectangle(0, 0, w, h);
            var data = keyed.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] buf = new byte[w * h * 4];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);
            keyed.UnlockBits(data);

            int[] labels = new int[w * h];
            var compBounds = new List<int[]>(); // [minX, minY, maxX, maxY, count]
            var q = new Queue<int>();
            int curLabel = 0;

            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int idx = y * w + x;
                    if (labels[idx] != 0 || buf[idx * 4 + 3] <= 20) continue;
                    curLabel++;
                    labels[idx] = curLabel;
                    q.Enqueue(idx);
                    int minX = x, maxX = x, minY = y, maxY = y, cnt = 0;
                    while (q.Count > 0) {
                        int c = q.Dequeue();
                        cnt++;
                        int cx = c % w, cy = c / w;
                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;
                        for (int dy = -1; dy <= 1; dy++) {
                            for (int dx = -1; dx <= 1; dx++) {
                                if (dx == 0 && dy == 0) continue;
                                int nx = cx + dx, ny = cy + dy;
                                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                    int nIdx = ny * w + nx;
                                    if (labels[nIdx] == 0 && buf[nIdx * 4 + 3] > 20) {
                                        labels[nIdx] = curLabel;
                                        q.Enqueue(nIdx);
                                    }
                                }
                            }
                        }
                    }
                    compBounds.Add(new int[] { minX, minY, maxX, maxY, cnt, curLabel });
                }
            }

            // Pick the 4 largest connected components (the 4 character bodies) sorted left-to-right
            var bodies = new List<int[]>(compBounds);
            bodies.Sort((a, b) => b[4].CompareTo(a[4]));
            if (bodies.Count > 4) bodies = bodies.GetRange(0, 4);
            bodies.Sort((a, b) => ((a[0] + a[2]) / 2).CompareTo((b[0] + b[2]) / 2));

            // Assign every component (including detached bowstrings/arrows) to nearest body center X
            int[] compOwner = new int[curLabel + 1];
            foreach (var comp in compBounds) {
                if (comp[4] < 12) { compOwner[comp[5]] = -1; continue; } // ignore 1-11px noise
                int cx = (comp[0] + comp[2]) / 2;
                int bestBody = 0;
                int bestDist = int.MaxValue;
                for (int bIdx = 0; bIdx < bodies.Count; bIdx++) {
                    int bx = (bodies[bIdx][0] + bodies[bIdx][2]) / 2;
                    int d = Math.Abs(cx - bx);
                    if (d < bestDist) { bestDist = d; bestBody = bIdx; }
                }
                compOwner[comp[5]] = bestBody;
            }

            int count = frameOrder.Length;
            using (var outBmp = new Bitmap(cellSize * count, cellSize, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(outBmp)) {
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                int pad = (int)(cellSize * 0.05);
                int avail = cellSize - pad * 2;

                for (int i = 0; i < count; i++) {
                    int targetBody = frameOrder[i];
                    if (targetBody >= bodies.Count) continue;

                    int minX = w, maxX = 0, minY = h, maxY = 0;
                    for (int y = 0; y < h; y++) {
                        for (int x = 0; x < w; x++) {
                            int lbl = labels[y * w + x];
                            if (lbl > 0 && compOwner[lbl] == targetBody) {
                                if (x < minX) minX = x;
                                if (x > maxX) maxX = x;
                                if (y < minY) minY = y;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    if (maxX < minX || maxY < minY) continue;
                    int bw = maxX - minX + 1, bh = maxY - minY + 1;
                    using (var iso = new Bitmap(bw, bh, PixelFormat.Format32bppArgb)) {
                        var isoData = iso.LockBits(new Rectangle(0, 0, bw, bh), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                        byte[] isoBuf = new byte[bw * bh * 4];
                        for (int y = 0; y < bh; y++) {
                            for (int x = 0; x < bw; x++) {
                                int srcIdx = (minY + y) * w + (minX + x);
                                int lbl = labels[srcIdx];
                                if (lbl > 0 && compOwner[lbl] == targetBody) {
                                    int sp = srcIdx * 4, dp = (y * bw + x) * 4;
                                    isoBuf[dp] = buf[sp];
                                    isoBuf[dp + 1] = buf[sp + 1];
                                    isoBuf[dp + 2] = buf[sp + 2];
                                    isoBuf[dp + 3] = buf[sp + 3];
                                }
                            }
                        }
                        Marshal.Copy(isoBuf, 0, isoData.Scan0, isoBuf.Length);
                        iso.UnlockBits(isoData);

                        float scale = Math.Min((float)avail / bw, (float)avail / bh);
                        int dw = Math.Max(1, (int)Math.Round(bw * scale));
                        int dh = Math.Max(1, (int)Math.Round(bh * scale));
                        int dx = i * cellSize + (cellSize - dw) / 2;
                        int dy = cellSize - pad - dh;
                        g.DrawImage(iso, new Rectangle(dx, dy, dw, dh), new Rectangle(0, 0, bw, bh), GraphicsUnit.Pixel);
                    }
                }
                outBmp.Save(dst, ImageFormat.Png);
            }
        }
    }
}
