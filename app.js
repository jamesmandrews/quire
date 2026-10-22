/* Quire — sheets of storage-box labels, each carrying a unique QR ID.
   A quire is traditionally 24 sheets of paper.
   Everything runs in the browser; nothing is uploaded.
   Sheet geometry comes from stocks.js; per-label layout is derived from it. */

const { PDFDocument, StandardFonts, rgb } = PDFLib;

const MM = 72 / 25.4;              // mm -> PDF points
const COURIER = 0.6;               // Courier advance width, in em

/* ---------- per-label layout ----------
   Derived from label size rather than hard-coded, so a new entry in the
   catalogue needs no layout work. Every value is in millimetres from the
   label's top-left corner. */

const INSET     = 2;      // keep-clear border inside each label
const GAP       = 2;      // QR to text column
const QUIET     = 2;      // QR quiet zone, in modules
const QR_MAX    = 45;     // past this a bigger code buys nothing
const QR_SHARE  = 0.45;   // of label width, to leave a usable text column
const RULE_PITCH = 5.5;   // comfortable for a marker
const ID_PT_MAX = 11;
const ID_CHARS  = 15;     // 5-char prefix + separator + 9-char suffix

function layoutFor(stock) {
  const L = stock.label;

  // Square, bounded by label height, and never so wide that the text column
  // cannot hold a full-length ID.
  const qr = Math.min(L.h - 2 * INSET, L.w * QR_SHARE, QR_MAX);

  const textX = INSET + qr + GAP;
  const textW = L.w - textX - INSET;

  // Size the ID to the longest it can ever be, so a prefix added later never
  // overflows the column.
  const idPt = Math.max(6, Math.min(ID_PT_MAX,
    Math.floor((textW * MM) / (ID_CHARS * COURIER))));
  const idMm = idPt / MM;
  const idBase = INSET + idMm * 0.95;

  const rules = [];
  for (let y = idBase + 3.5; y <= L.h - INSET - 0.9; y += RULE_PITCH) rules.push(y);

  return { qr, qrTop: (L.h - qr) / 2, textX, textW, idPt, idBase, rules };
}

const INK  = rgb(0.08, 0.09, 0.10);
const GRAY = rgb(0.78, 0.80, 0.79);
const HAIR = rgb(0.45, 0.48, 0.47);

/* ---------- identifiers ---------- */

// Crockford base32: no I, L, O or U, so nothing reads as 1 or 0 when you
// type an ID off a label whose QR has been scuffed past scanning.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX_MAX = 5;

function newSuffix() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % 32];  // 256 % 32 === 0, no bias
  return s.slice(0, 4) + '-' + s.slice(4);
}

// A prefix is grouping, not entropy: the random half is unchanged, so two
// batches cannot collide whether or not they share one. Only A-Z and 0-9,
// because anything outside the QR alphanumeric set drops the code into byte
// mode and costs it a version.
function cleanPrefix(raw) {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PREFIX_MAX);
}

function composeId(suffix, prefix) {
  return prefix ? prefix + '-' + suffix : suffix;
}

/* ---------- QR ---------- */

function qrModules(text, ec) {
  const q = qrcode(0, ec);
  q.addData(text, 'Alphanumeric');   // default is Byte, which costs a version at EC H
  q.make();
  const n = q.getModuleCount();
  const dark = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
    dark.push(row);
  }
  return { n, dark };
}

// Merge each row's dark run into one rectangle — roughly a third of the draw
// calls, and a third of the file size, versus one rect per module.
function qrRuns({ n, dark }) {
  const runs = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!dark[r][c]) { c++; continue; }
      const start = c;
      while (c < n && dark[r][c]) c++;
      runs.push({ col: start, row: r, len: c - start });
    }
  }
  return runs;
}

function qrGeometry(n, size) {
  const total = n + QUIET * 2;
  const module = size / total;
  return { module, pad: QUIET * module };
}

/* ---------- placement ---------- */

function labelOrigin(stock, index, off) {
  const col = index % stock.grid.cols;
  const row = Math.floor(index / stock.grid.cols);
  return {
    x: stock.margin.x + col * (stock.label.w + stock.gutter.x) + off.x,
    y: stock.margin.y + row * (stock.label.h + stock.gutter.y) + off.y,
  };
}

/* ---------- PDF ----------
   PDF y runs up from the bottom; every measurement here runs down from the
   top, so each draw converts once at the edge. */

function drawRect(page, sheet, x, yTop, w, h, color) {
  page.drawRectangle({
    x: x * MM, y: (sheet.h - (yTop + h)) * MM,
    width: w * MM, height: h * MM,
    color,
  });
}

async function buildLabelPdf(ids, opts) {
  const { stock } = opts;
  const lay = layoutFor(stock);
  const sheet = stock.page;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.CourierBold);
  const sheets = Math.ceil(ids.length / stock.perSheet);

  doc.setTitle(`Box labels — ${stock.name}`);
  doc.setCreator('Quire');

  for (let s = 0; s < sheets; s++) {
    const page = doc.addPage([sheet.w * MM, sheet.h * MM]);
    const batch = ids.slice(s * stock.perSheet, (s + 1) * stock.perSheet);

    batch.forEach((suffix, i) => {
      const id = composeId(suffix, opts.prefix);
      const { x, y } = labelOrigin(stock, i, opts.off);
      const mods = qrModules(id, opts.ec);
      const { module, pad } = qrGeometry(mods.n, lay.qr);
      const qrX = x + INSET + pad;
      const qrY = y + lay.qrTop + pad;

      for (const run of qrRuns(mods)) {
        drawRect(page, sheet, qrX + run.col * module, qrY + run.row * module,
                 run.len * module, module, INK);
      }

      page.drawText(id, {
        x: (x + lay.textX) * MM,
        y: (sheet.h - (y + lay.idBase)) * MM,
        size: lay.idPt, font, color: INK,
      });

      if (opts.rules) {
        for (const ry of lay.rules) {
          drawRect(page, sheet, x + lay.textX, y + ry, lay.textW, 0.09, GRAY);
        }
      }
    });
  }

  return doc.save();
}

async function buildTestPdf(opts) {
  const { stock } = opts;
  const sheet = stock.page;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([sheet.w * MM, sheet.h * MM]);

  doc.setTitle(`Alignment test — ${stock.name}`);

  for (let i = 0; i < stock.perSheet; i++) {
    const { x, y } = labelOrigin(stock, i, opts.off);
    page.drawRectangle({
      x: x * MM, y: (sheet.h - (y + stock.label.h)) * MM,
      width: stock.label.w * MM, height: stock.label.h * MM,
      borderColor: HAIR, borderWidth: 0.4,
    });
  }

  // Registration ticks, parked in the margins where no label can cover them.
  // Lay the test sheet on a label sheet and read the drift off against the
  // label edges these should be pointing at.
  const TICK = 3, CLEAR = 1;
  const gx = stock.margin.x + opts.off.x;
  const gy = stock.margin.y + opts.off.y;
  for (let c = 0; c <= stock.grid.cols; c++) {
    const x = gx + c * (stock.label.w + stock.gutter.x) - (c === stock.grid.cols ? stock.gutter.x : 0);
    drawRect(page, sheet, x - 0.1, gy - TICK - CLEAR, 0.2, TICK, HAIR);
    drawRect(page, sheet, x - 0.1, gy + stock.blockH + CLEAR, 0.2, TICK, HAIR);
  }
  for (let r = 0; r <= stock.grid.rows; r++) {
    const y = gy + r * (stock.label.h + stock.gutter.y) - (r === stock.grid.rows ? stock.gutter.y : 0);
    drawRect(page, sheet, gx - TICK - CLEAR, y - 0.1, TICK, 0.2, HAIR);
    drawRect(page, sheet, gx + stock.blockW + CLEAR, y - 0.1, TICK, 0.2, HAIR);
  }

  page.drawText(`${stock.name}   offset  x ${opts.off.x.toFixed(1)}  y ${opts.off.y.toFixed(1)} mm`, {
    x: stock.margin.x * MM, y: (sheet.h - 6.5) * MM, size: 10, font, color: INK,
  });
  page.drawText(`${sheet.name} / ${stock.grid.cols} x ${stock.grid.rows} / print at 100%, no scaling`, {
    x: stock.margin.x * MM, y: 4 * MM, size: 7, font, color: HAIR,
  });

  return doc.save();
}

/* ---------- preview ---------- */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function renderPreview(ids, opts) {
  const { stock } = opts;
  const lay = layoutFor(stock);
  const sheet = stock.page;
  const parts = [`<rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" fill="#fff"/>`];

  // guide grid — screen only, never printed
  const g = [];
  for (let c = 0; c < stock.grid.cols; c++) {
    const x = stock.margin.x + c * (stock.label.w + stock.gutter.x);
    for (let r = 0; r < stock.grid.rows; r++) {
      const y = stock.margin.y + r * (stock.label.h + stock.gutter.y);
      g.push(`<rect x="${x}" y="${y}" width="${stock.label.w}" height="${stock.label.h}" fill="none"/>`);
    }
  }
  parts.push(
    `<g transform="translate(${opts.off.x} ${opts.off.y})" stroke="#0a8fbf" ` +
    `stroke-width="0.2" opacity="0.5">${g.join('')}</g>`
  );

  const body = [];
  ids.slice(0, stock.perSheet).forEach((suffix, i) => {
    const id = composeId(suffix, opts.prefix);
    const { x, y } = labelOrigin(stock, i, { x: 0, y: 0 });

    const mods = qrModules(id, opts.ec);
    const { module, pad } = qrGeometry(mods.n, lay.qr);
    const qrX = x + INSET + pad;
    const qrY = y + lay.qrTop + pad;

    const boxes = qrRuns(mods).map((run) =>
      `<rect x="${(qrX + run.col * module).toFixed(3)}" y="${(qrY + run.row * module).toFixed(3)}" ` +
      `width="${(run.len * module).toFixed(3)}" height="${module.toFixed(3)}"/>`
    ).join('');
    body.push(`<g fill="#15181a">${boxes}</g>`);

    body.push(
      `<text x="${x + lay.textX}" y="${y + lay.idBase}" fill="#15181a" ` +
      `font-family="ui-monospace, Menlo, monospace" font-size="${(lay.idPt / MM).toFixed(3)}" ` +
      `font-weight="600" xml:space="preserve">${esc(id)}</text>`
    );

    if (opts.rules) {
      for (const ry of lay.rules) {
        body.push(
          `<line x1="${x + lay.textX}" y1="${y + ry}" x2="${x + lay.textX + lay.textW}" y2="${y + ry}" ` +
          `stroke="#d6dbd9" stroke-width="0.25"/>`
        );
      }
    }
  });
  parts.push(`<g transform="translate(${opts.off.x} ${opts.off.y})">${body.join('')}</g>`);

  const svg = document.getElementById('sheet');
  svg.setAttribute('viewBox', `0 0 ${sheet.w} ${sheet.h}`);
  svg.innerHTML = parts.join('');
}

/* ---------- download ---------- */

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const fileStamp = () => new Date().toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------- state ---------- */

const el = (id) => document.getElementById(id);
const STORE_PREFIX = 'quire.';
const store = {
  read(key, fallback) {
    try { const v = localStorage.getItem(STORE_PREFIX + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

// Settings saved under the old name would otherwise vanish on rename, taking
// a dialled-in printer offset with them.
function migrateStore() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('labelmaker.')) continue;
      const moved = STORE_PREFIX + key.slice('labelmaker.'.length);
      if (localStorage.getItem(moved) === null) localStorage.setItem(moved, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  } catch { /* private mode */ }
}

const CATALOGUE = STOCKS.map(resolveStock);
let ids = [];

function currentStock() {
  return CATALOGUE.find((s) => s.id === el('stock').value) || CATALOGUE[0];
}

function options() {
  return {
    stock: currentStock(),
    prefix: cleanPrefix(el('prefix').value),
    ec: el('eclevel').value,
    rules: el('rules').checked,
    off: { x: Number(el('offx').value) || 0, y: Number(el('offy').value) || 0 },
  };
}

// Each stock registers differently in a given printer, so one shared pair of
// numbers would be wrong the moment you switch.
function loadOffsets(stockId) {
  const all = store.read('offsets', {});
  const o = all[stockId] || { x: 0, y: 0 };
  el('offx').value = o.x;
  el('offy').value = o.y;
}

function saveOffsets(stockId, off) {
  const all = store.read('offsets', {});
  all[stockId] = off;
  store.write('offsets', all);
}

function sheetCount() {
  return Math.min(100, Math.max(1, Math.round(Number(el('sheets').value) || 1)));
}

function drawIds(perSheet) {
  const want = sheetCount() * perSheet;
  const seen = new Set(ids);
  while (ids.length < want) {
    const suffix = newSuffix();
    if (seen.has(suffix)) continue;
    seen.add(suffix);
    ids.push(suffix);
  }
  ids.length = want;
}

function refresh() {
  const opts = options();
  const stock = opts.stock;
  const lay = layoutFor(stock);
  drawIds(stock.perSheet);

  const total = ids.length;
  el('count-note').textContent =
    `${total} label${total === 1 ? '' : 's'} at ${stock.perSheet} per sheet, all unique.`;
  el('preview-offset').textContent = `offset ${opts.off.x.toFixed(1)}, ${opts.off.y.toFixed(1)}`;
  el('preview-sheet').textContent = `Sheet 1 of ${Math.ceil(total / stock.perSheet)} — actual proportions`;

  el('spec-strip').innerHTML =
    `${stock.name}<span>/</span>${stock.page.name}<span>/</span>` +
    `${stock.grid.cols} &times; ${stock.grid.rows} = ${stock.perSheet} per sheet<span>/</span>` +
    `${stock.label.w} &times; ${stock.label.h} mm`;

  const sample = composeId(ids[0], opts.prefix);
  const { n } = qrModules(sample, opts.ec);
  const { module } = qrGeometry(n, lay.qr);

  el('page-readout').textContent = `${stock.page.name} · ${stock.page.w} × ${stock.page.h} mm`;
  el('margin-readout').textContent =
    `${stock.margin.x.toFixed(1)} / ${stock.margin.y.toFixed(1)} mm` +
    (stock.gutter.x || stock.gutter.y ? ` · gutter ${stock.gutter.x} / ${stock.gutter.y}` : '');
  el('qr-readout').textContent = `${lay.qr.toFixed(1)} mm · ${n}×${n} · ${module.toFixed(2)} mm/mod`;
  el('id-readout').textContent = sample;

  el('qr-readout').classList.toggle('readout-warn', module < 0.9);
  el('module-warning').hidden = module >= 0.9;

  el('stock-note').textContent = stock.verified
    ? stock.note
    : `${stock.note} Margins are unconfirmed — check the alignment test closely.`;

  el('prefix-note').textContent = opts.prefix
    ? `Every ID reads ${opts.prefix}-XXXX-XXXX.`
    : 'Letters and digits, up to 5. Goes in front of every ID on the sheet.';

  store.write('stock', stock.id);
  store.write('prefix', opts.prefix);
  store.write('ec', opts.ec);
  store.write('rules', opts.rules);
  saveOffsets(stock.id, opts.off);

  renderPreview(ids, opts);
}

function restore() {
  el('stock').innerHTML = CATALOGUE
    .map((s) => `<option value="${s.id}">${esc(s.name)} — ${s.label.w} × ${s.label.h} mm, ${s.perSheet}/sheet</option>`)
    .join('');
  const saved = store.read('stock', CATALOGUE[0].id);
  el('stock').value = CATALOGUE.some((s) => s.id === saved) ? saved : CATALOGUE[0].id;
  el('prefix').value = cleanPrefix(store.read('prefix', ''));
  el('eclevel').value = store.read('ec', 'Q');
  el('rules').checked = store.read('rules', true);
  loadOffsets(el('stock').value);
}

async function withBusy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { await fn(); }
  catch (err) {
    console.error(err);
    button.textContent = 'Something went wrong — see console';
    setTimeout(() => { button.textContent = original; button.disabled = false; }, 2500);
    return;
  }
  button.textContent = original;
  button.disabled = false;
}

function init() {
  migrateStore();
  restore();
  refresh();

  // Each of these runs before the form-wide listener below, because the event
  // bubbles from the input up to the form.
  el('stock').addEventListener('input', () => loadOffsets(el('stock').value));
  el('prefix').addEventListener('input', (e) => {
    const clean = cleanPrefix(e.target.value);
    if (e.target.value !== clean) e.target.value = clean;
  });

  el('controls').addEventListener('input', refresh);

  el('reroll').addEventListener('click', () => { ids = []; refresh(); });

  el('reset-offset').addEventListener('click', () => {
    el('offx').value = 0;
    el('offy').value = 0;
    refresh();
  });

  for (const btn of document.querySelectorAll('[data-nudge]')) {
    btn.addEventListener('click', () => {
      const [axis, delta] = btn.dataset.nudge.split(':');
      const input = el(axis === 'x' ? 'offx' : 'offy');
      input.value = (Number(input.value) + Number(delta)).toFixed(1);
      refresh();
    });
  }

  const tag = (opts) => `${slug(opts.stock.name)}-${opts.prefix ? opts.prefix + '-' : ''}${fileStamp()}`;

  el('make-labels').addEventListener('click', (e) => withBusy(e.target, 'Building…', async () => {
    const opts = options();
    download(await buildLabelPdf(ids, opts), `labels-${tag(opts)}-${ids.length}.pdf`, 'application/pdf');
  }));

  el('make-test').addEventListener('click', (e) => withBusy(e.target, 'Building…', async () => {
    const opts = options();
    download(await buildTestPdf(opts), `alignment-test-${tag(opts)}.pdf`, 'application/pdf');
  }));

  el('make-manifest').addEventListener('click', () => {
    const opts = options();
    const printedAt = new Date().toISOString();
    const manifest = {
      stock: {
        id: opts.stock.id, name: opts.stock.name,
        page: opts.stock.page.name,
        label_mm: { w: opts.stock.label.w, h: opts.stock.label.h },
        grid: { columns: opts.stock.grid.cols, rows: opts.stock.grid.rows },
      },
      prefix: opts.prefix || null,
      printedAt,
      labels: ids.map((suffix) => ({ id: composeId(suffix, opts.prefix), suffix, printedAt })),
    };
    download(JSON.stringify(manifest, null, 2), `manifest-${tag(opts)}-${ids.length}.json`, 'application/json');
  });
}

init();
