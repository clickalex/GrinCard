# Printing

Everything that stands between a PDF on your screen and a card that scans reliably in three
years' time.

---

## The numbers this project uses

All of these live in one place — `GEOMETRY` in `card-templates/card-templates.js` — so the
card, the preview and the print sheet can never disagree.

| Constant | Value | Why |
| --- | --- | --- |
| `widthMm` × `heightMm` | **89 × 51 mm** | ISO/IEC 7810 ID-1, the size every card printer, die and wallet slot already expects. 3.5 × 2 in for US shops. |
| `bleedMm` | **3 mm** | Extra artwork on every edge, so a 1 mm cutting error does not leave a white hairline. Printed size with bleed: **95 × 57 mm**. |
| `marginMm` | **4 mm** | Nothing important closer than this to the trim edge. The spec asks for 3 mm minimum; 4 mm is what survives a slightly-off guillotine. |
| `qrSizeMm` | **30 mm** | The QR symbol, quiet zone excluded. The spec's floor is 20 mm; 30 mm scans comfortably at arm's length with a bad camera in bad light. |
| `qrQuietMm` | **2.5 mm** | Light space around the symbol. Together with the symbol it makes a 35 × 35 mm tile. |
| `photoSizeMm` | 22 mm | Round or rounded-square photo on the front. |
| `cornerRadiusMm` | 2.5 mm | Corner radius, if the template uses one. |

### What that means in modules

A QR symbol is a grid. Whether it scans depends on how big each cell of that grid prints, not
on the overall size alone.

These are measured, not estimated — `lib/qr.js` reports the version it chose, and a 30 mm
symbol divides evenly across it:

| What the QR encodes | Chars | ECL | Version | Modules | Module at 30 mm | px @ 300 DPI |
| --- | --- | --- | --- | --- | --- | --- |
| `https://you.dev/c/rahul123` | 26 | Q | 3 | 29 × 29 | **1.03 mm** | 12.2 |
| `https://you.dev/c/rahul123` | 26 | M | 2 | 25 × 25 | 1.20 mm | 14.2 |
| `https://you.github.io/repo/demo/profile.html?u=name` | 51 | Q | 5 | 37 × 37 | 0.81 mm | 9.6 |
| the same URL | 51 | M | 4 | 33 × 33 | 0.91 mm | 10.7 |
| the same URL | 51 | H | 6 | 41 × 41 | 0.73 mm | 8.6 |
| `https://clickalex.github.io/GrinCard/demo/profile.html?u=rahul123` (this demo) | 65 | Q | 6 | 41 × 41 | 0.73 mm | 8.6 |

Offset and digital print hold a 0.1 mm dot comfortably, so every row above prints cleanly —
0.73 mm is seven dots wide. The practical floor is nearer 0.33 mm (4 px at 300 DPI), which you
would only reach by printing a 20 mm code for a very long URL at ECL H.

The card preview page shows the real numbers for *your* URL: open `demo/card-preview.html` and
read the QR panel, which gives the version, module count, mm-per-module and quiet zone. Check
it before ordering 500.

**Shorter URLs make better cards.** That first table row is the argument: `/c/rahul123` gives
you 1.03 mm modules where the long GitHub Pages URL gives 0.81 mm at the same error-correction
level — 27% more scanning margin, for free. Setting up the rewrite is twenty minutes of work
([SETUP.md](../SETUP.md#3-clean-cusername-urls-recommended-for-real-cards)) and it pays off on
every card you ever print.

---

## Which file to send

| You are… | Send | Why |
| --- | --- | --- |
| Using a print shop or an online printer | **PDF**, with bleed enabled | Vector geometry at exact size. They can impose it into a gang run, and the text stays sharp at any DPI. |
| Printing at home or the office | **PDF**, bleed off | Home printers cannot print to the edge, so bleed just wastes paper and confuses the layout. |
| Cutting by hand from an A4 sheet | `demo/print-sheet.html` → Print | Lays out both sides with crop marks and a calibration ruler. |
| Sending a card in a chat app | **PNG** | 300 DPI raster, universally viewable. Not for professional printing — it is a picture of the card, not the card. |
| Feeding a design pipeline (Figma, Illustrator, InDesign) | **SVG** | Scalable and editable, with the QR as real paths. |

Get all of them at once from the dashboard (**Download all**) or the card builder.

### Telling the print shop

> 89 × 51 mm trim, 3 mm bleed (95 × 57 mm artwork), CMYK or spot from the supplied PDF,
> no crop marks needed (bleed is included), please do not scale — print at 100%.

If they ask for CMYK conversion: this PDF is written in DeviceRGB. Most digital presses convert
it correctly and the difference on a dark navy is invisible. If your shop insists on supplied
CMYK, open the PDF in Acrobat or Illustrator and convert there — the geometry does not change,
only the colour numbers.

---

## Bleed, and when you want it

Bleed is artwork that extends past the trim line so that a small cutting error shows more
artwork instead of white paper.

- **Turn it on** for professional printing, dark backgrounds, or any design where colour runs
  to the edge. All three templates here have full-bleed backgrounds, so in practice: always on
  for a print shop.
- **Turn it off** for home/office printers, for a proof, or if the shop says "we do not need
  bleed" (some digital presses trim from the file edge).

With bleed on, the file is 95 × 57 mm and the trim box is marked. Without it, the file is
exactly 89 × 51 mm.

**One honest caveat:** in this version the bleed area is filled with the card's background
colour but the artwork inside is not extended past the trim line — a photo or a stripe that
touches the edge stops at the edge rather than running 3 mm beyond it. For the shipped
templates (flat/gradient backgrounds with a centred layout) the result is correct and
indistinguishable from a fully extended bleed. If you design a template with an element that
must run off the edge, extend it in the template's display list rather than relying on bleed to
stretch it. This is tracked in [PLANNING.md](../PLANNING.md).

---

## Printing at home: getting true size

This is where most people go wrong, and it is always the same setting.

1. Open `demo/print-sheet.html?u=yourname`.
2. Turn on **Bleed** only if you are trimming with a cutter and the sheet has room for it.
3. Print → **More settings** → Scale: **100%** (or **Actual size**). Turn **off** "Fit to
   page", "Shrink to printable area" and "Scale to fit paper". They are on by default in most
   drivers and they are the entire cause of "my card came out 90%".
4. Paper: plain 80–100 gsm for a proof. For a card that survives a wallet, print on
   250–350 gsm card stock, or print on plain paper and mount it.
5. Use the **89 mm calibration ruler** printed at the top of the sheet. Hold a real ruler
   against it. If it does not match to within a millimetre, your scale setting is still wrong —
   do not continue until it matches.

Then cut on the trim marks, and check the QR before you make 50 of them.

---

## Verifying before a print run

Two minutes now saves a reprint.

1. **Measure.** Ruler on the calibration strip, then on the card itself: 89 × 51 mm.
2. **Scan with the worst phone you own.** Not the newest iPhone — the three-year-old Android
   with a scratched lens and the camera app, not a QR scanner app. If the built-in camera app
   finds it, everything finds it.
3. **Scan at distance.** Hold the card at arm's length. Then at 1 m. A 30 mm code should work
   at both; if it only works up close, your modules printed too small (check the version in
   the preview panel — a long URL is the usual cause).
4. **Scan at an angle and in bad light.** Tilt it 45°, try it under a warm indoor bulb.
5. **Check where it lands.** The scan must open your profile, not a search engine and not a
   "open this link?" interstitial that shows the wrong domain. If it opens a search engine,
   `profile_url` was empty or relative when the QR was generated.
6. **Check the private tier.** Scan, then look: a stranger should see your public links and a
   note that more exist. If they see everything, your `visibility` flags are wrong.
7. **Damage test (optional).** Cover 15% of the code with a thumb. At error-correction Q it
   should still scan. This is what ECL Q is for, and it is why it is the default for the back
   of a card that will live in a wallet.

Automated versions of checks 1 and 7 already run in CI: `tests/card.test.js` renders the
generated PDF at 300 DPI with `pdfjs-dist` and decodes the pixels with `jsQR`, asserting the
result equals the exact profile URL. `tests/generator.test.js` does the same for A4 sheets.

---

## Error correction level: which to pick

The dashboard and builder both offer L / M / Q / H. It controls how much of the code can be
destroyed and still scan, at the cost of density (more modules for the same payload).

| ECL | Recovers | Modules for a typical profile URL | Use it when |
| --- | --- | --- | --- |
| L | ~7% | fewest, largest modules | The URL is long, the print is small, and the card will stay pristine (a poster, a screen) |
| M | ~15% | — | Default for the QR generator's sheets and stickers |
| **Q** | **~25%** | — | **Default for the back of a card.** Wallet wear, coffee rings, a scratched laminate |
| H | ~30% | most, smallest modules | You are putting a logo over the middle of the code, or the card will be handled roughly |

The card back defaults to **Q**. Resist the urge to go to H "for safety": H needs more modules,
which makes each module smaller, which costs you more in scan distance than the extra error
correction gains you. Q at 30 mm is the sweet spot, and it is not a coincidence that it is the
default.

---

## Paper, finish and durability

**Weight.** 300–350 gsm coated is the standard business-card stock and what most online printers
use by default. Below 250 gsm a card feels like a flyer and gets binned.

**Finish.**
- *Matte / uncoated* — best for scanning. No glare. Writes on with a pen. This is the safe
  choice for a QR card.
- *Gloss* — colours pop, but a gloss laminate reflects light straight into a phone camera and
  can make a code unreadable at some angles. If you want gloss, test the finished laminated
  card, not the proof.
- *Soft-touch / anti-scratch laminate* — lovely, and usually fine, but it is a thin frosted
  layer over the ink. Test one before the run.

**Contrast.** The QR tile is always printed **white with dark modules**, even on the dark
templates, because a QR reader needs contrast and inverted codes (light modules on a dark
ground) fail on a large fraction of cameras. Do not "improve" this by making the tile match the
card. If you want a dark tile, keep the modules at least 60% darker than it.

**Spot UV, foil, embossing.** All fine *around* the code. Never on it. A foil or raised-varnish
patch over the modules changes their reflectivity and the reader cannot tell dark from light.

**Rounded corners.** Use a 3 mm radius corner punch. The geometry constant is 2.5 mm, so the
artwork already leaves room; just do not round so deeply that you cut into the QR tile.

---

## Ordering from an online printer

1. Upload the **bleed PDF**.
2. Size: **89 × 51 mm** (or "standard business card" / 3.5 × 2 in).
3. Paper: **350 gsm matte** (or "silk" if you prefer a slight sheen without glare).
4. Finish: **matte laminate** or none. Avoid gloss over the code.
5. Quantity: order one **proof** first if the run is over 100. Scan the proof.
6. Turn off any "auto-fix colours", "auto-trap" or "smart resize" option the site offers. They
   are the online equivalent of "fit to page".

Double-sided printing: the PDF this project generates has **two pages — page 1 is the front,
page 2 is the back**. Tell the shop that, or select "double-sided, flip on long edge". If they
ask for separate files, download front and back as two SVGs and place them yourself.

---

## Troubleshooting

| Problem | Almost always | Fix |
| --- | --- | --- |
| Card measures 84 × 48 mm | "Fit to printable area" in the print dialog | Scale 100% / Actual size |
| White hairline on one edge | No bleed, and the cut drifted | Enable bleed; tell the shop the trim size |
| QR scans on your phone but not on others | Modules too small (long URL, or ECL H), or gloss glare | Shorten the URL with a `/c/name` rewrite; drop to ECL Q; switch to matte |
| QR scans to a search engine | `profile_url` was empty or relative when you generated it | Set `profile_url` to the full `https://` URL, regenerate, re-download |
| QR scans to the demo site | You are still using the shipped example profile | Your own JSON in `profile-data/`, and a card built from it |
| Photo looks fuzzy in print but fine on screen | The source image is smaller than 22 mm at 300 DPI (≈ 260 px) | Use an image at least 600 × 600 px; the builder downscales uploads to 600 px for you |
| Colours are duller than the preview | RGB → CMYK conversion on a bright saturated colour | Expected. Saturated blues and greens shift the most; proof it if the brand colour matters |
| The private link shows for everyone | `visibility` is `"public"` on that link | Set it to `"followers_only"` in the JSON or the dashboard |
| The private link never shows, even with a token | The token expired, ran out of uses, or belongs to a different profile | The page says which. Mint a new token in the dashboard |
