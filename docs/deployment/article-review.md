# Article publication

The public edition, detail API, related coverage and sitemaps require an approved article snapshot. Existing unreviewed links return 404. The source feed and review queue remain available to staff. Newsletter section preparation and mailing have separate approval controls.

Open **Article review** and find a headline. **Prepare draft** reads the registered publisher and sends its available text to the configured newsroom model. Short, inaccessible or restricted sources can leave a story awaiting a draft. Check the source, figures, attribution and uncertainty against the editable sections. Saving stores a private draft. An administrator selects **Approve and publish** to replace the public snapshot. A conflicting edit returns 409 and requires reloading the draft.

The scheduled `backend/scripts/newsroom-briefs.mjs --limit 10 --commit` now prepares private article drafts. The optional `--id` targets an individual story. Raw publisher text and unapproved revisions are private. The collector accepts an optional signed `fullText` flag. Existing consumers may omit it.

The CI workflow's manual collector option updates the separate collector checkout. Its optional model check evaluates the configured NVIDIA model on five synthetic newsroom fixtures. The same cases can run through a private SSH forward with `node backend/scripts/newsroom-model-check.mjs --ollama MODEL`. Results include the exact model, draft sections, schema checks, source fact matches and latency. Review the returned copy for unsupported claims. These small fixtures measure a specific editorial task.

Manual collector releases use a dedicated SSH identity on the VPS with read-only access to the private `novrGitLab/novrcollector` repository. On first use, register the public key identified by `Collector public key` in that repository’s deploy keys. The private key stays on the VPS. The release fast-forwards a clean checkout and waits for collector health. The pinned GitHub host key is published in [GitHub’s SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
