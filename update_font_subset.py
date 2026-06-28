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
import subprocess

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

    # 运行 pyftsubset
    cmd = [
        "pyftsubset",
        source_font,
        f"--text={charset}",
        f"--output-file={OUTPUT_FILE}",
        "--drop-tables+=GPOS,GSUB,GDEF",
        "--drop-tables+=vhea,vmtx",
        "--layout-features=",
        "--name-IDs=",
        "--no-subset-tables+=cmap",
    ]

    print(f"[执行] {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"[错误] pyftsubset 失败:")
        print(result.stderr)
        sys.exit(1)

    # 后处理：重命名字体 family name（去掉空格，WeChat wx.loadFont 不支持含空格的 family name）
    try:
        from fontTools.ttLib import TTFont
        tt = TTFont(OUTPUT_FILE)
        for record in tt['name'].names:
            if record.nameID in (1, 4, 16):  # Family, Full Name, Preferred Family
                old = record.toUnicode()
                new = old.replace(' ', '')
                if old != new:
                    record.string = new
                    print(f"[改名] nameID={record.nameID}: '{old}' → '{new}'")
        tt.save(OUTPUT_FILE)
        print("[改名] 完成")
    except ImportError:
        print("[警告] fontTools 未安装，跳过字体改名步骤")
    except Exception as e:
        print(f"[警告] 字体改名失败: {e}")

    # 输出结果
    if os.path.isfile(OUTPUT_FILE):
        size_kb = os.path.getsize(OUTPUT_FILE) / 1024
        print(f"[完成] 字体已更新 → {OUTPUT_FILE}")
        print(f"[完成] 文件大小: {size_kb:.1f} KB")
    else:
        print("[错误] 输出文件未生成")
        sys.exit(1)


if __name__ == "__main__":
    main()
