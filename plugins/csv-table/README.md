# CSV table

A bb plugin that opens `.csv` files as a sortable, filterable table. The file is only read, never changed.

## Use it

Open a `.csv` file from the file panel. If another opener is pinned for `csv`, choose **CSV table** under Settings → File openers, or in the file link's **Open with** menu.

- The first row is the header. Click a heading to sort ascending, click again for descending.
- The filter box keeps rows that contain every word you type. **Columns** adds a filter under each heading; **Clear** resets all filters.
- Rows are shown 100 per page. The toolbar shows the row count and the detected delimiter (comma, semicolon or tab).
- Numeric columns are right-aligned; long cells are cut with an ellipsis and show the full text on hover.
- **Built-in preview** switches to bb's own view of the file.

## Limits

- Files over 2,000,000 bytes, files that are not UTF-8 and files with null bytes are not opened as a table.
- At most 5,000 data rows and 100 columns are shown; a note says when the table stopped early.
- Blank lines are skipped. Short rows are padded, and a longer row adds columns named `Column N`.

## Development

```
npm install
npm run typecheck
npm test
bb plugin build
```

`server.ts` reads the file through `bb.sdk.files`, `app.tsx` registers the file opener, `csv.ts` is the parser and `csv-view.ts` does filtering, sorting and paging.
