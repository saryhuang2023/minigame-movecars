# -*- coding: utf-8 -*-
"""
刷新字体子集：
1. 仅扫描 `js/` 目录的运行时代码，提取游戏实际用到的字符（含解码 \\uXXXX 转义）。
   游戏所有渲染文字都在 js 的 fillText/showToast 等字符串里；admin/admin-deploy/tools
   等后台网页或工具目录不是游戏运行时，严禁扫入（曾因擅自扩成「扫全工程」而误收
   后台网页字「反馈/步骤」等脏字，2026-07-22 已纠正）。
2. 【关键】扫描前先剥离源码里的注释（// 行注释、/* */ 块注释），仅保留字符串字面量
   与源码真实字符。否则注释/调试文本里的中文会被烙进字体（历史多次踩坑：槛/槽/横/橙/橡 等）。
3. 【关键】不再并集旧子集字形（union）。并集会让注释里扫入的脏字永久残留、无法清理。
   改用「完整扫描源码 + 写前自动备份 + 完整版缺失提示」三重保护防丢字。
4. 仅从完整版 KeinannMaruPOP_all.ttf 切出新的 KeinannMaruPOP-subset.ttf。
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

# 令牌正则：同时匹配「注释」与「字符串字面量」。
# 注释（/* */ 或 //）删除；字符串（真渲染的中文都在其中）保留。
# 用单一组合正则而非「先占位再删注释」，可避免源码未闭合引号把后续注释
# 误判为字符串内容而漏删（历史多次因此漏剥 槛/橙 等）。
_TOKEN_RE = re.compile(r'''/\*.*?\*/|//[^\n]*|(['"`])(?:\\.|(?!\1).)*\1''', re.DOTALL)

def strip_comments(text):
    """移除源码注释 + 擦除 console.* 调试调用，仅保留真实渲染/源码字面量字符。"""
    def repl(m):
        s = m.group(0)
        if s[:2] in ('/*', '//'):
            return ''          # 注释 → 删除
        return s               # 字符串字面量 → 保留
    text = _TOKEN_RE.sub(repl, text)
    # 擦除 console.* 调试语句（其字符串参数未渲染到界面，典型如 console.log('模块…')）
    text = re.sub(r"console\b[^;\n]*;?", "", text)
    return text

def collect_chars(root):
    chars = set()
    for dirpath, dirnames, filenames in os.walk(root):
        # 原地修改 dirnames 以跳过排除目录
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in TEXT_EXTS:
                continue
            # 跳过脚本自身产出的字符清单，否则会被扫回 used 形成脏字自我循环
            if fn == '_charset.txt':
                continue
            full = os.path.join(dirpath, fn)
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            except Exception as e:
                print("skip read %s: %s" % (full, e))
                continue
            # 先剥离注释 + 擦除 console 调试，再统计真实字符（避免脏字污染子集）
            text = strip_comments(text)
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

    print("== 扫描 js/ 运行时代码 ==")
    used = collect_chars(os.path.join(PROJECT, "js"))
    print("扫描到字符数(含转义还原): %d" % len(used))

    print("== 读取当前子集已有字形（仅用于统计清理量，不再并集以免脏字残留）==")
    have = get_cmap_chars(SUBSET_FONT)
    print("当前子集字形数: %d" % len(have))

    # 仅保留完整版里确实存在的字形（不再并集旧子集，否则注释脏字永远删不掉）
    full_have = get_cmap_chars(FULL_FONT)
    needed = sorted(cp for cp in used if cp in full_have)
    print("完整版可覆盖的字形数: %d" % len(needed))

    # 列出项目真实用到但完整版没有的（会成豆腐块，提示出来）
    missing = sorted(cp for cp in used if cp not in full_have)
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
    # 安全闸门：不再并集旧子集（否则注释脏字永久残留）。
    # 改为允许清理式减少——仅当减少到 0 才中止；正常瘦身打印提示即可。
    if new_count < len(have):
        print("[清理] 本次移除 %d 个未使用字形（多为注释/调试文本，属正常瘦身）"
              % (len(have) - new_count))
    if new_count == 0:
        print("ERROR: 新子集字形数为 0，已中止以免破坏字体！")
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

    # 备份旧子集到工程外隔离目录（绝不放在 assets/ 内，否则会打进游戏包体、且进 git）
    import shutil
    bak_dir = os.path.expanduser("~/.workbuddy/font_backups")
    os.makedirs(bak_dir, exist_ok=True)
    bak = os.path.join(bak_dir, os.path.basename(SUBSET_FONT) + ".bak")
    shutil.copy2(SUBSET_FONT, bak)
    print("已备份旧子集到(工程外, 不进包体): %s" % bak)

    font.save(SUBSET_FONT)

    # 同步输出字符清单到项目根 _charset.txt（可追溯产物，便于排查豆腐块）
    # 内容 = 实际进入子集的全部字形 codepoint（已剥离注释/调试文本，仅含真实用到的字符）
    charset_path = os.path.join(PROJECT, "_charset.txt")
    with open(charset_path, "w", encoding="utf-8") as cf:
        cf.write("".join(chr(cp) for cp in sorted(needed)))
    print("已同步字符清单到: %s (%d 字)" % (charset_path, len(needed)))

    new_size = os.path.getsize(SUBSET_FONT)
    print("\n== 完成 ==")
    print("新子集字形数: %d" % len(needed))
    print("新子集文件大小: %d 字节 (%.1f KB)" % (new_size, new_size / 1024.0))

if __name__ == "__main__":
    main()
