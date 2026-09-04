"""Extract every <script> block from dashboard.html so node --check can validate it.

AGENTS.md warns that a syntax error inside dashboard.html's <script> kills the
whole page silently: sidebar empty, every button dead, no visible error. This
makes that failure loud instead. Run before shipping any dashboard edit.
"""
import os
import re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, "scripts", "dashboard.html"), encoding="utf-8").read()
blocks = re.findall(r"<script>(.*?)</script>", src, re.S)
out = os.path.join(os.environ.get("TEMP", "/tmp"), "_dash_check.js")
with open(out, "w", encoding="utf-8") as f:
    f.write("\n;\n".join(blocks))
print(out)
