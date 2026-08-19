# The deck and the one pager

Two PDFs the submission form asks for, built from HTML rather than a slide app
so they can be regenerated when a number changes.

```bash
python3 deck/build.py
cd deck && python3 -m http.server 8099 --bind 127.0.0.1 &
python3 <skill>/scripts/deck.py --url http://127.0.0.1:8099/pitch.html \
  --out web/public/singleton-deck.pdf --brand Singleton \
  --logo /tmp/logo.png --logo-mono /tmp/logo.png
```

```bash
python3 <skill>/scripts/one_pager.py --html deck/one-pager.html \
  --out web/public/singleton-one-pager.pdf --logo /tmp/logo.png
```

`build.py` inlines the brand fonts and one frame of the demo recording as base64,
because the renderer loads the page from a throwaway local server and a font that
failed to load would silently fall back to a system face.

Both renderers refuse rather than ship something plausible. The deck one fails if
the PDF page count does not match the slide count, and shrinks any slide that
would otherwise have its last row cropped by the frame. The one pager one fails
if the content spills past a single A4 page.

Two things that cost time and are worth knowing:

- The one pager's ambient gradient used `inset: -20%`, which put 225px of
  pseudo-element outside an `overflow: hidden` box. The height check measures
  `scrollHeight`, so it reported an overflow that no reader would ever see. The
  guard was right to complain: a decorative layer hanging off the page edge is
  sloppy whether or not it is visible.
- The footer mark only appears when both `--logo` and `--logo-mono` are passed.
  Passing only the mono one leaves the wordmark text with no mark beside it.
