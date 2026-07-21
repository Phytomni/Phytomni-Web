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

## Responsive viewport matrix

The capture matrix uses one representative viewport per device category. The
boundary smoke set additionally checks the edges where a category changes.

| Category                           | CSS viewport | Device scale factor | Expected physical capture |
| ---------------------------------- | -----------: | ------------------: | ------------------------: |
| Compact phone                      |      320×568 |                   1 |                   320×568 |
| Modern phone                       |      390×844 |                   1 |                   390×844 |
| Large phone / small tablet         |      480×900 |                   1 |                   480×900 |
| Tablet / small desktop             |     768×1024 |                   1 |                  768×1024 |
| Notebook                           |     1024×768 |                   1 |                  1024×768 |
| Notebook upper bound               |     1366×768 |                   1 |                  1366×768 |
| Desktop display                    |     1440×900 |                   1 |                  1440×900 |
| Desktop upper bound                |    1920×1080 |                   1 |                 1920×1080 |
| Ultra-wide / 4K at 150% OS scaling |    2560×1440 |                 1.5 |                 3840×2160 |

The 4K case uses the CSS-equivalent viewport for a 3840×2160 display at 150%
scaling. Capture names encode the CSS viewport, locale, and theme; the 4K
physical image dimensions are validated separately with `file`.

Boundary smoke widths (en-US/light) are: 320, 389, 390, 479, 480, 767, 768,
1024, 1199, 1366, 1367, 1920, and 1921px.

At desktop widths above the reading baseline, the Deep Genome canvas scales
fluidly from 1120px toward 1600px and its report column from 760px toward
1040px; ordinary research artifacts keep the shared reading width.
