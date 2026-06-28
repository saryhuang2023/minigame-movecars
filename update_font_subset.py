#!/usr/bin/env python3
"""
字体子集更新脚本
用法：python update_font_subset.py [源字体路径]

当游戏新增文字后，把新字加到 _charset.txt，然后运行此脚本即可重新裁剪字体。
源字体默认路径为 C:/Users/58275/Downloads/font/GenSenRounded2TW-H.otf，
也可以作为命令行参数传入。
"""

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 源字体路径（可通过命令行参数覆盖）
DEFAULT_SOURCE = r"C:\Users\58275\Downloads\font\GenSenRounded2TW-H.otf"
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "assets", "font")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "GenSenRounded2TW-H-subset.otf")
CHARSET_FILE = os.path.join(SCRIPT_DIR, "_charset.txt")


def main():
    source_font = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE

    # 检查源字体
    if not os.path.isfile(source_font):
        print(f"[错误] 源字体不存在: {source_font}")
        print(f"用法: python update_font_subset.py [源字体路径]")
        sys.exit(1)

    # 检查字符集文件
    if not os.path.isfile(CHARSET_FILE):
        print(f"[错误] 字符集文件不存在: {CHARSET_FILE}")
        sys.exit(1)

    # 读取字符集
    with open(CHARSET_FILE, "r", encoding="utf-8") as f:
        charset = f.read().strip()

    if not charset:
        print("[错误] _charset.txt 为空")
        sys.exit(1)

    unique_count = len(set(charset))
    print(f"[信息] 字符集: {unique_count} 个唯一字符")
    print(f"[信息] 源字体: {source_font}")

    # 确保输出目录存在
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 使用 fontTools Subsetter API（比 pyftsubset 更稳，避免 CID 字体 bug）
    try:
        from fontTools.ttLib import TTFont
        from fontTools.subset import Subsetter
    except ImportError:
        print("[错误] 需要安装 fontTools: pip install fonttools")
        sys.exit(1)

    print("[OK] 加载源字体...")
    tt = TTFont(source_font)

    print("[OK] 裁剪子集...")
    subsetter = Subsetter()
    subsetter.populate(unicodes=[ord(c) for c in set(charset)])
    subsetter.subset(tt)

    # 后处理：修正字体 family name
    # WeChat wx.loadFont 不支持含空格的 family name
    # 源字体 "GenSenRounded2 TW H" → Family="GenSenRounded2TW", Full="GenSenRounded2TW-H"
    for record in tt['name'].names:
        if record.nameID == 1:   # Family
            old = record.toUnicode()
            record.string = 'GenSenRounded2TW'
            print(f"[改名] nameID=1: '{old}' -> 'GenSenRounded2TW'")
        elif record.nameID == 4:  # Full Name
            old = record.toUnicode()
            record.string = 'GenSenRounded2TW-H'
            print(f"[改名] nameID=4: '{old}' -> 'GenSenRounded2TW-H'")
        elif record.nameID == 16:  # Typographic Family
            old = record.toUnicode()
            record.string = 'GenSenRounded2TW'
            print(f"[改名] nameID=16: '{old}' -> 'GenSenRounded2TW'")

    print("[OK] 保存字体...")
    tt.save(OUTPUT_FILE)

    # 输出结果
    if os.path.isfile(OUTPUT_FILE):
        size_kb = os.path.getsize(OUTPUT_FILE) / 1024
        print(f"[完成] 字体已更新 -> {OUTPUT_FILE}")
        print(f"[完成] 文件大小: {size_kb:.1f} KB")
    else:
        print("[错误] 输出文件未生成")
        sys.exit(1)


if __name__ == "__main__":
    main()
