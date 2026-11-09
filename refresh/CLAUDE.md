# Portfolio Ledger daily refresh

This repository exists only to run the weekday price refresh for my Portfolio Ledger tracker
(<YOUR-TRACKER-URL>). `.claude/settings.json` allows the ArtifactData tool and `python3 -I`
without prompting, so the scheduled run needs no approval.

<!-- Before you use this file: replace <YOUR-TRACKER-URL> above with the link to YOUR copy of the
     tracker (it looks like https://claude.ai/artifact/...). Then delete this comment. -->

## The refresh, step by step

Do only these steps; never edit the tracker page itself. Work in a folder W inside your scratchpad.

1. ArtifactData action "list" with query {"limit": 1000} and out_dir W/dump, once for each
   collection: market, instruments, imports, requests, settings, meta.
2. Write W/versions.json: a JSON object mapping "<collection>/<doc_id>" to the version each list
   result shows, for every document listed. Use the id as listed (with "~"), not the file name
   (file names spell "~" as "@").
3. Run: `python3 -I refresh.py W/dump W/versions.json W/out` from this repository's folder.
4. For each W/out/batch-N.json in order: ArtifactData action "batch" with the tracker URL above
   and writes set to the exact JSON array in that file. If a batch is refused because a document
   changed after step 1, redo steps 1 to 4 once.
5. Finish with a short summary: the "Prices as of" line from W/out/report.md, the number of
   writes, and anything under "Failed" or "NEEDS REVIEW".

If Yahoo Finance can't be reached or the script stops with an error, write nothing and report it.
