# CSV import fixtures

**Every file in this folder is FABRICATED. Not one of them is a real export
from a real app, and none of them should ever be described as one.**

That matters because it is the same honesty note the PractiScore parser carries
(`src/lib/practiscore.ts` lines 6 to 10): no shooting-log app's CSV export
format has been verified by this project. A search for documented export
formats found nothing usable (CSV design doc, section 8, item 4), which is
precisely why the importer is built around a mapping screen instead of around a
list of known formats. A fixture that pretended to be "the RangeBuddy export"
would be a made-up fact wearing a filename, and the next person would code
against it.

These files were written by hand to exercise the engine and the screen. The gun
names, ranges and notes in them are invented.

| File | What it is for |
|---|---|
| `range-log.csv` | The ordinary case: ISO dates, a gun the log has never seen, one column ("Time") the guesser gets wrong on purpose so the mapping screen has something to fix. |
| `ambiguous-dates.csv` | Dates that read one way as day first and another as month first, so the screen has to ask. |
| `symmetric-dates.csv` | Dates where the day and the month are the same number, so both readings agree and no value in the column can tell them apart. The question still has to be asked, and each option still has to carry its own name. |
| `broken-rows.csv` | One row with three separate faults, between two good rows. The headline has to say ONE row could not be read, not three problems. |
| `two-digit-years.csv` | Dates with a two-digit year, where even which number is the year is a guess. The screen has to ask rather than resolve it quietly. |
| `not-a-table.txt` | Nothing salvageable: no rows under the first line. The file is refused and the log is not touched. |
