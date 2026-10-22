/* Label stock catalogue.
 *
 * A plain script rather than a .json file on purpose: index.html has to keep
 * working when opened straight off disk, and fetch() of a local JSON file is
 * blocked under file://. Same data, no build step, no CORS.
 *
 * Geometry, all in millimetres:
 *   page    'A4' | 'Letter' | { w, h }
 *   grid    columns and rows of labels
 *   label   one label's width and height
 *   margin  distance from the sheet edge to the first label, or 'center'
 *           to derive it by centring the block on the sheet
 *   gutter  gap between neighbouring labels; 0 for butt-cut stock
 *
 * `verified` records whether the MARGINS can be trusted — either published,
 * or forced by the geometry. Label sizes are reliable everywhere; margins are
 * the figure that silently ruins a sheet, because an error there compounds
 * across every row.
 *
 * Run the alignment test on any stock regardless. That is about printer
 * drift, not about the die.
 *
 * Nothing below 53 x 29 mm belongs here. That floor is where a 5-character
 * prefix at error-correction Q still holds 1.0 mm per module: 15 characters
 * need a 21x21 code, plus a 2-module quiet zone each side is 25 modules, so
 * 25 mm of QR, and the QR is bounded by label height less the 2 mm inset.
 * Address-label stock (Avery 5160 and its kin, 25.4 mm tall) cannot clear it.
 */

const PAGES = {
  A4:     { w: 210,   h: 297,   name: 'A4' },
  Letter: { w: 215.9, h: 279.4, name: 'Letter' },
};

const STOCKS = [
  {
    id: 'a-one-80321',
    name: 'A-One 80321',
    note: 'Clean-peel, butt-cut. 24 per sheet.',
    page: 'A4',
    grid: { cols: 3, rows: 8 },
    label: { w: 66, h: 33.9 },
    margin: 'center',
    gutter: { x: 0, y: 0 },
    verified: true,
    source: 'https://www.a-one.co.jp/product/search/detail.php?id=80321',
    sourceNote: 'Sheet, label size and 3x8 layout are published; margins are not. Butt-cut is confirmed on the physical sheet, so the labels occupy exactly 198 x 271.2 mm and the remaining 12 mm across and 25.8 mm down is split evenly. A side-asymmetric die on sheet-fed stock would be peculiar, and both Avery A4 entries below are symmetric on each axis, so centring is taken as sound.',
  },
  {
    id: 'avery-l7163',
    name: 'Avery L7163',
    note: '14 per sheet, 2.5 mm gutter between columns.',
    page: 'A4',
    grid: { cols: 2, rows: 7 },
    label: { w: 99.1, h: 38.1 },
    margin: { x: 4.7, y: 15.2 },
    gutter: { x: 2.5, y: 0 },
    verified: true,
    source: 'https://labelstudio.io/templates/avery-l7163',
  },
  {
    id: 'avery-l7165',
    name: 'Avery L7165',
    note: '8 per sheet, 2.5 mm gutter between columns.',
    page: 'A4',
    grid: { cols: 2, rows: 4 },
    label: { w: 99.1, h: 67.7 },
    margin: { x: 4.7, y: 13.1 },
    gutter: { x: 2.5, y: 0 },
    verified: true,
    source: 'https://labelstudio.io/templates/avery-l7165',
  },
];

const MIN_LABEL = { w: 53, h: 29 };

// Fill in whatever the entry left implicit, and refuse anything that cannot
// physically fit the sheet — a stock that overruns the page would otherwise
// print a row and a half and look like a printer fault.
function resolveStock(stock) {
  const page = typeof stock.page === 'string' ? PAGES[stock.page] : stock.page;
  if (!page) throw new Error(`${stock.id}: unknown page size ${stock.page}`);

  const { cols, rows } = stock.grid;
  const gutter = stock.gutter || { x: 0, y: 0 };
  const blockW = cols * stock.label.w + (cols - 1) * gutter.x;
  const blockH = rows * stock.label.h + (rows - 1) * gutter.y;

  const margin = stock.margin === 'center'
    ? { x: (page.w - blockW) / 2, y: (page.h - blockH) / 2 }
    : stock.margin;

  const problems = [];
  if (margin.x < 0 || margin.y < 0) problems.push('label block is larger than the sheet');
  if (margin.x + blockW > page.w + 0.01) problems.push('columns overrun the sheet width');
  if (margin.y + blockH > page.h + 0.01) problems.push('rows overrun the sheet height');
  if (stock.label.w < MIN_LABEL.w || stock.label.h < MIN_LABEL.h) {
    problems.push(`below the ${MIN_LABEL.w} x ${MIN_LABEL.h} mm floor`);
  }
  if (problems.length) throw new Error(`${stock.id}: ${problems.join('; ')}`);

  return { ...stock, page, margin, gutter, blockW, blockH, perSheet: cols * rows };
}
