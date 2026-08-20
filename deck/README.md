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

`build.py` inlines the brand fonts and the Blockscout screenshot as base64,
because the renderer loads the page from a throwaway local server and a font that
failed to load would silently fall back to a system face. The sources are in
`deck/assets`, read relative to `build.py`, so a clone rebuilds the deck without
anything else on the machine. That was not true until 2026-08-20: the fonts came
from a module in `/tmp`, which meant the deck was only rebuildable here.

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

Two more, found the same way:

- In the left column of a two column slide, `<b>` is styled as a block label, so
  a `<b>` inside a `<p>` there breaks the paragraph in half and strands the
  punctuation on its own line. Bold reads as a heading in that column; in the
  right column, inside `p.body`, it behaves as inline emphasis.
- The one pager renders at exactly one A4 page with no slack. Any sentence added
  to it has to be paid for by a sentence removed, and the renderer refuses
  rather than silently spilling onto a second page.
