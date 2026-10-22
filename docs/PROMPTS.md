# Prompt design

Three prompts, each countering a different failure mode. Location: `desktop/electron/prompts.js`.

---

## 1. Recognition: no "helpful fixing"

A vision model does by default what a language model is trained to do — it sees a misspelling and outputs the correct spelling instead. For essay grading that is a disaster:
the very slip the teacher needs to mark is the one the model repairs, and with that the whole pipeline loses its point.

`RECOGNIZE_SYSTEM`:

- Transcribe only, character by character; **do not** fix misspellings, fill in missing characters, reorder words, polish sentences, normalise punctuation, or turn colloquial phrasing into written prose;
- The author's misspellings must survive verbatim (if the page says it that way, output it that way);
- Use `□` for anything illegible and set `need_verify: true` on that sentence.

The user message adds two **correct/incorrect** few-shot pairs:

```
· Page says "teh" → output "teh", not "the";
· Page says "adn" → output "adn", not "and".
These look like mistakes, but they are exactly what the teacher is marking. Repairing them means grading on the student's behalf.
```

Output shape (paragraphs → sentences):

```json
{
  "page": 1,
  "title": {"text": "Autumn in My Hometown", "confidence": 0.99},
  "author": {"text": "Li Ming", "confidence": 0.94},
  "paragraphs": [
    {"index": 1, "sentences": [{"id": "p1s1", "text": "…", "confidence": 0.96, "need_verify": false}]}
  ],
  "low_confidence": ["p2s1"]
}
```

Sentence splitting is pinned down in the prompt: split on full stops / question marks / exclamation marks / ellipses, never on semicolons or commas; merge a sentence broken by a line wrap; keep paragraphs as they appear on the page.

---

## 2. Review: separating "machine errors" from "student errors"

This step did not exist in the old version at all, and it is the core addition in this project.
At the plain-text stage the model carries a strong prior: since it was handed text, anything that "doesn't read right" must be an OCR problem.
So a misspelling is classified `ocr_fix`, the body text is rewritten to the correct word, and the student's error disappears entirely.

`CORRECT_SYSTEM` forces the decision with a **priority order** (first match wins):

| Order | verdict | Meaning | Requirement on `text` |
| --- | --- | --- | --- |
| 1 | `verify` | Illegible handwriting, broken sentence, source text undeterminable | May be empty |
| 2 | `author_error` | The sentence reads fine, but a character or word is wrong (homophone, similar shape, wrong collocation) | **Must match the source exactly**; describe the problem in `issues` |
| 3 | `ocr_fix` | Only the characters are broken: garbage, doubled glyphs, missing strokes that form no character, punctuation turned into odd symbols | Return the corrected sentence |
| 4 | `ok` | No problem | The source text |

It also states the trade-off explicitly:

> When "the student may have written it wrong" and "it was recognised wrong" cannot be told apart, always choose `author_error`:
> better that the teacher takes a second look than the app quietly fixes a child's slip.

Output:

```json
{"sentences": [{
  "id": "p2s1",
  "verdict": "author_error",
  "text": "I remember when I was little, I used to go up the hill with my friends.",
  "issues": [{"wrong": "teh", "right": "the", "kind": "misspelling", "reason": "\"the\" was written as \"teh\"."}],
  "need_verify": false
}]}
```

Hard requirements: every input id appears exactly once and in the same order; sentences are neither merged nor split; `issues` is non-empty only for `ocr_fix` / `author_error`.

---

## 3. Grading: quote the essay, no empty generalities

`GRADE_SYSTEM` pins the model to the role of "a Chinese-language teacher with twenty years of experience" and imposes three hard constraints:

- Judge this essay on its own terms, **quoting the source** and pointing to specific paragraphs and sentences;
- No vague filler ("read more books", "observe life more"), and no inventing content that is not in the essay;
- Decide the level first, then score within that level's band, and **the dimension scores must sum to the total**.

The user message injects: the rubric (dimensions + maximum + scoring criteria), the level bands (name + range + description),
**the confirmed list of student slips** (used directly as grounds for deducting language points), and the essay body.

Output:

```json
{
  "total": 36,
  "level": "Band 3",
  "summary": "The central idea is clear and the ending echoes the opening, but the material is generic and thin on detail.",
  "dimensions": [{"name": "Content", "score": 13, "max": 20, "comment": "…quotes the essay…"}],
  "pros": [{"text": "The opening simile is vivid", "source": "the maple leaves on the hill were like balls of flame"}],
  "cons": [{"text": "The three scenes are merely listed side by side", "source": "we rolled around in the piles of fallen leaves…"}],
  "suggestions": [{"text": "Turn the parallel sentences into one concrete event", "source": "…"}],
  "highlights": ["…"]
}
```

`suggestions` must be specific about *how* to change it, with a sample rewrite rather than a directional slogan.

---

## 4. When prompts are not enough: the deterministic safety net

Measured on the same photographed mock exam with three misspellings:

| Approach | Recognition stage | Review stage | "Student typos" on the result page |
| --- | --- | --- | --- |
| Original prompts | `teh` → `the` | Judged `ok` | 0 |
| Stronger few-shot | Still normalised | Judged `ocr_fix`, body rewritten | 0 |
| few-shot + four-state priority | `teh` kept | Still `ocr_fix` | 0 |
| Plus the code safety net | `teh` kept | `author_error` | **2** ✅ |

So `desktop/electron/ai.js` adds a deterministic rule that does not depend on the model behaving itself:

```js
// Same length, only 1–2 differences, Han characters on both sides → a single-character substitution at most,
// so "the student wrote it wrong" and "it was read wrong" cannot be told apart
if (verdict === 'ocr_fix' && fixedText && onlyHanSubstitutions(s.text, fixedText)) {
  verdict = 'author_error';   // leave it to the teacher; keep the source text
}
```

Implementation constraints for `onlyHanSubstitutions(a, b)`: the lengths must match, the number of differing positions must be 1–2, and every differing character on both sides must fall inside `[\u4e00-\u9fa5]`.
If any condition fails it returns false (multi-character insertions or deletions, and changes to Latin letters or digits, are still handled as `ocr_fix`).

**Conclusion: prompts handle "most of it", code handles the "safety net".** Betting product correctness on prompts is equivalent to betting it on the model's randomness.

---

## 5. Cost and timing

| Stage | Output limit | Time per call (free tier) | prompt tokens |
| --- | --- | --- | --- |
| Recognition | 6000 | 7.6–12.1s | ~9.5k |
| Review | 8000 | 4.4–7.8s | ~9k |
| Grading | 6000 | 16–39s | ~9k |

About 8k of `prompt_tokens` is the system prompt that `opencode` injects itself (`OMIT_SYSTEM_PROMPT` only removes the client-side system message, not that one),
which is acceptable on the free tier — but it means **a fixed overhead of roughly 25k prompt tokens per essay**, and that is one reason to keep "essays graded at once" at 1.

Temperature is fixed at 0.2 with `response_format: json_object`; the parsing layer `extractJson()` strips ```json fences and repairs trailing commas,
and anything still unparseable counts as a failure and is retried on the backup model through `withFallback()`.
