# AUTO_RAZBOR data directory

- `catalog.seed.json` — initial global catalogue seed (not exhaustive; some generation ranges/codes need source verification).
- `catalog.schema.json` — JSON Schema for the catalogue record shape.

Before adding data, preserve stable lowercase IDs and check that IDs are unique across brands, models and generations. Keep market-specific differences explicit. Do not invent unknown technical specifications.

Run the lightweight structural validator from the repository root:

```sh
node scripts/validate-catalog.mjs
```

For a production catalogue, add source metadata per record (source name, source URL, checked date, market and confidence) and verify licensing before importing third-party datasets.
