# -*- coding: utf-8 -*-
"""
刷新字体子集：
1. 扫描项目中所有文本源文件，提取游戏实际用到的字符（含解码 \\uXXXX 转义）。
2. 并集当前子集字体已有的字形，避免回退丢失。
3. 仅从完整版 KeinannMaruPOP_all.ttf 切出新的 KeinannMaruPOP-subset.ttf。
   （dabaotaotao_all.ttf 已弃用，仅备份，不参与。）
"""
import os
import re
import sys

PROJECT = r"C:\Users\58275\WeChatProjects\minigame-movecars"
FULL_FONT = os.path.join(PROJECT, "document", "font", "KeinannMaruPOP_all.ttf")
SUBSET_FONT = os.path.join(PROJECT, "assets", "font", "KeinannMaruPOP-subset.ttf")

# 仅扫描这些文本类型，避免误读二进制
TEXT_EXTS = {".js", ".jsx", ".json", ".html", ".htm", ".wxml", ".wxss",
             ".css", ".ts", ".md", ".txt", ".wxs", ".yml", ".yaml"}

# 排除目录
EXCLUDE_DIRS = {".git", "node_modules", "assets", "document", "dist", "build",
                ".workbuddy", "libs_min"}

# 用于把字符串里的 \uXXXX / \u{XXXX} 还原成真实字符一起统计
ESCAPE_RE = re.compile(r"\\u([0-9A-Fa-f]{1,6})")

def collect_chars(root):
    chars = set()
    for dirpath, dirnames, filenames in os.walk(root):
        # 原地修改 dirnames 以跳过排除目录
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in TEXT_EXTS:
                continue
            full = os.path.join(dirpath, fn)
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            except Exception as e:
                print("skip read %s: %s" % (full, e))
                continue
            # 真实字符（存 codepoint 整数）
            for ch in text:
                if ord(ch) >= 0x20:  # 跳过控制字符
                    chars.add(ord(ch))
            # 转义字符
            for m in ESCAPE_RE.finditer(text):
                try:
                    cp = int(m.group(1), 16)
                    chars.add(cp)
                except ValueError:
                    pass
    return chars

def get_cmap_chars(font_path):
    from fontTools.ttLib import TTFont
    f = TTFont(font_path, fontNumber=0)
    out = set()
    for table in f["cmap"].tables:
        out |= set(table.cmap.keys())
    f.close()
    return out

def main():
    if not os.path.exists(FULL_FONT):
        print("ERROR: 完整版字体不存在: %s" % FULL_FONT)
        sys.exit(1)
    if not os.path.exists(SUBSET_FONT):
        print("ERROR: 当前子集字体不存在: %s" % SUBSET_FONT)
        sys.exit(1)

    print("== 扫描项目文本 ==")
    used = collect_chars(PROJECT)
    print("扫描到字符数(含转义还原): %d" % len(used))

    print("== 读取当前子集已有字形 ==")
    have = get_cmap_chars(SUBSET_FONT)
    print("当前子集字形数: %d" % len(have))

    union = used | have
    # 仅保留完整版里确实存在的字形
    full_have = get_cmap_chars(FULL_FONT)
    needed = sorted(cp for cp in union if cp in full_have)
    print("完整版可覆盖的字形数: %d" % len(needed))

    # 列出项目用到但完整版没有的（会成豆腐块，提示出来）
    missing = sorted(cp for cp in union if cp not in full_have)
    if missing:
        print("\n[警告] 以下字符完整版没有字形（豆腐块风险）:")
        for cp in missing:
            ch = chr(cp)
            print("  U+%04X %r %s" % (cp, ch, ch if cp >= 0x20 else ""))
    else:
        print("完整版覆盖全部所需字符，无缺失。")

    # 切子集
    from fontTools.subset import Subsetter, Options
    from fontTools.ttLib import TTFont

    new_count = len(needed)
    # 安全闸门：新子集不应少于当前子集（union 已包含现有字形）
    if new_count < len(have):
        print("ERROR: 新子集字形数(%d) < 当前子集(%d)，疑似逻辑异常，已中止以免破坏字体！"
              % (new_count, len(have)))
        sys.exit(2)

    font = TTFont(FULL_FONT, fontNumber=0)
    opts = Options()
    opts.name_IDs = ['*']          # 保留 name 表
    opts.recalc_bounds = True
    opts.notdef_outline = True
    opts.glyph_names = True
    opts.layout_features = ['*']
    opts.hinting = False           # 去掉 hint 减小体积
    subsetter = Subsetter(options=opts)
    subsetter.populate(unicodes=needed)
    subsetter.subset(font)

    # 安全闸门：subset 之后的实际字形数必须 > 0
    after = set()
    for t in font["cmap"].tables:
        after |= set(t.cmap.keys())
    if len(after) == 0:
        print("ERROR: subset 后字形数为 0，已中止，未写入文件！")
        sys.exit(3)

    # 备份旧子集（若还没有 .bak）
    bak = SUBSET_FONT + ".bak.regenerated"
    if not os.path.exists(bak):
        import shutil
        shutil.copy2(SUBSET_FONT, bak)
        print("已备份旧子集到: %s" % bak)

    font.save(SUBSET_FONT)
    new_size = os.path.getsize(SUBSET_FONT)
    print("\n== 完成 ==")
    print("新子集字形数: %d" % len(needed))
    print("新子集文件大小: %d 字节 (%.1f KB)" % (new_size, new_size / 1024.0))

if __name__ == "__main__":
    main()
