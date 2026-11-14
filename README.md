# DeltaKit

DeltaKit, a tool by [Avinash Rapolu](https://avinashrapolu.com/), compares two versions of text, JSON, XML, YAML, or CSV, converts data between those formats, decodes JWT, Base64, and URL text, and compares lists as sets. Everything runs in the visitor's browser, so files, tokens, and text stay on their device.

```bash
npm install
npm run dev
```

Open the URL Vite prints. `npm test` checks the comparison, conversion, and decoding engines, and `npm run build` makes a production bundle in `dist/`.

For publishing at `deltakit.avinashrapolu.com`, see [Hosting](docs/HOSTING.md) for Cloudflare Pages or AWS Lambda with CloudFront and Cloudflare DNS. `npm run package:lambda` creates an uploadable ZIP in `release/` (requires the `zip` command).

## Personal brand

DeltaKit uses Avinash Rapolu’s A.R. mark and the ocean (`#46B7A6`), forest (`#12534D`), charcoal (`#101C1D`), and ivory (`#F2F0E8`) palette from his logo kit. Header and footer marks adapt to the active theme. The author link points to [avinashrapolu.com](https://avinashrapolu.com/); comparison reports also carry this attribution. Logo assets live in `src/assets/brand/`, and favicons live in `public/`.

The interface icons are the 33 Google Material Symbols used by the app, stored directly in `src/components/Icons.tsx` under Apache-2.0. Their license is included in `public/licenses/` and in production builds.

## Pages

Each page has its own address, so people can bookmark the one they use most: `/` is Home, `/compare`, `/convert`, `/decode`, and `/lists` are the tools, and `/help` explains them. Links from earlier versions, such as `/#convert` and `/#decode`, open the matching page.

### Home

Home introduces the four tools and takes files directly. Drop or open two files to compare them right away, or one file to choose between Compare and Convert. Pasting a JWT, Base64, or an encoded link anywhere on Home opens it in Decode. The keys <kbd>1</kbd>, <kbd>2</kbd>, <kbd>3</kbd>, and <kbd>4</kbd> open Compare, Convert, Decode, and Lists.

### Compare

Paste or drop a file into each side and press Compare. DeltaKit shows the changes side by side, inline, as tracked changes, as a structure tree or field list, as a cell-by-cell table, and as a patch. The toolbar above the files tidies both sides at once with Beautify, Minify, and Sort keys, folds long lines with Soft wrap, and swaps or clears the sides. Drag the bar between the files to give one side more room, and double-click it to split them evenly again.

Options sets what counts as a change:

- **Text:** spaces at line ends, line order, letter case, and matching text. Presets cover dates and times, IDs and hashes, and numbers, and you can add your own regular expression.
- **Data:** formatting, key order, and list order (row order for CSV).
- **Ignore fields:** names or dotted paths separated by commas. A name such as `updatedAt` matches that field at any depth, a path such as `meta.requestId` matches fields whose path ends that way, and `*` matches any characters, so `*At` covers `createdAt` and `updatedAt`.
- **Match list items by:** the field that pairs list items and CSV rows, such as `id` or `sku`. Automatic matching looks for `id`, `name`, `key`, `sku`, `email`, or `path`, then pairs records that share most of their values, and keeps track of items that moved.
- **CSV separator:** commas, semicolons, tabs, or pipes. DeltaKit finds the separator for each file, and you can also choose it.

**Export → Download report** saves a single web page with the summary, the changed fields, and the changed lines. It opens offline in any browser and prints well, which makes it easy to attach to a ticket or an email. Export also copies or downloads the patch and copies a short text summary.

### Convert

Converts JSON, YAML, XML, and CSV in any direction. XML attributes become `@name` keys and element text becomes `#text`, so they return as attributes on the way back to XML. CSV becomes a list of records, and nested data becomes dotted columns such as `address.city`. On the way back from CSV, dotted columns become nested fields again and list cells become lists. **Use result as input** moves the result to the left and converts it back, to check the round trip.

### Decode

- **JWT:** shows the header, the claims, and when the token was issued and expires. Checking a signature needs the signing key, so DeltaKit shows the signature as it is.
- **Base64:** reads standard and URL-safe Base64. Images get a preview, and any binary data can be downloaded as a file.
- **URL:** turns codes such as `%20` back into characters and lists every query parameter.

Base64 and URL also encode. DeltaKit picks the right kind when you paste something it recognizes.

### Lists

Paste two or three lists, one item per line or separated by commas, and press Compare lists. DeltaKit treats each list as a set, so repeated items count once, and shows every combination:

- **Union:** `A ∪ B`, and with three lists `A ∪ B ∪ C`, `A ∪ C`, and `B ∪ C`.
- **Intersection:** `A ∩ B`, and with three lists `A ∩ B ∩ C`, `A ∩ C`, and `B ∩ C`.
- **Only in one list:** Only A, Only B, Only C, and the items that appear in exactly one list (`A △ B` for two lists).
- **Difference:** with three lists, each pair both ways, such as `A − B` and `B − A`. With two lists these are Only A and Only B.

Each result shows its count and can be copied or downloaded. **Ignore case** treats `Apple` and `apple` as one item, and **Sort results** orders each result from A to Z with numbers in order. The number of items and skipped repeats in each list appear under the panes.

## Run locally

Use `npm run dev` and open the localhost URL Vite prints. Vite serves the app and its page routes; no separate web server is needed. Files and text are processed in your browser, with no backend or database.

To preview the production build locally:

```bash
npm run build
npm run preview
```

Open the localhost URL printed by the preview command. Keep the terminal running while using the app, and press Ctrl+C to stop the server.

## Limits

- Each pane opens files up to 5 MB. Binary files get a clear message.
- Track changes works on files up to about 80,000 characters, and By character up to about 12,000. Side by side, Inline, and Patch cover every size.
- Long results appear in pages, with a "Show more" button at the end.
- When two large files differ almost everywhere, lines are matched by their unique content so the result stays fast. A note above the result says when this happens.

## Shortcuts

<kbd>Ctrl</kbd> + <kbd>Enter</kbd> (<kbd>⌘</kbd> + <kbd>Enter</kbd> on a Mac) runs Compare, Convert, Decode, or Compare lists, even while typing. On Home, <kbd>1</kbd> to <kbd>4</kbd> open the tools. <kbd>J</kbd> and <kbd>K</kbd> move between changes, <kbd>/</kbd> searches the list of changes, <kbd>?</kbd> opens the Help page, and <kbd>Esc</kbd> closes menus and panels.
