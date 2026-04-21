"""Clean App.jsx for client delivery — remove debug logs, trial comments, set trial mode off."""
import re

with open("src/App.jsx", "r", encoding="utf-8") as f:
    code = f.read()

original_len = len(code)

# 1. Set IS_TRIAL_MODE to false
code = code.replace("const IS_TRIAL_MODE = true;", "const IS_TRIAL_MODE = false;")

# 2. Remove trial mode comments (keep the line structure intact)
code = code.replace(
    "  // --- SECURITY: TRIAL MODE SWITCH ---\n  // Set this to TRUE before sending the sample link.\n  // Set this to FALSE after you receive payment.\n",
    ""
)

# 3. Remove console.log lines (but NOT inside catch blocks or error handlers)
lines = code.split("\n")
clean_lines = []
for line in lines:
    stripped = line.strip()
    # Skip standalone console.log/console.warn lines
    if stripped.startswith("console.log(") or stripped.startswith("console.warn("):
        # But keep console.error
        continue
    # Skip lines that are ONLY console.log with emoji debug
    if "console.log(`" in stripped and stripped.endswith("`);"):
        continue
    if "console.log(" in stripped and stripped.endswith(");") and not "catch" in stripped:
        # Check if this is a standalone statement (not part of an expression)
        if stripped.startswith("console."):
            continue
    clean_lines.append(line)

code = "\n".join(clean_lines)

# 4. Remove the trial comments that reference payment
code = code.replace("// Set this to TRUE before sending the sample link.", "")
code = code.replace("// Set this to FALSE after you receive payment.", "")

final_len = len(code)
print(f"Original: {original_len:,} chars")
print(f"Cleaned:  {final_len:,} chars")
print(f"Removed:  {original_len - final_len:,} chars")

# Verify
trial_count = code.count("IS_TRIAL_MODE = true")
console_count = len([l for l in code.split("\n") if l.strip().startswith("console.log(")])
payment_count = code.count("payment")
print(f"IS_TRIAL_MODE = true: {trial_count} (should be 0)")
print(f"console.log lines: {console_count} (should be 0 or near 0)")
print(f"'payment' references: {payment_count} (should be 0)")

with open("src/App.jsx", "w", encoding="utf-8") as f:
    f.write(code)

print("Done — App.jsx cleaned for client delivery")
