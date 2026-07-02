import re

with open('src/styles.css', 'r') as f:
    css = f.read()

# Replace .timeline-track gradient
css = re.sub(
    r'linear-gradient\(180deg,\s*#ffffff,\s*#f4fafc\)',
    'linear-gradient(180deg, var(--surface), var(--surface-soft))',
    css,
    flags=re.IGNORECASE
)

# Replace .room-plane background base color #fbfdfe
css = re.sub(
    r'#fbfdfe',
    'var(--surface)',
    css,
    flags=re.IGNORECASE
)

# Replace .reference-card gradient
css = re.sub(
    r'linear-gradient\(180deg,\s*#ffffff,\s*#f7fbfc\)',
    'linear-gradient(180deg, var(--surface), var(--surface-soft))',
    css,
    flags=re.IGNORECASE
)

# Wait, there's another linear-gradient in reference-card or timeline?
# I'll just catch any linear-gradient starting with white-ish colors
css = re.sub(
    r'linear-gradient\(180deg,\s*#ffffff,\s*#f[a-f0-9]{5}\)',
    'linear-gradient(180deg, var(--surface), var(--surface-soft))',
    css,
    flags=re.IGNORECASE
)

# Any other #fbfdfe?
# Also .timeline-card might have #ffffff. It was replaced by fix_css.py: 
# background-color: #ffffff -> background-color: var(--surface)
# But let's check .speaker-button backgrounds. They are light. 
# Do they look bad in dark mode? Usually they are okay as bright pills, but the user said "Speaker view還有 timeline沒有跟著改色" which likely refers to the big white square of .room-plane and .timeline-track.

with open('src/styles.css', 'w') as f:
    f.write(css)

print("Replaced gradients for timeline and room-plane")
