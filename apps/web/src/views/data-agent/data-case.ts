export const DATA_CASE = [
  {
    question: "Please list the transcript ID of Os01g0177400 in rice.",
    response: `|  Transcript ID  |
| :-------------: |
| Os01t0177400-01 |
`,
    captionKey: "agents.data.tableCaptions.transcript",
  },
  {
    question:
      "How many bases does the CDS sequence of rice transcript Os01t0177400-01 contain?",
    response: `| LENGTH([sequence_2]) |
| :------------------: |
|         1113         |`,
    captionKey: "agents.data.tableCaptions.cdsLength",
  },
  {
    question: "List the homologous genes of rice Os01g0177400 in maize.",
    response: `| Query Gene ID | Query Species | Homology Gene ID | Homology Species |
| ------------- | :-----------: | :--------------: | :--------------: |
| Os01g0177400  |      osa      | Zm00001eb122500  |       zma        |`,
    captionKey: "agents.data.tableCaptions.homologs",
  },
] as const;
