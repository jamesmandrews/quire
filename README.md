# Quire

Prints sheets of storage-box labels, each carrying a unique QR code.

> A **quire** is traditionally 24 sheets of paper — which is also what one
> sheet of A-One 80321 holds.

Runs entirely in the browser. No server, no build step, no network calls
after the page loads.

## What it makes

Each label carries:

- a **QR code** holding a unique ID, sized to the stock
- the same ID in **readable monospace** beside it, so a scuffed label is
  still identifiable by hand
- optional **ruling lines** in the remaining space for a marker

IDs are 8 characters of Crockford base32 (`K7M2-9XQZ`), drawn from
`crypto.getRandomValues`. The alphabet omits I, L, O and U so nothing reads
as a 1 or a 0 when you type an ID in by hand.

The app is deliberately stateless: it mints IDs and draws the PDF. Recording
what ends up *in* each box is a separate application's job. Export the
manifest JSON if you want a record of which IDs exist.

## Prefix

An optional prefix of up to 5 characters goes in front of every ID on the
sheet — `ATTIC-K7M2-9XQZ`. It is grouping, not entropy: the random half is
unchanged, so two batches never collide whether or not they share a prefix.

Only A–Z and 0–9 are accepted, and anything you type is uppercased. Other
characters are dropped, because a QR code holding only alphanumerics stays
in the compact encoding mode; one lowercase letter would push it into byte
mode and cost it a size.

On A-One 80321 at error-correction **Q**, a 5-character prefix is free — 15
characters still fit a 21×21 code. At level **H** the same ID needs a 25×25
code and the module size drops. The QR readout shows which you are getting
as you type.

## Label stock

The catalogue lives in `stocks.js`. An entry is pure geometry:

```js
{
  id: 'avery-l7163',
  page: 'A4',                      // or 'Letter', or { w, h }
  grid: { cols: 2, rows: 7 },
  label: { w: 99.1, h: 38.1 },
  margin: { x: 4.7, y: 15.2 },     // or 'center' to derive by centring
  gutter: { x: 2.5, y: 0 },        // 0 for butt-cut stock
  verified: true,
}
```

| Stock | Page | Grid | Label | Margins |
|---|---|---|---|---|
| A-One 80321 | A4 | 3 × 8 = 24 | 66 × 33.9 mm | geometric |
| Avery L7163 | A4 | 2 × 7 = 14 | 99.1 × 38.1 mm | published |
| Avery L7165 | A4 | 2 × 4 = 8 | 99.1 × 67.7 mm | published |

`verified` records whether the **margins** can be trusted, whether published
or forced by the geometry. Label sizes are reliable everywhere; margins are
the figure that silently ruins a sheet, because an error there compounds
across every row.

A-One publishes the sheet size, the label size and the 3 × 8 layout for the
80321, but not its margins — checked against the manufacturer's product
page, a retailer listing and the Amazon listing. They fall out of the
arithmetic anyway: the stock is butt-cut, so 24 labels occupy exactly
198 × 271.2 mm of a 210 × 297 sheet, leaving 12 mm across and 25.8 mm down.
A side-asymmetric die on sheet-fed stock would be peculiar, and both Avery
entries above are symmetric on each axis, so the split is taken as even.

Run the alignment test on any stock regardless. That is about **printer
drift**, not about the die — it applies just as much to the two stocks with
published specs.

### Adding a stock

Add the entry and it works — per-label layout is derived, not declared:

- QR is square, bounded by `label.h - 2×inset`, capped at 45 mm and at 45%
  of label width so the text column stays usable
- the ID font is sized to the longest ID that can ever appear (5-char prefix
  + separator + 9-char suffix), so adding a prefix later never overflows
- ruling lines keep a 5.5 mm pitch and fill whatever height is left

`resolveStock` rejects an entry whose grid overruns the sheet.

### The size floor

Nothing below **53 × 29 mm** belongs in the catalogue. That is where a
5-character prefix at error-correction Q still holds 1.0 mm per module: 15
characters need a 21×21 code, a 2-module quiet zone each side makes 25
modules, so 25 mm of QR, and the QR is bounded by label height less the 2 mm
inset.

Address-label stock — Avery 5160 and its kin at 25.4 mm tall — cannot clear
it. The app warns below 0.9 mm per module rather than printing something
marginal in silence.

## Printing

1. Pick your stock, then print the alignment test PDF on plain paper and
   hold it against a label sheet. Nudge the offsets until the outlines sit
   on the labels. Offsets are saved **per stock**, since each one registers
   differently.
2. Print the label PDF **at 100%**. Turn off *fit to page* and *shrink to
   printable area* — any scaling throws every label out of register.
3. Feed each sheet once. A label sheet that goes through a laser printer
   twice can jam or shed adhesive.

## Running it

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
```

The catalogue is a `.js` file rather than `.json` on purpose: `fetch()` of a
local JSON file is blocked under `file://`, and this keeps the page working
when opened straight off disk.

## Hosting on GitHub Pages

Push to `main`, then **Settings → Pages → Source: `main` / root**. As a repo
inside an organisation it serves from a subpath:

```
https://<org>.github.io/quire/
```

Every path in the page is relative and both dependencies are vendored, so
the subpath needs no configuration and the site keeps working offline once
cached. Verified by serving the folder one directory deep: no failed
requests, PDF generation intact.

## Dependencies

Vendored in `vendor/`, no package manager involved:

- [pdf-lib](https://pdf-lib.js.org/) 1.17.1 — PDF generation
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 — QR encoding

## Sources

- [A-One 80321 product page](https://www.a-one.co.jp/product/search/detail.php?id=80321)
- [Amazon listing for A-One 80321](https://www.amazon.co.jp/-/en/Compatible-Stickers-Sellers-80321-One-Piece/dp/B07GX9CXQD)
- [Avery L7163 template geometry](https://labelstudio.io/templates/avery-l7163)
- [Avery L7165 template geometry](https://labelstudio.io/templates/avery-l7165)
