#!/bin/bash
# ============================================================
# Dewy's Pipeline Run — one-touch start for the stand.
#
# Double-click this file in Finder, or run ./start.command
#
# It serves the game on localhost, stops the display sleeping,
# and opens Chrome pointed at it. Nothing here touches the
# network: localhost is loopback, so this all works with wifi
# off, which is the point.
#
# Close the Terminal window (or press Ctrl-C) to shut it down.
# ============================================================
set -u

PORT="${PORT:-8000}"
KIOSK="${KIOSK:-0}"          # KIOSK=1 ./start.command to launch fullscreen

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# Chrome ignores command-line flags when an instance is already
# running, so the game gets its own profile directory. That also keeps
# the stand's camera permission separate from whatever is going on in
# the everyday browser.
PROFILE="$HERE/.stand-profile"

SERVER_PID=""
CAFFEINE_PID=""

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "Shutting down…"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$CAFFEINE_PID" ] && kill "$CAFFEINE_PID" 2>/dev/null
}

# HUP as well as INT/TERM: closing the Terminal window sends HUP, and
# that is how this will actually be shut down at the stand. EXIT is the
# backstop, and `cleanup` guards against running twice.
trap 'cleanup; exit 0' INT TERM HUP
trap cleanup EXIT

cd "$HERE" || { echo "Cannot find the game folder."; exit 1; }

if [ ! -f index.html ]; then
  echo "index.html is not here — is this file still inside the game folder?"
  exit 1
fi

echo "Dewy's Pipeline Run"
echo "-------------------"

# --- the server -------------------------------------------------------
if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
  echo "• Port $PORT is already serving — reusing it."
else
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "The server would not start. Is python3 installed?"
    exit 1
  fi
  echo "• Serving on http://localhost:$PORT"
fi

# --- keep the screen on ----------------------------------------------
# -d display, -i idle sleep, -s system sleep.
caffeinate -dis &
CAFFEINE_PID=$!
echo "• Display sleep and screen saver held off"

# --- the browser ------------------------------------------------------
FIRST_RUN=0
[ -d "$PROFILE" ] || FIRST_RUN=1

if [ -x "$CHROME" ]; then
  if [ "$KIOSK" = "1" ]; then
    MODE=(--kiosk "http://localhost:$PORT")
    echo "• Opening Chrome fullscreen (kiosk)"
  else
    MODE=("--app=http://localhost:$PORT")
    echo "• Opening Chrome"
  fi
  "$CHROME" \
    --user-data-dir="$PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=Translate \
    --autoplay-policy=no-user-gesture-required \
    "${MODE[@]}" >/dev/null 2>&1 &
else
  echo "• Chrome not found in /Applications — opening your default browser."
  echo "  (Camera controls need Chrome. Safari will not run the pose model.)"
  open "http://localhost:$PORT"
fi

echo ""
if [ "$FIRST_RUN" = "1" ]; then
  echo "  FIRST RUN ON THIS MACHINE"
  echo "  Chrome will ask for camera access. Allow it once — it is"
  echo "  remembered from now on. Do this before the doors open, not"
  echo "  in front of a queue."
  echo ""
fi

if [ "$KIOSK" != "1" ]; then
  echo "  Drag the window onto the vertical monitor, then press"
  echo "  Cmd-Ctrl-F for fullscreen."
  echo ""
fi

cat <<'KEYS'
  Operator keys
    C     recalibrate between players
    P     retry the camera after a failure
    Esc   skip the how-to-play cards
    M     mute

  Keep the laptop lid OPEN. macOS switches the built-in camera off
  in clamshell mode, and the game will drop to keyboard control.

  Leave this window open. Close it to shut everything down.
KEYS

# Hold the window open. `sleep` has to run in the background with a
# `wait` on it: bash defers a trap until the current *foreground* child
# finishes, so a plain `sleep 3600` would swallow the shutdown signal
# for up to an hour and leave the server and caffeinate running.
while true; do
  sleep 3600 &
  wait $! 2>/dev/null
done
