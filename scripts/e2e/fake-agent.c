/* A stand-in coding agent for end-to-end tests. herdr detects agents by
 * process name, so the harness compiles this as "claude". It puts the
 * terminal in raw mode and prints every input chunk as hex, one line per
 * chunk: "<tag>.K<n>:<hex>". Usage: claude <tag> [bp] [ckm] [kitty]. */
#include <stdio.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>
int main(int argc, char **argv) {
  struct termios old, raw;
  const char *tag = argc > 1 ? argv[1] : "x";
  int bp = 0, ckm = 0, kitty = 0;
  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "bp")) bp = 1;
    if (!strcmp(argv[i], "ckm")) ckm = 1;
    if (!strcmp(argv[i], "kitty")) kitty = 1;
  }
  tcgetattr(0, &old); raw = old; cfmakeraw(&raw); tcsetattr(0, TCSANOW, &raw);
  if (bp) write(1, "\x1b[?2004h", 8);
  if (ckm) write(1, "\x1b[?1h", 5);
  if (kitty) write(1, "\x1b[>1u", 5);
  char line[64]; int n = snprintf(line, sizeof line, "READY %s\r\n", tag); write(1, line, n);
  unsigned char buf[4096]; int count = 0;
  for (;;) {
    ssize_t r = read(0, buf, sizeof buf);
    if (r <= 0) break;
    count++;
    char out[9000]; int o = snprintf(out, sizeof out, "%s.K%d:", tag, count);
    for (ssize_t i = 0; i < r && o < 8990; i++) o += snprintf(out + o, sizeof out - o, "%02x", buf[i]);
    out[o++] = '\r'; out[o++] = '\n';
    write(1, out, o);
    if (memmem(buf, r, "@@quit@@", 8)) break;
  }
  if (bp) write(1, "\x1b[?2004l", 8);
  if (ckm) write(1, "\x1b[?1l", 5);
  if (kitty) write(1, "\x1b[<u", 4);
  write(1, "BYE\r\n", 5);
  tcsetattr(0, TCSANOW, &old);
  return 0;
}
