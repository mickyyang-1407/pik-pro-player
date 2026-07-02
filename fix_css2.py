import re

with open('src/styles.css', 'r') as f:
    css = f.read()

# Replace any `#fff` or `white` for timeline and speaker view
# Timeline track is usually `.timeline-track` or `.waveform-track`
css = re.sub(r'background:\s*#fff(?:fff)?\s*;', 'background: var(--surface);', css, flags=re.IGNORECASE)
css = re.sub(r'background-color:\s*#fff(?:fff)?\s*;', 'background-color: var(--surface);', css, flags=re.IGNORECASE)
css = re.sub(r'background:\s*white\s*;', 'background: var(--surface);', css, flags=re.IGNORECASE)
css = re.sub(r'background-color:\s*white\s*;', 'background-color: var(--surface);', css, flags=re.IGNORECASE)

# Style the select dropdown for .zoom-control select
select_style = """
.zoom-control select {
  appearance: none;
  -webkit-appearance: none;
  background-color: var(--surface-soft);
  color: var(--ink);
  border: 1px solid var(--line);
  padding: 4px 28px 4px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  transition: all 0.2s ease;
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23667684%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.zoom-control select:hover {
  border-color: var(--cyan);
}

.zoom-control select:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 0 2px var(--cyan-soft);
}
"""

if '.zoom-control select {' not in css:
    css += "\n" + select_style

with open('src/styles.css', 'w') as f:
    f.write(css)

print("Updated CSS for white backgrounds and select dropdown")
