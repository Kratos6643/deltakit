import { MOD_KEY } from '../lib/keys.ts'
import { MAX_BYTES, formatBytes } from '../lib/files.ts'
import { followLink, PATHS, type Page } from '../lib/routes.ts'

type HelpPageProps = {
  active: boolean
  onPage: (page: Page) => void
}

export function HelpPage({ active, onPage }: HelpPageProps) {
  return (
    <div className="page help" hidden={!active} data-testid="page-help">
      <header className="page-head">
        <div className="page-title">
          <p className="eyebrow">Help</p>
          <h1>How DeltaKit works</h1>
          <p className="page-lead">Four tools in one tab. Everything runs in your browser, so your files, tokens, and text stay on this device.</p>
        </div>
      </header>

      <div className="help-grid">
        <section className="card help-card is-wide" aria-labelledby="help-compare">
          <h2 id="help-compare">
            <a href={PATHS.compare} onClick={(event) => followLink(event, onPage, 'compare')}>Compare</a>
          </h2>
          <div className="help-columns">
            <div>
              <h3>In three steps</h3>
              <ol>
                <li>Pick the file type at the top right: Text, JSON, XML, YAML, or CSV.</li>
                <li>Paste or drop the older version on the left and the newer one on the right.</li>
                <li>Press <strong>Compare</strong>. Green is added, red is removed, amber is changed, and blue is moved.</li>
              </ol>
              <p className="step-note">After you edit either side, press Compare again to refresh the result.</p>
              <h3>Around the files</h3>
              <ul>
                <li><strong>Beautify</strong>, <strong>Minify</strong>, and <strong>Sort keys</strong> rewrite both sides at once.</li>
                <li><strong>Soft wrap</strong> folds long lines so they fit the pane.</li>
                <li>Drag the bar between the files to give one side more room. Double-click it to split them evenly again.</li>
              </ul>
            </div>
            <div>
              <h3>Views</h3>
              <ul>
                <li><strong>Side by side</strong> lines both versions up, with changed words marked.</li>
                <li><strong>Inline</strong> shows one column, with removed lines above the added ones.</li>
                <li><strong>Track changes</strong> reads like an edited document, by word or by character.</li>
                <li><strong>Structure</strong> compares JSON, XML, YAML, and CSV as data. List items match by <code>id</code>, <code>name</code>, <code>key</code>, <code>sku</code>, <code>email</code>, or <code>path</code>, or by the field you choose in Options, even when they move.</li>
                <li><strong>Table</strong> compares CSV files and lists of objects cell by cell.</li>
                <li><strong>Patch</strong> is a unified diff you can copy or download from Export.</li>
              </ul>
            </div>
            <div>
              <h3>Options</h3>
              <ul>
                <li>For text: spaces at line ends, line order, letter case, and matching text, such as dates, IDs, numbers, or your own pattern.</li>
                <li>For data: formatting, key order, list order, fields to leave out (such as <code>updatedAt</code> or <code>meta.requestId</code>), and the field that matches list items.</li>
                <li>CSV files can use commas, semicolons, tabs, or pipes. DeltaKit finds the separator, and you can also choose it.</li>
              </ul>
              <h3>Share a result</h3>
              <p><strong>Export → Download report</strong> saves one web page with the summary, the changed fields, and the changed lines. It opens in any browser, offline, and prints well.</p>
            </div>
          </div>
        </section>

        <section className="card help-card" aria-labelledby="help-convert">
          <h2 id="help-convert">
            <a href={PATHS.convert} onClick={(event) => followLink(event, onPage, 'convert')}>Convert</a>
          </h2>
          <ol>
            <li>Choose what to convert from and to: JSON, YAML, XML, or CSV.</li>
            <li>Paste or drop a file on the left.</li>
            <li>Press <strong>Convert</strong>, then copy or download the result.</li>
          </ol>
          <ul className="help-more">
            <li>XML attributes become <code>@name</code> keys and element text becomes <code>#text</code>, so they return as attributes when you convert back to XML.</li>
            <li>CSV becomes a list of records, with numbers and true or false read as values. Nested data becomes dotted columns, such as <code>address.city</code>.</li>
            <li><strong>Use result as input</strong> moves the result to the left, to check the way back.</li>
          </ul>
        </section>

        <section className="card help-card" aria-labelledby="help-decode">
          <h2 id="help-decode">
            <a href={PATHS.decode} onClick={(event) => followLink(event, onPage, 'decode')}>Decode</a>
          </h2>
          <ol>
            <li>Choose JWT, Base64, or URL. DeltaKit picks one for you when you paste something it recognizes.</li>
            <li>Paste the token or text on the left.</li>
            <li>Press <strong>Decode</strong>, or <strong>Encode</strong> for Base64 and URL.</li>
          </ol>
          <ul className="help-more">
            <li>A JWT shows its header, its claims, and when it was issued and expires. Checking the signature needs the signing key, so DeltaKit shows the signature as it is.</li>
            <li>Base64 that holds an image shows a preview. Any binary data can be downloaded as a file.</li>
            <li>URL decoding turns codes such as <code>%20</code> back into characters and lists every query parameter.</li>
          </ul>
        </section>

        <section className="card help-card is-wide" aria-labelledby="help-lists">
          <h2 id="help-lists">
            <a href={PATHS.lists} onClick={(event) => followLink(event, onPage, 'lists')}>Lists</a>
          </h2>
          <ol>
            <li>Choose two or three lists.</li>
            <li>Paste a list into each pane, one item per line or separated by commas. Dropping a file works too.</li>
            <li>Press <strong>Compare lists</strong>, then pick a result and copy or download it.</li>
          </ol>
          <ul className="help-more">
            <li><strong>Union</strong> (<code>A ∪ B</code>) is everything in the lists, each item once. <strong>Intersection</strong> (<code>A ∩ B</code>) is what they share.</li>
            <li><strong>Only A</strong> is what no other list has, and <strong>Difference</strong> (<code>A − B</code>) is what A has that B lacks. With three lists, every pair and all three together get their own result.</li>
            <li>Repeated items count once. <strong>Ignore case</strong> treats <code>Apple</code> and <code>apple</code> as one item, and <strong>Sort results</strong> orders each result from A to Z.</li>
          </ul>
        </section>

        <section className="card help-card" aria-labelledby="help-keys">
          <h2 id="help-keys">Shortcuts</h2>
          <dl className="keys">
            <dt><kbd>{MOD_KEY}</kbd> <kbd>Enter</kbd></dt><dd>Compare, Convert, Decode, or Compare lists, even while typing</dd>
            <dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></dt><dd>Open Compare, Convert, Decode, or Lists from Home</dd>
            <dt><kbd>J</kbd> <kbd>K</kbd></dt><dd>Next and previous change</dd>
            <dt><kbd>/</kbd></dt><dd>Find a change</dd>
            <dt><kbd>?</kbd></dt><dd>Open this page</dd>
            <dt><kbd>Esc</kbd></dt><dd>Close menus and panels</dd>
          </dl>
        </section>

        <section className="card help-card is-privacy" aria-labelledby="help-privacy">
          <h2 id="help-privacy">Privacy and limits</h2>
          <ul>
            <li>Files, tokens, and text are read in this browser tab. Nothing is uploaded, and DeltaKit has no analytics.</li>
            <li>Big comparisons run in a background worker, so the page stays responsive while they finish.</li>
            <li>Each file can be up to {formatBytes(MAX_BYTES)}. Very long results open with the first part, and <strong>Show more</strong> adds the rest in steps.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
