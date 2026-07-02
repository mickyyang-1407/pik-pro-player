import re

with open('src/styles.css', 'r') as f:
    css = f.read()

# Replace hardcoded #ffffff backgrounds with var(--surface)
# and #f5f9fb / #f6f8fb with var(--bg)
# #14202a / #1a222c with var(--line)

# Let's replace common colors:
replacements = {
    r'background-color:\s*#ffffff': 'background-color: var(--surface)',
    r'background:\s*#ffffff': 'background: var(--surface)',
    r'background:\s*#f5f9fb': 'background: var(--bg)',
    r'background-color:\s*#f5f9fb': 'background-color: var(--bg)',
    r'background:\s*#f6f8fb': 'background: var(--bg)',
    r'background-color:\s*#f6f8fb': 'background-color: var(--bg)',
    r'border-color:\s*#e2e8ec': 'border-color: var(--line)',
    r'border:\s*1px\s+solid\s+#e2e8ec': 'border: 1px solid var(--line)',
    r'border-bottom:\s*1px\s+solid\s+#e2e8ec': 'border-bottom: 1px solid var(--line)',
    r'border-right:\s*1px\s+solid\s+#e2e8ec': 'border-right: 1px solid var(--line)',
    r'color:\s*#14202a': 'color: var(--text-main)',
    r'color:\s*#353f47': 'color: var(--text-sub)',
    r'color:\s*#5a6b78': 'color: var(--text-muted)',
    r'box-shadow:\s*0\s+4px\s+16px\s+rgba\(20,\s*32,\s*42,\s*0\.08\)': 'box-shadow: 0 4px 16px var(--shadow-color)',
    r'box-shadow:\s*0\s+2px\s+8px\s+rgba\(20,\s*32,\s*42,\s*0\.04\)': 'box-shadow: 0 2px 8px var(--shadow-color)',
}

for pattern, repl in replacements.items():
    css = re.sub(pattern, repl, css, flags=re.IGNORECASE)

# We also need to add --shadow-color to the themes if it's missing.
# And --surface-soft

with open('src/styles.css', 'w') as f:
    f.write(css)

print("Replaced colors")
