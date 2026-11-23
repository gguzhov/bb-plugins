---
name: csv-table
description: Explain or operate the CSV table BB plugin, which opens .csv files as a sortable, filterable table. Use when the user asks about this plugin's file opener, its size limit, delimiter detection, or how to choose it under Settings → File openers.
---

# CSV table

The CSV table plugin opens `.csv` files in BB's file panel as a table. The first row is the header. Click a column heading to sort ascending, then descending. The filter box matches every word against the whole row. **Columns** adds a filter to one column. Filters combine.

## Choosing the opener

Matching `.csv` files use this opener when it is the selected opener for that extension. Switch between it and BB's built-in preview under Settings → File openers, or with the file link's **Open with** menu. Inside the table, **Built-in preview** shows BB's own preview for the same file.

## Limits

- Files larger than 2 MB are not opened as a table.
- The table shows at most 5,000 data rows and 100 columns, and says when it stops early.
- Text must be UTF-8. Comma, semicolon, and tab are detected from the header line; quoted commas stay in the cell.
- The table reads the file. It does not edit or save it.
