# Public radar

Files here list the companies the public radar follows (TASK-030). Each file is
one profile in the radar tenant; each company becomes a target with its sources.

```bash
# once: sign up an account for the radar, set its plan to team by hand,
# put its tenant id in RADAR_TENANT_ID, then:
npm run radar:sync
```

Verified events appear at `/changes` and `/changes/<company>`; prices, plans,
policies and features also become post drafts sent to `OWNER_TELEGRAM_CHAT_ID`
(at most five a day per language). Nothing is posted without the owner's button.

Sync only adds. Removing a company from a file keeps its page and history.
