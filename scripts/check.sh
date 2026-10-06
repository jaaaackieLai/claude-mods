#!/usr/bin/env sh
# Checks the marketplace and every mod in plugins/, then the conflicts between mods.
# Run it before every release: sh scripts/check.sh
#
# Why no test loads all four mods at once: `claude plugin test` only loads
# self-contained inline plugins beside the one under test, and a real mod's
# register uses helpers from its own file. So each mod that draws above the
# prompt has its own test proving it keeps the rows of the mods beneath it.
# If every band mod keeps the rows beneath, all rows show in any load order.
root="$(cd "$(dirname "$0")/.." && pwd)"
failed=0

fail() {
  echo "✘ $1"
  failed=1
}

echo "== marketplace"
claude plugin validate "$root" >/dev/null 2>&1 || fail "marketplace.json does not validate"

for dir in "$root"/plugins/*/; do
  name="$(basename "$dir")"
  echo "== $name"
  claude plugin validate "$dir" >/dev/null 2>&1 || fail "$name: claude plugin validate"
  claude plugin test "$dir" >/dev/null 2>&1 || fail "$name: claude plugin test"
  if [ -f "$dir/.claude-plugin/types/tsconfig.json" ]; then
    npx -y -p typescript tsc -p "$dir" --noEmit >/dev/null 2>&1 || fail "$name: tsc"
  else
    echo "  (tsc skipped: load the mod once so Claude Code writes .claude-plugin/types/)"
  fi

  # A mod that draws above the prompt needs a test that draws a row beneath it.
  if grep -q "component: 'AbovePrompt'" "$dir"/hooks/register.ts* 2>/dev/null &&
    ! grep -rqs "beneath" "$dir"/hooks/*.test.ts* "$dir"/tests/*.test.ts*; then
    fail "$name: draws above the prompt but no test checks the rows beneath it"
  fi
done

echo "== conflicts"
dupes() {
  sort | uniq -d
}
commands="$(grep -h -A3 'command.register' "$root"/plugins/*/hooks/register.ts* | grep -o "name: '[^']*'" | dupes)"
[ -z "$commands" ] || fail "two mods register the same command: $commands"
panes="$(grep -h "^const PANE = " "$root"/plugins/*/hooks/register.ts* | dupes)"
[ -z "$panes" ] || fail "two mods open the same pane id: $panes"
for dir in "$root"/plugins/*/; do
  name="$(basename "$dir")"
  others="$(grep -ho "plugin: '[^']*', key" "$dir"/hooks/register.ts* | sort -u | grep -v "plugin: '$name'")"
  [ -z "$others" ] || fail "$name: uses state that belongs to another mod: $others"
done

if [ "$failed" = 0 ]; then
  echo "✔ all checks passed"
else
  exit 1
fi
