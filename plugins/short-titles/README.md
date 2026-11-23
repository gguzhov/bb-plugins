# Short thread titles

Cuts long thread titles to a set number of words so the sidebar stays readable.

## What it does

When a thread is created, starts a turn or finishes a turn, the plugin looks at the title. If it has more words than the limit, it keeps the first words and drops the rest. A title that already fits is never touched.

After the cut it removes trailing punctuation and dangling short words (articles, prepositions, conjunctions, in English and Russian), so a title does not end with "the", "and", "в" or "и". At least one word always stays.

## Setting

`maxWords`: whole number from 2 to 12, default 4. Change it in the plugin's settings page or with `bb plugin config short-titles set maxWords 6`.

## What it cannot know

- It does not know who wrote a title. A title you typed by hand is shortened like any other one.
- It cannot tell whether a short ending word matters. The word lists are fixed and short, so an unlisted word can still end a title.
- It works on word count only, not meaning, so the cut can lose the important part of a title.
- It only changes titles on the events above; titles of idle threads are not rewritten until the next event.

## Development

```
npm install
npm run typecheck
npm test
bb plugin build
```
