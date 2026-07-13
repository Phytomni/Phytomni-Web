# Deep Genome Artifact visual fixture

Test-only Vite route for the current Artifact shell. It mounts the real
`DeepGenomeArtifact` component with the complete i18n boot path and a sanitized
copy of the shipped Os01g0177400 demo report, including long headings, a table,
references, and a local image asset.

URL:

```text
/tests/visual/research/?locale=en-US&theme=light
```

Use `locale=zh-CN` and `theme=dark` for the other evidence pairs. This fixture
does not make authenticated API calls and is not a replacement for the live
authenticated `/chat` → Artifact workflow; it is the deterministic real-content
lane for responsive Artifact geometry and copy review.
